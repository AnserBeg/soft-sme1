import unittest

from ai_agent.subagents.action_workflow import ActionWorkflowSubagent


class DummyAnalyticsSink:
    def __init__(self) -> None:
        self.events = []

    async def log_event(self, event_type: str, **kwargs):  # pragma: no cover - simple stub
        self.events.append((event_type, kwargs))


class FakeTaskQueue:
    def __init__(self) -> None:
        self.enqueued = []

    def enqueue(self, task_type, payload, conversation_id=None, scheduled_for=None):
        self.enqueued.append(
            {
                "task_type": task_type,
                "payload": payload,
                "conversation_id": conversation_id,
                "scheduled_for": scheduled_for,
            }
        )
        return "task-123"


class ActionWorkflowSubagentTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.analytics = DummyAnalyticsSink()
        self.queue = FakeTaskQueue()
        self.subagent = ActionWorkflowSubagent(
            analytics_sink=self.analytics,
            task_queue=self.queue,
        )

    def test_supports_step_handles_tool_and_action_types(self):
        tool_step = {
            "type": "tool",
            "payload": {"tool_name": "workflow.create_purchase_order"},
        }
        action_step = {"type": "action", "payload": {"action_name": "submit_invoice"}}
        unrelated_step = {"type": "message", "payload": {}}

        self.assertTrue(self.subagent.supports_step(tool_step))
        self.assertTrue(self.subagent.supports_step(action_step))
        self.assertFalse(self.subagent.supports_step(unrelated_step))

    async def test_execute_queues_task_when_task_queue_available(self):
        result = await self.subagent.execute(
            step_id="step-1",
            action="create_purchase_order",
            parameters={"quote_id": "Q-100"},
            planner_payload={"execution_mode": "queue", "result_key": "po_task"},
            conversation_id="conv-1",
            session_id=42,
        )

        self.assertEqual(result.status, "queued")
        self.assertEqual(result.queued_task_id, "task-123")
        self.assertEqual(result.result_key, "po_task")
        self.assertEqual(self.queue.enqueued[0]["payload"]["parameters"], {"quote_id": "Q-100"})
        self.assertGreaterEqual(result.metrics["latency_ms"], 0)
        self.assertTrue(any(event[0] == "subagent_invocation_completed" for event in self.analytics.events))


if __name__ == "__main__":
    unittest.main()

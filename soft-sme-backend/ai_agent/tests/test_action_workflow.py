import unittest

from ai_agent.skill_library import SkillWorkflow
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


class StubSkillLibrary:
    def __init__(self) -> None:
        self.skills = [
            SkillWorkflow(
                id="wf-1",
                name="confirm_vendor_pickup",
                version=1,
                description="Confirm pickup details",
                entrypoint="updatePickupDetails",
                parameters={"confirmation": "Vendor will pick up"},
            )
        ]
        self.upserts = []
        self.reflections = []

    async def list_workflows(self):  # pragma: no cover - simple async stub
        return list(self.skills)

    async def upsert_workflow(self, definition):  # pragma: no cover - simple async stub
        self.upserts.append(definition)
        return self.skills[0]

    async def record_run_reflection(self, payload):  # pragma: no cover - simple async stub
        self.reflections.append(payload)


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
        self.assertIsNone(result.skill_workflow_id)
        self.assertIsNone(result.skill_run_id)
        self.assertIsNone(result.verified)

    async def test_execute_with_skill_verifies_sync_action(self):
        skill_library = StubSkillLibrary()

        class DummyActionTool:
            async def invoke(self, message, conversation_id=None):  # pragma: no cover - simple stub
                return {
                    "message": "Pickup details updated",
                    "actions": [
                        {
                            "tool": "updatePickupDetails",
                            "success": True,
                            "summary": "Updated pickup",
                        }
                    ],
                }

        subagent = ActionWorkflowSubagent(
            analytics_sink=self.analytics,
            task_queue=self.queue,
            action_tool=DummyActionTool(),
            allow_direct_dispatch=True,
            skill_library=skill_library,
        )

        result = await subagent.execute(
            step_id="step-2",
            action="skill:confirm_vendor_pickup",
            parameters={"notes": "Call vendor"},
            planner_payload={"execution_mode": "sync", "skill_run_id": "run-1"},
            conversation_id="conv-2",
            session_id=99,
        )

        self.assertEqual(result.status, "success")
        self.assertEqual(result.skill_workflow_id, "wf-1")
        self.assertEqual(result.skill_run_id, "run-1")
        self.assertTrue(result.verified)
        self.assertIn("notes", result.parameters)
        self.assertEqual(skill_library.reflections[0]["skillWorkflowId"], "wf-1")
        self.assertTrue(skill_library.reflections[0]["success"])


if __name__ == "__main__":
    unittest.main()

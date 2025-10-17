import unittest
from typing import Any, Dict, List, Optional

from ai_agent.agent import AivenAgent
from ai_agent.aggregation import AggregationCoordinator


class DummyAnalyticsSink:
    def __init__(self) -> None:
        self.events: List[Dict[str, Any]] = []

    async def log_event(self, *args: Any, **kwargs: Any) -> None:  # pragma: no cover - simple stub
        self.events.append({"args": args, "kwargs": kwargs})


class FakeTaskQueue:
    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []

    def enqueue(
        self,
        task_type: str,
        payload: Dict[str, Any],
        *,
        conversation_id: Optional[str] = None,
        scheduled_for: Optional[Any] = None,
    ) -> str:
        task_id = f"task-{len(self.calls) + 1}"
        self.calls.append(
            {
                "task_type": task_type,
                "payload": dict(payload),
                "conversation_id": conversation_id,
                "scheduled_for": scheduled_for,
                "task_id": task_id,
            }
        )
        return task_id


class GuardrailCompensationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.agent = AivenAgent()
        self.agent.analytics_sink = DummyAnalyticsSink()
        self.agent.aggregation_coordinator = AggregationCoordinator(
            analytics_sink=self.agent.analytics_sink
        )
        self.fake_queue = FakeTaskQueue()
        self.agent.task_queue = self.fake_queue

    async def test_guardrail_follow_up_tasks_are_enqueued(self) -> None:
        plan = {
            "steps": [
                {
                    "id": "safety-1",
                    "type": "safety",
                    "description": "Evaluate guardrail",
                    "payload": {
                        "check_name": "default-policy-screen",
                        "severity": "block",
                        "policy_tags": ["finance"],
                        "detected_issues": ["High-risk transfer"],
                        "requires_manual_review": True,
                        "resolution": "Escalate to compliance",
                    },
                }
            ]
        }

        results = await self.agent._process_safety_steps(
            plan,
            session_id=42,
            conversation_id="conv-1",
            user_id=77,
        )

        self.assertEqual(len(results), 1)
        payload = results[0]
        self.assertIn("follow_up_tasks", payload)
        self.assertEqual(len(payload["follow_up_tasks"]), 1)
        self.assertEqual(payload.get("queued_follow_up_tasks"), ["task-1"])
        self.assertEqual(len(self.fake_queue.calls), 1)
        queued = self.fake_queue.calls[0]
        self.assertEqual(queued["task_type"], "agent_guardrail_follow_up")
        self.assertEqual(queued["conversation_id"], "conv-1")
        self.assertEqual(queued["payload"]["severity"], "block")


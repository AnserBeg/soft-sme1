import unittest

from ai_agent.critic_agent import CriticAgent


class StubAnalyticsSink:
    def __init__(self) -> None:
        self.events = []

    async def log_event(self, *_, **kwargs):  # type: ignore[override]
        self.events.append(kwargs)


class StubConversationManager:
    def __init__(self) -> None:
        self.calls = []

    def record_reflection(self, conversation_id: str, **payload):  # type: ignore[override]
        self.calls.append((conversation_id, payload))
        return "reflection-id"


class CriticAgentTests(unittest.IsolatedAsyncioTestCase):
    async def test_review_records_reflection_and_returns_feedback(self) -> None:
        analytics = StubAnalyticsSink()
        manager = StubConversationManager()
        critic = CriticAgent(
            analytics_sink=analytics,
            conversation_manager=manager,
            minimum_risk="medium",
        )

        feedback = await critic.review(
            conversation_id="conv-1",
            user_message="Please submit the order",
            final_response="Order submitted",
            actions_summary={
                "actions": [
                    {
                        "tool": "workflow.submit_order",
                        "status": "error",
                        "message": "API timed out",
                        "success": False,
                    }
                ]
            },
            planner_plan={"steps": [{"type": "action", "payload": {"risk_level": "high"}}]},
            safety_results=[],
            gathered_info={},
        )

        self.assertIsNotNone(feedback)
        assert feedback is not None
        self.assertTrue(feedback["requires_revision"])
        self.assertEqual(len(manager.calls), 1)
        self.assertEqual(len(analytics.events), 1)
        self.assertEqual(analytics.events[0]["metadata"]["issue_count"], 1)

    async def test_review_skips_when_below_threshold(self) -> None:
        analytics = StubAnalyticsSink()
        manager = StubConversationManager()
        critic = CriticAgent(
            analytics_sink=analytics,
            conversation_manager=manager,
            minimum_risk="critical",
        )

        feedback = await critic.review(
            conversation_id="conv-2",
            user_message="Need info",
            final_response="All good",
            actions_summary={
                "actions": [
                    {
                        "tool": "workflow.submit_order",
                        "status": "error",
                        "message": "API timed out",
                        "success": False,
                    }
                ]
            },
            planner_plan={},
            safety_results=[],
            gathered_info={},
        )

        self.assertIsNone(feedback)
        self.assertEqual(manager.calls, [])
        self.assertEqual(analytics.events, [])


if __name__ == "__main__":
    unittest.main()

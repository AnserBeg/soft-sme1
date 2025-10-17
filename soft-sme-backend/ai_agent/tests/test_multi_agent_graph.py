import unittest

from ai_agent.aggregation import AggregationCoordinator
from ai_agent.critic_agent import CriticBranchAssessment
from ai_agent.multi_agent_graph import MultiAgentGraphRunner
from ai_agent.subagents.documentation_qa import DocumentationQAResult
from ai_agent.subagents.voice_call import VoiceCallResult


class StubAnalyticsSink:
    def __init__(self) -> None:
        self.events = []

    async def log_event(self, *_, **kwargs):  # type: ignore[override]
        self.events.append(kwargs)


class StubDocSubagent:
    def __init__(self) -> None:
        self.calls = []

    async def execute(self, **kwargs):  # type: ignore[override]
        self.calls.append(kwargs)
        return DocumentationQAResult(
            step_id=kwargs.get("step_id", "doc"),
            status="success",
            answer="Stub answer",
            citations=[{"id": 1}],
            reasoning="stub",
            metrics={"confidence": 0.9},
            result_key=kwargs.get("planner_payload", {}).get("result_key"),
        )


class StubSQLTool:
    def __init__(self, should_fail: bool = False) -> None:
        self.should_fail = should_fail
        self.queries = []

    async def ainvoke(self, query):  # type: ignore[override]
        self.queries.append(query)
        if self.should_fail:
            raise RuntimeError("database timeout")
        return {"rows": [{"query": query}]}


class StubActionTool:
    def __init__(self) -> None:
        self.messages = []

    async def invoke(self, message, conversation_id=None):  # type: ignore[override]
        self.messages.append((message, conversation_id))
        return {"message": "ok", "actions": []}


class StubVoiceSubagent:
    def __init__(self) -> None:
        self.calls = []

    async def execute(self, **kwargs):  # type: ignore[override]
        self.calls.append(kwargs)
        return VoiceCallResult(
            step_id=kwargs.get("step_id", "voice"),
            status="completed",
            session_id=123,
            structured_notes={"summary": "Call completed"},
            events=[],
            vendor_phone="1234567890",
            provider="telnyx",
            telnyx_placed=True,
            raw_session={},
            metrics={"latency_ms": 42},
        )


class StubCritic:
    def __init__(self) -> None:
        self.calls = []

    async def assess_branch(self, **kwargs):  # type: ignore[override]
        self.calls.append(kwargs)
        executor = kwargs.get("executor_result", {})
        if executor.get("status") == "error":
            return CriticBranchAssessment(
                branch_id=kwargs.get("branch_id", "branch"),
                risk_level="high",
                requires_revision=True,
                summary="Executor failed",
                recommendation="Retry",
                issues=[
                    {
                        "severity": "high",
                        "tool": executor.get("tool"),
                        "description": executor.get("message"),
                    }
                ],
            )
        return None


class MultiAgentGraphRunnerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.analytics = StubAnalyticsSink()
        self.aggregator = AggregationCoordinator()
        self.doc = StubDocSubagent()
        self.sql = StubSQLTool()
        self.action = StubActionTool()
        self.voice = StubVoiceSubagent()
        self.critic = StubCritic()
        self.runner = MultiAgentGraphRunner(
            aggregator=self.aggregator,
            documentation_subagent=self.doc,
            sql_tool=self.sql,
            action_tool=self.action,
            voice_subagent=self.voice,
            critic_agent=self.critic,
            analytics_sink=self.analytics,
        )

    async def _collect_events(self, session_id: str, run_id: str):
        events = []
        async for event in self.aggregator.stream_events(
            session_id=session_id,
            plan_step_id=run_id,
        ):
            events.append(event)
        return events

    async def test_run_graph_emits_events_and_returns_branches(self) -> None:
        plan = {
            "feature_flags": {"multi_agent_graph": True},
            "branches": [
                {
                    "id": "branch-1",
                    "research_tasks": [{"id": "task-1", "query": "How to count inventory?"}],
                    "executor": {"type": "sql", "statement": "SELECT 1"},
                    "voice": {"purchase_id": 42, "goals": ["Confirm availability"]},
                },
                {
                    "id": "branch-2",
                    "research_tasks": [{"id": "task-2", "query": "Trigger workflow"}],
                    "executor": {"type": "action", "message": "Run workflow"},
                },
            ],
        }

        result = await self.runner.run_graph(
            session_id="321",
            plan=plan,
            conversation_id="conv-1",
            conversation_history=[{"text": "Hello", "is_user": True}],
        )

        assert result is not None
        events = await self._collect_events("321", result.run_id)
        event_types = [event.event_type for event in events]
        self.assertIn("plan_step_completed", event_types)
        self.assertTrue(any(event.content.get("stage") == "voice" for event in events if event.event_type == "subagent_result"))
        self.assertEqual(result.status, "success")
        self.assertEqual(len(result.branches), 2)
        self.assertEqual(len(self.doc.calls), 2)
        self.assertEqual(len(self.voice.calls), 1)

    async def test_run_graph_handles_executor_failure_with_critic(self) -> None:
        failing_runner = MultiAgentGraphRunner(
            aggregator=self.aggregator,
            documentation_subagent=self.doc,
            sql_tool=StubSQLTool(should_fail=True),
            action_tool=self.action,
            voice_subagent=None,
            critic_agent=self.critic,
            analytics_sink=self.analytics,
        )

        plan = {
            "feature_flags": {"multi_agent_graph": True},
            "branches": [
                {
                    "id": "branch-fail",
                    "research_tasks": [{"id": "task-1", "query": "Check"}],
                    "executor": {"type": "sql", "statement": "SELECT fail"},
                }
            ],
        }

        result = await failing_runner.run_graph(
            session_id="654",
            plan=plan,
            conversation_id="conv-2",
            conversation_history=None,
        )

        assert result is not None
        self.assertEqual(result.status, "error")
        self.assertTrue(result.branches[0].critic_assessment)
        events = await self._collect_events("654", result.run_id)
        final_event = events[-1]
        self.assertEqual(final_event.event_type, "plan_step_completed")
        self.assertEqual(final_event.content["status"], "error")

    async def test_run_graph_skips_voice_when_not_configured(self) -> None:
        runner = MultiAgentGraphRunner(
            aggregator=self.aggregator,
            documentation_subagent=self.doc,
            sql_tool=self.sql,
            action_tool=self.action,
            voice_subagent=None,
            critic_agent=None,
            analytics_sink=self.analytics,
        )

        plan = {
            "feature_flags": {"multi_agent_graph": True},
            "branches": [
                {
                    "id": "branch-voice",
                    "research_tasks": [{"id": "task-1", "query": "Call vendor"}],
                    "voice": {"purchase_id": 11},
                }
            ],
        }

        result = await runner.run_graph(
            session_id="777",
            plan=plan,
            conversation_id="conv-3",
            conversation_history=None,
        )

        assert result is not None
        events = await self._collect_events("777", result.run_id)
        self.assertFalse(any(event.content.get("stage") == "voice" for event in events if event.event_type == "subagent_result"))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()

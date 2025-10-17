import time
import unittest

from ai_agent.tool_policy import ToolScoringPolicy, ToolUsageContext


class ToolScoringPolicyTests(unittest.TestCase):
    def test_prefers_tools_with_higher_success_rate(self) -> None:
        policy = ToolScoringPolicy()
        context = ToolUsageContext(message="Need help")

        baseline = policy.rank_candidates(["sql", "rag", "llm_knowledge"], context)
        self.assertEqual(baseline[-1], "llm_knowledge")

        policy.record_observation("sql", success=False, latency_ms=9000)
        policy.record_observation("rag", success=True, latency_ms=2200)

        ranked = policy.rank_candidates(["sql", "rag", "llm_knowledge"], context)
        self.assertEqual(ranked[0], "rag")
        self.assertEqual(ranked[-1], "sql")

    def test_planner_suggestions_receive_priority_boost(self) -> None:
        policy = ToolScoringPolicy()
        without_boost = policy.rank_candidates(
            ["rag", "sql"], ToolUsageContext(message="Need inventory report")
        )
        self.assertEqual(without_boost[0], "rag")

        with_boost = policy.rank_candidates(
            ["rag", "sql"],
            ToolUsageContext(
                message="Need inventory report",
                planner_suggestions=["sql"],
            ),
        )
        self.assertEqual(with_boost[0], "sql")

    def test_recent_failure_penalizes_tool(self) -> None:
        policy = ToolScoringPolicy()

        policy.record_observation("sql", success=True, latency_ms=2000)
        # Force timestamps to differ slightly so the failure is "recent"
        time.sleep(0.01)
        policy.record_observation("sql", success=False, latency_ms=2000)
        policy.record_observation("rag", success=True, latency_ms=2500)

        ranked = policy.rank_candidates(["sql", "rag"], ToolUsageContext(message="Need help"))
        self.assertEqual(ranked[0], "rag")


if __name__ == "__main__":
    unittest.main()

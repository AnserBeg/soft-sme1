import unittest

from ai_agent.agent import AivenAgent
from ai_agent.subagents.row_selection import RowSelectionResult


class FakeRowSelectionSubagent:
    def __init__(self) -> None:
        self.invocations = []

    def supports_step(self, step):
        return True

    async def execute(self, **kwargs):
        self.invocations.append(kwargs)
        return RowSelectionResult(
            step_id=kwargs.get("step_id", "row-selection"),
            status="success",
            table_candidates=["inventory"],
            reasoning="fake",
            metrics={"latency_ms": 1},
            result_key=kwargs.get("planner_payload", {}).get("result_key"),
        )


class PlannerIntegrationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.agent = AivenAgent()
        self.agent.row_selection_subagent = FakeRowSelectionSubagent()

    def test_map_planner_steps_includes_sql_for_row_selection_lookup(self):
        plan = {
            "steps": [
                {
                    "type": "lookup",
                    "payload": {
                        "target": "database",
                        "filters": {"intent": "row_selection"},
                        "query": "Find the right table",
                    },
                }
            ]
        }

        suggested = self.agent._map_planner_steps_to_tools(plan)
        self.assertIn("sql", suggested)
        self.assertIn("row_selection_subagent", suggested)

    async def test_execute_row_selection_steps_returns_results(self):
        plan = {
            "steps": [
                {
                    "id": "step-1",
                    "type": "lookup",
                    "payload": {
                        "target": "database",
                        "filters": {"intent": "row_selection"},
                        "query": "Which tables store inventory?",
                        "result_key": "candidate_tables",
                    },
                }
            ]
        }

        results = await self.agent._execute_row_selection_steps(
            plan,
            conversation_history=None,
            session_id=123,
        )

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["table_candidates"], ["inventory"])
        self.assertEqual(self.agent.row_selection_subagent.invocations[0]["session_id"], 123)


if __name__ == "__main__":
    unittest.main()

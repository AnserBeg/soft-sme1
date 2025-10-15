import unittest

from ai_agent.subagents.row_selection import RowSelectionSubagent


class FakeAnalyticsSink:
    def __init__(self) -> None:
        self.events = []

    async def log_event(self, event_type: str, **payload):
        self.events.append((event_type, payload))


class RowSelectionSubagentTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.analytics = FakeAnalyticsSink()
        self.subagent = RowSelectionSubagent(
            analytics_sink=self.analytics,
            max_candidates=4,
        )

    def test_supports_lookup_step_with_row_selection_intent(self):
        plan_step = {
            "id": "step-1",
            "type": "lookup",
            "payload": {
                "target": "database",
                "filters": {"intent": "row_selection"},
                "query": "Which tables contain sales orders?",
            },
        }

        self.assertTrue(self.subagent.supports_step(plan_step))

    async def test_execute_returns_relevant_tables_for_sales_orders(self):
        result = await self.subagent.execute(
            step_id="step-2",
            question="Need sales order line items by customer",
            filters={},
        )

        self.assertEqual(result.status, "success")
        self.assertIn("salesorderlineitems", result.table_candidates)
        self.assertIn("salesorderhistory", result.table_candidates)
        self.assertTrue(any(event[0] == "subagent_invocation_completed" for event in self.analytics.events))

    async def test_execute_prioritizes_preferred_tables(self):
        result = await self.subagent.execute(
            step_id="step-3",
            question="Show vendor spend totals",
            filters={"preferred_tables": ["purchasehistory"]},
        )

        self.assertEqual(result.status, "success")
        self.assertGreaterEqual(len(result.table_candidates), 1)
        self.assertEqual(result.table_candidates[0], "purchasehistory")


if __name__ == "__main__":
    unittest.main()

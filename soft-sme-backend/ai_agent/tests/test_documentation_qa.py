import types
import unittest
from unittest.mock import AsyncMock, MagicMock

from ai_agent.subagents.documentation_qa import DocumentationQASubagent


class FakeAnalyticsSink:
    def __init__(self) -> None:
        self.events = []

    async def log_event(self, event_type: str, **payload):
        self.events.append((event_type, payload))


class DocumentationQASubagentTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.analytics = FakeAnalyticsSink()
        self.rag_tool = MagicMock()
        self.llm = MagicMock()
        self.llm.ainvoke = AsyncMock()
        self.subagent = DocumentationQASubagent(
            rag_tool=self.rag_tool,
            llm=self.llm,
            analytics_sink=self.analytics,
            max_queries=3,
        )

    def test_build_queries_combines_focus_and_conversation_tail(self):
        question = "How do I convert a quote?"
        focus_hints = {"module": "quotes", "workflow": "quote_to_order"}
        conversation_tail = [
            {"role": "user", "content": "Can you help with quotes?"},
            {"role": "assistant", "content": "Sure, what part?"},
        ]

        queries = self.subagent._build_queries(
            question=question,
            focus_hints=focus_hints,
            conversation_tail=conversation_tail,
        )

        self.assertGreaterEqual(len(queries), 2)
        self.assertEqual(queries[0], question)
        self.assertTrue(any("quote_to_order" in q for q in queries))
        self.assertTrue(any("User:" in q for q in queries))
        self.assertEqual(len(set(queries)), len(queries))

    async def test_execute_returns_no_answer_when_coverage_below_fallback(self):
        self.subagent._build_queries = MagicMock(return_value=["query"])
        self.subagent._run_retrieval = AsyncMock(
            return_value=[{"score": 0.1, "metadata": {"title": "Quotes"}}]
        )

        result = await self.subagent.execute(step_id="step-1", question="Test question")

        self.assertEqual(result.status, "no_answer")
        self.assertIsNone(result.answer)
        self.assertEqual(result.citations, [])
        self.llm.ainvoke.assert_not_called()

        statuses = [event[1]["status"] for event in self.analytics.events if event[0] == "subagent_invocation_completed"]
        self.assertIn("no_answer", statuses)

    async def test_execute_success_builds_citations_and_calls_llm(self):
        retrieved_chunks = [
            {
                "id": "1",
                "score": 0.9,
                "metadata": {"title": "Quotes", "file_path": "quotes.md"},
                "text": "Step by step instructions",
            },
            {
                "id": "2",
                "score": 0.8,
                "metadata": {"title": "Orders", "file_path": "orders.md"},
                "text": "Follow-up guidance",
            },
        ]
        self.subagent._build_queries = MagicMock(return_value=["query"])
        self.subagent._run_retrieval = AsyncMock(return_value=retrieved_chunks)
        llm_response = types.SimpleNamespace(content="Here is how")
        self.llm.ainvoke = AsyncMock(return_value=llm_response)

        result = await self.subagent.execute(step_id="step-2", question="Test question")

        self.assertEqual(result.status, "success")
        self.assertEqual(result.answer, "Here is how")
        self.assertEqual(len(result.citations), 2)
        self.assertTrue(all("score" in citation for citation in result.citations))
        self.llm.ainvoke.assert_awaited()

        statuses = [event[1]["status"] for event in self.analytics.events if event[0] == "subagent_invocation_completed"]
        self.assertIn("success", statuses)


if __name__ == "__main__":
    unittest.main()

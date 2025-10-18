"""Tests for the AgentActionTool HTTP client wrapper."""

import unittest
from unittest.mock import AsyncMock, patch

import httpx

from ai_agent.action_tool import AgentActionTool


class _RetryingClient:
    def __init__(self, succeed_on: int, response_json: dict) -> None:
        self.succeed_on = succeed_on
        self.response_json = response_json
        self.calls = 0

    async def request(self, method: str, url: str, headers=None, json=None):  # pragma: no cover - simple stub
        self.calls += 1
        if self.calls < self.succeed_on:
            raise httpx.ConnectError("connection failed", request=httpx.Request(method, url))
        return httpx.Response(200, request=httpx.Request(method, url), json=self.response_json)


class _AlwaysFailClient:
    def __init__(self, error: Exception) -> None:
        self.error = error
        self.calls = 0

    async def request(self, method: str, url: str, headers=None, json=None):  # pragma: no cover - simple stub
        self.calls += 1
        raise self.error


class AgentActionToolRetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_ensure_session_retries_request_errors(self):
        tool = AgentActionTool()
        tool._client = _RetryingClient(3, {"sessionId": 99})

        with patch("ai_agent.action_tool.asyncio.sleep", new=AsyncMock()) as sleep_mock:
            session_id = await tool.ensure_session("conversation-1")

        self.assertEqual(session_id, 99)
        self.assertEqual(tool._session_map["conversation-1"], 99)
        self.assertEqual(tool._client.calls, 3)
        self.assertEqual(sleep_mock.await_count, 2)

    async def test_invoke_returns_failure_after_retry_exhaustion(self):
        error = httpx.ConnectError("boom", request=httpx.Request("POST", "http://service/chat"))
        tool = AgentActionTool()
        tool._client = _AlwaysFailClient(error)

        with patch("ai_agent.action_tool.asyncio.sleep", new=AsyncMock()):
            result = await tool.invoke("run workflow", conversation_id="conv-123")

        self.assertIn("actions", result)
        self.assertEqual(result["actions"][0]["success"], False)
        self.assertIn("Unable to contact action orchestrator", result["message"])


if __name__ == "__main__":
    unittest.main()

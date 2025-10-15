import unittest
from typing import Any, Dict, List, Sequence

from ai_agent.subagents.voice_call import VoiceCallSubagent


class DummyAnalyticsSink:
    def __init__(self) -> None:
        self.events: List[Any] = []

    async def log_event(self, event_type: str, **kwargs) -> None:  # pragma: no cover - simple stub
        self.events.append((event_type, kwargs))


class StubResponse:
    def __init__(self, payload: Dict[str, Any], status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> Dict[str, Any]:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class StubAsyncClient:
    def __init__(self, responses: Sequence[Any]) -> None:
        self._responses = list(responses)
        self.requests: List[Any] = []

    async def post(self, url: str, json: Dict[str, Any] | None = None, headers: Dict[str, Any] | None = None):
        self.requests.append(("POST", url, json))
        return self._next_response()

    async def get(self, url: str, headers: Dict[str, Any] | None = None):
        self.requests.append(("GET", url, None))
        return self._next_response()

    async def aclose(self) -> None:  # pragma: no cover - no resources to release
        return None

    def _next_response(self):
        if not self._responses:
            raise RuntimeError("No stub responses available")
        response = self._responses.pop(0)
        if isinstance(response, Exception):
            raise response
        response.raise_for_status()
        return response


class StubTaskQueue:
    def __init__(self) -> None:
        self.requests: List[Sequence[Any]] = []

    def fan_out(self, specs):  # pragma: no cover - exercised via VoiceCallSubagent
        self.requests.append(specs)
        return [f"task-{len(self.requests)}"]


class VoiceCallSubagentTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.analytics = DummyAnalyticsSink()

    def test_supports_step_detects_voice_tool(self):
        subagent = VoiceCallSubagent(analytics_sink=self.analytics, max_retries=1, http_client=StubAsyncClient([]))
        step = {"type": "tool", "payload": {"tool_name": "voice_vendor_call"}}
        unrelated = {"type": "tool", "payload": {"tool_name": "documentation_lookup"}}
        self.assertTrue(subagent.supports_step(step))
        self.assertFalse(subagent.supports_step(unrelated))

    async def test_execute_success_returns_normalized_result_and_callbacks(self):
        callbacks_called: Dict[str, List[Any]] = {"status": [], "structured": []}

        async def on_status(payload: Dict[str, Any], metadata: Dict[str, Any]):
            callbacks_called["status"].append((payload, metadata))

        def on_structured(payload: Dict[str, Any], metadata: Dict[str, Any]):
            callbacks_called["structured"].append((payload, metadata))

        client = StubAsyncClient(
            [
                StubResponse(
                    {
                        "session_id": 42,
                        "status": "initiated",
                        "telnyx": True,
                        "provider": "livekit_telnyx",
                    }
                ),
                StubResponse(
                    {
                        "id": 42,
                        "status": "initiated",
                        "vendor_phone": "+15550001111",
                        "structured_notes": {"email": "vendor@example.com"},
                        "events": [{"type": "status", "payload": {"status": "initiated"}}],
                        "updated_at": "2024-01-01T00:00:00Z",
                    }
                ),
            ]
        )

        queue = StubTaskQueue()

        subagent = VoiceCallSubagent(
            analytics_sink=self.analytics,
            http_client=client,
            max_retries=1,
            task_queue=queue,
        )

        result = await subagent.execute(
            step_id="voice-step-1",
            purchase_id=123,
            agent_session_id=7,
            goals=["capture_vendor_email"],
            metadata={"priority": "normal"},
            planner_payload={
                "callbacks": {
                    "onStatusChange": [
                        on_status,
                        {
                            "type": "task_queue",
                            "task_type": "planner_voice_status",
                            "payload": {"source": "voice_call"},
                        },
                    ],
                    "onStructuredUpdate": on_structured,
                }
            },
            conversation_id="conv-1",
            session_id=55,
        )

        self.assertEqual(result.status, "initiated")
        self.assertEqual(result.session_id, 42)
        self.assertTrue(result.telnyx_placed)
        self.assertEqual(result.vendor_phone, "+15550001111")
        self.assertIsNotNone(result.structured_notes)
        self.assertTrue(callbacks_called["status"])
        self.assertTrue(callbacks_called["structured"])
        self.assertTrue(any(event[0] == "subagent_invocation_completed" for event in self.analytics.events))
        self.assertEqual(len(queue.requests), 1)
        queued_spec = queue.requests[0][0]
        self.assertEqual(queued_spec.task_type, "planner_voice_status")
        self.assertIn("event", queued_spec.payload)
        self.assertEqual(queued_spec.payload.get("source"), "voice_call")
        self.assertEqual(queued_spec.conversation_id, "conv-1")
        self.assertTrue(
            any(
                event_type == "voice_callback_dispatched" and event_kwargs["status"] == "success"
                and event_kwargs["metadata"].get("target") == "task_queue"
                for event_type, event_kwargs in self.analytics.events
            )
        )

    async def test_execute_failure_returns_error_result(self):
        client = StubAsyncClient([RuntimeError("dial failed")])
        subagent = VoiceCallSubagent(
            analytics_sink=self.analytics,
            http_client=client,
            max_retries=1,
        )

        result = await subagent.execute(
            step_id="voice-step-2",
            purchase_id=456,
            agent_session_id=None,
            planner_payload={},
        )

        self.assertEqual(result.status, "error")
        self.assertIsNone(result.session_id)
        self.assertTrue(any(event[0] == "voice_call_retry" for event in self.analytics.events))


if __name__ == "__main__":
    unittest.main()

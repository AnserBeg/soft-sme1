import asyncio
import unittest
from typing import Dict, Optional
from unittest import mock

from ai_agent.aggregation import (
    AggregationCoordinator,
    InMemoryTelemetryContextStore,
    RedisTelemetryContextStore,
    SafetyDirective,
    create_telemetry_store_from_env,
)


class AggregationCoordinatorTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.coordinator = AggregationCoordinator()
        self.session_id = "sess-1"
        self.plan_step_id = "plan-step-1"

    async def _collect_events(self, **stream_kwargs):
        events = []

        async def _reader():
            async for event in self.coordinator.stream_events(**stream_kwargs):
                events.append(event.to_dict())
                if event.event_type == "plan_step_completed":
                    break

        await asyncio.wait_for(asyncio.create_task(_reader()), timeout=1.0)
        return events

    async def test_register_and_emit_events_flow(self):
        await self.coordinator.register_plan_step(
            session_id=self.session_id,
            plan_step_id=self.plan_step_id,
            expected_subagents=[{"key": "documentation", "result_key": "doc"}],
            planner_context={"request_id": "req-123"},
        )

        collector = asyncio.create_task(
            self._collect_events(
                session_id=self.session_id,
                plan_step_id=self.plan_step_id,
            )
        )

        await asyncio.sleep(0)

        await self.coordinator.emit_subagent_event(
            session_id=self.session_id,
            plan_step_id=self.plan_step_id,
            subagent="documentation",
            status="in_progress",
            payload={"message": "working"},
        )
        await self.coordinator.emit_step_completed(
            session_id=self.session_id,
            plan_step_id=self.plan_step_id,
            status="success",
            payload={"summary": "done"},
        )

        events = await collector
        self.assertEqual([event["type"] for event in events], [
            "step_started",
            "subagent_result",
            "plan_step_completed",
        ])
        self.assertEqual(events[0]["sequence"], 1)
        self.assertEqual(events[1]["content"]["status"], "in_progress")
        self.assertEqual(events[-1]["content"]["payload"], {"summary": "done"})

    async def test_stream_replays_from_cache_after_completion(self):
        await self.coordinator.register_plan_step(
            session_id=self.session_id,
            plan_step_id=self.plan_step_id,
            expected_subagents=[{"key": "documentation", "result_key": "doc"}],
        )
        await self.coordinator.emit_subagent_event(
            session_id=self.session_id,
            plan_step_id=self.plan_step_id,
            subagent="documentation",
            status="completed",
            payload={"answer": "42"},
        )
        await self.coordinator.emit_step_completed(
            session_id=self.session_id,
            plan_step_id=self.plan_step_id,
            status="success",
        )

        initial_events = await self._collect_events(
            session_id=self.session_id,
            plan_step_id=self.plan_step_id,
        )
        self.assertEqual(len(initial_events), 3)

        replay_events = await self._collect_events(
            session_id=self.session_id,
            plan_step_id=self.plan_step_id,
            last_sequence_id=str(initial_events[0]["sequence"]),
        )
        self.assertEqual([event["type"] for event in replay_events], [
            "subagent_result",
            "plan_step_completed",
        ])

    async def test_subagent_event_merges_telemetry(self):
        await self.coordinator.register_plan_step(
            session_id=self.session_id,
            plan_step_id=self.plan_step_id,
            expected_subagents=[{
                "key": "documentation",
                "result_key": "doc",
                "telemetry": {"trace_id": "trace-1"},
            }],
        )

        collector = asyncio.create_task(
            self._collect_events(
                session_id=self.session_id,
                plan_step_id=self.plan_step_id,
            )
        )

        await asyncio.sleep(0)

        await self.coordinator.emit_subagent_event(
            session_id=self.session_id,
            plan_step_id=self.plan_step_id,
            subagent="documentation",
            status="completed",
            payload={},
            telemetry={"span_id": "span-99"},
        )
        await self.coordinator.emit_step_completed(
            session_id=self.session_id,
            plan_step_id=self.plan_step_id,
            status="success",
        )

        events = await collector
        telemetry = events[1]["telemetry"]
        self.assertEqual(telemetry["trace_id"], "trace-1")
        self.assertEqual(telemetry["span_id"], "span-99")

    async def test_apply_safety_decision_short_circuits(self):
        collector = asyncio.create_task(
            self._collect_events(
                session_id=self.session_id,
                plan_step_id="safety-step-1",
            )
        )

        decision = {
            "severity": "block",
            "policy_tags": ["privacy"],
            "detected_issues": ["Contains PII"],
            "requires_manual_review": True,
            "resolution": "Escalate to compliance",
            "fallback_step": "create-compliance-task",
        }

        directive = await self.coordinator.apply_safety_decision(
            session_id=self.session_id,
            plan_step_id="safety-step-1",
            decision=decision,
            planner_context={"description": "safety check"},
        )

        events = await collector

        self.assertIsInstance(directive, SafetyDirective)
        self.assertTrue(directive.should_short_circuit)
        self.assertEqual(directive.severity, "block")
        self.assertEqual(directive.policy_tags, ("privacy",))
        self.assertEqual(events[0]["type"], "step_started")
        self.assertEqual(events[1]["content"]["status"], "block")
        self.assertEqual(events[2]["content"]["status"], "blocked")

    async def test_apply_safety_decision_pass_through(self):
        directive = await self.coordinator.apply_safety_decision(
            session_id=self.session_id,
            plan_step_id="safety-step-2",
            decision={
                "severity": "info",
                "policy_tags": [],
                "detected_issues": [],
            },
        )

        self.assertFalse(directive.should_short_circuit)
        self.assertEqual(directive.severity, "info")


class FakeRedisClient:
    def __init__(self) -> None:
        self.store: Dict[str, Dict[str, str]] = {}
        self.expirations: Dict[str, int] = {}

    async def hset(self, key: str, field: str, value: str) -> None:
        self.store.setdefault(key, {})[field] = value

    async def hget(self, key: str, field: str) -> Optional[str]:
        return self.store.get(key, {}).get(field)

    async def expire(self, key: str, ttl: int) -> None:
        self.expirations[key] = ttl

    async def delete(self, key: str) -> None:
        self.store.pop(key, None)
        self.expirations.pop(key, None)


class TelemetryStoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_redis_store_round_trip_with_fake_client(self) -> None:
        fake_client = FakeRedisClient()
        store = RedisTelemetryContextStore(
            redis_client=fake_client,
            ttl_seconds=42,
            namespace="test-telemetry",
        )

        await store.set("s", "p", "sub", {"trace_id": "abc"})
        telemetry = await store.get("s", "p", "sub")
        self.assertEqual(telemetry, {"trace_id": "abc"})
        self.assertEqual(fake_client.expirations["test-telemetry:s:p"], 42)

        await store.clear("s", "p")
        telemetry_after_clear = await store.get("s", "p", "sub")
        self.assertEqual(telemetry_after_clear, {})

    def test_create_store_from_env_prefers_redis_when_available(self) -> None:
        env = {
            "AI_TELEMETRY_REDIS_URL": "redis://unit-test",
            "AI_TELEMETRY_REDIS_TTL_SECONDS": "120",
        }

        with mock.patch("ai_agent.aggregation.redis_asyncio") as redis_module:
            fake_client = object()
            redis_module.from_url.return_value = fake_client
            store = create_telemetry_store_from_env(env)

        self.assertIsInstance(store, RedisTelemetryContextStore)

    def test_create_store_from_env_falls_back_when_redis_missing(self) -> None:
        env = {"AI_TELEMETRY_REDIS_URL": "redis://unit-test"}

        with mock.patch("ai_agent.aggregation.redis_asyncio", None):
            store = create_telemetry_store_from_env(env)

        self.assertIsInstance(store, InMemoryTelemetryContextStore)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()

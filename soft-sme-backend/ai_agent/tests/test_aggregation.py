import asyncio
import unittest

from ai_agent.aggregation import AggregationCoordinator
from ai_agent.aggregation import SafetyDirective


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


if __name__ == "__main__":  # pragma: no cover
    unittest.main()

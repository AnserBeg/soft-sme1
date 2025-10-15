import asyncio
import json
import unittest

from ai_agent.aggregation import AggregationCoordinator, StreamMux


def _parse_sse_messages(messages):
    parsed = []
    for chunk in messages:
        event_id = None
        event_type = None
        data_lines = []
        for line in chunk.strip().splitlines():
            if line.startswith("id: "):
                event_id = line[4:]
            elif line.startswith("event: "):
                event_type = line[7:]
            elif line.startswith("data: "):
                data_lines.append(line[6:])
        payload = json.loads("\n".join(data_lines)) if data_lines else None
        parsed.append({
            "id": event_id,
            "event": event_type,
            "data": payload,
        })
    return parsed


class StreamMuxTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.coordinator = AggregationCoordinator()
        self.session_id = "sess-1"
        self.plan_step_id = "plan-step-1"

    async def _register_default_plan(self):
        await self.coordinator.register_plan_step(
            session_id=self.session_id,
            plan_step_id=self.plan_step_id,
            expected_subagents=[
                {"key": "documentation", "result_key": "doc"},
                {"key": "row", "result_key": "row"},
            ],
        )

    async def test_batches_concurrent_events_and_completion(self):
        await self._register_default_plan()
        mux = StreamMux(
            self.coordinator,
            heartbeat_interval=0.5,
            max_batch_size=3,
            flush_interval=0.05,
        )

        messages = []

        async def consume():
            async for chunk in mux.stream_sse(
                session_id=self.session_id,
                plan_step_id=self.plan_step_id,
            ):
                messages.append(chunk)
                if "plan_step_completed" in chunk:
                    break

        consumer = asyncio.create_task(consume())
        await asyncio.sleep(0)

        await asyncio.gather(
            self.coordinator.emit_subagent_event(
                session_id=self.session_id,
                plan_step_id=self.plan_step_id,
                subagent="documentation",
                status="completed",
                payload={"answer": "A"},
            ),
            self.coordinator.emit_subagent_event(
                session_id=self.session_id,
                plan_step_id=self.plan_step_id,
                subagent="row",
                status="completed",
                payload={"rows": [1, 2]},
            ),
        )
        await self.coordinator.emit_step_completed(
            session_id=self.session_id,
            plan_step_id=self.plan_step_id,
            status="success",
            payload={"summary": "done"},
        )

        await asyncio.wait_for(consumer, timeout=1.0)
        parsed = _parse_sse_messages(messages)

        batches = [msg for msg in parsed if msg["data"]["type"] == "event_batch"]
        self.assertGreaterEqual(len(batches), 1)

        combined_sequences = [
            event["sequence"]
            for batch in batches
            for event in batch["data"]["events"]
        ]
        self.assertEqual(combined_sequences, [1, 2, 3, 4])

        batch_lengths = [len(batch["data"]["events"]) for batch in batches]
        self.assertTrue(any(length > 1 for length in batch_lengths))

    async def test_emits_heartbeat_when_idle(self):
        await self._register_default_plan()
        mux = StreamMux(
            self.coordinator,
            heartbeat_interval=0.05,
            max_batch_size=2,
            flush_interval=0.02,
        )

        messages = []

        async def consume():
            async for chunk in mux.stream_sse(
                session_id=self.session_id,
                plan_step_id=self.plan_step_id,
            ):
                messages.append(chunk)
                if len(messages) >= 2:
                    break

        await asyncio.wait_for(asyncio.create_task(consume()), timeout=1.0)

        parsed = _parse_sse_messages(messages)
        self.assertEqual(parsed[0]["event"], "planner_stream")
        self.assertEqual(parsed[0]["data"]["type"], "event_batch")
        self.assertEqual(parsed[1]["event"], "heartbeat")
        self.assertEqual(parsed[1]["data"]["sequence"], 1)

        await self.coordinator.emit_step_completed(
            session_id=self.session_id,
            plan_step_id=self.plan_step_id,
            status="cancelled",
        )

    async def test_replay_from_last_event_id(self):
        await self._register_default_plan()
        await self.coordinator.emit_subagent_event(
            session_id=self.session_id,
            plan_step_id=self.plan_step_id,
            subagent="documentation",
            status="completed",
            payload={"answer": "A"},
        )
        await self.coordinator.emit_step_completed(
            session_id=self.session_id,
            plan_step_id=self.plan_step_id,
            status="success",
        )

        mux = StreamMux(
            self.coordinator,
            heartbeat_interval=1.0,
            max_batch_size=5,
            flush_interval=0.1,
        )

        messages = []
        async for chunk in mux.stream_sse(
            session_id=self.session_id,
            plan_step_id=self.plan_step_id,
            last_event_id="1",
        ):
            messages.append(chunk)

        parsed = _parse_sse_messages(messages)
        self.assertEqual(len(parsed), 1)
        batch = parsed[0]
        self.assertEqual(batch["event"], "planner_stream")
        self.assertEqual(batch["data"]["batch_sequence"], 3)

        sequences = [event["sequence"] for event in batch["data"]["events"]]
        self.assertEqual(sequences, [2, 3])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()

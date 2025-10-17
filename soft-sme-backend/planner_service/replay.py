"""Replay store for planner stream events."""

from __future__ import annotations

from bisect import bisect_left
from collections import defaultdict
from threading import RLock
from typing import Dict, Iterable, List, Optional, Tuple

from .schemas import PlannerStreamEvent


class ReplayStore:
    """In-memory replay cache keyed by ``(session_id, plan_step_id)``."""

    def __init__(self, max_events: int = 200) -> None:
        if max_events <= 0:
            raise ValueError("max_events must be positive")
        self._max_events = max_events
        self._events: Dict[Tuple[str, str], List[PlannerStreamEvent]] = defaultdict(list)
        self._lock = RLock()

    def append_event(self, event: PlannerStreamEvent) -> None:
        """Insert or update an event in sequence order."""

        key = (event.session_id, event.plan_step_id)
        with self._lock:
            events = self._events[key]
            sequences = [existing.sequence for existing in events]
            index = bisect_left(sequences, event.sequence)
            if index < len(events) and events[index].sequence == event.sequence:
                events[index] = event
            else:
                events.insert(index, event)
            overflow = len(events) - self._max_events
            if overflow > 0:
                del events[:overflow]

    def list_events(
        self,
        *,
        session_id: str,
        plan_step_id: str,
        after_sequence: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> Tuple[List[PlannerStreamEvent], bool]:
        """Return cached events newer than ``after_sequence``."""

        key = (session_id, plan_step_id)
        with self._lock:
            events = list(self._events.get(key, ()))

        if after_sequence is not None:
            sequences = [event.sequence for event in events]
            start_index = bisect_left(sequences, after_sequence + 1)
        else:
            start_index = 0

        sliced = events[start_index:]

        has_more = False
        if limit is not None and limit < len(sliced):
            has_more = True
            sliced = sliced[:limit]

        return sliced, has_more

    def clear(self, session_id: Optional[str] = None, plan_step_id: Optional[str] = None) -> None:
        """Clear cached events, optionally scoped to a single plan step."""

        with self._lock:
            if session_id is None:
                self._events.clear()
                return

            key = (session_id, plan_step_id or "")
            if plan_step_id is None:
                # Remove all steps for the session.
                to_remove = [stored_key for stored_key in self._events if stored_key[0] == session_id]
                for stored_key in to_remove:
                    self._events.pop(stored_key, None)
            else:
                self._events.pop(key, None)

    def iter_events(self) -> Iterable[PlannerStreamEvent]:
        """Iterate over all cached events (primarily for diagnostics/tests)."""

        with self._lock:
            for events in self._events.values():
                yield from list(events)


replay_store = ReplayStore()


__all__ = ["ReplayStore", "replay_store"]


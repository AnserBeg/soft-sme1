from datetime import datetime, timezone

from fastapi.testclient import TestClient

from ..main import app
from ..replay import replay_store
from ..schemas import PlannerStreamEvent


client = TestClient(app)


def _append_event(**kwargs) -> None:
    event = PlannerStreamEvent(
        session_id=kwargs.get("session_id", "sess-1"),
        plan_step_id=kwargs.get("plan_step_id", "step-1"),
        sequence=kwargs.get("sequence", 1),
        type=kwargs.get("type", "subagent_result"),
        timestamp=kwargs.get("timestamp", datetime.now(timezone.utc)),
        content=kwargs.get("content", {"status": "in_progress"}),
        telemetry=kwargs.get("telemetry", {}),
    )
    replay_store.append_event(event)


def setup_function() -> None:
    replay_store.clear()


def teardown_function() -> None:
    replay_store.clear()


def test_replay_endpoint_returns_empty_payload_when_no_events() -> None:
    response = client.get("/planner/sessions/sess-1/steps/step-1/events")

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == "sess-1"
    assert payload["plan_step_id"] == "step-1"
    assert payload["events"] == []
    assert payload["next_cursor"] is None
    assert payload["has_more"] is False


def test_replay_endpoint_orders_and_filters_events() -> None:
    _append_event(sequence=3, content={"status": "completed"})
    _append_event(sequence=1, content={"status": "pending"})
    _append_event(sequence=2, content={"status": "in_progress"})

    response = client.get("/planner/sessions/sess-1/steps/step-1/events")

    assert response.status_code == 200
    events = response.json()["events"]
    assert [event["sequence"] for event in events] == [1, 2, 3]
    assert response.json()["next_cursor"] == "3"

    filtered = client.get("/planner/sessions/sess-1/steps/step-1/events", params={"after": "2"})
    assert filtered.status_code == 200
    filtered_events = filtered.json()["events"]
    assert len(filtered_events) == 1
    assert filtered_events[0]["sequence"] == 3


def test_replay_endpoint_enforces_integer_cursor() -> None:
    response = client.get(
        "/planner/sessions/sess-1/steps/step-1/events",
        params={"after": "not-a-number"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "after must be an integer"


def test_replay_endpoint_applies_limit_flag() -> None:
    for idx in range(5):
        _append_event(sequence=idx, content={"status": f"{idx}"})

    response = client.get(
        "/planner/sessions/sess-1/steps/step-1/events",
        params={"limit": 2},
    )

    assert response.status_code == 200
    payload = response.json()
    assert [event["sequence"] for event in payload["events"]] == [0, 1]
    assert payload["has_more"] is True


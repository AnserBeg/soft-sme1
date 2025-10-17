"""FastAPI application exposing the planner service endpoints."""

from __future__ import annotations

import logging
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query

from .policy_engine import PolicyRuleEvaluator, SafetySubject, build_policy_evaluator
from .replay import replay_store
from .schemas import (
    MessageStepPayload,
    PlannerMetadata,
    PlannerRequest,
    PlannerResponse,
    PlannerReplayResponse,
    PlannerStreamEvent,
    PlannerStep,
    PlannerStepType,
    SafetyStepPayload,
)
from .telemetry import telemetry


logger = logging.getLogger("planner_service")

policy_evaluator: PolicyRuleEvaluator = build_policy_evaluator()


app = FastAPI(
    title="Planner Service",
    version="0.1.0",
    description=(
        "Lightweight FastAPI wrapper that will orchestrate planner calls for the multi-agent upgrade. "
        "The current implementation returns a stub response so that downstream consumers can integrate "
        "against a stable contract while the planning logic is implemented."
    ),
)


@app.get("/healthz", tags=["health"])
def healthcheck() -> dict[str, str]:
    """Simple health endpoint used by orchestrator readiness probes."""

    return {"status": "ok"}


@app.post("/plan", response_model=PlannerResponse, tags=["planning"])
def generate_plan(request: PlannerRequest) -> PlannerResponse:
    """Generate a placeholder plan for the provided conversation input."""

    trace_id = str(uuid4())
    start_time = perf_counter()

    telemetry.plan_request(
        trace_id=trace_id,
        session_id=request.session_id,
        message=request.message,
        context=request.context.model_dump(exclude_none=True),
    )

    try:
        safety_subject = SafetySubject.from_request(request)
        evaluation = policy_evaluator.evaluate(safety_subject)

        safety_step = PlannerStep(
            id=str(uuid4()),
            type=PlannerStepType.SAFETY,
            description="Execute baseline policy checks before fulfilling the request.",
            payload=SafetyStepPayload(
                check_name="default-policy-screen",
                severity=evaluation.severity,
                policy_tags=list(evaluation.policy_tags),
                detected_issues=list(evaluation.detected_issues),
                requires_manual_review=evaluation.requires_manual_review,
                resolution=evaluation.resolution,
                fallback_step=evaluation.fallback_step,
            ),
        )

        placeholder_step = PlannerStep(
            id=str(uuid4()),
            type=PlannerStepType.MESSAGE,
            description="Planner service stub – replace with real planning logic.",
            payload=MessageStepPayload(
                channel="assistant",
                content=(
                    "Planner service is connected, but planning logic has not been implemented yet. "
                    "Echoing the latest utterance for observability."
                ),
                summary="Planner stub reached",
                metadata={"echo": request.message},
            ),
            depends_on=[safety_step.id],
        )

        response_metadata = PlannerMetadata(
            model="stub",
            rationale="Planner skeleton ready for schema contract iteration with safety guardrails.",
        )

        response = PlannerResponse(
            session_id=request.session_id,
            steps=[safety_step, placeholder_step],
            metadata=response_metadata,
        )

        latency_ms = int((perf_counter() - start_time) * 1000)

        telemetry.plan_success(
            trace_id=trace_id,
            session_id=request.session_id,
            latency_ms=latency_ms,
            step_types=[step.type.value for step in response.steps],
            planner_version=response.metadata.version,
            planner_model=response.metadata.model,
        )

        return response
    except Exception as exc:  # pragma: no cover - defensive logging
        latency_ms = int((perf_counter() - start_time) * 1000)
        logger.exception("Planner request failed: session_id=%s", request.session_id)
        telemetry.plan_failure(
            trace_id=trace_id,
            session_id=request.session_id,
            latency_ms=latency_ms,
            error=str(exc),
        )
        raise


@app.get(
    "/planner/sessions/{session_id}/steps/{plan_step_id}/events",
    response_model=PlannerReplayResponse,
    tags=["planning"],
)
def replay_events(
    session_id: str,
    plan_step_id: str,
    after: str | None = Query(
        default=None,
        description="Optional cursor; events with sequence greater than this value are returned.",
    ),
    limit: int = Query(
        default=100,
        ge=1,
        le=500,
        description="Maximum number of events to return in a single response.",
    ),
) -> PlannerReplayResponse:
    """Return cached planner events for reconnecting clients."""

    after_sequence: int | None = None
    if after is not None:
        try:
            after_sequence = int(after)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="after must be an integer") from exc

    events, has_more = replay_store.list_events(
        session_id=str(session_id),
        plan_step_id=str(plan_step_id),
        after_sequence=after_sequence,
        limit=limit,
    )

    next_cursor: str | None = None
    if events:
        next_cursor = str(events[-1].sequence)
    elif after is not None:
        next_cursor = after

    return PlannerReplayResponse(
        session_id=str(session_id),
        plan_step_id=str(plan_step_id),
        events=[PlannerStreamEvent.model_validate(event) for event in events],
        next_cursor=next_cursor,
        has_more=has_more,
    )


__all__ = ["app", "generate_plan"]

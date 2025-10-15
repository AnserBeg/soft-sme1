"""FastAPI application exposing the planner service endpoints."""

from __future__ import annotations

import logging
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI

from .schemas import (
    MessageStepPayload,
    PlannerMetadata,
    PlannerRequest,
    PlannerResponse,
    PlannerStep,
    PlannerStepType,
    SafetySeverity,
    SafetyStepPayload,
)
from .telemetry import telemetry


logger = logging.getLogger("planner_service")

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
        safety_step = PlannerStep(
            id=str(uuid4()),
            type=PlannerStepType.SAFETY,
            description="Execute baseline policy checks before fulfilling the request.",
            payload=SafetyStepPayload(
                check_name="default-policy-screen",
                severity=SafetySeverity.INFO,
                policy_tags=["baseline"],
                detected_issues=[],
                requires_manual_review=False,
                resolution="No policy violations detected; proceed with response.",
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


__all__ = ["app", "generate_plan"]

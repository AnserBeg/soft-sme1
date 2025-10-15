"""FastAPI application exposing the planner service endpoints."""

from __future__ import annotations

from uuid import uuid4

from fastapi import FastAPI

from .schemas import PlannerMetadata, PlannerRequest, PlannerResponse, PlannerStep

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

    placeholder_step = PlannerStep(
        id=str(uuid4()),
        type="message",
        description="Planner service stub – replace with real planning logic.",
        payload={
            "summary": "Planner service is connected, but planning logic has not been implemented yet.",
            "echo": request.message,
        },
    )

    response_metadata = PlannerMetadata(
        model="stub", rationale="Planner skeleton ready for schema contract iteration."
    )

    return PlannerResponse(session_id=request.session_id, steps=[placeholder_step], metadata=response_metadata)


__all__ = ["app", "generate_plan"]

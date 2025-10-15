"""Pydantic models describing planner service request and response contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class PlannerContext(BaseModel):
    """Optional context provided by the orchestrator when asking for a plan."""

    company_id: Optional[int] = Field(default=None, description="Tenant/company identifier if available.")
    user_id: Optional[int] = Field(default=None, description="User requesting the plan.")
    locale: Optional[str] = Field(default=None, description="Locale hint that may impact tool selection or copy.")


class PlannerStep(BaseModel):
    """Represents a single step in a generated plan."""

    id: str = Field(..., description="Stable identifier for correlating downstream telemetry events.")
    type: Literal["tool", "message", "lookup"] = Field(
        ..., description="Planner step classification used by the orchestrator pipeline."
    )
    description: str = Field(..., description="Short natural language summary of the action to perform.")
    payload: Dict[str, Any] = Field(
        default_factory=dict,
        description="Arbitrary structured payload that downstream subagents can interpret.",
    )
    depends_on: List[str] = Field(
        default_factory=list,
        description="Optional list of step IDs that must be completed before this step executes.",
    )


class PlannerRequest(BaseModel):
    """Schema describing inputs sent to the planner service."""

    session_id: int = Field(..., description="Conversation session identifier from the orchestrator.")
    message: str = Field(..., description="Latest user utterance requiring planning.")
    context: PlannerContext = Field(default_factory=PlannerContext, description="Additional metadata for planning.")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="When the planner request was emitted.")


class PlannerMetadata(BaseModel):
    """Additional metadata about a generated plan used for analytics."""

    model: Optional[str] = Field(default=None, description="Model or strategy identifier used to generate the plan.")
    rationale: Optional[str] = Field(default=None, description="High level reasoning trace for debugging.")
    version: str = Field(default="0.1", description="Planner schema version.")


class PlannerResponse(BaseModel):
    """Response returned by the planner service to the orchestrator."""

    session_id: int = Field(..., description="Echo of the request session identifier.")
    steps: List[PlannerStep] = Field(default_factory=list, description="Ordered list of steps the orchestrator should follow.")
    metadata: PlannerMetadata = Field(default_factory=PlannerMetadata, description="Planner level metadata for analytics.")


__all__ = [
    "PlannerContext",
    "PlannerStep",
    "PlannerRequest",
    "PlannerMetadata",
    "PlannerResponse",
]

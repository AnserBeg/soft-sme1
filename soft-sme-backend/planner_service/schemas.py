"""Pydantic models describing planner service request and response contracts."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field, model_validator


class PlannerContext(BaseModel):
    """Optional context provided by the orchestrator when asking for a plan."""

    company_id: Optional[int] = Field(default=None, description="Tenant/company identifier if available.")
    user_id: Optional[int] = Field(default=None, description="User requesting the plan.")
    locale: Optional[str] = Field(default=None, description="Locale hint that may impact tool selection or copy.")


class PlannerStepType(str, Enum):
    """Enumeration of supported planner step categories."""

    TOOL = "tool"
    MESSAGE = "message"
    LOOKUP = "lookup"
    ACTION = "action"
    SAFETY = "safety"


class ToolStepPayload(BaseModel):
    """Payload for invoking a downstream tool or workflow."""

    tool_name: str = Field(..., description="Registered tool identifier to invoke.")
    arguments: Dict[str, Any] = Field(
        default_factory=dict,
        description="Structured arguments that will be forwarded to the tool invocation.",
    )
    result_key: Optional[str] = Field(
        default=None,
        description=(
            "Optional key used by downstream steps to reference the observation emitted by this tool."
        ),
    )
    escalate_on_failure: bool = Field(
        default=False,
        description="Whether the orchestrator should short-circuit on tool errors instead of attempting recovery.",
    )


class MessageStepPayload(BaseModel):
    """Payload for emitting a message back to the user or UI."""

    channel: Literal["assistant", "system", "user"] = Field(
        ...,
        description="Logical channel that should display the message.",
    )
    content: str = Field(..., description="Message body that will be rendered in the conversation UI.")
    summary: Optional[str] = Field(
        default=None, description="Optional short summary for analytics and notifications."
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Arbitrary key/value metadata preserved for telemetry or UI hints.",
    )


class LookupStepPayload(BaseModel):
    """Payload for knowledge or data lookups executed by subagents."""

    query: str = Field(..., description="Canonical query or question to execute against the target system.")
    target: Literal["knowledge_base", "database", "api"] = Field(
        ...,
        description="Downstream target that should satisfy the lookup request.",
    )
    filters: Dict[str, Any] = Field(
        default_factory=dict,
        description="Additional filters that scope the lookup domain.",
    )
    result_key: Optional[str] = Field(
        default=None,
        description="Optional key allowing later steps to reference lookup results.",
    )


class ActionStepPayload(BaseModel):
    """Payload for dispatching workflow actions handled by dedicated subagents."""

    action_name: str = Field(..., description="Canonical action or workflow identifier.")
    parameters: Dict[str, Any] = Field(
        default_factory=dict,
        description="Structured parameters supplied to the workflow executor.",
    )
    execution_mode: Literal["queue", "sync", "manual"] = Field(
        default="queue",
        description=(
            "Execution strategy requested by the planner. `queue` enqueues background work,"
            " `sync` attempts immediate execution when available, and `manual` records"
            " a human follow-up task."
        ),
    )
    result_key: Optional[str] = Field(
        default=None,
        description="Optional key allowing later steps to reference execution output.",
    )
    conversation_id: Optional[str] = Field(
        default=None,
        description="Conversation identifier to correlate background tasks or direct invocations.",
    )


class SafetySeverity(str, Enum):
    """Severity levels emitted by the safety/policy subagent."""

    INFO = "info"
    WARN = "warn"
    BLOCK = "block"


class SafetyStepPayload(BaseModel):
    """Payload describing safety or policy evaluation outcomes."""

    check_name: str = Field(
        ..., description="Identifier for the policy or guardrail check that was executed."
    )
    severity: SafetySeverity = Field(
        default=SafetySeverity.INFO,
        description="Highest severity observed during evaluation.",
    )
    policy_tags: List[str] = Field(
        default_factory=list,
        description="Policy or guardrail tags associated with the detected issues.",
    )
    detected_issues: List[str] = Field(
        default_factory=list,
        description="Human-readable descriptions of any violations that were found.",
    )
    requires_manual_review: bool = Field(
        default=False,
        description="Whether the orchestrator must route to a human for follow-up.",
    )
    resolution: Optional[str] = Field(
        default=None,
        description="Optional guidance for downstream handlers when issues are detected.",
    )
    fallback_step: Optional[str] = Field(
        default=None,
        description="Optional plan step identifier to execute when the request is blocked.",
    )


PlannerStepPayload = Union[
    ToolStepPayload,
    MessageStepPayload,
    LookupStepPayload,
    ActionStepPayload,
    SafetyStepPayload,
]


class PlannerStep(BaseModel):
    """Represents a single step in a generated plan."""

    id: str = Field(..., description="Stable identifier for correlating downstream telemetry events.")
    type: PlannerStepType = Field(
        ..., description="Planner step classification used by the orchestrator pipeline."
    )
    description: str = Field(..., description="Short natural language summary of the action to perform.")
    payload: PlannerStepPayload = Field(
        ..., description="Structured payload that downstream subagents can interpret.",
    )
    depends_on: List[str] = Field(
        default_factory=list,
        description="Optional list of step IDs that must be completed before this step executes.",
    )

    @model_validator(mode="after")
    def _validate_payload_alignment(self) -> "PlannerStep":
        """Ensure the payload model matches the declared step type."""

        expected_payload = {
            PlannerStepType.TOOL: ToolStepPayload,
            PlannerStepType.MESSAGE: MessageStepPayload,
            PlannerStepType.LOOKUP: LookupStepPayload,
            PlannerStepType.ACTION: ActionStepPayload,
            PlannerStepType.SAFETY: SafetyStepPayload,
        }

        payload_model = expected_payload[self.type]
        if not isinstance(self.payload, payload_model):
            # Pydantic may supply a raw dict during validation. We attempt coercion before failing.
            self.payload = payload_model.model_validate(self.payload)  # type: ignore[assignment]

        return self


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
    version: str = Field(default="0.3", description="Planner schema version.")


class PlannerResponse(BaseModel):
    """Response returned by the planner service to the orchestrator."""

    session_id: int = Field(..., description="Echo of the request session identifier.")
    steps: List[PlannerStep] = Field(default_factory=list, description="Ordered list of steps the orchestrator should follow.")
    metadata: PlannerMetadata = Field(default_factory=PlannerMetadata, description="Planner level metadata for analytics.")


__all__ = [
    "PlannerContext",
    "PlannerStepType",
    "ToolStepPayload",
    "MessageStepPayload",
    "LookupStepPayload",
    "ActionStepPayload",
    "SafetySeverity",
    "SafetyStepPayload",
    "PlannerStepPayload",
    "PlannerStep",
    "PlannerRequest",
    "PlannerMetadata",
    "PlannerResponse",
]

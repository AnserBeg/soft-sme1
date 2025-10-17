"""Tests covering the planner safety step payload contract."""

from __future__ import annotations

from ..schemas import (
    PlannerResponse,
    PlannerStep,
    PlannerStepType,
    SafetySeverity,
)


def test_safety_step_payload_coercion() -> None:
    """PlannerStep should coerce dict payloads into SafetyStepPayload models."""

    step = PlannerStep(
        id="safety-1",
        type=PlannerStepType.SAFETY,
        description="Run baseline policy checks",
        payload={
            "check_name": "default-policy-screen",
            "severity": "warn",
            "policy_tags": ["baseline", "p0"],
            "detected_issues": ["Contains sensitive credential"],
            "requires_manual_review": True,
            "resolution": "Escalate to security reviewer.",
            "fallback_step": "notify-security",
        },
    )

    assert step.payload.check_name == "default-policy-screen"
    assert step.payload.severity is SafetySeverity.WARN
    assert step.payload.requires_manual_review is True
    assert step.payload.fallback_step == "notify-security"


def test_response_accepts_safety_step() -> None:
    """PlannerResponse should round-trip safety steps for downstream orchestrators."""

    response = PlannerResponse.model_validate(
        {
            "session_id": 42,
            "steps": [
                {
                    "id": "safety-1",
                    "type": "safety",
                    "description": "Execute policy checks",
                    "payload": {
                        "check_name": "default",
                        "severity": "info",
                        "policy_tags": [],
                        "detected_issues": [],
                        "requires_manual_review": False,
                    },
                    "depends_on": [],
                }
            ],
        }
    )

    assert response.steps[0].type is PlannerStepType.SAFETY
    assert response.steps[0].payload.severity is SafetySeverity.INFO
    assert response.metadata.version == "0.3"


def test_planner_action_payload_validation() -> None:
    """Planner action steps should coerce payloads into PlannerActionStepPayload."""

    step = PlannerStep(
        id="react-1",
        type=PlannerStepType.PLANNER_ACTION,
        description="Kick off reasoning phase",
        payload={
            "action": "reason",
            "hint": "Focus on documentation accuracy",
            "preferred_tool": "documentation_subagent",
            "result_key": "thought-1",
        },
    )

    assert step.payload.action == "reason"
    assert step.payload.hint == "Focus on documentation accuracy"
    assert step.payload.preferred_tool == "documentation_subagent"
    assert step.payload.result_key == "thought-1"

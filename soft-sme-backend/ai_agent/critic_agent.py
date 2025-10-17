"""Heuristic critic agent that reviews high-risk conversations."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from functools import partial
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

from .analytics_sink import AnalyticsSink
from .conversation_manager import ConversationManager

logger = logging.getLogger(__name__)

_RISK_ORDER = {"low": 0, "normal": 1, "medium": 1, "elevated": 2, "high": 3, "critical": 4}


@dataclass(slots=True)
class CriticFeedback:
    """Structured review payload returned by the critic agent."""

    risk_level: str
    requires_revision: bool
    summary: str
    recommendation: str
    issues: List[Dict[str, Any]] = field(default_factory=list)
    impacted_tools: List[Dict[str, Any]] = field(default_factory=list)
    revision_instructions: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "risk_level": self.risk_level,
            "requires_revision": self.requires_revision,
            "summary": self.summary,
            "recommendation": self.recommendation,
            "issues": list(self.issues),
            "impacted_tools": list(self.impacted_tools),
            "revision_instructions": self.revision_instructions,
            "metadata": dict(self.metadata),
        }


class CriticAgent:
    """Applies deterministic checks to flag risky tool executions."""

    def __init__(
        self,
        *,
        analytics_sink: Optional[AnalyticsSink] = None,
        conversation_manager: Optional[ConversationManager] = None,
        minimum_risk: str = "high",
    ) -> None:
        self._analytics = analytics_sink or AnalyticsSink()
        self._conversation_manager = conversation_manager or ConversationManager()
        self._minimum_risk = self._normalize_risk(minimum_risk)

    async def review(
        self,
        *,
        conversation_id: Optional[str],
        user_message: str,
        final_response: str,
        actions_summary: Optional[Mapping[str, Any]],
        planner_plan: Optional[Mapping[str, Any]],
        safety_results: Sequence[Mapping[str, Any]],
        gathered_info: Mapping[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """Produce a critic review when risk thresholds are exceeded."""

        risk_level = self._derive_risk_level(planner_plan, safety_results, actions_summary)
        if _RISK_ORDER[risk_level] < _RISK_ORDER[self._minimum_risk]:
            logger.debug("Critic review skipped because risk %s < minimum %s", risk_level, self._minimum_risk)
            return None

        issues = self._collect_issues(actions_summary, safety_results, gathered_info)
        if not issues:
            logger.debug("Critic review skipped because no actionable issues were detected")
            return None

        impacted_tools = self._build_impacted_tools(issues)
        requires_revision = any(issue.get("severity") in {"high", "critical"} for issue in issues)
        summary = self._compose_summary(risk_level, issues)
        recommendation = self._compose_recommendation(issues)
        revision_instructions = self._compose_revision_instructions(issues, final_response)

        feedback = CriticFeedback(
            risk_level=risk_level,
            requires_revision=requires_revision,
            summary=summary,
            recommendation=recommendation,
            issues=issues,
            impacted_tools=impacted_tools,
            revision_instructions=revision_instructions,
            metadata={
                "user_message": user_message,
                "final_response_preview": final_response[:500],
            },
        )

        await self._analytics.log_event(
            "critic_review",
            conversation_id=conversation_id,
            status="requires_revision" if requires_revision else "noted",
            metadata={
                "risk_level": risk_level,
                "issue_count": len(issues),
                "requires_revision": requires_revision,
            },
        )

        if conversation_id:
            await self._persist_reflection(conversation_id, feedback)

        return feedback.to_dict()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _derive_risk_level(
        self,
        planner_plan: Optional[Mapping[str, Any]],
        safety_results: Sequence[Mapping[str, Any]],
        actions_summary: Optional[Mapping[str, Any]],
    ) -> str:
        highest = "normal"
        for safety in safety_results:
            severity = self._normalize_risk(str(safety.get("severity", "")))
            if _RISK_ORDER[severity] > _RISK_ORDER[highest]:
                highest = severity

        if planner_plan and isinstance(planner_plan.get("steps"), Iterable):
            for step in planner_plan.get("steps", []):
                if not isinstance(step, Mapping):
                    continue
                payload = step.get("payload") if isinstance(step.get("payload"), Mapping) else {}
                step_risk = self._normalize_risk(
                    str(
                        step.get("risk_level")
                        or payload.get("risk_level")
                        or payload.get("risk")
                        or step.get("severity")
                        or ""
                    )
                )
                if _RISK_ORDER[step_risk] > _RISK_ORDER[highest]:
                    highest = step_risk

        if actions_summary:
            for action in actions_summary.get("actions", []):
                if not isinstance(action, Mapping):
                    continue
                status = str(action.get("status") or "").lower()
                if status in {"error", "failed", "manual"}:
                    highest = self._promote(highest, "high")
        return highest

    def _collect_issues(
        self,
        actions_summary: Optional[Mapping[str, Any]],
        safety_results: Sequence[Mapping[str, Any]],
        gathered_info: Mapping[str, Any],
    ) -> List[Dict[str, Any]]:
        issues: List[Dict[str, Any]] = []

        if actions_summary:
            for action in actions_summary.get("actions", []):
                if not isinstance(action, Mapping):
                    continue
                status = str(action.get("status") or "").lower()
                if status in {"error", "failed"} or action.get("success") is False:
                    issues.append(
                        {
                            "source": "action_workflow",
                            "severity": "high",
                            "description": action.get("message")
                            or f"Workflow {action.get('tool')} reported a failure.",
                            "tool": action.get("tool") or "action_workflow_subagent",
                        }
                    )
                elif status == "manual":
                    issues.append(
                        {
                            "source": "action_workflow",
                            "severity": "medium",
                            "description": action.get("message")
                            or f"Workflow {action.get('tool')} requires manual completion.",
                            "tool": action.get("tool") or "action_workflow_subagent",
                        }
                    )

        for safety in safety_results:
            severity = self._normalize_risk(str(safety.get("severity") or ""))
            detected = safety.get("detected_issues")
            description = ", ".join(str(item) for item in detected) if detected else safety.get("description")
            issues.append(
                {
                    "source": "safety",
                    "severity": severity,
                    "description": description or "Safety subagent flagged the request.",
                    "requires_manual_review": bool(safety.get("requires_manual_review")),
                    "policy_tags": list(safety.get("policy_tags", [])) if isinstance(safety.get("policy_tags"), Sequence) else [],
                }
            )

        critic_reflections = gathered_info.get("reflections")
        if isinstance(critic_reflections, Sequence):
            for reflection in critic_reflections:
                if not isinstance(reflection, Mapping):
                    continue
                issues.append(dict(reflection))

        return issues

    def _build_impacted_tools(self, issues: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
        impacted: List[Dict[str, Any]] = []
        for issue in issues:
            tool_name = str(issue.get("tool") or "")
            if not tool_name:
                if issue.get("source") == "safety":
                    tool_name = "action_workflow_subagent"
                else:
                    continue
            severity = str(issue.get("severity") or "medium").lower()
            weight = 0.3 if severity == "medium" else 0.6 if severity == "high" else 0.9 if severity == "critical" else 0.2
            impacted.append(
                {
                    "name": tool_name,
                    "success": False,
                    "weight": weight,
                    "reason": issue.get("description"),
                    "source": issue.get("source"),
                }
            )
        return impacted

    def _compose_summary(self, risk_level: str, issues: Sequence[Mapping[str, Any]]) -> str:
        headline = f"Critic review captured {len(issues)} issue(s) at {risk_level} risk."
        top_issue = next((issue.get("description") for issue in issues if issue.get("description")), None)
        if top_issue:
            return f"{headline} Top finding: {top_issue}".strip()
        return headline

    def _compose_recommendation(self, issues: Sequence[Mapping[str, Any]]) -> str:
        if any(issue.get("severity") in {"high", "critical"} for issue in issues):
            return "Escalate to a human reviewer and avoid executing additional automated workflows until resolved."
        if any(issue.get("source") == "safety" for issue in issues):
            return "Verify policy compliance before continuing and confirm the outcome with the requester."
        return "Confirm the workflow result with the requester before closing out the task."

    def _compose_revision_instructions(
        self,
        issues: Sequence[Mapping[str, Any]],
        final_response: str,
    ) -> str:
        instructions: List[str] = []
        for issue in issues:
            description = issue.get("description")
            if not description:
                continue
            instructions.append(f"- Address: {description}")
        if not instructions:
            instructions.append("- Double-check that the response reflects the latest workflow status.")
        if len(final_response) > 500:
            instructions.append("- The original reply was lengthy; provide a concise corrective summary.")
        return "\n".join(instructions)

    async def _persist_reflection(self, conversation_id: str, feedback: CriticFeedback) -> None:
        loop = asyncio.get_running_loop()
        metadata = dict(feedback.metadata)
        metadata.setdefault("issues", feedback.issues)

        try:
            await loop.run_in_executor(
                None,
                partial(
                    self._conversation_manager.record_reflection,
                    conversation_id,
                    trigger="critic_agent",
                    summary=feedback.summary,
                    risk_level=feedback.risk_level,
                    recommendation=feedback.recommendation,
                    requires_revision=feedback.requires_revision,
                    impacted_tools=[tool.get("name") for tool in feedback.impacted_tools],
                    metadata=metadata,
                ),
            )
        except Exception as exc:  # pragma: no cover - defensive guard
            logger.debug("Failed to store critic reflection metadata for %s: %s", conversation_id, exc)

    def _normalize_risk(self, value: str) -> str:
        normalized = value.lower()
        return normalized if normalized in _RISK_ORDER else "normal"

    def _promote(self, current: str, candidate: str) -> str:
        current_norm = self._normalize_risk(current)
        candidate_norm = self._normalize_risk(candidate)
        return candidate_norm if _RISK_ORDER[candidate_norm] > _RISK_ORDER[current_norm] else current_norm


__all__ = ["CriticAgent", "CriticFeedback"]

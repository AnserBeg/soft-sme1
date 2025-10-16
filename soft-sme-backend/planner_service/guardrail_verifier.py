"""Guardrail LLM verifier integration for the safety subagent."""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Dict, Mapping, Optional, Protocol, Sequence, Tuple

import requests

from .schemas import SafetySeverity

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .policy_engine import PolicyEvaluationResult, PolicyRule, SafetySubject

logger = logging.getLogger("planner_service.guardrail_verifier")


class GuardrailVerifierError(RuntimeError):
    """Base exception raised when the guardrail verifier cannot complete."""


@dataclass(frozen=True)
class GuardrailVerification:
    """Structured response returned by a guardrail verifier invocation."""

    check_name: str
    severity: SafetySeverity
    policy_tags: Tuple[str, ...] = field(default_factory=tuple)
    detected_issues: Tuple[str, ...] = field(default_factory=tuple)
    requires_manual_review: bool = False
    resolution: Optional[str] = None
    fallback_step: Optional[str] = None
    metadata: Mapping[str, Any] = field(default_factory=dict)


class GuardrailVerifier(Protocol):
    """Interface for integrating LLM guardrail verifiers."""

    def verify(
        self,
        subject: "SafetySubject",
        baseline: "PolicyEvaluationResult",
        matched_rules: Sequence["PolicyRule"],
    ) -> Optional[GuardrailVerification]:
        """Execute the verifier and return structured policy guidance."""


@dataclass
class NoOpGuardrailVerifier:
    """A verifier that leaves baseline policy decisions untouched."""

    def verify(
        self,
        subject: "SafetySubject",
        baseline: "PolicyEvaluationResult",
        matched_rules: Sequence["PolicyRule"],
    ) -> Optional[GuardrailVerification]:
        return None


@dataclass
class LLMGuardrailVerifier:
    """Call an external LLM verifier endpoint with structured retries."""

    endpoint: str
    api_key: Optional[str] = None
    timeout_seconds: float = 6.0
    max_retries: int = 2
    backoff_seconds: float = 0.5
    session: requests.Session = field(default_factory=requests.Session)

    def verify(
        self,
        subject: "SafetySubject",
        baseline: "PolicyEvaluationResult",
        matched_rules: Sequence["PolicyRule"],
    ) -> Optional[GuardrailVerification]:
        payload = self._build_payload(subject, baseline, matched_rules)
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        attempt = 0
        last_error: Optional[Exception] = None

        while attempt <= self.max_retries:
            try:
                response = self.session.post(
                    self.endpoint,
                    data=json.dumps(payload),
                    headers=headers,
                    timeout=self.timeout_seconds,
                )
                response.raise_for_status()
                data = response.json()
                verification = self._parse_response(data)
                logger.debug(
                    "Guardrail verifier succeeded: severity=%s, tags=%s",
                    verification.severity.value,
                    ",".join(verification.policy_tags),
                )
                return verification
            except Exception as exc:  # pragma: no cover - network variability
                last_error = exc
                logger.warning(
                    "Guardrail verifier attempt %s failed: %s", attempt + 1, exc
                )
                if attempt == self.max_retries:
                    break
                time.sleep(self.backoff_seconds * (attempt + 1))
                attempt += 1

        if last_error:
            raise GuardrailVerifierError(str(last_error)) from last_error
        raise GuardrailVerifierError("Guardrail verifier failed without exception")

    def _build_payload(
        self,
        subject: SafetySubject,
        baseline: PolicyEvaluationResult,
        matched_rules: Sequence[PolicyRule],
    ) -> Dict[str, Any]:
        return {
            "subject": {
                "company_id": subject.company_id,
                "user_id": subject.user_id,
                "message": subject.message,
                "planner_summary": subject.planner_summary,
                "pending_action_slugs": subject.pending_action_slugs,
                "locale": subject.locale,
            },
            "baseline": {
                "check_name": baseline.check_name,
                "severity": baseline.severity.value,
                "policy_tags": baseline.policy_tags,
                "detected_issues": baseline.detected_issues,
                "requires_manual_review": baseline.requires_manual_review,
                "resolution": baseline.resolution,
                "fallback_step": baseline.fallback_step,
            },
            "matched_rules": [
                {
                    "name": rule.name,
                    "severity": rule.severity.value,
                    "policy_tags": rule.policy_tags,
                    "message": rule.message,
                    "resolution": rule.resolution,
                    "requires_manual_review": rule.requires_manual_review,
                    "fallback_step": rule.fallback_step,
                }
                for rule in matched_rules
            ],
        }

    def _parse_response(self, payload: Mapping[str, Any]) -> GuardrailVerification:
        try:
            severity = SafetySeverity(str(payload["severity"]).lower())
        except Exception as exc:  # pragma: no cover - defensive path
            raise GuardrailVerifierError(
                f"Invalid severity returned by guardrail verifier: {payload!r}"
            ) from exc

        policy_tags = tuple(payload.get("policy_tags") or ())
        detected_issues = tuple(payload.get("detected_issues") or ())
        requires_manual_review = bool(payload.get("requires_manual_review", False))
        resolution = payload.get("resolution")
        fallback_step = payload.get("fallback_step")
        check_name = str(payload.get("check_name") or "llm-guardrail")
        metadata = payload.get("metadata") or {}

        return GuardrailVerification(
            check_name=check_name,
            severity=severity,
            policy_tags=policy_tags,
            detected_issues=detected_issues,
            requires_manual_review=requires_manual_review,
            resolution=resolution,
            fallback_step=fallback_step,
            metadata=metadata,
        )


def build_guardrail_verifier() -> GuardrailVerifier:
    """Instantiate a guardrail verifier based on environment configuration."""

    endpoint = os.getenv("GUARDRAIL_VERIFIER_URL")
    if not endpoint:
        logger.info("Guardrail verifier disabled; using no-op implementation")
        return NoOpGuardrailVerifier()

    api_key = os.getenv("GUARDRAIL_VERIFIER_API_KEY")
    timeout = float(os.getenv("GUARDRAIL_VERIFIER_TIMEOUT", "6.0"))
    max_retries = int(os.getenv("GUARDRAIL_VERIFIER_RETRIES", "2"))
    backoff = float(os.getenv("GUARDRAIL_VERIFIER_BACKOFF", "0.5"))

    logger.info(
        "Guardrail verifier enabled: endpoint=%s retries=%s timeout=%s", endpoint, max_retries, timeout
    )
    return LLMGuardrailVerifier(
        endpoint=endpoint,
        api_key=api_key,
        timeout_seconds=timeout,
        max_retries=max_retries,
        backoff_seconds=backoff,
    )


__all__ = [
    "GuardrailVerification",
    "GuardrailVerifier",
    "GuardrailVerifierError",
    "LLMGuardrailVerifier",
    "NoOpGuardrailVerifier",
    "build_guardrail_verifier",
]

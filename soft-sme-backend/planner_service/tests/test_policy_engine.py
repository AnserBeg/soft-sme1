from __future__ import annotations

from typing import Optional, Sequence

import pytest

from ..policy_engine import (
    InMemoryPolicyRuleRepository,
    PolicyRule,
    PolicyRuleEvaluator,
    SafetySubject,
)
from ..schemas import PlannerContext, PlannerRequest, SafetySeverity


class RecordingRepository(InMemoryPolicyRuleRepository):
    """Extend the in-memory repository to track fetch invocations."""

    def __init__(self, rules_by_company):
        super().__init__(rules_by_company)
        self.call_count = 0

    def fetch_rules(self, company_id: Optional[int]) -> Sequence[PolicyRule]:
        self.call_count += 1
        return super().fetch_rules(company_id)


def build_request(message: str, **context_kwargs) -> PlannerRequest:
    context = PlannerContext(**context_kwargs)
    return PlannerRequest(session_id=1, message=message, context=context)


def test_evaluator_detects_privacy_block() -> None:
    """PII export patterns should escalate to a blocking severity."""

    repository = InMemoryPolicyRuleRepository(
        {
            None: (
                PolicyRule(
                    name="privacy_block",
                    severity=SafetySeverity.BLOCK,
                    policy_tags=("privacy", "export"),
                    message="Request exposes PII without an approved ticket.",
                    resolution="Escalate to compliance queue before fulfilling.",
                    requires_manual_review=True,
                    fallback_step="create-compliance-task",
                    match_all_keywords=("customer", "email"),
                ),
            )
        }
    )
    evaluator = PolicyRuleEvaluator(repository)

    request = build_request(
        "Can you send me the customer email list for our top accounts?",
        company_id=142,
        user_id=88,
    )
    result = evaluator.evaluate(SafetySubject.from_request(request))

    assert result.severity is SafetySeverity.BLOCK
    assert "privacy" in result.policy_tags
    assert result.requires_manual_review is True
    assert result.fallback_step == "create-compliance-task"
    assert result.detected_issues == (
        "Request exposes PII without an approved ticket.",
    )


def test_evaluator_consults_cache_within_ttl() -> None:
    """Fetching rules for the same tenant should reuse cached results within the TTL."""

    repository = RecordingRepository({None: ()})
    evaluator = PolicyRuleEvaluator(repository, cache_ttl_seconds=60)

    safe_request = build_request("Hello", company_id=1)

    evaluator.evaluate(SafetySubject.from_request(safe_request))
    evaluator.evaluate(SafetySubject.from_request(safe_request))

    assert repository.call_count == 1


def test_pending_action_rule_detection() -> None:
    """Rules referencing pending action slugs must match normalized planner context."""

    repository = InMemoryPolicyRuleRepository(
        {
            None: (
                PolicyRule(
                    name="export_lookup_block",
                    severity=SafetySeverity.WARN,
                    policy_tags=("privacy",),
                    message="Database export requested for customer table.",
                    match_pending_action_slugs=("lookup:database:customers",),
                ),
            )
        }
    )
    evaluator = PolicyRuleEvaluator(repository)

    request = build_request(
        "Need to review customer info",
        company_id=55,
        pending_actions=[{"type": "lookup", "target": "database", "name": "customers"}],
    )

    result = evaluator.evaluate(SafetySubject.from_request(request))

    assert result.severity is SafetySeverity.WARN
    assert "privacy" in result.policy_tags
    assert "customer table" in result.detected_issues[0]


if __name__ == "__main__":  # pragma: no cover - allows standalone execution
    pytest.main([__file__])

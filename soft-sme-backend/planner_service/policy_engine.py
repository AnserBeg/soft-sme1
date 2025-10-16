"""Deterministic policy rule evaluation for the safety subagent."""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Protocol, Sequence, Tuple

from .schemas import PlannerRequest, SafetySeverity

logger = logging.getLogger("planner_service.policy_engine")


_SEVERITY_ORDER = {
    SafetySeverity.INFO: 0,
    SafetySeverity.WARN: 1,
    SafetySeverity.BLOCK: 2,
}


@dataclass(frozen=True)
class PendingAction:
    """Normalized representation of an action awaiting execution."""

    type: str
    target: Optional[str] = None
    name: Optional[str] = None

    @classmethod
    def from_raw(cls, payload: Mapping[str, Any]) -> "PendingAction":
        return cls(
            type=str(payload.get("type", "")) or "unknown",
            target=payload.get("target"),
            name=payload.get("name"),
        )

    @property
    def slug(self) -> str:
        parts = [self.type.lower()]
        if self.target:
            parts.append(str(self.target).lower())
        if self.name:
            parts.append(str(self.name).lower())
        return ":".join(parts)


@dataclass(frozen=True)
class SafetySubject:
    """Normalized input evaluated by policy rules."""

    company_id: Optional[int]
    user_id: Optional[int]
    message: str
    planner_summary: Optional[str]
    pending_actions: Tuple[PendingAction, ...] = field(default_factory=tuple)
    locale: Optional[str] = None

    @classmethod
    def from_request(cls, request: PlannerRequest) -> "SafetySubject":
        pending = tuple(PendingAction.from_raw(action) for action in request.context.pending_actions)
        return cls(
            company_id=request.context.company_id,
            user_id=request.context.user_id,
            message=request.message,
            planner_summary=request.context.planner_summary,
            pending_actions=pending,
            locale=request.context.locale,
        )

    @property
    def text_corpus(self) -> str:
        parts = [self.message]
        if self.planner_summary:
            parts.append(self.planner_summary)
        return " \n".join(part for part in parts if part).lower()

    @property
    def pending_action_slugs(self) -> Tuple[str, ...]:
        return tuple(action.slug for action in self.pending_actions if action.slug)


@dataclass(frozen=True)
class PolicyRule:
    """Deterministic rule describing a guardrail condition."""

    name: str
    severity: SafetySeverity
    policy_tags: Tuple[str, ...] = field(default_factory=tuple)
    message: str = ""
    resolution: Optional[str] = None
    requires_manual_review: bool = False
    fallback_step: Optional[str] = None
    match_all_keywords: Tuple[str, ...] = field(default_factory=tuple)
    match_any_keywords: Tuple[str, ...] = field(default_factory=tuple)
    match_pending_action_slugs: Tuple[str, ...] = field(default_factory=tuple)
    company_allow_list: Tuple[int, ...] = field(default_factory=tuple)
    company_deny_list: Tuple[int, ...] = field(default_factory=tuple)

    def matches(self, subject: SafetySubject) -> bool:
        if self.company_allow_list and (subject.company_id not in self.company_allow_list):
            return False
        if self.company_deny_list and subject.company_id in self.company_deny_list:
            return False

        corpus = subject.text_corpus
        if any(keyword.lower() not in corpus for keyword in self.match_all_keywords):
            return False
        if self.match_any_keywords and not any(
            keyword.lower() in corpus for keyword in self.match_any_keywords
        ):
            return False

        if self.match_pending_action_slugs:
            slugs = subject.pending_action_slugs
            if not any(candidate in slugs for candidate in self.match_pending_action_slugs):
                return False

        return True


@dataclass(frozen=True)
class PolicyEvaluationResult:
    """Aggregate outcome of evaluating the policy ruleset."""

    check_name: str
    severity: SafetySeverity
    policy_tags: Tuple[str, ...]
    detected_issues: Tuple[str, ...]
    requires_manual_review: bool
    resolution: Optional[str]
    fallback_step: Optional[str]


class PolicyRuleRepository(Protocol):
    """Interface for loading policy rules from a storage backend."""

    def fetch_rules(self, company_id: Optional[int]) -> Sequence[PolicyRule]:
        ...


class InMemoryPolicyRuleRepository:
    """Simple repository backed by a dictionary of rules keyed by company ID."""

    def __init__(self, rules_by_company: Mapping[Optional[int], Sequence[PolicyRule]]) -> None:
        self._rules_by_company = {
            key: tuple(rules) for key, rules in rules_by_company.items()
        }

    def fetch_rules(self, company_id: Optional[int]) -> Sequence[PolicyRule]:
        global_rules = self._rules_by_company.get(None, ())
        tenant_rules = self._rules_by_company.get(company_id, ())
        return (*global_rules, *tenant_rules)


class PostgresPolicyRuleRepository:
    """Load policy rules from PostgreSQL with deterministic ordering."""

    def __init__(self, dsn: str) -> None:
        try:  # pragma: no cover - import guarded for optional dependency
            import psycopg  # type: ignore
            from psycopg.rows import dict_row  # type: ignore
        except ImportError as exc:  # pragma: no cover - executed when psycopg not installed
            raise RuntimeError("psycopg is required for PostgresPolicyRuleRepository") from exc

        self._dsn = dsn
        self._psycopg = psycopg
        self._dict_row = dict_row

    def fetch_rules(self, company_id: Optional[int]) -> Sequence[PolicyRule]:  # pragma: no cover - DB access
        with self._psycopg.connect(self._dsn) as conn:
            with conn.cursor(row_factory=self._dict_row) as cur:
                cur.execute(
                    """
                    select
                        name,
                        severity,
                        policy_tags,
                        message,
                        resolution,
                        requires_manual_review,
                        fallback_step,
                        match_all_keywords,
                        match_any_keywords,
                        match_pending_action_slugs,
                        company_allow_list,
                        company_deny_list
                    from ai_guardrails.policy_rules
                    where company_id is null
                       or company_id = %(company_id)s
                    order by priority desc, name
                    """,
                    {"company_id": company_id},
                )
                rows = cur.fetchall()

        rules: List[PolicyRule] = []
        for row in rows:
            rules.append(
                PolicyRule(
                    name=row["name"],
                    severity=SafetySeverity(row["severity"].lower()),
                    policy_tags=tuple(row.get("policy_tags") or ()),
                    message=row.get("message") or "",
                    resolution=row.get("resolution"),
                    requires_manual_review=bool(row.get("requires_manual_review")),
                    fallback_step=row.get("fallback_step"),
                    match_all_keywords=tuple(row.get("match_all_keywords") or ()),
                    match_any_keywords=tuple(row.get("match_any_keywords") or ()),
                    match_pending_action_slugs=tuple(row.get("match_pending_action_slugs") or ()),
                    company_allow_list=tuple(row.get("company_allow_list") or ()),
                    company_deny_list=tuple(row.get("company_deny_list") or ()),
                )
            )
        return tuple(rules)


class PolicyRuleEvaluator:
    """Evaluate planner requests against deterministic policy rules."""

    def __init__(self, repository: PolicyRuleRepository, cache_ttl_seconds: int = 300) -> None:
        self._repository = repository
        self._cache_ttl_seconds = cache_ttl_seconds
        self._cache: Dict[Optional[int], Tuple[float, Sequence[PolicyRule]]] = {}

    def evaluate(self, subject: SafetySubject) -> PolicyEvaluationResult:
        rules = self._load_rules(subject.company_id)
        detected_rules: List[PolicyRule] = []
        for rule in rules:
            if rule.matches(subject):
                detected_rules.append(rule)

        if not detected_rules:
            return PolicyEvaluationResult(
                check_name="default-policy-screen",
                severity=SafetySeverity.INFO,
                policy_tags=("baseline",),
                detected_issues=(),
                requires_manual_review=False,
                resolution="No policy violations detected; proceed with response.",
                fallback_step=None,
            )

        severity = max(detected_rules, key=lambda rule: _SEVERITY_ORDER[rule.severity]).severity
        requires_manual_review = any(rule.requires_manual_review for rule in detected_rules)
        policy_tags: List[str] = ["baseline"]
        issues: List[str] = []
        fallback_step: Optional[str] = None
        resolution: Optional[str] = None

        for rule in detected_rules:
            for tag in rule.policy_tags:
                if tag not in policy_tags:
                    policy_tags.append(tag)
            if rule.message:
                issues.append(rule.message)
            if not fallback_step and rule.fallback_step:
                fallback_step = rule.fallback_step
            if not resolution and rule.resolution:
                resolution = rule.resolution

        if not resolution:
            resolution = "Route to manual review for policy confirmation."

        return PolicyEvaluationResult(
            check_name="default-policy-screen",
            severity=severity,
            policy_tags=tuple(policy_tags),
            detected_issues=tuple(issues),
            requires_manual_review=requires_manual_review,
            resolution=resolution,
            fallback_step=fallback_step,
        )

    def _load_rules(self, company_id: Optional[int]) -> Sequence[PolicyRule]:
        now = time.time()
        cached = self._cache.get(company_id)
        if cached and now - cached[0] < self._cache_ttl_seconds:
            return cached[1]

        rules = self._repository.fetch_rules(company_id)
        self._cache[company_id] = (now, rules)
        logger.debug(
            "Loaded %s policy rules for company_id=%s", len(rules), company_id or "*"
        )
        return rules


def _build_static_repository() -> InMemoryPolicyRuleRepository:
    global_rules = (
        PolicyRule(
            name="privacy_email_export_block",
            severity=SafetySeverity.BLOCK,
            policy_tags=("privacy", "export"),
            message="Request exposes personally identifiable information without an approved ticket.",
            resolution="Escalate to compliance queue before fulfilling.",
            requires_manual_review=True,
            fallback_step="create-compliance-task",
            match_all_keywords=("customer", "email"),
        ),
        PolicyRule(
            name="finance_wire_warn",
            severity=SafetySeverity.WARN,
            policy_tags=("finance",),
            message="Potential financial transfer detected. Confirm dual authorization before proceeding.",
            resolution="Confirm finance approval before executing payment steps.",
            requires_manual_review=False,
            match_any_keywords=("wire transfer", "routing number", "bank account"),
        ),
    )
    return InMemoryPolicyRuleRepository({None: global_rules})


def build_policy_evaluator() -> PolicyRuleEvaluator:
    """Instantiate a PolicyRuleEvaluator using Postgres or static fallbacks."""

    dsn = os.getenv("POLICY_RULES_DSN") or os.getenv("DATABASE_URL")
    repository: PolicyRuleRepository

    if dsn:
        try:
            repository = PostgresPolicyRuleRepository(dsn)
            logger.info("Using Postgres-backed policy rule repository")
        except Exception as exc:  # pragma: no cover - handled during import/connection failures
            logger.warning("Falling back to static policy rules: %s", exc)
            repository = _build_static_repository()
    else:
        repository = _build_static_repository()

    return PolicyRuleEvaluator(repository=repository)


__all__ = [
    "PolicyEvaluationResult",
    "PolicyRule",
    "PolicyRuleEvaluator",
    "SafetySubject",
    "build_policy_evaluator",
]

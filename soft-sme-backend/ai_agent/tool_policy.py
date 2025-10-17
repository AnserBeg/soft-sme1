"""Adaptive tool scoring policy for the orchestration layer.

This module implements a lightweight policy network that keeps rolling
statistics about tool reliability.  The orchestrator consults the policy when
deciding which tools to run during each ReAct loop turn.  Rather than using
hard-coded heuristics alone, we blend historical success metrics, latency
profiles, and planner hints to rank the candidate tools.  The policy is
intentionally simple and deterministic so we can exercise it in unit tests
without requiring the analytics backend.

The design favors robustness over complexity:

* A Bayesian-style prior prevents thrashing when there is little telemetry.
* Recency bias is introduced through a small penalty when the most recent
  invocation failed, which nudges the agent to try alternate tools before
  retrying the same option.
* Planner-suggested tools receive a configurable boost so governance and
  safety checks can direct the orchestrator when necessary.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Mapping, Optional, Sequence


@dataclass
class ToolUsageContext:
    """Context provided when ranking tool candidates."""

    message: str
    conversation_id: Optional[str] = None
    conversation_history_size: int = 0
    planner_suggestions: Sequence[str] = field(default_factory=list)
    risk_level: str = "normal"


@dataclass
class _ToolStats:
    """Rolling statistics tracked for each tool."""

    successes: float = 0.0
    failures: float = 0.0
    total_latency_ms: float = 0.0
    latency_samples: int = 0
    last_failure_ts: Optional[float] = None
    last_success_ts: Optional[float] = None

    def record(
        self,
        *,
        success: bool,
        latency_ms: Optional[float],
        weight: float = 1.0,
    ) -> None:
        weight = max(0.0, float(weight))
        if weight == 0:
            return

        if success:
            self.successes += weight
            self.last_success_ts = time.time()
        else:
            self.failures += weight
            self.last_failure_ts = time.time()

        if latency_ms is not None:
            self.total_latency_ms += max(latency_ms, 0.0)
            self.latency_samples += 1

    @property
    def invocations(self) -> float:
        return self.successes + self.failures

    @property
    def average_latency_ms(self) -> Optional[float]:
        if not self.latency_samples:
            return None
        return self.total_latency_ms / self.latency_samples


class ToolScoringPolicy:
    """Ranks tools using reliability telemetry with Bayesian smoothing."""

    def __init__(
        self,
        *,
        success_prior: float = 0.6,
        failure_prior: float = 0.4,
        latency_target_ms: float = 6000.0,
        recency_penalty: float = 0.15,
        planner_boost: float = 0.2,
    ) -> None:
        if success_prior <= 0 or failure_prior <= 0:
            raise ValueError("Priors must be positive to avoid divide-by-zero issues")

        self._stats: Dict[str, _ToolStats] = {}
        self._success_prior = success_prior
        self._failure_prior = failure_prior
        self._latency_target_ms = max(latency_target_ms, 1.0)
        self._recency_penalty = max(0.0, min(recency_penalty, 0.5))
        self._planner_boost = max(0.0, planner_boost)

    # ------------------------------------------------------------------
    # Telemetry ingestion
    # ------------------------------------------------------------------
    def record_observation(
        self,
        tool_name: str,
        *,
        success: bool,
        latency_ms: Optional[float] = None,
        metadata: Optional[Mapping[str, object]] = None,
        weight: float = 1.0,
    ) -> None:
        """Update rolling statistics for a tool.

        The ``metadata`` parameter is accepted for parity with analytics events
        and to simplify future extensions (e.g., weighting based on risk), but
        it is not currently interpreted.
        """

        if not tool_name:
            return

        stats = self._stats.setdefault(tool_name, _ToolStats())
        stats.record(success=success, latency_ms=latency_ms, weight=weight)

    def apply_reflection_feedback(
        self,
        impacted_tools: Sequence[Mapping[str, object]],
    ) -> None:
        """Adjust tool scores using critic reflections."""

        for entry in impacted_tools:
            if not isinstance(entry, Mapping):
                continue
            name = str(entry.get("name") or entry.get("tool") or "").strip()
            if not name:
                continue
            success_flag = bool(entry.get("success", False))
            weight = entry.get("weight") or entry.get("penalty") or 1.0
            try:
                weight_value = max(0.1, min(float(weight), 5.0))
            except (TypeError, ValueError):
                weight_value = 1.0
            metadata = {"source": "reflection", "reason": entry.get("reason")}
            self.record_observation(
                name,
                success=success_flag,
                latency_ms=None,
                metadata=metadata,
                weight=weight_value,
            )

    # ------------------------------------------------------------------
    # Ranking
    # ------------------------------------------------------------------
    def rank_candidates(
        self,
        candidates: Iterable[str],
        context: Optional[ToolUsageContext] = None,
    ) -> List[str]:
        """Return the candidate tools ordered by descending score."""

        context = context or ToolUsageContext(message="")
        unique_candidates = list(dict.fromkeys(candidate for candidate in candidates if candidate))

        if not unique_candidates:
            return []

        scores: Dict[str, float] = {}
        planner_set = {tool for tool in context.planner_suggestions}

        for tool in unique_candidates:
            score = self._score_tool(tool)

            if tool in planner_set:
                score += self._planner_boost

            # Reserve ``llm_knowledge`` as a safe fallback by shaving a small
            # amount off the score.  This ensures higher-confidence tools run
            # first without removing the fallback entirely.
            if tool == "llm_knowledge":
                score -= 0.05

            # Nudge exploratory tools when the conversation is short to reduce
            # the chance of overfitting to historical data alone.
            if context.conversation_history_size < 2 and tool not in planner_set:
                score += 0.02

            scores[tool] = max(0.0, min(score, 1.0))

        unique_candidates.sort(key=lambda tool: scores.get(tool, 0.0), reverse=True)
        return unique_candidates

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _score_tool(self, tool_name: str) -> float:
        stats = self._stats.get(tool_name)
        if stats is None or stats.invocations == 0:
            # Prior expectation when no telemetry exists yet.
            return self._success_prior / (self._success_prior + self._failure_prior)

        success = stats.successes + self._success_prior
        total = stats.invocations + self._success_prior + self._failure_prior
        success_rate = success / total

        latency_penalty = 1.0
        average_latency = stats.average_latency_ms
        if average_latency:
            ratio = max(0.0, (average_latency - self._latency_target_ms) / self._latency_target_ms)
            latency_penalty -= min(0.3, ratio)

        recency_penalty = 0.0
        if stats.last_failure_ts and (not stats.last_success_ts or stats.last_failure_ts > stats.last_success_ts):
            time_since_failure = time.time() - stats.last_failure_ts
            # The penalty decays over ~5 minutes so flaky tools can recover.
            decay = math.exp(-time_since_failure / 300.0)
            recency_penalty = self._recency_penalty * decay

        score = success_rate * latency_penalty - recency_penalty
        return max(0.0, min(score, 1.0))


__all__ = ["ToolScoringPolicy", "ToolUsageContext"]


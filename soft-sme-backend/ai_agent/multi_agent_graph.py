"""Multi-agent orchestration graph for planner-directed branching."""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from .aggregation import AggregationCoordinator
from .analytics_sink import AnalyticsSink
from .critic_agent import CriticAgent, CriticBranchAssessment
from .subagents.documentation_qa import DocumentationQASubagent, DocumentationQAResult
from .subagents.voice_call import VoiceCallResult, VoiceCallSubagent

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class ResearchTask:
    """Instruction for a specialized research node."""

    task_id: str
    query: str
    tool: str = "documentation"
    result_key: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ResearchFindings:
    """Outcome produced by a research task."""

    task_id: str
    status: str
    summary: Optional[str]
    citations: List[Dict[str, Any]] = field(default_factory=list)
    confidence: float = 0.0
    tool: str = "documentation"
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "task_id": self.task_id,
            "status": self.status,
            "summary": self.summary,
            "citations": list(self.citations),
            "confidence": self.confidence,
            "tool": self.tool,
            "metadata": dict(self.metadata),
        }
        return payload


@dataclass(slots=True)
class BranchOutcome:
    """Aggregated result for a branch."""

    branch_id: str
    status: str
    findings: List[ResearchFindings] = field(default_factory=list)
    executor_result: Dict[str, Any] = field(default_factory=dict)
    voice_result: Optional[Dict[str, Any]] = None
    critic_assessment: Optional[CriticBranchAssessment] = None

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "branch_id": self.branch_id,
            "status": self.status,
            "findings": [finding.to_dict() for finding in self.findings],
            "executor_result": dict(self.executor_result),
        }
        if self.voice_result is not None:
            payload["voice_result"] = dict(self.voice_result)
        if self.critic_assessment is not None:
            payload["critic_assessment"] = self.critic_assessment.to_dict()
        return payload


@dataclass(slots=True)
class GraphRunResult:
    """Return payload for a multi-agent graph run."""

    run_id: str
    status: str
    branches: List[BranchOutcome] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "run_id": self.run_id,
            "status": self.status,
            "branches": [branch.to_dict() for branch in self.branches],
            "metadata": dict(self.metadata),
        }


class MultiAgentGraphRunner:
    """Coordinates planner-authored multi-agent graphs with branching."""

    def __init__(
        self,
        *,
        aggregator: Optional[AggregationCoordinator],
        documentation_subagent: Optional[DocumentationQASubagent],
        sql_tool,
        action_tool,
        voice_subagent: Optional[VoiceCallSubagent],
        critic_agent: Optional[CriticAgent],
        analytics_sink: Optional[AnalyticsSink] = None,
    ) -> None:
        self._aggregator = aggregator
        self._documentation = documentation_subagent
        self._sql_tool = sql_tool
        self._action_tool = action_tool
        self._voice_subagent = voice_subagent
        self._critic = critic_agent
        self._analytics = analytics_sink or AnalyticsSink()

    async def run_graph(
        self,
        *,
        session_id: str,
        plan: Mapping[str, Any],
        conversation_id: Optional[str],
        conversation_history: Optional[Sequence[Mapping[str, Any]]],
    ) -> Optional[GraphRunResult]:
        branches_data = self._extract_branches(plan)
        if not branches_data:
            return None

        run_id = plan.get("run_id") or f"agent-graph-{uuid.uuid4()}"
        expected_subagents = self._build_expected_subagents(branches_data)

        await self._register_graph(session_id, run_id, plan, expected_subagents)

        await self._emit_planner_event(
            session_id=session_id,
            run_id=run_id,
            plan=plan,
        )

        branch_results = await self._execute_branches(
            session_id=session_id,
            run_id=run_id,
            branches=branches_data,
            conversation_id=conversation_id,
            conversation_history=conversation_history,
        )

        overall_status = self._derive_overall_status(branch_results)
        await self._complete_graph(
            session_id=session_id,
            run_id=run_id,
            status=overall_status,
            branches=branch_results,
        )

        metadata = {
            "branch_count": len(branch_results),
            "requested_tools": list({branch.get("executor", {}).get("type") for branch in branches_data}),
        }

        return GraphRunResult(run_id=run_id, status=overall_status, branches=branch_results, metadata=metadata)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _extract_branches(self, plan: Mapping[str, Any]) -> List[Mapping[str, Any]]:
        branches = []
        if isinstance(plan.get("branches"), Sequence):
            branches.extend([
                branch
                for branch in plan.get("branches", [])
                if isinstance(branch, Mapping)
            ])

        for step in plan.get("steps", []) if isinstance(plan.get("steps"), Sequence) else []:
            if not isinstance(step, Mapping):
                continue
            if str(step.get("type") or "").lower() != "branch":
                continue
            payload = step.get("payload") if isinstance(step.get("payload"), Mapping) else {}
            if isinstance(payload.get("branches"), Sequence):
                branches.extend([
                    branch
                    for branch in payload.get("branches", [])
                    if isinstance(branch, Mapping)
                ])

        return branches

    def _build_expected_subagents(self, branches: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
        expected = [
            {"key": "planner", "result_key": "agent_graph"},
            {"key": "research", "result_key": "research_findings"},
            {"key": "executor", "result_key": "executor_result"},
        ]
        if any(branch.get("voice") for branch in branches) and self._voice_subagent:
            expected.append({"key": "voice", "result_key": "voice_result"})
        if self._critic:
            expected.append({"key": "critic", "result_key": "critic_assessment"})
        return expected

    async def _register_graph(
        self,
        session_id: str,
        run_id: str,
        plan: Mapping[str, Any],
        expected_subagents: Sequence[Mapping[str, Any]],
    ) -> None:
        if not self._aggregator:
            return
        try:
            await self._aggregator.register_plan_step(
                session_id=session_id,
                plan_step_id=run_id,
                expected_subagents=[dict(item) for item in expected_subagents],
                planner_context={"description": "multi_agent_graph", "feature_flags": plan.get("feature_flags")},
            )
        except Exception:  # pragma: no cover - defensive guard
            logger.exception("Failed to register multi-agent graph run %s", run_id)

    async def _emit_planner_event(
        self,
        *,
        session_id: str,
        run_id: str,
        plan: Mapping[str, Any],
    ) -> None:
        if not self._aggregator:
            return
        await self._aggregator.emit_subagent_event(
            session_id=session_id,
            plan_step_id=run_id,
            subagent="planner",
            status="completed",
            payload={
                "branches": [
                    {"id": branch.get("id"), "tasks": len(branch.get("research", []) or branch.get("research_tasks", []))}
                    for branch in self._extract_branches(plan)
                ]
            },
        )

    async def _execute_branches(
        self,
        *,
        session_id: str,
        run_id: str,
        branches: Sequence[Mapping[str, Any]],
        conversation_id: Optional[str],
        conversation_history: Optional[Sequence[Mapping[str, Any]]],
    ) -> List[BranchOutcome]:
        results: List[BranchOutcome] = []
        for branch in branches:
            outcome = await self._execute_single_branch(
                session_id=session_id,
                run_id=run_id,
                branch=branch,
                conversation_id=conversation_id,
                conversation_history=conversation_history,
            )
            results.append(outcome)
        return results

    async def _execute_single_branch(
        self,
        *,
        session_id: str,
        run_id: str,
        branch: Mapping[str, Any],
        conversation_id: Optional[str],
        conversation_history: Optional[Sequence[Mapping[str, Any]]],
    ) -> BranchOutcome:
        branch_id = str(branch.get("id") or uuid.uuid4())
        research_tasks = self._parse_research_tasks(branch)
        findings = await self._run_research_tasks(
            research_tasks,
            conversation_history=conversation_history,
            session_id=session_id,
            run_id=run_id,
            branch_id=branch_id,
        )

        executor_result = await self._run_executor(
            branch.get("executor"),
            findings=findings,
            conversation_id=conversation_id,
        )

        voice_result = None
        if branch.get("voice") and self._voice_subagent:
            voice_result = await self._run_voice(
                branch.get("voice"),
                branch_id=branch_id,
                session_id=session_id,
                run_id=run_id,
                conversation_id=conversation_id,
            )

        critic_assessment = await self._run_critic(
            branch_id=branch_id,
            conversation_id=conversation_id,
            findings=[finding.to_dict() for finding in findings],
            executor_result=executor_result,
            voice_result=voice_result,
            metadata=branch.get("metadata"),
        )

        status = self._derive_branch_status(executor_result, critic_assessment)
        outcome = BranchOutcome(
            branch_id=branch_id,
            status=status,
            findings=findings,
            executor_result=dict(executor_result),
            voice_result=dict(voice_result) if voice_result else None,
            critic_assessment=critic_assessment,
        )

        await self._emit_branch_events(
            session_id=session_id,
            run_id=run_id,
            branch_outcome=outcome,
        )

        return outcome

    def _parse_research_tasks(self, branch: Mapping[str, Any]) -> List[ResearchTask]:
        tasks: List[ResearchTask] = []
        payload = branch.get("research") or branch.get("research_tasks") or []
        if not isinstance(payload, Iterable):
            return tasks
        for item in payload:
            if not isinstance(item, Mapping):
                continue
            task_id = str(item.get("id") or uuid.uuid4())
            query = str(item.get("query") or item.get("prompt") or "").strip()
            if not query:
                continue
            tasks.append(
                ResearchTask(
                    task_id=task_id,
                    query=query,
                    tool=str(item.get("tool") or "documentation"),
                    result_key=item.get("result_key"),
                    metadata=dict(item.get("metadata") or {}),
                )
            )
        return tasks

    async def _run_research_tasks(
        self,
        tasks: Sequence[ResearchTask],
        *,
        conversation_history: Optional[Sequence[Mapping[str, Any]]],
        session_id: str,
        run_id: str,
        branch_id: str,
    ) -> List[ResearchFindings]:
        findings: List[ResearchFindings] = []
        task_coroutines = [
            self._execute_research_task(task, conversation_history)
            for task in tasks
        ]
        results = await asyncio.gather(*task_coroutines, return_exceptions=True)

        for task, result in zip(tasks, results):
            if isinstance(result, Exception):
                logger.exception("Research task %s failed", task.task_id, exc_info=result)
                findings.append(
                    ResearchFindings(
                        task_id=task.task_id,
                        status="error",
                        summary=str(result),
                        citations=[],
                        confidence=0.0,
                        tool=task.tool,
                        metadata={"result_key": task.result_key},
                    )
                )
            else:
                findings.append(result)

        await self._analytics.log_event(
            "agent_graph_research_completed",
            session_id=int(session_id) if str(session_id).isdigit() else None,
            conversation_id=None,
            status="completed",
            metadata={
                "run_id": run_id,
                "branch_id": branch_id,
                "task_count": len(findings),
            },
        )

        return findings

    async def _execute_research_task(
        self,
        task: ResearchTask,
        conversation_history: Optional[Sequence[Mapping[str, Any]]],
    ) -> ResearchFindings:
        if task.tool not in {"documentation", "documentation_qa", "rag"} or not self._documentation:
            return ResearchFindings(
                task_id=task.task_id,
                status="skipped",
                summary="Research tool unavailable",
                citations=[],
                confidence=0.0,
                tool=task.tool,
                metadata={"result_key": task.result_key},
            )

        result: DocumentationQAResult = await self._documentation.execute(
            step_id=task.task_id,
            question=task.query,
            conversation_tail=[
                {"role": "user" if item.get("is_user") else "assistant", "text": item.get("text")}
                for item in (conversation_history or [])[-4:]
                if isinstance(item, Mapping)
            ],
            focus_hints=task.metadata.get("focus_hints"),
            planner_payload={"result_key": task.result_key} if task.result_key else None,
        )

        confidence = float(result.metrics.get("confidence", 0.0)) if isinstance(result.metrics, Mapping) else 0.0
        return ResearchFindings(
            task_id=task.task_id,
            status=result.status,
            summary=result.answer or result.reasoning,
            citations=list(result.citations),
            confidence=confidence,
            tool="documentation",
            metadata={"result_key": task.result_key},
        )

    async def _run_executor(
        self,
        executor_spec: Optional[Mapping[str, Any]],
        *,
        findings: Sequence[ResearchFindings],
        conversation_id: Optional[str],
    ) -> Dict[str, Any]:
        if not isinstance(executor_spec, Mapping):
            return {"status": "skipped", "message": "No executor provided."}

        exec_type = str(
            executor_spec.get("type")
            or executor_spec.get("tool")
            or executor_spec.get("name")
            or ""
        ).lower()

        if exec_type == "sql" and self._sql_tool:
            query = executor_spec.get("statement") or executor_spec.get("query")
            if not query:
                return {"status": "skipped", "tool": "sql", "message": "Missing SQL query."}
            try:
                result = await self._sql_tool.ainvoke(query)
                return {"status": "completed", "tool": "sql", "result": result}
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception("SQL executor failed", exc_info=exc)
                return {"status": "error", "tool": "sql", "message": str(exc)}

        if exec_type in {"action", "workflow"} and self._action_tool:
            message = executor_spec.get("message") or executor_spec.get("prompt")
            if not message:
                return {"status": "skipped", "tool": "action", "message": "Missing action prompt."}
            try:
                response = await self._action_tool.invoke(message, conversation_id=conversation_id)
                return {"status": "completed", "tool": "action", "result": response}
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception("Action executor failed", exc_info=exc)
                return {"status": "error", "tool": "action", "message": str(exc)}

        return {"status": "skipped", "tool": exec_type or "executor", "message": "Unsupported executor type."}

    async def _run_voice(
        self,
        voice_spec: Mapping[str, Any],
        *,
        branch_id: str,
        session_id: str,
        run_id: str,
        conversation_id: Optional[str],
    ) -> Dict[str, Any]:
        if not self._voice_subagent:
            return {"status": "skipped", "reason": "voice_subagent_disabled"}

        try:
            result: VoiceCallResult = await self._voice_subagent.execute(
                step_id=f"voice-{branch_id}",
                purchase_id=voice_spec.get("purchase_id") or voice_spec.get("order_id"),
                goals=voice_spec.get("goals"),
                metadata=voice_spec.get("metadata"),
                planner_payload=voice_spec,
                conversation_id=conversation_id,
                session_id=int(session_id) if str(session_id).isdigit() else None,
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("Voice subagent failed for branch %s", branch_id, exc_info=exc)
            payload = {"status": "error", "tool": "voice_call", "error": str(exc)}
        else:
            payload = {
                "status": result.status,
                "tool": "voice_call",
                "session_id": result.session_id,
                "vendor_phone": result.vendor_phone,
                "provider": result.provider,
                "structured_notes": result.structured_notes,
                "metrics": result.metrics,
            }

        await self._analytics.log_event(
            "agent_graph_voice_completed",
            session_id=int(session_id) if str(session_id).isdigit() else None,
            conversation_id=conversation_id,
            status=payload.get("status"),
            metadata={"run_id": run_id, "branch_id": branch_id},
        )

        return payload

    async def _run_critic(
        self,
        *,
        branch_id: str,
        conversation_id: Optional[str],
        findings: Sequence[Mapping[str, Any]],
        executor_result: Mapping[str, Any],
        voice_result: Optional[Mapping[str, Any]],
        metadata: Optional[Mapping[str, Any]],
    ) -> Optional[CriticBranchAssessment]:
        if not self._critic:
            return None
        return await self._critic.assess_branch(
            branch_id=branch_id,
            conversation_id=conversation_id,
            findings=findings,
            executor_result=executor_result,
            voice_result=voice_result,
            branch_metadata=metadata,
        )

    async def _emit_branch_events(
        self,
        *,
        session_id: str,
        run_id: str,
        branch_outcome: BranchOutcome,
    ) -> None:
        if not self._aggregator:
            return

        await self._aggregator.emit_subagent_event(
            session_id=session_id,
            plan_step_id=run_id,
            subagent="research",
            status="completed",
            payload={
                "branch_id": branch_outcome.branch_id,
                "findings": [finding.to_dict() for finding in branch_outcome.findings],
            },
        )

        await self._aggregator.emit_subagent_event(
            session_id=session_id,
            plan_step_id=run_id,
            subagent="executor",
            status=branch_outcome.executor_result.get("status", "completed"),
            payload={
                "branch_id": branch_outcome.branch_id,
                "result": dict(branch_outcome.executor_result),
            },
        )

        if branch_outcome.voice_result is not None:
            await self._aggregator.emit_subagent_event(
                session_id=session_id,
                plan_step_id=run_id,
                subagent="voice",
                status=branch_outcome.voice_result.get("status", "completed"),
                payload={
                    "branch_id": branch_outcome.branch_id,
                    "result": dict(branch_outcome.voice_result),
                },
            )

        if branch_outcome.critic_assessment is not None:
            await self._aggregator.emit_subagent_event(
                session_id=session_id,
                plan_step_id=run_id,
                subagent="critic",
                status="requires_revision"
                if branch_outcome.critic_assessment.requires_revision
                else "observed",
                payload={
                    "branch_id": branch_outcome.branch_id,
                    "assessment": branch_outcome.critic_assessment.to_dict(),
                },
            )

    async def _complete_graph(
        self,
        *,
        session_id: str,
        run_id: str,
        status: str,
        branches: Sequence[BranchOutcome],
    ) -> None:
        if not self._aggregator:
            return

        await self._aggregator.emit_step_completed(
            session_id=session_id,
            plan_step_id=run_id,
            status=status,
            payload={
                "branches": [branch.to_dict() for branch in branches],
            },
        )

    def _derive_branch_status(
        self,
        executor_result: Mapping[str, Any],
        critic_assessment: Optional[CriticBranchAssessment],
    ) -> str:
        exec_status = str(executor_result.get("status") or "completed").lower()
        if exec_status in {"error", "failed"}:
            return "error"
        if critic_assessment and critic_assessment.requires_revision:
            return "needs_revision"
        if exec_status in {"partial", "timeout"}:
            return "partial"
        return "completed"

    def _derive_overall_status(self, branches: Sequence[BranchOutcome]) -> str:
        if any(branch.status == "error" for branch in branches):
            return "error"
        if any(branch.status in {"partial", "needs_revision"} for branch in branches):
            return "partial_success"
        return "success"


__all__ = [
    "BranchOutcome",
    "GraphRunResult",
    "MultiAgentGraphRunner",
    "ResearchFindings",
    "ResearchTask",
]

"""Action/workflow subagent stub that queues side-effectful operations safely."""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional

from ..analytics_sink import AnalyticsSink
from ..skill_library import SkillLibraryClient, SkillWorkflow

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class ActionWorkflowResult:
    """Structured payload returned after processing an action plan step."""

    step_id: str
    status: str
    action: str
    parameters: Dict[str, Any]
    message: Optional[str]
    metrics: Dict[str, Any]
    queued_task_id: Optional[str] = None
    result_key: Optional[str] = None
    error: Optional[str] = None
    skill_workflow_id: Optional[str] = None
    skill_run_id: Optional[str] = None
    verified: Optional[bool] = None


@dataclass(slots=True)
class SkillExecutionContext:
    """In-memory view of a persisted workflow skill."""

    workflow: SkillWorkflow
    normalized_parameters: Dict[str, Any]


class ActionWorkflowSubagent:
    """Planner-aware stub that routes workflow steps to a durable task queue."""

    def __init__(
        self,
        *,
        analytics_sink: Optional[AnalyticsSink] = None,
        task_queue: Optional[Any] = None,
        action_tool: Optional[Any] = None,
        allow_direct_dispatch: bool = False,
        skill_library: Optional[SkillLibraryClient] = None,
    ) -> None:
        self._analytics = analytics_sink or AnalyticsSink()
        self._task_queue = task_queue
        self._action_tool = action_tool
        self._allow_direct_dispatch = allow_direct_dispatch
        self._skill_library = skill_library
        self._skill_cache: Dict[str, SkillExecutionContext] = {}
        self._skills_loaded = False

    def supports_step(self, plan_step: Mapping[str, Any]) -> bool:
        """Return True when the planner step should be handled by this subagent."""

        if not isinstance(plan_step, Mapping):
            return False

        step_type = str(plan_step.get("type") or "").lower()
        payload = plan_step.get("payload") or {}
        if not isinstance(payload, Mapping):
            payload = {}

        if step_type == "action":
            return True

        skill_hint = self._extract_skill_hint(plan_step)
        if skill_hint:
            return True

        if step_type != "tool":
            return False

        tool_name = str(payload.get("tool_name") or payload.get("action_name") or "").lower()
        return any(keyword in tool_name for keyword in ("action", "workflow", "task", "agent_v2", "skill"))

    async def execute(
        self,
        *,
        step_id: str,
        action: str,
        parameters: Optional[Mapping[str, Any]] = None,
        planner_payload: Optional[Mapping[str, Any]] = None,
        conversation_id: Optional[str] = None,
        session_id: Optional[int] = None,
    ) -> ActionWorkflowResult:
        """Queue or execute the requested action and return a structured result."""

        normalized_parameters = dict(parameters or {})
        planner_metadata = dict(planner_payload or {})
        result_key = planner_metadata.get("result_key")
        execution_mode = str(
            planner_metadata.get("execution_mode")
            or normalized_parameters.get("execution_mode")
            or "queue"
        ).lower()

        skill_context = await self._resolve_skill_context(action, planner_metadata)
        dispatched_action = skill_context.workflow.entrypoint if skill_context else action
        execution_parameters = {
            **(skill_context.normalized_parameters if skill_context else {}),
            **normalized_parameters,
        }

        if skill_context:
            planner_metadata.setdefault("skill_workflow_id", skill_context.workflow.id)
            planner_metadata.setdefault("skill_name", skill_context.workflow.name)

        skill_run_id = str(
            planner_metadata.get("skill_run_id")
            or planner_metadata.get("run_id")
            or uuid.uuid4()
        )

        metadata = {
            "step_id": step_id,
            "session_id": session_id,
            "conversation_id": conversation_id,
            "action": action,
            "dispatched_action": dispatched_action,
            "execution_mode": execution_mode,
            "result_key": result_key,
            "skill_workflow_id": planner_metadata.get("skill_workflow_id"),
            "skill_name": planner_metadata.get("skill_name"),
            "skill_run_id": skill_run_id,
        }

        await self._analytics.log_event(
            "subagent_invocation_started",
            tool="action_workflow",
            status="started",
            metadata=metadata,
        )

        start_time = time.perf_counter()
        message: Optional[str] = None
        queued_task_id: Optional[str] = None
        status = "queued"
        error: Optional[str] = None
        verified: Optional[bool] = None
        verification_payload: Dict[str, Any] = {}

        try:
            if execution_mode == "sync" and self._allow_direct_dispatch and self._action_tool:
                logger.debug(
                    "Dispatching action '%s' via AgentActionTool in sync mode", dispatched_action
                )
                response = await self._action_tool.invoke(
                    execution_parameters.get("message") or dispatched_action,
                    conversation_id,
                )
                verification_payload = self._extract_verification_payload(response)
                message = response.get("message") or "Action dispatched synchronously"
                success_traces = [
                    trace
                    for trace in verification_payload.get("actions", [])
                    if trace.get("success") is True
                ]
                if success_traces:
                    status = "success"
                    verified = True
                    message = success_traces[-1].get("summary") or message
                else:
                    status = "error"
                    error = (
                        response.get("error")
                        or verification_payload.get("error")
                        or message
                    )
                    verified = False
            elif execution_mode == "manual":
                status = "manual"
                message = execution_parameters.get(
                    "instructions",
                    "Action captured for manual follow-up",
                )
            else:
                if self._task_queue is None:
                    raise RuntimeError("Task queue is not configured")

                queue_payload = {
                    "action": dispatched_action,
                    "parameters": execution_parameters,
                    "planner_payload": planner_metadata,
                    "session_id": session_id,
                }
                queued_task_id = self._task_queue.enqueue(
                    "agent_action",
                    queue_payload,
                    conversation_id=conversation_id,
                )
                message = (
                    execution_parameters.get("confirmation")
                    or f"Action '{dispatched_action}' queued for execution"
                )
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("Action workflow subagent failed: %s", exc)
            status = "error"
            error = str(exc)
            message = message or f"Failed to dispatch action '{dispatched_action}'"
            verified = False

        metrics = {
            "latency_ms": int((time.perf_counter() - start_time) * 1000),
            "execution_mode": execution_mode,
            "dispatched_action": dispatched_action,
        }

        await self._analytics.log_event(
            "subagent_invocation_completed",
            tool="action_workflow",
            status=status,
            metadata={**metadata, "queued_task_id": queued_task_id, "error": error},
        )

        if skill_context and self._skill_library:
            await self._record_skill_reflection(
                workflow=skill_context.workflow,
                run_id=skill_run_id,
                status=status,
                verified=verified,
                latency_ms=metrics["latency_ms"],
                queued_task_id=queued_task_id,
                verification_payload=verification_payload,
                message=message,
            )

            if self._should_register_skill(planner_metadata, status):
                await self._register_skill_definition(
                    planner_metadata,
                    dispatched_action,
                    execution_parameters,
                    skill_context.workflow,
                )
        elif self._should_register_skill(planner_metadata, status) and self._skill_library:
            await self._register_skill_definition(
                planner_metadata,
                dispatched_action,
                execution_parameters,
                None,
            )

        return ActionWorkflowResult(
            step_id=step_id,
            status=status,
            action=action,
            parameters=execution_parameters,
            message=message,
            metrics=metrics,
            queued_task_id=queued_task_id,
            result_key=result_key,
            error=error,
            skill_workflow_id=planner_metadata.get("skill_workflow_id"),
            skill_run_id=skill_run_id if planner_metadata.get("skill_workflow_id") else None,
            verified=verified,
        )

    async def _resolve_skill_context(
        self,
        action: str,
        planner_metadata: Mapping[str, Any],
    ) -> Optional[SkillExecutionContext]:
        if not self._skill_library:
            return None

        if not self._skills_loaded:
            await self._load_skills()

        skill_hint = self._extract_skill_hint({"action": action, "payload": planner_metadata})
        if not skill_hint:
            return None

        context = self._skill_cache.get(skill_hint)
        if context:
            return context

        workflow_id = planner_metadata.get("skill_workflow_id")
        if isinstance(workflow_id, str):
            for cached in self._skill_cache.values():
                if cached.workflow.id == workflow_id:
                    return cached
        return None

    async def _load_skills(self) -> None:
        if not self._skill_library or self._skills_loaded:
            return

        try:
            workflows = await self._skill_library.list_workflows()
            self._skill_cache = {
                workflow.name.lower(): SkillExecutionContext(
                    workflow=workflow,
                    normalized_parameters=dict(workflow.parameters or {}),
                )
                for workflow in workflows
                if workflow.name
            }
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug("Failed to load skills: %s", exc)
        finally:
            self._skills_loaded = True

    def _extract_skill_hint(self, plan_step: Mapping[str, Any]) -> Optional[str]:
        payload = plan_step.get("payload") if isinstance(plan_step.get("payload"), Mapping) else {}
        action = plan_step.get("action") or payload.get("action")

        if isinstance(payload, Mapping):
            skill_meta = payload.get("skill")
            if isinstance(skill_meta, Mapping):
                name = skill_meta.get("name") or skill_meta.get("skill_name")
                if isinstance(name, str) and name.strip():
                    return name.strip().lower()

        for key in ("skill_name", "skillName", "skill"):
            candidate = payload.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip().lower()

        if isinstance(action, str) and action.lower().startswith("skill"):
            parts = action.split(":", 1)
            if len(parts) == 2 and parts[1].strip():
                return parts[1].strip().lower()

        tool_name = payload.get("tool_name") or payload.get("toolName")
        if isinstance(tool_name, str) and tool_name.lower().startswith("skill"):
            parts = tool_name.split(":", 1)
            if len(parts) == 2 and parts[1].strip():
                return parts[1].strip().lower()

        return None

    async def _record_skill_reflection(
        self,
        *,
        workflow: SkillWorkflow,
        run_id: str,
        status: str,
        verified: Optional[bool],
        latency_ms: int,
        queued_task_id: Optional[str],
        verification_payload: Mapping[str, Any],
        message: Optional[str],
    ) -> None:
        success = status in {"success", "completed"}
        payload = {
            "skillWorkflowId": workflow.id,
            "runId": run_id,
            "outcome": status,
            "success": success,
            "verificationPayload": {
                "verified": verified,
                "message": message,
                "queued_task_id": queued_task_id,
                "traces": list(verification_payload.get("actions", [])),
            },
            "latencyMs": latency_ms,
        }

        try:
            await self._skill_library.record_run_reflection(payload)
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug(
                "Failed to record skill reflection for %s: %s", workflow.name, exc
            )

    def _should_register_skill(self, planner_metadata: Mapping[str, Any], status: str) -> bool:
        flags = [
            planner_metadata.get("register_skill"),
            planner_metadata.get("persist_skill"),
            planner_metadata.get("save_skill"),
        ]
        return any(self._to_bool(flag) for flag in flags) and status in {"success", "completed", "queued"}

    async def _register_skill_definition(
        self,
        planner_metadata: Mapping[str, Any],
        dispatched_action: str,
        execution_parameters: Mapping[str, Any],
        existing_workflow: Optional[SkillWorkflow],
    ) -> None:
        if not self._skill_library:
            return

        definition = planner_metadata.get("skill_definition") or planner_metadata.get("skillDefinition")
        if not isinstance(definition, Mapping):
            definition = planner_metadata.get("skill") if isinstance(planner_metadata.get("skill"), Mapping) else None
        if not isinstance(definition, Mapping):
            return

        payload: Dict[str, Any] = dict(definition)
        payload.setdefault("name", existing_workflow.name if existing_workflow else planner_metadata.get("skill_name"))
        payload.setdefault("entrypoint", existing_workflow.entrypoint if existing_workflow else dispatched_action)
        if "parameters" not in payload:
            payload["parameters"] = dict(execution_parameters)

        name = payload.get("name")
        if not isinstance(name, str) or not name.strip():
            return
        payload["name"] = name.strip()

        try:
            result = await self._skill_library.upsert_workflow(payload)
            if result and result.name:
                normalized = result.name.lower()
                self._skill_cache[normalized] = SkillExecutionContext(
                    workflow=result,
                    normalized_parameters=dict(result.parameters or {}),
                )
                self._skills_loaded = True
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug("Failed to register skill definition: %s", exc)

    @staticmethod
    def _extract_verification_payload(response: Mapping[str, Any]) -> Dict[str, Any]:
        actions = response.get("actions")
        if isinstance(actions, list):
            traces = [trace for trace in actions if isinstance(trace, Mapping)]
        else:
            traces = []
        return {
            "actions": traces,
            "message": response.get("message"),
            "error": response.get("error"),
        }

    @staticmethod
    def _to_bool(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "yes", "on"}:
                return True
            if normalized in {"0", "false", "no", "off"}:
                return False
        return False


__all__ = ["ActionWorkflowSubagent", "ActionWorkflowResult"]

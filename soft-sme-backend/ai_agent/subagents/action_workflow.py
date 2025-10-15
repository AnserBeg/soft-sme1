"""Action/workflow subagent stub that queues side-effectful operations safely."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional

from ..analytics_sink import AnalyticsSink

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


class ActionWorkflowSubagent:
    """Planner-aware stub that routes workflow steps to a durable task queue."""

    def __init__(
        self,
        *,
        analytics_sink: Optional[AnalyticsSink] = None,
        task_queue: Optional[Any] = None,
        action_tool: Optional[Any] = None,
        allow_direct_dispatch: bool = False,
    ) -> None:
        self._analytics = analytics_sink or AnalyticsSink()
        self._task_queue = task_queue
        self._action_tool = action_tool
        self._allow_direct_dispatch = allow_direct_dispatch

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

        if step_type != "tool":
            return False

        tool_name = str(payload.get("tool_name") or payload.get("action_name") or "").lower()
        return any(keyword in tool_name for keyword in ("action", "workflow", "task", "agent_v2"))

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

        metadata = {
            "step_id": step_id,
            "session_id": session_id,
            "conversation_id": conversation_id,
            "action": action,
            "execution_mode": execution_mode,
            "result_key": result_key,
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

        try:
            if execution_mode == "sync" and self._allow_direct_dispatch and self._action_tool:
                logger.debug(
                    "Dispatching action '%s' via AgentActionTool in sync mode", action
                )
                response = await self._action_tool.invoke(
                    normalized_parameters.get("message") or action,
                    conversation_id,
                )
                message = response.get("message") or "Action dispatched synchronously"
                status = "success" if response.get("actions") else "completed"
            elif execution_mode == "manual":
                status = "manual"
                message = normalized_parameters.get(
                    "instructions",
                    "Action captured for manual follow-up",
                )
            else:
                if self._task_queue is None:
                    raise RuntimeError("Task queue is not configured")

                queue_payload = {
                    "action": action,
                    "parameters": normalized_parameters,
                    "planner_payload": planner_metadata,
                    "session_id": session_id,
                }
                queued_task_id = self._task_queue.enqueue(
                    "agent_action",
                    queue_payload,
                    conversation_id=conversation_id,
                )
                message = (
                    normalized_parameters.get("confirmation")
                    or f"Action '{action}' queued for execution"
                )
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("Action workflow subagent failed: %s", exc)
            status = "error"
            error = str(exc)
            message = message or f"Failed to dispatch action '{action}'"

        metrics = {
            "latency_ms": int((time.perf_counter() - start_time) * 1000),
            "execution_mode": execution_mode,
        }

        await self._analytics.log_event(
            "subagent_invocation_completed",
            tool="action_workflow",
            status=status,
            metadata={**metadata, "queued_task_id": queued_task_id, "error": error},
        )

        return ActionWorkflowResult(
            step_id=step_id,
            status=status,
            action=action,
            parameters=normalized_parameters,
            message=message,
            metrics=metrics,
            queued_task_id=queued_task_id,
            result_key=result_key,
            error=error,
        )


__all__ = ["ActionWorkflowSubagent", "ActionWorkflowResult"]

"""Action tool interface for orchestrating business workflows via Agent V2."""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import httpx

from analytics_sink import AnalyticsSink

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "http://127.0.0.1:5000/api/agent/v2"


class AgentActionTool:
    """Client wrapper that bridges the Python agent with the Node.js Agent V2 orchestrator."""

    def __init__(self, analytics_sink: Optional[AnalyticsSink] = None):
        self.base_url = os.getenv("AGENT_V2_API_URL", DEFAULT_BASE_URL).rstrip("/")
        self.service_token = self._sanitize(os.getenv("AI_AGENT_SERVICE_TOKEN"))
        self.service_api_key = self._sanitize(os.getenv("AI_AGENT_SERVICE_API_KEY"))
        self.timeout = float(os.getenv("AGENT_V2_HTTP_TIMEOUT", "15"))
        self._session_map: Dict[str, int] = {}
        self._client: Optional[httpx.AsyncClient] = None
        self.analytics_sink = analytics_sink
        logger.info("AgentActionTool configured for base URL %s", self.base_url)

    async def ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def ensure_session(self, conversation_id: str) -> Optional[int]:
        if not conversation_id:
            return None

        if conversation_id in self._session_map:
            return self._session_map[conversation_id]

        client = await self.ensure_client()
        try:
            response = await client.post(
                f"{self.base_url}/session",
                headers=self._build_headers(),
                json={},
            )
            response.raise_for_status()
            data = response.json()
            session_id = data.get("sessionId")
            if session_id is not None:
                self._session_map[conversation_id] = int(session_id)
                logger.debug("Mapped conversation %s to agent session %s", conversation_id, session_id)
            return session_id
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Failed to create agent V2 session: %s", exc)
            await self._log_failure(
                conversation_id,
                None,
                "session_initialization",
                exc,
            )
            return None

    async def invoke(self, message: str, conversation_id: Optional[str] = None) -> Dict[str, Any]:
        client = await self.ensure_client()
        session_id = None
        if conversation_id:
            session_id = await self.ensure_session(conversation_id)

        payload = {"message": message}
        if session_id is not None:
            payload["sessionId"] = session_id

        try:
            response = await client.post(
                f"{self.base_url}/chat",
                headers=self._build_headers(),
                json=payload,
            )
            response.raise_for_status()
            data = response.json() or {}
            reply = data.get("reply")
            if not isinstance(reply, dict):
                logger.debug("Agent V2 reply was not structured JSON: %s", reply)
                return {}

            return self._normalize_reply(reply)
        except httpx.HTTPStatusError as http_err:
            logger.error("Agent V2 HTTP error: %s", http_err)
            error_detail = self._extract_error(http_err)
            await self._log_failure(
                conversation_id,
                session_id,
                "invoke_http_error",
                http_err,
                extra={"status_code": http_err.response.status_code if http_err.response else None},
                error_message=error_detail,
            )
            return {
                "actions": [
                    {
                        "tool": "agent_v2",
                        "success": False,
                        "message": f"Action request failed: {error_detail}",
                        "error": error_detail,
                    }
                ],
                "catalog": [],
                "message": f"Action request failed: {error_detail}",
            }
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Agent V2 invocation error: %s", exc)
            await self._log_failure(
                conversation_id,
                session_id,
                "invoke_exception",
                exc,
            )
            return {
                "actions": [
                    {
                        "tool": "agent_v2",
                        "success": False,
                        "message": f"Unable to contact action orchestrator: {exc}",
                        "error": str(exc),
                    }
                ],
                "catalog": [],
                "message": f"Unable to contact action orchestrator: {exc}",
            }

    async def aclose(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _log_failure(
        self,
        conversation_id: Optional[str],
        session_id: Optional[int],
        stage: str,
        error: Exception,
        *,
        extra: Optional[Dict[str, Any]] = None,
        error_message: Optional[str] = None,
    ) -> None:
        if not self.analytics_sink:
            return

        metadata: Dict[str, Any] = {"stage": stage}
        if conversation_id:
            metadata["conversation_id"] = conversation_id
        if extra:
            metadata.update(extra)

        message = error_message if error_message is not None else str(error)

        await self.analytics_sink.log_event(
            "tool_failure",
            tool="agent_v2",
            session_id=session_id,
            conversation_id=conversation_id,
            status="failed",
            error_message=message,
            metadata=metadata,
        )

    def _build_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.service_token:
            headers["Authorization"] = self.service_token
        if self.service_api_key:
            headers["x-api-key"] = self.service_api_key
        return headers

    @staticmethod
    def _sanitize(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    def _normalize_reply(self, reply: Dict[str, Any]) -> Dict[str, Any]:
        catalog = reply.get("catalog") if isinstance(reply.get("catalog"), list) else []
        traces = reply.get("traces") if isinstance(reply.get("traces"), list) else []

        normalized_traces: List[Dict[str, Any]] = []
        for trace in traces:
            if not isinstance(trace, dict):
                continue
            normalized_traces.append(self._augment_trace(trace))

        message = reply.get("message") if isinstance(reply.get("message"), str) else ""
        docs = reply.get("docs") if isinstance(reply.get("docs"), list) else []

        return {
            "type": reply.get("type"),
            "message": message,
            "actions": normalized_traces,
            "catalog": catalog,
            "docs": docs,
        }

    def _augment_trace(self, trace: Dict[str, Any]) -> Dict[str, Any]:
        tool = trace.get("tool")
        output = trace.get("output") if isinstance(trace.get("output"), dict) else trace.get("output")
        message = trace.get("message") or self.describe_tool(tool, trace.get("success"))

        augmented = {
            "tool": tool,
            "success": trace.get("success", False),
            "message": message,
            "input": trace.get("input"),
            "output": output,
            "error": trace.get("error"),
        }

        link = trace.get("link")
        link_label = trace.get("linkLabel")
        if link:
            augmented["link"] = link
        if link_label:
            augmented["link_label"] = link_label

        summary = self._generate_summary(tool, augmented)
        if summary:
            augmented["summary"] = summary

        return augmented

    def _generate_summary(self, tool: Optional[str], trace: Dict[str, Any]) -> Optional[str]:
        if not tool:
            return None

        success = trace.get("success", False)
        output = trace.get("output") or {}

        if tool == "createPurchaseOrder":
            if success and isinstance(output, dict):
                po_number = output.get("purchase_number")
                if po_number:
                    return f"Created purchase order {po_number}."
                return "Created a new purchase order."
            if not success:
                return f"Failed to create purchase order: {trace.get('error')}"
        if tool == "updatePurchaseOrder" and success:
            return "Updated the purchase order."
        if tool == "emailPurchaseOrder" and success:
            return "Emailed the purchase order." \
                + (f" ({output.get('to')})" if isinstance(output, dict) and output.get('to') else "")
        if tool == "createSalesOrder" and success:
            so_number = output.get("sales_order_number") if isinstance(output, dict) else None
            return f"Created sales order {so_number}." if so_number else "Created a new sales order."
        if tool == "convertQuoteToSO" and success:
            return "Converted quote into a sales order."
        if not success:
            return f"{self.describe_tool(tool, False).capitalize()}"
        return None

    @staticmethod
    def describe_tool(tool: Optional[str], success: Optional[bool] = None) -> str:
        if not tool:
            return "action"
        mapping = {
            "createPurchaseOrder": "create a purchase order",
            "updatePurchaseOrder": "update the purchase order",
            "closePurchaseOrder": "close the purchase order",
            "emailPurchaseOrder": "email the purchase order",
            "createSalesOrder": "create a sales order",
            "updateSalesOrder": "update the sales order",
            "createQuote": "create a quote",
            "updateQuote": "update the quote",
            "emailQuote": "email the quote",
            "convertQuoteToSO": "convert the quote into a sales order",
            "updatePickupDetails": "update pickup details",
            "getPickupDetails": "retrieve pickup details",
        }
        action = mapping.get(tool, tool.replace('_', ' '))
        if success is False:
            return f"failed to {action}"
        return action

    @staticmethod
    def _extract_error(error: httpx.HTTPStatusError) -> str:
        try:
            payload = error.response.json()
            if isinstance(payload, dict):
                if payload.get("error"):
                    return str(payload.get("error"))
                if payload.get("message"):
                    return str(payload.get("message"))
        except Exception:  # pylint: disable=broad-except
            pass
        text = error.response.text
        return text or f"HTTP {error.response.status_code}"

    async def cleanup(self):
        await self.aclose()
        self._session_map.clear()


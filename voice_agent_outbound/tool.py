import json
import logging
import os
import re
from difflib import SequenceMatcher
from typing import Any, Dict, Optional, List

import httpx
from livekit import api
from livekit.agents import RunContext, function_tool, get_job_context


BACKEND_BASE_URL = os.getenv("AGENT_BACKEND_BASE_URL") or os.getenv("BACKEND_BASE_URL") or ""
SALES_ORDER_PATH = "/api/sales-orders"
TIME_TRACKING_PATH = "/api/time-tracking"
CUSTOMER_PATH = "/api/customers"

DEFAULT_TENANT_ID = (
    os.getenv("OUTBOUND_TENANT_ID")
    or os.getenv("DEFAULT_TENANT_ID")
    or os.getenv("TENANT_ID")
    or "default"
)
TENANT_TOKEN = os.getenv("TENANT_AGENT_TOKEN")


def _parse_metadata(raw: Any) -> Dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return {}
    return {}


def _tenant_ctx(job_ctx: Any) -> Dict[str, Optional[str]]:
    meta = _parse_metadata(getattr(job_ctx.room, "metadata", {}))
    tenant_id = (
        meta.get("tenantId")
        or meta.get("tenant_id")
        or meta.get("company_id")
        or DEFAULT_TENANT_ID
    )
    profile_id = meta.get("profileId") or meta.get("profile_id")
    return {
        "tenant_id": str(tenant_id) if tenant_id is not None else DEFAULT_TENANT_ID,
        "profile_id": int(profile_id) if profile_id is not None else None,
    }


def _headers(tenant_id: str) -> Dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "x-tenant-id": tenant_id,
    }
    if TENANT_TOKEN:
        headers["Authorization"] = f"Bearer {TENANT_TOKEN}"
    return headers


def _build_url(path: str) -> str:
    return f"{BACKEND_BASE_URL.rstrip('/')}/{path.lstrip('/')}"


async def _get_json(url: str, headers: Dict[str, str]) -> httpx.Response:
    async with httpx.AsyncClient(timeout=10.0) as client:
        return await client.get(url, headers=headers)


async def _post_json(url: str, headers: Dict[str, str], payload: Dict[str, Any]) -> httpx.Response:
    async with httpx.AsyncClient(timeout=10.0) as client:
        return await client.post(url, headers=headers, json=payload)


def _norm(val: Optional[str]) -> str:
    if not val:
        return ""
    return re.sub(r"[^a-z0-9]", "", val.lower())


def _best_match_sales_orders(
    sales_orders: List[Dict[str, Any]],
    so_number: Optional[str],
    unit_number: Optional[str],
    company_name: Optional[str],
) -> List[Dict[str, Any]]:
    def score_entry(so: Dict[str, Any]) -> float:
        scores = []
        if so_number:
            scores.append(SequenceMatcher(None, _norm(so_number), _norm(str(so.get("sales_order_number") or so.get("sales_order_id") or "")) ).ratio())
        if unit_number:
            scores.append(SequenceMatcher(None, _norm(unit_number), _norm(str(so.get("unit_number") or ""))).ratio())
        if company_name:
            scores.append(SequenceMatcher(None, _norm(company_name), _norm(str(so.get("customer_name") or ""))).ratio())
        return max(scores) if scores else 0.0

    scored = []
    for so in sales_orders:
        scored.append((score_entry(so), so))
    scored.sort(key=lambda x: x[0], reverse=True)
    # keep meaningful matches above ~0.45
    return [so for score, so in scored if score >= 0.45][:5]


@function_tool
async def end_call(ctx: RunContext) -> str:
    """End the call once the reminder is delivered."""
    logger = logging.getLogger("outbound-reminder")
    job_ctx = get_job_context()
    if job_ctx is None:
        logger.error("Failed to get job context")
        return "error"

    logger.info(f"Ending call for room {job_ctx.room.name}")
    try:
        await job_ctx.api.room.delete_room(
            api.DeleteRoomRequest(room=job_ctx.room.name)
        )
        logger.info(f"Successfully ended call for room {job_ctx.room.name}")
        return "ended"
    except Exception as e:
        logger.error(f"Failed to end call: {e}", exc_info=True)
        return "error"


async def _get_or_create_customer(
    logger: logging.Logger,
    headers: Dict[str, str],
    company_name: str,
    contact_person: str,
    phone: Optional[str],
    email: Optional[str],
) -> Optional[int]:
    url = _build_url(CUSTOMER_PATH)
    payload = {
        "customer_name": company_name,
        "contact_person": contact_person,
        "phone_number": phone,
        "email": email,
        "general_notes": "Created via outbound agent",
    }

    try:
        list_resp = await _get_json(url, headers)
        if list_resp.status_code == 200:
            data = list_resp.json()
            if isinstance(data, list):
                target = _norm(company_name)
                best = (0.0, None)
                for c in data:
                    name = c.get("customer_name") or c.get("name") or ""
                    score = SequenceMatcher(None, target, _norm(name)).ratio()
                    if score > best[0]:
                        best = (score, c.get("id") or c.get("customer_id"))
                if best[0] >= 0.82 and best[1]:
                    return int(best[1])
    except Exception:
        logger.warning("customer list fetch failed", exc_info=True)

    try:
        resp = await _post_json(url, headers, payload)
        if resp.status_code == 201:
            data = resp.json()
            return int(data.get("id") or data.get("customer_id"))
        if resp.status_code == 409:
            data = resp.json()
            existing = data.get("existingCustomerId") or data.get("existing_customer_id")
            if existing:
                return int(existing)
        logger.error("customer create failed", extra={"status": resp.status_code, "body": resp.text})
        return None
    except Exception:
        logger.error("exception creating customer", exc_info=True)
        return None


@function_tool
async def search_open_sales_orders(
    ctx: RunContext,
    sales_order_number: Optional[str] = None,
    unit_number: Optional[str] = None,
    company_name: Optional[str] = None,
) -> str:
    """
    Fetch open sales orders and return likely matches. Provide any of: sales_order_number, unit_number, company_name.
    """
    logger = logging.getLogger("outbound-reminder")
    job_ctx = get_job_context()
    if job_ctx is None:
        logger.error("No job context")
        return "error"
    if not BACKEND_BASE_URL:
        logger.error("AGENT_BACKEND_BASE_URL/BACKEND_BASE_URL not set")
        return "error"

    tenant = _tenant_ctx(job_ctx)
    headers = _headers(tenant["tenant_id"])
    try:
        resp = await _get_json(_build_url(f"{SALES_ORDER_PATH}?status=open"), headers)
        if resp.status_code != 200:
            logger.error("open sales order fetch failed", extra={"status": resp.status_code, "body": resp.text})
            return "error"
        data = resp.json()
        if not isinstance(data, list):
            return "error"
        matches = _best_match_sales_orders(data, sales_order_number, unit_number, company_name)
        if not matches:
            return "no_match"
        return json.dumps({"matches": matches}, ensure_ascii=False)
    except Exception:
        logger.error("exception fetching open sales orders", exc_info=True)
        return "error"


@function_tool
async def create_sales_order(
    ctx: RunContext,
    company_name: str,
    issue_description: str,
    unit_number: Optional[str] = None,
    vin: Optional[str] = None,
    make: Optional[str] = None,
    model: Optional[str] = None,
    year: Optional[str] = None,
    notes: Optional[str] = None,
) -> str:
    """
    Create a sales order for this tenant. Caller/contact is the employee unless specified otherwise.
    """
    logger = logging.getLogger("outbound-reminder")
    job_ctx = get_job_context()
    if job_ctx is None:
        logger.error("No job context")
        return "error"
    tenant = _tenant_ctx(job_ctx)
    headers = _headers(tenant["tenant_id"])

    if not BACKEND_BASE_URL:
        logger.error("AGENT_BACKEND_BASE_URL/BACKEND_BASE_URL not set")
        return "error"

    meta = _parse_metadata(getattr(job_ctx.room, "metadata", {}))
    caller_name = meta.get("employeeName") or meta.get("employee_name") or "Employee"
    caller_phone = meta.get("employeePhone") or None
    caller_email = meta.get("employeeEmail") or None

    customer_id = await _get_or_create_customer(
        logger,
        headers,
        company_name=company_name,
        contact_person=caller_name,
        phone=caller_phone,
        email=caller_email,
    )
    if not customer_id:
        return "error"

    def build_product_name() -> str:
        base = issue_description.strip() if issue_description else ""
        if not base:
            parts = [p for p in [year, make, model] if p]
            base = " ".join(parts) if parts else "Service request"
        return base[:120] or "Service request"

    payload = {
        "customer_id": customer_id,
        "product_name": build_product_name(),
        "product_description": issue_description or build_product_name(),
        "vin_number": vin or "unknown",
        "unit_number": unit_number or "",
        "vehicle_make": make or "",
        "vehicle_model": model or "",
        "status": "Open",
        "source": "voice-agent-outbound",
        "notes": notes,
    }

    try:
        resp = await _post_json(_build_url(SALES_ORDER_PATH), headers, payload)
        if resp.status_code >= 300:
            logger.error(
                "sales order creation failed",
                extra={"status": resp.status_code, "body": resp.text},
            )
            return "error"
        data = resp.json()
        so_id = data.get("sales_order_id") or data.get("id")
        return json.dumps({"sales_order_id": so_id}, ensure_ascii=False)
    except Exception:
        logger.error("exception creating sales order", exc_info=True)
        return "error"


@function_tool
async def clock_in_time_entry(ctx: RunContext, sales_order_id: int) -> str:
    """
    Clock the employee into the given sales order. Uses profile_id from room metadata.
    """
    logger = logging.getLogger("outbound-reminder")
    job_ctx = get_job_context()
    if job_ctx is None:
        logger.error("No job context")
        return "error"
    tenant = _tenant_ctx(job_ctx)
    profile_id = tenant.get("profile_id")
    if not profile_id:
        logger.error("profile_id missing in room metadata; cannot clock in")
        return "error"
    headers = _headers(tenant["tenant_id"])

    payload = {
        "profile_id": profile_id,
        "so_id": sales_order_id,
    }

    try:
        resp = await _post_json(_build_url(f"{TIME_TRACKING_PATH}/time-entries/clock-in"), headers, payload)
        if resp.status_code >= 300:
            logger.error(
                "clock-in failed",
                extra={"status": resp.status_code, "body": resp.text},
            )
            return "error"
        data = resp.json()
        entry_id = data.get("id") or data.get("time_entry_id")
        return json.dumps({"status": "clocked_in", "time_entry_id": entry_id}, ensure_ascii=False)
    except Exception:
        logger.error("exception clocking in", exc_info=True)
        return "error"

import json
import logging
import os
import re
from difflib import SequenceMatcher
from typing import Any, Dict, Optional

import httpx
from livekit import api
from livekit.agents import RunContext, function_tool, get_job_context


DEFAULT_ESCALATION_NUMBER = os.getenv("DEFAULT_ESCALATION_NUMBER", "tel:+18883658681")


def _norm_value(val: Optional[str]) -> str:
  if not val:
    return ""
  return re.sub(r"[^a-z0-9]", "", str(val).lower())


@function_tool
async def transfer_to_human(ctx: RunContext, destination: str = "") -> str:
    """Transfer to specialist. Call only after confirming consent. Destination defaults to DEFAULT_ESCALATION_NUMBER env."""
    logger = logging.getLogger("phone-assistant")
    job_ctx = get_job_context()
    if job_ctx is None:
        logger.error("Job context not found")
        return "error"

    transfer_to = destination.strip() or DEFAULT_ESCALATION_NUMBER

    sip_participant = None
    for participant in job_ctx.room.remote_participants.values():
        if participant.identity.startswith("sip:"):
            sip_participant = participant
            break

    if sip_participant is None:
        logger.error("No SIP participant found")
        return "error"

    logger.info(f"Transferring call for participant {sip_participant.identity} to {transfer_to}")

    try:
        await job_ctx.api.sip.transfer_sip_participant(
            api.TransferSIPParticipantRequest(
                room_name=job_ctx.room.name,
                participant_identity=sip_participant.identity,
                transfer_to=transfer_to,
                play_dialtone=True,
            )
        )
        logger.info(f"Successfully transferred participant {sip_participant.identity} to {transfer_to}")
        return "transferred"
    except Exception as e:
        logger.error(f"Failed to transfer call: {e}", exc_info=True)
        return "error"


@function_tool
async def end_call(ctx: RunContext) -> str:
    """End call. If the user isn't interested, expresses general disinterest or wants to end the call"""
    logger = logging.getLogger("phone-assistant")

    job_ctx = get_job_context()
    if job_ctx is None:
        logger.error("Failed to get job context")
        return "error"

    logger.info(f"Ending call for room {job_ctx.room.name}")

    try:
        await job_ctx.api.room.delete_room(
            api.DeleteRoomRequest(
                room=job_ctx.room.name
            )
        )
        logger.info(f"Successfully ended call for room {job_ctx.room.name}")
        return "ended"
    except Exception as e:
        logger.error(f"Failed to end call: {e}", exc_info=True)
        return "error"


# --- Multi-tenant helpers and sales order tool ---

# Map numbers (DIDs) to tenant IDs, sourced from env to avoid hardcoding.
# Example: TENANT_NUMBER_MAP='{" +18257933517": "1"}'
def _parse_map_env(raw: Optional[str]) -> Dict[str, str]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {str(k): str(v) for k, v in parsed.items()}
    except Exception:
        pass

    # Fallback: semicolon-delimited "key=value" pairs
    items = [seg.strip() for seg in raw.split(";") if seg.strip()]
    result: Dict[str, str] = {}
    for item in items:
        if "=" in item:
            k, v = item.split("=", 1)
            result[k.strip()] = v.strip()
    return result


TENANT_NUMBER_MAP = _parse_map_env(os.getenv("TENANT_NUMBER_MAP"))
TENANT_TOKENS = _parse_map_env(os.getenv("TENANT_AGENT_TOKENS"))
DEFAULT_TENANT_ID = os.getenv("DEFAULT_TENANT_ID", "default")
BACKEND_BASE_URL = os.getenv("AGENT_BACKEND_BASE_URL") or os.getenv("BACKEND_BASE_URL") or ""
SALES_ORDER_PATH = os.getenv("AGENT_SALES_ORDER_PATH", "/api/sales-orders")
CUSTOMER_PATH = os.getenv("AGENT_CUSTOMER_PATH", "/api/customers")


def _extract_called_number(job_ctx: Any) -> Optional[str]:
    # Prefer room metadata if present
    meta = getattr(job_ctx.room, "metadata", {}) or {}
    for key in ("number", "called_number", "did"):
        if key in meta:
            return str(meta[key])

    # Fallback: parse the SIP participant identity: sip:+1825...@...
    for participant in job_ctx.room.remote_participants.values():
        ident = getattr(participant, "identity", "") or ""
        match = re.search(r"sip:([^@]+)", ident)
        if match:
            return match.group(1)
    return None


def _resolve_tenant(job_ctx: Any) -> Dict[str, Optional[str]]:
    meta = getattr(job_ctx.room, "metadata", {}) or {}
    tenant_id = None
    for key in ("tenantId", "tenant_id", "company_id"):
        if key in meta:
            tenant_id = str(meta[key])
            break

    called_number = _extract_called_number(job_ctx)
    if not tenant_id and called_number:
        tenant_id = TENANT_NUMBER_MAP.get(called_number)

    if not tenant_id:
        tenant_id = DEFAULT_TENANT_ID

    token = TENANT_TOKENS.get(tenant_id)
    return {"tenant_id": tenant_id, "called_number": called_number, "token": token}


def _build_url(base: str, path: str) -> str:
    base_clean = base.rstrip("/")
    path_clean = path.lstrip("/")
    return f"{base_clean}/{path_clean}"


async def _post_json(url: str, headers: Dict[str, str], payload: Dict[str, Any]) -> httpx.Response:
    async with httpx.AsyncClient(timeout=10.0) as client:
        return await client.post(url, headers=headers, json=payload)


async def _get_json(url: str, headers: Dict[str, str]) -> httpx.Response:
    async with httpx.AsyncClient(timeout=10.0) as client:
        return await client.get(url, headers=headers)


async def _get_or_create_customer(
    logger: logging.Logger,
    headers: Dict[str, str],
    company_name: str,
    contact_person: str,
    phone: Optional[str],
    email: Optional[str],
) -> Optional[int]:
    """
    Try to find a fuzzy match; create if none. If already exists (409), use existingCustomerId.
    """
    url = _build_url(BACKEND_BASE_URL, CUSTOMER_PATH)
    payload = {
        "customer_name": company_name,
        "contact_person": contact_person,
        "phone_number": phone,
        "email": email,
        "general_notes": "Created via voice agent",
    }

    def _norm(val: Optional[str]) -> str:
        if not val:
            return ""
        return re.sub(r"[^a-z0-9]", "", val.lower())

    def _best_match(customers: list[dict], target: str) -> Optional[int]:
        target_n = _norm(target)
        best = (0.0, None)
        for c in customers:
            name = c.get("customer_name") or c.get("name") or ""
            score = SequenceMatcher(None, target_n, _norm(name)).ratio()
            if score > best[0]:
                best = (score, c.get("id") or c.get("customer_id"))
        # require a solid match threshold
        return best[1] if best[0] >= 0.82 else None

    list_resp = None
    try:
        list_resp = await _get_json(url, headers)
        if list_resp.status_code == 200:
            candidates = list_resp.json()
            match_id = _best_match(candidates if isinstance(candidates, list) else [], company_name)
            if match_id:
                return int(match_id)
    except Exception:
        logger.warning("Customer list fetch failed; proceeding to create", exc_info=True)

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
            logger.error("Customer exists but no ID returned", extra={"body": resp.text})
            return None
        logger.error("Customer create failed", extra={"status": resp.status_code, "body": resp.text})
        return None
    except Exception:
        logger.error("Exception creating customer", exc_info=True)
        return None


@function_tool
async def get_sales_order_status(ctx: RunContext, sales_order_number: str) -> str:
    """
    Fetch a sales order by ID/number. If a non-numeric SO number is provided (e.g., "SO-2025-00066"),
    fall back to scanning open sales orders and matching by sales_order_number.
    """
    logger = logging.getLogger("phone-assistant")
    job_ctx = get_job_context()
    if job_ctx is None:
        logger.error("Failed to get job context")
        return "error"

    tenant_ctx = _resolve_tenant(job_ctx)
    tenant_id = tenant_ctx["tenant_id"]
    token = tenant_ctx["token"]

    if not BACKEND_BASE_URL:
        logger.error("AGENT_BACKEND_BASE_URL/BACKEND_BASE_URL is not set")
        return "error"

    headers = {
        "Content-Type": "application/json",
        "x-tenant-id": tenant_id,
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async def fetch_by_id(so_id: str) -> Optional[Dict[str, Any]]:
        url = _build_url(BACKEND_BASE_URL, f"{SALES_ORDER_PATH.rstrip('/')}/{so_id}")
        resp = await _get_json(url, headers)
        if resp.status_code != 200:
            return None
        data = resp.json()
        return data if isinstance(data, dict) else None

    try:
        data: Optional[Dict[str, Any]] = None
        if sales_order_number.isdigit():
            data = await fetch_by_id(sales_order_number)
        else:
            # Non-numeric: search open orders and match on sales_order_number
            list_url = _build_url(BACKEND_BASE_URL, f"{SALES_ORDER_PATH.rstrip('/')}")
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(list_url, headers=headers, params={"status": "open"})
            if resp.status_code == 200 and isinstance(resp.json(), list):
                candidates = resp.json()
                for so in candidates:
                    if _norm_value(so.get("sales_order_number")) == _norm_value(sales_order_number):
                        data = so
                        break
            # If still not found and numeric-ish, attempt direct fetch
            if data is None and any(ch.isdigit() for ch in sales_order_number):
                data = await fetch_by_id(sales_order_number)

        if not data:
            logger.error("Sales order fetch failed", extra={"status": "not_found"})
            return "error"

        payload = {
            "sales_order_id": data.get("sales_order_id") or data.get("id"),
            "sales_order_number": data.get("sales_order_number") or data.get("sales_order_id"),
            "status": data.get("status"),
            "customer_name": data.get("customer_name"),
            "product_description": data.get("product_description"),
            "unit_number": data.get("unit_number"),
            "vin_number": data.get("vin_number"),
            "last_updated": data.get("updated_at") or data.get("updatedAt"),
            "last_profile_name": data.get("last_profile_name") or data.get("assigned_to"),
        }
        return json.dumps(payload, ensure_ascii=False)
    except Exception:
        logger.error("Exception fetching sales order status", exc_info=True)
        return "error"


def _build_product_name(issue: str, make: Optional[str], model: Optional[str], year: Optional[str]) -> str:
    base = issue.strip() if issue else ""
    if not base:
        parts = [p for p in [year, make, model] if p]
        base = " ".join(parts) if parts else "Service request"
    return base[:120] or "Service request"


@function_tool
async def create_sales_order(
    ctx: RunContext,
    caller_name: str,
    company_name: str,
    contact_phone: Optional[str],
    contact_email: Optional[str],
    unit_number: Optional[str],
    vin: Optional[str],
    make: Optional[str],
    model: Optional[str],
    year: Optional[str],
    issue_description: str,
    notes: Optional[str] = None,
) -> str:
    """
    Create a sales order in the backend for the current tenant.
    Always uses the tenant derived from the called number or room metadata; user input is ignored for tenant selection.
    """
    logger = logging.getLogger("phone-assistant")
    job_ctx = get_job_context()
    if job_ctx is None:
        logger.error("Failed to get job context")
        return "error"

    tenant_ctx = _resolve_tenant(job_ctx)
    tenant_id = tenant_ctx["tenant_id"]
    token = tenant_ctx["token"]

    if not BACKEND_BASE_URL:
        logger.error("AGENT_BACKEND_BASE_URL/BACKEND_BASE_URL is not set")
        return "error"

    url = _build_url(BACKEND_BASE_URL, SALES_ORDER_PATH)
    headers = {
        "Content-Type": "application/json",
        "x-tenant-id": tenant_id,
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    # 1) Ensure customer exists or create
    customer_id = await _get_or_create_customer(
        logger,
        headers,
        company_name=company_name,
        contact_person=caller_name,
        phone=contact_phone,
        email=contact_email,
    )
    if not customer_id:
        logger.error("Failed to resolve customer_id; aborting sales order create")
        return "error"

    product_name = _build_product_name(issue_description, make, model, year)
    product_description = issue_description or product_name

    payload = {
        "customer_id": customer_id,
        "product_name": product_name,
        "product_description": product_description,
        "vin_number": vin or "unknown",
        "unit_number": unit_number or "",
        "vehicle_make": make or "",
        "vehicle_model": model or "",
        "status": "Open",
        "source": "voice-agent",
        "notes": notes,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code >= 300:
            logger.error(
                "Sales order creation failed",
                extra={
                    "status": resp.status_code,
                    "body": resp.text,
                    "tenant_id": tenant_id,
                    "called_number": tenant_ctx["called_number"],
                },
            )
            return "error"

        logger.info(
            "Sales order created",
            extra={"tenant_id": tenant_id, "called_number": tenant_ctx["called_number"]},
        )
        return "created"
    except Exception as e:
        logger.error("Exception creating sales order", exc_info=True)
        return "error"


@function_tool
async def customer_lookup(ctx: RunContext, company_name: str) -> str:
    """Look up customers by company name. Returns likely matches with ids and contact info. Does not create new customers."""
    logger = logging.getLogger("phone-assistant")
    job_ctx = get_job_context()
    if job_ctx is None:
        logger.error("Failed to get job context")
        return "error"

    tenant_ctx = _resolve_tenant(job_ctx)
    tenant_id = tenant_ctx["tenant_id"]
    token = tenant_ctx["token"]

    if not BACKEND_BASE_URL:
        logger.error("AGENT_BACKEND_BASE_URL/BACKEND_BASE_URL is not set")
        return "error"

    url = _build_url(BACKEND_BASE_URL, CUSTOMER_PATH)
    headers = {
        "Content-Type": "application/json",
        "x-tenant-id": tenant_id,
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    def _norm(val: str) -> str:
        return re.sub(r"[^a-z0-9]", "", val.lower())

    try:
        resp = await _get_json(url, headers)
        if resp.status_code != 200:
            logger.error("Customer list fetch failed", extra={"status": resp.status_code, "body": resp.text})
            return "error"
        data = resp.json()
        if not isinstance(data, list):
            return "error"

        target = _norm(company_name)
        scored = []
        for c in data:
            name = c.get("customer_name") or c.get("name") or ""
            score = SequenceMatcher(None, target, _norm(name)).ratio()
            scored.append(
                (
                    score,
                    {
                        "id": c.get("id") or c.get("customer_id"),
                        "customer_name": name,
                        "contact_person": c.get("contact_person"),
                        "phone_number": c.get("telephone_number") or c.get("phone_number"),
                        "email": c.get("email"),
                        "city": c.get("city"),
                    },
                )
            )
        # Sort and keep only reasonably close matches
        scored.sort(key=lambda x: x[0], reverse=True)
        top = [item for item in scored if item[0] >= 0.70][:5]
        if not top:
            return "no_match"
        return json.dumps({"matches": [m for _, m in top]}, ensure_ascii=False)
    except Exception:
        logger.error("Exception during customer lookup", exc_info=True)
        return "error"


@function_tool
async def search_sales_orders(
    ctx: RunContext,
    company_name: Optional[str] = None,
    unit_number: Optional[str] = None,
    vin: Optional[str] = None,
) -> str:
    """
    Search open sales orders by company name and/or unit/VIN (client-side fuzzy). Returns up to 5 matches.
    """
    logger = logging.getLogger("phone-assistant")
    job_ctx = get_job_context()
    if job_ctx is None:
        logger.error("Failed to get job context")
        return "error"

    tenant_ctx = _resolve_tenant(job_ctx)
    tenant_id = tenant_ctx["tenant_id"]
    token = tenant_ctx["token"]

    if not BACKEND_BASE_URL:
        logger.error("AGENT_BACKEND_BASE_URL/BACKEND_BASE_URL is not set")
        return "error"

    if not company_name and not unit_number and not vin:
        return "error"

    url = _build_url(BACKEND_BASE_URL, f"{SALES_ORDER_PATH.rstrip('/')}")
    headers = {
        "Content-Type": "application/json",
        "x-tenant-id": tenant_id,
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    def _score(so: Dict[str, Any]) -> float:
        scores = []
        if company_name:
            scores.append(
                SequenceMatcher(
                    None,
                    _norm_value(company_name),
                    _norm_value(str(so.get("customer_name") or "")),
                ).ratio()
            )
        if unit_number:
            scores.append(
                SequenceMatcher(
                    None,
                    _norm_value(unit_number),
                    _norm_value(str(so.get("unit_number") or "")),
                ).ratio()
            )
        if vin:
            if _norm_value(vin) and _norm_value(vin) == _norm_value(str(so.get("vin_number") or "")):
                scores.append(1.0)
            else:
                scores.append(
                    SequenceMatcher(
                        None,
                        _norm_value(vin),
                        _norm_value(str(so.get("vin_number") or "")),
                    ).ratio()
                )
        return max(scores) if scores else 0.0

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers, params={"status": "open"})
        if resp.status_code not in (200, 201):
            logger.error("Sales order search failed", extra={"status": resp.status_code, "body": resp.text})
            return "error"
        data = resp.json()
        if not isinstance(data, list) or not data:
            return "error"
        scored = []
        for so in data:
            score = _score(so)
            scored.append((score, so))
        scored.sort(key=lambda x: x[0], reverse=True)
        matches = [so for s, so in scored if s >= 0.45][:5]
        if not matches:
            return "no_match"
        return json.dumps({"matches": matches}, ensure_ascii=False)
    except Exception:
        logger.error("Exception searching sales orders", exc_info=True)
        return "error"


@function_tool
async def get_last_profile_status(ctx: RunContext, sales_order_id: int) -> str:
    """
    Get the last profile that worked on a sales order (with phone and last clock times).
    """
    logger = logging.getLogger("phone-assistant")
    job_ctx = get_job_context()
    if job_ctx is None:
        logger.error("Failed to get job context")
        return "error"

    tenant_ctx = _resolve_tenant(job_ctx)
    tenant_id = tenant_ctx["tenant_id"]
    token = tenant_ctx["token"]

    if not BACKEND_BASE_URL:
        logger.error("AGENT_BACKEND_BASE_URL/BACKEND_BASE_URL is not set")
        return "error"

    url = _build_url(BACKEND_BASE_URL, f"{SALES_ORDER_PATH.rstrip('/')}/{sales_order_id}/last-profile")
    headers = {
        "Content-Type": "application/json",
        "x-tenant-id": tenant_id,
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        resp = await _get_json(url, headers)
        if resp.status_code != 200:
            logger.error("Last profile fetch failed", extra={"status": resp.status_code, "body": resp.text})
            return "error"
        data = resp.json()
        if not isinstance(data, dict):
            return "error"
        return json.dumps(data, ensure_ascii=False)
    except Exception:
        logger.error("Exception fetching last profile", exc_info=True)
        return "error"


@function_tool
async def call_tech_for_status(ctx: RunContext, phone_number: str) -> str:
    """
    Dial the provided tech phone into the current room using the outbound SIP trunk.
    Requires LIVEKIT_HTTP_URL (or LIVEKIT_URL), LIVEKIT_API_KEY/SECRET, and LIVEKIT_OUTBOUND_TRUNK_ID.
    """
    logger = logging.getLogger("phone-assistant")
    job_ctx = get_job_context()
    if job_ctx is None:
        logger.error("Failed to get job context")
        return "error"

    livekit_url = os.getenv("LIVEKIT_HTTP_URL") or os.getenv("LIVEKIT_URL")
    api_key = os.getenv("LIVEKIT_API_KEY")
    api_secret = os.getenv("LIVEKIT_API_SECRET")
    trunk_id = os.getenv("LIVEKIT_OUTBOUND_TRUNK_ID") or os.getenv("OUTBOUND_TRUNK_ID")

    if not livekit_url or not api_key or not api_secret or not trunk_id:
        logger.error("Missing LiveKit env (LIVEKIT_HTTP_URL/URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_OUTBOUND_TRUNK_ID)")
        return "error"

    try:
        from livekit import api as lkapi
        from livekit.protocol.sip import CreateSIPParticipantRequest

        client = lkapi.LiveKitAPI(
            url=livekit_url.replace("wss://", "https://").rstrip("/"),
            api_key=api_key,
            api_secret=api_secret,
        )
        room_name = job_ctx.room.name
        dest = phone_number
        if dest.startswith("tel:"):
            dest = dest.replace("tel:", "", 1)
        if not dest.startswith("+"):
            dest = f"+{dest}"

        await client.sip.create_sip_participant(
            CreateSIPParticipantRequest(
                sip_trunk_id=trunk_id,
                sip_call_to=dest,
                room_name=room_name,
                participant_identity=f"sip:{dest}",
                participant_name=dest,
                wait_until_answered=False,
                play_dialtone=True,
            )
        )
        await client.aclose()
        return "dialing"
    except Exception:
        logger.error("Exception dialing tech", exc_info=True)
        return "error"

import asyncio
import json
import os
import time
from typing import Any, Dict, List

import httpx

POLL_INTERVAL_SECONDS = int(os.getenv("REMINDER_POLL_INTERVAL_SECONDS", "300"))  # default 5 minutes
MINUTES_IDLE = int(os.getenv("REMINDER_MINUTES_IDLE", "15"))

BACKEND_URL = os.getenv("AGENT_BACKEND_BASE_URL") or os.getenv("BACKEND_BASE_URL")
# Allow overriding the tenant this worker targets (run one worker per outbound number/tenant)
OUTBOUND_TENANT_ID = os.getenv("OUTBOUND_TENANT_ID")
TENANT_ID = OUTBOUND_TENANT_ID or os.getenv("DEFAULT_TENANT_ID") or os.getenv("TENANT_ID") or "default"
TOKEN = os.getenv("TENANT_AGENT_TOKEN")  # single token, or use mapping if multi-tenant

REMINDERS_PATH = "/api/reminders/idle-employees"

LIVEKIT_URL = os.getenv("LIVEKIT_URL")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")
OUTBOUND_TRUNK_ID = os.getenv("LIVEKIT_OUTBOUND_TRUNK_ID") or os.getenv("OUTBOUND_TRUNK_ID")

TWIRP_ROOM = "/twirp/livekit.RoomService/CreateRoom"
TWIRP_SIP = "/twirp/livekit.SIPService/CreateSIPParticipant"

# Simple cooldown per profile to avoid spamming
COOLDOWN_SECONDS = int(os.getenv("REMINDER_COOLDOWN_SECONDS", "3600"))
_recent_calls: Dict[int, float] = {}


def _can_call(profile_id: int) -> bool:
    ts = _recent_calls.get(profile_id)
    return not ts or (time.time() - ts) >= COOLDOWN_SECONDS


def _mark_called(profile_id: int) -> None:
    _recent_calls[profile_id] = time.time()


def build_headers() -> Dict[str, str]:
    if not BACKEND_URL:
        raise RuntimeError("Set AGENT_BACKEND_BASE_URL or BACKEND_BASE_URL")
    headers = {
        "x-tenant-id": TENANT_ID,
        "Content-Type": "application/json",
    }
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    return headers


async def fetch_idle_employees() -> List[Dict[str, Any]]:
    url = BACKEND_URL.rstrip("/") + REMINDERS_PATH
    headers = build_headers()
    params = {"minutes": MINUTES_IDLE}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, headers=headers, params=params)
    resp.raise_for_status()
    data = resp.json()
    employees = data.get("employees") or []
    # Filter to only those with usable phone_number
    filtered = [
        e for e in employees
        if e.get("phone_number") and str(e["phone_number"]).strip()
    ]
    return filtered


def build_room_token() -> str:
    from livekit import api

    at = api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    at.identity = "reminder-orchestrator"
    at.ttl = 300
    at.add_grants(api.VideoGrants(room_create=True, room_admin=True, room_join=True))
    return at.to_jwt()


async def create_room(room_name: str, metadata: Dict[str, Any]) -> None:
    if not LIVEKIT_URL or not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        raise RuntimeError("Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET")
    token = build_room_token()
    payload = {
        "name": room_name,
        "empty_timeout": 3600,
        "metadata": json.dumps(metadata),
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(
            LIVEKIT_URL.rstrip("/") + TWIRP_ROOM,
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )
    r.raise_for_status()


async def dial_out(room_name: str, to_number: str) -> None:
    if not LIVEKIT_URL or not OUTBOUND_TRUNK_ID:
        raise RuntimeError("Set LIVEKIT_URL and LIVEKIT_OUTBOUND_TRUNK_ID/OUTBOUND_TRUNK_ID")
    token = build_room_token()
    payload = {
        "sip_trunk_id": OUTBOUND_TRUNK_ID,
        "sip_call_to": to_number,
        "room_name": room_name,
        "participant_identity": f"sip:{to_number}",
        "participant_name": to_number,
        "krisp_enabled": True,
        "wait_until_answered": False,
        "play_dialtone": True,
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(
            LIVEKIT_URL.rstrip("/") + TWIRP_SIP,
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )
    r.raise_for_status()


async def call_employee(emp: Dict[str, Any]) -> None:
    profile_id = emp.get("profile_id")
    if profile_id is None or not _can_call(int(profile_id)):
        return

    phone = str(emp.get("phone_number")).strip()
    name = emp.get("profile_name") or "there"
    tenant = TENANT_ID  # this worker is scoped to a single tenant
    room_name = f"reminder-{profile_id}-{int(time.time())}"
    metadata = {
        "tenantId": tenant,
        "employeeName": name,
        "employeePhone": phone,
        "profileId": profile_id,
    }
    await create_room(room_name, metadata)
    await dial_out(room_name, phone)
    _mark_called(int(profile_id))


async def main() -> None:
    if not BACKEND_URL:
        raise RuntimeError("Set AGENT_BACKEND_BASE_URL or BACKEND_BASE_URL")

    while True:
        try:
          idle = await fetch_idle_employees()
          if idle:
              print(f"[reminder-orchestrator] Found {len(idle)} idle employees with phone numbers:")
              for e in idle:
                  print(f"  - {e.get('profile_name','(unknown)')} | {e.get('phone_number')} | profile_id={e.get('profile_id')}")
                  try:
                      await call_employee(e)
                  except Exception as ce:
                      print(f"[reminder-orchestrator] Failed to call {e.get('phone_number')}: {ce}")
          else:
              print("[reminder-orchestrator] No idle employees found.")
        except Exception as e:
          print(f"[reminder-orchestrator] Error fetching idle employees: {e}")

        await asyncio.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    asyncio.run(main())

import json
import logging
from datetime import datetime
from pathlib import Path

from livekit import api
from livekit.agents import function_tool, RunContext, get_job_context


@function_tool
async def transfer_to_human(ctx: RunContext) -> str:
    """Transfer to specialist. Call only after confirming the users name and consent to be transferred."""
    logger = logging.getLogger("phone-assistant")
    job_ctx = get_job_context()
    if job_ctx is None:
        logger.error("Job context not found")
        return "error"

    transfer_to = "tel:+18883658681"

    #find sip participant
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


@function_tool
async def record_summary(ctx: RunContext, summary: str) -> str:
    """Store the final QUOTE SUMMARY for this call so it can be shown in the web UI. Call exactly once at the end of the conversation."""
    logger = logging.getLogger("phone-assistant")

    job_ctx = get_job_context()
    if job_ctx is None:
        logger.error("Failed to get job context")
        return "error"

    room_name = getattr(job_ctx.room, "name", "unknown-room")

    metadata = {}
    try:
        job = getattr(job_ctx, "job", None)
        raw_metadata = getattr(job, "metadata", None) if job is not None else None
        if raw_metadata:
            metadata = json.loads(raw_metadata)
    except Exception as e:
        logger.warning(f"Failed to parse job metadata for room {room_name}: {e}", exc_info=True)

    summaries_dir = Path(__file__).parent / "summaries"
    summaries_dir.mkdir(exist_ok=True)

    payload = {
        "room_name": room_name,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "summary": summary,
        "metadata": metadata,
    }

    output_path = summaries_dir / f"{room_name}.json"

    try:
        output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        logger.info(f"Recorded summary for room {room_name} at {output_path}")
        return "recorded"
    except Exception as e:
        logger.error(f"Failed to write summary file for room {room_name}: {e}", exc_info=True)
        return "error"

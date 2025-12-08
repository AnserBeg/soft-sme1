import asyncio
from dotenv import load_dotenv

from livekit import agents
from livekit.agents import Agent, AgentSession, RoomInputOptions
from livekit.plugins import noise_cancellation, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from prompt import AGENT_INSTRUCTIONS, SESSION_INSTRUCTIONS
from tool import (
    end_call,
    search_open_sales_orders,
    create_sales_order,
    clock_in_time_entry,
)

load_dotenv(".env.local")


class OutboundReminderAgent(Agent):
    def __init__(self):
        super().__init__(
            instructions=AGENT_INSTRUCTIONS,
            tools=[
                end_call,
                search_open_sales_orders,
                create_sales_order,
                clock_in_time_entry,
            ],
        )


async def entrypoint(ctx: agents.JobContext):
    session = AgentSession(
        stt="deepgram/nova-3:en",
        llm="google/gemini-2.5-flash",
        tts="elevenlabs/eleven_flash_v2:cgSgspJ2msm6clMCkdW9",
        vad=silero.VAD.load(),
        turn_detection=MultilingualModel(),
    )

    await session.start(
        room=ctx.room,
        agent=OutboundReminderAgent(),
        room_input_options=RoomInputOptions(
            noise_cancellation=noise_cancellation.BVC(),
        ),
    )

    # Wait briefly for SIP participant to join before speaking
    async def wait_for_participant(timeout: float = 10.0) -> None:
        elapsed = 0.0
        while elapsed < timeout:
            if ctx.room.remote_participants:
                return
            await asyncio.sleep(0.5)
            elapsed += 0.5

    await wait_for_participant()

    # Kick off the conversation using the session instructions
    await session.generate_reply(instructions=SESSION_INSTRUCTIONS)


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            initialize_process_timeout=60.0,
            agent_name="Clock-In Reminder",
        )
    )

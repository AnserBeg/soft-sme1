from dotenv import load_dotenv

from livekit import agents
from livekit.agents import Agent, AgentSession, RoomInputOptions
from livekit.plugins import noise_cancellation, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from prompt import AGENT_INSTRUCTIONS, SESSION_INSTRUCTIONS

load_dotenv(".env.local")


class OutboundReminderAgent(Agent):
    def __init__(self):
        super().__init__(
            instructions=AGENT_INSTRUCTIONS,
            tools=[],  # reminder only; add tools if you later want clock-in actions
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

    await session.generate_reply(
        instructions=SESSION_INSTRUCTIONS,
    )


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            initialize_process_timeout=60.0,
            agent_name="Clock-In Reminder",
        )
    )

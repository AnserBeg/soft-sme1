from dotenv import load_dotenv

from livekit import agents
from livekit.agents import AgentSession, Agent, RoomInputOptions
from livekit.plugins import noise_cancellation, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from prompt import AGENT_INSTRUCTIONS, SESSION_INSTRUCTIONS
from tool import (
    create_sales_order,
    customer_lookup,
    end_call,
    transfer_to_human,
    get_sales_order_status,
    get_last_profile_status,
    call_tech_for_status,
    search_sales_orders,
)

load_dotenv(".env.local")


class Assistant(Agent):
    def __init__(self):
        super().__init__(
            instructions=AGENT_INSTRUCTIONS,
            tools=[
                end_call,
                transfer_to_human,
                customer_lookup,
                search_sales_orders,
                create_sales_order,
                get_sales_order_status,
                get_last_profile_status,
                call_tech_for_status,
            ]
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
        agent=Assistant(),
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
            # Allow more time for inference processes (e.g., turn detector) to initialize
            initialize_process_timeout=60.0,
            agent_name="Jamie-Parts Orderer"
        )
    )

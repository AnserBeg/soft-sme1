#!/usr/bin/env python3
"""
Aiven AI Agent Server
========================

FastAPI server that provides AI assistant capabilities for the Aiven application.
This server runs as a child process of the main Node.js backend.
"""

import asyncio
import os
import sys
import logging
import platform
import time
import uuid
import pathlib
import shutil
from datetime import datetime, timezone
from dataclasses import asdict
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import uvicorn
from dotenv import load_dotenv
from langchain_google_genai import GoogleGenerativeAIEmbeddings

# Add current directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:  # pragma: no cover - support both package and script execution
    from .agent import AivenAgent
    from .cache_setup import StoragePaths, configure_cache_paths
    from .conversation_manager import ConversationManager, DB_UNAVAILABLE_MESSAGE
    from .db import database_url_present, get_conn, reset_connection
    from .rag_tool import set_shared_embedding_model
    from .schema_introspector import get_schema_introspector
except ImportError:  # pragma: no cover - fallback when executed as script
    from agent import AivenAgent
    from cache_setup import StoragePaths, configure_cache_paths
    from conversation_manager import ConversationManager, DB_UNAVAILABLE_MESSAGE
    from db import database_url_present, get_conn, reset_connection
    from rag_tool import set_shared_embedding_model
    from schema_introspector import get_schema_introspector

# Load environment variables
load_dotenv()

# Configure logging early so startup bootstrap logs are captured
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def _int_from_env(name: str, default: int, minimum: int = 1) -> int:
    """Read a positive integer value from the environment."""

    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        logger.warning("Invalid integer for %s: %s. Using default %s.", name, raw_value, default)
        return default

    return max(parsed, minimum)


def _float_from_env(name: str, default: float, minimum: float = 0.0) -> float:
    """Read a floating point value from the environment with a lower bound."""

    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    try:
        parsed = float(raw_value)
    except (TypeError, ValueError):
        logger.warning("Invalid float for %s: %s. Using default %.2f.", name, raw_value, default)
        return default

    return max(parsed, minimum)


def _bootstrap_configured_directories() -> None:
    """Ensure cache directories provided via environment variables exist."""

    env_keys = (
        "AGENT_DATA_DIR",
        "HF_HOME",
        "TRANSFORMERS_CACHE",
        "SENTENCE_TRANSFORMERS_HOME",
        "XDG_CACHE_HOME",
    )

    for key in env_keys:
        value = os.getenv(key)
        if not value:
            continue

        path_value = pathlib.Path(value).expanduser()
        os.environ[key] = str(path_value)
        os.makedirs(path_value, exist_ok=True)
        logger.info("Ensured %s directory exists at %s", key, path_value)

        # XDG_CACHE_HOME may contain multiple caches; ensure Hugging Face cache subdir exists as well
        if key == "XDG_CACHE_HOME":
            hf_cache_path = path_value / "huggingface"
            os.makedirs(hf_cache_path, exist_ok=True)
            logger.info("Ensured huggingface cache directory exists at %s", hf_cache_path)


_bootstrap_configured_directories()

# Ensure persistent cache directories are configured
STORAGE_PATHS: StoragePaths = configure_cache_paths()

# Initialize FastAPI app
app = FastAPI(
    title="Aiven AI Agent",
    description="AI Assistant for Aiven Inventory Management System",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize AI agent and conversation manager
MODEL_NAME = os.getenv("AI_AGENT_EMBEDDING_MODEL", "models/text-embedding-004")
MODEL_LOAD_MAX_ATTEMPTS = _int_from_env("AI_AGENT_MODEL_RETRIES", 3, minimum=1)
MODEL_LOAD_RETRY_DELAY_SECONDS = _float_from_env("AI_AGENT_MODEL_RETRY_DELAY", 3.0, minimum=0.1)
STARTUP_MAX_ATTEMPTS = _int_from_env("AI_AGENT_STARTUP_RETRIES", 3, minimum=1)
STARTUP_RETRY_DELAY_SECONDS = _float_from_env("AI_AGENT_STARTUP_RETRY_DELAY", 15.0, minimum=1.0)

ai_agent: AivenAgent | None = None
conversation_manager = ConversationManager()
IS_READY: bool = False
startup_error: Optional[str] = None
startup_attempts: int = 0
last_startup_duration: Optional[float] = None

# Keep a handle to the shared embedding model so repeated startup attempts reuse configuration
_shared_embedding_model: Any | None = None


def _raise_if_db_unavailable(exc: Exception) -> None:
    if isinstance(exc, RuntimeError) and str(exc) == DB_UNAVAILABLE_MESSAGE:
        raise HTTPException(status_code=503, detail="Database temporarily unavailable") from exc


def _build_embedding_client() -> GoogleGenerativeAIEmbeddings:
    """Create a Google Generative AI embedding client using the Gemini API."""

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY environment variable must be set for documentation embeddings"
        )

    return GoogleGenerativeAIEmbeddings(model=MODEL_NAME, google_api_key=api_key)


async def _load_embedding_client() -> Any:
    """Load the shared embedding client with retries."""

    last_error: Exception | None = None

    for attempt in range(1, MODEL_LOAD_MAX_ATTEMPTS + 1):
        start_perf = time.perf_counter()
        start_wall = datetime.utcnow().isoformat()
        logger.info(
            "Initializing Gemini embedding model '%s' (attempt %s/%s started at %s UTC).",
            MODEL_NAME,
            attempt,
            MODEL_LOAD_MAX_ATTEMPTS,
            start_wall,
        )

        try:
            model = _build_embedding_client()
        except Exception as exc:  # pylint: disable=broad-except
            elapsed = time.perf_counter() - start_perf
            end_wall = datetime.utcnow().isoformat()
            message = (
                f"Failed to initialize embedding model '{MODEL_NAME}' on attempt {attempt}/{MODEL_LOAD_MAX_ATTEMPTS} "
                f"after {elapsed:.2f}s (ended at {end_wall} UTC): {exc}"
            )
            model_error = RuntimeError(message)
            model_error.__cause__ = exc
            last_error = model_error
        else:
            elapsed = time.perf_counter() - start_perf
            end_wall = datetime.utcnow().isoformat()
            logger.info(
                "Initialized Gemini embedding model '%s' in %.2f seconds on attempt %s/%s (completed at %s UTC).",
                MODEL_NAME,
                elapsed,
                attempt,
                MODEL_LOAD_MAX_ATTEMPTS,
                end_wall,
            )
            return model

        logger.warning("%s", last_error)

        if attempt < MODEL_LOAD_MAX_ATTEMPTS:
            backoff = MODEL_LOAD_RETRY_DELAY_SECONDS * attempt
            logger.info(
                "Retrying Gemini embedding client initialization in %.2f seconds (attempt %s/%s failed).",
                backoff,
                attempt,
                MODEL_LOAD_MAX_ATTEMPTS,
            )
            await asyncio.sleep(backoff)

    assert last_error is not None
    raise last_error


async def _initialize_agent_once() -> None:
    """Perform a single initialization attempt for the AI agent."""

    global ai_agent, _shared_embedding_model

    # Load shared embedding model first so downstream tooling can reuse it
    shared_model = _shared_embedding_model
    if shared_model is None:
        shared_model = await _load_embedding_client()
        _shared_embedding_model = shared_model
    else:
        logger.info("Reusing cached Gemini embedding client already in memory")

    set_shared_embedding_model(shared_model)

    candidate_agent = AivenAgent()

    try:
        await candidate_agent.initialize()
        logger.info("AI Agent core initialized successfully")
    except Exception:
        # Ensure the shared model isn't exposed until the next retry reconfigures the agent
        set_shared_embedding_model(None)
        raise

    # Ingest documentation when enabled
    if candidate_agent.documentation_enabled:
        logger.info("Documentation ingestion enabled, starting ingestion...")
        try:
            await candidate_agent.ingest_documentation()
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Documentation ingestion failed: %s", exc)
        else:
            logger.info("Documentation ingestion completed")
    else:
        logger.info("Documentation ingestion skipped (AI_ENABLE_DOCUMENTATION disabled)")

    ai_agent = candidate_agent


# Pydantic models
class ChatRequest(BaseModel):
    message: str
    user_id: Optional[int] = None
    conversation_id: Optional[str] = None
    conversation_history: Optional[List[Dict[str, Any]]] = None

class ChatResponse(BaseModel):
    response: str
    sources: List[str]
    confidence: float
    tool_used: str
    conversation_id: str
    actions: Optional[List[Dict[str, Any]]] = None
    action_message: Optional[str] = None
    action_catalog: Optional[List[Dict[str, Any]]] = None
    planner_plan: Optional[Dict[str, Any]] = None
    documentation_subagent: Optional[List[Dict[str, Any]]] = None
    processing_time: Optional[float] = None
    critic_feedback: Optional[Dict[str, Any]] = None
    documentation_results: Optional[List[Dict[str, Any]]] = None
    row_selection_candidates: Optional[List[Dict[str, Any]]] = None
    safety_results: Optional[List[Dict[str, Any]]] = None

class DocumentationQARequest(BaseModel):
    question: str
    step_id: Optional[str] = None
    conversation_id: Optional[str] = None
    user_id: Optional[int] = None
    session_id: Optional[int] = None
    focus_hints: Optional[Dict[str, Any]] = None
    conversation_tail: Optional[List[Dict[str, str]]] = None
    conversation_history: Optional[List[Dict[str, Any]]] = None
    planner_payload: Optional[Dict[str, Any]] = None


class DocumentationQAResponse(BaseModel):
    step_id: str
    status: str
    answer: Optional[str] = None
    citations: List[Dict[str, Any]] = Field(default_factory=list)
    reasoning: Optional[str] = None
    metrics: Dict[str, Any]
    result_key: Optional[str] = None
    error: Optional[str] = None

class InitializeResponse(BaseModel):
    status: str
    message: str
    details: Optional[Dict[str, Any]] = None

class StatsResponse(BaseModel):
    total_conversations: int
    total_messages: int
    vector_db_chunks: int
    tools_used: Dict[str, int]
    average_response_time: float


class SchemaRefreshRequest(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=120)


class SchemaRefreshResponse(BaseModel):
    schema_version: str
    schema_hash: str
    refreshed_at: str

@app.post("/schema/refresh", response_model=SchemaRefreshResponse)
async def refresh_schema_endpoint(
    request: Request,
    payload: SchemaRefreshRequest,
) -> SchemaRefreshResponse:
    secret = os.getenv("AI_SCHEMA_REFRESH_SECRET")
    normalized_secret = secret.strip() if secret else None
    provided_secret = request.headers.get("x-refresh-secret")
    provided_normalized = provided_secret.strip() if provided_secret else None

    if normalized_secret:
        if not provided_normalized:
            raise HTTPException(status_code=403, detail="Missing schema refresh secret")
        if provided_normalized != normalized_secret:
            raise HTTPException(status_code=403, detail="Invalid schema refresh secret")

    reason = payload.reason or "manual"
    try:
        cache = get_schema_introspector().refresh()
        logger.info("Schema cache refreshed via API (reason=%s)", reason)
    except Exception as exc:  # pylint: disable=broad-except
        logger.exception("Schema refresh failed: %s", exc)
        raise HTTPException(status_code=500, detail="Schema refresh failed") from exc

    return SchemaRefreshResponse(
        schema_version=cache.schema_version,
        schema_hash=cache.schema_hash,
        refreshed_at=datetime.utcnow().replace(tzinfo=timezone.utc).isoformat(),
    )


@app.on_event("startup")
async def startup_event():
    """Initialize the AI agent on startup with readiness tracking."""

    global IS_READY, startup_error, startup_attempts, last_startup_duration, ai_agent

    IS_READY = False
    startup_error = None
    startup_attempts = 0
    last_startup_duration = None
    ai_agent = None

    logger.info("Starting Aiven AI Agent initialization sequence")
    logger.info("Python version: %s", platform.python_version())
    logger.info("DATABASE_URL present: %s", "true" if database_url_present() else "false")
    logger.info("AGENT_DATA_DIR: %s", os.getenv("AGENT_DATA_DIR", "<not set>"))
    for label, path in STORAGE_PATHS.to_mapping().items():
        logger.info("Storage directory [%s]: %s", label, path)

    for attempt in range(1, STARTUP_MAX_ATTEMPTS + 1):
        startup_attempts = attempt
        attempt_start = time.perf_counter()
        logger.info(
            "AI Agent startup attempt %s/%s", attempt, STARTUP_MAX_ATTEMPTS
        )

        try:
            await _initialize_agent_once()
        except Exception as exc:  # pylint: disable=broad-except
            elapsed = time.perf_counter() - attempt_start
            last_startup_duration = elapsed
            startup_error = str(exc)
            ai_agent = None
            logger.exception(
                "AI Agent startup attempt %s/%s failed after %.2f seconds: %s",
                attempt,
                STARTUP_MAX_ATTEMPTS,
                elapsed,
                exc,
            )

            if attempt < STARTUP_MAX_ATTEMPTS:
                logger.info(
                    "Retrying AI Agent startup in %.2f seconds", STARTUP_RETRY_DELAY_SECONDS
                )
                await asyncio.sleep(STARTUP_RETRY_DELAY_SECONDS)
            continue

        last_startup_duration = time.perf_counter() - attempt_start
        logger.info(
            "AI Agent startup attempt %s/%s completed in %.2f seconds",
            attempt,
            STARTUP_MAX_ATTEMPTS,
            last_startup_duration,
        )
        startup_error = None
        if not IS_READY:
            logger.info("AI Agent ready")
        IS_READY = True
        break

    if not IS_READY:
        logger.error(
            "AI Agent failed to initialize after %s attempts. Service will remain unavailable until manually reinitialized.",
            STARTUP_MAX_ATTEMPTS,
        )

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    global IS_READY

    logger.info("Shutting down AI Agent...")
    IS_READY = False
    if ai_agent:
        await ai_agent.cleanup()


@app.get("/healthz")
async def readiness_health_check():
    """Readiness probe that reports when initialization has completed."""

    status = "ok" if IS_READY else "starting"
    status_code = 200 if IS_READY else 503
    payload: Dict[str, Any] = {"status": status}
    return JSONResponse(status_code=status_code, content=payload)


@app.get("/health")
async def legacy_health_check():
    """Backward compatible health endpoint."""

    return await readiness_health_check()


@app.get("/storage-health")
async def storage_health_check():
    """Report storage directory availability and free space."""

    def _directory_health(name: str, path: os.PathLike[str] | str) -> Dict[str, Any]:
        dir_path = pathlib.Path(path)
        exists = dir_path.exists()
        disk_probe = dir_path if exists else dir_path.parent
        free_bytes: Optional[int] = None
        if disk_probe.exists():
            usage = shutil.disk_usage(disk_probe)
            free_bytes = usage.free
        return {
            "path": str(dir_path),
            "exists": exists,
            "free_bytes": free_bytes,
        }

    directories = {
        "data_root": STORAGE_PATHS.data_root,
        "vectors": STORAGE_PATHS.vectors_dir,
        "models": STORAGE_PATHS.models_dir,
        "cache": STORAGE_PATHS.cache_dir,
    }

    return {
        "directories": {
            name: _directory_health(name, path) for name, path in directories.items()
        }
    }


@app.get("/db-health")
async def database_health_check():
    """Database health endpoint that reports connectivity status."""

    def _check_database() -> Dict[str, Any]:
        conn = get_conn()
        if conn is None:
            logger.warning("Database health check: connection unavailable")
            return {"db": "down", "error": "connection unavailable"}

        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Database health check failed: %s", exc)
            reset_connection()
            return {"db": "down", "error": str(exc)}

        return {"db": "ok"}

    return await run_in_threadpool(_check_database)

@app.post("/initialize", response_model=InitializeResponse)
async def initialize_agent():
    """Initialize the AI agent (re-initialize if needed)"""
    try:
        global ai_agent, IS_READY, startup_attempts, last_startup_duration, startup_error
        if ai_agent:
            await ai_agent.cleanup()

        IS_READY = False
        attempt_start = time.perf_counter()
        await _initialize_agent_once()
        last_startup_duration = time.perf_counter() - attempt_start
        startup_attempts += 1
        startup_error = None
        if not IS_READY:
            logger.info("AI Agent ready")
        IS_READY = True

        return InitializeResponse(
            status="success",
            message="AI Agent initialized successfully",
            details={"agent_ready": True}
        )
    except Exception as e:
        logger.error(f"Initialization failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Process a chat message"""
    try:
        if not ai_agent:
            raise HTTPException(status_code=503, detail="AI Agent not initialized")
        
        supplied_history = request.conversation_history or []
        persist_locally = len(supplied_history) == 0

        if request.conversation_id:
            conversation_id = request.conversation_id
        else:
            conversation_id = conversation_manager.create_conversation(user_id=request.user_id)

        if persist_locally:
            conversation_manager.add_message(
                conversation_id=conversation_id,
                message=request.message,
                is_user=True
            )
            history = conversation_manager.get_conversation_history(conversation_id)
        else:
            history = supplied_history

        # Process with AI agent
        response = await ai_agent.process_message(
            message=request.message,
            conversation_history=history,
            user_id=request.user_id,
            conversation_id=conversation_id
        )

        if persist_locally:
            conversation_manager.add_message(
                conversation_id=conversation_id,
                message=response["response"],
                is_user=False,
                metadata={
                    "sources": response["sources"],
                    "confidence": response["confidence"],
                    "tool_used": response["tool_used"],
                    "planner_plan": response.get("planner_plan"),
                    "documentation_subagent": response.get("documentation_subagent"),
                }
            )

        # Add AI response to conversation
        conversation_manager.add_message(
            conversation_id=conversation_id,
            message=response["response"],
            is_user=False,
            metadata={
                "sources": response["sources"],
                "confidence": response["confidence"],
                "tool_used": response["tool_used"],
                "actions": response.get("actions", []),
                "action_message": response.get("action_message"),
                "planner_plan": response.get("planner_plan"),
                "documentation_subagent": response.get("documentation_subagent"),
            }
        )

        return ChatResponse(
            response=response["response"],
            sources=response["sources"],
            confidence=response["confidence"],
            tool_used=response["tool_used"],
            conversation_id=conversation_id,
            actions=response.get("actions", []),
            action_message=response.get("action_message"),
            action_catalog=response.get("action_catalog", []),
            planner_plan=response.get("planner_plan"),
            documentation_subagent=response.get("documentation_subagent"),
            processing_time=response.get("processing_time"),
            critic_feedback=response.get("critic_feedback"),
            documentation_results=response.get("documentation_results"),
            row_selection_candidates=response.get("row_selection_candidates"),
            safety_results=response.get("safety_results"),
        )

    except RuntimeError as exc:
        _raise_if_db_unavailable(exc)
        raise
    except Exception as e:
        logger.error(f"Chat processing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/subagents/documentation-qa", response_model=DocumentationQAResponse)
async def invoke_documentation_qa(request: DocumentationQARequest):
    """Invoke the documentation QA subagent directly for manual testing."""

    if not ai_agent or not ai_agent.documentation_qa_subagent:
        raise HTTPException(status_code=503, detail="Documentation QA subagent is not available")

    history = request.conversation_history or []
    if not history and request.conversation_id:
        try:
            history = conversation_manager.get_conversation_history(request.conversation_id)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning("Failed to load conversation history for documentation QA endpoint: %s", exc)
            history = []

    conversation_tail = request.conversation_tail
    if conversation_tail is None:
        conversation_tail = ai_agent._conversation_tail_from_history(history)  # type: ignore[attr-defined]

    focus_hints = request.focus_hints or {}
    if not isinstance(focus_hints, dict):
        focus_hints = {}

    planner_payload = request.planner_payload or {}
    if not isinstance(planner_payload, dict):
        planner_payload = {}

    step_id = request.step_id or str(uuid.uuid4())
    session_id = request.session_id
    if session_id is None:
        session_id = ai_agent._resolve_session_id(  # type: ignore[attr-defined]
            request.question,
            request.conversation_id,
            request.user_id,
        )

    result = await ai_agent.documentation_qa_subagent.execute(
        step_id=step_id,
        question=request.question,
        conversation_tail=conversation_tail,
        focus_hints=focus_hints,
        planner_payload=planner_payload,
        session_id=session_id,
    )

    return DocumentationQAResponse(**asdict(result))

@app.get("/conversation/{conversation_id}")
async def get_conversation(conversation_id: str):
    """Get conversation history"""
    try:
        messages = conversation_manager.get_conversation_history(conversation_id)
        return {
            "conversation_id": conversation_id,
            "messages": messages
        }
    except RuntimeError as exc:
        _raise_if_db_unavailable(exc)
        raise
    except Exception as e:
        logger.error(f"Failed to get conversation: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/conversation/{conversation_id}")
async def clear_conversation(conversation_id: str):
    """Clear conversation history"""
    try:
        conversation_manager.clear_conversation(conversation_id)
        return {"message": "Conversation cleared successfully"}
    except RuntimeError as exc:
        _raise_if_db_unavailable(exc)
        raise
    except Exception as e:
        logger.error(f"Failed to clear conversation: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/stats", response_model=StatsResponse)
async def get_stats():
    """Get AI agent statistics"""
    try:
        stats = conversation_manager.get_statistics()

        if ai_agent:
            agent_stats = await ai_agent.get_statistics()
            stats.update(agent_stats)

        return StatsResponse(**stats)
    except RuntimeError as exc:
        _raise_if_db_unavailable(exc)
        raise
    except Exception as e:
        logger.error(f"Failed to get statistics: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ingest-docs")
async def ingest_documentation(background_tasks: BackgroundTasks):
    """Ingest documentation into vector database"""
    try:
        if not ai_agent:
            raise HTTPException(status_code=503, detail="AI Agent not initialized")
        
        if not ai_agent.documentation_enabled:
            return {"message": "Documentation ingestion is disabled by configuration"}

        # Run ingestion in background
        background_tasks.add_task(ai_agent.ingest_documentation)

        return {"message": "Documentation ingestion started in background"}
    except Exception as e:
        logger.error(f"Failed to start documentation ingestion: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    # Bind explicitly to the local interface to avoid accidental exposure
    host_override = os.getenv("AI_AGENT_HOST")
    port_override = os.getenv("AI_AGENT_PORT")

    if host_override and host_override.strip() != "127.0.0.1":
        logger.warning(
            "AI_AGENT_HOST override (%s) ignored; binding to 127.0.0.1 for security.",
            host_override,
        )
    if port_override and port_override.strip() not in {"", "15000"}:
        logger.warning(
            "AI_AGENT_PORT override (%s) ignored; binding to port 15000.",
            port_override,
        )

    host = "127.0.0.1"
    port = 15000

    logger.info("Starting AI Agent server on %s:%s", host, port)

    uvicorn.run(
        "ai_agent.app:app",
        host=host,
        port=port,
        reload=False,  # Disable reload for production
        log_level="info",
        workers=1,
    )

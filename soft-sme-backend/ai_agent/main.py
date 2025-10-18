#!/usr/bin/env python3
"""
Aiven AI Agent Server
========================

FastAPI server that provides AI assistant capabilities for the Aiven application.
This server runs as a child process of the main Node.js backend.
"""

import os
import sys
import logging
import platform
import uuid
import pathlib
import shutil
from dataclasses import asdict
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn
from dotenv import load_dotenv

# Add current directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:  # pragma: no cover - support both package and script execution
    from .cache_setup import StoragePaths, configure_cache_paths
    from .db import database_url_present, get_conn, reset_connection
    from .conversation_manager import DB_UNAVAILABLE_MESSAGE
except ImportError:  # pragma: no cover - fallback when executed as script
    from cache_setup import StoragePaths, configure_cache_paths
    from db import database_url_present, get_conn, reset_connection
    from conversation_manager import DB_UNAVAILABLE_MESSAGE

from agent import AivenAgent
from conversation_manager import ConversationManager

# Load environment variables
load_dotenv()

# Ensure persistent cache directories are configured
STORAGE_PATHS: StoragePaths = configure_cache_paths()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

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
ai_agent = None
conversation_manager = ConversationManager()


def _raise_if_db_unavailable(exc: Exception) -> None:
    if isinstance(exc, RuntimeError) and str(exc) == DB_UNAVAILABLE_MESSAGE:
        raise HTTPException(status_code=503, detail="Database temporarily unavailable") from exc


# Pydantic models
class ChatRequest(BaseModel):
    message: str
    user_id: Optional[int] = None
    conversation_id: Optional[str] = None
    conversation_history: Optional[List[Dict[str, Any]]] = None

class ChatResponse(BaseModel):
    response: str
    sources: list[str]
    confidence: float
    tool_used: str
    conversation_id: str
    actions: list[Dict[str, Any]] | None = None
    action_message: Optional[str] = None
    action_catalog: list[Dict[str, Any]] | None = None
    planner_plan: Optional[Dict[str, Any]] = None
    documentation_subagent: Optional[List[Dict[str, Any]]] = None

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

@app.on_event("startup")
async def startup_event():
    """Initialize the AI agent on startup"""
    global ai_agent
    try:
        logger.info("Starting Aiven AI Agent...")
        logger.info("Python version: %s", platform.python_version())
        logger.info("DATABASE_URL present: %s", "true" if database_url_present() else "false")
        logger.info("AGENT_DATA_DIR: %s", os.getenv("AGENT_DATA_DIR", "<not set>"))
        for label, path in STORAGE_PATHS.to_mapping().items():
            logger.info("Storage directory [%s]: %s", label, path)
        ai_agent = AivenAgent()
        await ai_agent.initialize()
        logger.info("AI Agent initialized successfully")
        
        # Ingest documentation when enabled
        if ai_agent.documentation_enabled:
            logger.info("Documentation ingestion enabled, starting ingestion...")
            try:
                await ai_agent.ingest_documentation()
            except Exception as exc:  # pylint: disable=broad-except
                logger.warning("Documentation ingestion failed: %s", exc)
            else:
                logger.info("Documentation ingestion completed")
        else:
            logger.info("Documentation ingestion skipped (AI_ENABLE_DOCUMENTATION disabled)")
        
    except Exception as e:
        logger.error(f"Failed to initialize AI Agent: {e}")
        raise

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("Shutting down AI Agent...")
    if ai_agent:
        await ai_agent.cleanup()

@app.get("/health")
async def health_check():
    """Readiness probe that only reports application availability."""
    return {"status": "ok"}


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
        global ai_agent
        if ai_agent:
            await ai_agent.cleanup()
        
        ai_agent = AivenAgent()
        await ai_agent.initialize()
        
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
    # Get port from environment variable
    port = int(os.getenv("AI_AGENT_PORT", 15000))
    host = os.getenv("AI_AGENT_HOST", "127.0.0.1")
    
    logger.info(f"Starting AI Agent server on {host}:{port}")
    
    uvicorn.run(
        "ai_agent.app:app",
        host=host,
        port=port,
        reload=False,  # Disable reload for production
        log_level="info"
    )

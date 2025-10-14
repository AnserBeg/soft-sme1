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
from typing import Dict, Any, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
from dotenv import load_dotenv

# Add current directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from agent import AivenAgent
from conversation_manager import ConversationManager

# Load environment variables
load_dotenv()

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

# Pydantic models
class ChatRequest(BaseModel):
    message: str
    user_id: Optional[int] = None
    conversation_id: Optional[str] = None

class ChatResponse(BaseModel):
    response: str
    sources: list[str]
    confidence: float
    tool_used: str
    conversation_id: str
    actions: list[Dict[str, Any]] | None = None
    action_message: Optional[str] = None
    action_catalog: list[Dict[str, Any]] | None = None

class InitializeResponse(BaseModel):
    status: str
    message: str
    details: Optional[Dict[str, Any]] = None

class HealthResponse(BaseModel):
    status: str
    agent_status: str
    vector_db_status: str
    database_status: str
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
        ai_agent = AivenAgent()
        await ai_agent.initialize()
        logger.info("AI Agent initialized successfully")
        
        # Ingest documentation when enabled
        if ai_agent.documentation_enabled:
            logger.info("Documentation ingestion enabled, starting ingestion...")
            await ai_agent.ingest_documentation()
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

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    try:
        if not ai_agent:
            return HealthResponse(
                status="unhealthy",
                agent_status="not_initialized",
                vector_db_status="unknown",
                database_status="unknown"
            )
        
        # Check agent health
        agent_health = await ai_agent.health_check()
        
        return HealthResponse(
            status="healthy" if agent_health["overall"] else "unhealthy",
            agent_status=agent_health["agent"],
            vector_db_status=agent_health["vector_db"],
            database_status=agent_health["database"],
            details=agent_health
        )
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return HealthResponse(
            status="unhealthy",
            agent_status="error",
            vector_db_status="error",
            database_status="error",
            details={"error": str(e)}
        )

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
        
        # Get or create conversation
        conversation_id = request.conversation_id or conversation_manager.create_conversation(
            user_id=request.user_id
        )
        
        # Add user message to conversation
        conversation_manager.add_message(
            conversation_id=conversation_id,
            message=request.message,
            is_user=True
        )
        
        # Get conversation history
        history = conversation_manager.get_conversation_history(conversation_id)
        
        # Process with AI agent
        response = await ai_agent.process_message(
            message=request.message,
            conversation_history=history,
            user_id=request.user_id,
            conversation_id=conversation_id
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
            action_catalog=response.get("action_catalog", [])
        )
        
    except Exception as e:
        logger.error(f"Chat processing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/conversation/{conversation_id}")
async def get_conversation(conversation_id: str):
    """Get conversation history"""
    try:
        messages = conversation_manager.get_conversation_history(conversation_id)
        return {
            "conversation_id": conversation_id,
            "messages": messages
        }
    except Exception as e:
        logger.error(f"Failed to get conversation: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/conversation/{conversation_id}")
async def clear_conversation(conversation_id: str):
    """Clear conversation history"""
    try:
        conversation_manager.clear_conversation(conversation_id)
        return {"message": "Conversation cleared successfully"}
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
        "main:app",
        host=host,
        port=port,
        reload=False,  # Disable reload for production
        log_level="info"
    ) 
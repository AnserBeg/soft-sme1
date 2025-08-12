#!/usr/bin/env python3
"""
Setup script for Soft-SME AI Agent
==================================

This script sets up the AI agent by:
1. Initializing the vector database
2. Ingesting documentation files
3. Testing the setup
"""

import asyncio
import os
import sys
import logging
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Add the ai_agent directory to the path
sys.path.append(os.path.join(os.path.dirname(__file__), 'ai_agent'))

from ai_agent.agent import SoftSMEAgent
from ai_agent.rag_tool import DocumentationRAGTool

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def setup_ai_agent():
    """Set up the AI agent with documentation"""
    try:
        logger.info("Setting up Soft-SME AI Agent...")
        
        # Initialize the agent
        agent = SoftSMEAgent()
        await agent.initialize()
        
        logger.info("AI Agent initialized successfully")
        
        # Ingest documentation
        logger.info("Ingesting documentation into vector database...")
        await agent.ingest_documentation()
        
        logger.info("Documentation ingestion completed")
        
        # Test the setup
        logger.info("Testing AI Agent setup...")
        
        # Test RAG functionality
        test_query = "How do I create a purchase order?"
        logger.info(f"Testing with query: {test_query}")
        
        response = await agent.process_message(test_query)
        logger.info(f"Response: {response['response'][:200]}...")
        logger.info(f"Tool used: {response['tool_used']}")
        logger.info(f"Confidence: {response['confidence']}")
        
        if response['tool_used'] != 'error':
            logger.info("✅ AI Agent setup successful!")
            return True
        else:
            logger.error("❌ AI Agent setup failed - got error response")
            return False
            
    except Exception as e:
        logger.error(f"Setup failed: {e}")
        return False

async def main():
    """Main function"""
    logger.info("Starting AI Agent setup...")
    
    success = await setup_ai_agent()
    
    if success:
        logger.info("🎉 AI Agent setup completed successfully!")
        logger.info("You can now use the AI assistant in the Soft-SME application.")
    else:
        logger.error("❌ AI Agent setup failed!")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main()) 
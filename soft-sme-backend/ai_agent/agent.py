#!/usr/bin/env python3
"""
NeuraTask AI Agent
=================

Main AI agent class that orchestrates the LangGraph workflow for the NeuraTask application.
Handles routing between documentation RAG and live database queries.
"""

import os
import logging
import time
from typing import Dict, Any, List, Optional
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage

from rag_tool import DocumentationRAGTool
from sql_tool import InventorySQLTool
from conversation_manager import ConversationManager

logger = logging.getLogger(__name__)

class NeuraTaskAgent:
    """Main AI agent for NeuraTask application"""
    
    def __init__(self):
        self.llm = None
        self.tools = []
        self.rag_tool = None
        self.sql_tool = None
        self.conversation_manager = ConversationManager()
        self.initialized = False
        self.messages = []  # Add messages list for conversation history
        self.documentation_enabled = os.getenv("AI_ENABLE_DOCUMENTATION", "true").lower() == "true"
        
        # Statistics
        self.stats = {
            "total_queries": 0,
            "rag_queries": 0,
            "sql_queries": 0,
            "average_response_time": 0.0,
            "total_response_time": 0.0
        }
    
    async def initialize(self):
        """Initialize the AI agent"""
        try:
            logger.info("Initializing NeuraTask AI Agent...")
            
            # Initialize LLM (using Gemini)
            from langchain_google_genai import ChatGoogleGenerativeAI
            
            gemini_api_key = os.getenv("GEMINI_API_KEY")
            if not gemini_api_key:
                raise Exception("GEMINI_API_KEY environment variable is required")
            
            self.llm = ChatGoogleGenerativeAI(
                model=os.getenv("AI_MODEL", "gemini-2.5-flash"),
                temperature=float(os.getenv("AI_TEMPERATURE", "0.7")),
                google_api_key=gemini_api_key
            )
            
            # Set system prompt for consistent behavior
            self.system_prompt = """You are an expert AI assistant for the NeuraTask inventory management application. 

**YOUR ROLE:**
- Help users understand how to use the NeuraTask system
- Provide clear, direct answers
- Answer questions about features, workflows, and processes
- Present data in a helpful, organized way
- Be conversational but concise
- Help users with general queries common in buisness, such as writing, buisness advice, etc.

**RESPONSE GUIDELINES:**
- Be direct and to the point
- Use clear, simple language
- Mention UI elements (buttons, fields, menus) when relevant
- Keep responses concise - avoid unnecessary explanations
- If you don't know something, say so briefly

**FORMATTING:**
- Use bullet points for lists
- Use bold for important terms
- Keep responses short and focused
- Get straight to the answer"""
            
            # Initialize tools
            await self._initialize_tools()
            
            self.initialized = True
            logger.info("AI Agent initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize AI Agent: {e}")
            raise
    
    async def _initialize_tools(self):
        """Initialize RAG and SQL tools"""
        try:
            # Initialize RAG tool
            if self.documentation_enabled:
                self.rag_tool = DocumentationRAGTool()
            else:
                logger.info("Documentation support disabled via AI_ENABLE_DOCUMENTATION")

            # Initialize SQL tool
            db_config = {
                'host': os.getenv('DB_HOST', 'localhost'),
                'database': os.getenv('DB_DATABASE', 'soft_sme_db'),
                'user': os.getenv('DB_USER', 'postgres'),
                'password': os.getenv('DB_PASSWORD', '123'),
                'port': int(os.getenv('DB_PORT', '5432'))
            }
            self.sql_tool = InventorySQLTool(db_config)

            # Setup tools
            self.tools = [tool for tool in [self.rag_tool, self.sql_tool] if tool is not None]
            
            logger.info("Tools initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize tools: {e}")
            raise
    
        # Note: Removed old LangGraph workflow methods as we're now using LLM-based routing
    
    async def process_message(self, message: str, conversation_history: List[Dict] = None, user_id: Optional[int] = None) -> Dict[str, Any]:
        """Process a user message and return a response using flexible, iterative tool usage"""
        try:
            start_time = time.time()
            
            # Add user message to conversation
            user_message = HumanMessage(content=message)
            self.messages.append(user_message)
            
            # Build conversation context
            conversation_context = ""
            if conversation_history and len(conversation_history) > 0:
                # Get the last few messages for context
                recent_messages = conversation_history[-3:]  # Last 3 messages
                conversation_context = "\n\n**RECENT CONVERSATION CONTEXT:**\n"
                for msg in recent_messages:
                    if msg.get('isUser'):
                        conversation_context += f"User: {msg.get('text', '')}\n"
                    else:
                        conversation_context += f"Assistant: {msg.get('text', '')}\n"
            
            # STEP 1: Initial analysis and planning
            tool_descriptions = []
            decision_guidelines = []
            examples = []

            if self.documentation_enabled:
                tool_descriptions.append("**RAG Tool** - Search system documentation for guidance, procedures, UI details, how-to instructions, button locations, form fields, workflow steps")
                decision_guidelines.extend([
                    "If user asks \"HOW to do something\" (buttons, menus, steps, procedures) → use RAG for UI instructions",
                    "If user asks \"can I edit X\" or \"how can I edit X\" → use RAG for UI instructions",
                ])
                examples.extend([
                    '"how do I create a quote" → RAG (get UI instructions)',
                    '"can I edit attendance" → RAG (get UI instructions)',
                    '"how can I edit attendance" → RAG (get UI instructions)',
                    '"write me an email template" → RAG (for guidance) + LLM knowledge (for content)',
                ])

            tool_descriptions.append("**SQL Tool** - Query live database for current data, examples, history, existing content, records")
            tool_descriptions.append("**LLM Knowledge** - Use your own expertise for general guidance, writing help, best practices, general business advice")

            decision_guidelines.extend([
                'If user asks "give me a list of X" or "show me X" → Consider SQL to get actual data',
                'If user asks for "examples" or "existing content" → Consider SQL to find real examples',
                'For general business advice, conceptual questions, or when you have sufficient knowledge → Use LLM knowledge only',
                'IMPORTANT: Consider conversation context - if the user refers to something from previous messages, use that context',
            ])

            examples.extend([
                '"give me a list of customers" → SQL (get actual customer data)',
                '"what\'s the best business practice" → LLM knowledge only',
                '"what is inventory management" → LLM knowledge only (conceptual)',
                '"hello" or "how are you" → LLM knowledge only (conversational)',
                '"what was the purchase order number" (after discussing a specific part) → SQL (get that specific purchase order)',
            ])

            available_tools_text = "\n".join(f"- {desc}" for desc in tool_descriptions)
            decision_guidelines_text = "\n".join(f"- {guideline}" for guideline in decision_guidelines)
            examples_text = "\n".join(f"- {example}" for example in examples)
            valid_tools = ["sql", "llm_knowledge"]
            if self.documentation_enabled:
                valid_tools.insert(0, "rag")
            tools_array_text = ", ".join(f'"{tool}"' for tool in valid_tools)

            analysis_prompt = f"""You are an expert AI assistant for the NeuraTask inventory management system.

**USER QUESTION:** {message}{conversation_context}

**AVAILABLE TOOLS:**
{available_tools_text}

**DECISION GUIDELINES:**
{decision_guidelines_text}

**EXAMPLES:**
{examples_text}

**THINKING PROCESS:**
1. **ANALYZE** what the user is asking for (consider conversation context)
2. **PLAN** what tools you need to use
3. **DETERMINE** the order of tool usage
4. **IDENTIFY** what information you need to gather

**RESPONSE FORMAT:**
You MUST respond with ONLY a valid JSON object:
{{
    "tools_needed": [{tools_array_text}],
    "reasoning": "Brief explanation of your plan",
    "first_step": "What tool to use first and why"
}}

**RESPONSE:**"""
            
            # Get initial analysis
            analysis_response = await self.llm.ainvoke(analysis_prompt)
            analysis_content = analysis_response.content.strip()
            
            # Debug: Log the raw LLM response
            logger.info(f"Raw LLM analysis response: {analysis_content}")
            
            # Clean up the response - remove markdown code blocks if present
            cleaned_content = analysis_content
            if analysis_content.startswith('```json'):
                cleaned_content = analysis_content.replace('```json', '').replace('```', '').strip()
            elif analysis_content.startswith('```'):
                cleaned_content = analysis_content.replace('```', '').strip()
            
            # Try to parse JSON, fallback to simple approach if needed
            try:
                import json
                analysis = json.loads(cleaned_content)
                tools_needed = analysis.get("tools_needed", [])
                reasoning = analysis.get("reasoning", "")
                first_step = analysis.get("first_step", "")
                logger.info(f"Successfully parsed JSON: {analysis}")
            except Exception as e:
                # Fallback: use LLM knowledge only if JSON parsing fails
                logger.warning(f"JSON parsing failed: {e}. Raw response: {analysis_content}")
                logger.warning(f"Cleaned content: {cleaned_content}")
                logger.warning("Using LLM knowledge only due to parsing error.")
                tools_needed = ["llm_knowledge"]
                reasoning = "JSON parsing failed, using LLM knowledge only"
                first_step = "Using LLM knowledge due to parsing error"
            
            logger.info(f"Analysis: {reasoning}")
            if not self.documentation_enabled:
                tools_needed = [tool for tool in tools_needed if tool != "rag"]
            logger.info(f"Tools needed: {tools_needed}")
            logger.info(f"First step: {first_step}")
            
            # STEP 2: Iterative tool usage
            gathered_info = {}
            tool_usage_count = 0
            max_iterations = 2  # Reduced further to prevent long processing
            start_time_iteration = time.time()
            max_iteration_time = 25  # 25 seconds max per iteration
            
            for iteration in range(max_iterations):
                # Check if we're taking too long
                if time.time() - start_time_iteration > max_iteration_time:
                    logger.warning(f"Iteration {iteration + 1} taking too long, stopping")
                    break
                logger.info(f"Iteration {iteration + 1}: Using tools {tools_needed}")
                
                # Use RAG tool if needed
                if self.documentation_enabled and self.rag_tool and "rag" in tools_needed and "documentation" not in gathered_info:
                    try:
                        # Create a more specific query for better RAG results
                        if "edit" in message.lower() or "modify" in message.lower():
                            if "attendance" in message.lower() or "clock" in message.lower():
                                rag_query = f"time tracking reports page edit modify time entries attendance clock in clock out reports {message}"
                            else:
                                rag_query = f"how to edit modify time entries attendance clock in clock out {message}"
                        else:
                            rag_query = f"relevant documentation for: {message}"
                        
                        doc_result = await self.rag_tool.ainvoke(rag_query)
                        gathered_info["documentation"] = doc_result
                        self.stats["rag_queries"] += 1
                        logger.info("RAG tool used successfully")
                        logger.info(f"RAG query used: {rag_query}")
                        logger.info(f"RAG result preview: {doc_result[:500]}...")
                    except Exception as e:
                        logger.error(f"RAG tool error: {e}")
                        gathered_info["documentation"] = "No documentation found"
                
                # Use SQL tool if needed
                if "sql" in tools_needed and "database_data" not in gathered_info:
                    try:
                        # Generate SQL query based on the message and conversation context
                        sql_query = await self._generate_sql_query(message, conversation_history)
                        if sql_query:
                            # Add timeout for SQL queries
                            import asyncio
                            try:
                                db_result = await asyncio.wait_for(
                                    self.sql_tool.ainvoke(sql_query), 
                                    timeout=10.0  # 10 second timeout for SQL
                                )
                                gathered_info["database_data"] = db_result
                                self.stats["sql_queries"] += 1
                                logger.info("SQL tool used successfully")
                            except asyncio.TimeoutError:
                                logger.warning("SQL query timed out, skipping")
                                gathered_info["database_data"] = "SQL query timed out"
                    except Exception as e:
                        logger.error(f"SQL tool error: {e}")
                        gathered_info["database_data"] = "No database data available"
                
                # Check if we have enough information (simplified logic)
                if iteration == 0 and len(gathered_info) > 0:
                    # First iteration with some data - proceed to answer
                    ready_to_answer = True
                    eval_reasoning = "Have sufficient information from first iteration"
                elif iteration >= 1:
                    # Second iteration or more - evaluate if we need more
                    evaluation_prompt = f"""You are evaluating whether you have enough information to answer the user's question.

**USER QUESTION:** {message}

**INFORMATION GATHERED:**
{gathered_info}

**TOOLS USED:** {list(gathered_info.keys())}

**THINKING:**
1. Do you have enough information to provide a helpful answer?
2. Do you need to use any additional tools?
3. Are there any gaps in the information?

**RESPONSE FORMAT:**
Respond with a JSON object:
{{
    "ready_to_answer": true/false,
    "additional_tools_needed": ["tool1", "tool2"],
    "reasoning": "Why you're ready or what else you need"
}}

**RESPONSE:**"""
                    
                    evaluation_response = await self.llm.ainvoke(evaluation_prompt)
                    try:
                        evaluation = json.loads(evaluation_response.content.strip())
                        ready_to_answer = evaluation.get("ready_to_answer", True)
                        additional_tools = evaluation.get("additional_tools_needed", [])
                        eval_reasoning = evaluation.get("reasoning", "")
                    except:
                        ready_to_answer = True
                        additional_tools = []
                        eval_reasoning = "Could not parse evaluation"
                    
                    logger.info(f"Evaluation: {eval_reasoning}")
                    
                    if ready_to_answer:
                        break
                    
                    # Update tools needed for next iteration
                    tools_needed = additional_tools
                    if not self.documentation_enabled:
                        tools_needed = [tool for tool in tools_needed if tool != "rag"]
                    if not tools_needed:
                        break
                else:
                    # No data gathered yet, continue
                    ready_to_answer = False
                    eval_reasoning = "No data gathered yet"
            
            # STEP 3: Generate final response
            critical_requirements = []
            response_format = [
                "Answer the question directly and completely",
                "Use information from all available sources",
                "Be concise but comprehensive",
                "Include specific details when available",
                "Provide actionable guidance if applicable",
                "Use bullet points for lists",
                "Bold important terms",
            ]

            if self.documentation_enabled:
                critical_requirements.extend([
                    "ONLY use information from the documentation - do not make up UI instructions",
                    'If documentation says "reports page" - use that exact terminology',
                    "If documentation doesn't mention a feature - don't say it exists",
                    "Be precise about UI locations - use exact page names and button names from documentation",
                ])
                response_format.append("Only mention UI elements that are explicitly in the documentation")

            critical_requirements_text = "\n".join(f"- {item}" for item in critical_requirements) if critical_requirements else "- Provide accurate information based on available data"
            response_format_text = "\n".join(f"- {item}" for item in response_format)

            response_prompt = f"""{self.system_prompt}

**TASK:** Provide a comprehensive, helpful answer to the user's question.

**USER QUESTION:** {message}

**INFORMATION GATHERED:**
{gathered_info}

**THINKING PROCESS:**
1. **ANALYZE** what the user asked for
2. **SYNTHESIZE** information from all sources
3. **ORGANIZE** the response logically
4. **PROVIDE** actionable, helpful information
5. **ENSURE** the answer is complete and accurate

**CRITICAL REQUIREMENTS:**
{critical_requirements_text}

**RESPONSE FORMAT:**
{response_format_text}

Provide a helpful, complete answer."""
            
            # Generate final response
            final_response = await self.llm.ainvoke(response_prompt)
            response = final_response.content
            
            # Determine tool used based on what was actually used
            tools_used = list(gathered_info.keys())
            if not tools_used:
                tool_used = "llm_knowledge"
            elif len(tools_used) == 1:
                tool_used = tools_used[0]
            else:
                tool_used = "hybrid"
            
            # Determine sources
            sources = []
            if "documentation" in gathered_info:
                sources.append("documentation")
            if "database_data" in gathered_info:
                sources.append("database")
            if not sources:
                sources.append("llm_knowledge")
            
            # Calculate confidence based on information quality
            confidence = self._calculate_confidence(gathered_info, tool_usage_count)
            
            # Add AI response to conversation
            ai_message = AIMessage(content=response)
            self.messages.append(ai_message)
            
            # Update statistics
            processing_time = time.time() - start_time
            self.stats["total_queries"] += 1
            self.stats["average_response_time"] = (
                (self.stats["average_response_time"] * (self.stats["total_queries"] - 1) + processing_time) 
                / self.stats["total_queries"]
            )
            
            return {
                "response": response,
                "sources": sources,
                "confidence": confidence,
                "tool_used": tool_used,
                "processing_time": processing_time
            }
            
        except Exception as e:
            logger.error(f"Message processing error: {e}")
            return {
                "response": "I encountered an error while processing your message. Please try again.",
                "sources": [],
                "confidence": 0.0,
                "tool_used": "error",
                "processing_time": 0.0
            }
    
    def _determine_tools_needed(self, message: str) -> List[str]:
        """This method is deprecated - we use LLM-based routing instead"""
        logger.warning("Keyword-based tool selection is deprecated. Using LLM knowledge only.")
        return ["llm_knowledge"]
    
    async def _generate_sql_query(self, message: str, conversation_history: List[Dict] = None) -> str:
        """Generate SQL query based on message content and conversation context"""
        try:
            # Get schema info first
            schema_query = f"database schema tables columns structure for query: {message}"
            if self.documentation_enabled and self.rag_tool:
                schema_info = await self.rag_tool.ainvoke(schema_query)
            else:
                schema_info = "Documentation lookup disabled."
            
            # Build conversation context for SQL generation
            conversation_context = ""
            if conversation_history and len(conversation_history) > 0:
                recent_messages = conversation_history[-3:]  # Last 3 messages
                conversation_context = "\n\n**CONVERSATION CONTEXT:**\n"
                for msg in recent_messages:
                    if msg.get('isUser'):
                        conversation_context += f"User: {msg.get('text', '')}\n"
                    else:
                        conversation_context += f"Assistant: {msg.get('text', '')}\n"
            
            # Generate SQL
            sql_prompt = f"""You are an expert SQL generator for the NeuraTask inventory management system.

**USER QUESTION:** {message}{conversation_context}

**DATABASE SCHEMA INFORMATION:**
{schema_info}

**THINKING PROCESS:**
1. **ANALYZE** what data the user needs (consider conversation context)
2. **IDENTIFY** which tables and columns are relevant
3. **PLAN** the SQL query structure
4. **CONSIDER** any JOINs, WHERE clauses, ORDER BY needed
5. **GENERATE** the optimal SQL query

**REQUIREMENTS:**
- Only use SELECT statements (read-only)
- Use proper table and column names
- For "last" or "recent" queries, use ORDER BY date DESC and LIMIT 1
- Use appropriate JOINs when needed
- Focus on the most relevant table(s)
- **IMPORTANT**: If the user refers to something from conversation context (like a specific part number, vendor, etc.), use that in your WHERE clause

**RESPONSE:** Generate only the SQL query, nothing else."""
            
            sql_response = await self.llm.ainvoke(sql_prompt)
            return sql_response.content.strip()
            
        except Exception as e:
            logger.error(f"SQL generation error: {e}")
            return ""
    
    def _calculate_confidence(self, gathered_info: Dict[str, Any], tool_usage_count: int) -> float:
        """Calculate confidence based on information quality and tool usage"""
        confidence = 0.5  # Base confidence
        
        # Boost confidence based on information quality
        if "documentation" in gathered_info and "No documentation found" not in gathered_info.get("documentation", ""):
            confidence += 0.2
        
        if "database_data" in gathered_info and "No database data available" not in gathered_info.get("database_data", ""):
            confidence += 0.2
        
        # Reduce confidence if too many tool calls (might indicate confusion)
        if tool_usage_count > 3:
            confidence -= 0.1
        
        return min(confidence, 0.95)  # Cap at 0.95
    
    async def health_check(self) -> Dict[str, Any]:
        """Check the health of the AI agent"""
        try:
            health_status = {
                "overall": True,
                "agent": "healthy",
                "vector_db": "unknown",
                "database": "unknown",
                "details": {}
            }
            
            # Check RAG tool
            if self.documentation_enabled and self.rag_tool:
                try:
                    rag_stats = self.rag_tool.get_stats()
                    health_status["vector_db"] = "healthy"
                    health_status["details"]["rag_stats"] = rag_stats
                except Exception as e:
                    health_status["vector_db"] = "unhealthy"
                    health_status["details"]["rag_error"] = str(e)
                    health_status["overall"] = False
            else:
                health_status["vector_db"] = "disabled"
            
            # Check SQL tool
            if self.sql_tool:
                try:
                    # Simple database connection test
                    test_query = "SELECT 1 as test"
                    result = self.sql_tool._run(test_query)
                    health_status["database"] = "healthy"
                except Exception as e:
                    health_status["database"] = "unhealthy"
                    health_status["details"]["db_error"] = str(e)
                    health_status["overall"] = False
            
            # Check LLM
            if self.llm:
                try:
                    # Simple LLM test
                    test_response = await self.llm.ainvoke("Hello")
                    health_status["details"]["llm"] = "healthy"
                except Exception as e:
                    health_status["agent"] = "unhealthy"
                    health_status["details"]["llm_error"] = str(e)
                    health_status["overall"] = False
            
            return health_status
            
        except Exception as e:
            logger.error(f"Health check error: {e}")
            return {
                "overall": False,
                "agent": "error",
                "vector_db": "error",
                "database": "error",
                "details": {"error": str(e)}
            }
    
    async def get_statistics(self) -> Dict[str, Any]:
        """Get AI agent statistics"""
        return {
            "total_queries": self.stats["total_queries"],
            "rag_queries": self.stats["rag_queries"],
            "sql_queries": self.stats["sql_queries"],
            "average_response_time": self.stats["average_response_time"],
            "tools_used": {
                "documentation_search": self.stats["rag_queries"],
                "inventory_query": self.stats["sql_queries"]
            }
        }
    
    async def ingest_documentation(self):
        """Ingest documentation into vector database"""
        try:
            if self.documentation_enabled and self.rag_tool:
                await self.rag_tool.ingest_documentation()
                logger.info("Documentation ingestion completed")
            else:
                logger.info("Documentation ingestion skipped because AI_ENABLE_DOCUMENTATION is disabled")
        except Exception as e:
            logger.error(f"Documentation ingestion failed: {e}")
            raise
    
    async def cleanup(self):
        """Cleanup resources"""
        try:
            logger.info("Cleaning up AI Agent resources...")
            # Add any cleanup logic here
            self.initialized = False
            logger.info("AI Agent cleanup completed")
        except Exception as e:
            logger.error(f"Cleanup error: {e}") 
#!/usr/bin/env python3
"""
Aiven AI Agent
=================

Main AI agent class that orchestrates the LangGraph workflow for the Aiven application.
Handles routing between documentation RAG and live database queries.
"""

import asyncio
import hashlib
import json
import os
import logging
import time
import uuid
from collections import deque
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Dict, Any, List, Optional, Sequence, Tuple

from langchain_core.messages import HumanMessage, AIMessage

try:  # pragma: no cover - support direct execution and package import
    from .rag_tool import DocumentationRAGTool
    from .sql_tool import InventorySQLTool
    from .action_tool import AgentActionTool
    from .conversation_manager import ConversationManager
    from .task_queue import TaskQueue
    from .analytics_sink import AnalyticsSink
    from .aggregation import AggregationCoordinator
    from .planner_client import PlannerClient, PlannerServiceError
    from .subagents import (
        ActionWorkflowSubagent,
        DocumentationQASubagent,
        RowSelectionSubagent,
        VoiceCallSubagent,
    )
    from .tool_policy import ToolScoringPolicy, ToolUsageContext
except ImportError:  # pragma: no cover - fallback when executed as script
    from rag_tool import DocumentationRAGTool
    from sql_tool import InventorySQLTool
    from action_tool import AgentActionTool
    from conversation_manager import ConversationManager
    from task_queue import TaskQueue
    from analytics_sink import AnalyticsSink
    from aggregation import AggregationCoordinator
    from planner_client import PlannerClient, PlannerServiceError
    from subagents import (
        ActionWorkflowSubagent,
        DocumentationQASubagent,
        RowSelectionSubagent,
        VoiceCallSubagent,
    )
    from tool_policy import ToolScoringPolicy, ToolUsageContext

logger = logging.getLogger(__name__)


@dataclass
class ReActLoopState:
    """Mutable state tracked across ReAct control loop iterations."""

    gathered_info: Dict[str, Any] = field(default_factory=dict)
    documentation_results: List[Dict[str, Any]] = field(default_factory=list)
    row_selection_candidates: List[str] = field(default_factory=list)
    actions_summary: Dict[str, Any] = field(default_factory=dict)
    tool_usage_count: int = 0
    executed_tools: Dict[str, int] = field(default_factory=dict)


@dataclass
class ReActObservation:
    """Outcome emitted after executing a single control loop action."""

    success: bool
    summary: str
    continue_loop: bool = True
    enqueue_tools: List[str] = field(default_factory=list)
    payload: Dict[str, Any] = field(default_factory=dict)


class AivenAgent:
    """Main AI agent for Aiven application"""

    MAX_REACT_ITERATIONS = 6

    def __init__(self):
        self.llm = None
        self.tools = []
        self.rag_tool = None
        self.sql_tool = None
        self.conversation_manager = ConversationManager()
        self.task_queue = TaskQueue()
        self.action_tool = None
        self.initialized = False
        self.messages = []  # Add messages list for conversation history
        self.documentation_enabled = os.getenv("AI_ENABLE_DOCUMENTATION", "true").lower() == "true"
        self.analytics_sink = AnalyticsSink()
        self.aggregation_coordinator = AggregationCoordinator(
            analytics_sink=self.analytics_sink
        )
        self.planner_client = PlannerClient()
        self.tool_policy = ToolScoringPolicy()
        self.default_locale = self._sanitize_env(os.getenv("AI_AGENT_DEFAULT_LOCALE"))
        self.documentation_subagent_enabled = (
            os.getenv("AI_ENABLE_DOCUMENTATION_QA_SUBAGENT", "false").strip().lower()
            in {"1", "true", "yes", "on"}
        )
        self.documentation_qa_subagent: Optional[DocumentationQASubagent] = None
        self.row_selection_subagent_enabled = (
            os.getenv("AI_ENABLE_ROW_SELECTION_SUBAGENT", "false").strip().lower()
            in {"1", "true", "yes", "on"}
        )
        self.row_selection_subagent: Optional[RowSelectionSubagent] = None
        self.action_workflow_subagent_enabled = (
            os.getenv("AI_ENABLE_ACTION_WORKFLOW_SUBAGENT", "false").strip().lower()
            in {"1", "true", "yes", "on"}
        )
        self.action_workflow_subagent: Optional[ActionWorkflowSubagent] = None
        self.voice_call_subagent_enabled = (
            os.getenv("AI_ENABLE_VOICE_CALL_SUBAGENT", "false").strip().lower()
            in {"1", "true", "yes", "on"}
        )
        self.voice_call_subagent: Optional[VoiceCallSubagent] = None
        
        # Statistics
        self.stats = {
            "total_queries": 0,
            "rag_queries": 0,
            "sql_queries": 0,
            "action_queries": 0,
            "average_response_time": 0.0,
            "total_response_time": 0.0
        }
    
    async def initialize(self):
        """Initialize the AI agent"""
        try:
            logger.info("Initializing Aiven AI Agent...")
            
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
            self.system_prompt = """You are an expert AI assistant for the Aiven inventory management application. 

**YOUR ROLE:**
- Help users understand how to use the Aiven system
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
            self._initialize_subagents()

            self.initialized = True
            logger.info("AI Agent initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize AI Agent: {e}")
            raise
    
    async def _initialize_tools(self):
        """Initialize RAG, SQL, and action tools"""
        try:
            # Initialize RAG tool
            if self.documentation_enabled:
                try:
                    self.rag_tool = DocumentationRAGTool()
                except Exception as e:
                    logger.warning(
                        "Documentation support disabled because RAG tool initialization failed: %s",
                        e,
                    )
                    self.rag_tool = None
                    self.documentation_enabled = False
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

            # Initialize action tool client
            self.action_tool = AgentActionTool(self.analytics_sink)

            # Setup tools
            self.tools = [tool for tool in [self.rag_tool, self.sql_tool, self.action_tool] if tool is not None]
            
            logger.info("Tools initialized successfully")

        except Exception as e:
            logger.error(f"Failed to initialize tools: {e}")
            raise

        # Note: Removed old LangGraph workflow methods as we're now using LLM-based routing

    def _initialize_subagents(self) -> None:
        """Instantiate planner-integrated subagents under feature flags."""

        self.documentation_qa_subagent = None
        self.row_selection_subagent = None
        self.action_workflow_subagent = None
        self.voice_call_subagent = None

        if self.documentation_subagent_enabled:
            if not self.documentation_enabled:
                logger.info("Documentation QA subagent skipped because documentation support is disabled")
            elif not self.rag_tool:
                logger.warning(
                    "Documentation QA subagent unavailable because the documentation RAG tool failed to initialize",
                )
            elif not self.llm:
                logger.warning(
                    "Documentation QA subagent unavailable because the LLM client is not configured",
                )
            else:
                self.documentation_qa_subagent = DocumentationQASubagent(
                    rag_tool=self.rag_tool,
                    llm=self.llm,
                    analytics_sink=self.analytics_sink,
                )
                logger.info("Documentation QA subagent initialized")
        else:
            logger.info("Documentation QA subagent disabled via feature flag")

        if self.row_selection_subagent_enabled:
            self.row_selection_subagent = RowSelectionSubagent(
                analytics_sink=self.analytics_sink,
            )
            logger.info("Row selection subagent initialized")
        else:
            logger.info("Row selection subagent disabled via feature flag")

        if self.action_workflow_subagent_enabled:
            self.action_workflow_subagent = ActionWorkflowSubagent(
                analytics_sink=self.analytics_sink,
                task_queue=self.task_queue,
                action_tool=self.action_tool,
            )
            logger.info("Action workflow subagent initialized")
        else:
            logger.info("Action workflow subagent disabled via feature flag")

        if self.voice_call_subagent_enabled:
            try:
                self.voice_call_subagent = VoiceCallSubagent(
                    analytics_sink=self.analytics_sink,
                    task_queue=self.task_queue,
                )
                logger.info("Voice call subagent initialized")
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception("Voice call subagent initialization failed: %s", exc)
        else:
            logger.info("Voice call subagent disabled via feature flag")

    def _extract_follow_up_instructions(self, raw_message: str) -> Tuple[str, List[Dict[str, Any]]]:
        """Parse structured follow-up task instructions embedded in the user message."""
        if not raw_message:
            return raw_message, []

        stripped = raw_message.strip()
        if not stripped.startswith('{'):
            return raw_message, []

        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            return raw_message, []

        follow_up_spec = payload.get('follow_up_tasks')
        prompt_text = payload.get('prompt') or payload.get('message') or payload.get('query') or ''

        tasks: List[Dict[str, Any]] = []
        if isinstance(follow_up_spec, dict):
            tasks.append(follow_up_spec)
        elif isinstance(follow_up_spec, list):
            tasks.extend([task for task in follow_up_spec if isinstance(task, dict)])

        if not prompt_text:
            prompt_text = payload.get('text') or raw_message

        return prompt_text or raw_message, tasks

    def _enqueue_follow_up_tasks(
        self,
        conversation_id: str,
        tasks: List[Dict[str, Any]],
        user_id: Optional[int] = None
    ) -> None:
        for task in tasks:
            task_type = task.get('task_type') or 'agent_tool'
            payload = task.get('payload') or {}
            schedule_at = self._parse_schedule_at(task.get('schedule_for'))

            if task_type == 'agent_tool':
                tool_name = task.get('tool') or payload.get('tool')
                if not tool_name:
                    logger.warning('Skipping follow-up task without tool name: %s', task)
                    continue

                payload = {
                    **payload,
                    'tool': tool_name,
                    'sessionId': task.get('sessionId') or payload.get('sessionId'),
                    'args': task.get('args') or payload.get('args')
                }

            payload.setdefault('requestedBy', user_id)

            try:
                task_id = self.task_queue.enqueue(
                    task_type,
                    payload,
                    conversation_id=conversation_id,
                    scheduled_for=schedule_at
                )
                logger.info(
                    'Queued follow-up task %s of type %s for conversation %s',
                    task_id,
                    task_type,
                    conversation_id
                )
            except Exception as exc:
                logger.error('Failed to enqueue follow-up task for conversation %s: %s', conversation_id, exc)

    def _parse_schedule_at(self, value: Optional[str]) -> Optional[datetime]:
        if not value or not isinstance(value, str):
            return None

        try:
            normalized = value.replace('Z', '+00:00') if value.endswith('Z') else value
            return datetime.fromisoformat(normalized)
        except ValueError:
            logger.warning('Invalid schedule_for value %s, defaulting to immediate execution', value)
            return None
    
    async def process_message(
        self,
        message: str,
        conversation_history: List[Dict] = None,
        user_id: Optional[int] = None,
        conversation_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Process a user message and return a response using flexible, iterative tool usage"""
        try:
            start_time = time.time()

            prompt_text, follow_up_specs = self._extract_follow_up_instructions(message)

            # Add user message to conversation
            user_message = HumanMessage(content=prompt_text)
            self.messages.append(user_message)

            # Build conversation context
            conversation_context = ""
            if conversation_history and len(conversation_history) > 0:
                # Get the last few messages for context
                recent_messages = conversation_history[-3:]  # Last 3 messages
                conversation_context = "\n\n**RECENT CONVERSATION CONTEXT:**\n"
                for msg in recent_messages:
                    is_user = msg.get('isUser')
                    if is_user is None:
                        is_user = msg.get('is_user')

                    if is_user:
                        conversation_context += f"User: {msg.get('text', '')}\n"
                    else:
                        conversation_context += f"Assistant: {msg.get('text', '')}\n"
            
            # STEP 1: Determine which tools are needed using lightweight heuristics
            tools_needed = self._determine_tools_needed(prompt_text, conversation_history)
            logger.info(f"Heuristic tool selection: {tools_needed}")

            if not self.documentation_enabled:
                tools_needed = [tool for tool in tools_needed if tool != "rag"]
            if not tools_needed:
                tools_needed = ["llm_knowledge"]
            logger.info(f"Filtered tools needed: {tools_needed}")

            planner_plan, planner_session_id = await self._maybe_generate_plan(
                prompt_text,
                conversation_id=conversation_id,
                user_id=user_id,
            )

            planner_suggestions: List[str] = []
            if planner_plan:
                planner_tools = self._map_planner_steps_to_tools(planner_plan)
                if planner_tools:
                    combined = list(dict.fromkeys(planner_tools + tools_needed))
                    logger.info("Planner suggested tool adjustments: %s", combined)
                    tools_needed = combined
                    planner_suggestions = planner_tools

            tools_needed = self.tool_policy.rank_candidates(
                tools_needed,
                ToolUsageContext(
                    message=prompt_text,
                    conversation_id=conversation_id,
                    conversation_history_size=len(conversation_history or []),
                    planner_suggestions=planner_suggestions,
                ),
            )
            logger.info("Ranked tool order: %s", tools_needed)

            # STEP 2: Iterative tool usage
            gathered_info = {}
            if planner_plan:
                gathered_info["planner_plan"] = planner_plan
            tool_usage_count = 0
            actions_summary: Dict[str, Any] = {}

            documentation_results: List[Dict[str, Any]] = []
            safety_results: List[Dict[str, Any]] = []
            blocking_safety: Optional[Dict[str, Any]] = None
            if planner_plan and planner_session_id is not None:
                safety_results = await self._process_safety_steps(
                    planner_plan,
                    session_id=planner_session_id,
                )
                if safety_results:
                    gathered_info["safety_subagent"] = safety_results
                    blocking_safety = next(
                        (item for item in safety_results if item.get("short_circuit")),
                        None,
                    )
                    if blocking_safety:
                        await self.analytics_sink.log_event(
                            "safety_short_circuit",
                            conversation_id=conversation_id,
                            session_id=planner_session_id,
                            status="blocked",
                            metadata={
                                "severity": blocking_safety.get("severity"),
                                "policy_tags": blocking_safety.get("policy_tags", []),
                                "detected_issues": blocking_safety.get("detected_issues", []),
                                "requires_manual_review": blocking_safety.get(
                                    "requires_manual_review"
                                ),
                                "resolution": blocking_safety.get("resolution"),
                                "fallback_step": blocking_safety.get("fallback_step"),
                            },
                        )

                        response_text = self._compose_safety_block_message(
                            blocking_safety
                        )
                        processing_time = time.time() - start_time

                        self.stats["total_queries"] += 1
                        self.stats["average_response_time"] = (
                            (
                                self.stats["average_response_time"]
                                * (self.stats["total_queries"] - 1)
                                + processing_time
                            )
                            / self.stats["total_queries"]
                        )

                        return {
                            "response": response_text,
                            "sources": ["policy_guardrail"],
                            "confidence": 0.0,
                            "tool_used": "safety_guardrail",
                            "processing_time": processing_time,
                            "actions": [],
                            "action_message": blocking_safety.get("resolution"),
                            "action_catalog": [],
                            "planner_plan": planner_plan,
                            "documentation_subagent": documentation_results,
                        }

            loop_state = await self._run_react_control_loop(
                prompt_text=prompt_text,
                conversation_history=conversation_history,
                planner_plan=planner_plan,
                planner_session_id=planner_session_id,
                conversation_id=conversation_id,
                ranked_tools=tools_needed,
                planner_suggestions=planner_suggestions,
                initial_info=gathered_info,
            )

            gathered_info = loop_state.gathered_info
            documentation_results = loop_state.documentation_results
            row_selection_candidates = loop_state.row_selection_candidates
            actions_summary = loop_state.actions_summary or actions_summary
            tool_usage_count = loop_state.tool_usage_count
            
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

            if actions_summary.get("actions"):
                critical_requirements.append("Report the outcome of any actions, including relevant record numbers or errors.")
                response_format.append("Summarize any actions performed and provide follow-up guidance.")

            critical_requirements_text = "\n".join(f"- {item}" for item in critical_requirements) if critical_requirements else "- Provide accurate information based on available data"
            response_format_text = "\n".join(f"- {item}" for item in response_format)

            gathered_info_for_prompt = json.dumps(gathered_info, indent=2, default=str)

            response_prompt = f"""{self.system_prompt}

**TASK:** Provide a comprehensive, helpful answer to the user's question.

**USER QUESTION:** {prompt_text}

**INFORMATION GATHERED:**
{gathered_info_for_prompt}

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
            if actions_summary.get("actions"):
                additional = [tool for tool in tools_used if tool != "actions"]
                if additional:
                    tool_used = "action+" + "+".join(additional)
                else:
                    tool_used = "action"
            elif not tools_used:
                tool_used = "llm_knowledge"
            elif len(tools_used) == 1:
                tool_used = tools_used[0]
            else:
                tool_used = "hybrid"
            
            # Determine sources
            sources = []
            if "documentation" in gathered_info:
                sources.append("documentation")
            if documentation_results:
                sources.append("documentation_subagent")
            if "database_data" in gathered_info:
                sources.append("database")
            if actions_summary.get("actions"):
                sources.append("actions")
            if not sources:
                sources.append("llm_knowledge")
            
            # Calculate confidence based on information quality
            confidence = self._calculate_confidence(gathered_info, tool_usage_count)
            
            # Add AI response to conversation
            ai_message = AIMessage(content=response)
            self.messages.append(ai_message)

            if follow_up_specs and conversation_id:
                self._enqueue_follow_up_tasks(conversation_id, follow_up_specs, user_id=user_id)

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
                "processing_time": processing_time,
                "actions": actions_summary.get("actions", []),
                "action_message": actions_summary.get("message"),
                "action_catalog": actions_summary.get("catalog", []),
                "planner_plan": planner_plan,
                "documentation_subagent": documentation_results,
            }

        except Exception as e:
            logger.error(f"Message processing error: {e}")
            return {
                "response": "I encountered an error while processing your message. Please try again.",
                "sources": [],
                "confidence": 0.0,
                "tool_used": "error",
                "processing_time": 0.0,
                "actions": [],
                "action_message": None,
                "action_catalog": [],
                "planner_plan": None,
            }

    async def _maybe_generate_plan(
        self,
        message: str,
        *,
        conversation_id: Optional[str] = None,
        user_id: Optional[int] = None,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[int]]:
        if not self.planner_client.is_enabled:
            return None, None

        session_id = self._resolve_session_id(message, conversation_id, user_id)
        context = self._build_planner_context(user_id)

        try:
            plan = await self.planner_client.generate_plan(
                session_id=session_id,
                message=message,
                context=context,
            )
        except PlannerServiceError as exc:
            logger.warning("Planner service request failed: %s", exc)
            await self.analytics_sink.log_event(
                "planner_plan_generated",
                conversation_id=conversation_id,
                session_id=session_id,
                tool="planner_service",
                status="failed",
                error_message=str(exc),
            )
            return None, session_id

        if plan is None:
            return None, session_id

        metadata = plan.get("metadata", {}) if isinstance(plan, dict) else {}
        await self.analytics_sink.log_event(
            "planner_plan_generated",
            conversation_id=conversation_id,
            session_id=session_id,
            tool="planner_service",
            status="success",
            metadata={
                "model": metadata.get("model"),
                "version": metadata.get("version"),
                "rationale": metadata.get("rationale"),
                "step_count": len(plan.get("steps", [])) if isinstance(plan, dict) else 0,
            },
        )

        return plan, session_id

    def _map_planner_steps_to_tools(self, plan: Dict[str, Any]) -> List[str]:
        suggested: List[str] = []
        steps = plan.get("steps", []) if isinstance(plan, dict) else []

        for step in steps:
            if not isinstance(step, dict):
                continue

            step_type = (step.get("type") or "").lower()
            payload = step.get("payload") or {}
            if not isinstance(payload, dict):
                payload = {}

            if step_type == "tool":
                tool_name = (payload.get("tool_name") or "").lower()
                mapped = self._map_tool_name(tool_name)
                if mapped:
                    suggested.append(mapped)
                    if mapped == "action":
                        suggested.append("action_workflow_subagent")
                continue

            if step_type == "action":
                suggested.append("action")
                suggested.append("action_workflow_subagent")
                continue

            if step_type == "lookup":
                target = (payload.get("target") or "").lower()
                if target in {"database", "db"}:
                    filters = payload.get("filters") or {}
                    if isinstance(filters, dict):
                        intent = (
                            (filters.get("intent")
                            or filters.get("type")
                            or filters.get("lookup_type")
                            or "")
                        ).lower()
                        if intent in {"row_selection", "table_selection", "sql_row_selection"}:
                            suggested.append("sql")
                    suggested.append("row_selection_subagent")

        return suggested

    def _map_tool_name(self, tool_name: str) -> Optional[str]:
        if not tool_name:
            return None

        if "documentation_qa" in tool_name or "documentation_lookup" in tool_name:
            return "documentation_subagent"
        if "rag" in tool_name or "doc" in tool_name:
            return "rag"
        if any(keyword in tool_name for keyword in ("sql", "db", "database")):
            return "sql"
        if any(keyword in tool_name for keyword in ("action", "workflow", "task")):
            return "action"
        if "voice" in tool_name and "call" in tool_name:
            return "voice_call_subagent"

        return None

    async def _process_safety_steps(
        self,
        plan: Dict[str, Any],
        *,
        session_id: int,
    ) -> List[Dict[str, Any]]:
        if not self.aggregation_coordinator:
            return []

        steps = plan.get("steps", []) if isinstance(plan, dict) else []
        if not isinstance(steps, list):
            return []

        results: List[Dict[str, Any]] = []
        for step in steps:
            if not isinstance(step, dict):
                continue

            step_type = str(step.get("type") or "").lower()
            if step_type != "safety":
                continue

            payload = step.get("payload") or {}
            if not isinstance(payload, dict):
                payload = {}

            step_id = str(step.get("id") or uuid.uuid4())

            directive = await self.aggregation_coordinator.apply_safety_decision(
                session_id=str(session_id),
                plan_step_id=step_id,
                decision=payload,
                planner_context={
                    "description": step.get("description"),
                    "check_name": payload.get("check_name"),
                },
            )

            directive_payload = directive.to_payload()
            directive_payload.update(
                {
                    "step_id": step_id,
                    "check_name": payload.get("check_name"),
                    "description": step.get("description"),
                }
            )
            results.append(directive_payload)

        return results

    def _compose_safety_block_message(self, safety_result: Dict[str, Any]) -> str:
        base_message = (
            "I'm sorry, but I can't help with that request because it violates our safety guidelines."
        )

        policy_tags = [
            str(tag)
            for tag in safety_result.get("policy_tags", [])
            if isinstance(tag, str) and tag
        ]
        detected_issues = [
            str(issue)
            for issue in safety_result.get("detected_issues", [])
            if isinstance(issue, str) and issue
        ]
        requires_manual_review = bool(safety_result.get("requires_manual_review"))
        resolution = safety_result.get("resolution")

        lines = [base_message]

        if policy_tags:
            lines.append("")
            lines.append("Flagged policies: " + ", ".join(policy_tags))

        if detected_issues:
            lines.append("")
            lines.append("Details:")
            for issue in detected_issues:
                lines.append(f"- {issue}")

        if requires_manual_review:
            lines.append("")
            lines.append("A human review is required before we can proceed.")

        if isinstance(resolution, str) and resolution.strip():
            lines.append("")
            lines.append(resolution.strip())
        else:
            lines.append("")
            lines.append("Please contact your administrator for next steps.")

        return "\n".join(lines).strip()

    async def _run_react_control_loop(
        self,
        *,
        prompt_text: str,
        conversation_history: Optional[List[Dict[str, Any]]],
        planner_plan: Optional[Dict[str, Any]],
        planner_session_id: Optional[int],
        conversation_id: Optional[str],
        ranked_tools: Sequence[str],
        planner_suggestions: Sequence[str],
        initial_info: Dict[str, Any],
    ) -> ReActLoopState:
        """Execute a LangGraph-inspired ReAct loop that iteratively selects tools."""

        state = ReActLoopState(gathered_info=dict(initial_info or {}))
        if planner_plan and "planner_plan" not in state.gathered_info:
            state.gathered_info["planner_plan"] = planner_plan

        pending: deque[str] = deque()
        pending_set: set[str] = set()

        def _add_tool(name: Optional[str], *, front: bool = False) -> None:
            normalized = self._normalize_tool_name(name)
            if not normalized or normalized == "llm_knowledge":
                return
            if normalized in pending_set:
                return
            if front:
                pending.appendleft(normalized)
            else:
                pending.append(normalized)
            pending_set.add(normalized)

        normalized_suggestions = {
            self._normalize_tool_name(tool)
            for tool in planner_suggestions
            if self._normalize_tool_name(tool)
        }

        for tool in planner_suggestions:
            _add_tool(tool, front=True)
        for tool in ranked_tools:
            _add_tool(tool)

        session_identifier = str(conversation_id or planner_session_id or uuid.uuid4())
        plan_step_id: Optional[str] = None
        if self.aggregation_coordinator and pending:
            try:
                plan_step_id = f"react-loop-{uuid.uuid4()}"
                await self.aggregation_coordinator.register_plan_step(
                    session_id=session_identifier,
                    plan_step_id=plan_step_id,
                    expected_subagents=[
                        {"key": "reason", "result_key": "thought"},
                        {"key": "act", "result_key": "observation"},
                        {"key": "reflect", "result_key": "decision"},
                    ],
                    planner_context={
                        "description": "react_control_loop",
                        "initial_tools": list(pending),
                    },
                )
            except Exception as exc:  # pragma: no cover - defensive guard
                logger.exception("Failed to register ReAct control loop with aggregator: %s", exc)
                plan_step_id = None

        iteration = 0
        while pending and iteration < self.MAX_REACT_ITERATIONS:
            iteration += 1
            tool = pending.popleft()
            state.executed_tools[tool] = state.executed_tools.get(tool, 0) + 1

            reason_message = self._compose_reason_message(
                tool=tool,
                iteration=iteration,
                state=state,
                normalized_suggestions=normalized_suggestions,
                pending=list(pending),
            )
            await self._emit_react_event(
                session_id=session_identifier,
                plan_step_id=plan_step_id,
                subagent="reason",
                status="completed",
                payload={
                    "tool": tool,
                    "iteration": iteration,
                    "pending_tools": list(pending),
                    "thought": reason_message,
                },
            )

            observation = await self._execute_react_action(
                tool=tool,
                state=state,
                prompt_text=prompt_text,
                conversation_history=conversation_history,
                planner_plan=planner_plan,
                planner_session_id=planner_session_id,
                conversation_id=conversation_id,
            )

            payload = {"tool": tool, "summary": observation.summary, **observation.payload}
            await self._emit_react_event(
                session_id=session_identifier,
                plan_step_id=plan_step_id,
                subagent="act",
                status="success" if observation.success else "error",
                payload=payload,
            )

            reflect_message, should_continue, enqueue_tools = self._reflect_after_observation(
                tool=tool,
                observation=observation,
                state=state,
                pending=list(pending),
            )

            await self._emit_react_event(
                session_id=session_identifier,
                plan_step_id=plan_step_id,
                subagent="reflect",
                status="continue" if should_continue else "stop",
                payload={
                    "tool": tool,
                    "message": reflect_message,
                    "next_tools": enqueue_tools,
                },
            )

            if not should_continue:
                break

            for candidate in enqueue_tools:
                normalized = self._normalize_tool_name(candidate)
                if not normalized or normalized == "llm_knowledge":
                    continue
                if state.executed_tools.get(normalized, 0) >= 2:
                    continue
                if normalized not in pending_set:
                    pending.append(normalized)
                    pending_set.add(normalized)
                elif normalized not in pending:
                    pending.append(normalized)

        await self._emit_react_completion(
            session_id=session_identifier,
            plan_step_id=plan_step_id,
            state=state,
        )

        return state

    async def _emit_react_event(
        self,
        *,
        session_id: str,
        plan_step_id: Optional[str],
        subagent: str,
        status: str,
        payload: Dict[str, Any],
    ) -> None:
        if not self.aggregation_coordinator or not plan_step_id:
            return

        try:
            await self.aggregation_coordinator.emit_subagent_event(
                session_id=session_id,
                plan_step_id=plan_step_id,
                subagent=subagent,
                status=status,
                payload=payload,
            )
        except Exception as exc:  # pragma: no cover - telemetry failures shouldn't crash the agent
            logger.exception("Failed to emit ReAct %s event: %s", subagent, exc)

    async def _emit_react_completion(
        self,
        *,
        session_id: str,
        plan_step_id: Optional[str],
        state: ReActLoopState,
    ) -> None:
        if not self.aggregation_coordinator or not plan_step_id:
            return

        try:
            await self.aggregation_coordinator.emit_step_completed(
                session_id=session_id,
                plan_step_id=plan_step_id,
                status="success",
                payload={
                    "gathered_keys": list(state.gathered_info.keys()),
                    "executed_tools": state.executed_tools,
                },
            )
        except Exception as exc:  # pragma: no cover - telemetry failures shouldn't crash the agent
            logger.exception("Failed to complete ReAct loop event stream: %s", exc)

    def _compose_reason_message(
        self,
        *,
        tool: str,
        iteration: int,
        state: ReActLoopState,
        normalized_suggestions: set[str],
        pending: List[str],
    ) -> str:
        reasons: List[str] = []
        if tool in normalized_suggestions:
            reasons.append("planner suggested this capability")
        if tool == "sql" and state.row_selection_candidates:
            reasons.append("row selection provided table hints")
        if tool == "rag" and not state.gathered_info.get("documentation"):
            reasons.append("no documentation answer gathered yet")
        if tool == "action" and "actions" not in state.gathered_info:
            reasons.append("no workflows have been executed")
        if not reasons:
            reasons.append("following ranked tool order")

        pending_clause = f". Pending afterwards: {', '.join(pending)}" if pending else ""
        return f"Iteration {iteration}: selecting {tool} because {', '.join(reasons)}{pending_clause}".strip()

    async def _execute_react_action(
        self,
        *,
        tool: str,
        state: ReActLoopState,
        prompt_text: str,
        conversation_history: Optional[List[Dict[str, Any]]],
        planner_plan: Optional[Dict[str, Any]],
        planner_session_id: Optional[int],
        conversation_id: Optional[str],
    ) -> ReActObservation:
        normalized_tool = self._normalize_tool_name(tool) or "unknown"

        if normalized_tool == "documentation_subagent":
            if not planner_plan or not self.documentation_qa_subagent:
                return ReActObservation(
                    success=False,
                    summary="Documentation QA subagent unavailable",
                    enqueue_tools=["rag"] if self.rag_tool else [],
                    payload={"reason": "not_configured"},
                )

            results = await self._execute_documentation_steps(
                planner_plan,
                conversation_history=conversation_history,
                fallback_question=prompt_text,
                session_id=planner_session_id,
            )

            state.documentation_results = results
            if results:
                state.gathered_info["documentation_subagent"] = results

                successful_answers = [
                    item for item in results if item.get("status") == "success"
                ]
                for result in results:
                    status = (result.get("status") or "").lower()
                    latency_value = result.get("latency_ms")
                    latency_ms = float(latency_value) if isinstance(latency_value, (int, float)) else None
                    self.tool_policy.record_observation(
                        "documentation_subagent",
                        success=status == "success",
                        latency_ms=latency_ms,
                        metadata={"step_id": result.get("step_id"), "status": status},
                    )

                if successful_answers:
                    answers_text = "\n\n".join(
                        answer.get("answer", "") for answer in successful_answers if answer.get("answer")
                    )
                    if answers_text:
                        state.gathered_info.setdefault("documentation", answers_text)
                        self.stats["rag_queries"] += len(successful_answers)

                citations_payload = [
                    {
                        "step_id": item.get("step_id"),
                        "citations": item.get("citations", []),
                    }
                    for item in results
                    if item.get("citations")
                ]
                if citations_payload:
                    state.gathered_info["documentation_citations"] = citations_payload

                state.tool_usage_count += len(
                    [result for result in results if result.get("status") != "error"]
                )

                return ReActObservation(
                    success=True,
                    summary=f"Documentation QA returned {len(successful_answers)} successful answers",
                    enqueue_tools=[],
                    payload={"result_count": len(results)},
                )

            return ReActObservation(
                success=False,
                summary="Planner provided documentation steps but none succeeded",
                enqueue_tools=["rag"] if self.rag_tool else [],
                payload={"result_count": 0},
            )

        if normalized_tool == "row_selection_subagent":
            if not planner_plan or not self.row_selection_subagent:
                return ReActObservation(
                    success=False,
                    summary="Row selection subagent unavailable",
                    payload={"reason": "not_configured"},
                )

            results = await self._execute_row_selection_steps(
                planner_plan,
                conversation_history=conversation_history,
                session_id=planner_session_id,
            )

            if results:
                state.gathered_info["row_selection_subagent"] = results
                for result in results:
                    status = (result.get("status") or "").lower()
                    latency_value = result.get("latency_ms")
                    latency_ms = float(latency_value) if isinstance(latency_value, (int, float)) else None
                    self.tool_policy.record_observation(
                        "row_selection_subagent",
                        success=status == "success",
                        latency_ms=latency_ms,
                        metadata={"step_id": result.get("step_id"), "status": status},
                    )

                success_result = next(
                    (
                        result
                        for result in results
                        if result.get("status") == "success"
                        and isinstance(result.get("table_candidates"), list)
                        and result.get("table_candidates")
                    ),
                    None,
                )

                if success_result:
                    candidates = [
                        str(candidate)
                        for candidate in success_result.get("table_candidates", [])
                        if isinstance(candidate, str) and candidate
                    ]
                    state.row_selection_candidates = candidates
                    state.gathered_info["row_selection_summary"] = {
                        "table_candidates": candidates,
                        "reasoning": success_result.get("reasoning"),
                    }

                state.tool_usage_count += len(
                    [result for result in results if result.get("status") != "error"]
                )

                enqueue = ["sql"] if self.sql_tool else []
                return ReActObservation(
                    success=bool(success_result),
                    summary="Row selection evaluated planner hints",
                    enqueue_tools=enqueue,
                    payload={"result_count": len(results)},
                )

            return ReActObservation(
                success=False,
                summary="Planner requested row selection but no results were returned",
                enqueue_tools=[],
                payload={"result_count": 0},
            )

        if normalized_tool == "action_workflow_subagent":
            if not planner_plan or not self.action_workflow_subagent:
                return ReActObservation(
                    success=False,
                    summary="Action workflow subagent unavailable",
                    payload={"reason": "not_configured"},
                )

            results = await self._execute_action_workflow_steps(
                planner_plan,
                conversation_history=conversation_history,
                conversation_id=conversation_id,
                session_id=planner_session_id,
            )

            if results:
                state.gathered_info["action_workflow_subagent"] = results
                for result in results:
                    status = (result.get("status") or "").lower()
                    latency_value = result.get("latency_ms")
                    latency_ms = float(latency_value) if isinstance(latency_value, (int, float)) else None
                    self.tool_policy.record_observation(
                        "action_workflow_subagent",
                        success=status not in {"error", "manual"},
                        latency_ms=latency_ms,
                        metadata={"step_id": result.get("step_id"), "status": status},
                    )

                actionable_results = [
                    result
                    for result in results
                    if result.get("status") not in {"error", "manual"}
                ]

                if actionable_results:
                    state.tool_usage_count += len(actionable_results)
                    state.actions_summary = {
                        "actions": [
                            {
                                "tool": result.get("action"),
                                "success": result.get("status") not in {"error", "manual"},
                                "message": result.get("message"),
                                "queuedTaskId": result.get("queued_task_id"),
                                "status": result.get("status"),
                            }
                            for result in results
                        ],
                        "message": actionable_results[0].get("message"),
                    }
                    state.gathered_info.setdefault("actions", state.actions_summary)

                return ReActObservation(
                    success=bool(actionable_results),
                    summary="Action workflows evaluated",
                    enqueue_tools=[],
                    payload={"result_count": len(results)},
                )

            return ReActObservation(
                success=False,
                summary="Planner requested workflows but none executed",
                enqueue_tools=[],
                payload={"result_count": 0},
            )

        if normalized_tool == "voice_call_subagent":
            if not planner_plan or not self.voice_call_subagent:
                return ReActObservation(
                    success=False,
                    summary="Voice call subagent unavailable",
                    payload={"reason": "not_configured"},
                )

            results = await self._execute_voice_call_steps(
                planner_plan,
                conversation_id=conversation_id,
                session_id=planner_session_id,
            )

            if results:
                state.gathered_info["voice_call_subagent"] = results
                for result in results:
                    status = (result.get("status") or "").lower()
                    latency_value = result.get("latency_ms")
                    latency_ms = float(latency_value) if isinstance(latency_value, (int, float)) else None
                    self.tool_policy.record_observation(
                        "voice_call_subagent",
                        success=status not in {"error"},
                        latency_ms=latency_ms,
                        metadata={"step_id": result.get("step_id"), "status": status},
                    )

                successful = [
                    result for result in results if result.get("status") not in {"error"}
                ]
                if successful:
                    state.tool_usage_count += len(successful)

                return ReActObservation(
                    success=bool(successful),
                    summary="Voice call agent processed planner instructions",
                    enqueue_tools=[],
                    payload={"result_count": len(results)},
                )

            return ReActObservation(
                success=False,
                summary="Voice call planner steps produced no actionable results",
                enqueue_tools=[],
                payload={"result_count": 0},
            )

        if normalized_tool == "action":
            if not self.action_tool:
                return ReActObservation(
                    success=False,
                    summary="Action tool unavailable",
                    payload={"reason": "not_configured"},
                )

            try:
                action_start = time.time()
                action_result = await self.action_tool.invoke(prompt_text, conversation_id)
                if action_result.get("actions"):
                    state.gathered_info.setdefault("actions", action_result)
                    state.actions_summary = action_result
                    self.stats["action_queries"] += 1
                    state.tool_usage_count += 1
                    self.tool_policy.record_observation(
                        "action",
                        success=True,
                        latency_ms=(time.time() - action_start) * 1000.0,
                        metadata={"actions": len(action_result.get("actions", []))},
                    )
                    return ReActObservation(
                        success=True,
                        summary="Queued application action workflow",
                        enqueue_tools=[],
                        payload={"action_count": len(action_result.get("actions", []))},
                    )
                return ReActObservation(
                    success=False,
                    summary="No actions were triggered",
                    enqueue_tools=[],
                    payload={"action_count": 0},
                )
            except Exception as exc:  # pragma: no cover - action execution can fail
                logger.error("Action tool error: %s", exc)
                await self.analytics_sink.log_event(
                    "tool_failure",
                    tool="agent_v2",
                    conversation_id=conversation_id,
                    status="failed",
                    error_message=str(exc),
                    metadata={"stage": "agent_wrapper"},
                )
                state.gathered_info["actions"] = {
                    "actions": [
                        {
                            "tool": "agent_v2",
                            "success": False,
                            "message": f"Action execution failed: {exc}",
                        }
                    ]
                }
                state.actions_summary = state.gathered_info["actions"]
                self.tool_policy.record_observation(
                    "action",
                    success=False,
                    latency_ms=None,
                    metadata={"error": str(exc)},
                )
                return ReActObservation(
                    success=False,
                    summary="Action tool failed",
                    enqueue_tools=[],
                    payload={"error": str(exc)},
                )

        if normalized_tool == "rag":
            if not (self.documentation_enabled and self.rag_tool):
                return ReActObservation(
                    success=False,
                    summary="Documentation retrieval disabled",
                    enqueue_tools=[],
                    payload={"reason": "disabled"},
                )

            rag_query = None
            rag_start = time.time()
            try:
                prompt_lower = prompt_text.lower()
                if "edit" in prompt_lower or "modify" in prompt_lower:
                    if "attendance" in prompt_lower or "clock" in prompt_lower:
                        rag_query = (
                            "time tracking reports page edit modify time entries attendance "
                            f"clock in clock out reports {prompt_text}"
                        )
                    else:
                        rag_query = f"how to edit modify time entries attendance clock in clock out {prompt_text}"
                else:
                    rag_query = f"relevant documentation for: {prompt_text}"

                doc_result = await self.rag_tool.ainvoke(rag_query)
                state.gathered_info["documentation"] = doc_result
                self.stats["rag_queries"] += 1
                state.tool_usage_count += 1
                self.tool_policy.record_observation(
                    "rag",
                    success=True,
                    latency_ms=(time.time() - rag_start) * 1000.0,
                    metadata={"query": rag_query},
                )
                return ReActObservation(
                    success=True,
                    summary="Retrieved documentation snippet",
                    enqueue_tools=[],
                    payload={"query": rag_query},
                )
            except Exception as exc:  # pragma: no cover - RAG may fail at runtime
                logger.error("RAG tool error: %s", exc)
                await self.analytics_sink.log_event(
                    "tool_failure",
                    tool="documentation_rag",
                    conversation_id=conversation_id,
                    status="failed",
                    error_message=str(exc),
                    metadata={"query": rag_query},
                )
                state.gathered_info["documentation"] = "No documentation found"
                self.tool_policy.record_observation(
                    "rag",
                    success=False,
                    latency_ms=(time.time() - rag_start) * 1000.0,
                    metadata={"query": rag_query, "error": str(exc)},
                )
                return ReActObservation(
                    success=False,
                    summary="Documentation lookup failed",
                    enqueue_tools=[],
                    payload={"query": rag_query, "error": str(exc)},
                )

        if normalized_tool == "sql":
            if not self.sql_tool:
                return ReActObservation(
                    success=False,
                    summary="SQL tool unavailable",
                    payload={"reason": "not_configured"},
                )

            sql_query = await self._generate_sql_query(
                prompt_text,
                conversation_history,
                table_hints=state.row_selection_candidates,
            )
            if not sql_query:
                self.tool_policy.record_observation(
                    "sql",
                    success=False,
                    latency_ms=None,
                    metadata={"reason": "no_query_generated"},
                )
                return ReActObservation(
                    success=False,
                    summary="No SQL query generated",
                    enqueue_tools=[],
                    payload={"reason": "no_query"},
                )

            try:
                sql_start = time.time()
                db_result = await asyncio.wait_for(
                    self.sql_tool.ainvoke(sql_query),
                    timeout=10.0,
                )
                state.gathered_info["database_data"] = db_result
                self.stats["sql_queries"] += 1
                state.tool_usage_count += 1
                self.tool_policy.record_observation(
                    "sql",
                    success=True,
                    latency_ms=(time.time() - sql_start) * 1000.0,
                    metadata={"query": sql_query},
                )
                return ReActObservation(
                    success=True,
                    summary="Executed SQL query",
                    enqueue_tools=[],
                    payload={"query": sql_query},
                )
            except asyncio.TimeoutError:
                logger.warning("SQL query timed out, skipping")
                state.gathered_info["database_data"] = "SQL query timed out"
                self.tool_policy.record_observation(
                    "sql",
                    success=False,
                    latency_ms=10000.0,
                    metadata={"query": sql_query, "error": "timeout"},
                )
                return ReActObservation(
                    success=False,
                    summary="SQL query timed out",
                    enqueue_tools=[],
                    payload={"query": sql_query, "error": "timeout"},
                )
            except Exception as exc:  # pragma: no cover - SQL execution can fail
                logger.error("SQL tool error: %s", exc)
                await self.analytics_sink.log_event(
                    "tool_failure",
                    tool="inventory_sql",
                    conversation_id=conversation_id,
                    status="failed",
                    error_message=str(exc),
                )
                state.gathered_info["database_data"] = "No database data available"
                self.tool_policy.record_observation(
                    "sql",
                    success=False,
                    latency_ms=None,
                    metadata={"error": str(exc), "query": sql_query},
                )
                return ReActObservation(
                    success=False,
                    summary="SQL execution failed",
                    enqueue_tools=[],
                    payload={"query": sql_query, "error": str(exc)},
                )

        return ReActObservation(
            success=False,
            summary=f"Unsupported tool {normalized_tool}",
            enqueue_tools=[],
            payload={"tool": normalized_tool},
        )

    def _reflect_after_observation(
        self,
        *,
        tool: str,
        observation: ReActObservation,
        state: ReActLoopState,
        pending: List[str],
    ) -> Tuple[str, bool, List[str]]:
        message = observation.summary
        enqueue = list(observation.enqueue_tools)
        continue_loop = observation.continue_loop and (bool(pending) or bool(enqueue))
        if observation.success and not enqueue and not pending:
            continue_loop = False
        return message, continue_loop, enqueue

    def _normalize_tool_name(self, name: Optional[str]) -> Optional[str]:
        if name is None:
            return None
        normalized = str(name).strip().lower()
        return normalized or None

    async def _execute_documentation_steps(
        self,
        plan: Dict[str, Any],
        *,
        conversation_history: Optional[List[Dict[str, Any]]],
        fallback_question: str,
        session_id: Optional[int],
    ) -> List[Dict[str, Any]]:
        if not self.documentation_qa_subagent:
            return []

        steps = plan.get("steps", []) if isinstance(plan, dict) else []
        if not steps:
            return []

        results: List[Dict[str, Any]] = []
        for step in steps:
            if not isinstance(step, dict) or not self.documentation_qa_subagent.supports_step(step):
                continue

            payload = step.get("payload") or {}
            if not isinstance(payload, dict):
                payload = {}

            arguments = payload.get("arguments") or {}
            if not isinstance(arguments, dict):
                arguments = {}

            question = arguments.get("question") or arguments.get("query") or fallback_question
            focus_hints = arguments.get("focus_hints") or arguments.get("focus") or {}
            if not isinstance(focus_hints, dict):
                focus_hints = {}

            conversation_tail = arguments.get("conversation_tail")
            if not isinstance(conversation_tail, list):
                conversation_tail = self._conversation_tail_from_history(conversation_history)

            planner_payload = dict(payload)
            planner_payload.pop("arguments", None)

            result = await self.documentation_qa_subagent.execute(
                step_id=str(step.get("id") or "documentation_qa"),
                question=question,
                conversation_tail=conversation_tail,
                focus_hints=focus_hints,
                planner_payload=planner_payload,
                session_id=session_id,
            )

            results.append(asdict(result))

        return results

    async def _execute_row_selection_steps(
        self,
        plan: Dict[str, Any],
        *,
        conversation_history: Optional[List[Dict[str, Any]]],
        session_id: Optional[int],
    ) -> List[Dict[str, Any]]:
        del conversation_history  # conversation tail not used for row selection yet

        if not self.row_selection_subagent:
            return []

        steps = plan.get("steps", []) if isinstance(plan, dict) else []
        if not steps:
            return []

        results: List[Dict[str, Any]] = []
        for step in steps:
            if not isinstance(step, dict) or not self.row_selection_subagent.supports_step(step):
                continue

            payload = step.get("payload") or {}
            if not isinstance(payload, dict):
                payload = {}

            filters = payload.get("filters") or {}
            if not isinstance(filters, dict):
                filters = {}

            planner_payload = dict(payload)

            result = await self.row_selection_subagent.execute(
                step_id=str(step.get("id") or "row_selection"),
                question=str(payload.get("query") or ""),
                filters=filters,
                planner_payload=planner_payload,
                session_id=session_id,
            )

            results.append(asdict(result))

        return results

    async def _execute_action_workflow_steps(
        self,
        plan: Dict[str, Any],
        *,
        conversation_history: Optional[List[Dict[str, Any]]],
        conversation_id: Optional[str],
        session_id: Optional[int],
    ) -> List[Dict[str, Any]]:
        del conversation_history  # current stub does not rely on chat history

        if not self.action_workflow_subagent:
            return []

        steps = plan.get("steps", []) if isinstance(plan, dict) else []
        if not steps:
            return []

        results: List[Dict[str, Any]] = []
        for step in steps:
            if not isinstance(step, dict) or not self.action_workflow_subagent.supports_step(step):
                continue

            payload = step.get("payload") or {}
            if not isinstance(payload, dict):
                payload = {}

            arguments = payload.get("arguments") or {}
            if not isinstance(arguments, dict):
                arguments = {}

            action_name = (
                payload.get("action_name")
                or payload.get("tool_name")
                or arguments.get("action_name")
                or "workflow_action"
            )

            planner_payload = dict(payload)
            planner_payload.pop("arguments", None)

            result = await self.action_workflow_subagent.execute(
                step_id=str(step.get("id") or action_name),
                action=str(action_name),
                parameters=arguments,
                planner_payload=planner_payload,
                conversation_id=conversation_id
                or planner_payload.get("conversation_id")
                or arguments.get("conversation_id"),
                session_id=session_id,
            )

            results.append(asdict(result))

        return results

    async def _execute_voice_call_steps(
        self,
        plan: Dict[str, Any],
        *,
        conversation_id: Optional[str],
        session_id: Optional[int],
    ) -> List[Dict[str, Any]]:
        if not self.voice_call_subagent:
            return []

        steps = plan.get("steps", []) if isinstance(plan, dict) else []
        if not steps:
            return []

        results: List[Dict[str, Any]] = []
        for step in steps:
            if not isinstance(step, dict) or not self.voice_call_subagent.supports_step(step):
                continue

            payload = step.get("payload") or {}
            if not isinstance(payload, dict):
                payload = {}

            arguments = payload.get("arguments") or {}
            if not isinstance(arguments, dict):
                arguments = {}

            purchase_id = (
                arguments.get("purchaseId")
                or payload.get("purchase_id")
                or payload.get("purchaseId")
            )
            agent_session_hint = (
                arguments.get("agentSessionId")
                or payload.get("agent_session_id")
                or payload.get("agentSessionId")
                or session_id
            )
            goals_raw = arguments.get("goals") or payload.get("goals")
            if isinstance(goals_raw, list):
                goals_normalized = goals_raw
            elif isinstance(goals_raw, (tuple, set)):
                goals_normalized = list(goals_raw)
            elif goals_raw:
                goals_normalized = [goals_raw]
            else:
                goals_normalized = None

            metadata_candidate = arguments.get("metadata") or payload.get("metadata")
            metadata_normalized = metadata_candidate if isinstance(metadata_candidate, dict) else None
            callbacks = arguments.get("callbacks") or payload.get("callbacks")

            planner_payload = dict(payload)
            planner_payload.pop("arguments", None)
            if callbacks is not None:
                planner_payload["callbacks"] = callbacks

            step_identifier = str(
                step.get("id")
                or payload.get("tool_name")
                or payload.get("name")
                or "voice_vendor_call"
            )

            try:
                result = await self.voice_call_subagent.execute(
                    step_id=step_identifier,
                    purchase_id=purchase_id,
                    agent_session_id=agent_session_hint,
                    goals=goals_normalized,
                    metadata=metadata_normalized,
                    planner_payload=planner_payload,
                    conversation_id=conversation_id,
                    session_id=session_id,
                )
                results.append(asdict(result))
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception("Voice call subagent step failed: %s", exc)
                results.append(
                    {
                        "step_id": step_identifier,
                        "status": "error",
                        "error": str(exc),
                    }
                )

        return results

    def _conversation_tail_from_history(
        self, conversation_history: Optional[List[Dict[str, Any]]]
    ) -> List[Dict[str, str]]:
        if not conversation_history:
            return []

        tail: List[Dict[str, str]] = []
        for entry in conversation_history[-3:]:
            if not isinstance(entry, dict):
                continue

            text = entry.get("text") or entry.get("content")
            if not text:
                continue

            is_user = entry.get("isUser")
            if is_user is None:
                is_user = entry.get("is_user")
            if is_user is None:
                role = entry.get("role")
                is_user = role.lower() == "user" if isinstance(role, str) else True

            tail.append({
                "role": "user" if is_user else "assistant",
                "content": text,
            })

        return tail

    def _build_planner_context(self, user_id: Optional[int]) -> Dict[str, Any]:
        context: Dict[str, Any] = {}
        if user_id is not None:
            context["user_id"] = user_id
        if self.default_locale:
            context["locale"] = self.default_locale
        return context

    def _resolve_session_id(
        self,
        message: str,
        conversation_id: Optional[str],
        user_id: Optional[int],
    ) -> int:
        if conversation_id:
            digits = "".join(ch for ch in conversation_id if ch.isdigit())
            if digits:
                try:
                    return int(digits[:9])
                except ValueError:
                    pass

            try:
                conv_uuid = uuid.UUID(conversation_id)
                return conv_uuid.int % 1_000_000_000
            except ValueError:
                pass

        if user_id is not None:
            try:
                return int(user_id)
            except (TypeError, ValueError):
                pass

        digest = hashlib.sha1(f"{conversation_id}:{message}".encode("utf-8")).digest()
        fallback = int.from_bytes(digest[:6], "big")
        return fallback % 1_000_000_000

    @staticmethod
    def _sanitize_env(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            return None
        if stripped[0] in {'"', "'"} and stripped[-1] == stripped[0]:
            stripped = stripped[1:-1].strip()
        return stripped or None

    def _determine_tools_needed(self, message: str, conversation_history: List[Dict] = None) -> List[str]:
        """Heuristically determine which tools are required for a message."""

        message_lower = message.lower()
        tools: List[str] = []

        # Helper function to inspect recent conversation context for keywords
        def history_contains(keywords: List[str]) -> bool:
            if not conversation_history:
                return False

            for entry in conversation_history[-3:]:
                text = entry.get("text", "").lower()
                if any(keyword in text for keyword in keywords):
                    return True
            return False

        # Decide on documentation usage
        documentation_keywords = [
            "how do i",
            "how can i",
            "steps",
            "instructions",
            "where do i",
            "button",
            "menu",
            "navigate",
            "screen",
            "ui",
            "page",
            "workflow",
        ]

        if any(keyword in message_lower for keyword in documentation_keywords) or history_contains(documentation_keywords):
            tools.append("rag")

        # Decide on SQL usage
        sql_keywords = [
            "list",
            "show",
            "find",
            "lookup",
            "search",
            "give me",
            "how many",
            "total",
            "count",
            "recent",
            "last",
            "example",
            "existing",
            "current",
        ]

        business_entities = [
            "customer",
            "vendor",
            "quote",
            "purchase order",
            "sales order",
            "inventory",
            "part",
            "item",
            "invoice",
            "user",
        ]

        wants_data = any(keyword in message_lower for keyword in sql_keywords)
        references_entity = any(entity in message_lower for entity in business_entities)

        if (wants_data and references_entity) or history_contains(business_entities):
            tools.append("sql")

        action_keywords = [
            "create",
            "open",
            "start",
            "generate",
            "update",
            "change",
            "modify",
            "close",
            "email",
            "send",
            "convert",
            "complete",
        ]

        action_entities = [
            "purchase order",
            "po",
            "sales order",
            "so",
            "quote",
            "pickup",
            "order",
        ]

        wants_action = any(keyword in message_lower for keyword in action_keywords)
        targets_entity = any(entity in message_lower for entity in action_entities)

        if (wants_action and targets_entity) or history_contains(action_entities):
            tools.append("action")

        # Always ensure LLM knowledge is available as a baseline option
        if "llm_knowledge" not in tools:
            tools.append("llm_knowledge")

        return tools
    
    async def _generate_sql_query(
        self,
        message: str,
        conversation_history: List[Dict] = None,
        *,
        table_hints: Optional[Sequence[str]] = None,
    ) -> str:
        """Generate SQL query based on message content and conversation context"""
        try:
            # Get schema info first
            hint_fragment = ""
            if table_hints:
                hint_fragment = " focusing on tables: " + ", ".join(dict.fromkeys(table_hints))
            schema_query = (
                f"database schema tables columns structure for query: {message}{hint_fragment}"
            )
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
            table_hint_section = ""
            if table_hints:
                formatted_hints = "\n".join(f"- {table}" for table in dict.fromkeys(table_hints))
                table_hint_section = f"\n\n**TABLE HINTS FROM PLANNER:**\n{formatted_hints}"

            sql_prompt = f"""You are an expert SQL generator for the Aiven inventory management system.

**USER QUESTION:** {message}{conversation_context}

**DATABASE SCHEMA INFORMATION:**
{schema_info}{table_hint_section}

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

        actions_info = gathered_info.get("actions")
        if isinstance(actions_info, dict):
            action_traces = actions_info.get("actions")
            if isinstance(action_traces, list) and action_traces:
                successes = sum(1 for trace in action_traces if trace.get("success"))
                if successes == len(action_traces):
                    confidence += 0.25
                elif successes > 0:
                    confidence += 0.1
                else:
                    confidence -= 0.15

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
            if not self.rag_tool:
                health_status["vector_db"] = "disabled"
            elif self.documentation_enabled:
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
                "inventory_query": self.stats["sql_queries"],
                "action_workflows": self.stats["action_queries"]
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
            if self.action_tool:
                await self.action_tool.cleanup()
            if self.analytics_sink:
                await self.analytics_sink.aclose()
            if self.planner_client:
                await self.planner_client.aclose()
            self.initialized = False
            logger.info("AI Agent cleanup completed")
        except Exception as e:
            logger.error(f"Cleanup error: {e}")

# Documentation QA Subagent

## Purpose and Scope
- Provide authoritative answers to documentation and workflow questions using the existing documentation RAG corpus.
- Serve planner `lookup`/`tool` steps that request documentation or knowledge base information.
- Return structured answers, citations, and guardrail signals that downstream orchestrators can render or escalate.

## Operating Context
- Triggered by planner steps referencing `documentation_qa` (tool) or `documentation_lookup` (lookup type).
- Receives latest user message, conversation snippets, and optional planner-provided focus hints (target feature, page, workflow).
- Interacts with the `DocumentationRAGTool` for retrieval and uses Gemini (via `AivenAgent.llm`) for synthesis.
- Must emit telemetry so the analytics sink can record success/failure, latency, and document coverage.

## Request Contract (Draft)
```jsonc
{
  "session_id": 4815162342,
  "step_id": "plan-step-2",
  "question": "How do I convert a quote into a sales order?",
  "context": {
    "conversation_tail": [
      {"role": "user", "content": "We sent a quote yesterday"},
      {"role": "assistant", "content": "Do you want to convert it?"}
    ],
    "focus": {
      "module": "quotes",
      "workflow": "quote_to_sales_order"
    }
  },
  "planner_payload": {
    "tool_name": "documentation_qa",
    "result_key": "quote_conversion_doc"
  }
}
```

## Response Contract (Draft)
```jsonc
{
  "step_id": "plan-step-2",
  "status": "success", // success | no_answer | error
  "answer": "...final assistant response...",
  "citations": [
    {
      "title": "Quotes → Sales Orders",
      "path": "documentation_rag",
      "score": 0.82
    }
  ],
  "reasoning": "Summarized available guidance from Quotes section",
  "metrics": {
    "latency_ms": 930,
    "retrieval_count": 4
  },
  "result_key": "quote_conversion_doc"
}
```
- `result_key` echoes the planner payload for aggregator caching.
- `status=no_answer` indicates retrieval ran but confidence < threshold.
- `status=error` should include an `error` field with message/trace identifier.

## Execution Flow
1. **Prepare prompt context**
   - Normalize and combine `question`, conversation tail, and planner `focus` hints.
   - Generate retrieval query variants: raw question, focus-specific, conversation tail enriched.
2. **Retrieve documentation**
   - Call `DocumentationRAGTool.search_with_metadata` via an async wrapper for each query (max 2) until coverage threshold is met (`>=2` chunks with score `>0.55`).
   - Capture chunk metadata (title, section, score) for logging and citations.
3. **Synthesize answer**
   - Build instruction prompt emphasizing adherence to retrieved content, explicit mention of UI labels, and refusal if insufficient.
   - Include conversation tail to maintain continuity.
4. **Guardrails**
   - If retrieval is empty or average score <0.45, return `status=no_answer` with fallback guidance.
   - If Gemini call fails, return `status=error` and log to analytics sink.
5. **Telemetry hooks**
   - Emit `subagent_invocation_started`/`completed` events via `AnalyticsSink.log_event` with retrieval statistics.
   - Future work: push structured metrics to planner telemetry stream.

## Implementation Tasks
- [x] Draft architecture and contracts (this document).
- [x] Create `ai_agent/subagents/__init__.py` namespace and `documentation_qa.py` implementation scaffold.
- [x] Wire the subagent into `AivenAgent` so planner-directed steps call it (feature flag for gradual rollout).
- [x] Expose FastAPI endpoint for manual invocation/testing (`POST /subagents/documentation-qa`).
- [x] Add unit tests covering retrieval thresholds and failure modes.
- [x] Document runbook for no-answer escalation.

**Feature flag & verification**
- Enable planner-driven execution with `AI_ENABLE_DOCUMENTATION_QA_SUBAGENT=true` (requires documentation ingestion + Gemini credentials).
- Hit `POST /subagents/documentation-qa` with a question payload to exercise the subagent directly; the response mirrors the planner-facing contract, including citations and metrics.

## Open Questions
- Should retrieval leverage existing Chroma `result` metadata or new chunk schema with explicit headings?
- Do we need per-tenant documentation filtering before launch?
- What is the target latency budget per documentation lookup (sub-1s vs. 2s acceptable)?

## Dependencies
- `soft-sme-backend/ai_agent/rag_tool.py`
- `soft-sme-backend/ai_agent/analytics_sink.py`
- Gemini model credentials (already required by `AivenAgent`).

## Next Checkpoint
With unit tests and the escalation runbook in place, the next milestone is onboarding the row-selection subagent so the planner can route relational lookups with confidence.

## No-Answer Escalation Runbook
When the subagent returns `status=no_answer`, follow this checklist to keep customer responses moving while we improve coverage:

1. **Verify the request.** Confirm the customer question and planner focus hints in the `subagent_invocation_started` analytics event to ensure the correct intent was targeted.
2. **Inspect retrieval gaps.** Review the `coverage_score` and `retrieval_count` metadata attached to the `subagent_invocation_completed` event. Scores below `0.45` require escalation.
3. **Search documentation manually.** Use the documentation portal or the raw Chroma collection to find candidate articles. Capture missing sections or outdated instructions.
4. **Respond to the customer.** Provide the best-effort answer with explicit caveats that the workflow is being validated. Link any documentation that partially addresses the request.
5. **File a documentation update.** Open a task in the docs backlog referencing the conversation transcript, retrieved chunk IDs, and recommended fixes.
6. **Tag analytics for follow-up.** Add a `no_answer_reviewed=true` annotation in the analytics dashboard so product can track closure and prioritize the ingestion pipeline refresh.

Escalations should be resolved within one business day. If the same question triggers two `no_answer` outcomes in a week, prioritize the documentation update ahead of other backlog items.

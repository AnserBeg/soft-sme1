# AI Automation and Agent Endpoints

Document the AI assistant lifecycle so embeddings can answer orchestration and contract questions for human operators, developers, and incident responders.

## Lifecycle Overview

1. **Initialize Conversation:** `/ai/conversations` provisions conversation state and seeds context.
2. **Chat Loop:** `/ai/messages` handles bidirectional exchanges and tool-call responses.
3. **Health & Metrics:** `/ai/health`, `/ai/stats` expose operational signals for monitoring.
4. **History Retrieval:** `/ai/history` returns transcript snippets for follow-up workflows.
5. **Voice Escalations:** `/voice/*` routes calls to the voice subagent.

## Endpoint Expectations

- **Authentication:** Service-to-service tokens with scope restrictions documented in `docs/ai-assistant/security-review-multi-agent-stack.md`.
- **Payloads:** JSON contracts defined in `docs/ai-assistant/planner-schema-contract.md` and `docs/ai-assistant/aggregator-module.md`.
- **Fallback Behavior:** Revert to manual queue if latency > threshold or tool-call failure occurs (`docs/ai-assistant/implementation-roadmap.md`).

## Subagents & Specializations

- **Planner:** Task decomposition (`docs/ai-assistant/planner-schema-contract.md`).
- **Voice Call Subagent:** Telephony intents and escalation mapping (`docs/ai-assistant/voice-call-subagent-discovery.md`).
- **Aggregator:** Data stitching from backend services (`docs/ai-assistant/aggregator-module.md`).
- **Reports:** Automated report generation flows (`docs/ai-assistant/reports/`).

## Permissions & Roles

- Define scopes for support agents vs. system automations in `docs/ai-assistant/stakeholder-questionnaire.md`.
- Capture approval workflows and manual overrides in `docs/ai-assistant/advanced-agent-upgrade-plan.md`.

## Troubleshooting Playbooks

- **Latency or Errors:** Consult `docs/ai-assistant/AI_AGENT_MIGRATION_AUDIT.md` for known failure modes.
- **Security Incidents:** Follow the escalation matrix in `docs/ai-assistant/security-review-multi-agent-stack.md`.
- **Integration Drift:** Cross-check planner schemas against backend routes listed in `docs/rag/backend.md`.

## FAQs

- How do agents share context? → Use the aggregator state diagrams and conversation history endpoints.
- How to onboard new skills? → Update planner contract and regenerate embeddings for affected modules.
- What happens during partial outages? → Voice subagent handles fallbacks; manual queue picks up unresolved tickets.

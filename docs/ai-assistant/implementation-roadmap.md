# AI Assistant Reimplementation Roadmap

## Phase 1 – Requirements and Guardrails

### Objectives
- Capture end-to-end workflows the assistant must support (purchase orders, sales orders, customer/vendor onboarding, email configuration/sending, data lookups).
- Document role-based permissions and compliance boundaries for each workflow.
- Define conversational behavior when documentation is unavailable.

### Information Needed
- Stakeholder contacts for purchasing, sales, accounting, support, and IT.
- Required data fields, default values, and approval rules per workflow.
- Audit and logging requirements (who reviews, retention expectations).
- Known constraints for Gemini usage (rate limits, cost thresholds).

### Next Actions
- [ ] Schedule stakeholder interviews (owner: __________, target date: __________).
- [ ] Draft user stories and acceptance criteria for each workflow.
- [ ] Enumerate security/permission rules and validate with compliance owners.
- [ ] Produce "documentation disabled" response guidelines for policy questions.

---

## Phase 2 – Legacy System Assessment and Cutover Strategy

### Objectives
- Inventory current touchpoints of the Python-based assistant.
- Decide on migration approach (feature flag, blue/green, or direct cutover).
- Prepare rollback plan for production environments.

### Information Needed
- List of services/environments currently using `/api/ai-assistant` routes.
- Telemetry or logs highlighting present failure modes.
- Deployment calendar and blackout dates for major releases.

### Next Actions
- [ ] Map backend and frontend dependencies on the legacy agent.
- [ ] Identify configuration flags needed to run legacy and new agent side by side.
- [ ] Draft rollback playbook including required environment variables and scripts.

---

## Phase 3 – Core Runtime and Conversation Management

### Objectives
- Choose hosting model (embedded Node worker vs. separate service).
- Define API contract between frontend, backend, and agent runtime.
- Implement session state, memory handling, and observability.

### Information Needed
- Infrastructure preferences (Docker, serverless, VM-based).
- Latency and throughput targets for conversational interactions.
- Logging/monitoring stack details (e.g., Datadog, ELK, Prometheus).

### Next Actions
- [ ] Produce architecture diagram covering request flow and failure handling.
- [ ] Specify system prompts and conversation policies (with and without documentation).
- [ ] Design telemetry schema (structured logs, metrics, trace IDs).

---

## Phase 4 – Data Access and Read Tools

### Objectives
- Wrap existing read-only APIs as agent tools.
- Enforce per-user authorization within tool handlers.

### Information Needed
- List of existing Express endpoints providing read access.
- Current RBAC model and user identity propagation to backend services.

### Next Actions
- [ ] Catalogue read endpoints and create mapping to agent tools.
- [ ] Define tool schemas (input/output) and error handling strategy.
- [ ] Outline automated tests for read-tool coverage.

---

## Phase 5 – Transactional Tools for Core Workflows

### Objectives
- Enable the agent to create/update purchase orders, sales orders, customers, vendors, and send emails via existing services.
- Ensure conversational slot-filling collects required data before executing actions.

### Information Needed
- Mandatory and optional fields per transaction type.
- Validation rules currently enforced by Express services.
- Approval or review steps for sensitive operations.

### Next Actions
- [ ] Document required slots/questions per workflow.
- [ ] Plan confirmation and cancellation flows for each transaction.
- [ ] Identify audit logging enhancements needed for agent-initiated actions.

---

## Phase 6 – Frontend Experience Enhancements

### Objectives
- Upgrade chat UI to support multi-step interactions, confirmations, and status cards.
- Provide affordances for editing inputs and cancelling actions.

### Information Needed
- Design resources or style guides for interactive components.
- Accessibility and localization requirements.

### Next Actions
- [ ] Draft UX flows/wireframes for transactional conversations.
- [ ] Inventory required frontend components and state management changes.
- [ ] Plan analytics instrumentation for chat interactions.

---

## Phase 7 – Security, Testing, and Launch Readiness

### Objectives
- Enforce role-based permissions and auditing.
- Establish automated testing across unit, integration, and smoke levels.
- Define monitoring, alerting, and incident response.

### Information Needed
- Compliance requirements (SOX, GDPR, etc.).
- Existing CI/CD tooling and test frameworks.
- On-call processes and escalation contacts.

### Next Actions
- [ ] Draft test plan covering happy paths, edge cases, and failure handling.
- [ ] Configure monitoring dashboards and alert thresholds.
- [ ] Prepare incident response checklist.

---

## Phase 8 – Launch, Training, and Post-Launch Documentation

### Objectives
- Deliver updated user/admin guides and training resources.
- Plan staged rollout with feedback loops and rollback triggers.
- Prepare future documentation ingestion once knowledge base is ready.

### Information Needed
- Training delivery format (live sessions, recorded videos, in-app guides).
- Success metrics (adoption, satisfaction, transaction accuracy).
- Documentation maintenance responsibilities.

### Next Actions
- [ ] Produce launch communication plan.
- [ ] Schedule pilot rollout and gather feedback milestones.
- [ ] Draft knowledge base ingestion plan for post-launch phase.

---

## Open Questions for Stakeholders
- Which workflows should be prioritized for the first release?
- Are there compliance or audit requirements beyond standard logging?
- How will user identity and permissions be conveyed to the agent runtime?
- What SLAs must the assistant meet for response time and success rates?


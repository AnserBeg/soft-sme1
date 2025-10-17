# ReAct + Multi-Agent Rollout Playbook

This playbook orchestrates the phased deployment of the upgraded AI assistant across environments while guarding customer experience, compliance, and observability requirements.

## 1. Preparation Phase
- **Stakeholder alignment**
  - Confirm sign-off from product, support, compliance, and SRE leads.
  - Review success criteria (evaluation harness metrics, guardrail readiness, SLA thresholds).
- **Environment readiness**
  - Validate database migrations applied (skill workflows, conversation reflections, telemetry tables).
  - Ensure feature flags for ReAct loop, multi-agent runner, critic revision, and voice insights exist in the configuration service.
- **Runbooks & dashboards**
  - Publish updated operator runbooks covering planner overrides, guardrail compensations, and telemetry dashboards.
  - Confirm alert routing in analytics pipeline (latency, cost, guardrail failure notifications).

## 2. Staged Deployment Steps
1. **Canary (Internal QA)**
   - Enable ReAct + multi-agent flags for internal tenants only.
   - Monitor evaluation harness outputs, guardrail compensations, and latency alerts for 48 hours.
   - Collect qualitative feedback from internal support testers; log issues in `docs/ai-assistant/reports/phase4-synthetic-conversation-suite.md`.
2. **Limited Beta (Early Access Customers)**
   - Expand flag rollout to pre-selected beta customers with dedicated account managers.
   - Activate voice subagent only for accounts with confirmed transcript ingestion paths.
   - Run daily regression harness and publish delta reports comparing baseline vs. beta metrics.
3. **General Availability**
   - Roll out flags to all tenants once success metrics meet or exceed targets for five consecutive runs.
   - Move guardrail compensation tasks from "observe" to "enforce" mode (automatic remediation without manual approval).
   - Send release notes summarizing architecture changes, benefits, and support contacts.

## 3. Communication Plan
- **Pre-launch**: Email announcement to stakeholders with deployment calendar, expected impacts, and escalation matrix.
- **During rollout**: Live status page updates and dedicated Slack channel for triage.
- **Post-launch**: Publish retrospective covering metrics, incidents, and lessons learned; archive in `docs/ai-assistant/reports/`.

## 4. Risk Mitigation & Rollback
- Maintain the legacy single-agent pipeline behind a `agent_v1_fallback` flag; toggle if critical regressions appear.
- Automated rollback triggers when:
  - Guardrail compensations exceed 5% of runs for two consecutive evaluation cycles.
  - SLA latency thresholds breached for three consecutive monitoring intervals.
- Manual rollback process:
  1. Disable multi-agent feature flags in planner configuration.
  2. Drain orchestration workers and flush in-flight tasks.
  3. Notify stakeholders and capture incident timeline in the retrospective doc template.

## 5. Compliance & Audit Requirements
- Store deployment decisions and approvals in the governance tracker (see `security-review-multi-agent-stack.md`).
- Retain evaluation harness outputs for 90 days to support compliance audits.
- Update data processing records with new telemetry fields and voice transcription flows.

## 6. Post-Launch Monitoring
- Review evaluation dashboards weekly; adjust tool scoring weights based on reflection data.
- Conduct monthly guardrail scenario drills to ensure compensations execute as designed.
- Schedule quarterly security and privacy reviews to reassess risk posture and update RBAC policies.

## 7. Exit Criteria for Rollout Initiative
- All tenants operate on the ReAct + multi-agent stack with guardrail automation enabled.
- Support teams trained on new tooling and incident procedures.
- Governance artifacts (approvals, retrospectives, audit logs) stored and discoverable.
- Continuous evaluation pipeline embedded in release management workflows.

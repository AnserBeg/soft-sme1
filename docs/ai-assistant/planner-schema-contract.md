# Planner Service Schema Contract

This document captures the canonical request and response schema shared between the orchestrator and the
`planner-service`. The contract is implemented in `soft-sme-backend/planner_service/schemas.py` and versioned via the
`PlannerMetadata.version` field. The current version is **0.1**.

## Request payload (`POST /plan`)

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `session_id` | integer | ✅ | Conversation/session identifier provided by the orchestrator. |
| `message` | string | ✅ | Latest user utterance that requires planning. |
| `context.company_id` | integer | ❌ | Tenant/company identifier. When omitted the planner should default to generic tooling. |
| `context.user_id` | integer | ❌ | User that triggered the request. Useful for personalization and auditing. |
| `context.locale` | string | ❌ | Locale hint to adjust copy, tool selection, or escalation path. |
| `timestamp` | ISO 8601 datetime | ✅ (defaults) | When the request was emitted. Defaults to `datetime.utcnow()` if omitted. |

### Example request

```json
{
  "session_id": 4815162342,
  "message": "We need to generate a purchase order from quote Q-0192",
  "context": {
    "company_id": 92,
    "user_id": 731,
    "locale": "en-US"
  }
}
```

## Response payload

| Field | Type | Description |
| --- | --- | --- |
| `session_id` | integer | Echo of the original request `session_id`. |
| `steps` | array[`PlannerStep`] | Ordered list of plan steps for the orchestrator to execute. |
| `metadata.model` | string | Identifier of the planning strategy/model that produced the plan. |
| `metadata.rationale` | string | Optional high-level reasoning trace. Useful for debugging and evaluators. |
| `metadata.version` | string | Schema version. Increment when the contract changes in a breaking way. |

### Planner step structure

Every `PlannerStep` contains a `type` and an associated payload model. The combination of `type` + payload is enforced
in `schemas.py`, ensuring downstream services always receive a predictable structure.

| Step type | Payload model | Description |
| --- | --- | --- |
| `tool` | [`ToolStepPayload`](#toolsteppayload) | Invoke a registered tool/workflow with structured arguments. |
| `message` | [`MessageStepPayload`](#messagesteppayload) | Emit a conversational message back to the UI. |
| `lookup` | [`LookupStepPayload`](#lookupsteppayload) | Perform a knowledge/data lookup whose results can feed later steps. |

#### `ToolStepPayload`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tool_name` | string | ✅ | Registered tool identifier. |
| `arguments` | object | ❌ | Arbitrary JSON payload forwarded to the tool. |
| `result_key` | string | ❌ | Identifier that later steps can reference (e.g. `{{results.address_lookup}}`). |
| `escalate_on_failure` | boolean | ❌ | When `true` the orchestrator should halt on tool errors and surface to an operator. |

#### `MessageStepPayload`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `channel` | enum(`assistant`, `system`, `user`) | ✅ | Logical channel for UI rendering. |
| `content` | string | ✅ | Message body shown to the end user. |
| `summary` | string | ❌ | Short synopsis for notifications/logging. |
| `metadata` | object | ❌ | Key/value metadata preserved for telemetry or advanced UI behaviors. |

#### `LookupStepPayload`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `query` | string | ✅ | Canonical query text issued to the lookup target. |
| `target` | enum(`knowledge_base`, `database`, `api`) | ✅ | Downstream system that should process the lookup. |
| `filters` | object | ❌ | Structured filters to scope the lookup domain. |
| `result_key` | string | ❌ | Identifier that later steps can reference. |

### Example response

```json
{
  "session_id": 4815162342,
  "steps": [
    {
      "id": "step-1",
      "type": "tool",
      "description": "Fetch quote Q-0192 details",
      "payload": {
        "tool_name": "quote_lookup",
        "arguments": {"quote_id": "Q-0192"},
        "result_key": "quote_details"
      }
    },
    {
      "id": "step-2",
      "type": "tool",
      "description": "Create purchase order from quote results",
      "depends_on": ["step-1"],
      "payload": {
        "tool_name": "create_purchase_order",
        "arguments": {
          "quote": "{{results.quote_details}}",
          "notify_sales_rep": true
        },
        "result_key": "po_draft"
      }
    },
    {
      "id": "step-3",
      "type": "message",
      "description": "Confirm purchase order draft",
      "depends_on": ["step-2"],
      "payload": {
        "channel": "assistant",
        "content": "I've created a draft purchase order from quote Q-0192. Would you like me to submit it?",
        "summary": "PO draft ready",
        "metadata": {"draft_id": "{{results.po_draft}}"}
      }
    }
  ],
  "metadata": {
    "model": "planner-gpt-2024-05",
    "rationale": "Tool-first plan because quote context exists in CRM",
    "version": "0.1"
  }
}
```

## Versioning & change management

* Increment `PlannerMetadata.version` when the request or response contract introduces breaking changes.
* Coordinated changes should be documented in this file and communicated via release notes to orchestrator and
  subagent teams.
* The JSON examples above are suitable for use in contract tests to guard against regressions.

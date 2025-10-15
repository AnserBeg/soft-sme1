# Planner Service

This directory contains the initial FastAPI scaffolding for the multi-agent planner service. The goal of the
planner is to convert a user utterance plus orchestrator context into a structured plan that downstream subagents
can execute.

## Getting started

```bash
cd soft-sme-backend/planner_service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn planner_service.main:app --reload
```

Once the service is running you can verify it with:

```bash
curl http://localhost:8000/healthz
curl -X POST http://localhost:8000/plan \
  -H "Content-Type: application/json" \
  -d '{"session_id": 1, "message": "Need help creating a purchase order"}'
```

The `/plan` endpoint currently returns a placeholder plan so that orchestrator integration work can proceed while
the actual planning logic and telemetry hooks are implemented in subsequent tasks. Refer to
[`docs/ai-assistant/planner-schema-contract.md`](../../docs/ai-assistant/planner-schema-contract.md) for the
formal request/response contract, including the structured payloads emitted for each planner step type. Version 0.2 of
the contract introduces the `action` step payload used by the action/workflow subagent to queue side-effectful
operations safely.

## Telemetry

Planner requests automatically emit JSON-formatted telemetry events (request received, plan generated, plan
failed) to the service logger. These events include a trace identifier, session ID, latency metrics, and plan
metadata so downstream collectors can ship them to the existing analytics pipeline. Configure the deployment's
logging sink (e.g., Datadog, ELK) to capture log lines from the `planner_service.telemetry` logger in order to
visualize planner health and investigate failures.

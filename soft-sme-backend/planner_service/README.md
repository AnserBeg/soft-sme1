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
the actual planning logic, schema contract refinements, and telemetry hooks are implemented in subsequent tasks.

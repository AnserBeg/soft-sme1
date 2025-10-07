## RAG Agent (Self-contained under backend)

This folder contains the Retrieval-Augmented Generation utilities for NEURATASK, colocated with the Node backend to keep deployment self-contained and separate from the legacy Python `ai_agent`.

Files:
- `rag_documentation_setup.py`: Build and manage the vector database (Chroma by default) under `rag_agent/chroma_db`.
- `ai_assistant_rag_integration.py`: Helper to fetch relevant context for questions and demo/interactive CLI.
- `requirements_rag.txt`: Python dependencies for RAG utilities.

Usage:
```bash
cd soft-sme-backend/rag_agent
pip install -r requirements_rag.txt
python rag_documentation_setup.py --test
python ai_assistant_rag_integration.py --demo
```

Docs are read from the repository root by default; you can pass `--docs-dir` pointing to where your `.md` files live (e.g., `..` or `../..`).


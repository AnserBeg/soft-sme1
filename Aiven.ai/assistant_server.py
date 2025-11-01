import os
import json
from typing import Optional, Tuple

from flask import Flask, request, jsonify
import importlib.util
import pathlib

# Dynamically load router.py from this directory so we don't require a package
HERE = pathlib.Path(__file__).resolve().parent

# Prefer a router.py colocated with this file; fall back to the backend copy
primary_router = HERE / "router.py"
fallback_router = HERE.parent / "soft-sme-backend" / "Aiven.ai" / "router.py"

ROUTER_PATH = primary_router if primary_router.exists() else fallback_router

if not ROUTER_PATH.exists():
    raise RuntimeError(
        f"router.py not found. Checked: {primary_router} and {fallback_router}"
    )

spec = importlib.util.spec_from_file_location("aiven_router", str(ROUTER_PATH))
assert spec and spec.loader, f"Failed to load router module from {ROUTER_PATH}"
router_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(router_mod)  # type: ignore


app = Flask(__name__)


def _resolve_pdf_path() -> Optional[str]:
    # Allow override via env, else use router default finder
    p = os.getenv("DOC_PDF_PATH")
    if p and os.path.exists(p):
        return p
    try:
        return router_mod.find_default_pdf_path()
    except Exception:
        return None


def _ensure_client():
    return router_mod.get_client()


def _answer(user_prompt: str, mode: Optional[str]) -> Tuple[str, Optional[list]]:
    client = _ensure_client()
    pdf_path = _resolve_pdf_path()

    # Decide route if not forced
    route = (mode or "").strip().upper()
    if route not in {"SQL", "DOC"}:
        route = router_mod.decide_route(client, user_prompt)

    if route == "SQL":
        sql_api = os.getenv("SQL_API", "")
        resp = router_mod.sql_answer(sql_api, user_prompt)
        if isinstance(resp, dict):
            return str(resp.get("text", "")), resp.get("rows")
        return str(resp), None

    # DOC path
    if not pdf_path:
        return "AIVEN ERP Documentation.pdf not found. Configure DOC_PDF_PATH or deploy the PDF.", None
    text = router_mod.doc_answer(client, user_prompt, pdf_path)
    return text, None


@app.get("/health")
def health():
    model = os.getenv("GEMINI_MODEL", getattr(router_mod, "MODEL", ""))
    pdf_path = _resolve_pdf_path()
    ok_pdf = bool(pdf_path and os.path.exists(pdf_path))
    db_url = bool(os.getenv("DATABASE_URL"))
    return jsonify({
        "status": "ok",
        "model": model,
        "pdf": pdf_path or "<not found>",
        "pdf_available": ok_pdf,
        "db_configured": db_url,
        "version": "1.0.0"
    })


@app.post("/assistant")
def assistant():
    try:
        data = request.get_json(silent=True) or {}
        prompt = data.get("prompt")
        mode = data.get("mode")  # Optional: "DOC" or "SQL"
        if not prompt or not isinstance(prompt, str):
            return jsonify({"error": "prompt is required"}), 400

        text, rows = _answer(prompt, mode)
        # Determine source from mode/route
        decided = (mode or "").strip().upper()
        if decided not in {"DOC", "SQL"}:
            # Quick re-evaluation to get the label without cost (heuristic)
            try:
                decided = router_mod.decide_route(_ensure_client(), prompt)
            except Exception:
                decided = "DOC"
        return jsonify({
            "source": decided,
            "text": text,
            "rows": rows
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    # Bind to localhost:5001 by default; Render will expose Node on $PORT.
    port = int(os.getenv("ASSISTANT_PORT", "5001"))
    app.run(host="127.0.0.1", port=port)

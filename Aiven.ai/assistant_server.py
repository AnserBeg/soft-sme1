import os
import sys
import json
from typing import Optional, Tuple

import importlib.util
import subprocess
import pathlib

# Ensure user site-packages are importable on managed runtimes (Render native)
def _ensure_python_paths():
    try:
        import site  # noqa: F401
        user_site = None
        try:
            # May fail on some stripped builds
            user_site = site.getusersitepackages()  # type: ignore[attr-defined]
        except Exception:
            user_site = None
        candidates = []
        if user_site:
            candidates.append(user_site)
        # Also respect PYTHONPATH entries
        env_pp = os.getenv("PYTHONPATH", "")
        if env_pp:
            candidates.extend([p for p in env_pp.split(":") if p])
        # Common Render user-site locations
        candidates.extend([
            "/opt/render/.local/lib/python3.13/site-packages",
            "/opt/render/.local/lib/python3.12/site-packages",
            "/opt/render/.local/lib/python3.11/site-packages",
        ])

        added = 0
        for p in candidates:
            if p and os.path.isdir(p) and p not in sys.path:
                sys.path.append(p)
                added += 1
        if added:
            print(f"[assistant] Added {added} site-packages paths for import")
    except Exception as e:
        print(f"[assistant] Failed to adjust PYTHONPATH: {e}")

_ensure_python_paths()


def _ensure_database_url():
    """
    Populate DATABASE_URL for the SQL agent if it isn't already set.

    Priority:
      1) Existing DATABASE_URL
      2) AI_AGENT_DATABASE_URL / AGENT_DATABASE_URL
      3) Construct from DB_* or PG* env vars
    """
    if os.getenv("DATABASE_URL"):
        return

    # Allow override via explicit agent-specific variables
    for key in ("AI_AGENT_DATABASE_URL", "AGENT_DATABASE_URL", "SQL_DATABASE_URL"):
        val = os.getenv(key)
        if val:
            os.environ["DATABASE_URL"] = val
            print(f"[assistant] DATABASE_URL sourced from {key}")
            return

    host = os.getenv("DB_HOST") or os.getenv("PGHOST")
    port = os.getenv("DB_PORT") or os.getenv("PGPORT") or "5432"
    name = os.getenv("DB_DATABASE") or os.getenv("DB_NAME") or os.getenv("PGDATABASE")
    user = os.getenv("DB_USER") or os.getenv("PGUSER")
    password = os.getenv("DB_PASSWORD") or os.getenv("PGPASSWORD")

    if not (host and name and user and password):
        return

    ssl_mode = os.getenv("DB_SSLMODE")
    if not ssl_mode:
        flag = (os.getenv("DB_SSL") or "").strip().lower()
        if flag in ("1", "true", "yes", "on"):
            ssl_mode = "require"

    url = f"postgresql://{user}:{password}@{host}:{port}/{name}"
    if ssl_mode:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}sslmode={ssl_mode}"

    os.environ["DATABASE_URL"] = url
    print("[assistant] DATABASE_URL constructed from DB_* env vars")


_ensure_database_url()

def _in_virtualenv() -> bool:
    try:
        # Strong heuristics: path contains a typical venv folder or prefixes differ
        if any(p and '/.venv/' in p for p in [sys.prefix, sys.executable]):
            return True
        base_prefix = getattr(sys, 'base_prefix', sys.prefix)
        real_prefix = getattr(sys, 'real_prefix', None)
        if real_prefix is not None:
            return True
        if sys.prefix != base_prefix:
            return True
        # site.getsitepackages() may include the venv path
        try:
            import site  # noqa: F401
            for sp in getattr(site, 'getsitepackages', lambda: [])():
                if '/.venv/' in sp:
                    return True
        except Exception:
            pass
        return bool(os.getenv('VIRTUAL_ENV'))
    except Exception:
        return bool(os.getenv('VIRTUAL_ENV'))


def _bootstrap_deps() -> bool:
    try:
        here = pathlib.Path(__file__).resolve().parent
        candidates = [
            here / "requirements.txt",
            here.parent / "soft-sme-backend" / "Aiven.ai" / "requirements.txt",
        ]
        req = next((p for p in candidates if p.exists()), None)
        if not req:
            print("[assistant] No requirements.txt found to bootstrap deps")
            return False
        install_args = ["-r", str(req)]
        if not _in_virtualenv():
            # Installing into system or user site; allow breaking managed envs and use --user
            install_args = ["--break-system-packages", "--user"] + install_args
        cmd = [sys.executable, "-m", "pip", "install", *install_args]
        print(f"[assistant] Bootstrapping Python deps via: {' '.join(cmd)}")
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        print(res.stdout)
        return res.returncode == 0
    except Exception as ex:
        print(f"[assistant] Failed to bootstrap deps: {ex}")
        return False

try:
    from flask import Flask, request, jsonify
except Exception:
    print("[assistant] Unable to import Flask. sys.path=\n" + "\n".join(sys.path))
    if _bootstrap_deps():
        _ensure_python_paths()
        from flask import Flask, request, jsonify  # type: ignore
    else:
        raise

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


@app.get("/healthz")
def healthz():
    # Alias for platforms expecting /healthz
    return health()


@app.get("/")
def root():
    # Basic root endpoint to avoid 404s on HEAD/GET /
    return jsonify({"service": "assistant", "status": "ok"})


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

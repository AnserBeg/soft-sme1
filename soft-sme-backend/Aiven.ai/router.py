import os
import sys
import json
import pathlib
import urllib.request
import urllib.error
from typing import Optional
import re

MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

try:
    from google import genai
    from google.genai import types
except Exception:
    print("google-genai package not available. Ensure python-genai is installed and on PYTHONPATH.")
    raise


def get_client():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("GEMINI_API_KEY not set. In PowerShell set with:")
        print("  $env:GEMINI_API_KEY=\"YOUR_API_KEY\"")
        sys.exit(1)
    return genai.Client(api_key=api_key)


def make_config(system_instruction: Optional[str] = None,
                thinking_budget: Optional[int] = None,
                temperature: Optional[float] = None):
    kwargs = {}
    if system_instruction:
        kwargs["system_instruction"] = system_instruction
    if thinking_budget is not None:
        kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=int(thinking_budget))
    if temperature is not None:
        kwargs["temperature"] = float(temperature)
    return types.GenerateContentConfig(**kwargs) if kwargs else None


def load_local_pdf_part(path: str):
    p = pathlib.Path(path)
    if not p.exists():
        raise FileNotFoundError(f"PDF not found: {p}")
    data = p.read_bytes()
    return types.Part.from_bytes(data=data, mime_type='application/pdf')


def find_default_pdf_path() -> Optional[str]:
    here = pathlib.Path(__file__).resolve().parent
    candidate = here / "AI chat bot" / "AIVEN ERP Documentation.pdf"
    if candidate.exists():
        return str(candidate)
    legacy = pathlib.Path(r"C:\Users\mirza\AI chat bot\AIVEN ERP Documentation.pdf")
    if legacy.exists():
        return str(legacy)
    return None

ROUTER_SYSTEM = (
    "You are the Router for the Aiven ERP Assistant. "
    "Decide which ONE tool should handle the user's request and reply with exactly one word: SQL or DOC. "
    "\n\nTools:\n"
    "- DOC: The PDF-based Aiven Assistant that answers 'how to use the system' questions strictly from the Aiven ERP user guide. "
    "Great for explanations, navigation, feature descriptions, setup steps, and reasons/policy behind features. No database access.\n"
    "- SQL: The SQL Bot that generates and runs safe Postgres queries to answer data questions (counts, sums, top/bottom, listings, metrics, time windows, etc.). "
    "Great for analytics about orders, customers, products, revenue, inventory levels, etc.\n\n"
    "Rules: Output only SQL or DOC. If unsure, choose DOC."
)


DOC_SYSTEM = (
    "You are an Assistant for companies using Aiven ERP. "
    "Answer using the provided Aiven ERP Documentation PDF only. "
    "Keep responses short, clear, and actionable, using exact UI terms from the guide. "
    "If the guide does not cover something, say so and offer the closest related explanation."
)


def decide_route(client, user_prompt: str) -> str:
    """Return 'SQL' or 'DOC'."""
    chat = client.chats.create(model=MODEL, config=make_config(ROUTER_SYSTEM, temperature=0))
    try:
        resp = chat.send_message(user_prompt)
        text = getattr(resp, 'text', '') or ''
        # Also attempt candidates fallback if needed
        if not text:
            try:
                text = resp.candidates[0].content.parts[0].text
            except Exception:
                text = ''
        choice = (text or '').strip().upper()
        # No local heuristics; trust Gemini's output. Default to DOC if unrecognized.
        if choice == 'SQL' or ('SQL' in choice and 'DOC' not in choice):
            return 'SQL'
        if choice == 'DOC' or 'DOC' in choice:
            return 'DOC'
        return 'DOC'
    except Exception:
        # If router call fails, default to DOC
        return 'DOC'


def doc_answer(client, user_prompt: str, pdf_path: str) -> str:
    pdf_part = load_local_pdf_part(pdf_path)
    chat = client.chats.create(model=MODEL, config=make_config(DOC_SYSTEM))
    resp = chat.send_message([pdf_part, user_prompt])
    text = getattr(resp, 'text', None)
    if not text:
        try:
            text = resp.candidates[0].content.parts[0].text
        except Exception:
            text = "<no text in response>"
    return text


def _load_sql_local_runner():
    """Try to load the in-process SQL agent runner from the API module.

    Returns a callable run_prompt(prompt: str) -> dict, or None if not available.
    """
    try:
        import importlib.util
        import pathlib as _pl

        here = _pl.Path(__file__).resolve().parent
        api_dir = here / "AI SQL bot" / "multi-agent-postgres-data-analytics-main" / "api-server" / "api"
        index_path = api_dir / "index.py"
        if not index_path.exists():
            return None

        # Preload env vars from .env files if missing
        def _load_env_file(p: _pl.Path):
            try:
                if p.exists():
                    for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                        s = line.strip()
                        if not s or s.startswith('#') or '=' not in s:
                            continue
                        k, v = s.split('=', 1)
                        k, v = k.strip(), v.strip().strip('"').strip("'")
                        if k and k not in os.environ:
                            os.environ[k] = v
            except Exception:
                pass

        project_root = here / "AI SQL bot" / "multi-agent-postgres-data-analytics-main"
        _load_env_file(project_root / ".env")
        _load_env_file(api_dir.parent / ".env")  # api-server/.env if present

        # Ensure API folder is importable so "from modules import ..." works
        if str(api_dir) not in sys.path:
            sys.path.insert(0, str(api_dir))

        spec = importlib.util.spec_from_file_location("sql_api_index", str(index_path))
        mod = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(mod)  # type: ignore
        run_prompt = getattr(mod, "run_prompt", None)
        if callable(run_prompt):
            return run_prompt
        return None
    except Exception:
        return None


def sql_answer(sql_api_base: str, user_prompt: str):
    # Prefer local in-process runner if no API base provided or API is unreachable
    if not sql_api_base:
        runner = _load_sql_local_runner()
        if runner:
            try:
                obj = runner(user_prompt)
                # Conform to existing return contract
                text = (obj or {}).get('summary') or (obj or {}).get('results') or json.dumps(obj)
                rows = None
                try:
                    rows = json.loads((obj or {}).get('results') or '[]')
                except Exception:
                    rows = None
                return { 'text': text, 'rows': rows }
            except Exception as e:
                return f"Local SQL runner error: {e}"
    url = sql_api_base.rstrip('/') + '/prompt'
    body = json.dumps({"prompt": user_prompt}).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers={
        'Content-Type': 'application/json'
    }, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
            try:
                obj = json.loads(data.decode('utf-8'))
            except Exception:
                return { 'text': data.decode('utf-8', errors='ignore'), 'rows': None }
            # Prefer summary if present, else raw results
            if isinstance(obj, dict):
                text = obj.get('summary') or obj.get('results') or json.dumps(obj)
                # Final guard: strip any appended SQL disclosure from summary/results
                if isinstance(text, str):
                    s = text.replace("```", "").strip()
                    pattern_label = re.compile(r"(?im)^\s*(sql\b.*:|--\s*sql\b|query\s*:)")
                    m = pattern_label.search(s)
                    if m:
                        s = s[: m.start()].rstrip()
                    pattern_sql = re.compile(r"(?im)^\s*(select|with|insert|update|delete|create|drop)\b")
                    m2 = pattern_sql.search(s)
                    if m2:
                        s = s[: m2.start()].rstrip()
                    text = s
                rows = None
                try:
                    rows = json.loads(obj.get('results') or '[]') if isinstance(obj.get('results'), str) else obj.get('results')
                except Exception:
                    rows = None
                return { 'text': text, 'rows': rows }
            return { 'text': json.dumps(obj), 'rows': None }
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode('utf-8', errors='ignore')
        except Exception:
            err_body = str(e)
        return f"SQL API error {e.code}: {err_body}"
    except urllib.error.URLError as e:
        return (
            "Unable to reach SQL Bot API. Ensure it is running at the expected URL.\n"
            f"Error: {e}"
        )


def main():
    # CLI usage:
    #   python router.py              -> interactive loop
    #   python router.py --once "..." -> single prompt
    # Options:
    #   --sql-api http://localhost:3000
    #   --pdf "C:\\path\\to\\AIVEN ERP Documentation.pdf"

    args = sys.argv[1:]
    sql_api = os.getenv("SQL_API", "")
    pdf_path = None
    once = False
    single_prompt = None

    i = 0
    while i < len(args):
        a = args[i]
        if a == "--sql-api" and i + 1 < len(args):
            sql_api = args[i + 1]
            i += 2
        elif a == "--pdf" and i + 1 < len(args):
            pdf_path = args[i + 1]
            i += 2
        elif a == "--once" and i + 1 < len(args):
            once = True
            single_prompt = args[i + 1]
            i += 2
        else:
            # Treat remaining tokens as the single prompt (without --once)
            if not once and a and not a.startswith("--"):
                once = True
                single_prompt = " ".join(args[i:])
                break
            i += 1

    if not pdf_path:
        pdf_path = find_default_pdf_path()

    client = get_client()

    if once:
        user = single_prompt or ""
        if not user:
            print("Empty prompt.")
            return
        route = decide_route(client, user)
        if route == 'SQL':
            answer_obj = sql_answer(sql_api, user)
            answer = answer_obj['text'] if isinstance(answer_obj, dict) else str(answer_obj)
            rows = answer_obj.get('rows') if isinstance(answer_obj, dict) else None
        else:
            if not pdf_path:
                print("AIVEN ERP Documentation.pdf not found. Use --pdf to set the path.")
                return
            answer = doc_answer(client, user, pdf_path)
            rows = None
        print(answer)
        # After SQL answer, offer chart creation
        if route == 'SQL' and rows:
            try:
                desc = input("\nCreate a chart? Describe it (e.g., 'bar title: Hours', 'line width=1200 height=800') or type 'none': ").strip()
            except KeyboardInterrupt:
                desc = 'none'
            parsed = _parse_chart_request(desc)
            if parsed.get('type') in {'bar','line','pie'} or (parsed.get('hints') and parsed.get('hints').lower() not in {'none','no','skip'}):
                # write rows to a temp file
                import tempfile
                import subprocess
                with tempfile.NamedTemporaryFile('w', delete=False, suffix='.json') as tf:
                    json.dump(rows, tf)
                    tf.flush()
                    tmp_path = tf.name
                node_cmd = [ 'node', 'AI Chart Maker/src/one_shot.js', '--rows', tmp_path ]
                if parsed.get('type'):
                    node_cmd += ['--type', parsed['type']]
                if parsed.get('title'):
                    node_cmd += ['--title', parsed['title']]
                if parsed.get('width'):
                    node_cmd += ['--width', str(parsed['width'])]
                if parsed.get('height'):
                    node_cmd += ['--height', str(parsed['height'])]
                if parsed.get('hints') and parsed['hints'].lower() not in {'none','no','skip'}:
                    node_cmd += ['--hints', parsed['hints']]
                try:
                    proc = subprocess.run(node_cmd, capture_output=True, text=True, timeout=120)
                    out = (proc.stdout or '') + (proc.stderr or '')
                    m = re.search(r"CHART_PATH:(.+)", out)
                    if m:
                        print(f"\nChart saved: {m.group(1).strip()}")
                    else:
                        print("\nChart maker output:\n" + out.strip())
                except Exception as ce:
                    print(f"\nChart creation failed: {ce}")
        return

    # Interactive mode
    print(f"Aiven ERP Router ready. Model: {MODEL}")
    print(f"SQL API: {sql_api}")
    if pdf_path:
        print(f"PDF: {pdf_path}")
    else:
        print("PDF: <not found> (set with --pdf)")
    print("Type 'exit' or Ctrl+C to quit.\n")

    while True:
        try:
            user = input("You: ").strip()
            if not user:
                continue
            if user.lower() in {"exit", ":q", "quit"}:
                print("Bye!")
                break
            route = decide_route(client, user)
            if route == 'SQL':
                resp = sql_answer(sql_api, user)
                text = resp['text'] if isinstance(resp, dict) else str(resp)
                rows = resp.get('rows') if isinstance(resp, dict) else None
                print(f"SQL Bot: {text}\n")
                if rows:
                    try:
                        desc = input("Describe a chart (e.g., 'bar title: Hours', 'line width=1200 height=800') or 'none': ").strip()
                    except KeyboardInterrupt:
                        desc = 'none'
                    parsed = _parse_chart_request(desc)
                    if parsed.get('type') in {'bar','line','pie'} or (parsed.get('hints') and parsed.get('hints').lower() not in {'none','no','skip'}):
                        import tempfile, subprocess
                        with tempfile.NamedTemporaryFile('w', delete=False, suffix='.json') as tf:
                            json.dump(rows, tf)
                            tf.flush()
                            tmp_path = tf.name
                        node_cmd = ['node', 'AI Chart Maker/src/one_shot.js', '--rows', tmp_path]
                        if parsed.get('type'):
                            node_cmd += ['--type', parsed['type']]
                        if parsed.get('title'):
                            node_cmd += ['--title', parsed['title']]
                        if parsed.get('width'):
                            node_cmd += ['--width', str(parsed['width'])]
                        if parsed.get('height'):
                            node_cmd += ['--height', str(parsed['height'])]
                        if parsed.get('hints') and parsed['hints'].lower() not in {'none','no','skip'}:
                            node_cmd += ['--hints', parsed['hints']]
                        try:
                            proc = subprocess.run(node_cmd, capture_output=True, text=True, timeout=120)
                            out = (proc.stdout or '') + (proc.stderr or '')
                            m = re.search(r"CHART_PATH:(.+)", out)
                            if m:
                                print(f"Chart saved: {m.group(1).strip()}\n")
                            else:
                                print(("Chart maker output:\n" + out.strip() + "\n") if out.strip() else "")
                        except Exception as ce:
                            print(f"Chart creation failed: {ce}\n")
            else:
                if not pdf_path:
                    print("PDF not found. Provide with --pdf.")
                    continue
                resp_text = doc_answer(client, user, pdf_path)
                print(f"Doc Bot: {resp_text}\n")
        except KeyboardInterrupt:
            print("\nBye!")
            break
        except EOFError:
            print("\nBye!")
            break
        except Exception as e:
            print(f"Error: {e}")


def _parse_chart_request(s: str):
    """Parse a freeform chart request. Returns dict with keys: type?, title?, width?, height?, hints.
    Accepted examples:
    - "bar"
    - "line title: Hours by Person"
    - "pie title=Share width=1200 height=800"
    - "bar; title=Revenue by Month; width=1000; height=600"
    Any remaining text is passed as hints.
    """
    out = {"type": None, "title": None, "width": None, "height": None, "hints": None}
    if not s:
        return out
    raw = s.strip()
    if raw.lower() in {"none", "no", "skip"}:
        out["hints"] = None
        return out
    # extract type if present
    mtype = re.search(r"\b(bar|line|pie)\b", raw, flags=re.IGNORECASE)
    if mtype:
        out["type"] = mtype.group(1).lower()
    # extract title
    mtitle = re.search(r"title\s*[:=]\s*([^;\n]+)", raw, flags=re.IGNORECASE)
    if mtitle:
        out["title"] = mtitle.group(1).strip()
    # width/height
    mwidth = re.search(r"width\s*[:=]\s*(\d{2,5})", raw, flags=re.IGNORECASE)
    if mwidth:
        try:
            out["width"] = int(mwidth.group(1))
        except Exception:
            pass
    mheight = re.search(r"height\s*[:=]\s*(\d{2,5})", raw, flags=re.IGNORECASE)
    if mheight:
        try:
            out["height"] = int(mheight.group(1))
        except Exception:
            pass
    # hints: the full text (so the model can interpret x/y mapping, labels, etc.)
    out["hints"] = raw
    return out

if __name__ == '__main__':
    main()




"""
Gemini (Google GenAI) adapter for the sample Postgres multi‑agent.

Replaces OpenAI calls with google‑genai per 2025 SDK guidelines.

Key usage:
- client = genai.Client() reads GEMINI_API_KEY from env automatically
- generate via client.models.generate_content(...)
- function calling via automatic function calling by passing Python callables
"""

import os
from typing import Any, Dict, List

from dotenv import load_dotenv
from google import genai
from google.genai import types

from .models import TurboTool


load_dotenv()


def _client() -> genai.Client:
    # The client picks up GEMINI_API_KEY from env
    return genai.Client()


def prompt(
    prompt: str,
    model: str = "gemini-2.5-pro",
    instructions: str = "You are a helpful assistant.",
) -> str:
    """Single-shot text generation using Gemini.

    Returns response.text (often Markdown).
    """
    client = _client()
    resp = client.models.generate_content(
        model=model,
        contents=[
            types.Content(role="user", parts=[types.Part.from_text(text=prompt)])
        ],
        config=types.GenerateContentConfig(system_instruction=instructions),
    )
    return (resp.text or "").strip()


def prompt_func(
    prompt: str,
    turbo_tools: List[TurboTool],
    model: str = "gemini-2.5-pro",
    instructions: str = "You are a helpful assistant.",
) -> List[Any]:
    """Force a function/tool call using Gemini automatic function calling.

    turbo_tools: list of TurboTool(name, config, function)
    The Python SDK can accept callables directly in tools=[...].

    Returns a list of function results (opaque strings in this sample).
    """

    client = _client()

    # Map TurboTool callables
    callable_tools = [t.function for t in turbo_tools]

    # If exactly one tool, nudge to call it with ANY mode; else AUTO
    if len(callable_tools) == 1:
        tool_cfg = types.ToolConfig(
            function_calling_config=types.FunctionCallingConfig(mode="ANY")
        )
    else:
        tool_cfg = types.ToolConfig(
            function_calling_config=types.FunctionCallingConfig(mode="AUTO")
        )

    config = types.GenerateContentConfig(
        system_instruction=instructions,
        tools=callable_tools,
        tool_config=tool_cfg,
        temperature=0,
    )

    resp = client.models.generate_content(
        model=model,
        contents=[types.Content(role="user", parts=[types.Part.from_text(text=prompt)])],
        config=config,
    )

    # In this sample, tools usually return a status string; surface that.
    results: List[Any] = []
    # If automatic function calling executed a tool, the final text may include it
    # but we don’t rely on parsing; return an empty list. The API here is used
    # for side‑effects (agent writes JSON file), mirroring the original sample.
    if resp.text:
        results.append(resp.text)
    return results


def add_cap_ref(prompt: str, caption: str, ref_name: str, ref_content: str) -> str:
    """Helper to inline a captioned reference block (used by the sample).

    This keeps the prompt contract compatible with the existing orchestrator.
    """
    block = f"\n\n[{ref_name}]\n{caption}\n```\n{ref_content}\n```\n"
    return prompt + block


"""Synthetic conversation suite harness for the planner service."""

from __future__ import annotations

import argparse
import json
import logging
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any, Dict, Iterable, List, Optional

try:  # pragma: no cover - optional dependency used when scenarios require subagent mocks
    import httpx
except ImportError:  # pragma: no cover - defensive guard for environments without httpx
    httpx = None

from unittest import mock

import yaml
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field, ValidationError, model_validator

from ..main import app
from ..schemas import PlannerContext, PlannerRequest, PlannerResponse, PlannerStep, PlannerStepType

REPO_ROOT = Path(__file__).resolve().parents[3]
SCENARIO_ROOT = REPO_ROOT / "docs/ai-assistant/data/synthetic_conversations"
RUN_LOG_ROOT = REPO_ROOT / "docs/ai-assistant/data/synthetic_runs"


class ScenarioContext(BaseModel):
    """Metadata required to build planner requests for a scenario."""

    session_id: int
    company_id: Optional[int] = None
    user_id: Optional[int] = None
    locale: Optional[str] = None


class ExpectedStep(BaseModel):
    """Expected step emitted by the planner for a synthetic scenario."""

    id: Optional[str] = None
    type: PlannerStepType
    description: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)


class ExpectedPlan(BaseModel):
    """Expected plan emitted by the planner."""

    steps: List[ExpectedStep]


class ScenarioAssertions(BaseModel):
    """Assertions evaluated against planner responses and telemetry."""

    latency_budget_ms: Optional[int] = Field(default=None)
    required_steps: List[str] = Field(default_factory=list)
    telemetry_flags: List[str] = Field(default_factory=list)
    telemetry_expectations: List["TelemetryExpectation"] = Field(default_factory=list)


class TelemetryExpectation(BaseModel):
    """Expectation that a telemetry event is emitted with required fields."""

    event: str
    fields: Dict[str, Any] = Field(default_factory=dict)


class SubagentMock(BaseModel):
    """Definition of an expected subagent HTTP interaction."""

    name: Optional[str] = None
    method: str = Field(default="POST")
    url: str
    request_json: Optional[Dict[str, Any]] = None
    response_json: Dict[str, Any] = Field(default_factory=dict)
    response_text: Optional[str] = None
    status_code: int = Field(default=200)
    headers: Dict[str, str] = Field(default_factory=dict)
    repeat: int = Field(default=1, ge=1)


class ScenarioTurn(BaseModel):
    """Conversation turn within a synthetic scenario."""

    actor: str
    content: Optional[str] = None
    expected_plan: Optional[ExpectedPlan] = None

    @model_validator(mode="after")
    def _validate_turn(self) -> "ScenarioTurn":
        if self.actor == "user" and not self.content:
            raise ValueError("User turns must include content")
        if self.actor == "planner" and not self.expected_plan:
            raise ValueError("Planner turns must include expected_plan")
        return self


class SyntheticScenario(BaseModel):
    """Top-level representation of a synthetic conversation scenario."""

    title: str
    phase: str
    criticality: str
    regression_type: str
    context: ScenarioContext
    turns: List[ScenarioTurn]
    assertions: ScenarioAssertions = Field(default_factory=ScenarioAssertions)
    subagent_mocks: List[SubagentMock] = Field(default_factory=list)

    @property
    def slug(self) -> str:
        return self.title.replace(" ", "-").lower()

    def user_message(self) -> str:
        for turn in self.turns:
            if turn.actor == "user" and turn.content:
                return turn.content
        raise ValueError(f"Scenario '{self.title}' must contain at least one user turn")

    def planner_plan(self) -> ExpectedPlan:
        for turn in self.turns:
            if turn.actor == "planner" and turn.expected_plan:
                return turn.expected_plan
        raise ValueError(f"Scenario '{self.title}' must define an expected planner plan")


@dataclass
class ScenarioResult:
    """Result of running a synthetic scenario."""

    scenario: SyntheticScenario
    passed: bool
    latency_ms: int
    diffs: List[str] = field(default_factory=list)
    missing_telemetry: List[str] = field(default_factory=list)
    missing_steps: List[str] = field(default_factory=list)
    subagent_diffs: List[str] = field(default_factory=list)
    missing_subagent_calls: List[str] = field(default_factory=list)
    unexpected_subagent_calls: List[str] = field(default_factory=list)
    telemetry_events: List[Dict[str, Any]] = field(default_factory=list)
    request: Optional[PlannerRequest] = None
    response: Optional[PlannerResponse] = None


class _MemoryLogHandler(logging.Handler):
    """Collect planner telemetry log records for assertions."""

    def __init__(self) -> None:
        super().__init__()
        self.records: List[str] = []

    def emit(self, record: logging.LogRecord) -> None:  # pragma: no cover - thin wrapper
        self.records.append(record.getMessage())


def _load_yaml(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def load_scenario(path: Path) -> SyntheticScenario:
    """Load and validate a synthetic scenario from YAML."""

    try:
        payload = _load_yaml(path)
        scenario = SyntheticScenario.model_validate(payload)
        return scenario
    except ValidationError as exc:  # pragma: no cover - defensive logging for CLI usage
        raise SystemExit(f"Invalid scenario '{path.name}': {exc}")


def discover_scenarios() -> List[Path]:
    """Return all scenario blueprints sorted by filename."""

    candidates = set(SCENARIO_ROOT.glob("*.yml")) | set(SCENARIO_ROOT.glob("*.yaml"))
    return sorted(candidates, key=lambda path: path.name)


def resolve_placeholders(value: Any, context: Dict[str, Any]) -> Any:
    """Resolve Jinja-style placeholders within expected payloads."""

    if isinstance(value, str) and value.startswith("{{") and value.endswith("}}"):
        expression = value[2:-2].strip()
        return _lookup_placeholder(expression, context)

    if isinstance(value, dict):
        return {key: resolve_placeholders(sub_value, context) for key, sub_value in value.items()}

    if isinstance(value, list):
        return [resolve_placeholders(item, context) for item in value]

    return value


def _lookup_placeholder(expression: str, context: Dict[str, Any]) -> Any:
    current: Any = context
    for part in expression.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
            continue
        raise KeyError(f"Unknown placeholder '{expression}'")
    return current


def _diff_payload(expected: Any, actual: Any, path: str = "payload") -> List[str]:
    diffs: List[str] = []

    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            diffs.append(f"{path}: expected dict but received {type(actual).__name__}")
            return diffs
        for key, expected_value in expected.items():
            if key not in actual:
                diffs.append(f"{path}.{key}: missing from planner response")
                continue
            diffs.extend(_diff_payload(expected_value, actual[key], f"{path}.{key}"))
        return diffs

    if isinstance(expected, list):
        if not isinstance(actual, list):
            diffs.append(f"{path}: expected list but received {type(actual).__name__}")
            return diffs
        for index, expected_value in enumerate(expected):
            if index >= len(actual):
                diffs.append(f"{path}[{index}]: missing from planner response")
                continue
            diffs.extend(
                _diff_payload(expected_value, actual[index], f"{path}[{index}]")
            )
        return diffs

    if expected != actual:
        diffs.append(f"{path}: expected {expected!r} but received {actual!r}")

    return diffs


def compare_plan(
    expected: ExpectedPlan,
    actual_steps: Iterable[PlannerStep],
    *,
    placeholder_context: Dict[str, Any],
) -> List[str]:
    """Compare planner output with an expected plan and return any diffs."""

    diffs: List[str] = []
    actual_step_list = list(actual_steps)

    if len(expected.steps) != len(actual_step_list):
        diffs.append(
            f"Plan length mismatch: expected {len(expected.steps)} steps, "
            f"received {len(actual_step_list)} steps"
        )

    for index, expected_step in enumerate(expected.steps):
        if index >= len(actual_step_list):
            diffs.append(f"Missing planner step at position {index}: {expected_step.type.value}")
            continue

        actual_step = actual_step_list[index]
        if expected_step.type != actual_step.type:
            diffs.append(
                f"Step {index} type mismatch: expected {expected_step.type.value}, "
                f"received {actual_step.type.value}"
            )

        if expected_step.description and expected_step.description != actual_step.description:
            diffs.append(
                f"Step {index} description mismatch: expected '{expected_step.description}', "
                f"received '{actual_step.description}'"
            )

        expected_payload = resolve_placeholders(
            expected_step.payload, placeholder_context
        )
        actual_payload = actual_step.payload.model_dump(mode="json")
        diffs.extend(_diff_payload(expected_payload, actual_payload, path=f"step[{index}].payload"))

    return diffs


def _capture_telemetry() -> tuple[_MemoryLogHandler, logging.Logger, int]:
    logger = logging.getLogger("planner_service.telemetry")
    handler = _MemoryLogHandler()
    logger.addHandler(handler)
    previous_level = logger.level
    logger.setLevel(logging.INFO)
    return handler, logger, previous_level


def _release_telemetry(handler: _MemoryLogHandler, logger: logging.Logger, level: int) -> List[Dict[str, Any]]:
    logger.removeHandler(handler)
    logger.setLevel(level)
    events: List[Dict[str, Any]] = []
    for message in handler.records:
        try:
            events.append(json.loads(message))
        except json.JSONDecodeError:
            continue
    return events


class _SubagentExpectation:
    """Internal representation of an expected subagent HTTP call."""

    def __init__(self, definition: SubagentMock, ordinal: int) -> None:
        self.definition = definition
        self.ordinal = ordinal

    @property
    def label(self) -> str:
        name = self.definition.name or self.definition.url
        if self.definition.repeat > 1:
            return f"{name}#{self.ordinal}"
        return name


class _SubagentMocker:
    """Context manager that intercepts httpx requests for subagent mocking."""

    def __init__(self, expectations: List[SubagentMock]):
        expanded: List[_SubagentExpectation] = []
        for definition in expectations:
            for index in range(definition.repeat):
                expanded.append(_SubagentExpectation(definition, ordinal=index + 1))

        self._expectations = expanded
        self._patcher: Optional[Any] = None
        self.subagent_diffs: List[str] = []
        self.unexpected_calls: List[str] = []

    def __enter__(self) -> "_SubagentMocker":
        if not self._expectations:
            return self

        if httpx is None:
            raise RuntimeError(
                "httpx is required to use subagent_mocks in synthetic scenarios"
            )

        self._patcher = mock.patch("httpx.AsyncClient.request", new=self._mock_request)
        self._patcher.start()
        return self

    def __exit__(self, exc_type, exc, exc_tb) -> None:  # pragma: no cover - thin wrapper
        if self._patcher:
            self._patcher.stop()

    def remaining_expectations(self) -> List[str]:
        return [
            f"{item.definition.method.upper()} {item.definition.url} ({item.label})"
            for item in self._expectations
        ]

    async def _mock_request(self, client: "httpx.AsyncClient", method: str, url: str, **kwargs):
        if not self._expectations:
            message = f"Unexpected subagent call: {method.upper()} {url}"
            self.unexpected_calls.append(message)
            raise AssertionError(message)

        expectation = self._expectations[0]
        expected_method = expectation.definition.method.upper()
        if expected_method != method.upper() or expectation.definition.url != url:
            message = (
                f"Unexpected subagent call: received {method.upper()} {url} but "
                f"expected {expected_method} {expectation.definition.url}"
            )
            self.unexpected_calls.append(message)
            raise AssertionError(message)

        self._expectations.pop(0)

        expected_payload = expectation.definition.request_json
        actual_payload = kwargs.get("json")
        if expected_payload is not None:
            diffs = _diff_payload(expected_payload, actual_payload, path="request")
            self.subagent_diffs.extend(diffs)

        if expectation.definition.response_text is not None:
            response = httpx.Response(  # type: ignore[union-attr]
                expectation.definition.status_code,
                text=expectation.definition.response_text,
                headers=expectation.definition.headers,
                request=httpx.Request(method, url),
            )
        else:
            response = httpx.Response(  # type: ignore[union-attr]
                expectation.definition.status_code,
                json=expectation.definition.response_json,
                headers=expectation.definition.headers,
                request=httpx.Request(method, url),
            )

        return response


def _evaluate_telemetry_assertions(
    assertions: ScenarioAssertions,
    telemetry_events: List[Dict[str, Any]],
    placeholder_context: Dict[str, Any],
) -> List[str]:
    """Return a list of telemetry assertion failures for a scenario."""

    missing: List[str] = []
    if assertions.telemetry_flags:
        emitted_events = {event.get("event") for event in telemetry_events}
        for flag in assertions.telemetry_flags:
            if flag not in emitted_events:
                missing.append(flag)

    for expectation in assertions.telemetry_expectations:
        expected_fields = resolve_placeholders(expectation.fields, placeholder_context)
        matched = False
        for event in telemetry_events:
            if event.get("event") != expectation.event:
                continue
            diffs = _diff_payload(expected_fields, event, path="telemetry")
            if diffs:
                continue
            matched = True
            break

        if not matched:
            if expected_fields:
                missing.append(
                    f"{expectation.event} missing expected fields {expected_fields}"
                )
            else:
                missing.append(expectation.event)

    return missing


def run_scenario(scenario: SyntheticScenario, client: TestClient) -> ScenarioResult:
    """Execute a synthetic scenario and return the evaluation result."""

    planner_context = PlannerContext(
        company_id=scenario.context.company_id,
        user_id=scenario.context.user_id,
        locale=scenario.context.locale,
    )
    request = PlannerRequest(
        session_id=scenario.context.session_id,
        message=scenario.user_message(),
        context=planner_context,
    )

    placeholder_context: Dict[str, Any] = {
        "request": request.model_dump(mode="json"),
        "scenario": scenario.model_dump(mode="json"),
        "context": scenario.context.model_dump(mode="json"),
    }

    resolved_mocks = [
        SubagentMock.model_validate(
            resolve_placeholders(mock.model_dump(mode="python"), placeholder_context)
        )
        for mock in scenario.subagent_mocks
    ]
    subagent_mocker = _SubagentMocker(resolved_mocks)

    telemetry_handler, telemetry_logger, previous_level = _capture_telemetry()
    start = perf_counter()
    response: Optional[Any] = None
    error: Optional[Exception] = None

    try:
        with subagent_mocker:
            response = client.post("/plan", json=request.model_dump(mode="json"))
        response.raise_for_status()
    except Exception as exc:  # pragma: no cover - defensive aggregation for CLI usage
        error = exc

    latency_ms = int((perf_counter() - start) * 1000)
    telemetry_events = _release_telemetry(
        telemetry_handler, telemetry_logger, previous_level
    )

    missing_steps: List[str] = []
    diffs: List[str] = []
    planner_response: Optional[PlannerResponse] = None

    if error or response is None:
        if error is not None:
            diffs.append(
                f"Planner execution raised {error.__class__.__name__}: {error}"
            )
        else:
            diffs.append("Planner did not return a response")
        missing_steps = list(scenario.assertions.required_steps)
    else:
        planner_response = PlannerResponse.model_validate(response.json())

        diffs = compare_plan(
            scenario.planner_plan(),
            planner_response.steps,
            placeholder_context=placeholder_context,
        )

        latency_budget = scenario.assertions.latency_budget_ms
        if latency_budget is not None and latency_ms > latency_budget:
            diffs.append(
                f"Latency budget exceeded: observed {latency_ms}ms (budget {latency_budget}ms)"
            )

        if scenario.assertions.required_steps:
            actual_ids = {step.id for step in planner_response.steps}
            actual_types = {step.type.value for step in planner_response.steps}
            for required in scenario.assertions.required_steps:
                if required not in actual_ids and required not in actual_types:
                    missing_steps.append(required)

    missing_telemetry = _evaluate_telemetry_assertions(
        scenario.assertions, telemetry_events, placeholder_context
    )

    subagent_diffs = subagent_mocker.subagent_diffs
    missing_subagent_calls = subagent_mocker.remaining_expectations()
    unexpected_subagent_calls = subagent_mocker.unexpected_calls

    passed = (
        not diffs
        and not missing_steps
        and not missing_telemetry
        and not subagent_diffs
        and not missing_subagent_calls
        and not unexpected_subagent_calls
    )

    return ScenarioResult(
        scenario=scenario,
        passed=passed,
        latency_ms=latency_ms,
        diffs=diffs,
        missing_steps=missing_steps,
        missing_telemetry=missing_telemetry,
        subagent_diffs=subagent_diffs,
        missing_subagent_calls=missing_subagent_calls,
        unexpected_subagent_calls=unexpected_subagent_calls,
        telemetry_events=telemetry_events,
        request=request,
        response=planner_response,
    )


def persist_result(result: ScenarioResult) -> Path:
    """Persist run metadata so we can trend regressions over time."""

    RUN_LOG_ROOT.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    run_artifact = RUN_LOG_ROOT / f"{result.scenario.slug}-{timestamp}.json"

    try:
        commit = (
            subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT)
            .decode("utf-8")
            .strip()
        )
    except subprocess.CalledProcessError:  # pragma: no cover - git may not be available in CI images
        commit = "unknown"

    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "commit": commit,
        "scenario": {
            "title": result.scenario.title,
            "phase": result.scenario.phase,
            "criticality": result.scenario.criticality,
            "regression_type": result.scenario.regression_type,
            "context": result.scenario.context.model_dump(mode="json"),
            "assertions": result.scenario.assertions.model_dump(mode="json"),
        },
        "outcome": {
            "passed": result.passed,
            "latency_ms": result.latency_ms,
            "diffs": result.diffs,
            "missing_steps": result.missing_steps,
            "missing_telemetry": result.missing_telemetry,
            "subagent_diffs": result.subagent_diffs,
            "missing_subagent_calls": result.missing_subagent_calls,
            "unexpected_subagent_calls": result.unexpected_subagent_calls,
        },
        "request": result.request.model_dump(mode="json") if result.request else None,
        "response": result.response.model_dump(mode="json") if result.response else None,
        "telemetry_events": result.telemetry_events,
    }

    with run_artifact.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)

    return run_artifact


def format_result(result: ScenarioResult) -> str:
    status = "PASS" if result.passed else "FAIL"
    lines = [f"[{status}] {result.scenario.slug} ({result.latency_ms}ms)"]
    for diff in result.diffs:
        lines.append(f"  diff: {diff}")
    for step in result.missing_steps:
        lines.append(f"  missing-step: {step}")
    for flag in result.missing_telemetry:
        lines.append(f"  missing-telemetry: {flag}")
    for diff in result.subagent_diffs:
        lines.append(f"  subagent-diff: {diff}")
    for missing in result.missing_subagent_calls:
        lines.append(f"  missing-subagent: {missing}")
    for unexpected in result.unexpected_subagent_calls:
        lines.append(f"  unexpected-subagent: {unexpected}")
    return "\n".join(lines)


def load_selected_scenarios(selection: Optional[List[str]]) -> List[SyntheticScenario]:
    paths = discover_scenarios()
    scenarios = [load_scenario(path) for path in paths]
    if not selection:
        return scenarios

    selection_set = {item.lower() for item in selection}
    filtered = [scenario for scenario in scenarios if scenario.slug in selection_set]
    missing = selection_set - {scenario.slug for scenario in filtered}
    if missing:
        raise SystemExit(f"Unknown scenarios requested: {', '.join(sorted(missing))}")
    return filtered


def main() -> None:  # pragma: no cover - exercised via CLI
    parser = argparse.ArgumentParser(description="Run synthetic planner scenarios")
    parser.add_argument(
        "--scenario",
        action="append",
        dest="scenarios",
        help="Slug of a specific scenario to execute. Can be provided multiple times.",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List available scenarios and exit.",
    )

    args = parser.parse_args()

    available_paths = discover_scenarios()
    if args.list:
        for path in available_paths:
            scenario = load_scenario(path)
            print(scenario.slug)
        return

    scenarios = load_selected_scenarios(args.scenarios)
    if not scenarios:
        raise SystemExit("No scenarios available to execute")

    client = TestClient(app)
    any_failures = False

    for scenario in scenarios:
        result = run_scenario(scenario, client)
        artifact_path = persist_result(result)
        print(format_result(result))
        print(f"  artifact: {artifact_path.relative_to(REPO_ROOT)}")
        if not result.passed:
            any_failures = True

    if any_failures:
        raise SystemExit(1)


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    main()

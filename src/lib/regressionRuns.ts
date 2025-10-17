import { promises as fs } from "fs";
import path from "path";

export const RUN_DIRECTORY = path.join(
  process.cwd(),
  "docs",
  "ai-assistant",
  "data",
  "synthetic_runs",
);

const AGENT_EVENT_LOG_PATH = path.join(
  process.cwd(),
  "docs",
  "ai-assistant",
  "data",
  "agent_event_logs_sample.json",
);

export type RawRegressionRun = {
  timestamp?: string;
  commit?: string;
  scenario?: {
    title?: string;
    phase?: string;
    criticality?: string;
    regression_type?: string;
  };
  outcome?: {
    passed?: boolean;
    latency_ms?: number;
    diffs?: unknown;
    missing_steps?: unknown;
    missing_telemetry?: unknown;
    subagent_diffs?: unknown;
    missing_subagent_calls?: unknown;
    unexpected_subagent_calls?: unknown;
  };
  telemetry_events?: unknown[];
};

export type RegressionRun = {
  id: string;
  fileName: string;
  timestamp: string;
  commit: string;
  scenario: {
    title: string;
    slug: string;
    phase: string;
    criticality: string;
    regressionType: string;
  };
  outcome: {
    passed: boolean;
    latencyMs: number | null;
    failureCategories: string[];
    diffs: string[];
    missingSteps: string[];
    missingTelemetry: string[];
    subagentDiffs: string[];
    missingSubagentCalls: string[];
    unexpectedSubagentCalls: string[];
  };
  telemetryCount: number;
};

export type ScenarioSummary = {
  slug: string;
  title: string;
  regressionType: string;
  phase: string;
  totalRuns: number;
  failures: number;
  lastRunAt: string;
  lastFailureAt: string | null;
  latestOutcome: "pass" | "fail";
};

export type RegressionTypeSummary = {
  regressionType: string;
  totalRuns: number;
  failures: number;
  lastFailureAt: string | null;
};

export type RegressionDashboardSummary = {
  totalRuns: number;
  passes: number;
  failures: number;
  passRate: number;
  lastRunAt: string | null;
  scenarioSummaries: ScenarioSummary[];
  regressionTypeSummaries: RegressionTypeSummary[];
};

export type AgentEventLogEntry = {
  source: string;
  eventType: string;
  status: string;
  tool: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string | null;
};

export type EvaluationMetrics = {
  totalRuns: number;
  successRate: number;
  averageLatencyMs: number | null;
  toolEfficiency: number;
  toolFailureRate: number;
  safetyOverrideRate: number;
};

export type RegressionDashboardPayload = {
  runs: RegressionRun[];
  summary: RegressionDashboardSummary;
  metrics: EvaluationMetrics;
  errors: string[];
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .replace(/--+/g, "-");
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item : null))
    .filter((item): item is string => item !== null);
}

export function determineFailureCategories(run: RegressionRun): string[] {
  const categories = new Set<string>();
  const { outcome } = run;

  if (!outcome.passed) {
    if (outcome.diffs.length > 0) {
      categories.add("plan-drift");
    }
    if (outcome.missingSteps.length > 0) {
      categories.add("missing-step");
    }
    if (outcome.missingTelemetry.length > 0) {
      categories.add("telemetry-gap");
    }
    if (
      outcome.subagentDiffs.length > 0 ||
      outcome.missingSubagentCalls.length > 0 ||
      outcome.unexpectedSubagentCalls.length > 0
    ) {
      categories.add("subagent-contract");
    }
    if (
      outcome.latencyMs !== null &&
      outcome.latencyMs > 0 &&
      outcome.diffs.some((diff) => diff.toLowerCase().includes("latency"))
    ) {
      categories.add("latency-regression");
    }
  }

  return Array.from(categories);
}

function normalizeRun(
  fileName: string,
  payload: RawRegressionRun,
  errors: string[],
): RegressionRun | null {
  if (!payload.timestamp) {
    errors.push(`${fileName}: missing timestamp`);
    return null;
  }

  const timestamp = new Date(payload.timestamp);
  if (Number.isNaN(timestamp.getTime())) {
    errors.push(`${fileName}: invalid timestamp '${payload.timestamp}'`);
    return null;
  }

  const commit = typeof payload.commit === "string" ? payload.commit : "unknown";
  const scenarioTitle = payload.scenario?.title || fileName.replace(/\.json$/i, "");
  const scenarioSlug = slugify(scenarioTitle);
  const scenarioPhase = payload.scenario?.phase || "unknown";
  const scenarioCriticality = payload.scenario?.criticality || "unknown";
  const scenarioRegressionType = payload.scenario?.regression_type || "unknown";

  const outcome = payload.outcome || {};
  const passed = outcome.passed ?? false;
  const latencyMs = typeof outcome.latency_ms === "number" ? outcome.latency_ms : null;
  const diffs = coerceStringArray(outcome.diffs);
  const missingSteps = coerceStringArray(outcome.missing_steps);
  const missingTelemetry = coerceStringArray(outcome.missing_telemetry);
  const subagentDiffs = coerceStringArray(outcome.subagent_diffs);
  const missingSubagentCalls = coerceStringArray(outcome.missing_subagent_calls);
  const unexpectedSubagentCalls = coerceStringArray(outcome.unexpected_subagent_calls);

  const run: RegressionRun = {
    id: `${scenarioSlug}-${timestamp.getTime()}`,
    fileName,
    timestamp: timestamp.toISOString(),
    commit,
    scenario: {
      title: scenarioTitle,
      slug: scenarioSlug,
      phase: scenarioPhase,
      criticality: scenarioCriticality,
      regressionType: scenarioRegressionType,
    },
    outcome: {
      passed,
      latencyMs,
      failureCategories: [],
      diffs,
      missingSteps,
      missingTelemetry,
      subagentDiffs,
      missingSubagentCalls,
      unexpectedSubagentCalls,
    },
    telemetryCount: Array.isArray(payload.telemetry_events)
      ? payload.telemetry_events.length
      : 0,
  };

  run.outcome.failureCategories = determineFailureCategories(run);

  return run;
}

function normalizeEvent(
  value: unknown,
  index: number,
  errors: string[],
): AgentEventLogEntry | null {
  if (!isPlainRecord(value)) {
    errors.push(`Event ${index}: invalid payload`);
    return null;
  }

  const source = typeof value.source === "string" ? value.source : "unknown";
  const eventType =
    typeof value.event_type === "string"
      ? value.event_type
      : typeof value.eventType === "string"
        ? value.eventType
        : "unknown";
  const status = typeof value.status === "string" ? value.status : "unknown";
  const tool = typeof value.tool === "string" ? value.tool : null;
  const metadata = isPlainRecord(value.metadata) ? value.metadata : {};
  const occurredAtRaw =
    typeof value.occurred_at === "string"
      ? value.occurred_at
      : typeof value.occurredAt === "string"
        ? value.occurredAt
        : null;

  const occurredAt = occurredAtRaw && !Number.isNaN(new Date(occurredAtRaw).getTime()) ? occurredAtRaw : null;

  return { source, eventType, status, tool, metadata, occurredAt };
}

async function readRunFile(
  fileName: string,
  errors: string[],
): Promise<RegressionRun | null> {
  const filePath = path.join(RUN_DIRECTORY, fileName);

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const payload = JSON.parse(raw) as RawRegressionRun;
    return normalizeRun(fileName, payload, errors);
  } catch (error) {
    errors.push(`${fileName}: ${(error as Error).message}`);
    return null;
  }
}

export function buildSummary(runs: RegressionRun[]): RegressionDashboardSummary {
  if (runs.length === 0) {
    return {
      totalRuns: 0,
      passes: 0,
      failures: 0,
      passRate: 0,
      lastRunAt: null,
      scenarioSummaries: [],
      regressionTypeSummaries: [],
    };
  }

  const scenarioMap = new Map<string, ScenarioSummary>();
  const regressionTypeMap = new Map<string, RegressionTypeSummary>();

  let passes = 0;
  let failures = 0;
  let lastRunAt: string | null = null;

  for (const run of runs) {
    if (run.outcome.passed) {
      passes += 1;
    } else {
      failures += 1;
    }

    if (!lastRunAt || run.timestamp > lastRunAt) {
      lastRunAt = run.timestamp;
    }

    const scenarioKey = run.scenario.slug;
    let scenarioEntry = scenarioMap.get(scenarioKey);
    if (!scenarioEntry) {
      scenarioEntry = {
        slug: scenarioKey,
        title: run.scenario.title,
        regressionType: run.scenario.regressionType,
        phase: run.scenario.phase,
        totalRuns: 0,
        failures: 0,
        lastRunAt: run.timestamp,
        lastFailureAt: null,
        latestOutcome: run.outcome.passed ? "pass" : "fail",
      };
      scenarioMap.set(scenarioKey, scenarioEntry);
    }

    scenarioEntry.totalRuns += 1;
    if (run.outcome.passed) {
      if (scenarioEntry.latestOutcome !== "pass") {
        scenarioEntry.latestOutcome = "pass";
      }
    } else {
      scenarioEntry.failures += 1;
      scenarioEntry.lastFailureAt = run.timestamp;
      scenarioEntry.latestOutcome = "fail";
    }

    if (run.timestamp > scenarioEntry.lastRunAt) {
      scenarioEntry.lastRunAt = run.timestamp;
      scenarioEntry.latestOutcome = run.outcome.passed ? "pass" : "fail";
    }

    const regressionKey = run.scenario.regressionType;
    let regressionEntry = regressionTypeMap.get(regressionKey);
    if (!regressionEntry) {
      regressionEntry = {
        regressionType: regressionKey,
        totalRuns: 0,
        failures: 0,
        lastFailureAt: null,
      };
      regressionTypeMap.set(regressionKey, regressionEntry);
    }

    regressionEntry.totalRuns += 1;
    if (!run.outcome.passed) {
      regressionEntry.failures += 1;
      if (!regressionEntry.lastFailureAt || run.timestamp > regressionEntry.lastFailureAt) {
        regressionEntry.lastFailureAt = run.timestamp;
      }
    }
  }

  const totalRuns = runs.length;
  const passRate =
    totalRuns === 0 ? 0 : Number(((passes / totalRuns) * 100).toFixed(1));

  const scenarioSummaries = Array.from(scenarioMap.values()).sort((a, b) => {
    if (a.failures !== b.failures) {
      return b.failures - a.failures;
    }
    return b.lastRunAt.localeCompare(a.lastRunAt);
  });

  const regressionTypeSummaries = Array.from(regressionTypeMap.values()).sort(
    (a, b) => {
      if (a.failures !== b.failures) {
        return b.failures - a.failures;
      }
      return b.totalRuns - a.totalRuns;
    },
  );

  return {
    totalRuns,
    passes,
    failures,
    passRate,
    lastRunAt,
    scenarioSummaries,
    regressionTypeSummaries,
  };
}

export async function loadRegressionRuns(): Promise<{
  runs: RegressionRun[];
  errors: string[];
}> {
  const errors: string[] = [];
  let files: string[] = [];

  try {
    files = await fs.readdir(RUN_DIRECTORY);
  } catch (error) {
    errors.push(
      `Unable to read regression directory: ${(error as Error).message}`,
    );
    return { runs: [], errors };
  }

  const runs: RegressionRun[] = [];

  for (const fileName of files) {
    if (!fileName.toLowerCase().endsWith(".json")) {
      continue;
    }

    const run = await readRunFile(fileName, errors);
    if (run) {
      runs.push(run);
    }
  }

  runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return { runs, errors };
}

export async function loadAgentEventLogs(): Promise<{
  events: AgentEventLogEntry[];
  errors: string[];
}> {
  const errors: string[] = [];
  let rawPayload: string;

  try {
    rawPayload = await fs.readFile(AGENT_EVENT_LOG_PATH, "utf-8");
  } catch (error) {
    errors.push(`Unable to read agent event log: ${(error as Error).message}`);
    return { events: [], errors };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch (error) {
    errors.push(`Invalid JSON in agent event log: ${(error as Error).message}`);
    return { events: [], errors };
  }

  if (!Array.isArray(parsed)) {
    errors.push("Agent event log must contain a JSON array");
    return { events: [], errors };
  }

  const events: AgentEventLogEntry[] = [];
  parsed.forEach((value, index) => {
    const normalized = normalizeEvent(value, index, errors);
    if (normalized) {
      events.push(normalized);
    }
  });

  return { events, errors };
}

function calculateAverage(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round(total / values.length);
}

export function computeEvaluationMetrics(
  runs: RegressionRun[],
  events: AgentEventLogEntry[],
): EvaluationMetrics {
  const totalRuns = runs.length;
  const successCount = runs.filter((run) => run.outcome.passed).length;
  const successRate = totalRuns === 0 ? 0 : Number((successCount / totalRuns).toFixed(3));

  const latencyValues = runs
    .map((run) => run.outcome.latencyMs)
    .filter((value): value is number => typeof value === "number");
  const averageLatencyMs = calculateAverage(latencyValues);

  const toolEvents = events.filter((event) => event.eventType.toLowerCase().includes("tool"));
  const toolFailures = toolEvents.filter((event) => {
    const type = event.eventType.toLowerCase();
    const status = event.status.toLowerCase();
    return type.includes("fail") || status === "failed" || status === "error";
  });

  const toolEfficiency =
    toolEvents.length === 0
      ? 1
      : Number(((toolEvents.length - toolFailures.length) / toolEvents.length).toFixed(3));
  const toolFailureRate =
    toolEvents.length === 0 ? 0 : Number((toolFailures.length / toolEvents.length).toFixed(3));

  const safetyEvents = events.filter((event) => {
    const type = event.eventType.toLowerCase();
    if (type.includes("safety") || type.includes("guardrail")) {
      return true;
    }

    const metadata = event.metadata || {};
    const requiresManualReview = (metadata as { requires_manual_review?: unknown }).requires_manual_review;
    if (typeof requiresManualReview === "boolean" && requiresManualReview) {
      return true;
    }

    const policyTags = (metadata as { policy_tags?: unknown }).policy_tags;
    if (Array.isArray(policyTags) && policyTags.length > 0) {
      return true;
    }

    const riskLevel = (metadata as { risk_level?: unknown }).risk_level;
    if (typeof riskLevel === "string") {
      return true;
    }

    return false;
  });

  const safetyOverrideRate =
    totalRuns === 0 ? 0 : Number((Math.min(safetyEvents.length, totalRuns) / totalRuns).toFixed(3));

  return {
    totalRuns,
    successRate,
    averageLatencyMs,
    toolEfficiency,
    toolFailureRate,
    safetyOverrideRate,
  };
}

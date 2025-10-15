import { promises as fs } from "fs";
import path from "path";

import type { RegressionRun } from "./regressionRuns";

const ALERT_CONFIG_PATH = path.join(
  process.cwd(),
  "docs",
  "ai-assistant",
  "data",
  "regression_alert_config.json",
);

type Criticality = "low" | "medium" | "high" | "unknown";

export type RegressionAlertOwnerConfig = {
  id: string;
  name: string;
  emails: string[];
  slackChannels?: string[];
  scenarioSlugs?: string[];
  regressionTypes?: string[];
  phases?: string[];
  minCriticality?: Exclude<Criticality, "unknown">;
};

export type RegressionAlertFallbackConfig = {
  name: string;
  emails: string[];
  slackChannels?: string[];
  minCriticality?: Exclude<Criticality, "unknown">;
};

export type RegressionAlertConfig = {
  owners: RegressionAlertOwnerConfig[];
  fallback?: RegressionAlertFallbackConfig;
};

export type OwnerAlertRun = {
  runId: string;
  scenarioTitle: string;
  scenarioSlug: string;
  timestamp: string;
  commit: string;
  criticality: Criticality;
  regressionType: string;
  failureCategories: string[];
  latencyMs: number | null;
  recommendedActions: string[];
  missingSteps: string[];
  missingTelemetry: string[];
  subagentDiffs: string[];
  missingSubagentCalls: string[];
  unexpectedSubagentCalls: string[];
};

export type OwnerAlert = {
  ownerId: string;
  ownerName: string;
  emails: string[];
  slackChannels: string[];
  latestFailureAt: string;
  highestCriticality: Criticality;
  failingRuns: OwnerAlertRun[];
};

export type RegressionAlertPayload = {
  generatedAt: string;
  summary: {
    totalFailures: number;
    ownersWithFailures: number;
    unassignedFailures: number;
  };
  owners: OwnerAlert[];
  unassigned: OwnerAlertRun[];
  errors: string[];
};

const CRITICALITY_ORDER: Criticality[] = ["low", "medium", "high"];

const ACTION_SUGGESTIONS: Record<string, string> = {
  "plan-drift":
    "Compare the latest planner output against golden fixtures and update the prompt or contract as needed.",
  "missing-step":
    "Verify required planner steps are still emitted; adjust orchestration or scenario blueprint if expectations changed.",
  "telemetry-gap":
    "Instrument the missing telemetry event or repair the analytics pipeline so regressions stay observable.",
  "subagent-contract":
    "Review planner ↔ subagent contracts and align schema/adapter implementations to close the mismatch.",
  "latency-regression":
    "Investigate latency regressions by checking recent dependency changes and reviewing SLA budgets.",
};

const criticalityRank = (criticality: Criticality): number => {
  if (criticality === "unknown") {
    return -1;
  }

  return CRITICALITY_ORDER.indexOf(criticality);
};

function normalizeCriticality(value: string): Criticality {
  if (!value) {
    return "unknown";
  }

  const normalized = value.toLowerCase() as Criticality;
  if (["low", "medium", "high"].includes(normalized)) {
    return normalized;
  }

  return "unknown";
}

function shouldAssignRunToOwner(
  owner: RegressionAlertOwnerConfig,
  run: RegressionRun,
): boolean {
  if (owner.scenarioSlugs && owner.scenarioSlugs.length > 0) {
    if (!owner.scenarioSlugs.includes(run.scenario.slug)) {
      return false;
    }
  }

  if (owner.regressionTypes && owner.regressionTypes.length > 0) {
    if (!owner.regressionTypes.includes(run.scenario.regressionType)) {
      return false;
    }
  }

  if (owner.phases && owner.phases.length > 0) {
    if (!owner.phases.includes(run.scenario.phase)) {
      return false;
    }
  }

  if (owner.minCriticality) {
    const runCriticality = normalizeCriticality(run.scenario.criticality);
    if (
      criticalityRank(runCriticality) < criticalityRank(owner.minCriticality)
    ) {
      return false;
    }
  }

  return true;
}

function buildRecommendedActions(failureCategories: string[]): string[] {
  const actions = new Set<string>();

  for (const category of failureCategories) {
    const suggestion = ACTION_SUGGESTIONS[category];
    if (suggestion) {
      actions.add(suggestion);
    }
  }

  if (actions.size === 0) {
    actions.add(
      "Inspect scenario diagnostics and update the corresponding planner or subagent owner runbook.",
    );
  }

  return Array.from(actions);
}

export async function loadAlertConfig(): Promise<{
  config: RegressionAlertConfig;
  errors: string[];
}> {
  const errors: string[] = [];

  try {
    const raw = await fs.readFile(ALERT_CONFIG_PATH, "utf-8");
    const payload = JSON.parse(raw) as RegressionAlertConfig;

    const sanitizedOwners = (payload.owners || []).map((owner) => ({
      ...owner,
      emails: owner.emails?.filter((email) => typeof email === "string") ?? [],
      slackChannels:
        owner.slackChannels?.filter((channel) => typeof channel === "string") ?? [],
      scenarioSlugs:
        owner.scenarioSlugs?.filter((slug) => typeof slug === "string") ?? [],
      regressionTypes:
        owner.regressionTypes?.filter((type) => typeof type === "string") ?? [],
      phases: owner.phases?.filter((phase) => typeof phase === "string") ?? [],
    }));

    const sanitizedFallback = payload.fallback
      ? {
          ...payload.fallback,
          emails:
            payload.fallback.emails?.filter((email) => typeof email === "string") ?? [],
          slackChannels:
            payload.fallback.slackChannels?.filter(
              (channel) => typeof channel === "string",
            ) ?? [],
        }
      : undefined;

    return {
      config: {
        owners: sanitizedOwners,
        fallback: sanitizedFallback,
      },
      errors,
    };
  } catch (error) {
    errors.push(
      `Unable to load alert config: ${(error as Error).message}. Falling back to empty owner list.`,
    );
    return { config: { owners: [] }, errors };
  }
}

function convertRunToOwnerAlertRun(run: RegressionRun): OwnerAlertRun {
  const criticality = normalizeCriticality(run.scenario.criticality);
  const failureCategories = run.outcome.failureCategories;

  return {
    runId: run.id,
    scenarioTitle: run.scenario.title,
    scenarioSlug: run.scenario.slug,
    timestamp: run.timestamp,
    commit: run.commit,
    criticality,
    regressionType: run.scenario.regressionType,
    failureCategories,
    latencyMs: run.outcome.latencyMs,
    recommendedActions: buildRecommendedActions(failureCategories),
    missingSteps: run.outcome.missingSteps,
    missingTelemetry: run.outcome.missingTelemetry,
    subagentDiffs: run.outcome.subagentDiffs,
    missingSubagentCalls: run.outcome.missingSubagentCalls,
    unexpectedSubagentCalls: run.outcome.unexpectedSubagentCalls,
  };
}

function summarizeOwnerRuns(runs: OwnerAlertRun[]): {
  latestFailureAt: string;
  highestCriticality: Criticality;
} {
  let latestFailureAt = runs[0]?.timestamp ?? new Date(0).toISOString();
  let highestCriticality: Criticality = "unknown";

  for (const run of runs) {
    if (run.timestamp > latestFailureAt) {
      latestFailureAt = run.timestamp;
    }

    if (criticalityRank(run.criticality) > criticalityRank(highestCriticality)) {
      highestCriticality = run.criticality;
    }
  }

  return { latestFailureAt, highestCriticality };
}

export function buildRegressionAlerts(
  runs: RegressionRun[],
  config: RegressionAlertConfig,
): RegressionAlertPayload {
  const failingRuns = runs.filter((run) => !run.outcome.passed);
  const ownerAlerts = new Map<string, OwnerAlert>();
  const unassigned: OwnerAlertRun[] = [];

  for (const run of failingRuns) {
    const ownerMatches = config.owners.filter((owner) =>
      shouldAssignRunToOwner(owner, run),
    );

    const ownerRun = convertRunToOwnerAlertRun(run);

    if (ownerMatches.length === 0) {
      unassigned.push(ownerRun);
      continue;
    }

    for (const owner of ownerMatches) {
      const existing = ownerAlerts.get(owner.id);

      if (existing) {
        existing.failingRuns.push(ownerRun);
        if (ownerRun.timestamp > existing.latestFailureAt) {
          existing.latestFailureAt = ownerRun.timestamp;
        }
        if (
          criticalityRank(ownerRun.criticality) >
          criticalityRank(existing.highestCriticality)
        ) {
          existing.highestCriticality = ownerRun.criticality;
        }
        continue;
      }

      const { latestFailureAt, highestCriticality } = summarizeOwnerRuns([
        ownerRun,
      ]);

      ownerAlerts.set(owner.id, {
        ownerId: owner.id,
        ownerName: owner.name,
        emails: owner.emails,
        slackChannels: owner.slackChannels ?? [],
        latestFailureAt,
        highestCriticality,
        failingRuns: [ownerRun],
      });
    }
  }

  if (config.fallback && unassigned.length > 0) {
    const filtered = unassigned.filter((run) => {
      if (!config.fallback?.minCriticality) {
        return true;
      }

      return (
        criticalityRank(run.criticality) >=
        criticalityRank(config.fallback.minCriticality)
      );
    });

    if (filtered.length > 0) {
      const { latestFailureAt, highestCriticality } = summarizeOwnerRuns(
        filtered,
      );

      ownerAlerts.set("fallback", {
        ownerId: "fallback",
        ownerName: config.fallback.name,
        emails: config.fallback.emails,
        slackChannels: config.fallback.slackChannels ?? [],
        latestFailureAt,
        highestCriticality,
        failingRuns: filtered,
      });

      // Remove any runs that were escalated to the fallback owner from the
      // explicit unassigned list to avoid double counting.
      const fallbackRunIds = new Set(filtered.map((run) => run.runId));
      for (let index = unassigned.length - 1; index >= 0; index -= 1) {
        if (fallbackRunIds.has(unassigned[index].runId)) {
          unassigned.splice(index, 1);
        }
      }
    }
  }

  const sortedOwners = Array.from(ownerAlerts.values()).sort((a, b) => {
    if (criticalityRank(a.highestCriticality) !== criticalityRank(b.highestCriticality)) {
      return (
        criticalityRank(b.highestCriticality) -
        criticalityRank(a.highestCriticality)
      );
    }

    return b.latestFailureAt.localeCompare(a.latestFailureAt);
  });

  for (const owner of sortedOwners) {
    owner.failingRuns.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalFailures: failingRuns.length,
      ownersWithFailures: sortedOwners.length,
      unassignedFailures: unassigned.length,
    },
    owners: sortedOwners,
    unassigned,
    errors: [],
  };
}

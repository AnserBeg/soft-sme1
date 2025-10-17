"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

type RegressionRun = {
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

type AgentEvaluationMetrics = {
  totalRuns: number;
  successRate: number;
  averageLatencyMs: number | null;
  toolEfficiency: number;
  toolFailureRate: number;
  safetyOverrideRate: number;
};

type ScenarioSummary = {
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

type RegressionTypeSummary = {
  regressionType: string;
  totalRuns: number;
  failures: number;
  lastFailureAt: string | null;
};

type RegressionDashboardResponse = {
  runs: RegressionRun[];
  summary: {
    totalRuns: number;
    passes: number;
    failures: number;
    passRate: number;
    lastRunAt: string | null;
    scenarioSummaries: ScenarioSummary[];
    regressionTypeSummaries: RegressionTypeSummary[];
  };
  metrics: AgentEvaluationMetrics;
  errors: string[];
};

function formatDate(timestamp: string | null): string {
  if (!timestamp) {
    return "—";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatPercent(value: number, fractionDigits = 1): string {
  const formatter = new Intl.NumberFormat("en", {
    style: "percent",
    maximumFractionDigits: fractionDigits,
  });
  return formatter.format(value);
}

async function fetchRegressionRuns(): Promise<RegressionDashboardResponse> {
  const response = await fetch("/api/regressions/runs", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to load regression runs");
  }

  return response.json();
}

export default function RegressionDashboardPage() {
  const [scenarioFilter, setScenarioFilter] = useState<string>("all");
  const [regressionTypeFilter, setRegressionTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["regression-dashboard"],
    queryFn: fetchRegressionRuns,
  });

  const activeFailures = useMemo(() => {
    if (!data) {
      return 0;
    }

    return data.summary.scenarioSummaries.filter((scenario) => scenario.latestOutcome === "fail").length;
  }, [data]);

  const scenarioOptions = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.summary.scenarioSummaries.map((scenario) => ({
      value: scenario.slug,
      label: scenario.title,
    }));
  }, [data]);

  const regressionTypeOptions = useMemo(() => {
    if (!data) {
      return [];
    }

    const uniqueTypes = new Set<string>();
    data.summary.regressionTypeSummaries.forEach((entry) => {
      uniqueTypes.add(entry.regressionType);
    });
    return Array.from(uniqueTypes).map((type) => ({ value: type, label: type }));
  }, [data]);

  const failureCategories = useMemo(() => {
    if (!data) {
      return [];
    }

    const categories = new Set<string>();
    data.runs.forEach((run) => {
      run.outcome.failureCategories.forEach((category) => categories.add(category));
    });
    return Array.from(categories).sort();
  }, [data]);

  const evaluationCards = useMemo(() => {
    if (!data) {
      return [];
    }

    const metrics = data.metrics;
    return [
      {
        label: "Agent success rate",
        value: formatPercent(metrics.successRate),
      },
      {
        label: "Average latency",
        value: metrics.averageLatencyMs === null ? "—" : `${metrics.averageLatencyMs} ms`,
      },
      {
        label: "Tool efficiency",
        value: formatPercent(metrics.toolEfficiency),
      },
      {
        label: "Tool failure rate",
        value: formatPercent(metrics.toolFailureRate),
      },
      {
        label: "Safety override rate",
        value: formatPercent(metrics.safetyOverrideRate),
      },
    ];
  }, [data]);

  const filteredRuns = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.runs.filter((run) => {
      if (scenarioFilter !== "all" && run.scenario.slug !== scenarioFilter) {
        return false;
      }

      if (regressionTypeFilter !== "all" && run.scenario.regressionType !== regressionTypeFilter) {
        return false;
      }

      if (statusFilter === "pass" && !run.outcome.passed) {
        return false;
      }

      if (statusFilter === "fail" && run.outcome.passed) {
        return false;
      }

      if (
        categoryFilter !== "all" &&
        !run.outcome.failureCategories.includes(categoryFilter)
      ) {
        return false;
      }

      return true;
    });
  }, [data, scenarioFilter, regressionTypeFilter, statusFilter, categoryFilter]);

  const categoryChips = (run: RegressionRun) => {
    if (run.outcome.passed || run.outcome.failureCategories.length === 0) {
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
          Healthy
        </span>
      );
    }

    return (
      <div className="flex flex-wrap gap-2">
        {run.outcome.failureCategories.map((category) => (
          <span
            key={category}
            className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800"
          >
            {category}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Synthetic Regression Dashboard</h1>
        <p className="text-gray-600">
          Track planner and subagent contract health across synthetic conversation suites. Use the filters below to identify
          regressions before they reach production.
        </p>
      </div>

      {isLoading && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-gray-600">Loading regression runs…</p>
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
          <p className="font-semibold">Unable to load regression data.</p>
          <p className="text-sm">{error instanceof Error ? error.message : "Unknown error"}</p>
        </div>
      )}

      {data && (
        <>
          {data.errors.length > 0 && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
              <p className="font-semibold">Ingestion warnings</p>
              <ul className="list-disc space-y-1 pl-5">
                {data.errors.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Total runs</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{data.summary.totalRuns}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Pass rate</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{data.summary.passRate}%</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Active failing scenarios</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{activeFailures}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Last run</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{formatDate(data.summary.lastRunAt)}</p>
            </div>
          </div>

          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">Evaluation metrics</h2>
            <p className="mt-1 text-sm text-gray-500">
              Benchmarks derived from synthetic regression runs and aggregated agent telemetry.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {evaluationCards.map((card) => (
                <div key={card.label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                  <p className="text-sm font-medium text-gray-500">{card.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-gray-900">{card.value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">Filters</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col text-sm font-medium text-gray-700">
                Scenario
                <select
                  value={scenarioFilter}
                  onChange={(event) => setScenarioFilter(event.target.value)}
                  className="mt-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="all">All scenarios</option>
                  {scenarioOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col text-sm font-medium text-gray-700">
                Regression type
                <select
                  value={regressionTypeFilter}
                  onChange={(event) => setRegressionTypeFilter(event.target.value)}
                  className="mt-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="all">All regression types</option>
                  {regressionTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col text-sm font-medium text-gray-700">
                Status
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="mt-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="all">All statuses</option>
                  <option value="pass">Pass only</option>
                  <option value="fail">Failures only</option>
                </select>
              </label>

              <label className="flex flex-col text-sm font-medium text-gray-700">
                Failure category
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  className="mt-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="all">All categories</option>
                  {failureCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">Recent runs</h2>
            <p className="mt-1 text-sm text-gray-500">
              Showing {filteredRuns.length} of {data.runs.length} runs
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Scenario</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Regression type</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Timestamp</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Latency</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Telemetry events</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Categories</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Diagnostics</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredRuns.map((run) => (
                    <tr key={run.id} className={run.outcome.passed ? "bg-white" : "bg-red-50/30"}>
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-gray-900">{run.scenario.title}</div>
                        <div className="text-xs text-gray-500">{run.commit.slice(0, 12)}</div>
                      </td>
                      <td className="px-4 py-3 align-top text-gray-700">{run.scenario.regressionType}</td>
                      <td className="px-4 py-3 align-top text-gray-700">{formatDate(run.timestamp)}</td>
                      <td className="px-4 py-3 align-top text-gray-700">{run.outcome.latencyMs ?? "—"} ms</td>
                      <td className="px-4 py-3 align-top text-gray-700">{run.telemetryCount}</td>
                      <td className="px-4 py-3 align-top">
                        {run.outcome.passed ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                            Pass
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                            Fail
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">{categoryChips(run)}</td>
                      <td className="px-4 py-3 align-top">
                        <details className="text-sm text-gray-600">
                          <summary className="cursor-pointer text-blue-600">View</summary>
                          <div className="mt-2 space-y-2">
                            {run.outcome.diffs.length > 0 && (
                              <div>
                                <p className="font-medium text-gray-800">Plan diffs</p>
                                <ul className="mt-1 list-disc space-y-1 pl-5">
                                  {run.outcome.diffs.map((diff) => (
                                    <li key={diff}>{diff}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {run.outcome.missingSteps.length > 0 && (
                              <div>
                                <p className="font-medium text-gray-800">Missing steps</p>
                                <ul className="mt-1 list-disc space-y-1 pl-5">
                                  {run.outcome.missingSteps.map((step) => (
                                    <li key={step}>{step}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {run.outcome.missingTelemetry.length > 0 && (
                              <div>
                                <p className="font-medium text-gray-800">Missing telemetry</p>
                                <ul className="mt-1 list-disc space-y-1 pl-5">
                                  {run.outcome.missingTelemetry.map((flag) => (
                                    <li key={flag}>{flag}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {run.outcome.subagentDiffs.length > 0 && (
                              <div>
                                <p className="font-medium text-gray-800">Subagent diffs</p>
                                <ul className="mt-1 list-disc space-y-1 pl-5">
                                  {run.outcome.subagentDiffs.map((diff) => (
                                    <li key={diff}>{diff}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {run.outcome.missingSubagentCalls.length > 0 && (
                              <div>
                                <p className="font-medium text-gray-800">Missing subagent calls</p>
                                <ul className="mt-1 list-disc space-y-1 pl-5">
                                  {run.outcome.missingSubagentCalls.map((call) => (
                                    <li key={call}>{call}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {run.outcome.unexpectedSubagentCalls.length > 0 && (
                              <div>
                                <p className="font-medium text-gray-800">Unexpected subagent calls</p>
                                <ul className="mt-1 list-disc space-y-1 pl-5">
                                  {run.outcome.unexpectedSubagentCalls.map((call) => (
                                    <li key={call}>{call}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {run.outcome.passed && run.outcome.failureCategories.length === 0 && (
                              <p className="text-sm text-gray-500">No issues detected.</p>
                            )}
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                  {filteredRuns.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-500">
                        No runs match the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">Scenario health</h2>
            <p className="mt-1 text-sm text-gray-500">
              Aggregated failure counts highlight where planner or subagent drift needs attention.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Scenario</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Regression type</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Phase</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Total runs</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Failures</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Last run</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Last failure</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.summary.scenarioSummaries.map((scenario) => (
                    <tr key={scenario.slug}>
                      <td className="px-4 py-3 font-medium text-gray-900">{scenario.title}</td>
                      <td className="px-4 py-3 text-gray-700">{scenario.regressionType}</td>
                      <td className="px-4 py-3 text-gray-700 capitalize">{scenario.phase}</td>
                      <td className="px-4 py-3 text-gray-700">{scenario.totalRuns}</td>
                      <td className="px-4 py-3 text-gray-700">{scenario.failures}</td>
                      <td className="px-4 py-3 text-gray-700">{formatDate(scenario.lastRunAt)}</td>
                      <td className="px-4 py-3 text-gray-700">{formatDate(scenario.lastFailureAt)}</td>
                      <td className="px-4 py-3">
                        {scenario.latestOutcome === "pass" ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                            Stable
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                            Failing
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.summary.scenarioSummaries.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-500">
                        No scenarios have been executed yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">Regression type breakdown</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Regression type</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Total runs</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Failures</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Last failure</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.summary.regressionTypeSummaries.map((entry) => (
                    <tr key={entry.regressionType}>
                      <td className="px-4 py-3 font-medium text-gray-900">{entry.regressionType}</td>
                      <td className="px-4 py-3 text-gray-700">{entry.totalRuns}</td>
                      <td className="px-4 py-3 text-gray-700">{entry.failures}</td>
                      <td className="px-4 py-3 text-gray-700">{formatDate(entry.lastFailureAt)}</td>
                    </tr>
                  ))}
                  {data.summary.regressionTypeSummaries.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-500">
                        Regression types will appear after the first synthetic suite run is persisted.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

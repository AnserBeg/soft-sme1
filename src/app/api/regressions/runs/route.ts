import { NextResponse } from "next/server";

import {
  buildSummary,
  computeEvaluationMetrics,
  loadAgentEventLogs,
  loadRegressionRuns,
  type RegressionDashboardPayload,
} from "@/lib/regressionRuns";

export async function GET(): Promise<NextResponse<RegressionDashboardPayload>> {
  const { runs, errors: runErrors } = await loadRegressionRuns();
  const { events, errors: eventErrors } = await loadAgentEventLogs();
  const metrics = computeEvaluationMetrics(runs, events);
  const errors = [...runErrors, ...eventErrors];

  const payload: RegressionDashboardPayload = {
    runs,
    summary: buildSummary(runs),
    metrics,
    errors,
  };

  return NextResponse.json(payload);
}

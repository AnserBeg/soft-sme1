import { NextResponse } from "next/server";

import {
  buildSummary,
  loadRegressionRuns,
  type RegressionDashboardPayload,
} from "@/lib/regressionRuns";

export async function GET(): Promise<NextResponse<RegressionDashboardPayload>> {
  const { runs, errors } = await loadRegressionRuns();

  const payload: RegressionDashboardPayload = {
    runs,
    summary: buildSummary(runs),
    errors,
  };

  return NextResponse.json(payload);
}

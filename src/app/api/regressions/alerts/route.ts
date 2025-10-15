import { NextResponse } from "next/server";

import {
  buildRegressionAlerts,
  loadAlertConfig,
  type RegressionAlertPayload,
} from "@/lib/regressionAlerts";
import {
  buildSummary,
  loadRegressionRuns,
  type RegressionDashboardPayload,
} from "@/lib/regressionRuns";

type RegressionAlertResponse = {
  runs: RegressionDashboardPayload;
  alerts: RegressionAlertPayload;
};

export async function GET(): Promise<NextResponse<RegressionAlertResponse>> {
  const [{ runs, errors: runErrors }, { config, errors: configErrors }] =
    await Promise.all([loadRegressionRuns(), loadAlertConfig()]);

  const alerts = buildRegressionAlerts(runs, config);
  alerts.errors.push(...runErrors, ...configErrors);

  const runsPayload: RegressionDashboardPayload = {
    runs,
    summary: buildSummary(runs),
    errors: runErrors,
  };

  return NextResponse.json({
    runs: runsPayload,
    alerts,
  });
}

export interface AdminDashboardOpsChartRow {
  label: string;
  value: string;
  rawValue?: number | null;
}

export interface AdminDashboardOpsChartDatum {
  label: string;
  value: number;
  rawValue: number;
  displayValue: string;
}

export function buildAdminDashboardOpsChartData(rows: readonly AdminDashboardOpsChartRow[]) {
  const knownRows = rows.filter(
    (row): row is AdminDashboardOpsChartRow & { rawValue: number } =>
      typeof row.rawValue === "number" && Number.isFinite(row.rawValue),
  );
  const max = Math.max(1, ...knownRows.map((row) => row.rawValue));

  return {
    data: knownRows.map((row): AdminDashboardOpsChartDatum => ({
      label: row.label,
      value: (row.rawValue / max) * 100,
      rawValue: row.rawValue,
      displayValue: row.value,
    })),
    unavailableLabels: rows
      .filter((row) => typeof row.rawValue !== "number" || !Number.isFinite(row.rawValue))
      .map((row) => row.label),
  };
}

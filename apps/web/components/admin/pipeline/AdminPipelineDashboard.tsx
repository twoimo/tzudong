"use client";

import { useQuery } from "@tanstack/react-query";

type PipelineStatusResponse = {
  targets?: Array<{ id: string; status?: string }>;
  hardware?: string;
  dataEnv?: string;
  failures?: Array<{ code?: string }>;
};

export function AdminPipelineDashboard() {
  const query = useQuery({
    queryKey: ["admin-pipeline-status"],
    queryFn: async (): Promise<PipelineStatusResponse> => {
      const response = await fetch("/api/admin/pipeline", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("pipeline-status-failed");
      return (await response.json()) as PipelineStatusResponse;
    },
    staleTime: 15_000,
  });

  return (
    <section
      data-admin-pipeline-dashboard="true"
      className="flex min-h-[220px] flex-col gap-3 border border-border bg-card p-4"
    >
      <header>
        <h2 className="text-sm font-semibold">크롤러 파이프라인</h2>
        <p className="text-xs text-muted-foreground">
          control-plane 상태. Grafana iframe은 CSP/auth gate 전까지 금지.
        </p>
      </header>
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span data-admin-pipeline-hardware={query.data?.hardware ?? "unknown"}>
          hardware: {query.data?.hardware ?? "unknown"}
        </span>
        <span data-admin-pipeline-data-env={query.data?.dataEnv ?? "unknown"}>
          data: {query.data?.dataEnv ?? "unknown"}
        </span>
      </div>
      <ul className="space-y-1 text-xs">
        {(query.data?.targets ?? []).map((target) => (
          <li key={target.id} data-admin-pipeline-target={target.id}>
            {target.id}: {target.status ?? "Idle"}
          </li>
        ))}
      </ul>
      <div data-admin-pipeline-failures="true" className="text-xs">
        {(query.data?.failures ?? []).length === 0
          ? "최근 실패 없음"
          : (query.data?.failures ?? [])
              .map((row) => row.code ?? "failed")
              .join(", ")}
      </div>
    </section>
  );
}

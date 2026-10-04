"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { RefreshCw, ChevronRight } from "lucide-react";
import { PIPELINE_CONTROL_CONFIRMATION_TEXT, PIPELINE_LIVE_ENQUEUE_CONFIRMATION } from "@/lib/admin/pipeline-control";
import { parsePipelineActionPreview, pipelineApplyBody, type PipelineActionInput, type PipelineActionPreview } from "@/lib/admin/pipeline-action-preview";
import { buildPipelineStages, canControlPipelineJob, parsePipelineManifest, parsePipelineStatus, pipelineJobsForDisplay, PIPELINE_FLOW_DOCUMENT, PIPELINE_JOB_LABELS, PIPELINE_STAGE_LABELS, type PipelineStageId } from "@/lib/admin/pipeline-flow-view-model";
import { isRecord } from "@/lib/admin/normalize-evaluation-record";
import { PipelineFlowDiagram, formatPipelineDuration } from "./PipelineFlowDiagram";

const ACTIVE_JOB_STATUSES = new Set(["Queued", "Fetching", "Inserting"]);
const ACTION_LABELS = { enqueue: "수집 실행", pause: "일시 정지", resume: "다시 시작", cancel: "실행 취소" };
const LOOPBACK_GRAFANA_DASHBOARD_PREFIX = "http://127.0.0.1:3001/d/tzudong-pipeline-frozen-counters";
const buttonClass = "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium disabled:opacity-50";
const inputClass = "min-h-9 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-sm";
function allowLoopbackGrafanaIframe() {
  return process.env.NODE_ENV !== "production" && typeof window !== "undefined" && window.location.hostname === "127.0.0.1";
}
async function readStatus(path: string, signal: AbortSignal) {
  const response = await fetch(path, { headers: { Accept: "application/json" }, cache: "no-store", signal });
  if (!response.ok) throw new Error("pipeline_status_unavailable");
  return response.json() as Promise<unknown>;
}
async function postPipeline(body: Record<string, unknown>) {
  const response = await fetch("/api/admin/pipeline", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  return { ok: response.ok, status: response.status, payload: await response.json().catch(() => null) as unknown };
}
function formatCheckedAt(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "시각 미확인";
}
function modeLabel(value: boolean | undefined) { return value === true ? "테스트 · dry-run" : value === false ? "실제 실행 · live" : "실행 모드 미확인"; }

export function AdminPipelineDashboard() {
  const query = useQuery({
    queryKey: ["admin-pipeline-status"],
    queryFn: async ({ signal }) => parsePipelineStatus(await readStatus("/api/admin/pipeline", signal)),
    staleTime: 15_000, retry: false,
    refetchInterval: current => current.state.data?.source === "job_api" && current.state.data.jobs.some(job => ACTIVE_JOB_STATUSES.has(job.status)) ? 2_000 : 15_000,
  });
  const manifestQuery = useQuery({
    queryKey: ["admin-pipeline-manifest"],
    queryFn: async ({ signal }) => parsePipelineManifest(await readStatus("/api/admin/system-status", signal)),
    staleTime: 30_000, retry: false,
  });
  const snapshot = query.isError ? undefined : query.data;
  const manifest = manifestQuery.isError ? undefined : manifestQuery.data;
  const jobs = pipelineJobsForDisplay(snapshot, manifest);
  const stages = buildPipelineStages(manifest);
  const [selected, setSelected] = useState<PipelineStageId>("collect");
  const selectedStage = stages.find(stage => stage.id === selected)!;
  const [enqueueTarget, setEnqueueTarget] = useState("tzuyang");
  const [enqueueProfile, setEnqueueProfile] = useState<"heavy_local" | "lite_gha">("heavy_local");
  const [confirmationText, setConfirmationText] = useState("");
  const [liveConfirmationText, setLiveConfirmationText] = useState("");
  const [preview, setPreview] = useState<PipelineActionPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const previewPanel = useRef<HTMLDivElement>(null);
  const [showGrafana, setShowGrafana] = useState(false);
  const [grafanaAllowed, setGrafanaAllowed] = useState(false);
  useEffect(() => setGrafanaAllowed(allowLoopbackGrafanaIframe()), []);
  useEffect(() => { if (preview) previewPanel.current?.focus(); }, [preview]);
  const refresh = async () => { await Promise.allSettled([query.refetch(), manifestQuery.refetch()]); };
  const prepare = async (input: PipelineActionInput) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage(null); setPreview(null); setConfirmationText(""); setLiveConfirmationText("");
    try {
      const identity = { correlationId: crypto.randomUUID(), idempotencyKey: `pipe-${crypto.randomUUID()}` };
      const result = await postPipeline({ phase: "preview", action: input.action, target: input.target, profile: input.profile, ...identity,
        ...(input.runId ? { runId: input.runId } : {}), ...(input.action === "enqueue" ? { dryRun: !input.live } : {}) });
      if (result.status === 409) { await refresh(); setMessage("실행 상태가 바뀌었습니다. 새 목록에서 다시 미리보기 하세요."); return; }
      if (!result.ok) { setMessage("미리보기를 만들 수 없습니다. 연결과 권한을 확인하세요."); return; }
      setPreview(parsePipelineActionPreview(result.payload, input, identity));
    } catch { setMessage("유효한 미리보기를 확인하지 못했습니다. 새로고침 후 다시 시도하세요."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const apply = async () => {
    if (!preview || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage(null);
    try {
      const body = pipelineApplyBody(preview, confirmationText, liveConfirmationText);
      setPreview(null); // An uncertain response must not silently replay an apply.
      const result = await postPipeline(body);
      await refresh();
      if (result.status === 409) setMessage("실행 상태 또는 미리보기 유효 시간이 바뀌었습니다. 다시 미리보기 하세요.");
      else if (!result.ok || !isRecord(result.payload) || result.payload.accepted !== true) setMessage("요청 결과를 확인하지 못했습니다. 실행 목록을 확인한 뒤 다시 시도하세요.");
      else setMessage("서버가 요청을 접수했습니다. 새로 조회한 실행 목록에서 상태를 확인하세요.");
    } catch {
      setPreview(null);
      await refresh();
      setMessage("요청 결과 또는 미리보기 유효 시간을 확인할 수 없습니다. 실행 목록을 먼저 확인하세요.");
    } finally { inFlight.current = false; setBusy(false); }
  };
  const reliable = snapshot && !snapshot.partial;
  const source = snapshot?.source === "job_api" ? "제어 API" : snapshot?.source === "github_actions" ? "GitHub Actions" : "출처 미확인";
  const manifestLabel = manifestQuery.isPending ? "기록 조회 중" : manifestQuery.isError ? "기록 조회 실패" : manifest?.availability === "available" ? (manifest.stale === true ? "오래된 manifest" : manifest.stale === false ? "최근 manifest" : "기록 시점 미확인") : manifest?.availability === "missing" ? "manifest 없음" : manifest?.availability === "unreadable" ? "manifest 읽기 실패" : "manifest 미확인";
  const controlsReady = snapshot?.source === "job_api" && !snapshot.partial && !busy && !preview;
  const gauges = snapshot?.gauges ?? {};
  const failureCount = reliable && snapshot.source === "job_api" ? snapshot.failures.length : null;
  const metrics = [
    ["진행 · 대기", reliable && jobs.every(job => job.status !== "Unknown") ? jobs.filter(job => ACTIVE_JOB_STATUSES.has(job.status)).length : "—"],
    ["일시 정지", reliable && jobs.every(job => job.status !== "Unknown") ? jobs.filter(job => job.status === "Paused").length : "—"],
    ["최근 실패 · 최대 20건", failureCount ?? "—"],
    ["수집 대상", reliable && snapshot.source === "job_api" ? snapshot.targets.length : "—"],
  ];
  return <section data-admin-pipeline-dashboard="true" className="flex min-w-0 flex-col gap-3">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2"><h2 className="text-base font-semibold leading-6">크롤러 파이프라인</h2><span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">{source}</span></div>
      <button type="button" className={buttonClass} disabled={query.isFetching || manifestQuery.isFetching} onClick={() => void refresh()}><RefreshCw size={13} className={query.isFetching || manifestQuery.isFetching ? "animate-spin" : ""} />새로고침</button>
    </header>
    {query.isError ? <p role="status" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">실행 상태를 불러올 수 없습니다. 이전 조회 결과를 현재 상태로 표시하지 않습니다.</p> : query.isPending ? <p role="status" className="text-xs text-muted-foreground">실행 상태 조회 중</p> : snapshot?.partial ? <p role="status" className="text-xs text-muted-foreground">일부 응답을 확인하지 못했습니다. 실행 제어가 잠겨 있습니다.</p> : null}
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{metrics.map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-card px-3 py-2"><div className="text-[11px] text-muted-foreground">{label}</div><div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div></div>)}</div>
    <section className="min-w-0 rounded-lg border border-border bg-card" aria-labelledby="pipeline-flow-title" data-pipeline-flow-document={PIPELINE_FLOW_DOCUMENT}>
      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border px-3 py-2"><h3 id="pipeline-flow-title" className="text-sm font-semibold">데이터 흐름</h3><span className="text-[11px] text-muted-foreground">{manifestLabel} · 조회 {formatCheckedAt(manifest?.checkedAt)}</span></div>
      <div className="px-2 pt-1"><PipelineFlowDiagram stages={stages} selected={selected} onSelect={setSelected} /></div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border px-3 py-2 text-[11px] text-muted-foreground"><span>실선: 완료·실패 기록</span><span>점선: 미확인·일부·생략</span><span>단계를 선택해 근거 확인</span></div>
      <div className="border-t border-border bg-muted/20 px-3 py-2 text-[11px] leading-5 text-muted-foreground">단계는 마지막 manifest 기록입니다. 아래 실행 목록과 실행 ID로 연결되지 않으며, 완료 기록만으로 실제 저장이나 관리자 승인을 확인할 수 없습니다.{manifest?.invalidEvents ? " 일부 단계 기록의 형식을 확인하지 못했습니다." : ""}</div>
    </section>
    <section data-pipeline-stage-detail={selected} aria-labelledby="pipeline-stage-title" className="min-w-0 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="pipeline-stage-title" className="text-sm font-semibold">{selectedStage.label}<span className="ml-2 text-xs font-normal text-muted-foreground">{PIPELINE_STAGE_LABELS[selectedStage.state]}</span></h3><span className="text-xs tabular-nums text-muted-foreground">{formatPipelineDuration(selectedStage.durationSeconds)}</span></div>
      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2"><p><span className="mr-2 text-muted-foreground">입력</span>{selectedStage.input}</p><p><span className="mr-2 text-muted-foreground">출력</span>{selectedStage.output}</p></div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{selectedStage.contract}</p>
      {selectedStage.details.length ? <ul className="mt-2 divide-y divide-border rounded-md border border-border">{selectedStage.details.map(detail => <li key={detail.name} className="flex flex-wrap justify-between gap-x-3 gap-y-1 px-2 py-1.5 text-[11px]"><span className="break-words">{detail.name}</span><span className="text-muted-foreground">{detail.event ? ({ completed: "완료 기록", failed: "실패 기록", optional_skipped: "선택 생략", downstream_skipped: "선행 단계로 생략" })[detail.event.status] : "기록 미확인"} · {formatPipelineDuration(detail.event?.durationSeconds ?? null)}</span></li>)}</ul> : <Link href="/admin?module=restaurants" className={`${buttonClass} mt-2`}>맛집 검수로 이동<ChevronRight size={13} /></Link>}
      <details className="mt-2 text-[11px] text-muted-foreground"><summary className="cursor-pointer">소스·계약 근거</summary><p className="mt-1 break-all">{selectedStage.source}</p><p>backend/ARCHITECTURE.md · backend/DATA_CONTRACTS.md</p><p className="break-all">{PIPELINE_FLOW_DOCUMENT}</p></details>
    </section>
    <section className="min-w-0 rounded-lg border border-border bg-card" aria-labelledby="pipeline-jobs-title">
      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border px-3 py-2"><h3 id="pipeline-jobs-title" className="text-sm font-semibold">{snapshot?.source === "github_actions" ? "GitHub Actions 크롤러 최근 실행" : "현재 실행"}</h3><span className="text-[11px] text-muted-foreground">{source} · {snapshot ? formatCheckedAt(new Date(query.dataUpdatedAt).toISOString()) : "조회 미확인"}</span></div>
      <ul data-admin-pipeline-jobs="true" className="divide-y divide-border">
        {jobs.map(job => <li key={job.id} data-admin-pipeline-job={job.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
          <div className="min-w-0 space-y-1"><p className="flex flex-wrap gap-2"><strong className="font-semibold">{job.target}</strong><span>{PIPELINE_JOB_LABELS[job.status]}</span><span className="text-muted-foreground">{modeLabel(job.dry_run)}</span></p><p className="break-all text-[11px] text-muted-foreground">{job.profile === "unknown" ? "환경 미확인" : job.profile} · {job.id} · 단계 {job.adapter_index ?? "미확인"}{job.hasError ? " · 오류 기록 있음" : ""}</p></div>
          <div className="flex gap-1">{(["pause", "resume", "cancel"] as const).filter(action => canControlPipelineJob(snapshot?.source, job, action)).map(action => <button key={action} type="button" {...{ [`data-admin-pipeline-${action}`]: "true" }} disabled={!controlsReady} className={buttonClass} onClick={() => void prepare({ action, target: job.target, profile: job.profile as "heavy_local" | "lite_gha", runId: job.id })}>{ACTION_LABELS[action]}</button>)}</div>
        </li>)}
      </ul>
      {!jobs.length ? <p className="px-3 py-3 text-xs text-muted-foreground">{!snapshot ? "실행 목록 미확인" : snapshot.partial ? "유효한 실행 목록을 확인하지 못했습니다." : snapshot.source === "github_actions" ? "최근 실행 기록 없음" : "현재 등록된 실행 없음"}</p> : null}
      <details data-admin-pipeline-failures="true" className="border-t border-border px-3 py-2 text-xs"><summary className="cursor-pointer font-medium">최근 실패 {failureCount === null ? "미확인" : `${failureCount}건`}</summary>{failureCount === null ? <p className="pt-2 text-muted-foreground">제어 API의 유효한 실패 목록이 필요합니다.</p> : failureCount === 0 ? <p className="pt-2 text-muted-foreground">조회 범위에 실패 기록이 없습니다.</p> : <ul className="mt-2 space-y-2">{snapshot?.failures.map(job => <li key={job.id} className="break-all">{job.target} · {job.id}<span className="ml-2 text-muted-foreground">{modeLabel(job.dry_run)}</span></li>)}</ul>}</details>
    </section>
    <details className="rounded-lg border border-border bg-card px-3 py-2" open={!!preview}>
      <summary className="cursor-pointer text-sm font-semibold">실행 제어<span className="ml-2 text-[11px] font-normal text-muted-foreground">미리보기 → 확인 → 적용</span></summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs"><span>수집 대상</span><input className={inputClass} value={enqueueTarget} maxLength={128} disabled={!!preview || busy} onChange={event => setEnqueueTarget(event.target.value)} list="pipeline-target-options" /><datalist id="pipeline-target-options">{snapshot?.targets.map(target => <option key={target.id} value={target.id} />)}</datalist></label>
        <label className="space-y-1 text-xs"><span>실행 환경</span><select className={inputClass} value={enqueueProfile} disabled={!!preview || busy} onChange={event => setEnqueueProfile(event.target.value as "heavy_local" | "lite_gha")}><option value="heavy_local">로컬 · 미디어 처리 포함</option><option value="lite_gha">GitHub Actions · 경량 처리</option></select></label>
        <div className="flex flex-wrap gap-2 sm:col-span-2"><button type="button" data-admin-pipeline-enqueue="true" disabled={!controlsReady || !/^[A-Za-z0-9_-]{1,128}$/.test(enqueueTarget)} className={buttonClass} onClick={() => void prepare({ action: "enqueue", target: enqueueTarget, profile: enqueueProfile })}>테스트 실행 미리보기</button><button type="button" data-admin-pipeline-enqueue-live="true" disabled={!controlsReady || !/^[A-Za-z0-9_-]{1,128}$/.test(enqueueTarget)} className={buttonClass} onClick={() => void prepare({ action: "enqueue", target: enqueueTarget, profile: enqueueProfile, live: true })}>실제 수집 미리보기</button></div>
      </div>
      {snapshot?.source !== "job_api" ? <p className="mt-2 text-xs text-muted-foreground">실행 제어는 제어 API 연결 후 사용할 수 있습니다.</p> : null}
      {preview ? <div ref={previewPanel} tabIndex={-1} data-pipeline-preview className="mt-3 space-y-2 rounded-md border border-primary/40 bg-muted/30 p-3 outline-none">
        <p className="text-sm font-semibold">{ACTION_LABELS[preview.action]} 확인</p><p className="break-all text-xs">{preview.target} · {preview.profile}{preview.action === "enqueue" ? ` · ${modeLabel(preview.dryRun)}` : ` · ${preview.runId}`}</p><p className="text-[11px] text-muted-foreground">유효 시간 {new Date(preview.expiresAt).toLocaleTimeString("ko-KR")} · 적용 후 실행 목록을 다시 조회합니다.</p>
        <label className="block space-y-1 text-xs"><span>확인 문구 ({PIPELINE_CONTROL_CONFIRMATION_TEXT})</span><input className={inputClass} value={confirmationText} onChange={event => setConfirmationText(event.target.value)} autoComplete="off" /></label>
        {preview.action === "enqueue" && !preview.dryRun ? <label className="block space-y-1 text-xs"><span>실제 수집 확인 ({PIPELINE_LIVE_ENQUEUE_CONFIRMATION})</span><input className={inputClass} value={liveConfirmationText} onChange={event => setLiveConfirmationText(event.target.value)} autoComplete="off" /></label> : null}
        <div className="flex gap-2"><button type="button" data-pipeline-apply disabled={busy || confirmationText !== PIPELINE_CONTROL_CONFIRMATION_TEXT || (preview.action === "enqueue" && !preview.dryRun && liveConfirmationText !== PIPELINE_LIVE_ENQUEUE_CONFIRMATION)} onClick={() => void apply()} className={`${buttonClass} bg-primary text-primary-foreground`}>확인 후 적용</button><button type="button" disabled={busy} className={buttonClass} onClick={() => setPreview(null)}>닫기</button></div>
      </div> : null}
    </details>
    {message ? <p role="status" className="rounded-md border border-border px-3 py-2 text-xs">{message}</p> : null}
    <details className="rounded-lg border border-border bg-card px-3 py-2 text-xs"><summary className="cursor-pointer font-medium">실행 환경·자원 지표</summary><div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] text-muted-foreground">
      <span data-admin-pipeline-hardware="true">장비: {snapshot?.hardware ?? "미확인"}</span><span data-admin-pipeline-data-env="true">데이터 환경: {snapshot?.environment ?? "미확인"}</span>
      <span data-admin-pipeline-compute-profile="true">처리 설정: {jobs[0]?.profile ?? "미확인"}</span><span data-admin-pipeline-data-sink="true">저장 환경: {snapshot?.environment ?? "미확인"}</span><span data-admin-pipeline-active-step="true">처리 단계: {jobs[0]?.adapter_index ?? "미확인"}</span>
      <span data-admin-pipeline-kafka-lag="true">Kafka 대기: {gauges.tzudong_pipeline_kafka_lag ?? "—"}</span><span data-admin-pipeline-es-rows="true">색인 처리/초: {gauges.tzudong_pipeline_es_rows_per_sec ?? "—"}</span><span data-admin-pipeline-cpu="true">CPU 비율: {gauges.tzudong_pipeline_process_cpu_ratio ?? "—"}</span><span data-admin-pipeline-rss="true">RSS bytes: {gauges.tzudong_pipeline_process_rss_bytes ?? "—"}</span>
    </div>{snapshot?.targets.length ? <ul className="mt-2 flex flex-wrap gap-2">{snapshot.targets.map(target => <li key={target.id} data-admin-pipeline-target={target.id}>{target.id} · {target.status === "Idle" ? "대기 없음" : PIPELINE_JOB_LABELS[target.status]}</li>)}</ul> : null}</details>
    {grafanaAllowed ? <button type="button" aria-expanded={showGrafana} onClick={() => setShowGrafana(value => !value)} className={`${buttonClass} self-start`}>{showGrafana ? "자원 차트 닫기" : "로컬 자원 차트 열기"}</button> : null}
    {grafanaAllowed && showGrafana ? <iframe data-admin-pipeline-grafana="true" title="pipeline frozen counters" src={`${LOOPBACK_GRAFANA_DASHBOARD_PREFIX}?orgId=1`} className="h-64 w-full border border-border" /> : null}
  </section>;
}

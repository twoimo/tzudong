"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import {
  MAX_STORYBOARD_DOCUMENT_BYTES,
  MAX_STORYBOARD_IMAGE_BYTES,
  STORYBOARD_PRODUCTION_MESSAGES,
  STORYBOARD_WORKFLOW,
  assertStoryboardProviderPolicy,
  buildStoryboardDraftPrompt,
  parseStoryboardDraft,
  storyboardDraftSceneSchema,
  storyboardDraftSchema,
  storyboardProductionDocumentSchema,
  storyboardProductionRequestSchema,
  storyboardProviderSchema,
  type StoryboardDraftScene,
  type StoryboardProductionAsset,
  type StoryboardProductionDocument,
  type StoryboardProvider,
} from "@/lib/admin/storyboard/production-contract";
import { ADMIN_STORYBOARD_PROJECT_QUERY } from "@/lib/admin/admin-module-routing";

const API = "/api/admin/storyboard/production";
const PROJECT_QUERY = ADMIN_STORYBOARD_PROJECT_QUERY;
const POLL_MS = 2500;
const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";
const inputClass = "mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50";
const panelClass = "min-w-0 rounded-xl bg-card p-4 text-card-foreground sm:p-5";

const statusSchema = z.enum(["waiting_worker", "generating", "awaiting_import", "partial", "ready", "failed", "cancelled"]);
// These are frontend HTTP views, deliberately independent of the server-only store.
const summarySchema = z.object({
  id: z.uuid(), revision: z.number().int().nonnegative(), status: statusSchema,
  title: z.string(), createdAt: z.string(), updatedAt: z.string(),
});
const projectSchema = summarySchema.omit({ title: true }).extend({
  request: storyboardProductionRequestSchema,
  document: storyboardProductionDocumentSchema.nullable(),
});
const jobSchema = z.object({
  id: z.string().min(1), status: z.enum(["queued", "claimed", "succeeded", "failed", "cancelled"]),
  stage: z.string(), sceneNo: z.number().int().nullable(), errorCode: z.string().nullable(),
  attempts: z.number().int().nonnegative(), lastHeartbeat: z.string().nullable(),
});
const viewSchema = z.object({
  ok: z.literal(true), project: projectSchema, job: jobSchema.nullable(),
  events: z.array(z.unknown()).default([]),
});
const catalogSchema = z.object({
  ok: z.literal(true), projects: z.array(summarySchema),
  workers: z.array(z.object({
    id: z.string(), online: z.boolean(), lastHeartbeat: z.string().nullable(),
    models: z.array(z.object({
      id: z.string(), capabilities: z.array(z.string()), loaded: z.boolean(),
      bytes_on_disk: z.number().nonnegative(), bytes_resident: z.number().nonnegative(),
    })),
  })),
});
const importSchema = z.object({
  schema: z.literal(STORYBOARD_WORKFLOW), projectId: z.uuid(),
  revision: z.number().int().nonnegative(), draft: storyboardDraftSchema,
}).strict();
type Project = z.infer<typeof projectSchema>;
type View = z.infer<typeof viewSchema>;
type Catalog = z.infer<typeof catalogSchema>;
type Model = Catalog["workers"][number]["models"][number];
type ProviderId = StoryboardProvider["id"];
type DraftScene = StoryboardProductionDocument["scenes"][number];

const PROVIDERS: Record<ProviderId, string> = {
  "local-mlx": "로컬 MLX", manual: "수동 가져오기",
  "chatgpt-manual": "ChatGPT 웹 · 수동 가져오기", "grok-manual": "Grok 웹 · 수동 가져오기",
  "openai-api": "OpenAI 공식 API · 설정 전 사용 불가", "xai-api": "xAI 공식 API · 설정 전 사용 불가",
};
const STATUSES: Record<Project["status"], string> = {
  waiting_worker: "로컬 워커 대기", generating: "생성 중", awaiting_import: "가져오기 대기",
  partial: "일부 결과 저장됨", ready: "결과 준비됨", failed: "생성 실패", cancelled: "취소됨",
};
const JOB_STATUSES = { queued: "작업 대기", claimed: "작업 실행 중", succeeded: "작업 종료", failed: "작업 실패", cancelled: "작업 취소" };
const UI_ERRORS: Record<string, string> = {
  request_failed: "요청 상태를 확인하지 못했습니다. 새로고침하여 저장 여부를 확인하세요. 자동 재전송하지 않습니다.",
  invalid_response: "서버 응답 형식을 확인할 수 없습니다. 저장 결과를 새로고침하세요.",
  unavailable: "요청한 프로젝트 또는 로컬 작업 API를 찾을 수 없습니다.",
  unauthorized: "관리자 인증을 확인한 뒤 다시 시도하세요.",
  invalid_request: "요청 내용, 장면 수와 공급자별 모델 선택을 확인하세요.",
  invalid_import: "현재 프로젝트의 schema, projectId, revision과 장면 형식을 확인하세요.",
  clipboard_failed: "클립보드에 복사하지 못했습니다. 브라우저 권한을 확인하세요.",
};
class UiError extends Error {
  constructor(readonly code: string) { super(code); }
}
function message(code: string): string {
  if (Object.hasOwn(UI_ERRORS, code)) return UI_ERRORS[code];
  if (Object.hasOwn(STORYBOARD_PRODUCTION_MESSAGES, code)) return STORYBOARD_PRODUCTION_MESSAGES[code];
  return UI_ERRORS.request_failed;
}
function failure(error: unknown): string {
  return error instanceof UiError ? message(error.code) : UI_ERRORS.request_failed;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
async function response(url: string, signal: AbortSignal, init?: RequestInit): Promise<Response> {
  const result = await fetch(url, {
    ...init, credentials: "same-origin", cache: "no-store", redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (!result.ok) {
    const body = record(await result.json().catch(() => null));
    const code = body.errorCode ?? body.code ?? (typeof body.error === "string" ? body.error : record(body.error).code);
    if (result.status === 401 || result.status === 403) throw new UiError("unauthorized");
    if (result.status === 409) throw new UiError(typeof code === "string" && Object.hasOwn(STORYBOARD_PRODUCTION_MESSAGES, code) ? code : "revision_conflict");
    if (result.status === 404) throw new UiError(typeof code === "string" && Object.hasOwn(STORYBOARD_PRODUCTION_MESSAGES, code) ? code : "unavailable");
    throw new UiError(typeof code === "string" ? code : "request_failed");
  }
  return result;
}
async function json(url: string, signal: AbortSignal, init?: RequestInit): Promise<unknown> {
  const result = await response(url, signal, init);
  const body: unknown = await result.json().catch(() => { throw new UiError("invalid_response"); });
  if (record(body).ok !== true) {
    const code = record(body).errorCode ?? record(body).error;
    throw new UiError(typeof code === "string" ? code : "invalid_response");
  }
  return body;
}
function parseView(value: unknown, id?: string): View {
  const parsed = viewSchema.safeParse(value);
  if (!parsed.success) throw new UiError("invalid_response");
  const { project } = parsed.data;
  if ((id && project.id !== id) || (project.status === "ready" && !project.document)
    || (project.document && (project.document.projectId !== project.id
      || project.document.scenes.length !== project.request.sceneCount
      || project.document.scenes.some((scene, index) => scene.sceneNo !== index + 1)))) {
    throw new UiError("invalid_response");
  }
  return parsed.data;
}
function isActive(view: View | null): boolean {
  return !!view && (view.job?.status === "queued" || view.job?.status === "claimed"
    || view.project.status === "waiting_worker" || view.project.status === "generating");
}
function isLocal(id: ProviderId) { return id === "local-mlx" || id === "manual"; }
function isOfficial(id: ProviderId) { return id === "openai-api" || id === "xai-api"; }
function when(value: string | null | undefined): string {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString("ko-KR") : "시각 정보 없음";
}
function size(bytes: number): string { return `${(bytes / 1024 ** 3).toFixed(1)} GiB`; }
function pickDraft(scene: DraftScene): StoryboardDraftScene {
  const { sceneNo, title, durationSec, description, visualDirection, narration, caption, productionNotes, imagePrompt, sourceIds } = scene;
  return { sceneNo, title, durationSec, description, visualDirection, narration, caption, productionNotes, imagePrompt, sourceIds };
}
function privateAssetUrl(projectId: string, assetId: string, path: string): string | null {
  const basename = path.split("/").at(-1) ?? "";
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,254}$/.test(basename)) return null;
  return `${API}/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}?variant=${encodeURIComponent(basename)}`;
}

function ProviderField({ kind, value, externalAI, models, onChange }: {
  kind: "text" | "image"; value: StoryboardProvider; externalAI: boolean; models: Model[];
  onChange: (provider: StoryboardProvider) => void;
}) {
  const label = kind === "text" ? "텍스트" : "이미지";
  return <fieldset className="min-w-0 space-y-2 rounded-lg border border-border p-3">
    <legend className="px-1 text-sm font-semibold">{label} 공급자</legend>
    <label className="block text-sm" htmlFor={`local-${kind}-provider`}>{label} 생성 방식</label>
    <select id={`local-${kind}-provider`} className={inputClass} value={value.id}
      onChange={(event) => onChange({ id: storyboardProviderSchema.shape.id.parse(event.target.value), model: "" })}>
      {storyboardProviderSchema.shape.id.options.filter((id) => isLocal(id) || isOfficial(id) || externalAI).map((id) =>
        <option key={id} value={id} disabled={isOfficial(id)}>{PROVIDERS[id]}</option>)}
    </select>
    {value.id === "local-mlx" && <div className="text-sm">
      <label className="block" htmlFor={`local-${kind}-model`}>{label} 모델</label>
      <select id={`local-${kind}-model`} className={inputClass} value={value.model} required
        onChange={(event) => onChange({ ...value, model: event.target.value })}>
        <option value="">설치된 모델 선택</option>
        {value.model && !models.some((model) => model.id === value.model) &&
          <option value={value.model} disabled>이전 선택 · 현재 목록에 없음</option>}
        {models.map((model) => <option key={model.id} value={model.id}>
          {model.id} · {model.loaded ? "메모리 로드됨" : "디스크 설치됨"}
        </option>)}
      </select>
      {models.length === 0 && <span className="mt-1 block text-xs text-muted-foreground">이 종류의 설치된 모델이 보고되지 않았습니다.</span>}
    </div>}
  </fieldset>;
}

export function LocalStoryboardWorkspace({ onOpenLegacy }: { onOpenLegacy?: () => void } = {}) {
  const [showSetup, setShowSetup] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>({ ok: true, projects: [], workers: [] });
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [catalogTick, setCatalogTick] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [sceneCount, setSceneCount] = useState(6);
  const [dimensions, setDimensions] = useState("1024x576");
  const [externalAI, setExternalAI] = useState(false);
  const [textProvider, setTextProvider] = useState<StoryboardProvider>({ id: "local-mlx", model: "" });
  const [imageProvider, setImageProvider] = useState<StoryboardProvider>({ id: "local-mlx", model: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const createController = useRef<AbortController | null>(null);
  // Preserve the idempotency key when a user retries an uncertain identical create.
  const createAttempt = useRef<{ fingerprint: string; requestId: string } | null>(null);

  useEffect(() => {
    function readLocation() {
      const id = new URL(window.location.href).searchParams.get(PROJECT_QUERY);
      setProjectId(id && z.uuid().safeParse(id).success ? id : null);
      if (id && !z.uuid().safeParse(id).success) setCreateError(message("invalid_request"));
    }
    readLocation();
    window.addEventListener("popstate", readLocation);
    return () => { window.removeEventListener("popstate", readLocation); createController.current?.abort(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogBusy(true);
    void json(API, controller.signal).then((body) => {
      const parsed = catalogSchema.safeParse(body);
      if (!parsed.success) throw new UiError("invalid_response");
      if (!controller.signal.aborted) { setCatalog(parsed.data); setCatalogError(null); }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setCatalogError(failure(error));
    }).finally(() => { if (!controller.signal.aborted) setCatalogBusy(false); });
    return () => controller.abort();
  }, [catalogTick]);

  const selectProject = useCallback((id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set(PROJECT_QUERY, id); else url.searchParams.delete(PROJECT_QUERY);
    window.history.pushState(window.history.state, "", url);
    setProjectId(id); setShowSetup(false);
  }, []);
  const updateSummary = useCallback((project: Project) => {
    const item = { id: project.id, revision: project.revision, status: project.status,
      title: project.document?.title ?? project.request.prompt.slice(0, 120), createdAt: project.createdAt, updatedAt: project.updatedAt };
    setCatalog((previous) => ({ ...previous, projects: [item, ...previous.projects.filter((entry) => entry.id !== item.id)] }));
  }, []);
  const modelsFor = (capability: "chat" | "image") => {
    const models = new Map<string, Model>();
    for (const worker of catalog.workers) for (const model of worker.models) {
      if (model.bytes_on_disk > 0 && model.capabilities.includes(capability)) models.set(model.id, model);
    }
    return [...models.values()];
  };
  const textModels = modelsFor("chat");
  const imageModels = modelsFor("image");

  async function create(event: FormEvent) {
    event.preventDefault();
    if (createController.current) return;
    setCreateError(null);
    const [imageWidth, imageHeight] = dimensions.split("x").map(Number);
    const fields = { workflow: STORYBOARD_WORKFLOW, prompt, sceneCount, providers: { externalAI, text: textProvider, image: imageProvider },
      retrieval: "none", sources: [], imageWidth, imageHeight };
    const fingerprint = JSON.stringify(fields);
    if (createAttempt.current?.fingerprint !== fingerprint) createAttempt.current = { fingerprint, requestId: crypto.randomUUID() };
    const parsed = storyboardProductionRequestSchema.safeParse({ ...fields, requestId: createAttempt.current.requestId });
    if (!parsed.success) { setCreateError(message("invalid_request")); return; }
    try {
      assertStoryboardProviderPolicy(parsed.data.providers);
      for (const [provider, models] of [[textProvider, textModels], [imageProvider, imageModels]] as const) {
        if (isOfficial(provider.id)) throw new UiError("provider_not_configured");
        if (provider.id === "local-mlx" && !models.some((model) => model.id === provider.model)) throw new UiError("model_not_installed");
      }
    } catch { setCreateError(message("invalid_request")); return; }
    const controller = new AbortController();
    createController.current = controller;
    setCreating(true);
    try {
      const next = parseView(await json(API, controller.signal, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
      }));
      if (!controller.signal.aborted) {
        createAttempt.current = null;
        updateSummary(next.project);
        selectProject(next.project.id);
      }
    } catch (error) { if (!controller.signal.aborted) setCreateError(failure(error)); }
    finally { if (!controller.signal.aborted) { createController.current = null; setCreating(false); } }
  }

  return <section aria-labelledby="local-storyboard-title" data-local-storyboard-workspace="true"
    className="h-full min-h-0 min-w-0 overflow-y-auto bg-background p-4 pb-24 text-foreground sm:p-6 sm:pb-8">
    <header className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id="local-storyboard-title" className="text-xl font-semibold tracking-tight">스토리보드</h2>
        <p className="mt-1 hidden text-sm text-muted-foreground sm:block">장면을 만들고, 흐름을 다듬고, 영상으로 준비하세요.</p>
      </div>
      <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 sm:w-auto">
        <label className="sr-only" htmlFor="local-project-select">프로젝트 선택</label>
        <select id="local-project-select" className={`${inputClass} !mt-0 sm:max-w-56`} value={projectId ?? ""}
          onChange={(event) => selectProject(event.target.value || null)}>
          <option value="">새 프로젝트</option>
          {catalog.projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <button type="button" className={buttonClass} aria-expanded={showSetup} onClick={() => setShowSetup((value) => !value)}>연결 설정</button>
        <button type="button" className={`${buttonClass} !border-primary !bg-primary !text-primary-foreground`} onClick={() => selectProject(null)}>새 프로젝트</button>
      </div>
    </header>
    <div className={`grid min-w-0 items-start gap-6 ${projectId && showSetup ? "lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]" : ""}`}>
      {(!projectId || showSetup) && <aside className={`min-w-0 space-y-4 ${!projectId ? "mx-auto w-full max-w-4xl" : ""}`} aria-label="프로젝트 설정과 기록">
        {!projectId && <form className={panelClass} onSubmit={create} aria-labelledby="local-request-title">
          <h3 id="local-request-title" className="font-semibold">새 제작 요청</h3>
          <p className="mb-5 mt-1 text-sm text-muted-foreground">영상의 주제와 분위기를 알려주세요. 생성 후 장면별로 편집할 수 있습니다.</p>
          <fieldset disabled={creating} className="min-w-0 space-y-4">
            <div className="text-sm">
              <label className="block" htmlFor="local-storyboard-prompt">제작 요청</label>
              <textarea id="local-storyboard-prompt" className={inputClass} rows={4} required maxLength={8000}
                placeholder="예: 매운 짜장라면 맛집 탐방. 가게 소개부터 첫 입, 맛 평가까지 생동감 있는 먹방 영상으로 구성해 주세요."
                value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="text-sm">
                <label className="block" htmlFor="local-scene-count">장면 수 (5–12)</label>
                <input id="local-scene-count" className={inputClass} type="number" min={5} max={12} step={1} required
                  value={sceneCount} onChange={(event) => setSceneCount(event.target.valueAsNumber)} />
              </div>
              <div className="text-sm">
                <label className="block" htmlFor="local-image-size">이미지 크기</label>
                <select id="local-image-size" className={inputClass} value={dimensions} onChange={(event) => setDimensions(event.target.value)}>
                  <option value="1024x576">1024 × 576</option><option value="576x1024">576 × 1024</option><option value="1024x1024">1024 × 1024</option>
                </select>
              </div>
            </div>
            <label className="flex min-h-11 items-start gap-2 text-sm" htmlFor="local-external-ai">
              <input id="local-external-ai" type="checkbox" className="mt-1 size-4 shrink-0" checked={externalAI}
                aria-describedby="local-external-help" onChange={(event) => {
                  const enabled = event.target.checked;
                  setExternalAI(enabled);
                  if (!enabled) {
                    if (!isLocal(textProvider.id)) setTextProvider({ id: "manual", model: "" });
                    if (!isLocal(imageProvider.id)) setImageProvider({ id: "manual", model: "" });
                  }
                }} />
              외부 AI 사용 허용 (웹은 직접 열고 결과 가져오기)
            </label>
            <p id="local-external-help" className="text-xs text-muted-foreground">기본은 로컬 생성입니다. 외부 웹 결과는 직접 가져오며, 공식 API는 아직 사용할 수 없습니다.</p>
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <ProviderField kind="text" value={textProvider} externalAI={externalAI} models={textModels} onChange={setTextProvider} />
              <ProviderField kind="image" value={imageProvider} externalAI={externalAI} models={imageModels} onChange={setImageProvider} />
            </div>
            <button className={`${buttonClass} w-full !border-primary !bg-primary !text-primary-foreground sm:w-auto sm:min-w-48`} type="submit" disabled={creating}>
              {creating ? "저장 요청 중…" : "프로젝트 만들기"}
            </button>
          </fieldset>
          {createError && <p role="alert" className="mt-3 text-sm text-destructive">{createError}</p>}
        </form>}
        {projectId && <label className="flex min-h-11 items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={externalAI} onChange={(event) => setExternalAI(event.target.checked)} />
          외부 AI 사용 허용 (수동 결과 가져오기)
        </label>}
        {showSetup && <section className={panelClass} aria-labelledby="local-workers-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="local-workers-title" className="font-semibold">로컬 워커</h3>
            <button type="button" className={buttonClass} disabled={catalogBusy} onClick={() => setCatalogTick((value) => value + 1)}>목록 새로고침</button>
          </div>
          {catalogBusy && <p role="status" className="mt-2 text-sm">목록 확인 중…</p>}
          {catalogError && <p role="alert" className="mt-2 text-sm text-destructive">{catalogError}</p>}
          {!catalogBusy && !catalogError && catalog.workers.length === 0 && <p className="mt-2 text-sm text-muted-foreground">보고된 로컬 워커가 없습니다. 수동 가져오기는 사용할 수 있습니다.</p>}
          {catalog.workers.map((worker) => <div key={worker.id} className="mt-3 break-words text-sm [overflow-wrap:anywhere]">
            <p className="font-medium">{worker.online ? "Mac 워커 연결됨" : "Mac 워커 연결 끊김"}</p>
            <p className="text-xs text-muted-foreground">마지막 연결: {when(worker.lastHeartbeat)}</p>
            {worker.models.map((model) => <p key={model.id} className="mt-1 text-xs text-muted-foreground">
              {model.id} · 디스크 {size(model.bytes_on_disk)} · 메모리 {size(model.bytes_resident)} · {model.loaded ? "로드됨" : "미로드"}
            </p>)}
          </div>)}
        </section>}
        {showSetup && onOpenLegacy && <button type="button" className="min-h-11 text-sm text-muted-foreground underline underline-offset-4" onClick={onOpenLegacy}>이전 작업 공간 열기</button>}
      </aside>}
      {projectId && <SavedProjectWorkspace key={projectId} projectId={projectId} externalAI={externalAI} onProject={updateSummary} />}
    </div>
  </section>;
}

function SavedProjectWorkspace({ projectId, externalAI, onProject }: {
  projectId: string; externalAI: boolean; onProject: (project: Project) => void;
}) {
  const [view, setView] = useState<View | null>(null);
  const [workspaceView, setWorkspaceView] = useState<"scenes" | "history" | "import">("scenes");
  const [selectedScene, setSelectedScene] = useState(1);
  const [readTick, setReadTick] = useState(0);
  const [readError, setReadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [needsReadback, setNeedsReadback] = useState(false);
  const [importText, setImportText] = useState("");
  const [editing, setEditing] = useState<{ draft: StoryboardDraftScene; revision: number } | null>(null);
  const readController = useRef<AbortController | null>(null);
  const writeController = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const editReturnFocus = useRef<{ sceneNo: number; waiting: boolean } | null>(null);
  const endpoint = `${API}/${encodeURIComponent(projectId)}`;

  const stopReading = useCallback(() => {
    readController.current?.abort();
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    readController.current = controller;
    setLoading(true);
    async function load() {
      try {
        const next = parseView(await json(endpoint, controller.signal), projectId);
        if (controller.signal.aborted) return;
        setView(next); onProject(next.project); setReadError(null); setNeedsReadback(false);
        if (isActive(next)) timer.current = setTimeout(() => { void load(); }, POLL_MS);
      } catch (error) {
        if (!controller.signal.aborted) setReadError(failure(error));
        // A failed read stops polling; an explicit refresh resumes it.
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return stopReading;
  }, [endpoint, projectId, readTick, onProject, stopReading]);
  useEffect(() => () => writeController.current?.abort(), []);
  const loadedId = view?.project.id;
  useEffect(() => { if (loadedId) heading.current?.focus({ preventScroll: true }); }, [loadedId]);

  const active = isActive(view);
  const locked = busy || active || needsReadback || !!readError;
  const providers = view ? [view.project.request.providers.text, view.project.request.providers.image] : [];
  const generationBlocked = providers.some((provider) => isOfficial(provider.id) || (!externalAI && !isLocal(provider.id)));
  // The server refuses a retry once every scene has a stored image (nothing_to_retry).
  const scenesComplete = !!view?.project.document
    && view.project.document.scenes.every((scene) => !!scene.image && !scene.imageError);

  useEffect(() => {
    const pending = editReturnFocus.current;
    if (editing || !pending) return;
    // Keep a usable focus target while readback disables the edit trigger.
    // A later response must not override navigation made during that wait.
    if (pending.waiting && document.activeElement !== heading.current) {
      editReturnFocus.current = null;
      return;
    }
    if (locked) {
      heading.current?.focus({ preventScroll: true });
      pending.waiting = true;
      return;
    }
    const target = document.getElementById(`local-edit-${pending.sceneNo}`);
    (target ?? heading.current)?.focus({ preventScroll: pending.waiting });
    editReturnFocus.current = null;
  }, [editing, locked]);

  async function mutate(body: Record<string, unknown> | FormData, suffix = ""): Promise<boolean> {
    if (!view || writeController.current || needsReadback || readError) return false;
    const controller = new AbortController();
    writeController.current = controller;
    stopReading(); setBusy(true); setWriteError(null); setNotice("");
    let saved = false;
    try {
      const next = parseView(await json(endpoint + suffix, controller.signal, {
        method: "POST", ...(body instanceof FormData ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      }), projectId);
      if (!controller.signal.aborted) {
        setView((previous) => ({ ...next, events: previous?.events ?? next.events }));
        onProject(next.project); setNotice("서버에 변경 사항을 저장했습니다."); saved = true;
      }
    } catch (error) { if (!controller.signal.aborted) setWriteError(failure(error)); }
    finally {
      if (!controller.signal.aborted) {
        writeController.current = null; setBusy(false); setNeedsReadback(true);
        setReadTick((value) => value + 1);
      }
    }
    return saved;
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice("현재 프로젝트와 버전의 프롬프트를 복사했습니다."); setWriteError(null); }
    catch { setWriteError(message("clipboard_failed")); }
  }
  async function importDraft(event: FormEvent) {
    event.preventDefault();
    if (!view || locked) return;
    try {
      if (new TextEncoder().encode(importText).byteLength > MAX_STORYBOARD_DOCUMENT_BYTES) throw new UiError("invalid_import");
      const envelope = importSchema.parse(JSON.parse(importText));
      if (envelope.projectId !== projectId || envelope.revision !== view.project.revision) throw new UiError("invalid_import");
      parseStoryboardDraft(envelope.draft, view.project.request);
      if (await mutate({ action: "import-text", ...envelope })) setImportText("");
    } catch { setWriteError(message("invalid_import")); }
  }
  async function importImage(sceneNo: number, file: File): Promise<boolean> {
    if (!view || locked) return false;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size === 0) { setWriteError(message("invalid_image")); return false; }
    if (file.size > MAX_STORYBOARD_IMAGE_BYTES) { setWriteError(message("image_too_large")); return false; }
    const body = new FormData();
    body.set("revision", String(view.project.revision)); body.set("sceneNo", String(sceneNo));
    body.set("projectId", projectId); body.set("schema", STORYBOARD_WORKFLOW); body.set("file", file);
    return mutate(body, "/images");
  }
  async function download() {
    if (writeController.current) return;
    const controller = new AbortController();
    writeController.current = controller; setBusy(true); setWriteError(null);
    try {
      const result = await response(`${endpoint}/export`, controller.signal);
      if (!result.headers.get("content-type")?.includes("application/json")) throw new UiError("invalid_response");
      const blob = await result.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `storyboard-${projectId}.json`;
      document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      setNotice("파일과 해시를 포함한 JSON 다운로드를 요청했습니다.");
    } catch (error) { if (!controller.signal.aborted) setWriteError(failure(error)); }
    finally { if (!controller.signal.aborted) { writeController.current = null; setBusy(false); } }
  }
  function finishEdit() {
    if (editing) editReturnFocus.current = { sceneNo: editing.draft.sceneNo, waiting: false };
    setEditing(null);
  }
  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing || locked) return;
    const parsed = storyboardDraftSceneSchema.safeParse(editing.draft);
    if (!parsed.success) { setWriteError(message("invalid_request")); return; }
    if (await mutate({ action: "edit", revision: editing.revision, sceneNo: parsed.data.sceneNo, scene: parsed.data })) finishEdit();
  }

  return <section className="min-w-0 space-y-4" aria-label="저장된 스토리보드">
    <div className={panelClass}>
      <div className="flex min-w-0 flex-col items-start justify-between gap-3 sm:flex-row">
        <div className="min-w-0 flex-1">
          <h3 ref={heading} tabIndex={-1} className="break-words text-lg font-semibold [overflow-wrap:anywhere]">
            {view?.project.document?.title ?? (view ? "저장된 제작 요청" : "프로젝트 불러오기")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{view && `버전 ${view.project.revision} · ${when(view.project.updatedAt)} 저장`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={busy || loading} onClick={() => setReadTick((value) => value + 1)}>새로고침</button>
          {view && <button type="button" className={buttonClass} disabled={busy || !view.project.document} onClick={() => { void download(); }}>내보내기</button>}
        </div>
      </div>
      <div aria-live="polite" role="status" className="mt-3 text-sm">
        {loading && !view ? "저장된 결과 확인 중…" : view ? STATUSES[view.project.status] : "아직 저장 결과를 확인하지 못했습니다."}
        {busy && " · 요청 처리 중…"}{notice && <p className="mt-1">{notice}</p>}
      </div>
      {readError && <p role="alert" className="mt-2 text-sm text-destructive">{readError}</p>}
      {writeError && <p role="alert" className="mt-2 text-sm text-destructive">{writeError}</p>}
      {view?.job?.errorCode && <p role="alert" className="mt-2 text-sm text-destructive">{message(view.job.errorCode)}</p>}
      {view && <>
        <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">제작 요청과 모델 정보</summary><p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{view.project.request.prompt}</p>
        <p className="mt-2 text-xs text-muted-foreground">텍스트: {PROVIDERS[view.project.request.providers.text.id]} · 이미지: {PROVIDERS[view.project.request.providers.image.id]}</p>
        {view.job && <p className="mt-2 text-xs text-muted-foreground">
          {JOB_STATUSES[view.job.status]} · 시도 {view.job.attempts}회{view.job.sceneNo !== null && ` · 장면 ${view.job.sceneNo}`} · 마지막 연결 {when(view.job.lastHeartbeat)}
        </p>}
        {view.project.document && <p className="mt-2 text-xs text-muted-foreground">텍스트 출처: <Provenance value={view.project.document.textProvenance} /></p>}
        </details>
        <div className="mt-3 flex flex-wrap gap-2">
          {active && <button type="button" className={buttonClass} disabled={busy || !view.job || !active || needsReadback || !!readError}
            onClick={() => { if (view.job) void mutate({ action: "cancel", revision: view.project.revision, jobId: view.job.id }); }}>작업 취소</button>}
          {!scenesComplete && <button type="button" className={buttonClass}
            disabled={locked || generationBlocked || scenesComplete
              || !["failed", "cancelled", "partial", "waiting_worker"].includes(view.project.status)}
            onClick={() => { void mutate({ action: "retry", revision: view.project.revision, requestId: crypto.randomUUID() }); }}>재시도</button>}
        </div>
        {generationBlocked && <p className="mt-2 text-sm text-muted-foreground">이 프로젝트의 외부 공급자를 사용하려면 외부 AI 사용을 명시적으로 허용해야 합니다. 미설정 공식 API는 사용할 수 없습니다.</p>}
        {active && <p className="mt-2 text-sm text-muted-foreground">작업이 실행되거나 워커를 기다리는 동안 편집과 가져오기를 잠급니다. 이 화면을 닫아도 서버 작업은 취소되지 않습니다.</p>}
      </>}
    </div>
    {view && <>
      <nav aria-label="스토리보드 작업" className="flex gap-1 border-b border-border/60">
        {([["scenes", "장면 편집"], ["history", "버전 이력"], ["import", "결과 가져오기"]] as const).map(([id, label]) =>
          <button key={id} type="button" disabled={!!editing || busy} aria-current={workspaceView === id ? "page" : undefined}
            className={`min-h-11 px-3 py-2 text-sm ${workspaceView === id ? "border-b-2 border-primary font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setWorkspaceView(id)}>{label}</button>)}
      </nav>
      {workspaceView === "history" && <VersionHistory key={`${projectId}:${view.project.revision}`} projectId={projectId}
        revision={view.project.revision} disabled={locked || !!editing || !view.project.document} onRestore={mutate} />}
      {workspaceView === "import" && <section className={panelClass} aria-labelledby="local-import-title">
        <h3 id="local-import-title" className="font-semibold">수동 결과 가져오기</h3>
        <p className="mt-1 text-sm text-muted-foreground">현재 프로젝트와 버전에 맞는 JSON을 가져옵니다. 웹 구독의 결과는 사용자 가져오기로 표시하며 모델 실행을 검증한 것으로 표시하지 않습니다.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={() => { void copy([
            buildStoryboardDraftPrompt(view.project.request),
            "위 초안을 draft에 넣은 envelope JSON 하나를 반환하세요. 다음 식별자와 revision을 그대로 사용하세요.",
            JSON.stringify({ schema: STORYBOARD_WORKFLOW, projectId, revision: view.project.revision }),
            "envelope의 JSON Schema:", JSON.stringify(z.toJSONSchema(importSchema)),
          ].join("\n")); }}>현재 텍스트 프롬프트 복사</button>
          {externalAI && <>
            <button type="button" className={buttonClass} onClick={() => window.open("https://chatgpt.com", "_blank", "noopener,noreferrer")}>ChatGPT 웹 직접 열기</button>
            <button type="button" className={buttonClass} onClick={() => window.open("https://grok.com", "_blank", "noopener,noreferrer")}>Grok 웹 직접 열기</button>
          </>}
        </div>
        <form onSubmit={importDraft} className="mt-3">
          <label className="block text-sm" htmlFor="local-draft-import">버전이 포함된 JSON (schema, projectId, revision, draft)</label>
          <textarea id="local-draft-import" className={`${inputClass} font-mono text-xs`} rows={5} disabled={locked}
            value={importText} onChange={(event) => setImportText(event.target.value)} maxLength={MAX_STORYBOARD_DOCUMENT_BYTES} spellCheck={false} />
          <button type="submit" className={`${buttonClass} mt-2`} disabled={locked || !importText.trim()}>텍스트 가져오기</button>
        </form>
      </section>}
      {workspaceView === "scenes" && (view.project.document ? <section aria-labelledby="local-scenes-title" className="min-w-0 space-y-3">
        <div className="px-1">
          <h3 id="local-scenes-title" className="font-semibold">저장된 장면 {view.project.document.scenes.length}개 · 이미지 {view.project.document.scenes.filter((scene) => scene.image).length}개</h3>
          <details className="mt-1 text-sm text-muted-foreground"><summary className="cursor-pointer">전체 줄거리</summary><p className="mt-2 break-words [overflow-wrap:anywhere]">{view.project.document.logline}</p></details>
        </div>
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
          <nav aria-label="장면 선택" className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
            {view.project.document.scenes.map((scene) => <button key={scene.sceneNo} type="button"
              className={`w-36 shrink-0 rounded-lg p-2 text-left transition-colors lg:w-full ${selectedScene === scene.sceneNo ? "bg-muted ring-1 ring-primary/60" : "hover:bg-muted/60"}`}
              aria-label={`장면 ${scene.sceneNo} 선택`} aria-current={selectedScene === scene.sceneNo ? "step" : undefined}
              disabled={!!editing} onClick={() => setSelectedScene(scene.sceneNo)}>
              {scene.image && <SceneThumbnail asset={scene.image} projectId={projectId} />}
              <span className="mt-2 block truncate text-sm font-medium">{String(scene.sceneNo).padStart(2, "0")} · {scene.title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{scene.durationSec}초 · {scene.imageError ? "이미지 오류" : scene.image ? "이미지 저장됨" : "이미지 대기"}</span>
            </button>)}
          </nav>
          {view.project.document.scenes.filter((scene) => scene.sceneNo === selectedScene).map((scene) => <article className={panelClass} key={scene.sceneNo} aria-labelledby={`local-scene-${scene.sceneNo}`}>
            <h4 id={`local-scene-${scene.sceneNo}`} className="break-words font-semibold [overflow-wrap:anywhere]">{scene.sceneNo}. {scene.title}</h4>
            <p className="mb-3 text-xs text-muted-foreground">{scene.durationSec}초 · 장면 v{scene.revision}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button id={`local-edit-${scene.sceneNo}`} type="button" className={buttonClass} disabled={locked || !!editing}
                onClick={() => setEditing({ draft: pickDraft(scene), revision: view.project.revision })} aria-label={`장면 ${scene.sceneNo} 편집`}>편집</button>
              <button type="button" className={buttonClass} disabled={locked || generationBlocked || !!editing} aria-label={`장면 ${scene.sceneNo} 재생성`}
                onClick={() => { void mutate({ action: "regenerate", revision: view.project.revision, sceneNo: scene.sceneNo, requestId: crypto.randomUUID() }); }}>장면 재생성</button>
              <button type="button" className={buttonClass} aria-label={`장면 ${scene.sceneNo} 이미지 프롬프트 복사`}
                onClick={() => { void copy(`${JSON.stringify({ schema: STORYBOARD_WORKFLOW, projectId, revision: view.project.revision, sceneNo: scene.sceneNo })}\n${scene.imagePrompt}`); }}>이미지 프롬프트 복사</button>
            </div>
            <div className="mt-4 grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="min-w-0">
            {scene.image ? <AssetImage key={`${scene.image.id}-${scene.image.original.sha256}`} asset={scene.image} projectId={projectId} title={scene.title} />
              : <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">저장된 이미지 없음</div>}
            {scene.imageError && <p role="alert" className="mt-2 text-sm text-destructive">{message(scene.imageError)}</p>}
            </div>
            <div className="min-w-0">
            {!editing && <dl className="grid gap-4 break-words text-sm [overflow-wrap:anywhere]">
              {[["장면 설명", scene.description], ["촬영 방향", scene.visualDirection], ["내레이션", scene.narration], ["자막", scene.caption], ["제작 메모", scene.productionNotes.join("\n")]].map(([label, value]) =>
                <div key={label}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap text-muted-foreground">{value || "없음"}</dd></div>)}
            </dl>}
            {editing?.draft.sceneNo === scene.sceneNo && <form onSubmit={saveEdit} className="mt-3" aria-label={`장면 ${scene.sceneNo} 편집 양식`}
              onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); finishEdit(); } }}>
              <fieldset disabled={locked} className="space-y-2">
                {(["title", "description", "visualDirection", "narration", "caption", "imagePrompt"] as const).map((field) => {
                  const labels = { title: "장면 제목", description: "장면 설명", visualDirection: "촬영 방향", narration: "내레이션", caption: "자막", imagePrompt: "이미지 프롬프트" };
                  return <div key={field} className="text-sm">
                    <label className="block" htmlFor={`local-edit-${scene.sceneNo}-${field}`}>{labels[field]}</label>
                    <textarea id={`local-edit-${scene.sceneNo}-${field}`} className={inputClass} rows={field === "title" ? 1 : 3}
                      autoFocus={field === "title"} value={editing.draft[field]}
                      onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, [field]: event.target.value } })} />
                  </div>;
                })}
                <label className="block text-sm" htmlFor={`local-duration-${scene.sceneNo}`}>장면 길이 (초)</label>
                <input id={`local-duration-${scene.sceneNo}`} className={inputClass} type="number" min={1} max={600} required value={editing.draft.durationSec}
                  onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, durationSec: event.target.valueAsNumber } })} />
                <label className="block text-sm" htmlFor={`local-notes-${scene.sceneNo}`}>제작 메모 (줄마다 하나)</label>
                <textarea id={`local-notes-${scene.sceneNo}`} className={inputClass} rows={3} value={editing.draft.productionNotes.join("\n")}
                  onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, productionNotes: event.target.value.split("\n") } })} />
                {editing.revision !== view.project.revision && <p role="alert" className="text-sm text-destructive">편집을 시작한 뒤 버전이 변경되었습니다. 내용을 복사한 후 편집을 닫고 최신 장면에서 다시 시작하세요.</p>}
                <button type="submit" className={buttonClass} disabled={editing.revision !== view.project.revision}>장면 저장</button>
              </fieldset>
              <button type="button" className={`${buttonClass} mt-2`} disabled={busy} onClick={finishEdit}>편집 닫기</button>
            </form>}
            <details className="mt-4 border-t border-border/50 pt-3">
              <summary className="cursor-pointer text-sm text-muted-foreground">이미지 파일 가져오기</summary>
              <ImageImport sceneNo={scene.sceneNo} disabled={locked || !!editing} onImport={importImage} />
            </details>
            </div>
            </div>
          </article>)}
        </div>
      </section> : <div className={panelClass}><p className="text-sm text-muted-foreground">저장된 장면이 아직 없습니다. 워커 결과를 기다리거나 현재 버전의 초안을 가져오세요.</p></div>)}
      {workspaceView === "history" && <section className={panelClass} aria-labelledby="local-events-title">
        <h3 id="local-events-title" className="font-semibold">프로젝트 변경 이력</h3>
        {view.events.length === 0 && <p className="mt-2 text-sm text-muted-foreground">서버에서 제공한 이력이 없습니다.</p>}
        <ol className="mt-2 space-y-2">{view.events.map((raw, index) => {
          const event = record(raw);
          const labels: Record<string, string> = { create: "프로젝트 생성", created: "프로젝트 생성", edit: "장면 편집", edited: "장면 편집", regenerate: "장면 재생성 요청", retry: "재시도 요청", cancel: "취소 요청", "import-text": "텍스트 가져오기", "import-image": "이미지 가져오기", failed: "작업 실패", succeeded: "작업 종료", restored: "과거 버전 복원", queued: "작업 대기", claimed: "작업 점유", draft_saved: "초안 저장", image_saved: "이미지 저장", scene_failed: "장면 실패", cancelled: "작업 취소", lease_expired: "작업 소유권 만료", finished: "작업 종료" };
          const kind = String(event.operation ?? event.action ?? event.type ?? "");
          return <li key={index} className="text-sm">
            {Object.hasOwn(labels, kind) ? labels[kind] : "프로젝트 업데이트"}
            {typeof event.revision === "number" && Number.isSafeInteger(event.revision) && ` · v${event.revision}`}
            <span className="ml-2 text-xs text-muted-foreground">{when(typeof event.createdAt === "string" ? event.createdAt : null)}</span>
          </li>;
        })}</ol>
      </section>}
    </>}
  </section>;
}

const versionsSchema = z.object({
  ok: z.literal(true),
  versions: z.array(z.object({ revision: z.number().int().nonnegative(), createdAt: z.string(),
    title: z.string(), sceneCount: z.number().int().min(0).max(12) })).max(200),
  preview: storyboardProductionDocumentSchema.nullable(),
});

function VersionHistory({ projectId, revision, disabled, onRestore }: {
  projectId: string; revision: number; disabled: boolean;
  onRestore: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [history, setHistory] = useState<z.infer<typeof versionsSchema> | null>(null);
  const [target, setTarget] = useState("");
  const [sceneNo, setSceneNo] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError(null); setHistory(null); setConfirmed(false);
      try {
        const query = target ? `&targetRevision=${encodeURIComponent(target)}` : "";
        const parsed = versionsSchema.safeParse(await json(`${API}/${projectId}?versions=1${query}`, controller.signal));
        if (!parsed.success || (target && (!parsed.data.preview || parsed.data.preview.projectId !== projectId
          || parsed.data.preview.revision !== Number(target)))) throw new UiError("invalid_response");
        if (!controller.signal.aborted) setHistory(parsed.data);
      } catch (cause) { if (!controller.signal.aborted) setError(failure(cause)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [projectId, target, refresh]);
  const preview = history?.preview;
  return <section className={panelClass} aria-labelledby="local-version-title">
    <h3 id="local-version-title" className="font-semibold">과거 버전 복원</h3>
    <p className="mt-1 text-sm text-muted-foreground">저장된 이력부터 복원할 수 있습니다. 복원 전 상태도 새 이력으로 남습니다.</p>
    {loading && <p role="status" className="mt-2 text-sm">버전 불러오는 중…</p>}
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    <button type="button" className={`${buttonClass} mt-2`} disabled={loading} onClick={() => setRefresh((value) => value + 1)}>버전 목록 새로고침</button>
    {history && <>
      <label htmlFor="local-history-version" className="mt-3 block text-sm">저장된 버전</label>
      <select id="local-history-version" className={inputClass} value={target} disabled={disabled || loading}
        onChange={(event) => { setTarget(event.target.value); setSceneNo(""); setConfirmed(false); setHistory(null); }}>
        <option value="">복원할 버전 선택</option>
        {history.versions.map((version) => <option key={version.revision} value={version.revision} disabled={version.revision >= revision}>
          v{version.revision} · {version.title} · {version.sceneCount}장면 · {when(version.createdAt)}
        </option>)}
      </select>
      {!history.versions.some((version) => version.revision < revision) && <p className="mt-2 text-sm text-muted-foreground">아직 이전에 저장된 버전이 없습니다.</p>}
    </>}
    {preview && <>
      <h4 className="mt-3 font-medium">v{target} 미리보기 · {preview.title}</h4>
      <label htmlFor="local-history-scene" className="mt-2 block text-sm">복원 범위</label>
      <select id="local-history-scene" className={inputClass} value={sceneNo} disabled={disabled}
        onChange={(event) => { setSceneNo(event.target.value); setConfirmed(false); }}>
        <option value="">프로젝트 전체</option>
        {preview.scenes.map((scene) => <option key={scene.sceneNo} value={scene.sceneNo}>장면 {scene.sceneNo} · {scene.title}</option>)}
      </select>
      <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
        {preview.scenes.filter((scene) => !sceneNo || scene.sceneNo === Number(sceneNo)).map((scene) => <article key={scene.sceneNo} className="min-w-0">
          <h5 className="break-words text-sm font-medium">장면 {scene.sceneNo} · {scene.title}</h5>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{scene.description}</p>
          {scene.image && <AssetImage key={scene.image.id} asset={scene.image} projectId={projectId} title={scene.title} />}
        </article>)}
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={confirmed} disabled={disabled}
          onChange={(event) => setConfirmed(event.target.checked)} />
        모델을 호출하지 않고 선택한 버전의 텍스트와 원본 이미지를 새 버전으로 저장합니다. 현재 공급자 설정은 유지합니다.
      </label>
      <button type="button" className={`${buttonClass} mt-3`} disabled={disabled || loading || !confirmed}
        onClick={() => { setConfirmed(false); void onRestore({ action: "restore", revision, targetRevision: Number(target),
          requestId: crypto.randomUUID(), ...(sceneNo ? { sceneNo: Number(sceneNo) } : {}) }); }}>
        {sceneNo ? `장면 ${sceneNo} 복원` : "프로젝트 전체 복원"}
      </button>
    </>}
  </section>;
}

function SceneThumbnail({ asset, projectId }: { asset: StoryboardProductionAsset; projectId: string }) {
  const variant = asset.web[0] ?? asset.original;
  const url = privateAssetUrl(projectId, asset.id, variant.path);
  return url ? (
    // Authenticated private thumbnails bypass the public image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" width={variant.width} height={variant.height} className="aspect-video w-full rounded-md object-cover" loading="lazy" />
  ) : null;
}

function Provenance({ value }: { value: StoryboardProductionAsset["provenance"] }) {
  const labels = { "local-worker": "로컬 워커", "official-api": "공식 API", "user-import": "사용자 가져오기" };
  return <span className="break-words [overflow-wrap:anywhere]">{labels[value.verification]} · {value.model || "모델 정보 없음"}{value.modelEvidence === "unverified" ? " · 모델 미검증" : ""}</span>;
}
function AssetImage({ asset, projectId, title }: { asset: StoryboardProductionAsset; projectId: string; title: string }) {
  const [failed, setFailed] = useState(false);
  const variants = asset.web.flatMap((variant) => {
    const url = privateAssetUrl(projectId, asset.id, variant.path);
    return url ? [{ ...variant, url }] : [];
  }).sort((a, b) => a.width - b.width);
  const source = variants.at(-1)?.url ?? privateAssetUrl(projectId, asset.id, asset.original.path);
  return <figure className="min-w-0">
    {source && !failed ? (
      // Authenticated private variants must bypass Next's public image optimizer.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={source} srcSet={variants.map((variant) => `${variant.url} ${variant.width}w`).join(", ") || undefined}
        sizes="(min-width: 1024px) calc(100vw - 400px), calc(100vw - 64px)"
        width={asset.original.width} height={asset.original.height} alt={title} loading="lazy" decoding="async"
        className="max-h-[440px] w-full rounded-lg bg-muted object-contain" onError={() => setFailed(true)} />
    ) : <p role="alert" className="rounded-lg border border-dashed border-border p-4 text-sm">저장된 이미지를 불러오지 못했습니다. 프로젝트를 새로고침하세요.</p>}
    <figcaption className="mt-1 text-xs text-muted-foreground"><Provenance value={asset.provenance} /></figcaption>
  </figure>;
}
function ImageImport({ sceneNo, disabled, onImport }: {
  sceneNo: number; disabled: boolean; onImport: (sceneNo: number, file: File) => Promise<boolean>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  return <form className="mt-3 min-w-0" aria-label={`장면 ${sceneNo} 이미지 가져오기`} onSubmit={async (event) => {
    event.preventDefault();
    if (!disabled && file && await onImport(sceneNo, file)) { setFile(null); if (input.current) input.current.value = ""; }
  }}>
    <label htmlFor={`local-image-${sceneNo}`} className="block text-sm">장면 {sceneNo} 이미지 파일 (PNG/JPEG/WebP, 최대 12 MiB)</label>
    <input ref={input} id={`local-image-${sceneNo}`} type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled}
      className={`${inputClass} text-xs file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-foreground`}
      onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
    <button type="submit" className={`${buttonClass} mt-2`} disabled={disabled || !file} aria-label={`장면 ${sceneNo} 이미지 가져오기 적용`}>이미지 가져오기 적용</button>
  </form>;
}

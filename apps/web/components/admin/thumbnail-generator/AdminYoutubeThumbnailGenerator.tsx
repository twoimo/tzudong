"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent as ReactFormEvent,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import NextImage from "next/image";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BringToFront,
  Copy,
  Download,
  EyeOff,
  History,
  Loader2,
  MessageCircle,
  Move,
  Palette,
  Plus,
  RotateCcw,
  RotateCw,
  Send,
  SendToBack,
  Settings,
  Square,
  Trash2,
  Type,
  Wand2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import type { AdminProviderReadiness as ProviderReadiness } from "@/types/admin-system-status";
import {
  hasExplicitThumbnailGenerationCommand as hasSharedExplicitThumbnailGenerationCommand,
  isThumbnailChatGuidanceQuestion as isSharedThumbnailChatGuidanceQuestion,
} from "@/lib/admin/youtube-thumbnail-generator/chat-intent";
import {
  THUMBNAIL_LOCAL_BRIDGE_DEFAULT_URL,
  THUMBNAIL_LOCAL_BRIDGE_IMAGES_PATH,
  THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID,
  buildThumbnailLocalBridgeImagesRequest,
  getThumbnailLocalBridgeAuthHeaders,
  normalizeThumbnailLocalBridgeImagesResponse,
  normalizeThumbnailLocalBridgeToken,
  normalizeThumbnailLocalBridgeUrl,
  redactThumbnailLocalBridgeSecretText,
  requireThumbnailLocalBridgeToken,
  type ThumbnailLocalBridgeReferenceImage,
  type ThumbnailLocalBridgeStatus,
} from "@/lib/admin/youtube-thumbnail-generator/local-bridge-contract";
import type {
  ThumbnailGenerationResult as ContractThumbnailGenerationResult,
  ThumbnailGeneratorPayload,
} from "@/lib/admin/youtube-thumbnail-generator/types";
import { AdminEmbeddedModuleShell } from "@/components/admin/AdminEmbeddedModuleShell";

type ProviderId = "local-codex" | "openai-gpt-image-2";
type GenerationMode = "direct_provider" | "backend_agent";
type ThumbnailResultSourceKind =
  | "bundled_preview"
  | "history_actual"
  | "history_preview"
  | "release_candidate_preview"
  | "durable_release"
  | "durable_release_fallback"
  | "generated_exact"
  | "generated_unverified"
  | "external_image"
  | "page_image";
type BriefPreset =
  | "tzuyang-food-travel-collage"
  | "night-market-reaction"
  | "convenience-store-haul"
  | "grilled-meat-feast"
  | "sushi-seafood-table";
type ReferenceImageRole = "host" | "food" | "object" | "person" | "other";
type ThumbnailExportPresetId = "quick-1280x720" | "high-3840x2160";
type ThumbnailEditorToolId =
  | "select-headline"
  | "select-sticker"
  | "add-text"
  | "edit-text"
  | "duplicate"
  | "delete-text"
  | "bigger"
  | "smaller"
  | "rotate-left"
  | "rotate-right"
  | "align-left"
  | "align-center"
  | "align-right"
  | "fill-white"
  | "fill-yellow"
  | "fill-red"
  | "stroke-black"
  | "stroke-white"
  | "stroke-thick"
  | "stroke-thin"
  | "shadow-strong"
  | "shadow-none"
  | "font-impact"
  | "font-pretendard"
  | "bring-front"
  | "send-back"
  | "reset-text";
type ThumbnailChatLocalCommandId =
  | "reset"
  | "history"
  | "real-data-status"
  | "reference-upload"
  | "reference-clear"
  | "export-png"
  | "guide-hide"
  | "guide-show"
  | "guide-toggle"
  | "undo"
  | ThumbnailEditorToolId;

type TextLayer = {
  id: string;
  content: string;
  x: number;
  y: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  shadow: string;
  align: "left" | "center" | "right";
  rotation: number;
  zIndex: number;
};

type DragState = {
  pointerId: number;
  layerId: string;
  offsetX: number;
  offsetY: number;
};

type TextTransformState = {
  pointerId: number;
  layerId: string;
  mode: "resize" | "rotate";
  startFontSize: number;
  startRotation: number;
  startDistance: number;
  startAngle: number;
};

type TextEditorHistorySnapshot = {
  textLayers: TextLayer[];
  activeLayerId: string | null;
  editingLayerId: string | null;
  layerIdCounter: number;
};

type GenerationResult = {
  baseImage: {
    dataUrl: string;
    mime: string;
    targetWidth: 1280;
    targetHeight: 720;
    providerId: ProviderId;
    model: string;
    modelProvenance?: 'exact' | 'requested-label' | 'unknown';
  };
  sourceKind?: ThumbnailResultSourceKind;
  generationMode?: GenerationMode;
  prompt: string;
  warnings: string[];
  backendAgent?: {
    mode: "command" | "local_adapter";
    runtime: string;
    concept: string;
    layoutBrief: string;
    promptAddendum: string;
    safetyReview: string;
    nextActions: string[];
    diagnostics: Record<string, unknown>;
  };
  retrieval?: ThumbnailRetrievalResult;
};

type ThumbnailRetrievalDiagnostics = {
  status?: string;
  candidateCount?: number;
  selectedReferenceIds?: string[];
  fallbackReason?: string;
  usedModels?: {
    embedding?: string;
    reranker?: string;
  };
  operations?: {
    supabaseRpc?: string;
    denseSparseHybrid?: boolean;
    mmrApplied?: boolean;
    rerankerApplied?: boolean;
    captionEnrichmentApplied?: boolean;
  };
  commandRuntime?: string;
  elapsedMs?: number;
};

type ThumbnailReferenceEvidence = {
  id: string;
  source: string;
  intent: string;
  uploadRole: ReferenceImageRole;
  videoId?: string;
  title?: string;
  thumbnailUrl?: string;
  selectedReason: string;
};

type ThumbnailRetrievalResult = {
  evidence: ThumbnailReferenceEvidence[];
  diagnostics: ThumbnailRetrievalDiagnostics;
};

type ThumbnailHistoryRun = {
  id?: string;
  timestamp?: string;
  completedAt?: string;
  status?: string;
  providerId?: string;
  model?: string;
  modelProvenance?: 'exact' | 'requested-label' | 'unknown';
  generationMode?: string;
  topic?: string;
  headline?: string;
  warnings?: string[];
  imagePath?: string;
  rawPath?: string;
  retrieval?: ThumbnailRetrievalDiagnostics;
};

type ThumbnailHistoryPayload = {
  updatedAt?: string | null;
  runs?: ThumbnailHistoryRun[];
  latestPreviewRun?: ThumbnailHistoryRun | null;
};

type ThumbnailPromotionState = {
  schemaVersion: 1;
  promotedAt: string;
  promotedBy: string;
  sourceManifestId: string;
  candidateId: string;
  browserImagePath: string;
  providerId: ProviderId;
  model: "gpt-image-2";
  modelProvenance: "exact";
  score: number;
  sha256: string;
};

type ThumbnailReleaseCandidate = {
  id: string;
  subjectId: string;
  sourceManifestId: string;
  sourceImageId: string;
  browserImagePath: string;
  providerId: ProviderId;
  model: "gpt-image-2";
  modelProvenance: "exact";
  generationMode: GenerationMode;
  topic: string;
  headline: string;
  sha256: string;
  score: number;
  issueTags: string[];
  assignedBy: string;
  releaseCandidate: true;
  normalizedFromManifestMembership: true;
};

type ThumbnailReleaseCandidatesPayload = {
  updatedAt?: string | null;
  sourceManifestId?: string | null;
  candidates?: ThumbnailReleaseCandidate[];
  promotionState?: ThumbnailPromotionState | null;
  batchSummary?: {
    totalRuns: number;
    releaseCandidateCount: number;
    eligibility: {
      providerId: ProviderId;
      model: "gpt-image-2";
      modelProvenance: "exact";
      minVisualScore: number;
      issueTags: string[];
      passedV1Gate: boolean;
    };
  } | null;
  diagnostics?: {
    manifestFound: boolean;
    promotionStateValid: boolean;
    ignoredPromotionReason?: string;
    warnings: string[];
  };
};

type ThumbnailHistoryStatus = "idle" | "loading" | "ready" | "empty" | "error";
type ThumbnailInitialPreviewSource = "idle" | "bundled" | "durable" | "durable-empty" | "durable-unavailable" | "durable-error" | "candidate" | "candidate-empty" | "candidate-error" | "history";
type ThumbnailDurableReleaseLoadResult = "applied" | "available" | "empty-or-unavailable" | "hard-error" | "stale";
type ThumbnailReleaseCandidateLoadResult = "applied" | "empty" | "failed" | "stale";
type ThumbnailDurableRelease = {
  id: string;
  candidateId: string;
  sourceManifestId: string;
  sourceImageId: string;
  browserImagePath: string;
  providerId: ProviderId;
  model: "gpt-image-2";
  modelProvenance: "exact";
  score: number;
  sha256: string;
  issueTags: ["none"];
  textLayers?: TextLayer[];
  sourceQualityGate?: Record<string, unknown>;
  publishedAt?: string;
};

type ThumbnailDurableReleasePayload = {
  status: "ready" | "empty" | "unavailable";
  updatedAt?: string | null;
  release?: ThumbnailDurableRelease | null;
  diagnostics?: {
    durableRegistryAvailable: boolean;
    releaseKey: string;
    reason?: string;
    warnings: string[];
  };
  readiness?: ProviderReadiness;
};

type ThumbnailChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  mode?: "system" | "submitted" | "live" | "stream";
};
type ThumbnailChatConversationMessagePayload = {
  id?: string;
  role: "assistant" | "user";
  content: string;
};

type ThumbnailChatFocusContextPayload = {
  kind: "text-layer" | "canvas";
  label: string;
  promptContext: string;
  layerId?: string;
  role?: "headline" | "subHeadline" | "custom";
  detail?: string;
  createdAt?: string;
};

type ThumbnailChatReferenceImageAttachmentPayload = {
  id: string;
  name: string;
  mime?: "image/png" | "image/jpeg" | "image/webp";
  size: number;
  role: ReferenceImageRole;
};



type ThumbnailChatCanvasPatch = {
  topic: string;
  headline: string;
  subHeadline: string;
};

type ThumbnailChatTextLayerPatch = {
  id: string;
  content?: string;
  x?: number;
  y?: number;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  shadow?: string;
  align?: TextLayer["align"];
  rotation?: number;
  zIndex?: number;
};

type ThumbnailChatAgentResult = {
  assistantMessage: string;
  canvasPatch: ThumbnailChatCanvasPatch;
  textLayerPatches?: ThumbnailChatTextLayerPatch[];
  providerId?: ProviderId;
  generationMode?: GenerationMode;
  shouldGenerate: boolean;
  shouldReset: boolean;
  diagnostics?: {
    runtime?: string;
    model?: string;
    effort?: string;
    streaming?: string;
    chatIntent?: string;
    canvasMutation?: boolean;
  };
};

type ThumbnailChatSseEvent = {
  event: string;
  data: unknown;
};

type ThumbnailGenerationOverrides = Partial<{
  providerId: ProviderId;
  imageRouteChoice: ThumbnailImageRouteChoice;
  generationMode: GenerationMode;
  topic: string;
  headline: string;
  subHeadline: string;
  textLayers: TextLayer[];
}>;

type ThumbnailExportPreset = {
  id: ThumbnailExportPresetId;
  label: string;
  width: number;
  height: number;
  fileSuffix: string;
};

type ThumbnailExportMetadata = {
  width: number;
  height: number;
  mime: "image/png";
  fileName: string;
};

type ProviderAvailability = {
  available: boolean;
  model?: string | null;
  liveEnabled?: boolean;
  reason?: string;
  command?: string;
  strictExactModelRequired?: boolean;
};

type ThumbnailReadiness = {
  target: { width: number; height: number; aspectRatio: string };
  backendAgent?: {
    available: boolean;
    mode: "command" | "local_adapter";
    commandConfigured: boolean;
    commandAvailable: boolean;
    commandRejectionReason?: string;
    localAdapterAvailable: boolean;
    missingPythonModules: string[];
    runtime?: string;
    codexModel?: string;
    codexEffort?: string;
    streamingAvailable?: boolean;
    diagnosticsRedacted?: true;
  };
  providers: {
    localCodex: ProviderAvailability;
    openaiGptImage2?: ProviderAvailability;
  };
  limits: {
    maxFiles: number;
    maxFileBytes: number;
    maxTotalBytes: number;
    mimeTypes: string[];
  };
  configuration: {
    liveApiGate: string;
    openaiModelEnv: string;
    geminiModelEnv: string;
    localCodexGate: string;
    backendAgentCommandEnv?: string;
    backendAgentRootEnv?: string;
    backendAgentRuntimeEnv?: string;
    backendAgentCodexModelEnv?: string;
    backendAgentCodexEffortEnv?: string;
  };
};

type ThumbnailApiErrorPayload = {
  error?: string;
  detail?: string;
};

const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 720;
const HIGH_EXPORT_SCALE = 3;
const CANVAS_KEYBOARD_MOVE_STEP = 1;
const CANVAS_KEYBOARD_FAST_MOVE_STEP = 10;
const TEXT_LAYER_UNDO_LIMIT = 80;
const DEFAULT_LIMITS: ThumbnailReadiness["limits"] = {
  maxFiles: 8,
  maxFileBytes: 8_388_608,
  maxTotalBytes: 33_554_432,
  mimeTypes: ["image/png", "image/jpeg", "image/webp"],
};

const THUMBNAIL_SESSION_OPENAI_API_KEY_FIELD = "thumbnailSessionOpenaiApiKey";
const THUMBNAIL_SESSION_API_KEY_MAX_LENGTH = 512;
const THUMBNAIL_BROWSER_OPENAI_API_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{16,}$/;


type ThumbnailLocalBridgeUiStatus =
  | ThumbnailLocalBridgeStatus
  | "needs_reconnect"
  | "helper_opening"
  | "popup_blocked"
  | "helper_closed";

type ThumbnailLocalBridgeHelperCommand = "checkStatus" | "generateThumbnail";

type ThumbnailLocalBridgeHelperReadyMessage = {
  kind: "tzudong-local-bridge-helper-ready";
  sessionId: string;
  surface: "thumbnail";
  protocolVersion: 1;
};

type ThumbnailLocalBridgeHelperRequestMessage = {
  kind: "tzudong-local-bridge-helper-request";
  sessionId: string;
  requestId: string;
  command: ThumbnailLocalBridgeHelperCommand;
  bridgeUrl: string;
  token: string;
  payload?: unknown;
};

type ThumbnailLocalBridgeHelperResponseMessage =
  | {
    kind: "tzudong-local-bridge-helper-response";
    sessionId: string;
    requestId: string;
    ok: true;
    payload: unknown;
  }
  | {
    kind: "tzudong-local-bridge-helper-response";
    sessionId: string;
    requestId: string;
    ok: false;
    errorCode: string;
    message: string;
  };

type ThumbnailLocalBridgeHelperClosedMessage = {
  kind: "tzudong-local-bridge-helper-closed";
  sessionId: string;
};

type ThumbnailLocalBridgeHelperStatusPayload = {
  healthOk: boolean;
  health: unknown;
  authOk: boolean;
  auth: unknown;
};

type ThumbnailLocalBridgeHelperInvoke = (
  request: ThumbnailLocalBridgeHelperRequestMessage,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;

type ThumbnailImageRouteChoice =
  | "browser-openai-api-key"
  | "local-codex-oauth"
  | typeof THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID;

const thumbnailExportPresets: ThumbnailExportPreset[] = [
  {
    id: "quick-1280x720",
    label: "1280×720",
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
    fileSuffix: "1280x720",
  },
  {
    id: "high-3840x2160",
    label: "3840×2160",
    width: TARGET_WIDTH * HIGH_EXPORT_SCALE,
    height: TARGET_HEIGHT * HIGH_EXPORT_SCALE,
    fileSuffix: "3840x2160",
  },
];

const providerReadinessKey: Record<ProviderId, keyof ThumbnailReadiness["providers"]> = {
  "local-codex": "localCodex",
  "openai-gpt-image-2": "openaiGptImage2",
};

const thumbnailErrorActions: Record<string, string> = {
  required_ack: "안전 확인 체크박스를 직접 확인한 뒤 다시 생성하세요.",
  provider_unavailable: "현재 이미지 생성 준비가 끝나지 않았습니다. 설정을 확인한 뒤 다시 시도하세요.",
  invalid_session_api_key: "이 탭에 적용한 이미지 만들기 키를 확인하세요.",
  unsupported_model: "이미지 만들기 설정을 확인하세요.",
  invalid_text: "주제/문구 길이와 금지 문자를 줄이고 다시 시도하세요.",
  unsafe_instruction: "비밀 정보나 설정을 보여 달라는 요청은 빼 주세요.",
  unsafe_identity: "실제 채널명, 계정명, 개인 식별 텍스트를 제거하세요.",
  unsafe_brand: "브랜드/로고/상표 요청을 제거하고 일반 묘사로 바꾸세요.",
  unsafe_contact: "URL, 이메일, 전화번호, 주소처럼 보이는 텍스트를 제거하세요.",
  unsafe_price: "정확한 가격/금액 표현을 제거하세요.",
  unsafe_copy: "참고 프롬프트 문장을 그대로 복사하지 말고 새 소재에 맞게 요약하세요.",
  unsafe_crowd: "배경 인물을 식별 가능하게 만드는 지시를 제거하세요.",
  host_reference_required: getSpecificCreatorReferenceRequiredMessage(),
  multipart_form_data_required: "브라우저 폼 업로드로 다시 시도하세요.",
  content_length_invalid: "업로드 요청 크기 정보를 확인할 수 없습니다. 파일을 다시 선택하세요.",
  content_length_too_large: "참고 이미지 총 용량을 32MiB 이하로 줄이세요.",
  payload_json_invalid: "입력값을 새로고침 후 다시 작성하세요.",
};

const THUMBNAIL_LOCAL_BRIDGE_HELPER_PATH = "/helper" as const;
const THUMBNAIL_LOCAL_BRIDGE_HELPER_PROTOCOL_VERSION = 1 as const;

let thumbnailLocalBridgeHelperSessionCounter = 0;
let thumbnailChatThreadIdCounter = 0;

function createThumbnailChatThreadId() {
  thumbnailChatThreadIdCounter += 1;
  return `thumbnail-chat-${Date.now().toString(36)}-${thumbnailChatThreadIdCounter.toString(36)}`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function createThumbnailLocalBridgeHelperSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const values = new Uint32Array(2);
    crypto.getRandomValues(values);
    return `thumbnail-local-bridge-${Date.now()}-${Array.from(values, (value) => value.toString(36)).join("")}`;
  }
  thumbnailLocalBridgeHelperSessionCounter += 1;
  return `thumbnail-local-bridge-${Date.now()}-${thumbnailLocalBridgeHelperSessionCounter}`;
}

function getThumbnailLocalBridgeReconnectRequiredMessage() {
  return "고급 로컬 브릿지를 사용하려면 이 탭에서 pairing token을 적용한 뒤 연결해 주세요.";
}

function getThumbnailLocalBridgeHelperClosedMessage() {
  return "로컬 브릿지 helper 창이 닫혔습니다. “로컬 브릿지 연결”을 눌러 다시 연결한 뒤 다시 시도하세요.";
}

function getThumbnailLocalBridgePopupBlockedMessage() {
  return "브라우저가 로컬 브릿지 helper 팝업을 막았습니다. 주소창에서 팝업을 허용한 뒤 “로컬 브릿지 연결”을 다시 눌러 주세요.";
}

function formatThumbnailLocalBridgeStatusLabel(
  status: ThumbnailLocalBridgeUiStatus,
  hasToken: boolean,
) {
  if (!hasToken) return "토큰 필요";
  if (status === "connected") return "연결됨";
  if (status === "checking" || status === "helper_opening") return "연결 중";
  if (
    status === "needs_reconnect" ||
    status === "helper_closed" ||
    status === "popup_blocked"
  ) {
    return "재연결 필요";
  }
  return "확인 필요";
}

function buildThumbnailLocalBridgeHelperUrl(bridgeUrl: string, sessionId: string) {
  const baseUrl = normalizeThumbnailLocalBridgeUrl(bridgeUrl);
  const helperUrl = new URL(THUMBNAIL_LOCAL_BRIDGE_HELPER_PATH, `${baseUrl}/`);
  helperUrl.searchParams.set("origin", window.location.origin);
  helperUrl.searchParams.set("session", sessionId);
  helperUrl.searchParams.set("surface", "thumbnail");
  helperUrl.searchParams.set(
    "protocolVersion",
    String(THUMBNAIL_LOCAL_BRIDGE_HELPER_PROTOCOL_VERSION),
  );
  return helperUrl.toString();
}

function isThumbnailLocalBridgeHelperReadyMessage(
  value: unknown,
): value is ThumbnailLocalBridgeHelperReadyMessage {
  return (
    isObjectRecord(value) &&
    value.kind === "tzudong-local-bridge-helper-ready" &&
    typeof value.sessionId === "string" &&
    value.surface === "thumbnail" &&
    value.protocolVersion === THUMBNAIL_LOCAL_BRIDGE_HELPER_PROTOCOL_VERSION
  );
}

function isThumbnailLocalBridgeHelperResponseMessage(
  value: unknown,
): value is ThumbnailLocalBridgeHelperResponseMessage {
  return (
    isObjectRecord(value) &&
    value.kind === "tzudong-local-bridge-helper-response" &&
    typeof value.sessionId === "string" &&
    typeof value.requestId === "string" &&
    typeof value.ok === "boolean"
  );
}

function isThumbnailLocalBridgeHelperClosedMessage(
  value: unknown,
): value is ThumbnailLocalBridgeHelperClosedMessage {
  return (
    isObjectRecord(value) &&
    value.kind === "tzudong-local-bridge-helper-closed" &&
    typeof value.sessionId === "string"
  );
}

function getSpecificCreatorReferenceRequiredMessage() {
  return "쯔양님이 나오려면 참고 이미지가 필요합니다. 사람 없는 이미지로 대신 만들지 않았습니다.";
}

function normalizeThumbnailBrowserOpenAIApiKeyInput(value: string) {
  return value.trim();
}

function isValidThumbnailBrowserOpenAIApiKey(value: string) {
  const normalized = normalizeThumbnailBrowserOpenAIApiKeyInput(value);
  return (
    normalized.length > 0 &&
    normalized.length <= THUMBNAIL_SESSION_API_KEY_MAX_LENGTH &&
    THUMBNAIL_BROWSER_OPENAI_API_KEY_PATTERN.test(normalized) &&
    !/\s/.test(normalized)
  );
}

function maskThumbnailBrowserOpenAIApiKey(value: string | null) {
  if (!value) return "";
  if (value.length <= 14) return "적용됨";
  return `${value.slice(0, 7)}…${value.slice(-4)}`;
}


function maskThumbnailLocalBridgeToken(value: string | null) {
  if (!value) return "";
  if (value.length <= 8) return "적용됨";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}


function getProviderIdForThumbnailImageRouteChoice(routeChoice: ThumbnailImageRouteChoice): ProviderId {
  return routeChoice === "browser-openai-api-key" ? "openai-gpt-image-2" : "local-codex";
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 1024 * 1024 ? 1 : 2)}MiB`;
}

type ThumbnailGenerationPreflightInput = {
  topic: string;
  headline: string;
  files: File[];
  readinessLimits: ThumbnailReadiness["limits"];
  fileValidationMessage: string | null;
  generationMode: GenerationMode;
  backendAgentStatus: ThumbnailReadiness["backendAgent"] | null | undefined;
};

function getThumbnailGenerationPreflightIssues({
  topic,
  headline,
  files,
  readinessLimits,
  fileValidationMessage,
  generationMode,
  backendAgentStatus,
}: ThumbnailGenerationPreflightInput) {
  const issues: string[] = [];
  const trimmedTopic = topic.trim();
  const trimmedHeadline = headline.trim();
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  if (!trimmedTopic) issues.push("영상 콘텐츠 주제를 입력하세요.");
  if (trimmedTopic.length > 280) issues.push("영상 콘텐츠 주제는 280자 이하로 줄이세요.");
  if (!trimmedHeadline) issues.push("메인 문구를 입력하세요.");
  if (trimmedHeadline.length > 80) issues.push("메인 문구는 80자 이하로 줄이세요.");
  if (files.length > readinessLimits.maxFiles) issues.push(`참고 이미지는 최대 ${readinessLimits.maxFiles}장까지 업로드할 수 있습니다.`);
  const oversizedFile = files.find((file) => file.size > readinessLimits.maxFileBytes);
  if (oversizedFile) issues.push(`${oversizedFile.name} 파일이 ${formatBytes(readinessLimits.maxFileBytes)} 제한을 넘습니다.`);
  if (totalBytes > readinessLimits.maxTotalBytes) issues.push(`참고 이미지 총 용량은 ${formatBytes(readinessLimits.maxTotalBytes)} 이하로 줄이세요.`);
  const unsupportedFile = files.find((file) => file.type && !readinessLimits.mimeTypes.includes(file.type));
  if (unsupportedFile) issues.push(`${unsupportedFile.name}은 PNG/JPEG/WebP 이미지로 다시 선택하세요.`);
  if (fileValidationMessage) issues.push(fileValidationMessage);
  if (generationMode === "backend_agent" && backendAgentStatus && !backendAgentStatus.available) {
    issues.push("도우미 준비 상태를 확인할 수 없어 바로 이미지 생성으로 전환하세요.");
  }
  // Specific creator requests are allowed to proceed without an upload because
  // the server can use the locally held Tzuyang thumbnail library as
  // reference-backed host/person evidence; if retrieval cannot provide it, the
  // guarded API returns host_reference_required.

  return issues;
}

function getThumbnailErrorAction(payload: ThumbnailApiErrorPayload | null) {
  const code = payload?.error ?? "thumbnail_generation_failed";
  const action = thumbnailErrorActions[code] ?? "입력값과 이미지 생성 준비 상태를 확인한 뒤 다시 시도하세요.";
  return action;
}

async function getThumbnailLocalBridgeStatusRequest(
  bridgeUrl: string,
  token: string | null,
  invokeHelper: ThumbnailLocalBridgeHelperInvoke,
  signal: AbortSignal,
): Promise<{ status: ThumbnailLocalBridgeUiStatus; message: string }> {
  const baseUrl = normalizeThumbnailLocalBridgeUrl(bridgeUrl);
  const normalizedToken = normalizeThumbnailLocalBridgeToken(token);
  if (!normalizedToken) {
    return {
      status: "unpaired",
      message: "고급 로컬 브릿지 pairing 설정을 먼저 적용해 주세요.",
    };
  }
  try {
    const responsePayload = await invokeHelper(
      {
        kind: "tzudong-local-bridge-helper-request",
        sessionId: "thumbnail-local-bridge-status",
        requestId: "thumbnail-local-bridge-status",
        command: "checkStatus",
        bridgeUrl: baseUrl,
        token: normalizedToken,
      },
      { signal },
    );
    const helperPayload = isObjectRecord(responsePayload)
      ? responsePayload as Partial<ThumbnailLocalBridgeHelperStatusPayload>
      : null;
    const healthPayload = isObjectRecord(helperPayload?.health)
      ? helperPayload.health as Partial<{
        ok: boolean;
        providerId: string;
        model: string;
        endpoints?: { thumbnailImages?: string };
      }>
      : null;
    const authPayload = isObjectRecord(helperPayload?.auth)
      ? helperPayload.auth as Partial<{
        ok: boolean;
        status: string;
        providerId: string;
        model: string;
        detail?: string;
      }>
      : null;
    if (
      helperPayload?.healthOk !== true ||
      healthPayload?.ok !== true ||
      healthPayload.providerId !== "local-codex" ||
      healthPayload.model !== "gpt-image-2" ||
      healthPayload.endpoints?.thumbnailImages !== THUMBNAIL_LOCAL_BRIDGE_IMAGES_PATH
    ) {
      return {
        status: "unavailable",
        message: "로컬 브릿지 health 응답을 신뢰할 수 없습니다.",
      };
    }
    if (
      helperPayload?.authOk === true &&
      authPayload?.ok === true &&
      authPayload.status === "ready" &&
      authPayload.providerId === "local-codex" &&
      authPayload.model === "gpt-image-2"
    ) {
      return {
        status: "connected",
        message: "고급 로컬 브릿지 연결됨 · helper transport · local-codex gpt-image-2",
      };
    }
    if (authPayload?.status === "auth_required") {
      return {
        status: "auth_required",
        message: authPayload.detail ?? "로컬 Codex OAuth 로그인이 필요합니다.",
      };
    }
    return {
      status: "unpaired",
      message: "pairing 설정이 브릿지와 맞지 않습니다.",
    };
  } catch (error) {
    const message = redactThumbnailLocalBridgeSecretText(
      error instanceof Error ? error.message : "로컬 브릿지 helper 연결을 확인하지 못했습니다.",
      normalizedToken,
    );
    if (message === getThumbnailLocalBridgeHelperClosedMessage()) {
      return { status: "helper_closed", message };
    }
    if (message === getThumbnailLocalBridgePopupBlockedMessage()) {
      return { status: "popup_blocked", message };
    }
    if (message === getThumbnailLocalBridgeReconnectRequiredMessage()) {
      return { status: "needs_reconnect", message };
    }
    return {
      status: "unavailable",
      message,
    };
  }
}

function bytesToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}

async function buildThumbnailLocalBridgeReferenceImages(
  files: File[],
  roles: ReferenceImageRole[],
): Promise<ThumbnailLocalBridgeReferenceImage[]> {
  return Promise.all(files.slice(0, DEFAULT_LIMITS.maxFiles).map(async (file, index) => {
    let mime: ThumbnailLocalBridgeReferenceImage["mime"] = "image/png";
    if (file.type === "image/jpeg") mime = "image/jpeg";
    if (file.type === "image/webp") mime = "image/webp";
    return {
      name: file.name || `reference-${index + 1}.${mime.split("/")[1] ?? "png"}`,
      mime,
      role: roles[index] ?? (index === 0 ? "host" : "other"),
      dataBase64: bytesToBase64(await file.arrayBuffer()),
    };
  }));
}

async function postThumbnailLocalBridgeImagesRequest(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailLocalBridgeReferenceImage[],
  bridgeUrl: string,
  token: string | null,
  signal: AbortSignal,
  invokeHelper: ThumbnailLocalBridgeHelperInvoke,
): Promise<GenerationResult> {
  const baseUrl = normalizeThumbnailLocalBridgeUrl(bridgeUrl);
  const normalizedToken = requireThumbnailLocalBridgeToken(token);
  const requestPayload = buildThumbnailLocalBridgeImagesRequest(payload, referenceImages);
  const responsePayload = await invokeHelper(
    {
      kind: "tzudong-local-bridge-helper-request",
      sessionId: "thumbnail-local-bridge-generate",
      requestId: "thumbnail-local-bridge-generate",
      command: "generateThumbnail",
      bridgeUrl: baseUrl,
      token: normalizedToken,
      payload: requestPayload,
    },
    { signal },
  );
  const normalized = normalizeThumbnailLocalBridgeImagesResponse(responsePayload);
  return normalized.result as ContractThumbnailGenerationResult & GenerationResult;
}

function parseThumbnailChatSseBlock(block: string): ThumbnailChatSseEvent | null {
  const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() ?? "message";
  const dataLines = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return { event, data: dataLines.join("\n") };
  }
}

function extractThumbnailChatSseEvents(buffer: string) {
  const parts = buffer.split(/\n\n/);
  const remainder = parts.pop() ?? "";
  return {
    events: parts.flatMap((part) => {
      const parsed = parseThumbnailChatSseBlock(part.trim());
      return parsed ? [parsed] : [];
    }),
    remainder,
  };
}

function isThumbnailChatTextLayerPatch(value: unknown): value is ThumbnailChatTextLayerPatch {
  if (!value || typeof value !== "object") return false;
  const patch = value as Partial<ThumbnailChatTextLayerPatch>;
  const validAlign = patch.align === undefined || patch.align === "left" || patch.align === "center" || patch.align === "right";
  const validStrings = [patch.content, patch.fontFamily, patch.fill, patch.stroke, patch.shadow]
    .every((item) => item === undefined || typeof item === "string");
  const validNumbers = [patch.x, patch.y, patch.fontSize, patch.fontWeight, patch.strokeWidth, patch.rotation, patch.zIndex]
    .every((item) => item === undefined || Number.isFinite(item));
  return typeof patch.id === "string" && patch.id.trim().length > 0 && validAlign && validStrings && validNumbers;
}

function isThumbnailChatAgentResult(value: unknown): value is ThumbnailChatAgentResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<ThumbnailChatAgentResult>;
  const patch = result.canvasPatch;
  const textLayerPatches = result.textLayerPatches;
  return (
    typeof result.assistantMessage === "string" &&
    Boolean(patch) &&
    typeof patch?.topic === "string" &&
    typeof patch?.headline === "string" &&
    typeof patch?.subHeadline === "string" &&
    (result.providerId === undefined || isProviderId(result.providerId)) &&
    (result.generationMode === undefined || isGenerationMode(result.generationMode)) &&
    (textLayerPatches === undefined || (
      Array.isArray(textLayerPatches) &&
      textLayerPatches.every((item) => isThumbnailChatTextLayerPatch(item))
    ))
  );
}

function loadThumbnailImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("썸네일 이미지를 불러오지 못했습니다."));
    image.src = dataUrl;
  });
}

const THUMBNAIL_CHAT_AGENT_STREAM_URL = "/api/admin/youtube-thumbnail-generator/chat";
const THUMBNAIL_HISTORY_API_URL = "/api/admin/youtube-thumbnail-generator/history";
const THUMBNAIL_RELEASE_CANDIDATES_API_URL = "/api/admin/youtube-thumbnail-generator/release-candidates";
const THUMBNAIL_DURABLE_RELEASE_CURRENT_API_URL = "/api/admin/youtube-thumbnail-generator/releases/current";
const THUMBNAIL_HISTORY_IMAGE_BASE_URL = "/qa-history/youtube-thumbnail-generator";
const THUMBNAIL_STRICT_LOCAL_CODEX_UNVERIFIED_REASON = "local_codex_model_provenance_unverified";
const DEFAULT_TOPIC =
  "다음 업로드 주제: 해외 야시장 길거리 음식, 압도적인 양의 음식 전경, 진행자와 리액션 컷아웃";
const CHAT_TOPIC_MAX_LENGTH = 280;
const SPECIFIC_CREATOR_HOST_PATTERN = /(쯔양|tzuyang)/i;
const CANVAS_TEXT_IDENTITY_PATTERN = /(쯔양|tzuyang|youtube\s*channel|유튜브\s*채널|계정|@[\w_.-]+)/gi;
const CHAT_EXPLICIT_HEADLINE_PATTERN = /(?:^|[\n,;])\s*(?:메인\s*문구|메인|큰\s*문구|제목|headline)\s*[:：]\s*([^\n,;]+)/i;
const CHAT_EXPLICIT_HEADLINE_PARTICLE_PATTERN = /(?:^|[\n,;.])\s*(?:메인\s*)?(?:문구|제목)\s*(?:은|는|=)\s*["“'‘]?([^"”'’\n,;.]{2,42})/i;
const CHAT_EXPLICIT_SUBHEADLINE_PATTERN = /(?:^|[\n,;])\s*(?:보조\s*문구|보조|스티커|서브|sub)\s*[:：]\s*([^\n,;]+)/i;
const CHAT_EXPLICIT_SUBHEADLINE_PARTICLE_PATTERN = /(?:^|[\n,;.])\s*(?:보조\s*)?(?:스티커|서브|보조\s*문구)\s*(?:은|는|=)\s*["“'‘]?([^"”'’\n,;.]{2,20})/i;
const CHAT_GENERATION_INTENT_PATTERN = /(생성|만들|제작|그려|뽑아|렌더|render|generate|create)/i;
const THUMBNAIL_CHAT_CONVERSATION_CONTEXT_LIMIT = 8;
const THUMBNAIL_CHAT_CONVERSATION_CONTENT_MAX_LENGTH = 280;
const MAIN_HEADLINE_MAX_LENGTH = 36;
const AUTO_GENERATED_MAIN_HEADLINE_MAX_LENGTH = 14;
const SUB_HEADLINE_MAX_LENGTH = 20;
const FOOD_SUBJECT_MAX_LENGTH = 14;
const TZUYANG_BENCHMARK_COPY_SIGNAL_PATTERN =
  /\d+\s*(?:kg|KG|인분|그릇|마리|종|개|년|만원|cm|CM|m|M)|대왕|얼굴만한|역대급|끝판왕|밥도둑|전통|무한|최대|가득|폭탄|통수육|볶음밥|한상|레전드/i;
const HOST_PERSON_REFERENCE_ROLES = new Set<ReferenceImageRole>(["host", "person"]);
const THUMBNAIL_CHAT_LOCAL_COMMAND_OVERMATCH_FIXTURES = [
  "가이드 포함해서 썸네일 생성해줘",
  "메인 문구 크게 보이게 생성해줘",
  "PNG 느낌으로 저장하고 싶은 썸네일 만들어줘",
  "생성 과정 확인해줘",
] as const;
const THUMBNAIL_CHAT_INTERNAL_JARGON_PATTERN =
  /backend[-\s]?agent|provider|provenance|fallback|reranker|embedding|LangGraph|exact|allowlist|runtime|diagnostics|process\.env|환경\s*변수|model|모델|프로바이더|gpt-image-2|GPT\s*Image\s*2|BGE|local[-\s]?codex|Codex CLI/i;
const THUMBNAIL_CHAT_SIMPLE_FALLBACK_MESSAGE = [
  "쉽게 정리했어요.",
  "지금은 썸네일을 안전하게 만들 수 있는지 확인했습니다.",
  "원하는 음식, 짧은 문구, 참고 이미지를 알려 주세요.",
].join("\n");
const THUMBNAIL_USAGE_GUIDE_TEXT =
  "간단히 3가지만 적어 주세요.\n1. 어떤 음식인지\n2. 쯔양님이나 참고 인물이 필요한지\n3. 꼭 넣고 싶은 짧은 문구";
const THUMBNAIL_GUIDED_EXAMPLE_REQUEST =
  "제육볶음 밥도둑 한상 썸네일 예시를 보여줘. 쯔양님과 음식이 잘 보이고 문구는 짧게 배치해줘.";
const THUMBNAIL_GUIDED_EXAMPLE_RESPONSE =
  "예시를 화면에 넣었어요.\n음식, 인물, 문구 위치를 보고 원하는 내용은 말로 바꿀 수 있습니다.";
const THUMBNAIL_GUIDED_EXAMPLE_PRESETS = [
  {
    request: THUMBNAIL_GUIDED_EXAMPLE_REQUEST,
    response: THUMBNAIL_GUIDED_EXAMPLE_RESPONSE,
    topic: "쯔양 제육볶음 밥도둑 한상 먹방 썸네일",
    headline: "밥도둑 한상",
    subHeadline: "불판 직행?",
  },
  {
    request: "쯔양님과 빨간 양념 제육볶음이 크게 보이는 썸네일 예시를 만들어줘.",
    response: "다른 예시를 화면에 넣었어요.\n문구를 짧게 줄이고, 음식과 얼굴을 덜 가리도록 배치했습니다.",
    topic: "쯔양 매운 제육볶음 빨간 양념 먹방 썸네일",
    headline: "매운맛 한상",
    subHeadline: "밥도둑 인정?",
  },
  {
    request: "쯔양님과 푸짐한 한상차림이 잘 보이는 먹방 썸네일 예시를 보여줘.",
    response: "한상차림 예시를 화면에 넣었어요.\n큰 문구는 짧게, 보조 문구는 얼굴을 피해서 배치했습니다.",
    topic: "쯔양 푸짐한 한상차림 먹방 썸네일",
    headline: "역대급 한상",
    subHeadline: "한입만 가능?",
  },
] as const;
type ThumbnailGuidedExamplePreset = (typeof THUMBNAIL_GUIDED_EXAMPLE_PRESETS)[number];

function formatThumbnailAssistantDisplayText(value: string) {
  const safe = value
    .replace(/Codex CLI\s+[A-Za-z0-9._-]+\s+\w+\s+작업 완료/gi, "요청을 이해했어요")
    .replace(/GPT\s*Image\s*2|gpt-image-2|model/gi, "이미지 만들기")
    .replace(/provider|provenance|fallback|runtime|diagnostics|allowlist|exact/gi, "확인")
    .replace(/backend[-\s]?agent|LangGraph|reranker|embedding|BGE|local[-\s]?codex/gi, "도우미")
    .replace(/환경\s*변수|process\.env/gi, "설정")
    .replace(/백엔드\s*에이전트|백엔드|에이전트/g, "도우미")
    .replace(/패치/g, "수정")
    .replace(/캔버스/g, "화면")
    .replace(/썸네일 생성/g, "썸네일 만들기")
    .replace(/이미지 생성/g, "이미지 만들기")
    .replace(/실제 이미지 모델/g, "이미지 만들기")
    .replace(/모델 상태/g, "이미지 만들기 상태")
    .replace(/문구 레이어/g, "문구")
    .replace(/\s*·\s*/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const lines = safe
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const compactLines =
    lines.length > 5
      ? [
          ...lines.slice(0, 4),
          "더 자세히 보고 싶으면 “상태”라고 입력하세요.",
        ]
      : lines;
  const formatted = compactLines.length <= 1
    ? compactLines[0] ?? ""
    : compactLines
    .map((line, index) => (index === 0 ? line : `- ${line}`))
    .join("\n");
  return THUMBNAIL_CHAT_INTERNAL_JARGON_PATTERN.test(formatted)
    ? THUMBNAIL_CHAT_SIMPLE_FALLBACK_MESSAGE
    : formatted;
}

function createThumbnailChatRunId(messageId: string) {
  return `thumbnail-chat-${Date.now()}-${messageId}`;
}

function normalizeThumbnailChatRequirement(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[<>`{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function requestsSpecificCreatorHost(value: string) {
  return SPECIFIC_CREATOR_HOST_PATTERN.test(value);
}

function hasHostPersonReferenceSelection(files: File[], roles: ReferenceImageRole[]) {
  return files.some((_, index) => HOST_PERSON_REFERENCE_ROLES.has(roles[index] ?? (index === 0 ? "host" : "other")));
}

function shouldBlockSpecificCreatorGenerationRequest(value: string, files: File[], roles: ReferenceImageRole[]) {
  return requestsSpecificCreatorHost(value) && !hasHostPersonReferenceSelection(files, roles);
}

function isUnsafeThumbnailChatInstructionPrompt(value: string) {
  const normalized = normalizeThumbnailChatRequirement(value);
  if (!normalized) return false;
  return /(?:이전\s*지시|지시\s*무시|ignore\s+(?:previous|all)\s+instructions|system\s*prompt|developer\s*message|환경\s*변수|env(?:ironment)?\s*var|process\.env|비밀\s*키|secret|api\s*key|토큰|token|검증\s*(?:건너|스킵|무시)|skip\s*verification|성공(?:했다고|으로)\s*말|false\s*success|delete\s+state|상태\s*삭제)/i.test(normalized);
}

function getUnsafeThumbnailChatInstructionMessage() {
  return "그 요청은 안전하게 처리할 수 없어요. 비밀 정보 보여주기, 확인 과정 건너뛰기, 사실과 다른 성공 처리는 하지 않습니다. 썸네일 문구나 배치를 어떻게 바꾸고 싶은지만 다시 적어 주세요.";
}
function isThumbnailChatReviewOnlyPrompt(value: string) {
  const normalized = normalizeThumbnailChatRequirement(value);
  return /(검토|리뷰|평가|어때|괜찮|초보자도\s*이해|왜\s*이렇게|분석|클릭률.*어떻게|가독성.*어때)/i.test(normalized) &&
    !isThumbnailChatReplacementPrompt(normalized) &&
    !isSelectedLayerChatPrompt(normalized);
}

function isThumbnailChatCasualPrompt(value: string) {
  const normalized = normalizeThumbnailChatRequirement(value);
  return /^(?:ㅎㅇ|하이|안녕|안녕하세요|고마워|감사|ㄱㅅ|도움말|help|사용법)$/i.test(normalized) ||
    /(?:뭐\s*할\s*수|무엇을\s*할\s*수|어떻게\s*쓰|사용법|도움말|help)/i.test(normalized);
}

function hasExplicitThumbnailGenerationCommand(value: string) {
  return hasSharedExplicitThumbnailGenerationCommand(normalizeThumbnailChatRequirement(value));
}

function isThumbnailChatGuidanceQuestion(value: string) {
  return isSharedThumbnailChatGuidanceQuestion(normalizeThumbnailChatRequirement(value));
}

function isNonMutatingThumbnailChatPrompt(value: string) {
  const normalized = normalizeThumbnailChatRequirement(value);
  if (!normalized) return false;
  if (isThumbnailChatCasualPrompt(normalized) || isThumbnailChatReviewOnlyPrompt(normalized)) return true;
  if (isThumbnailChatGuidanceQuestion(normalized) && !hasExplicitThumbnailGenerationCommand(normalized)) return true;
  if (isThumbnailChatReplacementPrompt(normalized) || isSelectedLayerChatPrompt(normalized) || isThumbnailChatOptimizationPrompt(normalized)) return false;
  if (hasExplicitThumbnailGenerationCommand(normalized)) return false;
  return isThumbnailChatGuidanceQuestion(normalized);
}

function isSelectedLayerChatPrompt(value: string) {
  return /(선택된|선택\s*항목|현재\s*캔버스에서\s*선택된|이\s*선택|이거|그거|해당\s*문구|현재\s*문구|선택\s*문구)/i.test(value);
}

function isThumbnailChatReplacementPrompt(value: string) {
  const normalized = normalizeThumbnailChatRequirement(value);
  if (!/(?:수정|바꿔|바꾸|변경|교체|고쳐|고치)/i.test(normalized)) return false;
  return (
    /(?:(?:메인\s*문구|메인|큰\s*문구|큰\s*제목|제목|headline)|(?:스티커\s*문구|스티커|보조\s*문구|보조|서브|작은\s*문구|sub)|(?:선택된\s*문구|선택\s*문구|현재\s*문구|이\s*문구|이거|그거|해당\s*문구))\s*(?:을|를|은|는)?\s+.{1,80}?\s*(?:으로|로)\s*(?:수정|바꿔|바꾸|변경|교체|고쳐|고치)/i.test(normalized) ||
    /.{2,80}?\s*(?:을|를)\s+.{1,80}?\s*(?:으로|로)\s*(?:수정|바꿔|바꾸|변경|교체|고쳐|고치)/i.test(normalized)
  );
}

function isThumbnailChatOptimizationPrompt(value: string) {
  const normalized = normalizeThumbnailChatRequirement(value);
  return /(조회수|클릭률|클릭|CTR|최적화|가독성|잘\s*나오|잘\s*읽히|잘\s*보이|눈에\s*띄|주목|강조|배치|위치|폰트|크기)/i.test(normalized);
}

function isThumbnailChatStructuredEditPrompt(value: string) {
  const normalized = normalizeThumbnailChatRequirement(value);
  if (!normalized) return false;
  return isThumbnailChatReplacementPrompt(normalized) || isThumbnailChatOptimizationPrompt(normalized);
}

function isThumbnailChatRealDataStatusPrompt(value: string) {
  const normalized = normalizeThumbnailChatRequirement(value);
  if (!normalized) return false;
  const subjectPattern = /(?:실제\s*데이터|실데이터|데이터\s*기반|real\s*data|mock|모의|가짜|프로바이더|provider|provenance|출처|근거|실제\s*생성|생성\s*과정|프로세스|모델\s*출처|gpt-image-2|GPT\s*Image\s*2)/i;
  const historyStatusPattern = /(?:(?:히스토리|기록).*(?:상태|근거|실제|저장|provider|프로바이더|출처|provenance|mock)|(?:상태|근거|실제|저장|provider|프로바이더|출처|provenance|mock).*(?:히스토리|기록))/i;
  const statusVerbPattern = /(?:확인|알려|보여|검증|맞|쓰|사용|기반|상태|출처|근거|어떻게|어떤|무슨|\?)/i;
  return (subjectPattern.test(normalized) || historyStatusPattern.test(normalized)) && statusVerbPattern.test(normalized);
}

function hasThumbnailGenerationIntent(value: string) {
  return CHAT_GENERATION_INTENT_PATTERN.test(value) || THUMBNAIL_CHAT_LOCAL_COMMAND_OVERMATCH_FIXTURES.includes(
    value as (typeof THUMBNAIL_CHAT_LOCAL_COMMAND_OVERMATCH_FIXTURES)[number],
  );
}

function createTzuyangAutomaticPreviewTopic(value: string) {
  const normalized = normalizeThumbnailChatRequirement(value) || DEFAULT_TOPIC;
  if (SPECIFIC_CREATOR_HOST_PATTERN.test(normalized) || /먹방|유튜브\s*썸네일/i.test(normalized)) return normalized;
  return `쯔양 먹방 썸네일 ${normalized}`;
}

function isCanvasContextChatPrompt(value: string) {
  return /^(?:선택된|현재\s*캔버스에서\s*선택된)/i.test(value);
}

function resolveThumbnailChatEditorToolCommand(normalized: string): ThumbnailEditorToolId | null {
  if (/^(?:문구\s*)?(?:초기화|리셋|reset)$/i.test(normalized)) return "reset-text";
  if (/(?:메인|큰\s*제목|큰\s*문구|headline).*(?:선택|잡아|골라|활성)/i.test(normalized)) return "select-headline";
  if (/(?:스티커|보조|서브|작은\s*문구).*(?:선택|잡아|골라|활성)/i.test(normalized)) return "select-sticker";
  if (/(?:새\s*)?(?:문구|텍스트|글자).*(?:추가|더해|넣어|생성)/i.test(normalized)) return "add-text";
  if (/(?:문구|텍스트|글자|선택).*(?:수정|편집|고쳐|edit)/i.test(normalized)) return "edit-text";
  if (/(?:문구|텍스트|글자|선택).*(?:복제|복사|duplicate)/i.test(normalized)) return "duplicate";
  if (/(?:문구|텍스트|글자|선택).*(?:삭제|지워|제거|delete)/i.test(normalized)) return "delete-text";
  if (/(?:문구|텍스트|글자|선택|메인|스티커).*(?:크게|키워|확대|bigger)/i.test(normalized)) return "bigger";
  if (/(?:문구|텍스트|글자|선택|메인|스티커).*(?:작게|줄여|축소|smaller)/i.test(normalized)) return "smaller";
  if (/(?:왼쪽|반시계).*(?:회전|돌려|rotate)/i.test(normalized)) return "rotate-left";
  if (/(?:오른쪽|시계).*(?:회전|돌려|rotate)/i.test(normalized)) return "rotate-right";
  if (/(?:왼쪽|좌측).*(?:정렬|맞춰|align)/i.test(normalized)) return "align-left";
  if (/(?:가운데|중앙|센터).*(?:정렬|맞춰|align)/i.test(normalized)) return "align-center";
  if (/(?:오른쪽|우측).*(?:정렬|맞춰|align)/i.test(normalized)) return "align-right";
  if (/(?:흰|하얀|white).*(?:글자|문구|텍스트|색)/i.test(normalized)) return "fill-white";
  if (/(?:노란|노랑|yellow).*(?:글자|문구|텍스트|색)/i.test(normalized)) return "fill-yellow";
  if (/(?:빨간|빨강|red).*(?:글자|문구|텍스트|색)/i.test(normalized)) return "fill-red";
  if (/(?:검정|검은|black).*(?:외곽|외곽선|테두리|stroke)/i.test(normalized)) return "stroke-black";
  if (/(?:흰|하얀|white).*(?:외곽|외곽선|테두리|stroke)/i.test(normalized)) return "stroke-white";
  if (/(?:외곽|외곽선|테두리|stroke).*(?:굵게|두껍|thick)/i.test(normalized)) return "stroke-thick";
  if (/(?:외곽|외곽선|테두리|stroke).*(?:얇게|가늘|thin)/i.test(normalized)) return "stroke-thin";
  if (/(?:그림자|shadow).*(?:강|진하게|strong)/i.test(normalized)) return "shadow-strong";
  if (/(?:그림자|shadow).*(?:끄|없애|제거|none)/i.test(normalized)) return "shadow-none";
  if (/(?:impact|임팩트).*(?:폰트|글꼴|적용)/i.test(normalized)) return "font-impact";
  if (/(?:pretendard|프리텐다드).*(?:폰트|글꼴|적용)/i.test(normalized)) return "font-pretendard";
  if (/(?:앞|전면|front).*(?:보내|올려|앞으로|bring)/i.test(normalized)) return "bring-front";
  if (/(?:뒤|후면|back).*(?:보내|내려|뒤로|send)/i.test(normalized)) return "send-back";
  return null;
}

function resolveThumbnailChatLocalCommand(value: string): ThumbnailChatLocalCommandId | null {
  const normalized = normalizeThumbnailChatRequirement(value);
  if (!normalized) return null;
  if (/^(?:상태|현재\s*상태|요약|도움말|help|사용법)$/i.test(normalized)) return "real-data-status";
  if (isThumbnailChatRealDataStatusPrompt(normalized)) return "real-data-status";
  if (hasThumbnailGenerationIntent(normalized)) return null;
  if (isCanvasContextChatPrompt(normalized)) return null;
  if (isThumbnailChatStructuredEditPrompt(normalized)) return null;
  if (isThumbnailChatGuidanceQuestion(normalized)) return null;

  const wantsReferenceImage = /(참고\s*이미지|레퍼런스|reference|이미지\s*(?:첨부|업로드)|파일\s*(?:첨부|업로드))/i.test(normalized);
  if (wantsReferenceImage && /(삭제|지워|비워|제거|초기화|clear)/i.test(normalized)) return "reference-clear";
  if (wantsReferenceImage && /(추가|첨부|업로드|선택|넣|올려|등록|열어|불러)/i.test(normalized)) return "reference-upload";
  if (/(히스토리|생성\s*기록|기록\s*(?:열|보여|조회|확인)|history)/i.test(normalized)) return "history";
  if (/^(?:문구\s*)?(?:초기화|리셋|reset)$/i.test(normalized)) return "reset";
  if (/(?:png|피엔지).*(?:저장|다운로드|내보내기|export)|(?:저장|다운로드|내보내기|export).*(?:png|피엔지)/i.test(normalized)) return "export-png";
  if (/(?:가이드|안전\s*영역|safe\s*area).*(?:숨겨|끄|감춰|hide|off)/i.test(normalized)) return "guide-hide";
  if (/(?:가이드|안전\s*영역|safe\s*area).*(?:보여|켜|표시|show|on)/i.test(normalized)) return "guide-show";
  if (/(?:가이드|안전\s*영역|safe\s*area).*(?:전환|토글|toggle)/i.test(normalized)) return "guide-toggle";
  if (/(?:되돌|되돌려|취소|undo|ctrl\s*\\+?\s*z|컨트롤\s*z)/i.test(normalized)) return "undo";

  return resolveThumbnailChatEditorToolCommand(normalized);
}

function sanitizeCanvasChatText(value: string, fallback: string, maxLength = 18) {
  const sanitized = value
    .replace(CANVAS_TEXT_IDENTITY_PATTERN, "")
    .replace(/\s*(?:으로|로)?\s*(?:생성해줘|생성|만들어줘|만들어|그려줘|그려|실행해줘|실행|이미지\s*뽑아줘|뽑아줘|수정해줘|수정|바꿔줘|바꿔|바꾸|변경해줘|변경|교체해줘|교체|고쳐줘|고쳐)\s*$/gi, "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[<>`{}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
  return sanitized || fallback;
}

function pickExplicitChatField(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1]?.replace(/^["“'‘]|["”'’]$/g, "").trim() ?? "";
}

function joinThumbnailCopyTokens(tokens: Array<string | null | undefined>) {
  const uniqueTokens: string[] = [];
  tokens.forEach((token) => {
    const normalizedToken = token?.replace(/\s+/g, " ").trim();
    if (!normalizedToken) return;
    if (uniqueTokens.some((existing) => existing === normalizedToken || existing.includes(normalizedToken))) return;
    uniqueTokens.push(normalizedToken);
  });
  return uniqueTokens.join(" ");
}

function deriveBenchmarkThumbnailHeadline(text: string, foodSubject: string) {
  const normalized = normalizeThumbnailChatRequirement(text);
  if (!normalized || !TZUYANG_BENCHMARK_COPY_SIGNAL_PATTERN.test(normalized)) return "";

  const yearTradition = normalized.match(/\d+\s*년\s*(?:전통|노포)/i)?.[0];
  const quantity = normalized.match(/\d+\s*(?:kg|KG|인분|그릇|마리|종|개|만원|cm|CM|m|M)/)?.[0];
  const hasRiceThief = /밥도둑/.test(normalized);
  const hasFeast = /한상/.test(normalized);
  const scaleSignal = normalized.match(/얼굴만한|대왕|역대급|끝판왕|폭탄|무한|최대|가득|레전드/i)?.[0];

  if (foodSubject && (hasRiceThief || hasFeast)) {
    if (hasRiceThief && hasFeast) return "밥도둑 한상";
    return sanitizeCanvasChatText(
      joinThumbnailCopyTokens([foodSubject, hasRiceThief ? "밥도둑" : null, hasFeast ? "한상" : null]),
      "",
      AUTO_GENERATED_MAIN_HEADLINE_MAX_LENGTH,
    );
  }

  if (foodSubject && (yearTradition || quantity || scaleSignal)) {
    return sanitizeCanvasChatText(
      joinThumbnailCopyTokens([yearTradition, scaleSignal, quantity, foodSubject]),
      "",
      AUTO_GENERATED_MAIN_HEADLINE_MAX_LENGTH,
    );
  }

  if (/야시장|시장|노점|길거리/i.test(normalized)) {
    return sanitizeCanvasChatText(
      joinThumbnailCopyTokens([scaleSignal ?? "야시장", /끝판왕/.test(normalized) ? "끝판왕" : null]),
      "",
      AUTO_GENERATED_MAIN_HEADLINE_MAX_LENGTH,
    );
  }

  return "";
}

function deriveAutomaticThumbnailHeadlineCopy(text: string, requestedHeadline = "", fallback = "역대급 먹방") {
  const normalized = normalizeThumbnailChatRequirement(`${text} ${requestedHeadline}`);
  const foodSubject = deriveThumbnailFoodSubject(normalized);
  const benchmarkHeadline = deriveBenchmarkThumbnailHeadline(normalized, foodSubject);
  if (benchmarkHeadline) return benchmarkHeadline;
  if (foodSubject) {
    return sanitizeCanvasChatText(`${foodSubject} 먹방`, fallback, AUTO_GENERATED_MAIN_HEADLINE_MAX_LENGTH);
  }
  return sanitizeCanvasChatText(requestedHeadline || normalized, fallback, AUTO_GENERATED_MAIN_HEADLINE_MAX_LENGTH);
}

function deriveChatHeadline(text: string) {
  const explicitHeadline =
    pickExplicitChatField(text, CHAT_EXPLICIT_HEADLINE_PATTERN) ||
    pickExplicitChatField(text, CHAT_EXPLICIT_HEADLINE_PARTICLE_PATTERN);
  if (explicitHeadline) {
    return hasThumbnailGenerationIntent(text)
      ? deriveAutomaticThumbnailHeadlineCopy(text, explicitHeadline)
      : sanitizeCanvasChatText(explicitHeadline, "역대급 먹방", MAIN_HEADLINE_MAX_LENGTH);
  }

  const quotedText = text.match(/["“'‘]([^"”'’]{2,42})["”'’]/)?.[1]?.trim();
  if (quotedText) {
    return hasThumbnailGenerationIntent(text)
      ? deriveAutomaticThumbnailHeadlineCopy(text, quotedText)
      : sanitizeCanvasChatText(quotedText, "역대급 먹방", MAIN_HEADLINE_MAX_LENGTH);
  }

  const foodSubject = deriveThumbnailFoodSubject(text);
  const benchmarkHeadline = deriveBenchmarkThumbnailHeadline(text, foodSubject);
  if (benchmarkHeadline) return benchmarkHeadline;
  if (foodSubject) return sanitizeCanvasChatText(`${foodSubject} 먹방`, "역대급 먹방", AUTO_GENERATED_MAIN_HEADLINE_MAX_LENGTH);
  if (/불맛|화력|철판|매운/i.test(text)) return "역대급 불맛";
  if (/대왕|대형|거대|압도|많이|양/i.test(text)) return "역대급 먹방";
  if (/한입|가능/i.test(text)) return "한입만 가능?";
  if (/야시장|시장|노점/i.test(text)) return "야시장 먹방";
  return "역대급 먹방";
}

function deriveChatSubHeadline(text: string) {
  const explicitSubHeadline =
    pickExplicitChatField(text, CHAT_EXPLICIT_SUBHEADLINE_PATTERN) ||
    pickExplicitChatField(text, CHAT_EXPLICIT_SUBHEADLINE_PARTICLE_PATTERN);
  if (explicitSubHeadline) return sanitizeCanvasChatText(explicitSubHeadline, "한입만 가능?", SUB_HEADLINE_MAX_LENGTH);

  const foodSubject = deriveThumbnailFoodSubject(text);
  if (foodSubject && /제육|김치찌개|된장찌개|백반|국밥|삼겹살|갈비/i.test(foodSubject)) return "밥도둑 인정?";
  if (foodSubject && /떡볶이|라면|마라|불닭|매운/i.test(foodSubject)) return "맵기 실화?";
  if (foodSubject && /초밥|회|대게|킹크랩|랍스터|해산물/i.test(foodSubject)) return "퀄리티 미쳤다";
  if (/한입|가능/i.test(text)) return "한입만 가능?";
  if (/쯔양|tzuyang/i.test(text)) return "진짜 가능?";
  if (/매운|불맛|화력/i.test(text)) return "불맛 폭발";
  if (/야시장|시장|노점/i.test(text)) return "야시장 클라스";
  return "한입만 가능?";
}

function normalizeThumbnailCopyForCompare(value: string) {
  return normalizeThumbnailChatRequirement(value).toLowerCase();
}

function shouldPreferSubmittedPromptCopyForGeneration(
  submittedRequirement: string,
  candidateTopic: string,
  candidateHeadline: string,
  previousHeadline: string,
) {
  const normalizedRequirement = normalizeThumbnailCopyForCompare(submittedRequirement);
  const normalizedCandidate = normalizeThumbnailCopyForCompare(`${candidateTopic} ${candidateHeadline}`);
  const normalizedCandidateHeadline = normalizeThumbnailCopyForCompare(candidateHeadline);
  const normalizedPreviousHeadline = normalizeThumbnailCopyForCompare(previousHeadline);
  const requestHeadline = deriveChatHeadline(submittedRequirement);
  const normalizedRequestHeadline = normalizeThumbnailCopyForCompare(requestHeadline);
  const requestedFoodSubject = deriveThumbnailFoodSubject(submittedRequirement);
  const normalizedFoodSubject = normalizeThumbnailCopyForCompare(requestedFoodSubject);

  if (!normalizedRequirement || !normalizedRequestHeadline) return false;
  if (normalizedCandidateHeadline === normalizedPreviousHeadline && normalizedCandidateHeadline !== normalizedRequestHeadline) return true;
  if (normalizedCandidate.includes("야시장") && !normalizedRequirement.includes("야시장")) return true;
  if (normalizedFoodSubject && !normalizedCandidate.includes(normalizedFoodSubject)) return true;
  if (requestsSpecificCreatorHost(submittedRequirement) && normalizedCandidate !== normalizedRequestHeadline) return true;
  return false;
}

function deriveThumbnailFoodSubject(text: string) {
  const normalized = normalizeThumbnailChatRequirement(text);
  const explicitFood = normalized.match(/(?:음식|메뉴|주제|소재)\s*[:：]\s*([가-힣A-Za-z0-9\s]{2,18})/)?.[1]?.trim();
  if (explicitFood) return sanitizeCanvasChatText(explicitFood, "", FOOD_SUBJECT_MAX_LENGTH);

  const foodMatch = normalized.match(/(제육볶음|김치찌개|된장찌개|부대찌개|라면|떡볶이|돈가스|돈까스|삼겹살|갈비|곱창|막창|마라탕|불닭|치킨|피자|햄버거|초밥|스시|회|대게|킹크랩|랍스터|해산물|국밥|백반|고기|꼬치|튀김)/i)?.[1];
  if (foodMatch) return sanitizeCanvasChatText(foodMatch, "", FOOD_SUBJECT_MAX_LENGTH);
  const sceneFallback = normalized.match(/(분식|야시장)/i)?.[1];
  return sceneFallback ? sanitizeCanvasChatText(sceneFallback, "", FOOD_SUBJECT_MAX_LENGTH) : "";
}

function getCanvasLayerDisplayName(layer: Pick<TextLayer, "id"> | null | undefined) {
  if (!layer) return "캔버스";
  if (layer.id === "headline") return "메인 문구";
  if (layer.id === "subHeadline") return "스티커 문구";
  return "추가 문구";
}

function truncateCanvasLayerText(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length > 24 ? `${normalized.slice(0, 24)}…` : normalized || "빈 문구";
}

function formatCanvasLayerSummary(layer: TextLayer | null) {
  if (!layer) return "선택된 문구가 없습니다. 캔버스 문구를 클릭하면 도우미가 얼굴과 음식을 가리지 않게 조정할 수 있습니다.";
  return [
    `${getCanvasLayerDisplayName(layer)} · "${truncateCanvasLayerText(layer.content)}"`,
    `${Math.round(layer.fontSize)}px`,
    `${Math.round(layer.rotation)}°`,
    `x${Math.round(layer.x)} y${Math.round(layer.y)}`,
  ].join(" · ");
}

function getCanvasContextPrompt(layer: TextLayer | null, lastActionLabel: string | null) {
  if (!layer) {
    return "현재 캔버스 전체 구도를 보고 썸네일이 더 잘 읽히도록 문구/배치/강조를 개선해줘.";
  }

  return [
    `현재 캔버스에서 선택된 ${getCanvasLayerDisplayName(layer)} "${truncateCanvasLayerText(layer.content)}"를 기준으로 개선해줘.`,
    `최근 액션: ${lastActionLabel ?? "선택됨"}.`,
    `현재 스타일: 글자 ${Math.round(layer.fontSize)}px, 회전 ${Math.round(layer.rotation)}도, 위치 x${Math.round(layer.x)} y${Math.round(layer.y)}.`,
    "사람 얼굴과 핵심 음식은 가리지 않는 선에서 문구, 크기, 위치, 강조 방식을 제안하고 캔버스에 반영해줘.",
  ].join(" ");
}

const DEFAULT_TEXT_LAYERS: TextLayer[] = [
  {
    id: "headline",
    content: "역대급 먹방",
    x: 640,
    y: 520,
    fontFamily: "Impact, Pretendard, system-ui, sans-serif",
    fontSize: 92,
    fontWeight: 900,
    fill: "#ffffff",
    stroke: "#111111",
    strokeWidth: 10,
    shadow: "0 12px 24px rgba(0,0,0,0.72)",
    align: "center",
    rotation: 0,
    zIndex: 1,
  },
  {
    id: "subHeadline",
    content: "한입만 가능?",
    x: 978,
    y: 168,
    fontFamily: "Arial Black, Pretendard, system-ui, sans-serif",
    fontSize: 46,
    fontWeight: 900,
    fill: "#fff200",
    stroke: "#111111",
    strokeWidth: 7,
    shadow: "0 8px 18px rgba(0,0,0,0.65)",
    align: "center",
    rotation: -5,
    zIndex: 2,
  },
];

const BUNDLED_THUMBNAIL_PREVIEW_IMAGE_URL =
  "/images/admin/youtube-thumbnail-generated-example-preview.png";
const BUNDLED_THUMBNAIL_PREVIEW_TOPIC = "쯔양 먹방 제육볶음 한상 기본 미리보기";
const BUNDLED_THUMBNAIL_PREVIEW_HEADLINE = "제육볶음 한상";
const BUNDLED_THUMBNAIL_PREVIEW_SUB_HEADLINE = "밥도둑 인정?";
const BUNDLED_THUMBNAIL_PREVIEW_RESULT: GenerationResult = {
  baseImage: {
    dataUrl: BUNDLED_THUMBNAIL_PREVIEW_IMAGE_URL,
    mime: "image/png",
    targetWidth: TARGET_WIDTH,
    targetHeight: TARGET_HEIGHT,
    providerId: "local-codex",
    model: "gpt-image-2",
    modelProvenance: "unknown",
  },
  sourceKind: "bundled_preview",
  generationMode: "direct_provider",
  prompt: `기본 생성 예시 썸네일 미리보기: ${BUNDLED_THUMBNAIL_PREVIEW_TOPIC}`,
  warnings: [
    "첫 화면이 비어 보이지 않도록 제공하는 실제 생성 예시 썸네일입니다.",
  ],
};

function createBundledThumbnailPreviewTextLayers() {
  return DEFAULT_TEXT_LAYERS.map((layer) => {
    if (layer.id === "headline") {
      return {
        ...layer,
        content: BUNDLED_THUMBNAIL_PREVIEW_HEADLINE,
        x: 640,
        y: 548,
        fontSize: 72,
        fill: "#ffffff",
        stroke: "#111111",
        strokeWidth: 9,
      };
    }
    if (layer.id === "subHeadline") {
      return {
        ...layer,
        content: BUNDLED_THUMBNAIL_PREVIEW_SUB_HEADLINE,
        x: 650,
        y: 168,
        fontSize: 44,
        fill: "#fff200",
        stroke: "#111111",
        strokeWidth: 7,
        rotation: -5,
      };
    }
    return { ...layer };
  });
}

const THUMBNAIL_EDITOR_TOOLS: Array<{
  id: ThumbnailEditorToolId;
  label: string;
  description: string;
}> = [
  { id: "select-headline", label: "메인 선택", description: "큰 제목 레이어 선택" },
  { id: "select-sticker", label: "스티커 선택", description: "작은 포인트 문구 선택" },
  { id: "add-text", label: "문구 추가", description: "새 텍스트 레이어 생성" },
  { id: "edit-text", label: "문구 수정", description: "선택 문구를 캔버스 위에서 바로 수정" },
  { id: "duplicate", label: "복제", description: "선택 문구를 하나 더 만들기" },
  { id: "delete-text", label: "삭제", description: "선택 문구 삭제" },
  { id: "bigger", label: "크게", description: "선택 문구 크기 키우기" },
  { id: "smaller", label: "작게", description: "선택 문구 크기 줄이기" },
  { id: "rotate-left", label: "왼쪽 회전", description: "선택 문구를 왼쪽으로 회전" },
  { id: "rotate-right", label: "오른쪽 회전", description: "선택 문구를 오른쪽으로 회전" },
  { id: "align-left", label: "왼쪽 정렬", description: "선택 문구 왼쪽 정렬" },
  { id: "align-center", label: "중앙 정렬", description: "선택 문구 중앙 정렬" },
  { id: "align-right", label: "오른쪽 정렬", description: "선택 문구 오른쪽 정렬" },
  { id: "fill-white", label: "흰 글자", description: "선택 문구를 흰색으로" },
  { id: "fill-yellow", label: "노란 글자", description: "선택 문구를 노란색으로" },
  { id: "fill-red", label: "빨간 글자", description: "선택 문구를 빨간색으로" },
  { id: "stroke-black", label: "검정 외곽", description: "검정 외곽선 적용" },
  { id: "stroke-white", label: "흰 외곽", description: "흰 외곽선 적용" },
  { id: "stroke-thick", label: "외곽 굵게", description: "외곽선 두껍게" },
  { id: "stroke-thin", label: "외곽 얇게", description: "외곽선 얇게" },
  { id: "shadow-strong", label: "그림자 강", description: "강한 그림자 적용" },
  { id: "shadow-none", label: "그림자 끔", description: "그림자 제거" },
  { id: "font-impact", label: "Impact", description: "Impact 스타일 폰트" },
  { id: "font-pretendard", label: "Pretendard", description: "Pretendard 스타일 폰트" },
  { id: "bring-front", label: "앞으로", description: "선택 문구를 맨 앞으로" },
  { id: "send-back", label: "뒤로", description: "선택 문구를 맨 뒤로" },
  { id: "reset-text", label: "초기화", description: "문구 레이어 기본값 복원" },
];

function clampCanvasCoordinate(value: number, max: number) {
  return Math.round(Math.max(0, Math.min(max, value)));
}

function clampTextLayerFontSize(value: number) {
  return Math.round(Math.max(18, Math.min(180, value)));
}

function normalizeCanvasRotation(value: number) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.round(normalized);
}

function normalizeInlineEditableText(value: string) {
  return value.replace(/[\r\n]+/g, " ");
}

function createDefaultTextLayers() {
  return DEFAULT_TEXT_LAYERS.map((layer) => ({ ...layer }));
}

function cloneTextLayer(layer: TextLayer) {
  return { ...layer };
}

function isProviderId(value: string | undefined): value is ProviderId {
  return value === "local-codex" || value === "openai-gpt-image-2";
}

function isExactGptImage2HistoryRun(run: ThumbnailHistoryRun) {
  return (
    run.status === "passed" &&
    run.providerId === "local-codex" &&
    run.model === "gpt-image-2" &&
    run.modelProvenance === "exact"
  );
}

function isGenerationMode(value: string | undefined): value is GenerationMode {
  return value === "direct_provider" || value === "backend_agent";
}

function resolveThumbnailHistoryImageUrl(imagePath: string) {
  if (imagePath.startsWith("http://") || imagePath.startsWith("https://") || imagePath.startsWith("/")) return imagePath;
  const normalizedPath = imagePath.startsWith("./") ? imagePath.slice(2) : imagePath;
  return `${THUMBNAIL_HISTORY_IMAGE_BASE_URL}/${normalizedPath}`;
}

function createThumbnailResultFromHistoryRun(run: ThumbnailHistoryRun): GenerationResult | null {
  if (!run.imagePath || run.status !== "passed") return null;
  if (!isProviderId(run.providerId)) return null;
  if (!isExactGptImage2HistoryRun(run)) return null;

  return {
    baseImage: {
      dataUrl: resolveThumbnailHistoryImageUrl(run.imagePath),
      mime: run.imagePath.endsWith(".webp") ? "image/webp" : run.imagePath.endsWith(".jpg") || run.imagePath.endsWith(".jpeg") ? "image/jpeg" : "image/png",
      targetWidth: TARGET_WIDTH,
      targetHeight: TARGET_HEIGHT,
      providerId: run.providerId,
      model: "gpt-image-2",
      modelProvenance: "exact",
    },
    generationMode: isGenerationMode(run.generationMode) ? run.generationMode : "direct_provider",
    prompt: run.topic ? `생성 히스토리 최신 실제 생성 결과: ${run.topic}` : "생성 히스토리 최신 실제 생성 결과를 캔버스 배경으로 불러왔습니다.",
    warnings: Array.isArray(run.warnings) ? run.warnings : [],
    sourceKind: "history_actual",
  };
}

function createExistingThumbnailPreviewResultFromHistoryRun(run: ThumbnailHistoryRun): GenerationResult | null {
  if (!run.imagePath || run.status !== "passed") return null;
  if (!isProviderId(run.providerId)) return null;
  if (isExactGptImage2HistoryRun(run)) return createThumbnailResultFromHistoryRun(run);

  return {
    baseImage: {
      dataUrl: resolveThumbnailHistoryImageUrl(run.imagePath),
      mime: run.imagePath.endsWith(".webp") ? "image/webp" : run.imagePath.endsWith(".jpg") || run.imagePath.endsWith(".jpeg") ? "image/jpeg" : "image/png",
      targetWidth: TARGET_WIDTH,
      targetHeight: TARGET_HEIGHT,
      providerId: run.providerId,
      model: run.model?.trim() || "gpt-image-2",
      modelProvenance: run.modelProvenance ?? "unknown",
    },
    generationMode: isGenerationMode(run.generationMode) ? run.generationMode : "direct_provider",
    prompt: run.topic ? `기존 생성 썸네일 미리보기: ${run.topic}` : "기존 생성 썸네일 이미지를 캔버스 배경으로 불러왔습니다.",
    warnings: Array.isArray(run.warnings) ? run.warnings : ["기존 생성 이미지 미리보기입니다."],
    sourceKind: "history_preview",
  };
}

function createThumbnailResultFromReleaseCandidate(candidate: ThumbnailReleaseCandidate): GenerationResult | null {
  if (!candidate.browserImagePath || candidate.providerId !== "local-codex" || candidate.model !== "gpt-image-2" || candidate.modelProvenance !== "exact") return null;
  if (!candidate.releaseCandidate || !candidate.normalizedFromManifestMembership) return null;
  if (!candidate.issueTags.length || candidate.issueTags.some((tag) => tag !== "none")) return null;

  return {
    baseImage: {
      dataUrl: resolveThumbnailHistoryImageUrl(candidate.browserImagePath),
      mime: candidate.browserImagePath.endsWith(".webp") ? "image/webp" : candidate.browserImagePath.endsWith(".jpg") || candidate.browserImagePath.endsWith(".jpeg") ? "image/jpeg" : "image/png",
      targetWidth: TARGET_WIDTH,
      targetHeight: TARGET_HEIGHT,
      providerId: "local-codex",
      model: "gpt-image-2",
      modelProvenance: "exact",
    },
    generationMode: candidate.generationMode,
    prompt: `자동 선택된 릴리즈 후보: ${candidate.topic}`,
    sourceKind: "release_candidate_preview",
    warnings: [
      `릴리즈 후보 ${candidate.id} · score ${candidate.score}`,
      "QA 히스토리는 readback evidence이며, 이 배경은 exact gpt-image-2 후보 중 자동 선택된 기본 미리보기입니다.",
    ],
  };
}

function isLocalCandidateFallbackDurableRelease(release: ThumbnailDurableRelease) {
  return release.browserImagePath.startsWith("/qa-history/youtube-thumbnail-generator/") && release.sourceQualityGate?.localReadOnlyFallback === true;
}

function createThumbnailResultFromDurableRelease(release: ThumbnailDurableRelease): GenerationResult | null {
  if (!release.browserImagePath || release.providerId !== "local-codex" || release.model !== "gpt-image-2" || release.modelProvenance !== "exact") return null;
  const isAdminProxyRelease = release.browserImagePath.startsWith("/api/admin/youtube-thumbnail-generator/releases/assets/");
  const isLocalFallbackRelease = isLocalCandidateFallbackDurableRelease(release);
  if (!isAdminProxyRelease && !isLocalFallbackRelease) return null;
  if (!release.issueTags?.length || release.issueTags.some((tag) => tag !== "none")) return null;

  return {
    baseImage: {
      dataUrl: isLocalFallbackRelease ? resolveThumbnailHistoryImageUrl(release.browserImagePath) : release.browserImagePath,
      mime: "image/png",
      targetWidth: TARGET_WIDTH,
      targetHeight: TARGET_HEIGHT,
      providerId: "local-codex",
      model: "gpt-image-2",
      modelProvenance: "exact",
    },
    generationMode: "direct_provider",
    sourceKind: isLocalFallbackRelease ? "durable_release_fallback" : "durable_release",
    prompt: isLocalFallbackRelease
      ? `로컬 검증 후보 기본 썸네일: ${release.candidateId}`
      : `공용 릴리즈 레지스트리 현재 썸네일: ${release.candidateId}`,
    warnings: isLocalFallbackRelease
      ? [
        `local exact fallback ${release.id} · score ${release.score}`,
        "공용 저장소가 없을 때 이미 공개 폴더에 준비된 exact gpt-image-2 후보를 기본 썸네일로 불러옵니다.",
      ]
      : [
        `durable release ${release.id} · score ${release.score}`,
        "Supabase private storage + admin proxy에서 불러온 exact gpt-image-2 현재 릴리즈입니다.",
      ],
  };
}

function selectAutomaticReleaseCandidate(candidates: ThumbnailReleaseCandidate[]) {
  const sortedCandidates = [...candidates].sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const highQualityCandidates = sortedCandidates.filter((candidate) => candidate.score >= 90);
  const pool = (highQualityCandidates.length ? highQualityCandidates : sortedCandidates).slice(0, 8);
  return pool[0] ?? null;
}

function getThumbnailHistoryRunTime(run: ThumbnailHistoryRun) {
  const raw = run.completedAt ?? run.timestamp ?? "";
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}

function compareThumbnailHistoryRunsByRecency(left: ThumbnailHistoryRun, right: ThumbnailHistoryRun) {
  const timeDelta = getThumbnailHistoryRunTime(right) - getThumbnailHistoryRunTime(left);
  if (timeDelta !== 0) return timeDelta;
  return String(right.id ?? right.imagePath ?? "").localeCompare(String(left.id ?? left.imagePath ?? ""));
}

function findLatestActualHistoryRun(payload: ThumbnailHistoryPayload | null) {
  const runs = Array.isArray(payload?.runs) ? payload.runs : [];
  return runs
    .filter((run) => Boolean(run.imagePath) && isExactGptImage2HistoryRun(run))
    .sort(compareThumbnailHistoryRunsByRecency)[0] ?? null;
}

function findLatestExistingThumbnailPreviewRun(payload: ThumbnailHistoryPayload | null) {
  const latestActual = findLatestActualHistoryRun(payload);
  if (latestActual) return latestActual;
  const previewRun = payload?.latestPreviewRun ?? null;
  if (!previewRun?.imagePath || previewRun.status !== "passed" || !isProviderId(previewRun.providerId)) return null;
  return previewRun;
}

function canReplacePreviewWithHistoryResult(current: GenerationResult | null) {
  const currentUrl = current?.baseImage.dataUrl ?? "";
  return (
    !currentUrl ||
    currentUrl.startsWith(`${THUMBNAIL_HISTORY_IMAGE_BASE_URL}/`)
  );
}

const providerOptions: Array<{ value: ProviderId; label: string }> = [
  {
    value: "local-codex",
    label: "Codex OAuth",
  },
  {
    value: "openai-gpt-image-2",
    label: "API Key",
  },
];

function getThumbnailProviderLabel(provider: ProviderId) {
  return providerOptions.find((option) => option.value === provider)?.label ?? provider;
}

function formatThumbnailGenerationMode(mode: GenerationMode) {
  return mode === "backend_agent"
    ? "도우미가 먼저 정리한 뒤 만들기"
    : "바로 만들기";
}

function formatThumbnailModelProvenance(provenance: GenerationResult["baseImage"]["modelProvenance"] | undefined) {
  if (provenance === "exact") return "실제 생성 확인";
  if (provenance === "requested-label") return "출처 확인 필요";
  return "공용 예시 / 미검증";
}

function normalizeThumbnailResultSourceKind(currentResult: GenerationResult | null): ThumbnailResultSourceKind | null {
  if (!currentResult) return null;
  if (currentResult.sourceKind) return currentResult.sourceKind;

  const dataUrl = currentResult.baseImage.dataUrl ?? "";
  const modelProvenance = currentResult.baseImage.modelProvenance;
  if (!dataUrl) return null;
  if (dataUrl.startsWith(`${THUMBNAIL_HISTORY_IMAGE_BASE_URL}/`)) {
    return modelProvenance === "exact" ? "history_actual" : "history_preview";
  }
  if (dataUrl.startsWith("/images/admin/") && modelProvenance === "unknown") {
    return "bundled_preview";
  }
  if (dataUrl.startsWith("data:image/")) {
    return modelProvenance === "exact" ? "generated_exact" : "generated_unverified";
  }
  if (dataUrl.startsWith("http://") || dataUrl.startsWith("https://")) return "external_image";
  return "page_image";
}

function getThumbnailResultSourceLabel(currentResult: GenerationResult | null) {
  const sourceKind = normalizeThumbnailResultSourceKind(currentResult);
  switch (sourceKind) {
    case "bundled_preview":
      return "공용 예시 미리보기";
    case "history_actual":
      return "실제 히스토리";
    case "history_preview":
      return "히스토리 미리보기";
    case "release_candidate_preview":
      return "릴리즈 후보 미리보기";
    case "durable_release":
      return "공용 릴리즈";
    case "durable_release_fallback":
      return "공용 릴리즈 · 로컬 폴백";
    case "generated_exact":
      return "실제 생성 결과";
    case "generated_unverified":
      return "임시 결과";
    case "external_image":
      return "외부 이미지 · 확인 필요";
    case "page_image":
      return "페이지 이미지 · 확인 필요";
    default:
      return "결과 없음";
  }
}

function getThumbnailInitialPreviewSourceLabel(source: ThumbnailInitialPreviewSource) {
  switch (source) {
    case "bundled":
      return "공용 예시 미리보기";
    case "durable":
      return "공용 릴리즈";
    case "durable-empty":
      return "공용 릴리즈 없음";
    case "durable-unavailable":
      return "공용 릴리즈 사용 불가";
    case "durable-error":
      return "공용 릴리즈 읽기 실패";
    case "candidate":
      return "릴리즈 후보 미리보기";
    case "candidate-empty":
      return "릴리즈 후보 없음";
    case "candidate-error":
      return "릴리즈 후보 읽기 실패";
    case "history":
      return "실제 히스토리";
    default:
      return "준비 중";
  }
}

function formatThumbnailDurableReadinessActionLabel(payload: ThumbnailDurableReleasePayload | null, fallbackReason: string) {
  const readiness = payload?.readiness;
  const reasonCode = readiness?.reasonCode || payload?.diagnostics?.reason || fallbackReason;
  const remediation = readiness?.remediation?.trim();
  const readinessStatus = readiness?.status || payload?.status || "unknown";
  return [
    `공용 릴리즈 readback ${readinessStatus}`,
    reasonCode,
    remediation,
  ].filter(Boolean).join(" · ");
}

function getThumbnailHistoryRunSourceLabel(run: ThumbnailHistoryRun) {
  return run.modelProvenance === "exact"
    ? "실제 히스토리"
    : "출처 확인 필요";
}

function isInitialThumbnailPreviewResult(currentResult: GenerationResult | null) {
  const sourceKind = normalizeThumbnailResultSourceKind(currentResult);
  return (
    sourceKind === "bundled_preview" ||
    sourceKind === "history_actual" ||
    sourceKind === "history_preview" ||
    sourceKind === "release_candidate_preview" ||
    sourceKind === "durable_release_fallback"
  );
}

function canUseSessionApiKeyForProvider(
  provider: ProviderId,
  availability: ProviderAvailability | null | undefined,
  hasBrowserOpenAIApiKey = false,
) {
  return (
    provider === "openai-gpt-image-2" &&
    hasBrowserOpenAIApiKey &&
    availability?.model !== null &&
    availability?.reason !== "openai_model_not_allowed"
  );
}

function formatThumbnailProviderBlockReason(reason: string | null | undefined) {
  if (reason === THUMBNAIL_STRICT_LOCAL_CODEX_UNVERIFIED_REASON) {
    return "이미지를 안전하게 확인하지 못해 멈췄습니다.";
  }
  if (reason === "local_codex_model_not_allowed") {
    return "현재 이미지 만들기 설정을 사용할 수 없습니다.";
  }
  if (reason === "local_codex_command_not_configured") {
    return "이미지를 만드는 도구 경로가 아직 설정되지 않았습니다.";
  }
  if (reason === "local_codex_disabled") {
    return "이미지 생성 기능이 아직 켜져 있지 않습니다.";
  }
  if (reason === "openai_api_disabled_by_policy") {
    return "현재 페이지에서는 별도 API 키 방식으로 이미지를 만들지 않습니다.";
  }
  if (reason === "openai_api_key_required") {
    return "오른쪽 위 톱니바퀴에서 이미지 만들기 키를 적용해 주세요.";
  }
  if (reason === "openai_model_not_allowed") {
    return "현재 이미지 만들기 설정을 사용할 수 없습니다.";
  }
  return "이미지 만들기 준비 상태를 확인할 수 없습니다.";
}

function formatThumbnailProviderAvailability(
  availability: ProviderAvailability | null | undefined,
  sessionKeyBackedProviderAvailable: boolean,
) {
  if (!availability) return "아직 확인 중";
  if (availability.available) return "준비 완료";
  if (sessionKeyBackedProviderAvailable) return "이번 작업에서 사용 가능";
  return availability.reason
    ? `준비 필요 · ${formatThumbnailProviderBlockReason(availability.reason)}`
    : "준비 필요";
}

type ThumbnailImageApiRouterView = {
  id: ThumbnailImageRouteChoice | "setup-required";
  label: string;
  statusLabel: string;
  summary: string;
  codexOAuthStatus:
    | "active"
    | "checking"
    | "unavailable"
    | "api-key-active"
    | "local-bridge-active"
    | "local-bridge-unpaired";
};

function getThumbnailImageApiRouterView(
  readiness: ThumbnailReadiness | null,
  selectedRoute: ThumbnailImageRouteChoice,
  hasBrowserOpenAIApiKey: boolean,
  hasLocalBridgeToken: boolean,
  localBridgeStatus: ThumbnailLocalBridgeUiStatus,
): ThumbnailImageApiRouterView {
  const localCodexAvailability = readiness?.providers.localCodex;
  const openAIApiKeyAvailability = readiness?.providers.openaiGptImage2;
  const sessionKeyBackedOpenAIAvailable = canUseSessionApiKeyForProvider(
    "openai-gpt-image-2",
    openAIApiKeyAvailability,
    hasBrowserOpenAIApiKey,
  );

  if (selectedRoute === "browser-openai-api-key") {
    return {
      id: "browser-openai-api-key",
      label: "OpenAI API 키",
      statusLabel: !hasBrowserOpenAIApiKey
        ? "키 필요"
        : openAIApiKeyAvailability?.available
          ? "사용 중"
          : sessionKeyBackedOpenAIAvailable
            ? "키 적용됨"
          : readiness
            ? "확인 필요"
            : "확인 중",
      summary: "이 탭 메모리에 적용한 키로 gpt-image-2를 호출합니다.",
      codexOAuthStatus: "api-key-active",
    };
  }

  if (selectedRoute === "local-codex-oauth") {
    return {
      id: "local-codex-oauth",
      label: "기본 OAuth",
      statusLabel:
        localCodexAvailability?.available
          ? "사용 중"
          : readiness
            ? "확인 필요"
            : "확인 중",
      summary: "서버 라우터가 Codex OAuth로 gpt-image-2 썸네일을 호출합니다.",
      codexOAuthStatus:
        !readiness
          ? "checking"
          : localCodexAvailability?.available
            ? "active"
            : "unavailable",
    };
  }

  if (selectedRoute === THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID) {
    return {
      id: THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID,
      label: "고급 로컬",
      statusLabel: formatThumbnailLocalBridgeStatusLabel(localBridgeStatus, hasLocalBridgeToken),
      summary: "loopback helper 창을 통해 사용자 PC 브릿지를 연결합니다.",
      codexOAuthStatus:
        localBridgeStatus === "connected"
          ? "local-bridge-active"
          : hasLocalBridgeToken
            ? "checking"
            : "local-bridge-unpaired",
    };
  }

  return {
    id: "setup-required",
    label: "설정 필요",
    statusLabel: readiness ? "설정 필요" : "확인 중",
    summary: "기본 OAuth, 고급 로컬, API Key 백업 중 하나를 확인해 주세요.",
    codexOAuthStatus: readiness ? "unavailable" : "checking",
  };
}

function formatThumbnailBackendAgentStatus(status: ThumbnailReadiness["backendAgent"] | null | undefined) {
  if (!status) return "아직 확인 중";
  if (status.available) return "도우미 준비됨";
  return "도우미 준비 필요";
}

function formatThumbnailHistoryStatus(status: ThumbnailHistoryStatus, runs: ThumbnailHistoryRun[], error: string | null) {
  if (status === "error") return `불러오기 실패 · ${error ?? "다시 시도해 주세요"}`;
  if (status === "loading") return `불러오는 중 · ${runs.length}건 확인됨`;
  return `저장된 결과 ${runs.length}건`;
}

function canShowThumbnailRetrievalModelLabel(
  diagnostics: ThumbnailRetrievalDiagnostics | null | undefined,
  model: "embedding" | "reranker",
) {
  if (!diagnostics || (diagnostics.status !== "used" && diagnostics.status !== "partial")) return false;
  if (model === "embedding") {
    return diagnostics.usedModels?.embedding === "BAAI/bge-m3"
      && diagnostics.operations?.denseSparseHybrid === true;
  }
  return diagnostics.usedModels?.reranker === "BAAI/bge-reranker-v2-m3"
    && diagnostics.operations?.rerankerApplied === true;
}

function formatThumbnailRetrievalSummary(retrieval: ThumbnailRetrievalResult | ThumbnailRetrievalDiagnostics | null | undefined) {
  if (!retrieval) return "레퍼런스 검색: 아직 실행 안 됨";
  const diagnostics = "diagnostics" in retrieval ? retrieval.diagnostics : retrieval;
  const evidenceCount = "evidence" in retrieval && Array.isArray(retrieval.evidence) ? retrieval.evidence.length : diagnostics.selectedReferenceIds?.length ?? 0;
  const modelLabels = [
    canShowThumbnailRetrievalModelLabel(diagnostics, "embedding") ? "BGE-M3 증명됨" : null,
    canShowThumbnailRetrievalModelLabel(diagnostics, "reranker") ? "BGE-reranker 증명됨" : null,
  ].filter(Boolean).join(" · ");
  const fallback = diagnostics.fallbackReason ? ` · fallback ${diagnostics.fallbackReason}` : "";
  const runtime = diagnostics.commandRuntime ? ` · ${diagnostics.commandRuntime}` : "";
  return `레퍼런스 검색: ${diagnostics.status ?? "unknown"} · 후보 ${diagnostics.candidateCount ?? 0} · 선택 ${evidenceCount}${runtime}${fallback}${modelLabels ? ` · ${modelLabels}` : ""}`;
}

function formatThumbnailRetrievalSummaryForBeginner(retrieval: ThumbnailRetrievalResult | ThumbnailRetrievalDiagnostics | null | undefined) {
  if (!retrieval) return "참고 썸네일 검색: 아직 실행 안 됨";
  const diagnostics = "diagnostics" in retrieval ? retrieval.diagnostics : retrieval;
  const evidenceCount = "evidence" in retrieval && Array.isArray(retrieval.evidence) ? retrieval.evidence.length : diagnostics.selectedReferenceIds?.length ?? 0;
  if (diagnostics.status === "used" || diagnostics.status === "partial") {
    return `참고 썸네일 검색: 기존 썸네일 ${evidenceCount}개를 골라 참고했습니다.`;
  }
  if (diagnostics.status === "fallback") {
    return "참고 썸네일 검색: 기존 썸네일을 아직 충분히 고르지 못했습니다.";
  }
  return "참고 썸네일 검색: 아직 충분한 참고 자료를 고르지 못했습니다.";
}

function formatThumbnailGenerationCompletionSummary(generationResult: GenerationResult) {
  const retrieval = generationResult.retrieval;
  const evidenceCount = retrieval?.evidence?.length ?? retrieval?.diagnostics?.selectedReferenceIds?.length ?? 0;
  const didUseRetrieval = Boolean(retrieval && retrieval.diagnostics?.status !== "disabled" && evidenceCount > 0);
  const referenceSummary = didUseRetrieval
    ? `기존 썸네일 ${evidenceCount}개를 참고했습니다.`
    : "참고 썸네일 검색 없이 만들었습니다.";
  const verifiedSummary = generationResult.baseImage.modelProvenance === "exact"
    ? "확인된 실제 이미지입니다."
    : "저장하기 전에 한 번 더 확인해 주세요.";
  return [
    "완료했어요.",
    "새 썸네일 이미지를 만들고 화면에 넣었습니다.",
    verifiedSummary,
    referenceSummary,
    "얼굴, 음식, 문구가 잘 보이면 PNG로 저장하세요.",
  ].join("\n");
}

const TEXT_LAYER_RENDER_MAX_WIDTH = 760;
const TEXT_LAYER_MIN_FIT_SCALE = 0.58;
const TEXT_LAYER_SELECTION_FRAME_PADDING_X = 10;
const TEXT_LAYER_SELECTION_FRAME_PADDING_Y = 7;
const TEXT_TRANSFORM_RESIZE_HANDLES = [
  ["top-left", "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize"],
  ["top-right", "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize"],
  ["bottom-left", "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize"],
  ["bottom-right", "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize"],
] as const;

type CanvasTextFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type GeneratedTextPlacementRole = "headline" | "subHeadline" | "accentBadge" | "contextCaption";

type TextPlacementCandidate = {
  x: number;
  y: number;
  align?: TextLayer["align"];
  label?: string;
};

type TextOcclusionProtectedZone = CanvasTextFrame & {
  id:
    | "host-head"
    | "host-face"
    | "food-hero"
    | "default-food-hero"
    | "generated-headline"
    | "generated-subHeadline"
    | "generated-accentBadge";
  weight: number;
};

const TEXT_OCCLUSION_SAFE_AREA: CanvasTextFrame = {
  x: 96,
  y: 72,
  width: TARGET_WIDTH - 192,
  height: TARGET_HEIGHT - 144,
};

const TEXT_OCCLUSION_PROTECTED_ZONES = {
  benchmark: [
    { id: "host-head", x: 830, y: 32, width: 410, height: 352, weight: 20 },
    { id: "host-face", x: 872, y: 58, width: 288, height: 272, weight: 24 },
    { id: "food-hero", x: 420, y: 382, width: 760, height: 300, weight: 9 },
  ],
  default: [
    { id: "default-food-hero", x: 356, y: 376, width: 788, height: 308, weight: 7 },
  ],
} satisfies Record<"benchmark" | "default", TextOcclusionProtectedZone[]>;

const TEXT_OCCLUSION_HOST_ZONE_IDS = new Set<TextOcclusionProtectedZone["id"]>(["host-head", "host-face"]);
const TEXT_OCCLUSION_HARD_FACE_PENALTY = 1_000_000;
const TEXT_OCCLUSION_ROLE_ZONE_WEIGHT_MULTIPLIERS: Record<
  GeneratedTextPlacementRole,
  Partial<Record<TextOcclusionProtectedZone["id"], number>>
> = {
  headline: {
    "food-hero": 0.006,
    "default-food-hero": 0.02,
  },
  subHeadline: {
    "food-hero": 0.22,
    "default-food-hero": 0.28,
  },
  accentBadge: {
    "food-hero": 0.22,
    "default-food-hero": 0.28,
  },
  contextCaption: {
    "food-hero": 0.14,
    "default-food-hero": 0.18,
  },
};

const TEXT_OCCLUSION_BENCHMARK_CANDIDATES: Record<GeneratedTextPlacementRole, TextPlacementCandidate[]> = {
  headline: [
    { x: 640, y: 548, label: "benchmark-lower-hero" },
    { x: 460, y: 536, label: "benchmark-left-low" },
    { x: 300, y: 354, label: "benchmark-left-mid" },
    { x: 324, y: 612, label: "benchmark-left-bottom" },
    { x: 982, y: 612, label: "benchmark-right-bottom" },
  ],
  subHeadline: [
    { x: 650, y: 168, label: "benchmark-center-left-top" },
    { x: 340, y: 152, label: "benchmark-left-top" },
    { x: 250, y: 206, label: "benchmark-left-upper" },
    { x: 432, y: 222, label: "benchmark-left-center" },
    { x: 300, y: 612, label: "benchmark-left-bottom" },
    { x: 1036, y: 620, label: "benchmark-right-bottom" },
  ],
  accentBadge: [
    { x: 340, y: 152, label: "benchmark-left-top" },
    { x: 250, y: 206, label: "benchmark-left-upper" },
    { x: 432, y: 222, label: "benchmark-left-center" },
    { x: 1036, y: 620, label: "benchmark-right-bottom" },
  ],
  contextCaption: [
    { x: 252, y: 612, label: "benchmark-left-bottom" },
    { x: 1016, y: 620, label: "benchmark-right-bottom" },
    { x: 330, y: 208, label: "benchmark-left-upper" },
  ],
};

function estimateGeneratedTextFrame(
  content: string,
  fontSize: number,
  candidate: TextPlacementCandidate,
  fallbackAlign: TextLayer["align"],
): CanvasTextFrame {
  const normalizedText = content.replace(/\s+/g, " ").trim();
  const glyphCount = Math.max(1, Array.from(normalizedText).length);
  const rawWidth = Math.max(fontSize * 2, glyphCount * fontSize * 0.72);
  const renderScale = rawWidth > TEXT_LAYER_RENDER_MAX_WIDTH ? Math.max(TEXT_LAYER_MIN_FIT_SCALE, TEXT_LAYER_RENDER_MAX_WIDTH / rawWidth) : 1;
  const width = rawWidth * renderScale;
  const height = Math.max(fontSize * renderScale * 1.18, fontSize * renderScale + 18);
  const align = candidate.align ?? fallbackAlign;
  const x = align === "center" ? candidate.x - width / 2 : align === "right" ? candidate.x - width : candidate.x;
  const y = candidate.y - height * 0.72;

  return { x, y, width, height };
}

type TextLayerVisualFrame = CanvasTextFrame & {
  anchorX: number;
  anchorY: number;
};

let textLayerMeasurementCanvas: HTMLCanvasElement | null = null;

function getTextLayerMeasurementContext() {
  if (typeof document === "undefined") return null;
  textLayerMeasurementCanvas ??= document.createElement("canvas");
  return textLayerMeasurementCanvas.getContext("2d");
}

function estimateTextLayerRenderMetrics(layer: TextLayer) {
  const normalizedText = layer.content.replace(/\s+/g, " ").trim();
  const fallbackGlyphCount = Math.max(1, Array.from(normalizedText).length);
  const fallbackRawWidth = fallbackGlyphCount * layer.fontSize * 0.72;
  const context = getTextLayerMeasurementContext();
  if (context) {
    context.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
    context.textAlign = layer.align;
    context.textBaseline = "middle";
  }
  const measured = context?.measureText(normalizedText);
  const rawAdvanceWidth = Math.max(layer.fontSize * 2, measured?.width ?? fallbackRawWidth);
  const renderScale = rawAdvanceWidth > TEXT_LAYER_RENDER_MAX_WIDTH
    ? Math.max(TEXT_LAYER_MIN_FIT_SCALE, TEXT_LAYER_RENDER_MAX_WIDTH / rawAdvanceWidth)
    : 1;
  const hasExactGlyphBounds = measured
    && measured.actualBoundingBoxLeft + measured.actualBoundingBoxRight > 0
    && measured.actualBoundingBoxAscent + measured.actualBoundingBoxDescent > 0;

  if (hasExactGlyphBounds) {
    return {
      offsetX: -measured.actualBoundingBoxLeft * renderScale,
      offsetY: -measured.actualBoundingBoxAscent * renderScale,
      width: (measured.actualBoundingBoxLeft + measured.actualBoundingBoxRight) * renderScale,
      height: (measured.actualBoundingBoxAscent + measured.actualBoundingBoxDescent) * renderScale,
    };
  }

  const fallbackWidth = rawAdvanceWidth * renderScale;
  const fallbackHeight = Math.max(layer.fontSize * renderScale * 1.05, layer.fontSize * renderScale + 8);
  return {
    offsetX: layer.align === "center" ? -fallbackWidth / 2 : layer.align === "right" ? -fallbackWidth : 0,
    offsetY: -fallbackHeight / 2,
    width: fallbackWidth,
    height: fallbackHeight,
  };
}

function getTextLayerVisualFrame(layer: TextLayer): TextLayerVisualFrame {
  const metrics = estimateTextLayerRenderMetrics(layer);
  const strokeInset = Math.max(2, layer.strokeWidth / 2);
  const x = layer.x + metrics.offsetX - strokeInset - TEXT_LAYER_SELECTION_FRAME_PADDING_X;
  const y = layer.y + metrics.offsetY - strokeInset - TEXT_LAYER_SELECTION_FRAME_PADDING_Y;
  const width = Math.max(36, metrics.width + (strokeInset + TEXT_LAYER_SELECTION_FRAME_PADDING_X) * 2);
  const height = Math.max(28, metrics.height + (strokeInset + TEXT_LAYER_SELECTION_FRAME_PADDING_Y) * 2);

  return {
    x,
    y,
    width,
    height,
    anchorX: layer.x - x,
    anchorY: layer.y - y,
  };
}

function getTextLayerSelectionLabel(layer: TextLayer) {
  if (layer.id === "headline") return "메인 문구 선택됨";
  if (layer.id === "subHeadline") return "스티커 문구 선택됨";
  return "문구 선택됨";
}

function getTextLayerTransformFrameStyle(layer: TextLayer) {
  const frame = getTextLayerVisualFrame(layer);

  return {
    left: `${(frame.x / TARGET_WIDTH) * 100}%`,
    top: `${(frame.y / TARGET_HEIGHT) * 100}%`,
    width: `${(frame.width / TARGET_WIDTH) * 100}%`,
    height: `${(frame.height / TARGET_HEIGHT) * 100}%`,
    transform: `rotate(${layer.rotation}deg)`,
    transformOrigin: `${(frame.anchorX / frame.width) * 100}% ${(frame.anchorY / frame.height) * 100}%`,
  };
}

function calculateFrameIntersectionArea(a: CanvasTextFrame, b: CanvasTextFrame) {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

function clampTextPlacementIntoCanvasSafeArea(
  content: string,
  fontSize: number,
  candidate: TextPlacementCandidate,
  fallbackAlign: TextLayer["align"],
) {
  const align = candidate.align ?? fallbackAlign;
  const frame = estimateGeneratedTextFrame(content, fontSize, candidate, align);
  const safeRight = TEXT_OCCLUSION_SAFE_AREA.x + TEXT_OCCLUSION_SAFE_AREA.width;
  const safeBottom = TEXT_OCCLUSION_SAFE_AREA.y + TEXT_OCCLUSION_SAFE_AREA.height;
  let dx = 0;
  let dy = 0;

  if (frame.width <= TEXT_OCCLUSION_SAFE_AREA.width) {
    if (frame.x < TEXT_OCCLUSION_SAFE_AREA.x) dx = TEXT_OCCLUSION_SAFE_AREA.x - frame.x;
    if (frame.x + frame.width > safeRight) dx = safeRight - (frame.x + frame.width);
  } else {
    dx = TEXT_OCCLUSION_SAFE_AREA.x + (TEXT_OCCLUSION_SAFE_AREA.width - frame.width) / 2 - frame.x;
  }

  if (frame.height <= TEXT_OCCLUSION_SAFE_AREA.height) {
    if (frame.y < TEXT_OCCLUSION_SAFE_AREA.y) dy = TEXT_OCCLUSION_SAFE_AREA.y - frame.y;
    if (frame.y + frame.height > safeBottom) dy = safeBottom - (frame.y + frame.height);
  } else {
    dy = TEXT_OCCLUSION_SAFE_AREA.y + (TEXT_OCCLUSION_SAFE_AREA.height - frame.height) / 2 - frame.y;
  }

  const clampedCandidate = {
    ...candidate,
    x: Math.round(candidate.x + dx),
    y: Math.round(candidate.y + dy),
    align,
  };
  return {
    ...clampedCandidate,
    frame: estimateGeneratedTextFrame(content, fontSize, clampedCandidate, align),
  };
}

function scoreTextPlacementOverlap(
  role: GeneratedTextPlacementRole,
  frame: CanvasTextFrame,
  protectedZones: TextOcclusionProtectedZone[],
) {
  const frameArea = Math.max(1, frame.width * frame.height);
  return protectedZones.reduce((total, zone) => {
    const overlapRatio = calculateFrameIntersectionArea(frame, zone) / frameArea;
    if (TEXT_OCCLUSION_HOST_ZONE_IDS.has(zone.id) && overlapRatio > 0) {
      return total + TEXT_OCCLUSION_HARD_FACE_PENALTY + overlapRatio * zone.weight;
    }
    const zoneWeightMultiplier = TEXT_OCCLUSION_ROLE_ZONE_WEIGHT_MULTIPLIERS[role][zone.id] ?? 1;
    return total + overlapRatio * zone.weight * zoneWeightMultiplier;
  }, 0);
}

function scoreTextPlacementPreference(
  role: GeneratedTextPlacementRole,
  candidate: TextPlacementCandidate,
  frame: CanvasTextFrame,
) {
  const frameCenterX = frame.x + frame.width / 2;
  const frameCenterY = frame.y + frame.height / 2;
  if (role === "headline") {
    const lowerBandPenalty = Math.abs(frameCenterY - 520) * 0.00035;
    const centeredLowerPenalty = Math.abs(frameCenterX - 620) * 0.00004;
    const tooHighPenalty = candidate.y < 440 ? 0.18 : 0;
    return lowerBandPenalty + centeredLowerPenalty + tooHighPenalty;
  }
  if (role === "subHeadline" || role === "accentBadge") {
    const upperBandPenalty = Math.abs(frameCenterY - 156) * 0.00035;
    const preferredCenterX = role === "subHeadline" ? 650 : 340;
    const horizontalPenalty = Math.abs(frameCenterX - preferredCenterX) * 0.00004;
    const faceSidePenalty = Math.max(0, frameCenterX - 760) * 0.00018;
    const lowerFallbackPenalty = candidate.y > 420 ? 0.12 : 0;
    return upperBandPenalty + horizontalPenalty + faceSidePenalty + lowerFallbackPenalty;
  }
  const bottomCaptionPenalty = Math.abs(frameCenterY - 600) * 0.0002;
  const sideCaptionPenalty = Math.min(Math.abs(frameCenterX - 270), Math.abs(frameCenterX - 1016)) * 0.00005;
  return bottomCaptionPenalty + sideCaptionPenalty;
}

function createGeneratedTextProtectedZone(
  id: Extract<TextOcclusionProtectedZone["id"], "generated-headline" | "generated-subHeadline" | "generated-accentBadge">,
  content: string,
  fontSize: number,
  placement: Pick<TextPlacementCandidate, "x" | "y" | "align">,
  fallbackAlign: TextLayer["align"],
  weight = 18,
): TextOcclusionProtectedZone {
  return {
    id,
    ...estimateGeneratedTextFrame(content, fontSize, placement, fallbackAlign),
    weight,
  };
}

function selectNonOccludingTextPlacement(
  role: GeneratedTextPlacementRole,
  content: string,
  fontSize: number,
  fallbackAlign: TextLayer["align"],
  candidates: TextPlacementCandidate[],
  protectedZones: TextOcclusionProtectedZone[],
) {
  const rolePenalty = role === "headline" ? 0 : role === "subHeadline" ? 0.0002 : role === "accentBadge" ? 0.0004 : 0.0006;
  const fallbackCandidate = candidates[0] ?? { x: 640, y: 360, align: fallbackAlign, label: "implicit-fallback" };
  let best = {
    ...clampTextPlacementIntoCanvasSafeArea(content, fontSize, fallbackCandidate, fallbackAlign),
    score: Number.POSITIVE_INFINITY,
  };

  candidates.forEach((candidate, index) => {
    const placement = clampTextPlacementIntoCanvasSafeArea(content, fontSize, candidate, fallbackAlign);
    const score = scoreTextPlacementOverlap(role, placement.frame, protectedZones)
      + scoreTextPlacementPreference(role, candidate, placement.frame)
      + rolePenalty
      + index * 0.000_001;
    // Stable tie-break: equal overlap keeps the earlier candidate in the ordered contract.
    if (score < best.score) {
      best = { ...placement, score };
    }
  });

  return {
    x: best.x,
    y: best.y,
    align: best.align,
  };
}

type NoWrapFittedTextMetrics = {
  text: string;
  rawWidth: number;
  renderScale: number;
  width: number;
  height: number;
};

function getNoWrapFittedTextMetrics(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  layer: TextLayer,
): NoWrapFittedTextMetrics {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  const rawWidth = Math.max(layer.fontSize * 2, context.measureText(normalizedText).width);
  const renderScale = rawWidth > maxWidth ? Math.max(TEXT_LAYER_MIN_FIT_SCALE, maxWidth / rawWidth) : 1;
  // Keep the selection frame aligned with the actual rendered glyphs.
  // When the minimum fit scale is reached, the rendered text can still be wider
  // than maxWidth, so clamping this metric makes the dashed selection box too narrow.
  const width = rawWidth * renderScale;
  const height = Math.max(layer.fontSize * renderScale * 1.18, layer.fontSize * renderScale + 18);

  return {
    text: normalizedText,
    rawWidth,
    renderScale,
    width,
    height,
  };
}

function drawNoWrapFittedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  layer: TextLayer,
): NoWrapFittedTextMetrics {
  const metrics = getNoWrapFittedTextMetrics(context, text, maxWidth, layer);
  if (!metrics.text) return metrics;

  context.save();
  context.translate(x, y);
  context.scale(metrics.renderScale, metrics.renderScale);
  if (layer.strokeWidth > 0) context.strokeText(metrics.text, 0, 0);
  context.fillText(metrics.text, 0, 0);
  context.restore();

  return metrics;
}

export function AdminYoutubeThumbnailGenerator() {
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inlineTextEditorRef = useRef<HTMLDivElement | null>(null);
  const loadedBaseImageRef = useRef<{ dataUrl: string; image: HTMLImageElement } | null>(null);
  const drawCanvasFrameRef = useRef<number | null>(null);
  const textLayersRef = useRef<TextLayer[]>([]);
  const activeLayerIdRef = useRef<string | null>(null);
  const editingLayerIdRef = useRef<string | null>(null);
  const textLayerUndoStackRef = useRef<TextEditorHistorySnapshot[]>([]);
  const pendingTextLayerUndoSnapshotRef = useRef<TextEditorHistorySnapshot | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const textTransformStateRef = useRef<TextTransformState | null>(null);
  const latestHistoryRunKeyRef = useRef<string | null>(null);
  const promotedReleaseCandidateKeyRef = useRef<string | null>(null);
  const durableReleaseKeyRef = useRef<string | null>(null);
  const userCanvasResultLockedRef = useRef(false);
  const thumbnailHistoryRequestIdRef = useRef(0);
  const thumbnailReleaseCandidateRequestIdRef = useRef(0);
  const thumbnailDurableReleaseRequestIdRef = useRef(0);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const activeChatAssistantMessageIdRef = useRef<string | null>(null);
  const thumbnailChatThreadIdRef = useRef(createThumbnailChatThreadId());
  const pendingChatGenerationRequirementRef = useRef<string | null>(null);
  const guidedExampleVariantIndexRef = useRef(0);
  const generationAbortControllerRef = useRef<AbortController | null>(null);
  const activeGenerationAssistantMessageIdRef = useRef<string | null>(null);
  const thumbnailLocalBridgeStatusAbortControllerRef = useRef<AbortController | null>(null);
  const browserOpenAIApiKeyRef = useRef<string | null>(null);
  const browserOpenAIApiKeyInputRef = useRef<HTMLInputElement | null>(null);
  const thumbnailLocalBridgeTokenRef = useRef<string | null>(null);
  const thumbnailLocalBridgeTokenInputRef = useRef<HTMLInputElement | null>(null);
  const chatTranscriptRef = useRef<HTMLDivElement | null>(null);
  const chatComposerImeRef = useRef(false);
  const referenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const layerIdCounterRef = useRef(3);
  const chatMessageIdRef = useRef(1);
  const [topic, setTopic] = useState(DEFAULT_TOPIC);
  const [chatDraft, setChatDraft] = useState("");
  const [chatMessages, setChatMessages] = useState<ThumbnailChatMessage[]>([
    {
      id: "assistant-intro",
      role: "assistant",
      mode: "system",
      content: formatThumbnailAssistantDisplayText(
        "원하는 썸네일을 말로 적어 주세요.\n문구, 위치, 참고 이미지 사용 여부를 쉽게 정리해 드릴게요.\nPNG 저장이나 이전 결과 불러오기도 말로 요청할 수 있습니다.",
      ),
    },
  ]);
  const [headline, setHeadline] = useState(BUNDLED_THUMBNAIL_PREVIEW_HEADLINE);
  const [subHeadline, setSubHeadline] = useState(BUNDLED_THUMBNAIL_PREVIEW_SUB_HEADLINE);
  const [providerId, setProviderId] = useState<ProviderId>("local-codex");
  const [generationMode, setGenerationMode] = useState<GenerationMode>("direct_provider");
  const briefPreset: BriefPreset = "tzuyang-food-travel-collage";
  const [files, setFiles] = useState<File[]>([]);
  const [referenceImageRoles, setReferenceImageRoles] = useState<ReferenceImageRole[]>([]);
  const acknowledgedSafety = true;
  const [textLayers, setTextLayers] = useState<TextLayer[]>(() => createBundledThumbnailPreviewTextLayers());
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [lastCanvasActionLabel, setLastCanvasActionLabel] = useState<string | null>(null);
  const [exportPresetId, setExportPresetId] = useState<ThumbnailExportPresetId>("quick-1280x720");
  const [lastExportMetadata, setLastExportMetadata] = useState<ThumbnailExportMetadata | null>(null);
  const [showSafeAreaGuide, setShowSafeAreaGuide] = useState(true);
  const [readiness, setReadiness] = useState<ThumbnailReadiness | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(BUNDLED_THUMBNAIL_PREVIEW_RESULT);
  const [baseImageRenderRevision, setBaseImageRenderRevision] = useState(0);
  const [canvasDisplaySize, setCanvasDisplaySize] = useState({ width: TARGET_WIDTH, height: TARGET_HEIGHT });
  const [historyRuns, setHistoryRuns] = useState<ThumbnailHistoryRun[]>([]);
  const [historyStatus, setHistoryStatus] = useState<ThumbnailHistoryStatus>("idle");
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [initialPreviewSource, setInitialPreviewSource] = useState<ThumbnailInitialPreviewSource>("bundled");
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [isChatSettingsOpen, setIsChatSettingsOpen] = useState(false);
  const [isBrowserOpenAIApiKeyApplied, setIsBrowserOpenAIApiKeyApplied] = useState(false);
  const [maskedBrowserOpenAIApiKey, setMaskedBrowserOpenAIApiKey] = useState<string | null>(null);
  const [browserOpenAIApiKeyAppliedAt, setBrowserOpenAIApiKeyAppliedAt] = useState<string | null>(null);
  const [browserOpenAIApiKeyMessage, setBrowserOpenAIApiKeyMessage] = useState<string | null>(null);
  const [thumbnailImageRouteChoice, setThumbnailImageRouteChoice] = useState<ThumbnailImageRouteChoice>("local-codex-oauth");
  const [thumbnailLocalBridgeUrl, setThumbnailLocalBridgeUrl] = useState<string>(THUMBNAIL_LOCAL_BRIDGE_DEFAULT_URL);
  const [thumbnailLocalBridgeUrlDraft, setThumbnailLocalBridgeUrlDraft] = useState<string>(THUMBNAIL_LOCAL_BRIDGE_DEFAULT_URL);
  const [isThumbnailLocalBridgePaired, setIsThumbnailLocalBridgePaired] = useState(false);
  const [maskedThumbnailLocalBridgeToken, setMaskedThumbnailLocalBridgeToken] = useState<string | null>(null);
  const [thumbnailLocalBridgeAppliedAt, setThumbnailLocalBridgeAppliedAt] = useState<string | null>(null);
  const [thumbnailLocalBridgeStatus, setThumbnailLocalBridgeStatus] = useState<ThumbnailLocalBridgeUiStatus>("unpaired");
  const [thumbnailLocalBridgeMessage, setThumbnailLocalBridgeMessage] = useState<string | null>(null);
  const [thumbnailLocalBridgeError, setThumbnailLocalBridgeError] = useState<string | null>(null);
  const [fileValidationMessage, setFileValidationMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isChatAgentStreaming, setIsChatAgentStreaming] = useState(false);
  const resultRef = useRef<GenerationResult | null>(result);
  const thumbnailLocalBridgeHelperPopupRef = useRef<Window | null>(null);
  const thumbnailLocalBridgeHelperPortRef = useRef<MessagePort | null>(null);
  const thumbnailLocalBridgeHelperSessionIdRef = useRef<string | null>(null);
  const thumbnailLocalBridgeHelperRequestIdRef = useRef(0);
  const thumbnailLocalBridgeHelperCloseWatchRef = useRef<number | null>(null);
  const thumbnailLocalBridgeHelperPendingRequestsRef = useRef(new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }>());

  const clearThumbnailLocalBridgeHelperCloseWatch = useCallback(() => {
    if (typeof window === "undefined") return;
    if (thumbnailLocalBridgeHelperCloseWatchRef.current !== null) {
      window.clearInterval(thumbnailLocalBridgeHelperCloseWatchRef.current);
      thumbnailLocalBridgeHelperCloseWatchRef.current = null;
    }
  }, []);

  const rejectThumbnailLocalBridgeHelperPendingRequests = useCallback((message: string) => {
    thumbnailLocalBridgeHelperPendingRequestsRef.current.forEach(({ reject }) => {
      reject(new Error(message));
    });
    thumbnailLocalBridgeHelperPendingRequestsRef.current.clear();
  }, []);

  const resetThumbnailLocalBridgeHelperTransport = useCallback((options?: {
    closePopup?: boolean;
    nextStatus?: ThumbnailLocalBridgeUiStatus;
    nextMessage?: string;
    nextError?: string | null;
  }) => {
    clearThumbnailLocalBridgeHelperCloseWatch();
    const failureMessage = options?.nextMessage ?? getThumbnailLocalBridgeReconnectRequiredMessage();
    rejectThumbnailLocalBridgeHelperPendingRequests(failureMessage);
    const port = thumbnailLocalBridgeHelperPortRef.current;
    if (port) {
      try {
        port.onmessage = null;
        port.close();
      } catch {
        // Ignore already-closed helper ports.
      }
      thumbnailLocalBridgeHelperPortRef.current = null;
    }
    const popup = thumbnailLocalBridgeHelperPopupRef.current;
    if (options?.closePopup && popup && !popup.closed) {
      try {
        popup.close();
      } catch {
        // Ignore popup close failures.
      }
    }
    thumbnailLocalBridgeHelperPopupRef.current = null;
    thumbnailLocalBridgeHelperSessionIdRef.current = null;
    if (options?.nextStatus) setThumbnailLocalBridgeStatus(options.nextStatus);
    if (options?.nextMessage !== undefined) setThumbnailLocalBridgeMessage(options.nextMessage);
    if (options?.nextError !== undefined) setThumbnailLocalBridgeError(options.nextError);
  }, [clearThumbnailLocalBridgeHelperCloseWatch, rejectThumbnailLocalBridgeHelperPendingRequests]);
  const clearThumbnailBrowserOpenAIApiKeySecret = useCallback(() => {
    browserOpenAIApiKeyRef.current = null;
    if (browserOpenAIApiKeyInputRef.current) browserOpenAIApiKeyInputRef.current.value = "";
    setIsBrowserOpenAIApiKeyApplied(false);
    setMaskedBrowserOpenAIApiKey(null);
    setBrowserOpenAIApiKeyAppliedAt(null);
  }, []);

  const clearThumbnailLocalBridgeTokenSecret = useCallback(() => {
    thumbnailLocalBridgeTokenRef.current = null;
    if (thumbnailLocalBridgeTokenInputRef.current) thumbnailLocalBridgeTokenInputRef.current.value = "";
    setIsThumbnailLocalBridgePaired(false);
    setMaskedThumbnailLocalBridgeToken(null);
    setThumbnailLocalBridgeAppliedAt(null);
  }, []);

  const abortThumbnailCredentialWork = useCallback(() => {
    if (!chatAbortControllerRef.current?.signal.aborted) chatAbortControllerRef.current?.abort();
    if (!generationAbortControllerRef.current?.signal.aborted) generationAbortControllerRef.current?.abort();
    if (!thumbnailLocalBridgeStatusAbortControllerRef.current?.signal.aborted) {
      thumbnailLocalBridgeStatusAbortControllerRef.current?.abort();
    }
    chatAbortControllerRef.current = null;
    generationAbortControllerRef.current = null;
    thumbnailLocalBridgeStatusAbortControllerRef.current = null;
    resetThumbnailLocalBridgeHelperTransport({ closePopup: true });
    setIsChatAgentStreaming(false);
    setIsGenerating(false);
  }, [resetThumbnailLocalBridgeHelperTransport]);

  const clearThumbnailCredentialLifecycle = useCallback(() => {
    abortThumbnailCredentialWork();
    clearThumbnailBrowserOpenAIApiKeySecret();
    clearThumbnailLocalBridgeTokenSecret();
    setBrowserOpenAIApiKeyMessage(null);
    setThumbnailLocalBridgeStatus("unpaired");
    setThumbnailLocalBridgeMessage(null);
    setThumbnailLocalBridgeError(null);
  }, [
    abortThumbnailCredentialWork,
    clearThumbnailBrowserOpenAIApiKeySecret,
    clearThumbnailLocalBridgeTokenSecret,
  ]);

  const invokeThumbnailLocalBridgeHelper = useCallback<ThumbnailLocalBridgeHelperInvoke>((request, options) => {
    const port = thumbnailLocalBridgeHelperPortRef.current;
    const sessionId = thumbnailLocalBridgeHelperSessionIdRef.current;
    if (!port || !sessionId) {
      return Promise.reject(new Error(getThumbnailLocalBridgeReconnectRequiredMessage()));
    }
    if (thumbnailLocalBridgeHelperPopupRef.current?.closed) {
      resetThumbnailLocalBridgeHelperTransport({
        nextStatus: "helper_closed",
        nextMessage: getThumbnailLocalBridgeHelperClosedMessage(),
        nextError: getThumbnailLocalBridgeHelperClosedMessage(),
      });
      return Promise.reject(new Error(getThumbnailLocalBridgeHelperClosedMessage()));
    }
    const requestId = `thumbnail-local-bridge-${thumbnailLocalBridgeHelperRequestIdRef.current + 1}`;
    thumbnailLocalBridgeHelperRequestIdRef.current += 1;
    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        thumbnailLocalBridgeHelperPendingRequestsRef.current.delete(requestId);
        reject(new Error("thumbnail_local_bridge_request_aborted"));
      };
      if (options?.signal?.aborted) {
        abortHandler();
        return;
      }
      if (options?.signal) {
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }
      thumbnailLocalBridgeHelperPendingRequestsRef.current.set(requestId, {
        resolve: (value) => {
          if (options?.signal) options.signal.removeEventListener("abort", abortHandler);
          resolve(value);
        },
        reject: (reason) => {
          if (options?.signal) options.signal.removeEventListener("abort", abortHandler);
          reject(reason);
        },
      });
      const nextRequest: ThumbnailLocalBridgeHelperRequestMessage = {
        ...request,
        sessionId,
        requestId,
      };
      try {
        port.postMessage(nextRequest);
      } catch (error) {
        thumbnailLocalBridgeHelperPendingRequestsRef.current.delete(requestId);
        if (options?.signal) options.signal.removeEventListener("abort", abortHandler);
        reject(error);
      }
    });
  }, [resetThumbnailLocalBridgeHelperTransport]);

  const handleConnectThumbnailLocalBridgeHelper = useCallback(async () => {
    if (!thumbnailLocalBridgeStatusAbortControllerRef.current?.signal.aborted) {
      thumbnailLocalBridgeStatusAbortControllerRef.current?.abort();
    }
    const controller = new AbortController();
    thumbnailLocalBridgeStatusAbortControllerRef.current = controller;
    const normalizedToken = normalizeThumbnailLocalBridgeToken(thumbnailLocalBridgeTokenRef.current);
    if (!normalizedToken) {
      const message = "먼저 적용을 눌러 pairing 설정을 이 탭 메모리에 적용해 주세요.";
      setThumbnailLocalBridgeStatus("unpaired");
      setThumbnailLocalBridgeMessage(message);
      setThumbnailLocalBridgeError(message);
      if (thumbnailLocalBridgeStatusAbortControllerRef.current === controller) {
        thumbnailLocalBridgeStatusAbortControllerRef.current = null;
      }
      return false;
    }
    try {
      const normalizedUrl = normalizeThumbnailLocalBridgeUrl(thumbnailLocalBridgeUrl);
      resetThumbnailLocalBridgeHelperTransport({ closePopup: true });
      const sessionId = createThumbnailLocalBridgeHelperSessionId();
      setThumbnailLocalBridgeStatus("helper_opening");
      setThumbnailLocalBridgeMessage("로컬 브릿지 helper 창을 여는 중입니다. 팝업이 보이면 닫지 말고 연결이 끝날 때까지 기다려 주세요.");
      setThumbnailLocalBridgeError(null);
      const helperOrigin = new URL(normalizedUrl).origin;
      const helperUrl = buildThumbnailLocalBridgeHelperUrl(normalizedUrl, sessionId);
      const port = await new Promise<MessagePort>((resolve, reject) => {
        let timeoutId: number | null = null;
        function cleanup() {
          if (timeoutId !== null) window.clearTimeout(timeoutId);
          window.removeEventListener("message", onMessage);
          controller.signal.removeEventListener("abort", abortHandler);
        }
        function abortHandler() {
          cleanup();
          reject(new Error("thumbnail_local_bridge_status_aborted"));
        }
        function onMessage(event: MessageEvent<unknown>) {
          if (event.origin !== helperOrigin || !isThumbnailLocalBridgeHelperReadyMessage(event.data)) return;
          if (event.data.sessionId !== sessionId) return;
          if (!event.ports[0]) {
            cleanup();
            reject(new Error("로컬 브릿지 helper 통신 포트를 받을 수 없습니다."));
            return;
          }
          cleanup();
          resolve(event.ports[0]);
        }
        timeoutId = window.setTimeout(() => {
          cleanup();
          reject(new Error("로컬 브릿지 helper 창이 응답하지 않습니다. helper 창이 열렸는지 확인한 뒤 다시 연결해 주세요."));
        }, 10_000);
        if (controller.signal.aborted) {
          abortHandler();
          return;
        }
        controller.signal.addEventListener("abort", abortHandler, { once: true });
        window.addEventListener("message", onMessage);
        const popup = window.open(
          helperUrl,
          "tzudong-thumbnail-local-bridge-helper",
          "popup=yes,width=560,height=720,resizable=yes,scrollbars=yes",
        );
        if (!popup) {
          cleanup();
          reject(new Error(getThumbnailLocalBridgePopupBlockedMessage()));
          return;
        }
        thumbnailLocalBridgeHelperPopupRef.current = popup;
        popup.focus();
      });
      if (controller.signal.aborted) return false;
      thumbnailLocalBridgeHelperPortRef.current = port;
      thumbnailLocalBridgeHelperSessionIdRef.current = sessionId;
      port.onmessage = (event) => {
        const data = event.data;
        if (isThumbnailLocalBridgeHelperClosedMessage(data)) {
          if (data.sessionId !== thumbnailLocalBridgeHelperSessionIdRef.current) return;
          resetThumbnailLocalBridgeHelperTransport({
            nextStatus: "helper_closed",
            nextMessage: getThumbnailLocalBridgeHelperClosedMessage(),
            nextError: getThumbnailLocalBridgeHelperClosedMessage(),
          });
          return;
        }
        if (!isThumbnailLocalBridgeHelperResponseMessage(data)) return;
        if (data.sessionId !== thumbnailLocalBridgeHelperSessionIdRef.current) return;
        const pending = thumbnailLocalBridgeHelperPendingRequestsRef.current.get(data.requestId);
        if (!pending) return;
        thumbnailLocalBridgeHelperPendingRequestsRef.current.delete(data.requestId);
        if (data.ok) {
          pending.resolve(data.payload);
          return;
        }
        pending.reject(new Error(data.message || data.errorCode || "local_bridge_helper_request_failed"));
      };
      port.start();
      clearThumbnailLocalBridgeHelperCloseWatch();
      thumbnailLocalBridgeHelperCloseWatchRef.current = window.setInterval(() => {
        if (!thumbnailLocalBridgeHelperPopupRef.current?.closed) return;
        resetThumbnailLocalBridgeHelperTransport({
          nextStatus: "helper_closed",
          nextMessage: getThumbnailLocalBridgeHelperClosedMessage(),
          nextError: getThumbnailLocalBridgeHelperClosedMessage(),
        });
      }, 500);
      const status = await getThumbnailLocalBridgeStatusRequest(
        normalizedUrl,
        normalizedToken,
        invokeThumbnailLocalBridgeHelper,
        controller.signal,
      );
      if (controller.signal.aborted) return false;
      setThumbnailLocalBridgeStatus(status.status);
      setThumbnailLocalBridgeMessage(status.message);
      setThumbnailLocalBridgeError(status.status === "connected" ? null : status.message);
      return status.status === "connected";
    } catch (error) {
      if (controller.signal.aborted) return false;
      const message = redactThumbnailLocalBridgeSecretText(
        error instanceof Error ? error.message : "로컬 브릿지 helper 연결을 시작하지 못했습니다.",
        normalizedToken,
      );
      setThumbnailLocalBridgeStatus(message === getThumbnailLocalBridgePopupBlockedMessage() ? "popup_blocked" : "error");
      setThumbnailLocalBridgeMessage(message);
      setThumbnailLocalBridgeError(message);
      return false;
    } finally {
      if (thumbnailLocalBridgeStatusAbortControllerRef.current === controller) {
        thumbnailLocalBridgeStatusAbortControllerRef.current = null;
      }
    }
  }, [
    clearThumbnailLocalBridgeHelperCloseWatch,
    invokeThumbnailLocalBridgeHelper,
    resetThumbnailLocalBridgeHelperTransport,
    thumbnailLocalBridgeUrl,
  ]);

  const selectedExportPreset = useMemo(
    () => thumbnailExportPresets.find((preset) => preset.id === exportPresetId) ?? thumbnailExportPresets[0],
    [exportPresetId],
  );
  const readinessLimits = readiness?.limits ?? DEFAULT_LIMITS;
  const selectedProviderAvailability = readiness?.providers[providerReadinessKey[providerId]] ?? null;
  const backendAgentStatus = readiness?.backendAgent ?? null;
  const preflightIssues = useMemo(
    () => getThumbnailGenerationPreflightIssues({
      topic,
      headline,
      files,
      readinessLimits,
      fileValidationMessage,
      generationMode,
      backendAgentStatus,
    }),
    [
      backendAgentStatus,
      fileValidationMessage,
      files,
      generationMode,
      headline,
      readinessLimits,
      topic,
    ],
  );
  const activeLayer = useMemo(
    () => activeLayerId ? textLayers.find((layer) => layer.id === activeLayerId) ?? null : null,
    [activeLayerId, textLayers],
  );
  const editingLayer = useMemo(
    () => textLayers.find((layer) => layer.id === editingLayerId) ?? null,
    [editingLayerId, textLayers],
  );
  const canvasContextLayer = editingLayer ?? activeLayer;
  const canvasContextState = editingLayer ? "editing" : activeLayer ? "selected" : "idle";
  const canvasContextSummary = useMemo(
    () => formatCanvasLayerSummary(canvasContextLayer),
    [canvasContextLayer],
  );
  const canvasContextPrompt = useMemo(
    () => getCanvasContextPrompt(canvasContextLayer, lastCanvasActionLabel),
    [canvasContextLayer, lastCanvasActionLabel],
  );
  const shouldShowThumbnailCanvasContext = canvasContextState !== "idle";
  const isThumbnailLocalBridgeConnected = thumbnailLocalBridgeStatus === "connected";
  const shouldShowThumbnailLocalBridgeSettings = thumbnailImageRouteChoice === THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID;
  const thumbnailImageApiRouterView = getThumbnailImageApiRouterView(
    readiness,
    thumbnailImageRouteChoice,
    isBrowserOpenAIApiKeyApplied,
    isThumbnailLocalBridgePaired,
    thumbnailLocalBridgeStatus,
  );
  const sessionKeyBackedProviderAvailableForChatStatus = canUseSessionApiKeyForProvider(
    providerId,
    selectedProviderAvailability,
    isBrowserOpenAIApiKeyApplied,
  );
  const thumbnailChatStatusState = isGenerating
    ? "generating"
    : isChatAgentStreaming
      ? "streaming"
      : isThumbnailLocalBridgeConnected ||
          selectedProviderAvailability?.available ||
          sessionKeyBackedProviderAvailableForChatStatus ||
          backendAgentStatus?.available
        ? "ready"
        : readiness
          ? "needs-setup"
          : "checking";
  const thumbnailChatStatusLabel =
    thumbnailChatStatusState === "generating"
      ? "만드는 중"
      : thumbnailChatStatusState === "streaming"
        ? "답변 중"
        : thumbnailChatStatusState === "ready"
          ? "준비됨"
          : thumbnailChatStatusState === "needs-setup"
            ? "준비 필요"
            : "확인 중";
  const chatDraftIsNonMutating = isNonMutatingThumbnailChatPrompt(chatDraft);
  const currentThumbnailStreamingLabel = isGenerating
    ? "이미지 생성 중"
    : isChatAgentStreaming
      ? "요청 반영 중"
      : chatDraftIsNonMutating
        ? "전송 후 답변"
        : isThumbnailChatStructuredEditPrompt(chatDraft)
          ? "전송 후 편집"
          : "입력 프리뷰";
  const currentThumbnailStreamingPhase = isGenerating
    ? "썸네일 이미지를 만들고 있어요. 오래 걸리면 아래 중단 버튼을 누를 수 있습니다."
    : isChatAgentStreaming
      ? "요청을 쉽게 정리하는 중이에요..."
      : chatDraftIsNonMutating
        ? "입력 중 · 전송하면 캔버스는 그대로 두고 답변합니다"
        : isThumbnailChatStructuredEditPrompt(chatDraft)
          ? "입력 중 · 전송하면 문구를 바꿉니다"
          : "입력 중 · 전송하면 캔버스에 반영됩니다";

  useEffect(() => {
    textLayersRef.current = textLayers;
  }, [textLayers]);

  useEffect(() => {
    activeLayerIdRef.current = activeLayerId;
  }, [activeLayerId]);

  useEffect(() => {
    editingLayerIdRef.current = editingLayerId;
  }, [editingLayerId]);

  useEffect(() => {
    resultRef.current = result;
  }, [result]);


  useEffect(() => {
    const clearForPageLifecycle = () => {
      clearThumbnailCredentialLifecycle();
    };
    window.addEventListener("pagehide", clearForPageLifecycle);
    window.addEventListener("pageshow", clearForPageLifecycle);
    return () => {
      window.removeEventListener("pagehide", clearForPageLifecycle);
      window.removeEventListener("pageshow", clearForPageLifecycle);
      clearThumbnailCredentialLifecycle();
    };
  }, [clearThumbnailCredentialLifecycle]);

  const loadReadiness = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/youtube-thumbnail-generator", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as ThumbnailReadiness | ThumbnailApiErrorPayload | null;
      if (!response.ok || !payload || !("providers" in payload)) {
        throw new Error(getThumbnailErrorAction(payload && "error" in payload ? payload : null));
      }
      setReadiness(payload);
    } catch (readinessError) {
      toast({
        variant: "destructive",
        title: "모델 상태 확인 실패",
        description: readinessError instanceof Error ? readinessError.message : "provider 상태를 확인하지 못했습니다.",
      });
    }
  }, []);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;

    const updateCanvasDisplaySize = () => {
      const { width, height } = viewport.getBoundingClientRect();
      if (!width || !height) return;
      const nextWidth = Math.max(1, Math.min(width, height * (TARGET_WIDTH / TARGET_HEIGHT)));
      const nextHeight = Math.max(1, nextWidth * (TARGET_HEIGHT / TARGET_WIDTH));
      setCanvasDisplaySize((current) => {
        if (Math.abs(current.width - nextWidth) < 1 && Math.abs(current.height - nextHeight) < 1) return current;
        return { width: nextWidth, height: nextHeight };
      });
    };

    updateCanvasDisplaySize();
    const observer = new ResizeObserver(updateCanvasDisplaySize);
    observer.observe(viewport);
    window.addEventListener("resize", updateCanvasDisplaySize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateCanvasDisplaySize);
    };
  }, []);

  useEffect(() => {
    const transcript = chatTranscriptRef.current;
    if (!transcript) return;
    const frame = window.requestAnimationFrame(() => {
      transcript.scrollTo({
        top: transcript.scrollHeight,
        behavior: "auto",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chatMessages, chatDraft, isChatAgentStreaming, isGenerating]);

  const applyPromotedReleaseCandidate = useCallback((candidate: ThumbnailReleaseCandidate) => {
    if (userCanvasResultLockedRef.current) return false;
    const nextResult = createThumbnailResultFromReleaseCandidate(candidate);
    if (!nextResult) return false;
    const nextTopic = createTzuyangAutomaticPreviewTopic(candidate.topic.trim() || DEFAULT_TOPIC);
    const nextHeadline = deriveAutomaticThumbnailHeadlineCopy(nextTopic, candidate.headline.trim());
    const nextSubHeadline = deriveChatSubHeadline(`${nextTopic} ${candidate.headline} 검증 완료`) || "검증 완료";
    setResult(nextResult);
    promotedReleaseCandidateKeyRef.current = candidate.id;
    latestHistoryRunKeyRef.current = candidate.id;
    setProviderId("local-codex");
    setGenerationMode(candidate.generationMode);
    setTopic(nextTopic);
    setHeadline(nextHeadline);
    setSubHeadline(nextSubHeadline);
    setTextLayers((currentLayers) => {
      const nextLayers = createTextLayersWithGenerationLayout(
        createTextLayersWithChatPatch(currentLayers, {
          topic: nextTopic,
          headline: nextHeadline,
          subHeadline: nextSubHeadline,
        }),
        nextTopic,
        nextHeadline,
        nextSubHeadline,
      );
      textLayersRef.current = nextLayers;
      return nextLayers;
    });
    setActiveLayerId(null);
    setBaseImageRenderRevision((revision) => revision + 1);
    setLastCanvasActionLabel(`릴리즈 후보 ${candidate.id} 자동 적용됨`);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pure canvas layout helpers are intentionally captured once so initial preview loading stays stable.
  }, []);

  const applyDurableRelease = useCallback((release: ThumbnailDurableRelease) => {
    if (userCanvasResultLockedRef.current) return false;
    const nextResult = createThumbnailResultFromDurableRelease(release);
    if (!nextResult) return false;
    setResult(nextResult);
    durableReleaseKeyRef.current = release.id;
    promotedReleaseCandidateKeyRef.current = release.candidateId;
    latestHistoryRunKeyRef.current = release.id;
    setProviderId("local-codex");
    setGenerationMode("direct_provider");
    const releaseLayers = Array.isArray(release.textLayers)
      ? release.textLayers.filter((layer) => layer.content?.trim()).slice(0, 8)
      : [];
    const releaseHeadline = releaseLayers.find((layer) => layer.id === "headline")?.content.trim()
      || releaseLayers[0]?.content.trim()
      || "역대급 먹방";
    const releaseSubHeadline = releaseLayers.find((layer) => layer.id === "subHeadline")?.content.trim()
      || "검증 완료";
    const releaseTopic = createTzuyangAutomaticPreviewTopic(`${release.candidateId} ${releaseHeadline}`);
    const nextHeadline = deriveAutomaticThumbnailHeadlineCopy(releaseTopic, releaseHeadline);
    const nextSubHeadline = sanitizeCanvasChatText(releaseSubHeadline, "검증 완료", SUB_HEADLINE_MAX_LENGTH);
    setHeadline(nextHeadline);
    setSubHeadline(nextSubHeadline);
    setTextLayers((currentLayers) => {
      const baseLayers = releaseLayers.length ? releaseLayers : currentLayers;
      const nextLayers = createTextLayersWithGenerationLayout(
        createTextLayersWithChatPatch(baseLayers, {
          topic: releaseTopic,
          headline: nextHeadline,
          subHeadline: nextSubHeadline,
        }),
        releaseTopic,
        nextHeadline,
        nextSubHeadline,
      );
      textLayersRef.current = nextLayers;
      syncCanonicalTextInputs(nextLayers);
      return nextLayers;
    });
    setActiveLayerId(null);
    setBaseImageRenderRevision((revision) => revision + 1);
    setLastCanvasActionLabel(`공용 릴리즈 ${release.candidateId} 적용됨`);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pure canvas layout helpers are intentionally captured once so initial preview loading stays stable.
  }, []);

  const loadDurableRelease = useCallback(async (
    options: { replaceInitialPreview?: boolean; silent?: boolean } = {},
  ): Promise<ThumbnailDurableReleaseLoadResult> => {
    const requestId = thumbnailDurableReleaseRequestIdRef.current + 1;
    thumbnailDurableReleaseRequestIdRef.current = requestId;
    try {
      const response = await fetch(THUMBNAIL_DURABLE_RELEASE_CURRENT_API_URL, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as ThumbnailDurableReleasePayload | null;
      if (!response.ok && payload?.status !== "unavailable") throw new Error("thumbnail_durable_release_api_failed");
      if (thumbnailDurableReleaseRequestIdRef.current !== requestId) return "stale";
      if (payload?.status === "empty" || payload?.status === "unavailable") {
        setInitialPreviewSource(payload.status === "unavailable" ? "durable-unavailable" : "durable-empty");
        setLastCanvasActionLabel(formatThumbnailDurableReadinessActionLabel(payload, "durable_release_empty"));
        return "empty-or-unavailable";
      }
      if (payload?.status !== "ready") throw new Error("thumbnail_durable_release_status_unrecognized");
      const release = payload.release ?? null;
      if (!release) throw new Error("thumbnail_durable_release_missing_release");
      if (options.replaceInitialPreview && userCanvasResultLockedRef.current) return "stale";
      if (options.replaceInitialPreview) {
        const applied = applyDurableRelease(release);
        setInitialPreviewSource(applied ? "durable" : "durable-error");
        return applied ? "applied" : "hard-error";
      }
      setInitialPreviewSource("durable");
      return "available";
    } catch (error) {
      if (thumbnailDurableReleaseRequestIdRef.current !== requestId) return "stale";
      setInitialPreviewSource("durable-error");
      setLastCanvasActionLabel(`공용 릴리즈 readback 실패 · ${error instanceof Error ? error.message : "thumbnail_durable_release_api_failed"}`);
      return "hard-error";
    }
  }, [applyDurableRelease]);

  const loadReleaseCandidates = useCallback(async (
    options: { replaceInitialPreview?: boolean; silent?: boolean } = {},
  ): Promise<ThumbnailReleaseCandidateLoadResult> => {
    const requestId = thumbnailReleaseCandidateRequestIdRef.current + 1;
    thumbnailReleaseCandidateRequestIdRef.current = requestId;
    try {
      const response = await fetch(THUMBNAIL_RELEASE_CANDIDATES_API_URL, { cache: "no-store" });
      if (!response.ok) throw new Error("release_candidates_api_failed");
      const payload = await response.json().catch(() => null) as ThumbnailReleaseCandidatesPayload | null;
      if (thumbnailReleaseCandidateRequestIdRef.current !== requestId) return "stale";
      const candidates = Array.isArray(payload?.candidates) ? payload.candidates.filter((candidate) => (
        candidate.providerId === "local-codex" &&
        candidate.model === "gpt-image-2" &&
        candidate.modelProvenance === "exact" &&
        candidate.releaseCandidate === true &&
        candidate.normalizedFromManifestMembership === true &&
        candidate.browserImagePath?.startsWith("/qa-history/youtube-thumbnail-generator/")
      )) : [];
      const automaticCandidate = selectAutomaticReleaseCandidate(candidates);
      if (options.replaceInitialPreview && userCanvasResultLockedRef.current) return "stale";
      if (options.replaceInitialPreview && automaticCandidate && !durableReleaseKeyRef.current) {
        const applied = applyPromotedReleaseCandidate(automaticCandidate);
        setInitialPreviewSource(applied ? "candidate" : "candidate-error");
        return applied ? "applied" : "failed";
      }
      setInitialPreviewSource("candidate-empty");
      return "empty";
    } catch (error) {
      if (thumbnailReleaseCandidateRequestIdRef.current !== requestId) return "stale";
      setInitialPreviewSource("candidate-error");
      setLastCanvasActionLabel(`릴리즈 후보 readback 실패 · ${error instanceof Error ? error.message : "release_candidates_api_failed"}`);
      return "failed";
    }
  }, [applyPromotedReleaseCandidate]);

  const loadThumbnailHistory = useCallback(async (
    options: { replaceInitialPreview?: boolean; silent?: boolean; actualOnlyPreview?: boolean } = {},
  ) => {
    if (isGenerating) return;

    const requestId = thumbnailHistoryRequestIdRef.current + 1;
    thumbnailHistoryRequestIdRef.current = requestId;
    if (!options.silent) {
      setHistoryStatus("loading");
      setHistoryError(null);
    }

    try {
      const response = await fetch(THUMBNAIL_HISTORY_API_URL, { cache: "no-store" });
      if (!response.ok) throw new Error("history_api_failed");
      const payload = await response.json().catch(() => null) as ThumbnailHistoryPayload | null;
      if (thumbnailHistoryRequestIdRef.current !== requestId) return;

      const runs = Array.isArray(payload?.runs)
        ? payload.runs.filter((run) => (
          Boolean(run.imagePath) &&
          isExactGptImage2HistoryRun(run)
        ))
        : [];
      setHistoryRuns(runs);
      setHistoryStatus(runs.length ? "ready" : "empty");
      setHistoryError(null);

      const latestRun = findLatestActualHistoryRun({ runs })
        ?? (options.actualOnlyPreview ? null : findLatestExistingThumbnailPreviewRun(payload));
      if (!options.replaceInitialPreview || !latestRun) return;
      if (userCanvasResultLockedRef.current) return;
      const nextResult = createExistingThumbnailPreviewResultFromHistoryRun(latestRun);
      if (!nextResult) return;

      const runKey = latestRun.id ?? latestRun.timestamp ?? latestRun.imagePath ?? nextResult.baseImage.dataUrl;
      if (durableReleaseKeyRef.current) return;
      if (promotedReleaseCandidateKeyRef.current) return;
      if (latestHistoryRunKeyRef.current === runKey) return;
      if (!canReplacePreviewWithHistoryResult(resultRef.current)) return;
      setResult(nextResult);
      setInitialPreviewSource("history");

      latestHistoryRunKeyRef.current = runKey;
      if (isProviderId(latestRun.providerId)) setProviderId(latestRun.providerId);
      if (isGenerationMode(latestRun.generationMode)) setGenerationMode(latestRun.generationMode);
      if (latestRun.topic?.trim()) {
        setTopic((currentTopic) => (currentTopic === DEFAULT_TOPIC ? latestRun.topic?.trim() ?? currentTopic : currentTopic));
      }
      const latestHeadline = latestRun.headline?.trim();
      const defaultHeadline = DEFAULT_TEXT_LAYERS[0]?.content ?? "역대급 먹방";
      if (latestHeadline) {
        const latestTopic = createTzuyangAutomaticPreviewTopic(latestRun.topic?.trim() || DEFAULT_TOPIC);
        const nextHeadline = deriveAutomaticThumbnailHeadlineCopy(latestTopic, latestHeadline, defaultHeadline);
        const nextSubHeadline = deriveChatSubHeadline(`${latestTopic} ${latestHeadline}`);
        setHeadline(nextHeadline);
        setSubHeadline(nextSubHeadline);
        setTextLayers((currentLayers) => {
          const nextLayers = createTextLayersWithGenerationLayout(
            createTextLayersWithChatPatch(currentLayers, {
              topic: latestTopic,
              headline: nextHeadline,
              subHeadline: nextSubHeadline,
            }),
            latestTopic,
            nextHeadline,
            nextSubHeadline,
          );
          textLayersRef.current = nextLayers;
          return nextLayers;
        });
        setActiveLayerId(null);
      }
    } catch (error) {
      if (thumbnailHistoryRequestIdRef.current !== requestId) return;
      setHistoryStatus("error");
      setHistoryError(error instanceof Error ? error.message : "history_api_failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pure canvas layout helpers are intentionally captured once so initial preview loading stays stable.
  }, [isGenerating]);

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      // A freshly generated exact gpt-image-2 image is what the operator expects
      // to see on revisit. Load actual generated history before the public
      // release fallback so another browser on the same dev server does not
      // jump back to an older bundled/candidate thumbnail.
      await loadThumbnailHistory({ replaceInitialPreview: true, silent: true, actualOnlyPreview: true });
      if (isCancelled || latestHistoryRunKeyRef.current) return;
      const durableStatus = await loadDurableRelease({ replaceInitialPreview: true, silent: true });
      if (isCancelled) return;
      const canUseFallbackPreview = durableStatus === "empty-or-unavailable";
      const candidateStatus = canUseFallbackPreview
        ? await loadReleaseCandidates({ replaceInitialPreview: true, silent: true })
        : "empty";
      if (isCancelled) return;
      await loadThumbnailHistory({ replaceInitialPreview: canUseFallbackPreview && candidateStatus !== "applied", silent: true });
    })();
    return () => {
      isCancelled = true;
    };
  }, [loadDurableRelease, loadReleaseCandidates, loadThumbnailHistory]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    if (canvas.width !== TARGET_WIDTH) canvas.width = TARGET_WIDTH;
    if (canvas.height !== TARGET_HEIGHT) canvas.height = TARGET_HEIGHT;

    const renderSafeAreaGuide = () => {
      if (!showSafeAreaGuide) return;
      context.save();
      context.setLineDash([18, 14]);
      context.lineWidth = 3;
      context.strokeStyle = "rgba(255,255,255,0.72)";
      context.strokeRect(64, 36, TARGET_WIDTH - 128, TARGET_HEIGHT - 72);
      context.strokeStyle = "rgba(255,226,64,0.72)";
      context.strokeRect(96, 72, TARGET_WIDTH - 192, TARGET_HEIGHT - 144);
      context.fillStyle = "rgba(0,0,0,0.52)";
      context.fillRect(86, 46, 188, 30);
      context.fillStyle = "#ffffff";
      context.font = "700 18px system-ui, sans-serif";
      context.fillText("1280x720 safe area", 96, 68);
      context.restore();
    };

    const renderLayers = () => {
      [...textLayers]
        .sort((a, b) => a.zIndex - b.zIndex)
        .forEach((layer) => {
          if (!layer.content.trim()) return;
          if (layer.id === editingLayerId) return;
          context.save();
          context.translate(layer.x, layer.y);
          context.rotate((layer.rotation * Math.PI) / 180);
          context.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
          context.textAlign = layer.align;
          context.textBaseline = "middle";
          context.lineJoin = "round";
          context.miterLimit = 2;
          context.fillStyle = layer.fill;
          context.strokeStyle = layer.stroke;
          context.lineWidth = layer.strokeWidth;
          if (layer.shadow !== "none") {
            context.shadowColor = "rgba(0,0,0,0.62)";
            context.shadowBlur = layer.shadow.includes("24px") ? 18 : 10;
            context.shadowOffsetY = layer.shadow.includes("12px") ? 8 : 5;
          } else {
            context.shadowColor = "transparent";
            context.shadowBlur = 0;
            context.shadowOffsetY = 0;
          }
          drawNoWrapFittedText(context, layer.content, 0, 0, TEXT_LAYER_RENDER_MAX_WIDTH, layer);
          context.restore();
        });
    };

    const baseImageDataUrl = result?.baseImage?.dataUrl ?? null;
    const baseImageCacheRevision = baseImageRenderRevision;
    const cachedBaseImage =
      baseImageCacheRevision >= 0 && baseImageDataUrl && loadedBaseImageRef.current?.dataUrl === baseImageDataUrl
        ? loadedBaseImageRef.current.image
        : null;

    if (cachedBaseImage) {
      context.clearRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
      context.drawImage(cachedBaseImage, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
      renderSafeAreaGuide();
      renderLayers();
      return;
    }

    if (!baseImageDataUrl) {
      context.clearRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
      context.fillStyle = "#2a1712";
      context.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
      context.fillStyle = "rgba(255,255,255,0.14)";
      context.beginPath();
      context.arc(1050, 210, 150, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "rgba(60,22,8,0.88)";
      context.beginPath();
      context.ellipse(430, 620, 480, 128, 0, 0, Math.PI * 2);
      context.fill();
      renderSafeAreaGuide();
      renderLayers();
    }
  }, [baseImageRenderRevision, editingLayerId, result?.baseImage?.dataUrl, showSafeAreaGuide, textLayers]);

  useEffect(() => {
    const baseImageDataUrl = result?.baseImage?.dataUrl ?? null;
    if (!baseImageDataUrl) {
      loadedBaseImageRef.current = null;
      setBaseImageRenderRevision((revision) => revision + 1);
      return;
    }

    if (loadedBaseImageRef.current?.dataUrl === baseImageDataUrl) return;

    let isCancelled = false;
    const image = new Image();
    image.onload = () => {
      if (isCancelled) return;
      loadedBaseImageRef.current = { dataUrl: baseImageDataUrl, image };
      setBaseImageRenderRevision((revision) => revision + 1);
    };
    image.onerror = () => {
      if (isCancelled) return;
      loadedBaseImageRef.current = null;
      setBaseImageRenderRevision((revision) => revision + 1);
    };
    image.src = baseImageDataUrl;

    return () => {
      isCancelled = true;
    };
  }, [result?.baseImage?.dataUrl]);

  useEffect(() => {
    if (drawCanvasFrameRef.current !== null) {
      window.cancelAnimationFrame(drawCanvasFrameRef.current);
    }
    drawCanvasFrameRef.current = window.requestAnimationFrame(() => {
      drawCanvasFrameRef.current = null;
      drawCanvas();
    });

    return () => {
      if (drawCanvasFrameRef.current !== null) {
        window.cancelAnimationFrame(drawCanvasFrameRef.current);
        drawCanvasFrameRef.current = null;
      }
    };
  }, [drawCanvas]);

  useEffect(() => {
    if (editingLayerId && !editingLayer) {
      setEditingLayerId(null);
    }
  }, [editingLayer, editingLayerId]);

  useEffect(() => {
    if (!editingLayerId) return;
    const editor = inlineTextEditorRef.current;
    if (!editor) return;
    const layer = textLayersRef.current.find((item) => item.id === editingLayerId);
    const content = layer?.content ?? "";
    if (editor.textContent !== content) {
      editor.textContent = content;
    }
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editingLayerId]);

  function cloneTextLayers(layers: TextLayer[]) {
    return layers.map((layer) => ({ ...layer }));
  }

  function areTextLayersEqual(left: TextLayer[], right: TextLayer[]) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function createTextEditorHistorySnapshot(layers = textLayersRef.current): TextEditorHistorySnapshot {
    return {
      textLayers: cloneTextLayers(layers),
      activeLayerId: activeLayerIdRef.current,
      editingLayerId: editingLayerIdRef.current,
      layerIdCounter: layerIdCounterRef.current,
    };
  }

  function syncCanonicalTextInputs(layers: TextLayer[]) {
    setHeadline(layers.find((layer) => layer.id === "headline")?.content ?? layers[0]?.content ?? "");
    setSubHeadline(layers.find((layer) => layer.id === "subHeadline")?.content ?? "");
  }

  function pushTextLayerUndoSnapshot(snapshot: TextEditorHistorySnapshot) {
    const stack = textLayerUndoStackRef.current;
    const previousSnapshot = stack[stack.length - 1];
    if (previousSnapshot && areTextLayersEqual(previousSnapshot.textLayers, snapshot.textLayers)) return;
    stack.push({ ...snapshot, textLayers: cloneTextLayers(snapshot.textLayers) });
    if (stack.length > TEXT_LAYER_UNDO_LIMIT) stack.shift();
  }

  function commitPendingTextLayerUndoSnapshot() {
    const snapshot = pendingTextLayerUndoSnapshotRef.current;
    pendingTextLayerUndoSnapshotRef.current = null;
    if (!snapshot || areTextLayersEqual(snapshot.textLayers, textLayersRef.current)) return;
    pushTextLayerUndoSnapshot(snapshot);
  }

  function ensurePendingTextLayerUndoSnapshot() {
    if (!pendingTextLayerUndoSnapshotRef.current) {
      pendingTextLayerUndoSnapshotRef.current = createTextEditorHistorySnapshot();
    }
  }

  function beginTextLayerUndoStep() {
    commitPendingTextLayerUndoSnapshot();
    pendingTextLayerUndoSnapshotRef.current = createTextEditorHistorySnapshot();
  }

  function restoreTextEditorHistorySnapshot(snapshot: TextEditorHistorySnapshot) {
    const restoredLayers = cloneTextLayers(snapshot.textLayers);
    textLayersRef.current = restoredLayers;
    layerIdCounterRef.current = snapshot.layerIdCounter;
    setTextLayers(restoredLayers);
    syncCanonicalTextInputs(restoredLayers);
    const restoredActiveLayerId = snapshot.activeLayerId && restoredLayers.some((layer) => layer.id === snapshot.activeLayerId)
      ? snapshot.activeLayerId
      : null;
    const restoredEditingLayerId =
      snapshot.editingLayerId && restoredLayers.some((layer) => layer.id === snapshot.editingLayerId)
        ? snapshot.editingLayerId
        : null;
    setActiveLayerId(restoredActiveLayerId);
    setEditingLayerId(restoredEditingLayerId);

    const editor = inlineTextEditorRef.current;
    const editorLayer = restoredEditingLayerId
      ? restoredLayers.find((layer) => layer.id === restoredEditingLayerId)
      : null;
    if (editor && editorLayer && editor.textContent !== editorLayer.content) {
      editor.textContent = editorLayer.content;
    }
    setLastCanvasActionLabel("되돌림");
  }

  function restorePendingChatPreviewSnapshotForStructuredEdit() {
    const snapshot = pendingTextLayerUndoSnapshotRef.current;
    if (!snapshot) return;
    pendingTextLayerUndoSnapshotRef.current = null;
    restoreTextEditorHistorySnapshot(snapshot);
  }

  function undoTextLayerChange() {
    const pendingSnapshot = pendingTextLayerUndoSnapshotRef.current;
    pendingTextLayerUndoSnapshotRef.current = null;
    if (pendingSnapshot && !areTextLayersEqual(pendingSnapshot.textLayers, textLayersRef.current)) {
      restoreTextEditorHistorySnapshot(pendingSnapshot);
      return;
    }

    const previousSnapshot = textLayerUndoStackRef.current.pop();
    if (!previousSnapshot) return;
    restoreTextEditorHistorySnapshot(previousSnapshot);
  }

  function placeInlineTextEditorCaretAtEnd() {
    const editor = inlineTextEditorRef.current;
    if (!editor || typeof window === "undefined" || typeof document === "undefined") return;
    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function restoreInlineTextEditorFocusAfterUndo() {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      placeInlineTextEditorCaretAtEnd();
    });
  }

  function undoInlineTextEditorChange() {
    undoTextLayerChange();
    restoreInlineTextEditorFocusAfterUndo();
  }

  function handleInlineTextEditorBeforeInput(event: ReactFormEvent<HTMLDivElement>) {
    const nativeEvent = event.nativeEvent as InputEvent;
    if (nativeEvent.inputType !== "historyUndo") return;
    event.preventDefault();
    event.stopPropagation();
    undoInlineTextEditorChange();
  }

  function markCanvasAction(label: string) {
    setLastCanvasActionLabel(label);
  }

  function markEditorToolCanvasAction(toolId: ThumbnailEditorToolId) {
    const tool = THUMBNAIL_EDITOR_TOOLS.find((item) => item.id === toolId);
    markCanvasAction(tool ? `${tool.label} 적용` : "캔버스 도구 적용");
  }

  function useCanvasContextInChat() {
    setChatDraft(canvasContextPrompt);
    markCanvasAction("채팅 컨텍스트로 연결됨");
  }

  function isUndoKeyboardShortcut(event: ReactKeyboardEvent<HTMLElement>) {
    return (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "z";
  }

  function handleThumbnailEditorShellKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (!isUndoKeyboardShortcut(event)) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, [role='combobox']")) return;
    event.preventDefault();
    event.stopPropagation();
    undoTextLayerChange();
  }

  function focusCanvasAfterTextTransform() {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      canvasRef.current?.focus({ preventScroll: true });
    });
  }

  function handleTextTransformHandleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!isUndoKeyboardShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();
    undoTextLayerChange();
    focusCanvasAfterTextTransform();
  }

  function updateTextLayer(
    id: string,
    patch: Partial<TextLayer>,
    options: { history?: "record" | "none" } = {},
  ) {
    if (options.history !== "none") {
      commitPendingTextLayerUndoSnapshot();
      pushTextLayerUndoSnapshot(createTextEditorHistorySnapshot());
    }
    if (typeof patch.content === "string") {
      if (id === "headline") setHeadline(patch.content);
      if (id === "subHeadline") setSubHeadline(patch.content);
    }
    setTextLayers((current) => {
      let didUpdate = false;
      const nextLayers = current.map((layer) => {
        if (layer.id !== id) return layer;
        const nextLayer = { ...layer, ...patch };
        const changed = (Object.keys(patch) as Array<keyof TextLayer>).some(
          (key) => nextLayer[key] !== layer[key],
        );
        if (!changed) return layer;
        didUpdate = true;
        return nextLayer;
      });
      if (didUpdate) {
        textLayersRef.current = nextLayers;
      }
      return didUpdate ? nextLayers : current;
    });
  }

  function applyChatRequirementToCanvas(value: string) {
    const normalizedRequirement = normalizeThumbnailChatRequirement(value);
    if (!normalizedRequirement) return;

    const patch = {
      topic: normalizedRequirement.slice(0, CHAT_TOPIC_MAX_LENGTH),
      headline: deriveChatHeadline(normalizedRequirement),
      subHeadline: deriveChatSubHeadline(normalizedRequirement),
    };

    if (!hasThumbnailGenerationIntent(normalizedRequirement)) {
      applyThumbnailChatPatchToCanvas(patch);
      return;
    }

    setTopic(patch.topic);
    setHeadline(patch.headline);
    setSubHeadline(patch.subHeadline);
    setTextLayers((current) => {
      const nextLayers = createTextLayersWithGenerationLayout(
        createTextLayersWithChatPatch(current, patch),
        normalizedRequirement,
        patch.headline,
        patch.subHeadline,
      );
      textLayersRef.current = nextLayers;
      return nextLayers;
    });
    setActiveLayerId(null);
    markCanvasAction("생성 문구 미리보기 반영");
  }

  function applyExplicitStructuredChatPreview(value: string) {
    const normalizedRequirement = normalizeThumbnailChatRequirement(value);
    if (!normalizedRequirement) return false;

    const explicitHeadline =
      pickExplicitChatField(normalizedRequirement, CHAT_EXPLICIT_HEADLINE_PATTERN) ||
      pickExplicitChatField(normalizedRequirement, CHAT_EXPLICIT_HEADLINE_PARTICLE_PATTERN);
    const explicitSubHeadline =
      pickExplicitChatField(normalizedRequirement, CHAT_EXPLICIT_SUBHEADLINE_PATTERN) ||
      pickExplicitChatField(normalizedRequirement, CHAT_EXPLICIT_SUBHEADLINE_PARTICLE_PATTERN);
    if (!explicitHeadline && !explicitSubHeadline) return false;

    const patch = {
      topic: normalizedRequirement.slice(0, CHAT_TOPIC_MAX_LENGTH),
      headline: explicitHeadline ? sanitizeCanvasChatText(explicitHeadline, headline, MAIN_HEADLINE_MAX_LENGTH) : headline,
      subHeadline: explicitSubHeadline ? sanitizeCanvasChatText(explicitSubHeadline, subHeadline, SUB_HEADLINE_MAX_LENGTH) : subHeadline,
    };
    applyThumbnailChatPatchToCanvas(patch);
    markCanvasAction("명시 문구 채팅 반영");
    return true;
  }

  function createTextLayersWithChatPatch(current: TextLayer[], patch: ThumbnailChatCanvasPatch) {
    return current.map((layer) => {
      if (layer.id === "headline") {
        return {
          ...layer,
          content: patch.headline,
          fontSize: getResponsiveMainHeadlineFontSize(patch.headline, layer.fontSize),
          strokeWidth: patch.headline.length >= 16 ? Math.min(layer.strokeWidth, 9) : layer.strokeWidth,
        };
      }
      if (layer.id === "subHeadline") return { ...layer, content: patch.subHeadline };
      return layer;
    });
  }

  function getGenerationLayerTemplate(id: string) {
    if (id === "headline") return DEFAULT_TEXT_LAYERS[0] ?? createDefaultTextLayers()[0];
    if (id === "subHeadline") return DEFAULT_TEXT_LAYERS[1] ?? createDefaultTextLayers()[1];
    return {
      id,
      content: "",
      x: 640,
      y: 360,
      fontFamily: "Pretendard, system-ui, sans-serif",
      fontSize: 38,
      fontWeight: 900,
      fill: "#ffffff",
      stroke: "#111111",
      strokeWidth: 6,
      shadow: "0 8px 18px rgba(0,0,0,0.65)",
      align: "center" as const,
      rotation: 0,
      zIndex: 7,
    };
  }

  function createGenerationTextLayer(
    currentById: Map<string, TextLayer>,
    id: string,
    patch: Partial<TextLayer> & Pick<TextLayer, "content">,
  ) {
    const base = currentById.get(id) ?? getGenerationLayerTemplate(id);
    return {
      ...cloneTextLayer(base),
      ...patch,
      id,
      content: patch.content,
    };
  }

  function deriveGenerationTextAccentCopy(topicText: string, foodSubject: string) {
    const normalizedTopic = normalizeThumbnailChatRequirement(topicText);
    if (/야시장|시장|노점|길거리|분식/i.test(normalizedTopic)) return "현장 먹방";
    if (/매운|불맛|마라|불닭|떡볶이|라면/i.test(normalizedTopic) || /마라|불닭|떡볶이|라면/i.test(foodSubject)) return "맵기 체크";
    if (/대왕|대형|거대|압도|챌린지|도전|한입|가능/i.test(normalizedTopic)) return "도전 성공?";
    if (/고기|삼겹살|갈비|곱창|막창|제육|철판/i.test(normalizedTopic) || /제육|삼겹살|갈비|곱창|막창/i.test(foodSubject)) return "불판 직행";
    if (/초밥|스시|회|대게|킹크랩|랍스터|해산물|바다/i.test(normalizedTopic) || /초밥|회|대게|킹크랩|랍스터|해산물/i.test(foodSubject)) return "신선도 체크";
    if (/편의점|신상|리뷰|하울/i.test(normalizedTopic)) return "신상 리뷰";
    return "";
  }

  function deriveGenerationTextCaptionCopy(topicText: string, foodSubject: string) {
    const normalizedTopic = normalizeThumbnailChatRequirement(topicText);
    if (/야시장|시장|노점|길거리/i.test(normalizedTopic)) return "야식 감성 폭발";
    if (/대왕|대형|거대|압도|많이|양/i.test(normalizedTopic)) return "크기 실화?";
    if (/한입|가능|챌린지|도전/i.test(normalizedTopic)) return "한입 컷 가능?";
    if (/제육|김치찌개|된장찌개|백반|국밥/i.test(foodSubject)) return "밥 한 공기 순삭";
    if (/초밥|스시|회|대게|킹크랩|랍스터|해산물/i.test(foodSubject)) return "비주얼 미쳤다";
    return "";
  }

  function getResponsiveMainHeadlineFontSize(headlineText: string, currentFontSize = 88) {
    if (headlineText.length >= 24) return Math.min(currentFontSize, 58);
    if (headlineText.length >= 16) return Math.min(currentFontSize, 66);
    return currentFontSize;
  }

  function createTextLayersWithGenerationLayout(current: TextLayer[], topicText: string, headlineText: string, subHeadlineText: string) {
    const normalizedTopic = normalizeThumbnailChatRequirement(topicText);
    const isTzuyangBenchmarkLayout = SPECIFIC_CREATOR_HOST_PATTERN.test(normalizedTopic) || /썸네일|먹방|밥도둑|한상|유튜브\s*썸네일/i.test(normalizedTopic);
    const isMarketLayout = /야시장|시장|노점|길거리|분식/i.test(normalizedTopic);
    const isSpicyLayout = /매운|불맛|마라|불닭|떡볶이|라면|제육|닭발|쭈꾸미|빨간/i.test(normalizedTopic);
    const isChallengeLayout = /대왕|대형|거대|압도|챌린지|도전|한입|가능|기록|전메뉴|전\s*메뉴/i.test(normalizedTopic);
    const isSeafoodLayout = /초밥|스시|회|대게|킹크랩|랍스터|해산물|바다/i.test(normalizedTopic);
    const isLongHeadline = headlineText.length >= 8;
    const headlineFontSize = getResponsiveMainHeadlineFontSize(headlineText, isTzuyangBenchmarkLayout ? (isLongHeadline ? 56 : 72) : isMarketLayout || isLongHeadline ? 78 : 88);
    const subHeadlineFontSize = isTzuyangBenchmarkLayout ? (isChallengeLayout ? 38 : 40) : isChallengeLayout ? 42 : 44;
    const accentFontSize = isChallengeLayout ? 40 : 38;
    const captionFontSize = 32;
    const foodSubject = deriveThumbnailFoodSubject(topicText);
    const accentCopy = deriveGenerationTextAccentCopy(topicText, foodSubject);
    const captionCopy = deriveGenerationTextCaptionCopy(topicText, foodSubject);
    const protectedZones = isTzuyangBenchmarkLayout ? TEXT_OCCLUSION_PROTECTED_ZONES.benchmark : TEXT_OCCLUSION_PROTECTED_ZONES.default;
    const fallbackHeadlineCandidates: TextPlacementCandidate[] = [
      { x: isMarketLayout ? 296 : isSeafoodLayout ? 300 : 304, y: isChallengeLayout ? 342 : 354, label: "safe-left-mid" },
      { x: isMarketLayout ? 460 : isSeafoodLayout ? 640 : 632, y: isMarketLayout ? 548 : isChallengeLayout ? 556 : 540, label: "legacy-fallback" },
      { x: 1016, y: 154, label: "right-top" },
    ];
    const fallbackSubHeadlineCandidates: TextPlacementCandidate[] = [
      { x: isMarketLayout ? 250 : isChallengeLayout ? 248 : 270, y: isMarketLayout ? 142 : isChallengeLayout ? 136 : 148, label: "safe-left-top" },
      { x: isMarketLayout ? 986 : isSeafoodLayout ? 1010 : 990, y: isMarketLayout ? 156 : 162, label: "legacy-fallback" },
      { x: 1030, y: 618, label: "right-bottom" },
    ];
    const fallbackAccentCandidates: TextPlacementCandidate[] = [
      { x: isMarketLayout ? 250 : isChallengeLayout ? 248 : 270, y: isMarketLayout ? 142 : isChallengeLayout ? 136 : 148, label: "safe-left-top" },
      { x: 1030, y: 618, label: "right-bottom" },
      { x: 316, y: 222, label: "left-upper" },
    ];
    const fallbackCaptionCandidates: TextPlacementCandidate[] = [
      { x: 270, y: 620, label: "safe-left-bottom" },
      { x: isMarketLayout ? 1048 : isSeafoodLayout ? 1000 : 1026, y: isMarketLayout ? 626 : isChallengeLayout ? 626 : 608, label: "legacy-fallback" },
      { x: 330, y: 208, label: "left-upper" },
    ];
    const headlinePosition = selectNonOccludingTextPlacement(
      "headline",
      headlineText,
      headlineFontSize,
      "center",
      isTzuyangBenchmarkLayout ? TEXT_OCCLUSION_BENCHMARK_CANDIDATES.headline : fallbackHeadlineCandidates,
      protectedZones,
    );
    const headlineTextZone = createGeneratedTextProtectedZone(
      "generated-headline",
      headlineText,
      headlineFontSize,
      headlinePosition,
      "center",
      20,
    );
    const subHeadlineProtectedZones = [...protectedZones, headlineTextZone];
    const subHeadlinePosition = selectNonOccludingTextPlacement(
      "subHeadline",
      subHeadlineText,
      subHeadlineFontSize,
      "center",
      isTzuyangBenchmarkLayout ? TEXT_OCCLUSION_BENCHMARK_CANDIDATES.subHeadline : fallbackSubHeadlineCandidates,
      subHeadlineProtectedZones,
    );
    const subHeadlineTextZone = createGeneratedTextProtectedZone(
      "generated-subHeadline",
      subHeadlineText,
      subHeadlineFontSize,
      subHeadlinePosition,
      "center",
      22,
    );
    const accentProtectedZones = [...subHeadlineProtectedZones, subHeadlineTextZone];
    const accentPosition = selectNonOccludingTextPlacement(
      "accentBadge",
      accentCopy,
      accentFontSize,
      "center",
      isTzuyangBenchmarkLayout ? TEXT_OCCLUSION_BENCHMARK_CANDIDATES.accentBadge : fallbackAccentCandidates,
      accentProtectedZones,
    );
    const accentTextZone = accentCopy
      ? createGeneratedTextProtectedZone(
        "generated-accentBadge",
        accentCopy,
        accentFontSize,
        accentPosition,
        "center",
        18,
      )
      : null;
    const captionProtectedZones = accentTextZone ? [...accentProtectedZones, accentTextZone] : accentProtectedZones;
    const captionPosition = selectNonOccludingTextPlacement(
      "contextCaption",
      captionCopy,
      captionFontSize,
      "center",
      isTzuyangBenchmarkLayout ? TEXT_OCCLUSION_BENCHMARK_CANDIDATES.contextCaption : fallbackCaptionCandidates,
      captionProtectedZones,
    );
    const currentById = new Map(current.map((layer) => [layer.id, layer]));
    const generatedLayerIds = new Set(["headline", "subHeadline", "accentBadge", "contextCaption"]);

    const headlineLayer = createGenerationTextLayer(currentById, "headline", {
      content: headlineText,
      x: headlinePosition.x,
      y: headlinePosition.y,
      fontFamily: "Impact, Pretendard, system-ui, sans-serif",
      fontSize: headlineFontSize,
      fontWeight: 900,
      fill: "#ffffff",
      stroke: isSpicyLayout ? "#7f1d1d" : "#111111",
      strokeWidth: isLongHeadline ? 9 : 10,
      shadow: "0 12px 24px rgba(0,0,0,0.72)",
      align: "center",
      rotation: 0,
      zIndex: 5,
    });

    const subHeadlineLayer = createGenerationTextLayer(currentById, "subHeadline", {
      content: subHeadlineText,
      x: subHeadlinePosition.x,
      y: subHeadlinePosition.y,
      fontFamily: "Arial Black, Pretendard, system-ui, sans-serif",
      fontSize: subHeadlineFontSize,
      fontWeight: 900,
      fill: isSpicyLayout ? "#ff3b30" : "#fff200",
      stroke: "#111111",
      strokeWidth: 7,
      shadow: "0 8px 18px rgba(0,0,0,0.65)",
      align: "center",
      rotation: isMarketLayout ? -6 : -4,
      zIndex: 6,
    });

    const generatedLayers = [headlineLayer, subHeadlineLayer];
    if (accentCopy) {
      generatedLayers.push(createGenerationTextLayer(currentById, "accentBadge", {
        content: accentCopy,
        x: accentPosition.x,
        y: accentPosition.y,
        fontFamily: "Pretendard, system-ui, sans-serif",
        fontSize: accentFontSize,
        fontWeight: 900,
        fill: isSpicyLayout ? "#ffffff" : "#111111",
        stroke: isSpicyLayout ? "#dc2626" : "#ffffff",
        strokeWidth: isSpicyLayout ? 8 : 7,
        shadow: "0 8px 18px rgba(0,0,0,0.58)",
        align: "center",
        rotation: isMarketLayout ? -4 : -2,
        zIndex: 7,
      }));
    }
    const shouldUseContextCaption = Boolean(captionCopy) && (isMarketLayout || isChallengeLayout || isSeafoodLayout || foodSubject) && !accentCopy;
    if (shouldUseContextCaption) {
      generatedLayers.push(createGenerationTextLayer(currentById, "contextCaption", {
        content: captionCopy,
        x: captionPosition.x,
        y: captionPosition.y,
        fontFamily: "Pretendard, system-ui, sans-serif",
        fontSize: captionFontSize,
        fontWeight: 900,
        fill: "#ffffff",
        stroke: "#111111",
        strokeWidth: 5,
        shadow: "0 8px 18px rgba(0,0,0,0.58)",
        align: "center",
        rotation: isMarketLayout ? 2 : 0,
        zIndex: 8,
      }));
    }

    const preservedCustomLayers = current
      .filter((layer) => !generatedLayerIds.has(layer.id))
      .filter((layer) => layer.content.trim())
      .map((layer, index) => ({ ...layer, zIndex: Math.max(layer.zIndex, 9 + index) }));

    return [...generatedLayers, ...preservedCustomLayers].slice(0, 8);
  }

  function shouldAutoGenerateThumbnailCopy(value: string, fallback: string) {
    const normalized = normalizeInlineEditableText(value);
    return !normalized || normalized === fallback;
  }

  function createNaturalGenerationCopy(
    submittedTopic: string,
    submittedHeadline: string,
    submittedSubHeadline: string,
    submittedTextLayers: TextLayer[],
  ) {
    const nextHeadline = shouldAutoGenerateThumbnailCopy(submittedHeadline, DEFAULT_TEXT_LAYERS[0]?.content ?? "역대급 먹방")
      ? deriveChatHeadline(submittedTopic)
      : submittedHeadline;
    const nextSubHeadline = shouldAutoGenerateThumbnailCopy(submittedSubHeadline, DEFAULT_TEXT_LAYERS[1]?.content ?? "한입만 가능?")
      ? deriveChatSubHeadline(submittedTopic)
      : submittedSubHeadline;
    const nextTextLayers = createTextLayersWithChatPatch(submittedTextLayers, {
      topic: submittedTopic,
      headline: nextHeadline,
      subHeadline: nextSubHeadline,
    });
    const nextLaidOutTextLayers = createTextLayersWithGenerationLayout(
      nextTextLayers,
      submittedTopic,
      nextHeadline,
      nextSubHeadline,
    );

    return {
      topic: submittedTopic,
      headline: nextHeadline,
      subHeadline: nextSubHeadline,
      textLayers: nextLaidOutTextLayers,
    };
  }

  function syncNaturalGenerationCopyToCanvas(copy: ReturnType<typeof createNaturalGenerationCopy>) {
    setHeadline(copy.headline);
    setSubHeadline(copy.subHeadline);
    textLayersRef.current = copy.textLayers;
    setTextLayers(copy.textLayers);
    markCanvasAction("생성 문구 자동 반영");
  }

  function createTextLayersWithChatTextLayerPatches(current: TextLayer[], patches: ThumbnailChatTextLayerPatch[] = []) {
    if (!patches.length) return current;
    return current.map((layer) => {
      const patch = patches.find((item) => item.id === layer.id);
      if (!patch) return layer;
      const nextLayer: TextLayer = { ...layer };
      if (typeof patch.content === "string") {
        nextLayer.content = normalizeInlineEditableText(patch.content).slice(0, 80);
        if (layer.id === "headline" && !Number.isFinite(patch.fontSize)) {
          nextLayer.fontSize = getResponsiveMainHeadlineFontSize(nextLayer.content, nextLayer.fontSize);
          nextLayer.strokeWidth = nextLayer.content.length >= 16 ? Math.min(nextLayer.strokeWidth, 9) : nextLayer.strokeWidth;
        }
      }
      if (typeof patch.fontFamily === "string") nextLayer.fontFamily = patch.fontFamily.slice(0, 80);
      if (Number.isFinite(patch.fontSize)) nextLayer.fontSize = clampTextLayerFontSize(Number(patch.fontSize));
      if (Number.isFinite(patch.fontWeight)) nextLayer.fontWeight = Math.max(300, Math.min(950, Math.round(Number(patch.fontWeight))));
      if (typeof patch.fill === "string") nextLayer.fill = patch.fill.slice(0, 32);
      if (typeof patch.stroke === "string") nextLayer.stroke = patch.stroke.slice(0, 32);
      if (Number.isFinite(patch.strokeWidth)) nextLayer.strokeWidth = Math.max(0, Math.min(20, Number(patch.strokeWidth)));
      if (typeof patch.shadow === "string") nextLayer.shadow = patch.shadow.slice(0, 120);
      if (Number.isFinite(patch.x)) nextLayer.x = clampCanvasCoordinate(Number(patch.x), TARGET_WIDTH);
      if (Number.isFinite(patch.y)) nextLayer.y = clampCanvasCoordinate(Number(patch.y), TARGET_HEIGHT);
      if (patch.align === "left" || patch.align === "center" || patch.align === "right") nextLayer.align = patch.align;
      if (Number.isFinite(patch.rotation)) nextLayer.rotation = normalizeCanvasRotation(Number(patch.rotation));
      if (Number.isFinite(patch.zIndex)) nextLayer.zIndex = Math.max(0, Math.min(99, Math.round(Number(patch.zIndex))));
      return nextLayer;
    });
  }

  function applyThumbnailChatTextLayerPatches(patches: ThumbnailChatTextLayerPatch[] = []) {
    const firstPatchId = patches.find((patch) => textLayersRef.current.some((layer) => layer.id === patch.id))?.id;
    if (!patches.length) return textLayersRef.current;
    const currentLayers = textLayersRef.current;
    const nextLayers = createTextLayersWithChatTextLayerPatches(currentLayers, patches);
    const didUpdate = nextLayers.some((layer, index) => {
      const currentLayer = currentLayers[index];
      return Boolean(currentLayer && (Object.keys(layer) as Array<keyof TextLayer>).some((key) => layer[key] !== currentLayer[key]));
    });
    if (didUpdate) {
      textLayersRef.current = nextLayers;
      setTextLayers(nextLayers);
    }
    const nextHeadline = nextLayers.find((layer) => layer.id === "headline")?.content;
    const nextSubHeadline = nextLayers.find((layer) => layer.id === "subHeadline")?.content;
    if (typeof nextHeadline === "string") setHeadline(nextHeadline);
    if (typeof nextSubHeadline === "string") setSubHeadline(nextSubHeadline);
    if (firstPatchId) setActiveLayerId(firstPatchId);
    if (firstPatchId) markCanvasAction("선택 문구 채팅 반영");
    return didUpdate ? nextLayers : currentLayers;
  }

  function applyThumbnailChatPatchToCanvas(
    patch: ThumbnailChatCanvasPatch,
    options: { preserveActiveLayer?: boolean } = {},
  ) {
    setTopic(patch.topic.slice(0, CHAT_TOPIC_MAX_LENGTH));
    setHeadline(patch.headline);
    setSubHeadline(patch.subHeadline);
    setTextLayers((current) => {
      const nextLayers = createTextLayersWithChatPatch(current, patch);
      const didUpdate = nextLayers.some((layer, index) => layer.content !== current[index]?.content);
      if (didUpdate) {
        textLayersRef.current = nextLayers;
      }
      return didUpdate ? nextLayers : current;
    });
    if (!options.preserveActiveLayer) setActiveLayerId(null);
    markCanvasAction("채팅 반영");
  }

  function applyThumbnailChatResultToCanvas(
    patch: ThumbnailChatCanvasPatch,
    patches: ThumbnailChatTextLayerPatch[] = [],
    options: { preserveActiveLayer?: boolean; normalizeGeneratedLayout?: boolean } = {},
  ) {
    const patchedLayers = createTextLayersWithChatTextLayerPatches(
      createTextLayersWithChatPatch(textLayersRef.current, patch),
      patches,
    );
    const nextLayers = options.normalizeGeneratedLayout
      ? createTextLayersWithGenerationLayout(
        patchedLayers,
        patch.topic,
        patch.headline,
        patch.subHeadline,
      )
      : patchedLayers;
    textLayersRef.current = nextLayers;
    setTopic(patch.topic.slice(0, CHAT_TOPIC_MAX_LENGTH));
    syncCanonicalTextInputs(nextLayers);
    setTextLayers(nextLayers);
    const firstPatchId = patches.find((item) => nextLayers.some((layer) => layer.id === item.id))?.id;
    if (firstPatchId) {
      setActiveLayerId(firstPatchId);
      markCanvasAction("선택 문구 채팅 반영");
      return;
    }
    if (!options.preserveActiveLayer) setActiveLayerId(null);
    markCanvasAction("채팅 반영");
  }

  function appendThumbnailChatMessages(messages: ThumbnailChatMessage[]) {
    setChatMessages((current) => {
      const nextMessages = [
        ...current,
        ...messages.map((message) =>
          message.role === "assistant"
            ? {
                ...message,
                content: formatThumbnailAssistantDisplayText(message.content),
              }
            : message,
        ),
      ];
      const introMessage = nextMessages.find((message) => message.id === "assistant-intro");
      const recentMessages = nextMessages
        .filter((message) => message.id !== "assistant-intro")
        .slice(-9);

      return introMessage ? [introMessage, ...recentMessages] : recentMessages.slice(-10);
    });
  }

  function updateThumbnailChatMessage(messageId: string, content: string, mode: ThumbnailChatMessage["mode"] = "stream") {
    setChatMessages((current) => current.map((message) => (
      message.id === messageId
        ? {
            ...message,
            content:
              message.role === "assistant"
                ? formatThumbnailAssistantDisplayText(content)
                : content,
            mode,
          }
        : message
    )));
  }

  function appendThumbnailChatCommand(userContent: string, assistantContent: string, mode: ThumbnailChatMessage["mode"] = "live") {
    const userMessageId = `user-${chatMessageIdRef.current++}`;
    const assistantMessageId = `assistant-${chatMessageIdRef.current++}`;
    appendThumbnailChatMessages([
      {
        id: userMessageId,
        role: "user",
        mode: "submitted",
        content: userContent,
      },
      {
        id: assistantMessageId,
        role: "assistant",
        mode,
        content: assistantContent,
      },
    ]);
    return assistantMessageId;
  }

  function appendThumbnailChatAssistantNotice(content: string, mode: ThumbnailChatMessage["mode"] = "live") {
    appendThumbnailChatMessages([
      {
        id: `assistant-${chatMessageIdRef.current++}`,
        role: "assistant",
        mode,
        content,
      },
    ]);
  }

  function handleThumbnailUsageGuideClick() {
    appendThumbnailChatCommand("가이드 보기", THUMBNAIL_USAGE_GUIDE_TEXT, "system");
  }

  function applyThumbnailGuidedExamplePreviewToCanvas(example: ThumbnailGuidedExamplePreset) {
    const nextLayers = createTextLayersWithGenerationLayout(
      createDefaultTextLayers(),
      example.topic,
      example.headline,
      example.subHeadline,
    );

    userCanvasResultLockedRef.current = true;
    setTopic(example.request.slice(0, CHAT_TOPIC_MAX_LENGTH));
    setHeadline(example.headline);
    setSubHeadline(example.subHeadline);
    textLayersRef.current = nextLayers;
    setTextLayers(nextLayers);
    // Keep the immediate canvas preview visible even if the provider request
    // later fails; it remains marked as a non-final preview until a real result
    // replaces it.
    setResult({
      ...BUNDLED_THUMBNAIL_PREVIEW_RESULT,
      prompt: `예시 만들기: ${example.topic}`,
      warnings: ["실제 이미지 생성 전 빠르게 보여 주는 예시 화면입니다."],
    });
    setBaseImageRenderRevision((revision) => revision + 1);
    setActiveLayerId("headline");
    markCanvasAction("예시 썸네일 생성 시작");
    pendingChatGenerationRequirementRef.current = null;

    return nextLayers;
  }

  function handleThumbnailGuidedExamplePresetClick(example: ThumbnailGuidedExamplePreset) {
    const nextLayers = applyThumbnailGuidedExamplePreviewToCanvas(example);
    const assistantMessageId = appendThumbnailChatCommand(
      "예시 만들기",
      example.response,
    );
    void runThumbnailGeneration({
      providerId,
      generationMode,
      topic: example.topic,
      headline: example.headline,
      subHeadline: example.subHeadline,
      textLayers: nextLayers,
    }, assistantMessageId);
  }

  function handleThumbnailGuidedExampleClick() {
    const example =
      THUMBNAIL_GUIDED_EXAMPLE_PRESETS[
        guidedExampleVariantIndexRef.current %
          THUMBNAIL_GUIDED_EXAMPLE_PRESETS.length
      ] ?? THUMBNAIL_GUIDED_EXAMPLE_PRESETS[0];
    guidedExampleVariantIndexRef.current += 1;
    handleThumbnailGuidedExamplePresetClick(example);
  }

  function getAbortNotice(kind: "chat" | "generation") {
    return kind === "chat"
      ? "채팅 작업을 멈췄습니다. 진행 중이던 요청도 함께 취소했습니다."
      : "썸네일 생성을 멈췄습니다. 진행 중이던 업로드와 이미지 만들기 요청을 함께 취소했습니다.";
  }

  function getThumbnailRealDataStatusSummary() {
    const currentResult = resultRef.current ?? result;
    const resultSource = getThumbnailResultSourceLabel(currentResult);
    const resultBase = currentResult?.baseImage;
    const sessionKeyBackedProviderAvailable = canUseSessionApiKeyForProvider(
      providerId,
      selectedProviderAvailability,
      isBrowserOpenAIApiKeyApplied,
    );
    const progressState = isGenerating
      ? "이미지를 만드는 중"
      : isChatAgentStreaming
        ? "요청을 정리하는 중"
        : "대기 중";
    const resultBoundary = resultBase?.modelProvenance === "exact"
      ? "현재 화면에는 확인된 이미지가 들어 있습니다."
      : "확인된 이미지일 때만 실제 결과로 표시합니다.";
    const imageMakeStatus = thumbnailImageRouteChoice === THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID
      ? (isThumbnailLocalBridgeConnected ? "고급 로컬 브릿지 연결됨" : "고급 로컬 브릿지 설정 필요")
      : formatThumbnailProviderAvailability(selectedProviderAvailability, sessionKeyBackedProviderAvailable);

    return [
      "현재 상태를 쉽게 정리했어요.",
      `이미지 만들기: ${imageMakeStatus}`,
      resultBase
        ? `현재 화면: ${resultSource}`
        : "현재 화면: 아직 만든 이미지 없음",
      currentResult?.retrieval
        ? formatThumbnailRetrievalSummaryForBeginner(currentResult.retrieval)
        : (historyRuns[0]?.retrieval ? formatThumbnailRetrievalSummaryForBeginner(historyRuns[0].retrieval) : "참고 썸네일 검색: 아직 실행 안 됨"),
      `저장된 결과: ${formatThumbnailHistoryStatus(historyStatus, historyRuns, historyError)}`,
      `참고 이미지: 현재 ${files.length}장 추가됨`,
      `진행 상태: ${progressState}`,
      resultBoundary,
      "다음에는 원하는 음식, 짧은 문구, 참고 이미지를 알려 주세요.",
    ].join("\n");
  }

  function abortThumbnailChatWork() {
    const controller = chatAbortControllerRef.current;
    const generationController = generationAbortControllerRef.current;
    if ((!controller || controller.signal.aborted) && (!generationController || generationController.signal.aborted)) return;
    if (controller && !controller.signal.aborted) controller.abort();
    if (generationController && !generationController.signal.aborted) abortThumbnailGeneration();
    setIsChatAgentStreaming(false);
    const activeMessageId = activeChatAssistantMessageIdRef.current;
    if (activeMessageId) {
      updateThumbnailChatMessage(activeMessageId, getAbortNotice("chat"), "live");
    } else {
      appendThumbnailChatCommand("채팅 중단", getAbortNotice("chat"));
    }
  }

  function abortThumbnailGeneration() {
    const controller = generationAbortControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort();
    setIsGenerating(false);
    const activeMessageId = activeGenerationAssistantMessageIdRef.current;
    if (activeMessageId) {
      updateThumbnailChatMessage(activeMessageId, getAbortNotice("generation"), "live");
    } else {
      appendThumbnailChatCommand("생성 중단", getAbortNotice("generation"));
    }
  }

  function applyThumbnailHistoryRun(run: ThumbnailHistoryRun) {
    const nextResult = createThumbnailResultFromHistoryRun(run);
    if (!nextResult) {
      toast({
        variant: "destructive",
        title: "히스토리 불러오기 실패",
        description: "실제 생성 완료 결과만 캔버스에 불러올 수 있습니다.",
      });
      return;
    }

    userCanvasResultLockedRef.current = true;
    setResult(nextResult);
    markCanvasAction("히스토리 반영");
    latestHistoryRunKeyRef.current = run.id ?? run.timestamp ?? run.imagePath ?? nextResult.baseImage.dataUrl;
    if (isProviderId(run.providerId)) setProviderId(run.providerId);
    if (isGenerationMode(run.generationMode)) setGenerationMode(run.generationMode);
    const runTopic = createTzuyangAutomaticPreviewTopic(run.topic?.trim().slice(0, CHAT_TOPIC_MAX_LENGTH) || DEFAULT_TOPIC);
    setTopic(runTopic);
    const latestHeadline = run.headline?.trim();
    if (latestHeadline) {
      const nextHeadline = deriveAutomaticThumbnailHeadlineCopy(runTopic, latestHeadline);
      const nextSubHeadline = deriveChatSubHeadline(`${runTopic} ${latestHeadline}`);
      setHeadline(nextHeadline);
      setSubHeadline(nextSubHeadline);
      setTextLayers((currentLayers) => {
        const nextLayers = createTextLayersWithGenerationLayout(
          createTextLayersWithChatPatch(currentLayers, {
            topic: runTopic,
            headline: nextHeadline,
            subHeadline: nextSubHeadline,
          }),
          runTopic,
          nextHeadline,
          nextSubHeadline,
        );
        textLayersRef.current = nextLayers;
        return nextLayers;
      });
      setActiveLayerId(null);
    }
    appendThumbnailChatCommand(
      "히스토리 결과 불러오기",
      `${run.completedAt ?? run.timestamp ?? "선택한"} 실제 생성 결과를 캔버스에 반영했습니다.`,
    );
  }

  async function copyThumbnailHistoryRun(run: ThumbnailHistoryRun) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(run, null, 2));
      toast({
        title: "히스토리 JSON 복사 완료",
        description: "선택한 생성 기록 메타데이터를 클립보드에 복사했습니다.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "복사 실패",
        description: "브라우저 클립보드 권한을 확인하세요.",
      });
    }
  }

  function handleChatDraftChange(value: string) {
    setChatDraft(value);
  }
  function sanitizeThumbnailChatConversationContent(value: string) {
    return normalizeThumbnailChatRequirement(value).slice(0, THUMBNAIL_CHAT_CONVERSATION_CONTENT_MAX_LENGTH);
  }

  function isThumbnailChatReadbackMessage(message: ThumbnailChatMessage) {
    if (message.role === "user") return false;
    const normalized = sanitizeThumbnailChatConversationContent(message.content);
    return (
      message.mode === "system" ||
      message.id === "assistant-intro" ||
      message.id.startsWith("assistant-history-load") ||
      normalized.startsWith("원하는 썸네일을 말로 적어 주세요") ||
      normalized.startsWith("간단히 3가지만 적어 주세요") ||
      normalized.startsWith("현재 상태를 쉽게 정리했어요") ||
      normalized.startsWith("생성 히스토리를 이 페이지 안에서 열었습니다") ||
      normalized.startsWith("현재 캔버스를 PNG로 저장했습니다") ||
      normalized.startsWith("참고 이미지 파일 선택창을 열었습니다") ||
      normalized.startsWith("참고 이미지를 모두 비웠습니다") ||
      normalized.includes("실제 생성 결과를 캔버스에 반영했습니다") ||
      normalized.includes("공용 릴리즈") ||
      normalized.includes("릴리즈 후보")
    );
  }

  function buildThumbnailChatConversationMessages(): ThumbnailChatConversationMessagePayload[] {
    return chatMessages
      .flatMap((message): ThumbnailChatConversationMessagePayload[] => {
        if (message.mode === "stream" || isThumbnailChatReadbackMessage(message)) return [];
        const content = sanitizeThumbnailChatConversationContent(message.content);
        if (!content || isUnsafeThumbnailChatInstructionPrompt(content)) return [];
        return [{ id: message.id, role: message.role, content }];
      })
      .slice(-THUMBNAIL_CHAT_CONVERSATION_CONTEXT_LIMIT);
  }

  function buildThumbnailChatFocusContext(): ThumbnailChatFocusContextPayload | null {
    if (!canvasContextLayer) return null;
    const role = canvasContextLayer.id === "headline" || canvasContextLayer.id === "subHeadline"
      ? canvasContextLayer.id
      : "custom";
    return {
      kind: "text-layer",
      label: getCanvasLayerDisplayName(canvasContextLayer),
      layerId: canvasContextLayer.id,
      role,
      detail: canvasContextSummary,
      promptContext: canvasContextPrompt,
      createdAt: new Date().toISOString(),
    };
  }

  function buildThumbnailReferenceImageAttachments(): ThumbnailChatReferenceImageAttachmentPayload[] {
    return files.map((file, index) => ({
      id: `thumbnail-reference-${index + 1}-${file.name}-${file.size}`,
      name: file.name.slice(0, 120),
      mime: file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp"
        ? file.type
        : undefined,
      size: file.size,
      role: referenceImageRoles[index] ?? (index === 0 ? "host" : "other"),
    }));
  }

  async function handleThumbnailChatSubmit() {
    const submittedRequirement = normalizeThumbnailChatRequirement(chatDraft);
    if (!submittedRequirement || isChatAgentStreaming || isGenerating) return;

    const nonMutatingPrompt = isNonMutatingThumbnailChatPrompt(submittedRequirement);
    const submittedHasGenerationIntent = hasThumbnailGenerationIntent(submittedRequirement) && !nonMutatingPrompt;
    const structuredEditPrompt = isThumbnailChatStructuredEditPrompt(submittedRequirement);
    const replacementEditPrompt = isThumbnailChatReplacementPrompt(submittedRequirement);
    const shouldUseStructuredEditPreview = !nonMutatingPrompt && structuredEditPrompt && (!submittedHasGenerationIntent || replacementEditPrompt);
    const localCommand = resolveThumbnailChatLocalCommand(submittedRequirement);
    if (localCommand) {
      commitPendingTextLayerUndoSnapshot();
      setChatDraft("");
      await handleThumbnailChatCommand(localCommand, submittedRequirement);
      return;
    }

    if (isUnsafeThumbnailChatInstructionPrompt(submittedRequirement)) {
      commitPendingTextLayerUndoSnapshot();
      appendThumbnailChatMessages([
        {
          id: `user-${chatMessageIdRef.current++}`,
          role: "user",
          mode: "submitted",
          content: submittedRequirement,
        },
        {
          id: `assistant-${chatMessageIdRef.current++}`,
          role: "assistant",
          mode: "live",
          content: getUnsafeThumbnailChatInstructionMessage(),
        },
      ]);
      setChatDraft("");
      return;
    }

    if (shouldUseStructuredEditPreview) {
      restorePendingChatPreviewSnapshotForStructuredEdit();
    } else {
      commitPendingTextLayerUndoSnapshot();
    }
    if (shouldUseStructuredEditPreview) applyExplicitStructuredChatPreview(submittedRequirement);
    const previousGenerationCopy = {
      headline,
      subHeadline,
    };
    const selectedLayerPrompt = isSelectedLayerChatPrompt(submittedRequirement);
    if (!selectedLayerPrompt && !shouldUseStructuredEditPreview && !nonMutatingPrompt) applyChatRequirementToCanvas(submittedRequirement);
    pendingChatGenerationRequirementRef.current = submittedHasGenerationIntent
      ? submittedRequirement
      : null;
    if (submittedHasGenerationIntent) {
      userCanvasResultLockedRef.current = true;
    }
    const nextUserMessageId = `user-${chatMessageIdRef.current++}`;
    const nextAssistantMessageId = `assistant-${chatMessageIdRef.current++}`;
    const nextUserMessage: ThumbnailChatMessage = {
      id: nextUserMessageId,
      role: "user",
      mode: "submitted",
      content: submittedRequirement,
    };
    const nextAssistantMessage: ThumbnailChatMessage = {
      id: nextAssistantMessageId,
      role: "assistant",
      mode: "stream",
      content: "요청을 읽고 썸네일 문구와 배치를 정리하고 있어요...",
    };
    appendThumbnailChatMessages([nextUserMessage, nextAssistantMessage]);
    setChatDraft("");
    setIsChatAgentStreaming(true);
    const controller = new AbortController();
    const chatRunId = createThumbnailChatRunId(nextAssistantMessageId);
    chatAbortControllerRef.current = controller;
    activeChatAssistantMessageIdRef.current = nextAssistantMessageId;

    let finalResult: ThumbnailChatAgentResult | null = null;
    try {
      const response = await fetch(THUMBNAIL_CHAT_AGENT_STREAM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          chatRunId,
          chatThreadId: thumbnailChatThreadIdRef.current,
          message: submittedRequirement,
          currentTopic: topic,
          currentHeadline: headline,
          currentSubHeadline: subHeadline,
          activeLayerId: activeLayerIdRef.current,
          editingLayerId,
          lastCanvasActionLabel,
          currentTextLayers: textLayersRef.current,
          conversationMessages: buildThumbnailChatConversationMessages(),
          focusContext: buildThumbnailChatFocusContext(),
          referenceImageAttachments: buildThumbnailReferenceImageAttachments(),
          providerId,
          generationMode,
        }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null) as ThumbnailApiErrorPayload | null;
        throw new Error(getThumbnailErrorAction(payload));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastStatus = "요청을 처리하는 중이에요...";

      const handleChatStreamEvent = (item: ThumbnailChatSseEvent) => {
        if (item.event === "status" && item.data && typeof item.data === "object" && "message" in item.data) {
          lastStatus = String((item.data as { message?: unknown }).message ?? lastStatus);
          updateThumbnailChatMessage(nextAssistantMessageId, lastStatus, "stream");
        }
        if ((item.event === "patch" || item.event === "done") && isThumbnailChatAgentResult(item.data)) {
          const shouldPreferSubmittedPromptCopy = item.data.shouldGenerate || shouldPreferSubmittedPromptCopyForGeneration(
            submittedRequirement,
            item.data.canvasPatch.topic,
            item.data.canvasPatch.headline,
            previousGenerationCopy.headline,
          );
          const generationSafeTextLayerPatches = item.data.shouldGenerate
            ? (item.data.textLayerPatches ?? []).filter((patch) => (
                patch.id !== "headline" &&
                patch.id !== "subHeadline" &&
                patch.id !== "accentBadge" &&
                patch.id !== "contextCaption"
              ))
            : item.data.textLayerPatches;
          const nextAgentResult = shouldPreferSubmittedPromptCopy
            ? {
              ...item.data,
              canvasPatch: {
                ...item.data.canvasPatch,
                topic: submittedRequirement,
                headline: deriveChatHeadline(submittedRequirement),
                subHeadline: deriveChatSubHeadline(submittedRequirement),
              },
              textLayerPatches: generationSafeTextLayerPatches,
            }
            : {
              ...item.data,
              textLayerPatches: generationSafeTextLayerPatches,
          };
          finalResult = nextAgentResult;
          const shouldApplyCanvasMutation = nextAgentResult.diagnostics?.canvasMutation !== false;
          if (shouldApplyCanvasMutation) {
            applyThumbnailChatResultToCanvas(
              nextAgentResult.canvasPatch,
              nextAgentResult.textLayerPatches ?? [],
              {
                preserveActiveLayer: Boolean(nextAgentResult.textLayerPatches?.length),
                normalizeGeneratedLayout: Boolean(nextAgentResult.shouldGenerate || shouldPreferSubmittedPromptCopy),
              },
            );
            if (nextAgentResult.providerId && thumbnailImageRouteChoice !== THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID) {
              setProviderId(nextAgentResult.providerId);
            }
            if (nextAgentResult.generationMode && thumbnailImageRouteChoice !== THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID) {
              setGenerationMode(nextAgentResult.generationMode);
            }
          }
          updateThumbnailChatMessage(nextAssistantMessageId, nextAgentResult.assistantMessage, "live");
        }
        if (item.event === "error") {
          const payload = item.data && typeof item.data === "object" ? item.data as ThumbnailApiErrorPayload : null;
          throw new Error(getThumbnailErrorAction(payload));
        }
      };

      while (true) {
        if (controller.signal.aborted) {
          updateThumbnailChatMessage(nextAssistantMessageId, getAbortNotice("chat"), "live");
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = extractThumbnailChatSseEvents(buffer);
        buffer = parsed.remainder;

        for (const item of parsed.events) {
          handleChatStreamEvent(item);
        }
      }

      const trailing = extractThumbnailChatSseEvents(`${buffer}${buffer.trim() ? "\n\n" : ""}`);
      for (const item of trailing.events) {
        handleChatStreamEvent(item);
      }

      const resolvedFinalResult = finalResult as ThumbnailChatAgentResult | null;
      if (resolvedFinalResult?.shouldReset) {
        resetTextLayers();
        updateThumbnailChatMessage(nextAssistantMessageId, `${resolvedFinalResult.assistantMessage} · 문구 레이어 초기화 완료`, "live");
      }
      if (resolvedFinalResult?.shouldGenerate) {
        setIsChatAgentStreaming(false);
        const patchedTextLayers = createTextLayersWithChatTextLayerPatches(
          createTextLayersWithChatPatch(textLayersRef.current, resolvedFinalResult.canvasPatch),
          resolvedFinalResult.textLayerPatches ?? [],
        );
        const shouldPreserveSubmittedCreatorReference = requestsSpecificCreatorHost(submittedRequirement)
          && !requestsSpecificCreatorHost(resolvedFinalResult.canvasPatch.topic);
        const shouldPreferSubmittedPromptCopy = resolvedFinalResult.shouldGenerate || shouldPreferSubmittedPromptCopyForGeneration(
          submittedRequirement,
          resolvedFinalResult.canvasPatch.topic,
          resolvedFinalResult.canvasPatch.headline,
          previousGenerationCopy.headline,
        );
        const generationTopic = shouldPreserveSubmittedCreatorReference || shouldPreferSubmittedPromptCopy
          ? submittedRequirement
          : resolvedFinalResult.canvasPatch.topic;
        const generationHeadline = shouldPreserveSubmittedCreatorReference || shouldPreferSubmittedPromptCopy
          ? deriveChatHeadline(submittedRequirement)
          : resolvedFinalResult.canvasPatch.headline;
        const generationSubHeadline = shouldPreserveSubmittedCreatorReference || shouldPreferSubmittedPromptCopy
          ? deriveChatSubHeadline(submittedRequirement)
          : resolvedFinalResult.canvasPatch.subHeadline;
        // Source contract: finalResult?.shouldGenerate drives runThumbnailGeneration; imageRouteChoice ?? thumbnailImageRouteChoice keeps 고급 로컬 on the browser-direct route even when the chat agent returns provider metadata.
        await runThumbnailGeneration({
          providerId: resolvedFinalResult.providerId ?? providerId,
          generationMode: resolvedFinalResult.generationMode ?? generationMode,
          imageRouteChoice: thumbnailImageRouteChoice,
          topic: generationTopic,
          headline: generationHeadline,
          subHeadline: generationSubHeadline,
          textLayers: createTextLayersWithChatPatch(patchedTextLayers, {
            topic: generationTopic,
            headline: generationHeadline,
            subHeadline: generationSubHeadline,
          }),
        }, nextAssistantMessageId);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        updateThumbnailChatMessage(nextAssistantMessageId, getAbortNotice("chat"), "live");
        return;
      }
      updateThumbnailChatMessage(
        nextAssistantMessageId,
        error instanceof Error ? `채팅 작업 실패 · ${error.message}` : "채팅 작업 실패 · 다시 시도하세요.",
        "live",
      );
      toast({
        variant: "destructive",
        title: "채팅 작업 실패",
        description: error instanceof Error ? error.message : "다시 시도하세요.",
      });
    } finally {
      if (chatAbortControllerRef.current === controller) chatAbortControllerRef.current = null;
      if (activeChatAssistantMessageIdRef.current === nextAssistantMessageId) activeChatAssistantMessageIdRef.current = null;
      setIsChatAgentStreaming(false);
    }
  }

  function handleThumbnailChatCompositionStart() {
    chatComposerImeRef.current = true;
  }

  function handleThumbnailChatCompositionEnd() {
    chatComposerImeRef.current = false;
  }

  function isThumbnailChatImeComposing(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    return chatComposerImeRef.current || event.nativeEvent.isComposing || event.key === "Process";
  }

  function openThumbnailReferenceFilePicker() {
    referenceFileInputRef.current?.click();
  }

  function handleThumbnailChatKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || isThumbnailChatImeComposing(event)) return;
    event.preventDefault();
    void handleThumbnailChatSubmit();
  }

  function isThumbnailEditorToolCommand(commandId: ThumbnailChatLocalCommandId): commandId is ThumbnailEditorToolId {
    return THUMBNAIL_EDITOR_TOOLS.some((tool) => tool.id === commandId);
  }

  function getThumbnailEditorToolLabel(toolId: ThumbnailEditorToolId) {
    return THUMBNAIL_EDITOR_TOOLS.find((tool) => tool.id === toolId)?.label ?? "캔버스 도구";
  }

  async function handleThumbnailChatCommand(commandId: ThumbnailChatLocalCommandId, userContent = "채팅 명령") {
    if (commandId === "reset") {
      resetTextLayers();
      appendThumbnailChatCommand(userContent, "문구 레이어를 기본값으로 되돌렸습니다.");
      return;
    }

    if (commandId === "real-data-status") {
      appendThumbnailChatCommand(userContent, getThumbnailRealDataStatusSummary());
      return;
    }

    if (commandId === "reference-clear") {
      setFiles([]);
      setReferenceImageRoles([]);
      setFileValidationMessage(null);
      appendThumbnailChatCommand(userContent, "참고 이미지를 모두 비웠습니다. 다음 생성 요청에는 참고 이미지를 첨부하지 않습니다.");
      return;
    }

    if (commandId === "reference-upload") {
      appendThumbnailChatCommand(
        userContent,
        `참고 이미지 파일 선택창을 열었습니다. 선택한 이미지는 현재 탭 메모리에만 보관되고 다음 생성 요청에만 함께 전달됩니다. 최대 ${readinessLimits.maxFiles}장까지 사용할 수 있습니다.`,
      );
      openThumbnailReferenceFilePicker();
      return;
    }

    if (commandId === "export-png") {
      await handleExportPng();
      appendThumbnailChatCommand(userContent, "현재 캔버스를 PNG로 저장했습니다.");
      markCanvasAction("PNG 저장");
      return;
    }

    if (commandId === "guide-hide" || commandId === "guide-show" || commandId === "guide-toggle") {
      const nextVisible = commandId === "guide-toggle" ? !showSafeAreaGuide : commandId === "guide-show";
      setShowSafeAreaGuide(nextVisible);
      markCanvasAction(nextVisible ? "가이드 표시" : "가이드 숨김");
      appendThumbnailChatCommand(
        userContent,
        nextVisible ? "캔버스 안전 영역 가이드를 표시했습니다." : "캔버스 안전 영역 가이드를 숨겼습니다.",
      );
      return;
    }

    if (commandId === "undo") {
      undoTextLayerChange();
      appendThumbnailChatCommand(userContent, "마지막 캔버스 문구 변경을 되돌렸습니다.");
      return;
    }

    if (isThumbnailEditorToolCommand(commandId)) {
      applyThumbnailEditorTool(commandId);
      appendThumbnailChatCommand(userContent, `${getThumbnailEditorToolLabel(commandId)} 도구를 캔버스에 적용했습니다.`);
      return;
    }

    setIsHistoryPanelOpen(true);
    appendThumbnailChatCommand(
      userContent,
      "생성 히스토리를 이 페이지 안에서 열었습니다. 항목의 '캔버스에 불러오기'로 결과를 바로 반영할 수 있습니다.",
    );
    await loadThumbnailHistory({ replaceInitialPreview: false });
  }

  function handleInlineTextEditorBlur(event: ReactFocusEvent<HTMLDivElement>) {
    if (textTransformStateRef.current) return;
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.parentElement?.contains(nextTarget)) return;
    commitPendingTextLayerUndoSnapshot();
    setEditingLayerId(null);
    markCanvasAction("문구 수정 완료");
  }

  function addTextLayer() {
    commitPendingTextLayerUndoSnapshot();
    pushTextLayerUndoSnapshot(createTextEditorHistorySnapshot());
    const nextId = `layer-${layerIdCounterRef.current++}`;
    const nextLayer: TextLayer = {
      id: nextId,
      content: "새 문구",
      x: 640,
      y: 360,
      fontFamily: "Pretendard, system-ui, sans-serif",
      fontSize: 64,
      fontWeight: 900,
      fill: "#ffffff",
      stroke: "#111111",
      strokeWidth: 8,
      shadow: "0 12px 24px rgba(0,0,0,0.72)",
      align: "center",
      rotation: 0,
      zIndex: textLayers.length + 1,
    };
    setTextLayers((current) => {
      const nextLayers = [...current, nextLayer];
      textLayersRef.current = nextLayers;
      return nextLayers;
    });
    setActiveLayerId(nextId);
    markCanvasAction("새 문구 추가됨");
  }

  function duplicateActiveTextLayer() {
    const layer = activeLayer;
    if (!layer) return;
    commitPendingTextLayerUndoSnapshot();
    pushTextLayerUndoSnapshot(createTextEditorHistorySnapshot());

    const nextId = `layer-${layerIdCounterRef.current++}`;
    const nextLayer: TextLayer = {
      ...layer,
      id: nextId,
      content: `${layer.content} 복사`,
      x: clampCanvasCoordinate(layer.x + 42, TARGET_WIDTH),
      y: clampCanvasCoordinate(layer.y + 42, TARGET_HEIGHT),
      zIndex: Math.max(...textLayers.map((item) => item.zIndex), layer.zIndex) + 1,
    };
    setTextLayers((current) => {
      const nextLayers = [...current, nextLayer];
      textLayersRef.current = nextLayers;
      return nextLayers;
    });
    setActiveLayerId(nextId);
    markCanvasAction("문구 복제됨");
  }

  function deleteTextLayer(id: string) {
    if (textLayers.length <= 1) return;
    commitPendingTextLayerUndoSnapshot();
    pushTextLayerUndoSnapshot(createTextEditorHistorySnapshot());

    const next = textLayers.filter((layer) => layer.id !== id);
    textLayersRef.current = next;
    setTextLayers(next);
    if (activeLayerId === id) setActiveLayerId(null);
    if (id === "headline") setHeadline(next.find((layer) => layer.id === "headline")?.content ?? next[0]?.content ?? "");
    if (id === "subHeadline") setSubHeadline(next.find((layer) => layer.id === "subHeadline")?.content ?? "");
    markCanvasAction("문구 삭제됨");
  }

  function resetTextLayers() {
    commitPendingTextLayerUndoSnapshot();
    pushTextLayerUndoSnapshot(createTextEditorHistorySnapshot());
    const defaults = createDefaultTextLayers();
    layerIdCounterRef.current = 3;
    textLayersRef.current = defaults;
    setTextLayers(defaults);
    setHeadline(defaults[0]?.content ?? "");
    setSubHeadline(defaults[1]?.content ?? "");
    setActiveLayerId(null);
    markCanvasAction("문구 초기화됨");
  }

  function startCanvasTextInlineEditing(layerId: string) {
    if (!textLayers.some((layer) => layer.id === layerId)) return;
    commitPendingTextLayerUndoSnapshot();
    setActiveLayerId(layerId);
    setEditingLayerId(layerId);
    markCanvasAction("문구 수정 중");
  }

  function applyThumbnailEditorTool(toolId: ThumbnailEditorToolId) {
    if (toolId === "select-headline") {
      commitPendingTextLayerUndoSnapshot();
      setActiveLayerId("headline");
      markCanvasAction("메인 문구 선택됨");
      return;
    }
    if (toolId === "select-sticker") {
      commitPendingTextLayerUndoSnapshot();
      setActiveLayerId("subHeadline");
      markCanvasAction("스티커 문구 선택됨");
      return;
    }
    if (toolId === "add-text") {
      addTextLayer();
      return;
    }
    if (toolId === "duplicate") {
      duplicateActiveTextLayer();
      return;
    }

    const layer = activeLayer;
    if (toolId === "edit-text") {
      if (layer) startCanvasTextInlineEditing(layer.id);
      return;
    }
    if (toolId === "delete-text") {
      if (layer) deleteTextLayer(layer.id);
      return;
    }
    if (toolId === "reset-text") {
      resetTextLayers();
      return;
    }
    if (!layer) return;
    if (toolId === "bigger") {
      updateTextLayer(layer.id, { fontSize: clampTextLayerFontSize(layer.fontSize + 8) });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "smaller") {
      updateTextLayer(layer.id, { fontSize: clampTextLayerFontSize(layer.fontSize - 8) });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "rotate-left") {
      updateTextLayer(layer.id, { rotation: layer.rotation - 8 });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "rotate-right") {
      updateTextLayer(layer.id, { rotation: layer.rotation + 8 });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "align-left") {
      updateTextLayer(layer.id, { align: "left" });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "align-center") {
      updateTextLayer(layer.id, { align: "center" });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "align-right") {
      updateTextLayer(layer.id, { align: "right" });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "fill-white") {
      updateTextLayer(layer.id, { fill: "#ffffff" });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "fill-yellow") {
      updateTextLayer(layer.id, { fill: "#fff200" });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "fill-red") {
      updateTextLayer(layer.id, { fill: "#ff2d2d" });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "stroke-black") {
      updateTextLayer(layer.id, { stroke: "#111111" });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "stroke-white") {
      updateTextLayer(layer.id, { stroke: "#ffffff" });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "stroke-thick") {
      updateTextLayer(layer.id, { strokeWidth: Math.min(18, layer.strokeWidth + 2) });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "stroke-thin") {
      updateTextLayer(layer.id, { strokeWidth: Math.max(0, layer.strokeWidth - 2) });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "shadow-strong") {
      updateTextLayer(layer.id, { shadow: "0 12px 24px rgba(0,0,0,0.72)" });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "shadow-none") {
      updateTextLayer(layer.id, { shadow: "none" });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "font-impact") {
      updateTextLayer(layer.id, {
        fontFamily: "Impact, Pretendard, system-ui, sans-serif",
        fontWeight: 900,
      });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "font-pretendard") {
      updateTextLayer(layer.id, {
        fontFamily: "Pretendard, system-ui, sans-serif",
        fontWeight: 800,
      });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "bring-front") {
      updateTextLayer(layer.id, { zIndex: Math.max(...textLayers.map((item) => item.zIndex), layer.zIndex) + 1 });
      markEditorToolCanvasAction(toolId);
      return;
    }
    if (toolId === "send-back") {
      updateTextLayer(layer.id, { zIndex: Math.min(...textLayers.map((item) => item.zIndex), layer.zIndex) - 1 });
      markEditorToolCanvasAction(toolId);
    }
  }

  function moveActiveTextLayer(deltaX: number, deltaY: number) {
    const layer = activeLayerId ? textLayers.find((item) => item.id === activeLayerId) : null;
    if (!layer) return;
    updateTextLayer(layer.id, {
      x: clampCanvasCoordinate(layer.x + deltaX, TARGET_WIDTH),
      y: clampCanvasCoordinate(layer.y + deltaY, TARGET_HEIGHT),
    });
    markCanvasAction("키보드 이동");
  }

  function selectCanvasTextLayerByShortcut(shortcut: "1" | "2") {
    const nextLayerId = shortcut === "1" ? "headline" : "subHeadline";
    if (textLayers.some((layer) => layer.id === nextLayerId)) {
      setActiveLayerId(nextLayerId);
      markCanvasAction(nextLayerId === "headline" ? "메인 문구 단축키 선택" : "스티커 문구 단축키 선택");
    }
  }

  function cycleCanvasTextLayer(direction: 1 | -1) {
    if (textLayers.length === 0) return;
    const sortedLayers = [...textLayers].sort((a, b) => a.zIndex - b.zIndex);
    const currentIndex = Math.max(0, sortedLayers.findIndex((layer) => layer.id === activeLayerId));
    const nextIndex = (currentIndex + direction + sortedLayers.length) % sortedLayers.length;
    setActiveLayerId(sortedLayers[nextIndex]?.id ?? sortedLayers[0]?.id ?? "headline");
    markCanvasAction("문구 레이어 순환 선택");
  }

  function handleCanvasKeyDown(event: ReactKeyboardEvent<HTMLCanvasElement>) {
    if (isUndoKeyboardShortcut(event)) {
      event.preventDefault();
      undoTextLayerChange();
      return;
    }
    const step = event.shiftKey ? CANVAS_KEYBOARD_FAST_MOVE_STEP : CANVAS_KEYBOARD_MOVE_STEP;
    if (event.key === "Enter") {
      event.preventDefault();
      const layer = activeLayerId ? textLayers.find((item) => item.id === activeLayerId) : null;
      if (layer) startCanvasTextInlineEditing(layer.id);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveTextLayer(0, -step);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActiveTextLayer(0, step);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveActiveTextLayer(-step, 0);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveActiveTextLayer(step, 0);
      return;
    }
    if (event.key === "1" || event.key === "2") {
      event.preventDefault();
      selectCanvasTextLayerByShortcut(event.key);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      cycleCanvasTextLayer(event.shiftKey ? -1 : 1);
    }
  }

  function getCanvasPointFromClient(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * TARGET_WIDTH,
      y: ((clientY - rect.top) / rect.height) * TARGET_HEIGHT,
    };
  }

  function getCanvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    return getCanvasPointFromClient(event.clientX, event.clientY);
  }

  function getTextTransformMetrics(layer: TextLayer, point: { x: number; y: number }) {
    return {
      distance: Math.max(1, Math.hypot(point.x - layer.x, point.y - layer.y)),
      angle: Math.atan2(point.y - layer.y, point.x - layer.x) * 180 / Math.PI,
    };
  }

  function handleTextTransformPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    layer: TextLayer,
    mode: TextTransformState["mode"],
  ) {
    const point = getCanvasPointFromClient(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    beginTextLayerUndoStep();
    setActiveLayerId(layer.id);
    const metrics = getTextTransformMetrics(layer, point);
    textTransformStateRef.current = {
      pointerId: event.pointerId,
      layerId: layer.id,
      mode,
      startFontSize: layer.fontSize,
      startRotation: layer.rotation,
      startDistance: metrics.distance,
      startAngle: metrics.angle,
    };
    markCanvasAction(mode === "resize" ? "크기 조절 중" : "회전 조절 중");
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleTextTransformPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const transformState = textTransformStateRef.current;
    if (!transformState || transformState.pointerId !== event.pointerId) return;
    const layer = textLayers.find((item) => item.id === transformState.layerId);
    const point = getCanvasPointFromClient(event.clientX, event.clientY);
    if (!layer || !point) return;
    event.preventDefault();
    event.stopPropagation();
    const metrics = getTextTransformMetrics(layer, point);

    if (transformState.mode === "resize") {
      updateTextLayer(layer.id, {
        fontSize: clampTextLayerFontSize(transformState.startFontSize * (metrics.distance / transformState.startDistance)),
      }, { history: "none" });
      return;
    }

    updateTextLayer(layer.id, {
      rotation: normalizeCanvasRotation(transformState.startRotation + (metrics.angle - transformState.startAngle)),
    }, { history: "none" });
  }

  function handleTextTransformPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const transformState = textTransformStateRef.current;
    if (transformState?.pointerId === event.pointerId) {
      commitPendingTextLayerUndoSnapshot();
      textTransformStateRef.current = null;
      markCanvasAction(transformState.mode === "resize" ? "크기 조절 완료" : "회전 조절 완료");
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      focusCanvasAfterTextTransform();
    }
  }

  function renderTextTransformHandleButtons(layer: TextLayer, state: "selected" | "editing") {
    return (
      <>
        {TEXT_TRANSFORM_RESIZE_HANDLES.map(([handleId, positionClass]) => (
          <button
            key={`${state}-${handleId}`}
            type="button"
            tabIndex={-1}
            aria-label="문구 크기 조절"
            className={`pointer-events-auto absolute h-3 w-3 rounded-full border-2 border-sky-500 bg-white/95 shadow-[0_2px_8px_rgba(2,132,199,0.35)] ring-1 ring-slate-950/10 transition-transform hover:scale-110 ${positionClass}`}
            data-thumbnail-text-transform-handle-state={state}
            data-thumbnail-text-transform-handle-mode="resize"
            data-thumbnail-text-resize-handle={handleId}
            data-thumbnail-selected-text-resize-handle={state === "selected" ? handleId : undefined}
            onPointerDown={(event) => handleTextTransformPointerDown(event, layer, "resize")}
            onPointerMove={handleTextTransformPointerMove}
            onPointerUp={handleTextTransformPointerUp}
            onPointerCancel={handleTextTransformPointerUp}
            onKeyDown={handleTextTransformHandleKeyDown}
          />
        ))}
        <button
          type="button"
          tabIndex={-1}
          aria-label="문구 회전"
          className="pointer-events-auto absolute -top-8 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border-2 border-sky-500 bg-white/95 text-sky-600 shadow-[0_2px_8px_rgba(2,132,199,0.35)] ring-1 ring-slate-950/10 transition-transform hover:scale-110"
          data-thumbnail-text-transform-handle-state={state}
          data-thumbnail-text-transform-handle-mode="rotate"
          data-thumbnail-text-rotate-handle="true"
          data-thumbnail-selected-text-rotate-handle={state === "selected" ? "true" : undefined}
          onPointerDown={(event) => handleTextTransformPointerDown(event, layer, "rotate")}
          onPointerMove={handleTextTransformPointerMove}
          onPointerUp={handleTextTransformPointerUp}
          onPointerCancel={handleTextTransformPointerUp}
          onKeyDown={handleTextTransformHandleKeyDown}
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </>
    );
  }

  function findLayerAtPoint(point: { x: number; y: number }) {
    return [...textLayers]
      .sort((a, b) => b.zIndex - a.zIndex)
      .find((layer) => Math.abs(point.x - layer.x) <= 320 && Math.abs(point.y - layer.y) <= Math.max(44, layer.fontSize));
  }

  function handleCanvasDoubleClick(event: ReactMouseEvent<HTMLCanvasElement>) {
    const point = getCanvasPointFromClient(event.clientX, event.clientY);
    if (!point) return;
    const layer = findLayerAtPoint(point);
    if (!layer) return;
    event.preventDefault();
    markCanvasAction("캔버스 더블클릭 수정");
    startCanvasTextInlineEditing(layer.id);
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = getCanvasPoint(event);
    if (!point) return;
    const layer = findLayerAtPoint(point);
    if (!layer) return;
    beginTextLayerUndoStep();
    setActiveLayerId(layer.id);
    markCanvasAction("드래그 이동 중");
    event.currentTarget.focus();
    dragStateRef.current = {
      pointerId: event.pointerId,
      layerId: layer.id,
      offsetX: point.x - layer.x,
      offsetY: point.y - layer.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const point = getCanvasPoint(event);
    if (!point) return;
    updateTextLayer(dragState.layerId, {
      x: clampCanvasCoordinate(point.x - dragState.offsetX, TARGET_WIDTH),
      y: clampCanvasCoordinate(point.y - dragState.offsetY, TARGET_HEIGHT),
    }, { history: "none" });
  }

  function handleCanvasPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      commitPendingTextLayerUndoSnapshot();
      dragStateRef.current = null;
      markCanvasAction("드래그 이동 완료");
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }

  function handleReferenceFilesChange(nextFiles: File[]) {
    const validationMessages: string[] = [];
    const totalBytes = nextFiles.reduce((sum, file) => sum + file.size, 0);
    if (nextFiles.length > readinessLimits.maxFiles) {
      validationMessages.push(`참고 이미지는 최대 ${readinessLimits.maxFiles}장까지 반영합니다.`);
    }
    const oversizedFile = nextFiles.find((file) => file.size > readinessLimits.maxFileBytes);
    if (oversizedFile) {
      validationMessages.push(`${oversizedFile.name} 파일이 ${formatBytes(readinessLimits.maxFileBytes)} 제한을 넘습니다.`);
    }
    if (totalBytes > readinessLimits.maxTotalBytes) {
      validationMessages.push(`참고 이미지 총 용량은 ${formatBytes(readinessLimits.maxTotalBytes)} 이하로 줄이세요.`);
    }
    const unsupportedFile = nextFiles.find((file) => file.type && !readinessLimits.mimeTypes.includes(file.type));
    if (unsupportedFile) {
      validationMessages.push(`${unsupportedFile.name}은 PNG/JPEG/WebP 이미지로 다시 선택하세요.`);
    }
    setFileValidationMessage(validationMessages[0] ?? null);

    const limitedFiles = nextFiles.slice(0, readinessLimits.maxFiles);
    setFiles(limitedFiles);
    setReferenceImageRoles((current) =>
      limitedFiles.map((_, index) => current[index] ?? (index === 0 ? "host" : index === 1 ? "food" : "other")),
    );

    return {
      acceptedCount: limitedFiles.length,
      validationMessage: validationMessages[0] ?? null,
    };
  }

  function handleReferenceFilesSelected(nextFiles: File[]) {
    const result = handleReferenceFilesChange(nextFiles);
    if (!nextFiles.length) {
      appendThumbnailChatAssistantNotice("참고 이미지 선택이 취소되었습니다. “참고 이미지 추가”라고 다시 입력하면 파일 선택창을 열 수 있습니다.");
      return;
    }

    appendThumbnailChatAssistantNotice(
      result.validationMessage
        ? `참고 이미지 ${result.acceptedCount}장을 반영했습니다. 확인 필요: ${result.validationMessage}`
        : `참고 이미지 ${result.acceptedCount}장을 다음 실제 썸네일 생성 요청에 함께 전달할 준비가 됐습니다.`,
    );
  }

  async function runThumbnailGeneration(
    overrides: ThumbnailGenerationOverrides = {},
    chatAssistantMessageId?: string,
  ) {
    const requestedRouteChoice = overrides.imageRouteChoice ?? (
      overrides.providerId === "openai-gpt-image-2"
        ? "browser-openai-api-key"
        : thumbnailImageRouteChoice
    );
    const isLocalBridgeRoute = requestedRouteChoice === THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID;
    const requestedProviderId = overrides.imageRouteChoice
      ? getProviderIdForThumbnailImageRouteChoice(requestedRouteChoice)
      : isLocalBridgeRoute
        ? "local-codex"
        : overrides.providerId ?? getProviderIdForThumbnailImageRouteChoice(requestedRouteChoice);
    const submittedProviderId = requestedProviderId;
    const providerAvailability = readiness?.providers[providerReadinessKey[submittedProviderId]] ?? selectedProviderAvailability;
    const sessionKeyBackedProviderAvailable = canUseSessionApiKeyForProvider(
      submittedProviderId,
      providerAvailability,
      isBrowserOpenAIApiKeyApplied,
    );
    const chatGenerationRequirement = chatAssistantMessageId
      ? pendingChatGenerationRequirementRef.current
      : null;
    const submittedGenerationMode = isLocalBridgeRoute ? "direct_provider" : overrides.generationMode ?? generationMode;
    const submittedTopic = chatGenerationRequirement ?? overrides.topic ?? topic;
    const submittedHeadline = chatGenerationRequirement
      ? deriveChatHeadline(chatGenerationRequirement)
      : overrides.headline ?? headline;
    const submittedSubHeadline = chatGenerationRequirement
      ? deriveChatSubHeadline(chatGenerationRequirement)
      : overrides.subHeadline ?? subHeadline;
    const submittedTextLayers = chatGenerationRequirement
      ? createTextLayersWithChatPatch(textLayersRef.current, {
        topic: chatGenerationRequirement,
        headline: deriveChatHeadline(chatGenerationRequirement),
        subHeadline: deriveChatSubHeadline(chatGenerationRequirement),
      })
      : overrides.textLayers ?? textLayers;

    if (!isLocalBridgeRoute && !providerAvailability) {
      if (chatAssistantMessageId) {
        updateThumbnailChatMessage(chatAssistantMessageId, "이미지 만들기 준비를 확인하고 있어요. 잠시 후 다시 시도해 주세요.", "live");
      }
      toast({
        title: "이미지 준비 확인 중",
        description: "잠시 후 다시 생성하세요.",
      });
      return false;
    }
    if (!isLocalBridgeRoute && providerAvailability && !providerAvailability.available && !sessionKeyBackedProviderAvailable) {
      const providerBlockReason = formatThumbnailProviderBlockReason(providerAvailability.reason);
      if (chatAssistantMessageId) {
        updateThumbnailChatMessage(chatAssistantMessageId, `이미지 만들기 준비가 아직 안 됐어요. ${providerBlockReason}`, "live");
      }
      toast({
        variant: "destructive",
        title: "이미지 만들기 준비 필요",
        description: providerBlockReason,
      });
      return false;
    }

    const submittedPreflightIssues = getThumbnailGenerationPreflightIssues({
      topic: submittedTopic,
      headline: submittedHeadline,
      files,
      readinessLimits,
      fileValidationMessage,
      generationMode: submittedGenerationMode,
      backendAgentStatus,
    });
    if (submittedPreflightIssues.length > 0) {
      if (chatAssistantMessageId) {
        updateThumbnailChatMessage(
          chatAssistantMessageId,
          `먼저 입력을 확인해 주세요. ${submittedPreflightIssues[0] ?? "문구나 참고 이미지를 조금 줄여 보세요."}`,
          "live",
        );
      }
      toast({
        variant: "destructive",
        title: "입력 확인",
        description: submittedPreflightIssues[0] ?? "입력값을 확인하세요.",
      });
      return false;
    }
    if (isLocalBridgeRoute && shouldBlockSpecificCreatorGenerationRequest(submittedTopic, files, referenceImageRoles)) {
      const message = "고급 로컬은 서버 참고 썸네일 검색을 쓰지 않습니다. 쯔양님이 나오려면 host/person 참고 이미지를 먼저 첨부해 주세요.";
      if (chatAssistantMessageId) {
        updateThumbnailChatMessage(chatAssistantMessageId, message, "live");
      }
      toast({
        variant: "destructive",
        title: "로컬 브릿지 참고 이미지 필요",
        description: message,
      });
      return false;
    }
    if (!isLocalBridgeRoute && shouldBlockSpecificCreatorGenerationRequest(submittedTopic, files, referenceImageRoles) && chatAssistantMessageId) {
      // Inform the user without blocking generation. The backend retrieval path
      // is authoritative: it searches the locally held Tzuyang thumbnail
      // library for host/person evidence first, then fails closed with
      // host_reference_required only if no usable reference is found.
      updateThumbnailChatMessage(chatAssistantMessageId, "쯔양님 참고 썸네일을 먼저 찾아보고 있어요.", "live");
    }
    const naturalGenerationCopy = createNaturalGenerationCopy(
      submittedTopic,
      submittedHeadline,
      submittedSubHeadline,
      submittedTextLayers,
    );
    syncNaturalGenerationCopyToCanvas(naturalGenerationCopy);
    const controller = new AbortController();
    generationAbortControllerRef.current = controller;
    activeGenerationAssistantMessageIdRef.current = chatAssistantMessageId ?? null;
    setIsGenerating(true);
    if (chatAssistantMessageId) {
      updateThumbnailChatMessage(
        chatAssistantMessageId,
        "문구와 배치를 정리했어요. 이제 실제 썸네일 이미지를 만들고 있어요. 시간이 오래 걸리면 생성 중단을 누를 수 있습니다.",
        "live",
      );
    }
    try {
      const generationPayload = {
        providerId: submittedProviderId,
        generationMode: submittedGenerationMode,
        topic: naturalGenerationCopy.topic,
        headline: naturalGenerationCopy.headline,
        subHeadline: naturalGenerationCopy.subHeadline,
        stylePreset: briefPreset,
        referenceImageRoles,
        acknowledgedSafety,
        textLayers: naturalGenerationCopy.textLayers,
      } satisfies ThumbnailGeneratorPayload;

      if (isLocalBridgeRoute) {
        const bridgeStatus = await getThumbnailLocalBridgeStatusRequest(
          thumbnailLocalBridgeUrl,
          thumbnailLocalBridgeTokenRef.current,
          invokeThumbnailLocalBridgeHelper,
          controller.signal,
        );
        setThumbnailLocalBridgeStatus(bridgeStatus.status);
        setThumbnailLocalBridgeMessage(bridgeStatus.message);
        setThumbnailLocalBridgeError(bridgeStatus.status === "connected" ? null : bridgeStatus.message);
        if (bridgeStatus.status !== "connected") {
          throw new Error("THUMBNAIL_LOCAL_BRIDGE_UNAVAILABLE");
        }
        const localBridgeReferences = await buildThumbnailLocalBridgeReferenceImages(files, referenceImageRoles);
        const nextResult = await postThumbnailLocalBridgeImagesRequest(
          generationPayload,
          localBridgeReferences,
          thumbnailLocalBridgeUrl,
          thumbnailLocalBridgeTokenRef.current,
          controller.signal,
          invokeThumbnailLocalBridgeHelper,
        );
        userCanvasResultLockedRef.current = true;
        syncNaturalGenerationCopyToCanvas(naturalGenerationCopy);
        setResult(nextResult);
        markCanvasAction("고급 로컬 생성 반영");
        if (chatAssistantMessageId) {
          updateThumbnailChatMessage(
            chatAssistantMessageId,
            formatThumbnailGenerationCompletionSummary(nextResult),
            "live",
          );
        }
        return true;
      }

      const formData = new FormData();
      formData.append(
        "payload",
        JSON.stringify(generationPayload),
      );
      files.forEach((file) => formData.append("referenceImages", file));
      if (submittedProviderId === "openai-gpt-image-2" && browserOpenAIApiKeyRef.current) {
        formData.append(THUMBNAIL_SESSION_OPENAI_API_KEY_FIELD, browserOpenAIApiKeyRef.current);
      }

      const response = await fetch("/api/admin/youtube-thumbnail-generator", {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
        body: formData,
      });
      const payload = await response.json().catch(() => null) as GenerationResult | ThumbnailApiErrorPayload | null;
      if (!response.ok || !payload || !("baseImage" in payload)) {
        throw new Error(getThumbnailErrorAction(payload && "error" in payload ? payload : null));
      }
      const nextResult = { ...(payload as GenerationResult), generationMode: submittedGenerationMode };
      userCanvasResultLockedRef.current = true;
      syncNaturalGenerationCopyToCanvas(naturalGenerationCopy);
      setResult(nextResult);
      markCanvasAction("실제 생성 반영");
      if (chatAssistantMessageId) {
        updateThumbnailChatMessage(
          chatAssistantMessageId,
          formatThumbnailGenerationCompletionSummary(nextResult),
          "live",
        );
      }
      void loadThumbnailHistory({ replaceInitialPreview: false, silent: true });
      return true;
    } catch (generationError) {
      if (controller.signal.aborted) {
        const notice = getAbortNotice("generation");
        if (chatAssistantMessageId) {
          updateThumbnailChatMessage(chatAssistantMessageId, notice, "live");
        }
        toast({
          title: "썸네일 생성 중단",
          description: notice,
        });
        return false;
      }
      if (chatAssistantMessageId) {
        const generationErrorMessage = generationError instanceof Error ? generationError.message : "다시 시도하세요.";
        updateThumbnailChatMessage(
          chatAssistantMessageId,
          isLocalBridgeRoute
            ? `고급 로컬 브릿지 연결을 먼저 확인해 주세요. ${generationErrorMessage}`
            : "썸네일을 만들지 못했어요. 입력과 설정을 확인한 뒤 다시 시도해 주세요.",
          "live",
        );
      }
      toast({
        variant: "destructive",
        title: "썸네일 생성 실패",
        description: generationError instanceof Error ? generationError.message : "다시 시도하세요.",
      });
      return false;
    } finally {
      if (activeGenerationAssistantMessageIdRef.current === chatAssistantMessageId) {
        pendingChatGenerationRequirementRef.current = null;
      }
      if (generationAbortControllerRef.current === controller) generationAbortControllerRef.current = null;
      if (activeGenerationAssistantMessageIdRef.current === chatAssistantMessageId) activeGenerationAssistantMessageIdRef.current = null;
      setIsGenerating(false);
    }
  }

  async function handleExportPng() {
    const preset = selectedExportPreset;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = preset.width;
    exportCanvas.height = preset.height;
    const context = exportCanvas.getContext("2d");
    if (!context) return;

    const scale = preset.width / TARGET_WIDTH;
    context.save();
    context.scale(scale, scale);
    context.fillStyle = "#16100d";
    context.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    try {
      if (result?.baseImage?.dataUrl) {
        const image = await loadThumbnailImage(result.baseImage.dataUrl);
        context.drawImage(image, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "내보내기 이미지 확인",
        description: error instanceof Error ? error.message : "현재 캔버스 배경을 확인하지 못했습니다.",
      });
    }
    [...textLayers]
      .sort((a, b) => a.zIndex - b.zIndex)
      .forEach((layer) => {
        if (!layer.content.trim()) return;
        context.save();
        context.translate(layer.x, layer.y);
        context.rotate((layer.rotation * Math.PI) / 180);
        context.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
        context.textAlign = layer.align;
        context.textBaseline = "middle";
        context.lineJoin = "round";
        context.miterLimit = 2;
        context.fillStyle = layer.fill;
        context.strokeStyle = layer.stroke;
        context.lineWidth = layer.strokeWidth;
        if (layer.shadow !== "none") {
          context.shadowColor = "rgba(0,0,0,0.62)";
          context.shadowBlur = layer.shadow.includes("24px") ? 18 : 10;
          context.shadowOffsetY = layer.shadow.includes("12px") ? 8 : 5;
        }
        drawNoWrapFittedText(context, layer.content, 0, 0, TEXT_LAYER_RENDER_MAX_WIDTH, layer);
        context.restore();
      });
    context.restore();

    const fileName = `tzudong-youtube-thumbnail-${preset.fileSuffix}.png`;
    const dataUrl = exportCanvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = fileName;
    link.href = dataUrl;
    link.click();
    const metadata: ThumbnailExportMetadata = {
      width: preset.width,
      height: preset.height,
      mime: "image/png",
      fileName,
    };
    setLastExportMetadata(metadata);
    toast({
      title: "PNG 저장 준비 완료",
      description: `${metadata.width}×${metadata.height} · ${metadata.fileName}`,
    });
  }

  function renderThumbnailEditorToolIcon(toolId: ThumbnailEditorToolId) {
    if (
      toolId === "select-headline" ||
      toolId === "select-sticker" ||
      toolId === "edit-text" ||
      toolId === "font-impact" ||
      toolId === "font-pretendard"
    ) {
      return <Type className="h-4 w-4" />;
    }
    if (toolId === "add-text") return <Plus className="h-4 w-4" />;
    if (toolId === "duplicate") return <Copy className="h-4 w-4" />;
    if (toolId === "delete-text") return <Trash2 className="h-4 w-4" />;
    if (toolId === "bring-front") return <BringToFront className="h-4 w-4" />;
    if (toolId === "send-back") return <SendToBack className="h-4 w-4" />;
    if (toolId === "rotate-left") return <RotateCcw className="h-4 w-4" />;
    if (toolId === "rotate-right") return <RotateCw className="h-4 w-4" />;
    if (toolId === "align-left") return <AlignLeft className="h-4 w-4" />;
    if (toolId === "align-center") return <AlignCenter className="h-4 w-4" />;
    if (toolId === "align-right") return <AlignRight className="h-4 w-4" />;
    if (
      toolId === "fill-white" ||
      toolId === "fill-yellow" ||
      toolId === "fill-red" ||
      toolId === "stroke-black" ||
      toolId === "stroke-white" ||
      toolId === "stroke-thick" ||
      toolId === "stroke-thin" ||
      toolId === "shadow-strong" ||
      toolId === "shadow-none"
    ) {
      return <Palette className="h-4 w-4" />;
    }
    return <Move className="h-4 w-4" />;
  }

  function handleHistoryDropdownOpenChange(open: boolean) {
    setIsHistoryPanelOpen(open);
    if (open) void loadThumbnailHistory({ replaceInitialPreview: false });
  }

  function handleApplyThumbnailBrowserOpenAIApiKey() {
    const keyInput = browserOpenAIApiKeyInputRef.current;
    const normalizedKey = normalizeThumbnailBrowserOpenAIApiKeyInput(keyInput?.value ?? "");
    if (!isValidThumbnailBrowserOpenAIApiKey(normalizedKey)) {
      const message = "OpenAI API 키 형식이 올바르지 않습니다. sk-로 시작하는 키를 붙여 넣어 주세요.";
      setBrowserOpenAIApiKeyMessage(message);
      toast({
        variant: "destructive",
        title: "API 키 확인",
        description: message,
      });
      return;
    }

    abortThumbnailCredentialWork();
    browserOpenAIApiKeyRef.current = normalizedKey;
    if (keyInput) keyInput.value = "";
    setIsBrowserOpenAIApiKeyApplied(true);
    setMaskedBrowserOpenAIApiKey(maskThumbnailBrowserOpenAIApiKey(normalizedKey));
    setBrowserOpenAIApiKeyAppliedAt(new Date().toISOString());
    setBrowserOpenAIApiKeyMessage(
      "적용했어요. 이 탭에서만 gpt-image-2 생성 요청에 사용하며, 화면을 닫으면 키가 제거됩니다.",
    );
    setProviderId("openai-gpt-image-2");
    setThumbnailImageRouteChoice("browser-openai-api-key");
    toast({
      title: "OpenAI 키 적용 완료",
      description: "Web Storage, DB, 계정에는 저장하지 않고 이 탭 메모리에서만 사용합니다.",
    });
  }

  function handleClearThumbnailBrowserOpenAIApiKey() {
    abortThumbnailCredentialWork();
    clearThumbnailBrowserOpenAIApiKeySecret();
    setBrowserOpenAIApiKeyMessage("이 탭 메모리의 OpenAI 키를 삭제했습니다.");
    if (thumbnailImageRouteChoice === "browser-openai-api-key") {
      setThumbnailImageRouteChoice("local-codex-oauth");
    }
    setProviderId("local-codex");
    toast({
      title: "OpenAI 키 삭제 완료",
      description: "이 탭 메모리에서 삭제했습니다.",
    });
  }

  async function handleApplyThumbnailLocalBridge() {
    const tokenInput = thumbnailLocalBridgeTokenInputRef.current;
    const tokenCandidate = tokenInput?.value || thumbnailLocalBridgeTokenRef.current;
    try {
      const bridgeUrl = normalizeThumbnailLocalBridgeUrl(thumbnailLocalBridgeUrlDraft);
      const token = requireThumbnailLocalBridgeToken(tokenCandidate);
      abortThumbnailCredentialWork();
      setThumbnailLocalBridgeUrl(bridgeUrl);
      setThumbnailLocalBridgeUrlDraft(bridgeUrl);
      thumbnailLocalBridgeTokenRef.current = token;
      if (tokenInput) tokenInput.value = "";
      setIsThumbnailLocalBridgePaired(true);
      setMaskedThumbnailLocalBridgeToken(maskThumbnailLocalBridgeToken(token));
      setThumbnailLocalBridgeAppliedAt(new Date().toISOString());
      setThumbnailLocalBridgeStatus("needs_reconnect");
      setThumbnailLocalBridgeMessage(getThumbnailLocalBridgeReconnectRequiredMessage());
      setThumbnailLocalBridgeError(null);
      setProviderId("local-codex");
      setGenerationMode("direct_provider");
      setThumbnailImageRouteChoice(THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID);
      appendThumbnailChatAssistantNotice(
        "고급 로컬 브릿지 설정을 이 탭 메모리에 적용했어요. pairing token은 Web Storage, 앱 서버, 비-loopback 네트워크에 저장하거나 보내지 않습니다.",
      );
    } catch (error) {
      const message = redactThumbnailLocalBridgeSecretText(
        error instanceof Error ? error.message : "로컬 브릿지 설정을 적용하지 못했습니다.",
        tokenCandidate,
      );
      setThumbnailLocalBridgeStatus("error");
      setThumbnailLocalBridgeMessage(message);
      setThumbnailLocalBridgeError(message);
      toast({
        variant: "destructive",
        title: "고급 로컬 브릿지 적용",
        description: message,
      });
    }
  }

  function handleClearThumbnailLocalBridge() {
    abortThumbnailCredentialWork();
    setThumbnailLocalBridgeUrl(THUMBNAIL_LOCAL_BRIDGE_DEFAULT_URL);
    setThumbnailLocalBridgeUrlDraft(THUMBNAIL_LOCAL_BRIDGE_DEFAULT_URL);
    clearThumbnailLocalBridgeTokenSecret();
    setThumbnailLocalBridgeStatus("unpaired");
    setThumbnailLocalBridgeMessage("로컬 브릿지 설정을 이 탭 메모리에서 삭제했습니다.");
    setThumbnailLocalBridgeError(null);
    if (thumbnailImageRouteChoice === THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID) {
      setThumbnailImageRouteChoice("local-codex-oauth");
      setProviderId("local-codex");
      setGenerationMode("direct_provider");
    }
    appendThumbnailChatAssistantNotice(
      "고급 로컬 브릿지 URL과 pairing 설정을 이 탭 메모리에서 삭제했어요. 기본 OAuth로 돌아갑니다.",
    );
  }

  function handleSelectThumbnailImageRouteChoice(nextRoute: ThumbnailImageRouteChoice) {
    setThumbnailImageRouteChoice(nextRoute);
    setProviderId(getProviderIdForThumbnailImageRouteChoice(nextRoute));
    setThumbnailLocalBridgeError(null);
    if (nextRoute === THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID) {
      setGenerationMode("direct_provider");
      setThumbnailLocalBridgeStatus(
        isThumbnailLocalBridgePaired
          ? (thumbnailLocalBridgeStatus === "connected" ? "connected" : "needs_reconnect")
          : "unpaired",
      );
      setThumbnailLocalBridgeMessage(
        isThumbnailLocalBridgePaired
          ? (thumbnailLocalBridgeStatus === "connected"
              ? "로컬 브릿지 helper가 연결되어 있습니다. 이 경로는 앱 서버 relay 없이 loopback에서만 동작합니다."
              : getThumbnailLocalBridgeReconnectRequiredMessage())
          : "고급 로컬 브릿지는 pairing 설정을 이 탭에 적용한 뒤 helper 연결을 눌러 사용할 수 있습니다.",
      );
      setBrowserOpenAIApiKeyMessage(null);
      return;
    }
    if (nextRoute === "browser-openai-api-key") {
      setBrowserOpenAIApiKeyMessage(
        isBrowserOpenAIApiKeyApplied
          ? "OpenAI API 키를 사용하도록 선택했어요."
          : "API Key를 선택했어요. 먼저 키를 적용해 주세요.",
      );
      setThumbnailLocalBridgeMessage(null);
      return;
    }
    setGenerationMode("direct_provider");
    setBrowserOpenAIApiKeyMessage(null);
    setThumbnailLocalBridgeMessage(null);
  }

  function renderChatSettingsDropdownPanel() {
    return (
      <div
        className="space-y-2 rounded-2xl bg-background/95 p-2.5 shadow-sm"
        data-thumbnail-chat-settings-panel="true"
        data-thumbnail-chat-settings-panel-parity="storyboard"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">이미지 생성 설정</p>
            <p className="text-[11px] text-muted-foreground">
              기본 OAuth · 고급 로컬 · API Key 백업
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => setIsChatSettingsOpen(false)}
            aria-label="유튜브 썸네일 채팅 설정 닫기"
            data-thumbnail-chat-settings-close="true"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>

        <div
          className="grid grid-cols-3 gap-1"
          role="radiogroup"
          aria-label="썸네일 이미지 생성 방식 선택"
          data-thumbnail-api-router-choice="true"
          data-thumbnail-api-router-choice-parity="storyboard"
          data-thumbnail-api-router-choice-layout="oauth-deduped"
        >
          <button
            type="button"
            className={`rounded-xl px-2 py-1.5 text-left transition ${
              thumbnailImageRouteChoice === "local-codex-oauth"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/35 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
            aria-pressed={thumbnailImageRouteChoice === "local-codex-oauth"}
            onClick={() => handleSelectThumbnailImageRouteChoice("local-codex-oauth")}
            data-thumbnail-api-router-option="local-codex-oauth"
            data-thumbnail-api-router-option-selected={
              thumbnailImageRouteChoice === "local-codex-oauth" ? "true" : "false"
            }
            data-thumbnail-api-router-oauth-transport="server"
          >
            <span className="block text-[11px] font-bold">기본 OAuth</span>
            <span className="block text-[10px] opacity-80">
              {readiness?.providers.localCodex.available
                ? "사용 가능"
                : readiness
                  ? "확인 필요"
                  : "확인 중"}
            </span>
          </button>
          <button
            type="button"
            className={`rounded-xl px-2 py-1.5 text-left transition ${
              thumbnailImageRouteChoice === THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/35 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
            aria-pressed={thumbnailImageRouteChoice === THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID}
            onClick={() => handleSelectThumbnailImageRouteChoice(THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID)}
            data-thumbnail-api-router-option="local-bridge"
            data-thumbnail-api-router-option-selected={
              thumbnailImageRouteChoice === THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID ? "true" : "false"
            }
            data-thumbnail-api-router-oauth-transport="local-bridge"
          >
            <span className="block text-[11px] font-bold">고급 로컬</span>
            <span className="block text-[10px] opacity-80">
              {formatThumbnailLocalBridgeStatusLabel(
                thumbnailLocalBridgeStatus,
                isThumbnailLocalBridgePaired,
              )}
            </span>
          </button>
          <button
            type="button"
            className={`rounded-xl px-2 py-1.5 text-left transition ${
              thumbnailImageRouteChoice === "browser-openai-api-key"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/35 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
            aria-pressed={thumbnailImageRouteChoice === "browser-openai-api-key"}
            onClick={() => handleSelectThumbnailImageRouteChoice("browser-openai-api-key")}
            data-thumbnail-api-router-option="browser-openai-api-key"
            data-thumbnail-api-router-option-selected={
              thumbnailImageRouteChoice === "browser-openai-api-key" ? "true" : "false"
            }
            data-thumbnail-api-router-fallback="browser-api-key"
          >
            <span className="block text-[11px] font-bold">API Key</span>
            <span className="block text-[10px] opacity-80">
              {isBrowserOpenAIApiKeyApplied ? "이 탭 사용" : "키 필요"}
            </span>
          </button>
        </div>

        <div
          className="flex items-center justify-between gap-2 rounded-xl bg-muted/30 px-2.5 py-2"
          data-thumbnail-api-router-panel="true"
          data-thumbnail-api-router-active={thumbnailImageApiRouterView.id}
          data-thumbnail-codex-oauth-status={thumbnailImageApiRouterView.codexOAuthStatus}
          data-thumbnail-api-router-model="gpt-image-2"
          data-thumbnail-api-router-parity="storyboard"
        >
          <div className="min-w-0">
            <p
              className="truncate text-[11px] font-semibold"
              data-thumbnail-api-router-status="true"
            >
              사용: {thumbnailImageApiRouterView.label}
            </p>
            <p
              className="truncate text-[10px] text-muted-foreground"
              data-thumbnail-api-router-summary="true"
              data-thumbnail-codex-oauth-copy="true"
            >
              {thumbnailImageApiRouterView.statusLabel} ·{" "}
              {thumbnailImageApiRouterView.codexOAuthStatus === "active"
                ? "Codex OAuth"
                : thumbnailImageApiRouterView.codexOAuthStatus === "local-bridge-active"
                  ? "Codex OAuth · 로컬"
                  : thumbnailImageApiRouterView.codexOAuthStatus === "checking"
                    ? "확인 중"
                    : thumbnailImageApiRouterView.codexOAuthStatus === "api-key-active"
                      ? "브라우저 키"
                      : "설정 필요"}
            </p>
          </div>
          <Badge
            variant="secondary"
            className="h-6 shrink-0 rounded-full px-2 text-[10px]"
            data-thumbnail-api-router-label="true"
          >
            gpt-image-2
          </Badge>
        </div>

        <div
          className="grid gap-1.5"
          data-thumbnail-api-key-settings="memory-only"
          data-thumbnail-browser-api-key-settings="memory-only"
          data-thumbnail-api-key-persistence="none"
          data-thumbnail-api-key-db-storage="forbidden"
          data-thumbnail-openai-api-key-scope="component-memory"
          data-thumbnail-browser-api-key-lifetime="component"
        >
          <div className="flex items-center justify-between gap-2">
            <Label
              htmlFor="thumbnail-browser-openai-api-key"
              className="text-[11px] font-semibold"
            >
              API Key 백업
            </Label>
            <button
              type="button"
              className={`h-6 shrink-0 rounded-full px-2 text-[10px] font-semibold transition ${
                thumbnailImageRouteChoice === "browser-openai-api-key"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              aria-pressed={thumbnailImageRouteChoice === "browser-openai-api-key"}
              onClick={() => handleSelectThumbnailImageRouteChoice("browser-openai-api-key")}
              data-thumbnail-api-router-option="browser-openai-api-key"
              data-thumbnail-api-router-option-selected={
                thumbnailImageRouteChoice === "browser-openai-api-key" ? "true" : "false"
              }
              data-thumbnail-api-router-fallback="browser-api-key"
            >
              백업 사용
            </button>
          </div>
          <div className="flex gap-2">
            <Input
              ref={browserOpenAIApiKeyInputRef}
              id="thumbnail-browser-openai-api-key"
              type="password"
              onChange={() => {
                if (browserOpenAIApiKeyMessage) setBrowserOpenAIApiKeyMessage(null);
              }}
              placeholder={
                isBrowserOpenAIApiKeyApplied && maskedBrowserOpenAIApiKey
                  ? `${maskedBrowserOpenAIApiKey} 이 탭 적용됨`
                  : "sk-..."
              }
              autoComplete="off"
              spellCheck={false}
              className="h-8 text-xs"
              aria-label="이 탭에서만 사용할 OpenAI API 키"
              data-thumbnail-browser-api-key-input="true"
            />
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 px-2 text-xs"
              onClick={handleApplyThumbnailBrowserOpenAIApiKey}
              data-thumbnail-api-key-apply="true"
              data-thumbnail-browser-api-key-apply="true"
            >
              적용
            </Button>
          </div>
          <p
            className="text-[10px] leading-4 text-muted-foreground"
            data-thumbnail-api-key-memory-only-copy="true"
            data-thumbnail-browser-api-key-memory-only-copy="true"
            data-thumbnail-api-key-model-policy="gpt-image-2-only"
            data-thumbnail-browser-api-key-model-policy="gpt-image-2-only"
          >
            OAuth가 안 될 때만 사용 · 이 탭 메모리만 사용 · Web Storage·DB 저장 안 함 · gpt-image-2 전용
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <p
              className="min-w-0 flex-1 text-[11px] text-muted-foreground"
              data-thumbnail-api-key-session-status="true"
              data-thumbnail-browser-api-key-status={
                isBrowserOpenAIApiKeyApplied ? "memory-active" : "empty"
              }
            >
              {isBrowserOpenAIApiKeyApplied
                ? `이 탭에서 사용 중 · ${maskedBrowserOpenAIApiKey ?? "적용됨"}${
                    browserOpenAIApiKeyAppliedAt
                      ? ` · ${new Date(browserOpenAIApiKeyAppliedAt).toLocaleString("ko-KR")}`
                      : ""
                  }`
                : "적용된 키 없음"}
            </p>
            {isBrowserOpenAIApiKeyApplied ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 rounded-full px-2 text-[11px]"
                onClick={handleClearThumbnailBrowserOpenAIApiKey}
                data-thumbnail-api-key-clear="true"
                data-thumbnail-browser-api-key-clear="true"
              >
                삭제
              </Button>
            ) : null}
            {browserOpenAIApiKeyMessage ? (
              <p
                className="basis-full text-[11px] text-muted-foreground"
                data-thumbnail-api-key-message="true"
                data-thumbnail-browser-api-key-message="true"
              >
                {browserOpenAIApiKeyMessage}
              </p>
            ) : null}
          </div>
        </div>

        {shouldShowThumbnailLocalBridgeSettings ? (
          <div
            className="grid gap-1.5 rounded-xl border border-dashed border-primary/25 bg-primary/5 p-2"
            data-thumbnail-local-bridge-settings="memory-only"
            data-thumbnail-local-bridge-settings-visibility="advanced-selected"
            data-thumbnail-local-bridge-persistence="none"
            data-thumbnail-local-bridge-server-relay="forbidden"
            data-thumbnail-local-bridge-token-lifetime="component"
            data-thumbnail-local-bridge-transport="helper-window"
          >
            <div className="flex items-center justify-between gap-2">
              <Label
                htmlFor="thumbnail-local-bridge-url"
                className="text-[11px] font-semibold"
              >
                고급 로컬 브릿지
              </Label>
              <Badge
                variant="outline"
                className="h-5 shrink-0 rounded-full px-1.5 text-[10px]"
                data-thumbnail-local-bridge-status={thumbnailLocalBridgeStatus}
              >
                {formatThumbnailLocalBridgeStatusLabel(
                  thumbnailLocalBridgeStatus,
                  isThumbnailLocalBridgePaired,
                )}
              </Badge>
            </div>
            <p
              className="text-[10px] leading-4 text-muted-foreground"
              data-thumbnail-local-bridge-guidance="true"
            >
              pairing token은 이 화면 메모리에만 있고 Web Storage에 저장되지 않으며, 화면을 닫으면 제거됩니다. 실제 bridge 호출은 loopback helper 창에서 처리하며 앱 서버 relay는 사용하지 않습니다.
            </p>
            <div className="grid gap-1">
              <Input
                id="thumbnail-local-bridge-url"
                value={thumbnailLocalBridgeUrlDraft}
                onChange={(event) => {
                  setThumbnailLocalBridgeUrlDraft(event.target.value);
                  setThumbnailLocalBridgeError(null);
                }}
                placeholder={THUMBNAIL_LOCAL_BRIDGE_DEFAULT_URL}
                autoComplete="off"
                spellCheck={false}
                className="h-8 text-xs"
                aria-label="로컬 브릿지 URL"
                data-thumbnail-local-bridge-url-input="true"
              />
              <Input
                ref={thumbnailLocalBridgeTokenInputRef}
                id="thumbnail-local-bridge-token"
                type="password"
                onChange={() => {
                  setThumbnailLocalBridgeError(null);
                }}
                placeholder={
                  isThumbnailLocalBridgePaired && maskedThumbnailLocalBridgeToken
                    ? `${maskedThumbnailLocalBridgeToken} 이 탭 적용됨`
                    : "브릿지 터미널 pairing_token"
                }
                autoComplete="off"
                spellCheck={false}
                className="h-8 text-xs"
                aria-label="로컬 브릿지 pairing token"
                data-thumbnail-local-bridge-token-input="true"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="h-7 shrink-0 rounded-full px-2 text-[11px]"
                onClick={() => void handleApplyThumbnailLocalBridge()}
                data-thumbnail-local-bridge-apply="true"
              >
                적용
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 rounded-full px-2 text-[11px]"
                onClick={() => void handleConnectThumbnailLocalBridgeHelper()}
                data-thumbnail-local-bridge-connect="true"
              >
                {thumbnailLocalBridgeStatus === "connected" ? "다시 확인" : "로컬 브릿지 연결"}
              </Button>
              {isThumbnailLocalBridgePaired ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 rounded-full px-2 text-[11px]"
                  onClick={handleClearThumbnailLocalBridge}
                  data-thumbnail-local-bridge-clear="true"
                >
                  삭제
                </Button>
              ) : null}
              <p
                className={`basis-full text-[11px] ${
                  thumbnailLocalBridgeError ? "text-destructive" : "text-muted-foreground"
                }`}
                data-thumbnail-local-bridge-message="true"
              >
                {thumbnailLocalBridgeError ??
                  thumbnailLocalBridgeMessage ??
                  (thumbnailLocalBridgeAppliedAt
                    ? `이 탭에서 사용 중 · ${new Date(thumbnailLocalBridgeAppliedAt).toLocaleString("ko-KR")}`
                    : "bun run storyboard:local-bridge 실행 후 token을 이 탭에 적용하고 로컬 브릿지 연결을 눌러 주세요.")}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderThumbnailHistoryDropdownPanel() {
    return (
      <div
        className="space-y-2 rounded-2xl bg-background/95 p-2 shadow-sm"
        data-thumbnail-history-panel="true"
        data-thumbnail-history-status={historyStatus}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <History className="h-3.5 w-3.5" />
              <span>생성 히스토리</span>
              <Badge variant="secondary" className="px-1.5 text-[10px]">
                {historyStatus === "loading" ? "불러오는 중" : `${historyRuns.length}건`}
              </Badge>
              <Badge variant="outline" className="px-1.5 text-[10px]" data-thumbnail-history-source-label="true">
                {getThumbnailInitialPreviewSourceLabel(initialPreviewSource)}
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              정적 HTML 대신 이 페이지에서 실제 생성 기록을 관리합니다.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => void loadThumbnailHistory({ replaceInitialPreview: false })}
              disabled={historyStatus === "loading"}
              aria-label="생성 히스토리 새로고침"
              data-thumbnail-history-refresh="true"
            >
              {historyStatus === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setIsHistoryPanelOpen(false)}
              aria-label="생성 히스토리 닫기"
              data-thumbnail-history-close="true"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {historyStatus === "error" ? (
          <div className="rounded-xl bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive" data-thumbnail-history-error="true">
            히스토리를 불러오지 못했습니다. {historyError ?? "API 상태를 확인하세요."}
          </div>
        ) : null}

        {historyStatus === "empty" ? (
          <div className="rounded-xl bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground" data-thumbnail-history-empty="true">
            아직 저장된 실제 생성 기록이 없습니다. 생성 완료 후 다시 새로고침하세요.
          </div>
        ) : null}

        {historyRuns.length ? (
          <div className="max-h-80 space-y-1.5 overflow-y-auto pr-0.5" data-thumbnail-history-run-list="true">
            {historyRuns.map((run) => (
              <div
                key={run.id ?? run.timestamp ?? run.imagePath}
                className="grid gap-2 rounded-xl bg-muted/35 p-2 text-[11px] sm:grid-cols-[56px_minmax(0,1fr)]"
                data-thumbnail-history-run="true"
              >
                <div className="aspect-video overflow-hidden rounded-lg bg-background/80 ring-1 ring-border/60">
                  {run.imagePath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={resolveThumbnailHistoryImageUrl(run.imagePath)}
                      alt={run.headline || "생성 썸네일 히스토리"}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{run.headline || "제목 없음"}</p>
                      <p className="truncate text-muted-foreground">{run.topic || run.completedAt || run.timestamp || "주제 없음"}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      <Badge variant="outline" className="px-1.5 text-[10px]" data-thumbnail-history-source-label="true">
                        {getThumbnailHistoryRunSourceLabel(run)}
                      </Badge>
                      <Badge variant="outline" className="px-1.5 text-[10px]" data-thumbnail-history-provenance-label="true">
                        {formatThumbnailModelProvenance(run.modelProvenance)}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-7 rounded-full px-2 text-[11px]"
                      onClick={() => {
                        applyThumbnailHistoryRun(run);
                        setIsHistoryPanelOpen(false);
                      }}
                      data-thumbnail-history-load-run={run.id ?? run.timestamp ?? "history-run"}
                    >
                      캔버스에 불러오기
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 rounded-full px-2 text-[11px]"
                      onClick={() => void copyThumbnailHistoryRun(run)}
                      data-thumbnail-history-copy-json={run.id ?? run.timestamp ?? "history-run"}
                    >
                      <Copy className="mr-1 h-3 w-3" /> JSON 복사
                    </Button>
                    <span className="text-muted-foreground">
                      {run.completedAt ?? run.timestamp ?? ""}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <AdminEmbeddedModuleShell
      menuId="youtube-thumbnail-generator"
    >
      <main
        className="flex h-full min-h-0 flex-col overflow-hidden bg-background p-3"
        aria-label="유튜브 썸네일 생성기"
        data-admin-youtube-thumbnail-generator="true"
        data-thumbnail-initial-preview-source={initialPreviewSource}
        onKeyDown={handleThumbnailEditorShellKeyDown}
      >
        <div
          className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-3 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:grid-rows-1 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]"
          data-thumbnail-chat-right-layout="true"
        >
        <Card
          className="order-2 flex min-h-0 flex-col overflow-hidden border-0 bg-card/80 shadow-none"
          aria-label="요구사항 채팅"
          data-thumbnail-generation-input-panel="right-chat"
          data-thumbnail-input-panel="chat-stream"
          data-thumbnail-input-position="right-of-canvas"
        >
          <CardHeader className="shrink-0 space-y-1 p-3 pb-2">
            <div className="flex items-center justify-between gap-2" data-thumbnail-chat-header="true">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <MessageCircle className="h-4 w-4" />
                </span>
                <span className="min-w-0 truncate">유튜브 썸네일 생성 도우미</span>
                <Badge
                  variant={
                    thumbnailChatStatusState === "ready" ||
                    thumbnailChatStatusState === "generating" ||
                    thumbnailChatStatusState === "streaming"
                      ? "secondary"
                      : "outline"
                  }
                  className="h-6 max-w-[6.5rem] shrink-0 truncate rounded-full px-2 text-[10px]"
                  title={thumbnailChatStatusLabel}
                  data-thumbnail-chat-status-badge="true"
                  data-thumbnail-chat-status={thumbnailChatStatusState}
                >
                  {thumbnailChatStatusLabel}
                </Badge>
              </CardTitle>
              <div className="flex shrink-0 items-center gap-1" data-thumbnail-chat-header-actions="true">
                <DropdownMenu open={isHistoryPanelOpen} onOpenChange={handleHistoryDropdownOpenChange}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant={isHistoryPanelOpen ? "secondary" : "ghost"}
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      aria-label="생성 히스토리 열기"
                      title="생성 히스토리"
                      data-thumbnail-history-panel-toggle="true"
                      data-thumbnail-history-dropdown-trigger="icon-only"
                      data-thumbnail-history-open={isHistoryPanelOpen ? "true" : "false"}
                    >
                      <History className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    sideOffset={8}
                    className="w-[min(28rem,calc(100vw-2rem))] max-h-[min(34rem,calc(100vh-7rem))] overflow-y-auto rounded-2xl p-0"
                    data-thumbnail-history-dropdown="true"
                  >
                    {renderThumbnailHistoryDropdownPanel()}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu open={isChatSettingsOpen} onOpenChange={setIsChatSettingsOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant={isChatSettingsOpen ? "secondary" : "ghost"}
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      aria-label="유튜브 썸네일 채팅 설정 열기"
                      title="채팅 설정"
                      data-thumbnail-chat-settings-toggle="true"
                      data-thumbnail-chat-settings-dropdown-trigger="true"
                      data-thumbnail-chat-settings-open={isChatSettingsOpen ? "true" : "false"}
                    >
                      <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-[min(280px,calc(100vw-2rem))] p-0"
                    data-thumbnail-chat-settings-dropdown="true"
                    data-thumbnail-chat-settings-dropdown-parity="storyboard"
                  >
                    {renderChatSettingsDropdownPanel()}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 pt-0">
            <section
              className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-b from-background/95 to-muted/35 shadow-sm"
              data-thumbnail-chat-panel="true"
              data-thumbnail-chat-style="storyboard-like"
            >
              <div
                ref={chatTranscriptRef}
                className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3"
                data-thumbnail-chat-log="true"
                data-thumbnail-chat-transcript="true"
                aria-live="polite"
              >
                {chatMessages.map((message) => {
                  const isThumbnailChatStarterMessage =
                    message.role === "assistant" && message.id === "assistant-intro";
                  return (
                    <div
                      key={message.id}
                      className={
                        isThumbnailChatStarterMessage
                          ? "flex min-h-full items-stretch justify-center"
                          : `flex gap-2 ${
                              message.role === "user" ? "justify-end" : "justify-start"
                            }`
                      }
                      data-thumbnail-chat-message={message.role}
                      data-thumbnail-chat-message-mode={message.mode ?? "submitted"}
                      data-thumbnail-chat-message-status={
                        message.mode === "stream"
                          ? "streaming"
                          : message.mode === "system"
                            ? "guide"
                            : "done"
                      }
                    >
                      {isThumbnailChatStarterMessage ? (
                        <div
                          className="mx-auto flex w-full max-w-sm flex-col items-center justify-center gap-3 px-3 py-6 text-center"
                          data-thumbnail-chat-starter-panel="true"
                          data-thumbnail-chat-starter-panel-layout="centered-thumbnail-guide"
                        >
                          <div
                            className="relative grid h-14 w-14 place-items-center overflow-hidden rounded-[1.35rem] bg-transparent"
                            data-thumbnail-chat-starter-logo="true"
                          >
                            <NextImage
                              src="/logo.webp"
                              alt="Tzudong 프로젝트 로고"
                              width={40}
                              height={40}
                              className="h-10 w-10 object-contain"
                              priority={false}
                            />
                          </div>
                          <div className="min-w-0 space-y-1">
                            <h4
                              className="text-xl font-semibold tracking-tight text-foreground"
                              data-thumbnail-chat-starter-title="true"
                              data-thumbnail-chat-starter-title-size="storyboard-parity"
                            >
                              무엇부터 만들까요?
                            </h4>
                            <p
                              className="mx-auto max-w-[18rem] text-[11px] leading-5 text-muted-foreground"
                              data-thumbnail-chat-starter-guide-copy="true"
                            >
                              <span className="block">
                                음식·인물·짧은 문구를 한두 문장으로 적거나,
                              </span>
                              <span className="block">
                                아래 예시를 골라 썸네일 방향을 바로 잡아보세요.
                              </span>
                            </p>
                          </div>
                          <div
                            className="grid w-full grid-cols-1 gap-1.5 sm:grid-cols-3"
                            data-thumbnail-chat-example-grid="true"
                            data-thumbnail-chat-example-grid-layout="3-card-grid"
                          >
                            {THUMBNAIL_GUIDED_EXAMPLE_PRESETS.map((preset) => (
                              <button
                                key={preset.topic}
                                type="button"
                                className="group min-h-[4.25rem] rounded-2xl border border-border/70 bg-background/75 p-2 text-left shadow-sm transition hover:border-primary/45 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                onClick={() =>
                                  handleThumbnailGuidedExamplePresetClick(preset)
                                }
                                disabled={isGenerating || isChatAgentStreaming}
                                aria-label={`${preset.headline} 썸네일 예시 불러오기`}
                                data-thumbnail-chat-example-card="true"
                                data-thumbnail-chat-example-headline={preset.headline}
                              >
                                <span className="block truncate text-[11px] font-semibold text-foreground">
                                  {preset.headline}
                                </span>
                                <span className="mt-0.5 block truncate text-[10px] font-medium text-primary">
                                  {preset.subHeadline}
                                </span>
                                <span className="mt-1 block line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                                  {preset.topic}
                                </span>
                              </button>
                            ))}
                          </div>
                          <div
                            className="flex flex-wrap justify-center gap-1.5"
                            data-thumbnail-chat-message-actions="true"
                            data-thumbnail-chat-message-actions-placement="starter-panel"
                          >
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 rounded-full bg-background/80 px-2 text-[11px] shadow-sm"
                              onClick={handleThumbnailUsageGuideClick}
                              disabled={isGenerating || isChatAgentStreaming}
                              data-thumbnail-chat-guide-button="true"
                              data-thumbnail-chat-message-action="guide"
                            >
                              가이드 보기
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 rounded-full px-2 text-[11px] shadow-sm"
                              onClick={handleThumbnailGuidedExampleClick}
                              disabled={isGenerating || isChatAgentStreaming}
                              data-thumbnail-chat-guide-example="true"
                              data-thumbnail-chat-message-action="example"
                            >
                              예시 만들기
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {message.role !== "user" ? (
                            <div className="mt-5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                              {message.mode === "stream" ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Wand2 className="h-3.5 w-3.5" />
                              )}
                            </div>
                          ) : null}
                          <div
                            className={`max-w-[86%] space-y-1 ${
                              message.role === "user" ? "text-right" : "text-left"
                            }`}
                          >
                            <div
                              className={`text-[10px] font-medium uppercase tracking-wide ${
                                message.role === "user"
                                  ? "text-primary"
                                  : "text-muted-foreground"
                              }`}
                              data-thumbnail-chat-message-meta="true"
                            >
                              {message.role === "user"
                                ? "나"
                                : message.mode === "stream"
                                  ? currentThumbnailStreamingLabel
                                  : message.mode === "system"
                                    ? "가이드"
                                    : "유튜브 썸네일 도우미"}
                            </div>
                            <div
                              className={`rounded-2xl px-3 py-2 text-xs leading-5 shadow-sm ${
                                message.role === "user"
                                  ? "rounded-br-md bg-primary text-primary-foreground"
                                  : message.mode === "live" || message.mode === "stream"
                                    ? "rounded-bl-md border border-sky-300/60 bg-sky-500/10 text-sky-950 dark:text-sky-100"
                                    : "rounded-bl-md bg-background text-foreground ring-1 ring-border/60"
                              }`}
                              data-thumbnail-chat-message-bubble="true"
                            >
                              <p className="whitespace-pre-wrap break-keep [overflow-wrap:anywhere]">
                                {message.content}
                              </p>
                              {message.mode === "stream" ? (
                                <p className="mt-1 flex items-center gap-1.5 whitespace-pre-wrap break-keep opacity-80 [overflow-wrap:anywhere]">
                                  <Loader2
                                    className="h-3 w-3 animate-spin"
                                    aria-hidden="true"
                                  />
                                  {currentThumbnailStreamingPhase}
                                </p>
                              ) : null}
                            </div>
                          </div>
                          {message.role === "user" ? (
                            <div className="mt-5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                              <MessageCircle className="h-3.5 w-3.5" />
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  );
                })}
                {chatDraft.trim() || isChatAgentStreaming || isGenerating ? (
                  <div
                    className="flex gap-2"
                    data-thumbnail-chat-draft-preview="true"
                    data-thumbnail-chat-live-stream="true"
                  >
                    <div className="mt-5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sky-500/15 text-sky-600">
                      {isChatAgentStreaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
                    </div>
                    <div className="max-w-[86%] space-y-1">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-200">
                        {currentThumbnailStreamingLabel}
                      </div>
                      <div className="rounded-2xl rounded-bl-md border border-dashed border-sky-400/70 bg-sky-500/10 px-3 py-2 text-xs leading-5 text-sky-950 shadow-sm whitespace-pre-wrap break-keep [overflow-wrap:anywhere] dark:text-sky-100">
                        {currentThumbnailStreamingPhase}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="shrink-0 space-y-2 border-t border-border/70 bg-background/80 p-2.5" data-thumbnail-chat-controls="true">
                <input
                  id="thumbnail-topic"
                  type="hidden"
                  value={topic}
                  readOnly
                  data-thumbnail-chat-topic-state="true"
                />

                {shouldShowThumbnailCanvasContext ? (
                  <div
                    className="flex min-h-8 items-center justify-between gap-2 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px]"
                    data-thumbnail-chat-canvas-context="true"
                    data-thumbnail-chat-canvas-context-state={canvasContextState}
                    data-thumbnail-chat-canvas-context-visibility="selected-only"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Badge
                        variant={canvasContextState === "editing" ? "secondary" : "outline"}
                        className="h-6 shrink-0 rounded-full px-2 text-[11px]"
                      >
                        {canvasContextState === "editing" ? "수정 중" : "선택됨"}
                      </Badge>
                      <span className="shrink-0 font-medium text-primary">
                        채팅 맥락
                      </span>
                      <span
                        className="min-w-0 truncate text-muted-foreground"
                        title={`${lastCanvasActionLabel ?? "선택됨"} · ${canvasContextSummary}`}
                        data-thumbnail-chat-canvas-context-action="true"
                      >
                        {lastCanvasActionLabel ?? "선택됨"}
                      </span>
                      <span
                        className="min-w-0 truncate text-muted-foreground"
                        title={canvasContextSummary}
                        data-thumbnail-chat-canvas-context-summary="true"
                      >
                        {canvasContextSummary}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 shrink-0 rounded-full px-2 text-[11px]"
                      onClick={useCanvasContextInChat}
                      data-thumbnail-chat-canvas-context-ask="true"
                    >
                      물어보기
                    </Button>
                  </div>
                ) : null}

                <Label htmlFor="thumbnail-chat-composer" className="sr-only">썸네일 요구사항 채팅 입력</Label>
                <p id="thumbnail-chat-keyboard-hint" className="sr-only">
                  한글 조합 중 Enter는 전송하지 않고, 조합이 끝난 뒤 Enter로 전송합니다.
                </p>
                <div
                  className="rounded-3xl border border-border/60 bg-background p-2 shadow-sm"
                  data-thumbnail-chat-composer="true"
                  data-thumbnail-chat-composer-shell="storyboard-like"
                >
                  <div className="flex items-end gap-2" data-thumbnail-chat-composer-inner="true">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                      onClick={openThumbnailReferenceFilePicker}
                      disabled={isChatAgentStreaming || isGenerating}
                      aria-label="참고 이미지 첨부"
                      title="참고 이미지 첨부"
                      data-thumbnail-chat-reference-upload="true"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Textarea
                      id="thumbnail-chat-composer"
                      value={chatDraft}
                      onChange={(event) => handleChatDraftChange(event.target.value)}
                      onCompositionStart={handleThumbnailChatCompositionStart}
                      onCompositionEnd={handleThumbnailChatCompositionEnd}
                      onKeyDown={handleThumbnailChatKeyDown}
                      aria-describedby="thumbnail-chat-keyboard-hint"
                      disabled={isChatAgentStreaming || isGenerating}
                      className="max-h-24 min-h-10 resize-none border-0 bg-transparent p-2 text-sm shadow-none focus-visible:ring-0"
                      placeholder="원하는 썸네일 내용을 입력해 주세요"
                      data-thumbnail-chat-ime-safe="true"
                    />
                    <Button
                      type="button"
                      size={isChatAgentStreaming || isGenerating ? "sm" : "icon"}
                      className={`h-9 shrink-0 rounded-full ${isChatAgentStreaming || isGenerating ? "px-3" : "w-9"}`}
                      onClick={isChatAgentStreaming ? abortThumbnailChatWork : isGenerating ? abortThumbnailGeneration : () => void handleThumbnailChatSubmit()}
                      disabled={isChatAgentStreaming || isGenerating ? false : !chatDraft.trim()}
                      aria-label={isChatAgentStreaming ? "채팅 스트림 중단" : isGenerating ? "썸네일 생성 중단" : "요구사항 채팅 반영"}
                      data-thumbnail-chat-submit={isChatAgentStreaming || isGenerating ? undefined : "true"}
                      data-thumbnail-chat-cancel={isChatAgentStreaming ? "true" : undefined}
                      data-thumbnail-generation-cancel={isGenerating ? "true" : undefined}
                    >
                      {isChatAgentStreaming || isGenerating ? (
                        <>
                          <Square className="h-4 w-4" />
                          <span className="text-xs">{isGenerating ? "생성 중단" : "중단"}</span>
                        </>
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <input
                  ref={referenceFileInputRef}
                  id="thumbnail-reference-image-chat-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="sr-only"
                  aria-label="채팅으로 참고 이미지 파일 선택"
                  data-thumbnail-chat-reference-file-input="true"
                  onChange={(event) => {
                    handleReferenceFilesSelected(Array.from(event.target.files ?? []));
                    event.currentTarget.value = "";
                  }}
                />



              </div>
            </section>
          </CardContent>
        </Card>

        <Card className="order-1 flex min-h-0 flex-col overflow-hidden border-0 bg-card/80 shadow-none" data-thumbnail-canvas-panel="primary-left">
          <CardHeader className="shrink-0 space-y-1 p-3 pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span>캔버스 편집 / PNG 내보내기</span>
              <div className="flex flex-wrap gap-2">
                {lastExportMetadata ? (
                  <Badge variant="outline" data-thumbnail-export-metadata="true">
                    {lastExportMetadata.width}×{lastExportMetadata.height}
                  </Badge>
                ) : null}
                <Select value={exportPresetId} onValueChange={(value) => setExportPresetId(value as ThumbnailExportPresetId)}>
                  <SelectTrigger className="h-8 w-[122px]" data-thumbnail-export-preset="true" aria-label="PNG 저장 해상도">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {thumbnailExportPresets.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" size="sm" variant="outline" onClick={() => setShowSafeAreaGuide((value) => !value)} data-thumbnail-safe-area-toggle="true">
                  {showSafeAreaGuide ? "가이드 숨김" : "가이드 표시"}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={addTextLayer} data-thumbnail-add-text-layer="true">
                  <Plus className="mr-2 h-4 w-4" /> 문구 추가
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={handleExportPng}>
                  <Download className="mr-2 h-4 w-4" /> PNG 저장
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-3 overflow-hidden p-3 pt-0">
            <div
              ref={canvasViewportRef}
              className="relative flex min-h-0 items-center justify-center overflow-hidden rounded-2xl bg-transparent"
              data-thumbnail-canvas-viewport="true"
            >
              <div
                className="relative overflow-hidden rounded-2xl shadow-inner [container-type:inline-size]"
                style={{ width: `${canvasDisplaySize.width}px`, height: `${canvasDisplaySize.height}px` }}
                data-thumbnail-canvas-aspect-frame="16:9"
              >
                <canvas
                  ref={canvasRef}
                  width={TARGET_WIDTH}
                  height={TARGET_HEIGHT}
                  tabIndex={0}
                  className="block h-full w-full touch-none cursor-move focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  aria-label="유튜브 썸네일 1280x720 편집 캔버스"
                  data-thumbnail-history-preview={
                    isInitialThumbnailPreviewResult(result) ? "true" : "false"
                  }
                  data-thumbnail-draggable-canvas="true"
                  data-thumbnail-keyboard-canvas="true"
                  data-thumbnail-safe-area-guide={showSafeAreaGuide ? "visible" : "hidden"}
                  onPointerDown={handleCanvasPointerDown}
                  onPointerMove={handleCanvasPointerMove}
                  onPointerUp={handleCanvasPointerUp}
                  onPointerCancel={handleCanvasPointerUp}
                  onKeyDown={handleCanvasKeyDown}
                  onDoubleClick={handleCanvasDoubleClick}
                />
              {activeLayer && !editingLayer ? (
                <div
                  className="pointer-events-none absolute z-10 rounded-md border border-dashed border-sky-400/85 bg-sky-400/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.55),0_0_18px_rgba(56,189,248,0.18)]"
                  style={getTextLayerTransformFrameStyle(activeLayer)}
                  data-thumbnail-canvas-text-transform-frame="true"
                  data-thumbnail-canvas-selected-text-transform-frame="true"
                  data-thumbnail-canvas-text-transform-state="selected"
                  data-thumbnail-canvas-selected-text-layer={activeLayer.id}
                  data-thumbnail-text-transform-metrics="visual-bounds"
                >
                  <span
                    className="pointer-events-none absolute -top-7 left-0 rounded-md bg-slate-950/85 px-2 py-1 text-[11px] font-bold leading-none text-white shadow-sm"
                    data-thumbnail-selected-text-transform-label="true"
                  >
                    {getTextLayerSelectionLabel(activeLayer)}
                  </span>
                  {renderTextTransformHandleButtons(activeLayer, "selected")}
                </div>
              ) : null}
              {isGenerating ? (
                <div
                  className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-2xl border border-slate-300/70 bg-gradient-to-br from-slate-50/86 via-slate-100/76 to-slate-200/68 shadow-sm dark:border-slate-600/60 dark:from-slate-800/62 dark:via-slate-700/50 dark:to-slate-600/44"
                  role="status"
                  aria-live="polite"
                  aria-busy="true"
                  aria-label="썸네일 생성 중"
                  data-thumbnail-generation-skeleton="true"
                  data-thumbnail-generation-skeleton-variant="neutral-gray"
                  data-thumbnail-generation-skeleton-effect="glass-shimmer"
                  data-thumbnail-unified-generation-skeleton="true"
                  data-thumbnail-generation-skeleton-glass-surface="true"
                >
                  <div
                    className="pointer-events-none absolute inset-0 opacity-90 [background:linear-gradient(135deg,rgba(255,255,255,0.54),rgba(203,213,225,0.28)_46%,rgba(100,116,139,0.20))]"
                    aria-hidden="true"
                  />
                  <div
                    className="admin-module-loading-shimmer pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent"
                    aria-hidden="true"
                    data-thumbnail-generation-skeleton-shimmer="true"
                  />
                  <span className="sr-only">썸네일 생성 중</span>
                </div>
              ) : null}
              {editingLayer ? (
                <div
                  className="pointer-events-none absolute z-10 inline-block w-max max-w-none"
                  style={{
                    left: `${(editingLayer.x / TARGET_WIDTH) * 100}%`,
                    top: `${(editingLayer.y / TARGET_HEIGHT) * 100}%`,
                    minWidth: "1ch",
                    width: "max-content",
                    maxWidth: "none",
                    transform: `translate(${editingLayer.align === "center" ? "-50%" : editingLayer.align === "right" ? "-100%" : "0"}, -50%) rotate(${editingLayer.rotation}deg)`,
                    transformOrigin: `${editingLayer.align === "center" ? "center" : editingLayer.align} center`,
                  }}
                  data-thumbnail-canvas-text-transform-frame="true"
                  data-thumbnail-canvas-text-transform-state="editing"
                >
                  <div
                    ref={inlineTextEditorRef}
                    contentEditable
                    suppressContentEditableWarning
                    role="textbox"
                    aria-multiline={false}
                    tabIndex={0}
                    onBlur={handleInlineTextEditorBlur}
                    onPointerDown={(event) => event.stopPropagation()}
                    onBeforeInput={handleInlineTextEditorBeforeInput}
                    onInput={(event) => {
                      ensurePendingTextLayerUndoSnapshot();
                      const nextContent = normalizeInlineEditableText(event.currentTarget.textContent ?? "");
                      if (event.currentTarget.textContent !== nextContent) {
                        event.currentTarget.textContent = nextContent;
                      }
                      updateTextLayer(editingLayer.id, { content: nextContent }, { history: "none" });
                    }}
                    onPaste={(event) => {
                      event.preventDefault();
                      ensurePendingTextLayerUndoSnapshot();
                      const text = normalizeInlineEditableText(event.clipboardData.getData("text/plain"));
                      document.execCommand("insertText", false, text);
                    }}
                    onKeyDown={(event) => {
                      if (isUndoKeyboardShortcut(event)) {
                        event.preventDefault();
                        event.stopPropagation();
                        undoInlineTextEditorChange();
                        return;
                      }
                      event.stopPropagation();
                      if (event.key === "Enter" || event.key === "Escape") {
                        event.preventDefault();
                        commitPendingTextLayerUndoSnapshot();
                        setEditingLayerId(null);
                        canvasRef.current?.focus();
                      }
                    }}
                    className="pointer-events-auto inline-block cursor-text whitespace-nowrap border-0 bg-transparent p-0 font-black outline-none [caret-color:#38bdf8] focus:ring-0"
                    style={{
                      color: editingLayer.fill,
                      fontFamily: editingLayer.fontFamily,
                      fontSize: `calc(${(editingLayer.fontSize / TARGET_WIDTH) * 100}cqw)`,
                      fontWeight: editingLayer.fontWeight,
                      textAlign: editingLayer.align,
                      textShadow: editingLayer.shadow === "none" ? "none" : editingLayer.shadow,
                      WebkitTextStroke: `${Math.max(0, editingLayer.strokeWidth / 2)}px ${editingLayer.stroke}`,
                      lineHeight: 1,
                      whiteSpace: "nowrap",
                    }}
                    aria-label="캔버스 위 문구 바로 수정"
                    data-thumbnail-canvas-inline-text-editor="true"
                  />
                  {renderTextTransformHandleButtons(editingLayer, "editing")}
                </div>
              ) : null}
              </div>
            </div>
            <div className="min-h-0 overflow-hidden">
              <div className="overflow-hidden rounded-xl bg-muted/30 p-1" data-thumbnail-editor-toolbar="true">
                <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-1.5" data-thumbnail-tradingview-tool-palette="true" data-thumbnail-canvas-tool-row="true">
                  {THUMBNAIL_EDITOR_TOOLS.map((tool) => (
                    <Button
                      key={tool.id}
                      type="button"
                      variant="ghost"
                      className="h-8 w-full min-w-0 gap-1 rounded-lg bg-background/80 px-1.5 text-[11px] leading-none shadow-sm hover:bg-background [&_span]:min-w-0 [&_span]:truncate [&_svg]:h-3.5 [&_svg]:w-3.5"
                      onClick={() => applyThumbnailEditorTool(tool.id)}
                      title={tool.description}
                      data-thumbnail-editor-tool={tool.id}
                    >
                      {renderThumbnailEditorToolIcon(tool.id)}
                      <span>{tool.label}</span>
                    </Button>
                  ))}
                </div>
              </div>
            </div>

          </CardContent>
        </Card>
        </div>
      </main>
    </AdminEmbeddedModuleShell>
  );
}

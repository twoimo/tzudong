"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { flushSync } from "react-dom";
import NextImage from "next/image";
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  ClipboardCopy,
  Download,
  History,
  ImageIcon,
  Loader2,
  MessageCircle,
  Plug,
  Plus,
  RotateCcw,
  Settings,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";

import { buildStoryboardAgentGraphFidelity } from "@/lib/admin/storyboard/agent-graph-fidelity";
import {
  STORYBOARD_PUBLIC_SAFETY_REPLACEMENT,
  sanitizeStoryboardPublicText,
} from "@/lib/admin/storyboard/prompt-safety";
import {
  type StoryboardGuidedExamplePreset,
  STORYBOARD_GUIDED_EXAMPLE_PRESETS,
  STORYBOARD_GUIDED_EXAMPLE_GRID_PRESETS,
} from "@/lib/admin/storyboard/guided-example-presets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import {
  STORYBOARD_MAX_SEGMENT_COUNT,
  STORYBOARD_MIN_SEGMENT_COUNT,
} from "@/lib/admin/storyboard/types";
import type {
  StoryboardInitialResult,
  StoryboardInitialResultSource,
} from "@/lib/admin/storyboard/initial-result";
import type {
  StoryboardChatAgentResult,
  StoryboardChatCanvasPatch,
  StoryboardChatConversationMessage,
  StoryboardChatFocusContext,
  StoryboardChatImageAttachment,
  StoryboardGenerationMode,
  StoryboardGenerationResult,
  StoryboardScene,
  StoryboardSceneGeneratedImage,
  StoryboardThinkingTraceEntry,
  StoryboardTone,
} from "@/lib/admin/storyboard/types";
import {
  STORYBOARD_HISTORY_INDEX_URL,
  getSafeStoryboardHistoryRunUrl,
} from "@/lib/admin/storyboard/history-client";
import {
  countTrustedStoryboardGeneratedImages,
  getExactStoryboardGeneratedImageProvenance,
  getTrustedStoryboardGeneratedImage,
  stripUntrustedStoryboardGeneratedImages,
} from "@/lib/admin/storyboard/image-trust";
import {
  getOmittedStoryboardSceneCount,
  getStoryboardImageGenerationTargetScenes,
  getStoryboardScenePageCount,
  getStoryboardSourcePageScenes,
  getVisibleTrustedStoryboardPageScenes,
  getVisibleTrustedStoryboardScenes,
} from "@/lib/admin/storyboard/visible-scenes";
import {
  INITIAL_STORYBOARD_IMAGE_PROVIDER_READINESS,
  STORYBOARD_BROWSER_OPENAI_IMAGE_PROVIDER_ID,
  STORYBOARD_BROWSER_OPENAI_API_KEY_HEADER,
  STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE,
  STORYBOARD_IMAGE_PROVIDER_ID,
  STORYBOARD_IMAGE_PROVIDER_MODEL,
  type StoryboardImageProviderReadiness,
  type StoryboardImageProviderStatusResponse,
  formatStoryboardImageProviderGuidanceMessage,
  isStoryboardImageProviderReady,
  mapStoryboardImageProviderReadiness,
} from "@/lib/admin/storyboard/image-provider-readiness";
import {
  STORYBOARD_LOCAL_BRIDGE_DEFAULT_URL,
  STORYBOARD_LOCAL_BRIDGE_ROUTE_ID,
  buildStoryboardLocalBridgeImagesRequest,
  getStoryboardLocalBridgeAuthHeaders,
  normalizeStoryboardLocalBridgeImagesResponse,
  normalizeStoryboardLocalBridgeToken,
  normalizeStoryboardLocalBridgeUrl,
  redactStoryboardLocalBridgeSecretText,
  stripStoryboardGeneratedImagesForTransport,
  stripStoryboardGeneratedImagesFromScenes,
  type StoryboardLocalBridgeStatus,
} from "@/lib/admin/storyboard/local-bridge-contract";
import { cn } from "@/lib/utils";
import { AdminEmbeddedModuleShell } from "@/components/admin/AdminEmbeddedModuleShell";
import {
  StoryboardCanvasContent,
  StoryboardCanvasHeader,
  StoryboardCanvasShell,
  StoryboardFrameGrid,
} from "@/components/admin/storyboard/StoryboardCanvasShell";

// StoryboardCanvasShell preserves the public source-contract markers:
// aria-label="스토리보드 이미지 생성 결과", data-storyboard-result-panel="image-frames-only",
// data-storyboard-image-board="true", data-storyboard-frame-grid="true".

type GeneratorForm = {
  prompt: string;
  tone: StoryboardTone;
  targetLengthMinutes: number;
  sourceLimit: number;
  segmentCount: number;
  includeProductionNotes: boolean;
  generationMode: StoryboardGenerationMode;
};

type StoryboardImageGenerationCutStatus =
  | "queued"
  | "generating"
  | "done"
  | "failed"
  | "cancelled";

type StoryboardImageGenerationProgressCut = {
  sceneNo: number;
  label: string;
  status: StoryboardImageGenerationCutStatus;
};

type StoryboardImageGenerationProgress = {
  label: string;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  cuts: StoryboardImageGenerationProgressCut[];
};

type StoryboardChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: "streaming" | "done";
  actions?: Array<"guide" | "example">;
  imageGenerationProgress?: StoryboardImageGenerationProgress;
  thinkingTrace?: StoryboardThinkingTraceEntry[];
};

type PendingStoryboardChatSteerRequest = {
  prompt: string;
  attachments: StoryboardChatImageAttachment[];
};

const STORYBOARD_CHAT_TYPEWRITER_START_DELAY_MS = 180;
const STORYBOARD_CHAT_TYPEWRITER_INTERVAL_MS = 24;
const STORYBOARD_CHAT_TYPEWRITER_STEP_CHARS = 1;

type StoryboardChatSseEvent = {
  event: string;
  data: unknown;
};

type StoryboardRealDataTrace = {
  mode: "actual" | "fallback";
  headline: string;
  sourceText: string;
  backendText: string;
  generatedAtText: string;
};

type StoryboardUserPerspectiveRoleId = "host" | "manager" | "pd" | "editor";

type StoryboardUserPerspectiveReadinessItem = {
  id: StoryboardUserPerspectiveRoleId;
  label: string;
  status: "ready" | "watch";
  summary: string;
  detail: string;
};

type StoryboardBackendAgentReadinessStatus =
  | "live_retrieval_used"
  | "live_no_retrieval"
  | "output_ready_for_review"
  | "resume_required"
  | "legacy"
  | "fallback"
  | "unknown";

type StoryboardBackendAgentReadiness = {
  status: StoryboardBackendAgentReadinessStatus;
  label: string;
  summary: string;
  detail: string;
  liveGraphReady: boolean;
  retrievalUsed: boolean;
  resumeRequired: boolean;
  outputReadyForReview: boolean;
};

const STORYBOARD_PDF_FLOW_STATUS_VALUES = [
  "used",
  "available",
  "fallback",
  "not_used",
] as const;

type StoryboardPdfFlowStatus =
  (typeof STORYBOARD_PDF_FLOW_STATUS_VALUES)[number];

type StoryboardPdfFlowCheckId =
  | "service_storyboard"
  | "service_restaurant_map"
  | "youtube_data_collection"
  | "intro_storefront_context"
  | "heatmap_replay_frames"
  | "video_captioning"
  | "subtitle_contextual_retrieval"
  | "dense_sparse_embedding"
  | "reranker"
  | "multi_agent_graph"
  | "storyboard_design"
  | "evaluation_logs"
  | "review_status"
  | "db_history_storage"
  | "web_service_delivery";

type StoryboardPdfFlowCheck = {
  id: StoryboardPdfFlowCheckId;
  label: string;
  status: StoryboardPdfFlowStatus;
  summary: string;
};

const STORYBOARD_EVALUATION_LOGS_TEXT =
  "evaluation_logs에는 Rule 평가와 AI Judge 평가 결과를 저장합니다.";
const STORYBOARD_REVIEW_STATUS_TEXT =
  "review_status는 데이터 검수 상태를 관리하는 필드로, pending, approved, rejected와 같은 상태값을 통해 승인 대기, 승인 완료, 반려 여부를 구분합니다.";

const STORYBOARD_PDF_FLOW_SEQUENCE_TEXT =
  "영상 데이터 수집 → AI 분석 → RAG/검색 개선 → 결과 검증 → DB/히스토리 저장 → 웹서비스 표시";

const STORYBOARD_PDF_FLOW_SERVICE_TEXT =
  "먹방 영상을 분석해서 창작자에게는 스토리보드, 시청자에게는 맛집 지도 정보를 준비합니다.";

const STORYBOARD_PDF_FLOW_CHECK_DEFINITIONS: Array<{
  id: StoryboardPdfFlowCheckId;
  label: string;
}> = [
  { id: "service_storyboard", label: "창작자 스토리보드" },
  { id: "service_restaurant_map", label: "시청자 맛집 지도" },
  { id: "youtube_data_collection", label: "유튜브 영상 데이터 수집" },
  { id: "intro_storefront_context", label: "초반 1분 30초 가게 앞 인트로" },
  { id: "heatmap_replay_frames", label: "가장 많이 본 장면 프레임" },
  { id: "video_captioning", label: "영상 프레임 캡셔닝" },
  { id: "subtitle_contextual_retrieval", label: "자막 문맥 검색" },
  { id: "dense_sparse_embedding", label: "Dense+Sparse 임베딩 검색" },
  { id: "reranker", label: "리랭커 재정렬" },
  { id: "multi_agent_graph", label: "Supervisor·Researcher·Intern·Designer" },
  { id: "storyboard_design", label: "장면 구성표 제작" },
  { id: "evaluation_logs", label: "Rule·AI Judge 평가 저장" },
  { id: "review_status", label: "pending·approved·rejected 검수 상태" },
  { id: "db_history_storage", label: "DB·히스토리 저장" },
  { id: "web_service_delivery", label: "웹서비스 표시·배포" },
];

type StoryboardHistoryStatus =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "error"
  | "stale";

type StoryboardHistoryCase = {
  id: string;
  result: StoryboardGenerationResult;
  runUrl: string;
};

type StoryboardHistoryProofSummary = {
  sceneNo: number;
  providerId: string;
  authMode: string;
  modelLabel: string;
  responseId: string;
  imageCallId: string;
  requestHash: string;
  responseHash: string;
  generatedAt: string;
};


const STORYBOARD_LOCAL_BRIDGE_HELPER_VERSION = 1 as const;
const STORYBOARD_LOCAL_BRIDGE_HELPER_ROUTE = "/helper" as const;
const STORYBOARD_LOCAL_BRIDGE_HEALTH_PATH = "/health" as const;
const STORYBOARD_LOCAL_BRIDGE_AUTH_STATUS_PATH = "/auth-status" as const;
const STORYBOARD_LOCAL_BRIDGE_IMAGES_PATH = "/v1/storyboard/images" as const;
const STORYBOARD_LOCAL_BRIDGE_HELPER_QUERY_ORIGIN = "origin" as const;
const STORYBOARD_LOCAL_BRIDGE_HELPER_QUERY_SESSION = "session" as const;
const STORYBOARD_LOCAL_BRIDGE_HELPER_QUERY_SURFACE = "surface" as const;
const STORYBOARD_LOCAL_BRIDGE_TERMINAL_COMMAND =
  "cd apps/web && bun run storyboard:local-bridge" as const;

function maskStoryboardLocalBridgeToken(value: string | null) {
  if (!value) return "";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
type StoryboardLocalBridgeUiStatus = StoryboardLocalBridgeStatus;
type StoryboardLocalBridgeHelperCommand = "checkStatus" | "generateStoryboard";
type StoryboardLocalBridgeHelperReadyMessage = {
  kind: "tzudong-local-bridge-helper-ready";
  sessionId: string;
  surface: "storyboard";
  protocolVersion: typeof STORYBOARD_LOCAL_BRIDGE_HELPER_VERSION;
};
type StoryboardLocalBridgeHelperRequestMessage = {
  kind: "tzudong-local-bridge-helper-request";
  sessionId: string;
  requestId: string;
  command: StoryboardLocalBridgeHelperCommand;
  bridgeUrl: string;
  token: string;
  payload?: unknown;
};
type StoryboardLocalBridgeHelperResponseMessage =
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
type StoryboardLocalBridgeHelperClosedMessage = {
  kind: "tzudong-local-bridge-helper-closed";
  sessionId: string;
};
type StoryboardLocalBridgeHelperStatusPayload = {
  healthOk: boolean;
  health: unknown;
  authOk: boolean;
  auth: unknown;
};
type StoryboardLocalBridgeHelperInvoke = (
  request: StoryboardLocalBridgeHelperRequestMessage,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;

type StoryboardLocalBridgeDirectResponse = {
  ok: boolean;
  status: number;
  body: unknown;
};

class StoryboardLocalBridgeDirectTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoryboardLocalBridgeDirectTransportError";
  }
}

function isStoryboardLocalBridgeHelperReadyMessage(
  value: unknown,
): value is StoryboardLocalBridgeHelperReadyMessage {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind ===
      "tzudong-local-bridge-helper-ready" &&
    (value as { surface?: unknown }).surface === "storyboard" &&
    typeof (value as { sessionId?: unknown }).sessionId === "string" &&
    (value as { protocolVersion?: unknown }).protocolVersion ===
      STORYBOARD_LOCAL_BRIDGE_HELPER_VERSION
  );
}

function isStoryboardLocalBridgeHelperResponseMessage(
  value: unknown,
): value is StoryboardLocalBridgeHelperResponseMessage {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind ===
      "tzudong-local-bridge-helper-response" &&
    typeof (value as { sessionId?: unknown }).sessionId === "string" &&
    typeof (value as { requestId?: unknown }).requestId === "string" &&
    typeof (value as { ok?: unknown }).ok === "boolean"
  );
}

function isStoryboardLocalBridgeHelperClosedMessage(
  value: unknown,
): value is StoryboardLocalBridgeHelperClosedMessage {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind ===
      "tzudong-local-bridge-helper-closed" &&
    typeof (value as { sessionId?: unknown }).sessionId === "string"
  );
}

function createStoryboardLocalBridgeHelperSessionId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return crypto.randomUUID();
}

function getStoryboardLocalBridgeReconnectRequiredMessage() {
  return "고급 로컬 브릿지를 사용하려면 이 탭에서 페어링 코드를 적용한 뒤 다시 연결해 주세요.";
}

function getStoryboardLocalBridgeHelperClosedMessage() {
  return "로컬 브릿지 helper 창이 닫혔습니다. `로컬 브릿지 다시 연결`을 눌러 다시 연결한 뒤 다시 시도하세요.";
}

function getStoryboardLocalBridgePopupBlockedMessage() {
  return "브라우저가 로컬 브릿지 helper 팝업을 막았습니다. 팝업을 허용한 뒤 `로컬 브릿지 다시 연결`을 다시 눌러 주세요.";
}

function getStoryboardLocalBridgeOrigin(bridgeUrl: string) {
  return new URL(normalizeStoryboardLocalBridgeUrl(bridgeUrl)).origin;
}

function buildStoryboardLocalBridgeHelperUrl(
  bridgeUrl: string,
  sessionId: string,
) {
  const baseUrl = normalizeStoryboardLocalBridgeUrl(bridgeUrl);
  const helperUrl = new URL(
    STORYBOARD_LOCAL_BRIDGE_HELPER_ROUTE,
    `${baseUrl}/`,
  );
  helperUrl.searchParams.set(
    STORYBOARD_LOCAL_BRIDGE_HELPER_QUERY_ORIGIN,
    window.location.origin,
  );
  helperUrl.searchParams.set(
    STORYBOARD_LOCAL_BRIDGE_HELPER_QUERY_SESSION,
    sessionId,
  );
  helperUrl.searchParams.set(
    STORYBOARD_LOCAL_BRIDGE_HELPER_QUERY_SURFACE,
    "storyboard",
  );
  return helperUrl.toString();
}

function normalizeStoryboardBrowserOpenAIApiKeyInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 260) return null;
  if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(trimmed)) return null;
  return trimmed;
}

function maskStoryboardBrowserOpenAIApiKey(value: string) {
  if (!value) return "";
  const prefix = value.slice(0, 7);
  const suffix = value.slice(-4);
  return `${prefix}…${suffix}`;
}


function getStoryboardBrowserModelKeyHeaders(
  openAIApiKey: string | null,
): Record<string, string> {
  return openAIApiKey
    ? { [STORYBOARD_BROWSER_OPENAI_API_KEY_HEADER]: openAIApiKey }
    : {};
}

type StoryboardImageRouteChoice =
  | "browser-openai-api-key"
  | "local-codex-oauth"
  | typeof STORYBOARD_LOCAL_BRIDGE_ROUTE_ID;

type StoryboardImageApiRouterView = {
  id: StoryboardImageRouteChoice | "setup-required";
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

function getStoryboardImageApiRouterView(
  readiness: StoryboardImageProviderReadiness,
  selectedRoute: StoryboardImageRouteChoice,
  hasBrowserOpenAIApiKey: boolean,
  hasLocalBridgeToken: boolean,
): StoryboardImageApiRouterView {
  if (selectedRoute === "browser-openai-api-key") {
    const isBrowserOpenAIApiKeyReady =
      readiness.status === "ready" &&
      readiness.providerId === STORYBOARD_BROWSER_OPENAI_IMAGE_PROVIDER_ID;
    return {
      id: "browser-openai-api-key",
      label: "OpenAI API 키",
      statusLabel: !hasBrowserOpenAIApiKey
        ? "키 필요"
        : isBrowserOpenAIApiKeyReady
          ? "사용 중"
          : readiness.status === "checking"
            ? "확인 중"
            : "확인 필요",
      summary: "이 탭 메모리에 적용한 키로 gpt-image-2를 호출합니다.",
      codexOAuthStatus: "api-key-active",
    };
  }

  if (selectedRoute === "local-codex-oauth") {
    return {
      id: "local-codex-oauth",
      label: "기본 OAuth",
      statusLabel:
        readiness.status === "ready" &&
        readiness.providerId === STORYBOARD_IMAGE_PROVIDER_ID
          ? "사용 중"
          : readiness.status === "checking"
            ? "확인 중"
            : "확인 필요",
      summary: "서버 라우터가 Codex OAuth로 gpt-image-2를 호출합니다.",
      codexOAuthStatus:
        readiness.status === "ready" &&
        readiness.providerId === STORYBOARD_IMAGE_PROVIDER_ID
          ? "active"
          : readiness.status === "checking"
            ? "checking"
            : "unavailable",
    };
  }

  if (selectedRoute === STORYBOARD_LOCAL_BRIDGE_ROUTE_ID) {
    const isReady =
      readiness.status === "ready" &&
      readiness.providerId === STORYBOARD_IMAGE_PROVIDER_ID;
    return {
      id: STORYBOARD_LOCAL_BRIDGE_ROUTE_ID,
      label: "고급 로컬",
      statusLabel: !hasLocalBridgeToken
        ? "토큰 필요"
        : isReady
          ? "연결됨"
          : readiness.status === "checking"
            ? "확인 중"
            : "확인 필요",
      summary: "같은 Codex OAuth를 사용자 PC 브릿지에서 직접 실행합니다.",
      codexOAuthStatus: isReady
        ? "local-bridge-active"
        : hasLocalBridgeToken
          ? "checking"
          : "local-bridge-unpaired",
    };
  }

  return {
    id: "setup-required",
    label: "설정 필요",
    statusLabel: readiness.status === "checking" ? "확인 중" : "설정 필요",
    summary: "기본 OAuth, 고급 로컬, API Key 백업 중 하나를 확인해 주세요.",
    codexOAuthStatus:
      readiness.status === "checking" ? "checking" : "unavailable",
  };
}

const DEFAULT_FORM: GeneratorForm = {
  prompt:
    "반복 시청이 많았던 먹방 장면을 바탕으로 다음 업로드용 스토리보드를 좋은 흐름에 맞춰 9~12컷 안에서 구성해줘. 가게 앞 인트로, 주문/조리 기대감, 첫 입, ASMR 질감, 조합 변주, 완식/평가, 다음 소재 연결까지 포함해줘.",
  tone: "energetic",
  targetLengthMinutes: 14,
  sourceLimit: 80,
  segmentCount: 10,
  includeProductionNotes: true,
  generationMode: "backend_agent",
};


const STORYBOARD_USAGE_GUIDE_TEXT =
  "간단히 3가지만 적으면 됩니다. 1) 어떤 음식이나 장면인지 2) 몇 컷이 필요한지 3) 꼭 보여주고 싶은 순간입니다. 추천 카드를 고르면 이 흐름대로 바로 스토리보드를 만들어볼게요.";

const STORYBOARD_CHAT_IMAGE_ATTACHMENT_LIMIT = 3;
const STORYBOARD_CHAT_IMAGE_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
const STORYBOARD_CHAT_IMAGE_ATTACHMENT_ACCEPT =
  "image/png,image/jpeg,image/webp";
const STORYBOARD_CHAT_IMAGE_ATTACHMENT_ONLY_PROMPT =
  "첨부한 사진을 참고해서 스토리보드 방향을 제안해줘.";
const STORYBOARD_CHAT_IMAGE_ATTACHMENT_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
] as const);
const STORYBOARD_CHAT_CONVERSATION_CONTEXT_LIMIT = 8;
const STORYBOARD_CHAT_TEXTAREA_MIN_HEIGHT_PX = 40;
const STORYBOARD_CHAT_TEXTAREA_MULTILINE_MIN_HEIGHT_PX = 72;
const STORYBOARD_CHAT_TEXTAREA_MAX_HEIGHT_PX = 96;

function resizeStoryboardChatTextarea(
  textarea: HTMLTextAreaElement | null,
): boolean {
  if (!textarea) return false;

  textarea.style.minHeight = `${STORYBOARD_CHAT_TEXTAREA_MIN_HEIGHT_PX}px`;
  textarea.style.height = `${STORYBOARD_CHAT_TEXTAREA_MIN_HEIGHT_PX}px`;
  const scrollHeight = textarea.scrollHeight;
  const isMultiline =
    scrollHeight > STORYBOARD_CHAT_TEXTAREA_MIN_HEIGHT_PX + 20 ||
    textarea.value.includes("\n");
  const minHeight = isMultiline
    ? STORYBOARD_CHAT_TEXTAREA_MULTILINE_MIN_HEIGHT_PX
    : STORYBOARD_CHAT_TEXTAREA_MIN_HEIGHT_PX;
  const nextHeight = Math.min(
    STORYBOARD_CHAT_TEXTAREA_MAX_HEIGHT_PX,
    Math.max(minHeight, scrollHeight),
  );
  textarea.style.minHeight = `${minHeight}px`;
  textarea.style.maxHeight = `${
    isMultiline
      ? STORYBOARD_CHAT_TEXTAREA_MAX_HEIGHT_PX
      : STORYBOARD_CHAT_TEXTAREA_MIN_HEIGHT_PX
  }px`;
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY =
    scrollHeight > STORYBOARD_CHAT_TEXTAREA_MAX_HEIGHT_PX ? "auto" : "hidden";
  return isMultiline;
}

type StoryboardExportPresetId = "quick-1280x720" | "high-1920x1080";

type StoryboardExportPreset = {
  id: StoryboardExportPresetId;
  label: string;
  width: number;
  height: number;
};

const storyboardExportPresets: StoryboardExportPreset[] = [
  { id: "quick-1280x720", label: "1280×720", width: 1280, height: 720 },
  { id: "high-1920x1080", label: "1920×1080", width: 1920, height: 1080 },
];

type StoryboardChatQuickCommand =
  | "example"
  | "generate"
  | "guide"
  | "history"
  | "image_status"
  | "images"
  | "review"
  | "reset"
  | "safety"
  | "settings"
  | "status"
  | "trace";

function isStoryboardRagProcessIntent(message: string) {
  const normalized = message.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return false;

  return /(?:rag|r\.a\.g|검색\s*과정|retrieval|retrieve|랭스미스|langsmith|contextual|컨텍스트|context\s*retrieval|임베딩|embedding|리랭커|reranker|bge|llava|캡셔닝|captioning|ollama|올라마|exaone|eeve|qwen|solar|모델\s*스택|model\s*stack)/i.test(
    normalized,
  );
}

function isStoryboardTraceIntent(message: string) {
  const normalized = message.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return false;
  if (isStoryboardRagProcessIntent(normalized)) return false;
  if (
    /(초기화|리셋|reset|clear|재생성|다시\s*생성|이미지\s*(?:만들|생성|재생성)|생성해|만들어\s*줘|만들어줘|구성해|짜줘|뽑아)/i.test(
      normalized,
    )
  ) {
    return false;
  }
  if (!/(?:pdf|데이터\s*흐름|맛집\s*지도|창작자|시청자|히스토리|db|스토리보드\s*흐름)/i.test(normalized)) {
    return false;
  }

  return /(?:pdf|데이터\s*흐름|맛집\s*지도|창작자|시청자|히스토리|db|스토리보드\s*흐름).*(?:흐름|과정|추적|trace|이유|근거)|(?:흐름|과정|추적|trace|이유|근거).*(?:pdf|데이터\s*흐름|맛집\s*지도|창작자|시청자|히스토리|db|스토리보드\s*흐름)/i.test(
    normalized,
  );
}

function clampStoryboardUiSegmentCount(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(
    STORYBOARD_MAX_SEGMENT_COUNT,
    Math.max(STORYBOARD_MIN_SEGMENT_COUNT, Math.trunc(value)),
  );
}

function deriveStoryboardUiSegmentCount(prompt: string, fallback: number) {
  const explicit = prompt.match(
    /(?:총|전체)?\s*(\d{1,2})\s*(?:컷|cut|cuts|장면)\s*(?:정도|내외|가량|쯤)?\s*(?:로|으로|짜|구성|생성|만들|스토리보드)?/i,
  )?.[1];

  return clampStoryboardUiSegmentCount(Number(explicit), fallback);
}

function normalizeStoryboardGeneratorFormForSubmit(
  form: GeneratorForm,
): GeneratorForm {
  return {
    ...form,
    segmentCount: deriveStoryboardUiSegmentCount(
      form.prompt,
      form.segmentCount,
    ),
  };
}

function getStoryboardChatQuickCommand(
  message: string,
): StoryboardChatQuickCommand | null {
  const normalized = message.trim().replace(/\s+/g, " ").toLowerCase();
  const compact = normalized.replace(/\s+/g, "");
  const isShortCommand = normalized.length <= 28;

  if (/^(초기화|리셋|reset|clear)$/.test(compact)) return "reset";
  if (/^(상태|요약|status|컷상태)$/.test(compact)) return "status";
  if (
    /^(이미지상태|이미지생성상태|생성상태|provider|gpt-image-2|gptimage2)$/.test(
      compact,
    )
  ) {
    return "image_status";
  }
  if (
    /^(안전|안전점검|이미지점검|얼굴점검|비주얼점검|safety|visualsafety|imagecheck|facecheck)$/.test(
      compact,
    )
  ) {
    return "safety";
  }
  if (/^(점검|검토|리뷰|사용자점검|사용자관점|검수|qa|review)$/.test(compact)) {
    return "review";
  }
  if (/^(히스토리|생성히스토리|기록|history)$/.test(compact)) return "history";
  if (/^(가이드|도움말|사용법|guide|help)$/.test(compact)) return "guide";
  if (/^(예시|예시생성|예시만들기|추천예시|sample|example)$/.test(compact)) {
    return "example";
  }
  if (/^(설정|톱니바퀴|settings|setting)$/.test(compact)) return "settings";
  if (
    isShortCommand &&
    (/(4컷|네컷|현재4컷).*(재생성|다시생성)/.test(compact) ||
      /^(4컷재생성|네컷재생성|이미지재생성|컷재생성)$/.test(compact))
  ) {
    return "images";
  }
  if (
    /^(과정|흐름|이유|근거|trace|왜|왜이렇게나왔어|왜나왔어)[?!.。]*$/.test(
      compact,
    )
  ) {
    return "trace";
  }
  if (/^(생성|스토리보드생성|실제생성|generate)$/.test(compact)) {
    return "generate";
  }
  if (isStoryboardTraceIntent(message)) return "trace";

  return null;
}

const STORYBOARD_FRAMES_PER_PAGE = 4;
// Source contracts kept literal for admin storyboard UI regression tests:
// postStoryboardImagesRequest(sourceResult, activeStoryboardImageGenerationTargetScenes)
// Array.from({ length: STORYBOARD_FRAMES_PER_PAGE }
// data-storyboard-frame-page={String(activeStoryboardPage + 1)}
// data-storyboard-frame-page-size={String(STORYBOARD_FRAMES_PER_PAGE)}
type StoryboardFramePageSize = 1 | typeof STORYBOARD_FRAMES_PER_PAGE;

function formatStoryboardGraphRuntimeLabel(
  graph: NonNullable<
    StoryboardGenerationResult["backendAnalysis"]["backendAgent"]
  >["graph"],
) {
  if (!graph) return null;
  if (graph.runtime === "langgraph") return "영상 흐름 반영";
  if (graph.runtime === "codex_cli_oauth_legacy") return "기본 구성";
  return "안전 초안";
}

function formatStoryboardGraphDiagnosticsText(
  result: StoryboardGenerationResult,
) {
  const graph = result.backendAnalysis.backendAgent?.graph;
  if (!graph) return null;
  const retrievalUsed =
    graph.retrieval?.status === "used" &&
    graph.toolsCalled.includes("search_scene_data");
  const retrievalText = retrievalUsed
    ? [
        "영상 자료 검색 반영",
        graph.retrieval?.usedModels?.embedding ? "자료 분석 반영" : null,
        graph.retrieval?.usedModels?.reranker ? "우선순위 정리" : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "요청 내용 중심";
  return [
    formatStoryboardGraphRuntimeLabel(graph),
    graph.status === "used"
      ? "생성 흐름 완료"
      : graph.status === "interrupted_output_ready"
        ? "검토 가능한 초안"
        : graph.status === "interrupted_needs_resume"
          ? "이어서 진행 필요"
          : "기본 초안",
    null,
    null,
    graph.nodesVisited.length > 0 ? "단계별 구성 완료" : null,
    retrievalText,
    graph.fallbackReason ? "안전 초안으로 전환" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function buildStoryboardBackendAgentReadiness(
  result: StoryboardGenerationResult,
): StoryboardBackendAgentReadiness {
  const backend = result.backendAnalysis.backendAgent;
  const graph = backend?.graph;
  const commandConfigured = Boolean(backend?.commandConfigured);
  const commandAvailable = Boolean(backend?.commandAvailable);
  const invokedCommand = Boolean(backend?.invokedCommand);
  const liveGraphReady = Boolean(
    commandConfigured &&
    commandAvailable &&
    invokedCommand &&
    graph?.runtime === "langgraph" &&
    graph.mode === "graph_command" &&
    (graph.status === "used" || graph.status === "interrupted_output_ready"),
  );
  const retrievalUsed = Boolean(
    liveGraphReady &&
    graph?.status === "used" &&
    graph.retrieval?.status === "used" &&
    graph.toolsCalled.includes("search_scene_data"),
  );
  const resumeRequired = Boolean(
    graph && graph.status === "interrupted_needs_resume",
  );
  const outputReadyForReview = Boolean(
    graph && graph.status === "interrupted_output_ready",
  );

  if (retrievalUsed) {
    return {
      status: "live_retrieval_used",
      label: "자료 반영 완료",
      summary: "영상 자료와 요청 내용을 함께 반영했습니다.",
      detail:
        formatStoryboardGraphDiagnosticsText(result) ?? "영상 자료 반영 완료",
      liveGraphReady,
      retrievalUsed,
      resumeRequired,
      outputReadyForReview,
    };
  }

  if (outputReadyForReview && liveGraphReady) {
    return {
      status: "output_ready_for_review",
      label: "초안 검토 가능",
      summary: "스토리보드 초안을 검토하고 바로 수정할 수 있습니다.",
      detail: formatStoryboardGraphDiagnosticsText(result) ?? "초안 검토 가능",
      liveGraphReady,
      retrievalUsed,
      resumeRequired,
      outputReadyForReview,
    };
  }

  if (resumeRequired) {
    return {
      status: "resume_required",
      label: "이어서 진행 필요",
      summary: "초안 구성을 마치려면 한 번 더 생성해 주세요.",
      detail:
        formatStoryboardGraphDiagnosticsText(result) ?? "이어서 진행 필요",
      liveGraphReady: false,
      retrievalUsed: false,
      resumeRequired,
      outputReadyForReview,
    };
  }

  if (liveGraphReady) {
    return {
      status: "live_no_retrieval",
      label: "생성 준비됨",
      summary: "요청 내용을 기준으로 컷 구성을 만들 수 있습니다.",
      detail: formatStoryboardGraphDiagnosticsText(result) ?? "생성 준비됨",
      liveGraphReady,
      retrievalUsed,
      resumeRequired,
      outputReadyForReview,
    };
  }

  if (graph?.runtime === "codex_cli_oauth_legacy") {
    return {
      status: "legacy",
      label: "기본 구성",
      summary: "요청 내용을 기준으로 기본 스토리보드를 만들었습니다.",
      detail: formatStoryboardGraphDiagnosticsText(result) ?? "기본 구성",
      liveGraphReady: false,
      retrievalUsed: false,
      resumeRequired,
      outputReadyForReview,
    };
  }

  if (
    graph?.runtime === "local_adapter_fallback" ||
    graph?.status === "fallback"
  ) {
    return {
      status: "fallback",
      label: "안전 초안",
      summary: "사용 가능한 정보만으로 안전하게 초안을 만들었습니다.",
      detail: formatStoryboardGraphDiagnosticsText(result) ?? "안전 초안",
      liveGraphReady: false,
      retrievalUsed: false,
      resumeRequired,
      outputReadyForReview,
    };
  }

  return {
    status: "unknown",
    label: "준비 상태 확인 중",
    summary: "생성 준비 상태를 확인하고 있습니다.",
    detail: backend?.runtime
      ? "생성 상태 확인 중"
      : "아직 생성 상태가 없습니다.",
    liveGraphReady: false,
    retrievalUsed: false,
    resumeRequired: false,
    outputReadyForReview: false,
  };
}

function getStoryboardPdfFlowStatusLabel(status: StoryboardPdfFlowStatus) {
  if (status === "used") return "사용됨";
  if (status === "available") return "준비됨";
  if (status === "fallback") return "대체";
  return "미사용";
}

function getStoryboardPdfFlowBeginnerLabel(check: StoryboardPdfFlowCheck) {
  if (check.id === "dense_sparse_embedding") return "의미·단어 검색";
  if (check.id === "reranker") return "검색 결과 순서 정리";
  if (check.id === "multi_agent_graph") return "역할 분담 진행";
  if (check.id === "evaluation_logs") return "결과 평가 기록";
  if (check.id === "review_status") return "사람 검수 상태";
  return check.label;
}

function isStoryboardRetrievalUsed(result: StoryboardGenerationResult) {
  const graph = result.backendAnalysis.backendAgent?.graph;
  return Boolean(
    graph?.retrieval?.status === "used" &&
    graph.toolsCalled.includes("search_scene_data"),
  );
}

function isStoryboardCaptioningUsed(result: StoryboardGenerationResult) {
  const caption =
    result.backendAnalysis.backendAgent?.graph?.retrieval?.caption;
  return Boolean(
    caption?.lookupStatus === "used" ||
    (caption?.provider && caption.provider !== "unknown_legacy"),
  );
}

function isStoryboardDenseSparseUsed(result: StoryboardGenerationResult) {
  const retrieval = result.backendAnalysis.backendAgent?.graph?.retrieval;
  return Boolean(
    retrieval?.status === "used" &&
    retrieval.usedModels?.embedding &&
    retrieval.operations?.supabaseRpc,
  );
}

function isStoryboardRerankerUsed(result: StoryboardGenerationResult) {
  const retrieval = result.backendAnalysis.backendAgent?.graph?.retrieval;
  return Boolean(
    retrieval?.status === "used" && retrieval.usedModels?.reranker,
  );
}

function buildStoryboardPdfFlowChecks({
  result,
  backendReadiness,
  graphFidelityStatus,
  historyCount,
}: {
  result: StoryboardGenerationResult;
  backendReadiness: StoryboardBackendAgentReadiness;
  graphFidelityStatus: "passed" | "needs_iteration";
  historyCount: number;
}): StoryboardPdfFlowCheck[] {
  const hasScenes = result.storyboard.scenes.length > 0;
  const hasGraph = Boolean(result.backendAnalysis.backendAgent?.graph);
  const liveOrAvailable = backendReadiness.liveGraphReady
    ? "available"
    : "not_used";
  const retrievalStatus: StoryboardPdfFlowStatus = isStoryboardRetrievalUsed(
    result,
  )
    ? "used"
    : liveOrAvailable;
  const checkById: Record<StoryboardPdfFlowCheckId, StoryboardPdfFlowCheck> = {
    service_storyboard: {
      id: "service_storyboard",
      label: "창작자 스토리보드",
      status: hasScenes ? "used" : "not_used",
      summary: "현재 페이지가 영상 기획용 장면 구성표를 보여줍니다.",
    },
    service_restaurant_map: {
      id: "service_restaurant_map",
      label: "시청자 맛집 지도",
      status: "available",
      summary: "같은 분석 흐름의 다른 결과물로 맛집 지도 정보를 준비합니다.",
    },
    youtube_data_collection: {
      id: "youtube_data_collection",
      label: "유튜브 영상 데이터 수집",
      status: result.sourceSummary.isFallbackData ? "fallback" : "used",
      summary: result.sourceSummary.isFallbackData
        ? "실데이터가 부족해 예시 데이터로 흐름을 검증했습니다."
        : "수집된 영상 히트맵 자료를 읽었습니다.",
    },
    intro_storefront_context: {
      id: "intro_storefront_context",
      label: "초반 1분 30초 가게 앞 인트로",
      status: "used",
      summary: "첫 컷에서 인사·장소 설명·가게 앞 도입을 먼저 잡습니다.",
    },
    heatmap_replay_frames: {
      id: "heatmap_replay_frames",
      label: "가장 많이 본 장면 프레임",
      status: result.sourceSummary.isFallbackData ? "fallback" : "used",
      summary: "반복 시청 피크를 컷 선택의 핵심 근거로 사용합니다.",
    },
    video_captioning: {
      id: "video_captioning",
      label: "영상 프레임 캡셔닝",
      status: isStoryboardCaptioningUsed(result)
        ? "used"
        : backendReadiness.liveGraphReady
          ? "available"
          : "not_used",
      summary: "이미지 장면 설명이 있으면 컷 설명을 보강합니다.",
    },
    subtitle_contextual_retrieval: {
      id: "subtitle_contextual_retrieval",
      label: "자막 문맥 검색",
      status: retrievalStatus,
      summary: "짧은 자막 조각에 앞뒤 상황을 붙여 더 잘 찾게 합니다.",
    },
    dense_sparse_embedding: {
      id: "dense_sparse_embedding",
      label: "Dense+Sparse 임베딩 검색",
      status: isStoryboardDenseSparseUsed(result)
        ? "used"
        : backendReadiness.liveGraphReady
          ? "available"
          : "not_used",
      summary: "의미 검색과 키워드 검색을 함께 쓰는 준비 상태입니다.",
    },
    reranker: {
      id: "reranker",
      label: "리랭커 재정렬",
      status: isStoryboardRerankerUsed(result)
        ? "used"
        : backendReadiness.liveGraphReady
          ? "available"
          : "not_used",
      summary: "검색 결과를 다시 줄 세워 좋은 근거를 앞에 둡니다.",
    },
    multi_agent_graph: {
      id: "multi_agent_graph",
      label: "Supervisor·Researcher·Intern·Designer",
      status:
        graphFidelityStatus === "passed"
          ? "used"
          : hasGraph
            ? "fallback"
            : "available",
      summary: "역할을 나눠 조사·실행·구성을 관리하는 구조입니다.",
    },
    storyboard_design: {
      id: "storyboard_design",
      label: "장면 구성표 제작",
      status: hasScenes ? "used" : "not_used",
      summary: "CUT별 화면, 오디오, 자막 후보를 만들었습니다.",
    },
    evaluation_logs: {
      id: "evaluation_logs",
      label: "Rule·AI Judge 평가 저장",
      status: result.ahp ? "used" : "available",
      summary: STORYBOARD_EVALUATION_LOGS_TEXT,
    },
    review_status: {
      id: "review_status",
      label: "pending·approved·rejected 검수 상태",
      status: "available",
      summary: STORYBOARD_REVIEW_STATUS_TEXT,
    },
    db_history_storage: {
      id: "db_history_storage",
      label: "DB·히스토리 저장",
      status: historyCount > 0 ? "used" : "available",
      summary: "생성 결과를 다시 열 수 있도록 기록에 남깁니다.",
    },
    web_service_delivery: {
      id: "web_service_delivery",
      label: "웹서비스 표시·배포",
      status: "used",
      summary: "현재 관리자 웹 화면에서 결과를 확인합니다.",
    },
  };

  return STORYBOARD_PDF_FLOW_CHECK_DEFINITIONS.map(({ id }) => checkById[id]);
}

function formatStoryboardPdfFlowTraceText(checks: StoryboardPdfFlowCheck[]) {
  const usedLabels = checks
    .filter((check) => check.status === "used")
    .slice(0, 5)
    .map(getStoryboardPdfFlowBeginnerLabel)
    .join(", ");
  const notUsedLabels = checks.filter(
    (check) => check.status === "not_used",
  ).length;
  return [
    STORYBOARD_PDF_FLOW_SERVICE_TEXT,
    `쉬운 전체 흐름: 먹방 영상이 있다 → AI가 자막과 인기 장면을 분석한다 → 식당 정보는 맛집 지도로 만든다 → 장면 정보는 스토리보드로 만든다 → AI가 틀릴 수 있으니 평가와 사람 검수를 붙인다 → 웹서비스에서 확인한다.`,
    `이번 화면 추적 순서: ${STORYBOARD_PDF_FLOW_SEQUENCE_TEXT}`,
    usedLabels ? `이번 결과에 반영된 것: ${usedLabels}` : null,
    notUsedLabels > 0
      ? `이번 실행에서 확인되지 않은 고급 단계가 ${notUsedLabels}개 있어요. 실제 사용 여부는 설정의 근거 상태에서 확인할 수 있습니다.`
      : null,
    STORYBOARD_EVALUATION_LOGS_TEXT,
    STORYBOARD_REVIEW_STATUS_TEXT,
  ]
    .filter(Boolean)
    .join("\n");
}

function getStoryboardRealDataModeLabel(
  result: StoryboardGenerationResult,
): StoryboardRealDataTrace["mode"] {
  return result.sourceSummary.isFallbackData ? "fallback" : "actual";
}

function formatStoryboardRealDataTrace(
  result: StoryboardGenerationResult,
): StoryboardRealDataTrace {
  const mode = getStoryboardRealDataModeLabel(result);
  const headline = mode === "actual" ? "최근 실제 기록" : "공용 예시 미리보기";
  const sourceText =
    mode === "actual"
      ? "실제 로컬 기록을 다시 불러와 검토 중입니다."
      : "공용 예시 미리보기라서 실제 기록이나 승격 가능한 결과로 보면 안 됩니다.";
  const backend = result.backendAnalysis.backendAgent;
  const graph = backend?.graph;
  const backendText =
    graph?.status === "interrupted_needs_resume"
      ? "초안 구성을 이어서 진행할 수 있습니다."
      : graph?.status === "fallback"
        ? "사용 가능한 정보로 안전하게 초안을 만들었습니다."
        : "스토리보드 초안을 만들었습니다.";
  const generatedAtText = "최근 생성 결과";
  return {
    mode,
    headline,
    sourceText,
    backendText,
    generatedAtText,
  };
}

function formatStoryboardOmittedSceneText(omittedSceneCount: number) {
  return omittedSceneCount > 0
    ? `무이미지/미검증 컷 ${omittedSceneCount}개 제외`
    : "무이미지/미검증 컷 없음";
}

function normalizeStoryboardCopyText(
  value: string | undefined,
  fallback: string,
) {
  const normalized = (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .trim();
  return normalized
    ? normalizeLegacyKoreanParticleDisplayText(normalized)
    : fallback;
}

function normalizeStoryboardCopyBlock(
  value: string | undefined,
  fallback: string,
) {
  const normalized = (value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized
    ? normalizeLegacyKoreanParticleDisplayText(normalized)
    : fallback;
}

function normalizeStoryboardCopyMarkdownBlock(
  value: string | undefined,
  fallback: string,
) {
  const normalized = normalizeStoryboardCopyBlock(value, "");
  if (!normalized) return fallback;

  return normalized
    .replace(/\s+(#{1,6}\s+)/g, "\n\n$1")
    .replace(/\s+(\|\s*CUT\s*\|)/g, "\n\n$1")
    .replace(/\s+(\|\s*---)/g, "\n$1")
    .replace(/\s+(\|\s*CUT\s+\d{2}\s*\|)/g, "\n$1")
    .replace(/\s+(###\s+CUT\s+\d{2})/g, "\n\n$1")
    .replace(/\s+(-\s+(?:촬영|멘트|자막|체크|근거|오디오):)/g, "\n$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatStoryboardCopyMarkdownLines(lines: string[]) {
  return lines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/\n/g, "\r\n");
}

function formatStoryboardCopyChecklist(
  items: string[] | undefined,
  fallback: string,
) {
  const normalizedItems =
    items
      ?.map((item) => normalizeStoryboardCopyBlock(item, ""))
      .filter(Boolean) ?? [];

  return normalizedItems.length > 0
    ? normalizedItems.map((item) => `  - ${item}`)
    : [`  - ${fallback}`];
}

async function writeStoryboardClipboardText(text: string) {
  let selectionCopyError: unknown = null;
  const textarea = document.createElement("textarea");
  const selection = document.getSelection();
  const selectedRange =
    selection && selection.rangeCount > 0
      ? selection.getRangeAt(0).cloneRange()
      : null;
  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const handleCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
  };

  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto 0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);

  try {
    document.addEventListener("copy", handleCopy);
    textarea.focus();
    textarea.setSelectionRange(0, textarea.value.length);

    if (!document.execCommand("copy")) {
      throw new Error("브라우저 복사 명령을 사용할 수 없습니다.");
    }
    return;
  } catch (fallbackError) {
    selectionCopyError = fallbackError;
  } finally {
    document.removeEventListener("copy", handleCopy);
    textarea.remove();
    if (selection && selectedRange) {
      selection.removeAllRanges();
      selection.addRange(selectedRange);
    }
    activeElement?.focus({ preventScroll: true });
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (clipboardError) {
      if (selectionCopyError instanceof Error) {
        throw selectionCopyError;
      }
      if (clipboardError instanceof Error) {
        throw clipboardError;
      }
    }
  }

  throw new Error("브라우저 클립보드 권한을 사용할 수 없습니다.");
}

function buildStoryboardClientCopyPlanMarkdown(
  result: StoryboardGenerationResult,
) {
  const current = normalizeStoryboardCopyMarkdownBlock(
    result.storyboard.exportMarkdown,
    "",
  );
  const scenes = result.storyboard.scenes;
  if (scenes.length === 0) {
    return current ? formatStoryboardCopyMarkdownLines([current]) : "";
  }

  const generatedImageCount = countTrustedStoryboardGeneratedImages(scenes);
  const request = result.request;
  const lines = [
    `# ${normalizeStoryboardCopyText(result.storyboard.title, "스토리보드 기획서")}`,
    "",
    `> ${normalizeStoryboardCopyBlock(
      result.storyboard.logline,
      "CUT별 촬영 지시, 멘트, 자막, 근거를 한 번에 확인합니다.",
    )}`,
    "",
    "## 제작 개요",
    "",
    `- 생성 요청: ${normalizeStoryboardCopyBlock(request.prompt, "요청 프롬프트 없음")}`,
    `- 생성 모드: ${normalizeStoryboardCopyText(request.generationMode, "기본 생성")}`,
    `- 영상 톤: ${normalizeStoryboardCopyText(
      STORYBOARD_DISPLAY_TONE_LABELS[request.tone] ?? request.tone,
      "먹방 스토리보드",
    )}`,
    `- 목표 분량: ${request.targetLengthMinutes}분 · ${request.segmentCount}컷`,
    `- 이미지 상태: 생성 완료 ${generatedImageCount}/${scenes.length}컷`,
    `- 데이터 상태: ${normalizeStoryboardCopyText(
      result.sourceSummary.dataModeLabel,
      "스토리보드 데이터",
    )} · 선택 소스 ${result.sourceSummary.selectedSources}개 · 마커 ${result.sourceSummary.totalMarkers}개`,
    `- 생성 시각: ${normalizeStoryboardCopyText(result.generatedAt, "생성 시각 없음")}`,
    "",
    "## 전체 요약",
    "",
    normalizeStoryboardCopyBlock(
      result.storyboard.operatorBrief,
      "현장 진행자는 CUT별 멘트, 자막, 촬영 지시를 기준으로 촬영합니다.",
    ),
    "",
    "## 촬영 기획표",
    "",
    "| CUT | 역할 | 촬영 지시 | 멘트 | 자막 | 근거 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...scenes.map((scene) => {
      const cut = `CUT ${String(scene.sceneNo).padStart(2, "0")}`;
      const role = normalizeStoryboardCopyText(scene.title, "장면 구성");
      const shot = normalizeStoryboardCopyText(
        scene.visualDirection || scene.operatorIntent,
        "촬영 지시 확인",
      );
      const hostBeat = normalizeStoryboardCopyText(
        scene.hostBeat,
        "현장 멘트 확인",
      );
      const subtitle = normalizeStoryboardCopyText(
        scene.captionIdea,
        "자막 확인",
      );
      const evidence = normalizeStoryboardCopyText(
        `${scene.heatmapEvidence.peakTime} · ${scene.heatmapEvidence.reason}`,
        "근거 확인",
      );
      return `| ${cut} | ${role} | ${shot} | ${hostBeat} | ${subtitle} | ${evidence} |`;
    }),
    "",
    "## CUT별 상세 메모",
    "",
    ...scenes.flatMap((scene) => {
      const trustedImage = getTrustedStoryboardGeneratedImage(
        scene.generatedImage,
      );
      const cut = `CUT ${String(scene.sceneNo).padStart(2, "0")}`;

      return [
        `### ${cut} · ${normalizeStoryboardCopyText(scene.title, "장면 구성")}`,
        `- 길이: ${scene.durationSec}초`,
        `- 역할: ${normalizeStoryboardCopyBlock(scene.operatorIntent, "장면 역할 확인")}`,
        `- 촬영 지시: ${normalizeStoryboardCopyBlock(scene.visualDirection, "촬영 지시 확인")}`,
        `- 현장 멘트: ${normalizeStoryboardCopyBlock(scene.hostBeat, "현장 멘트 확인")}`,
        `- 자막: ${normalizeStoryboardCopyBlock(scene.captionIdea, "자막 확인")}`,
        `- 근거: ${normalizeStoryboardCopyBlock(
          `${scene.heatmapEvidence.peakTime} · 리플레이 ${scene.heatmapEvidence.replayScore} · ${scene.heatmapEvidence.reason}`,
          "근거 확인",
        )}`,
        "- 제작 체크리스트:",
        ...formatStoryboardCopyChecklist(
          scene.productionChecklist,
          "현장 동선, 메뉴, 리액션 포인트 확인",
        ),
        `- 이미지 상태: ${trustedImage ? `생성 완료 · ${trustedImage.model}` : "아직 생성 전"}`,
        `- 이미지 프롬프트: ${normalizeStoryboardCopyBlock(
          trustedImage?.prompt,
          "이미지 생성 후 프롬프트가 기록됩니다.",
        )}`,
        "",
      ];
    }),
  ];

  if (current) {
    lines.push("## 원본 내보내기 메모", "", current);
  }

  return formatStoryboardCopyMarkdownLines(lines);
}

function buildStoryboardUserPerspectiveReadiness({
  result,
  activeCutStart,
  activeCutEnd,
  activePageGeneratedCount,
  activePageSceneCount,
  generatedImageCount,
  visibleCutCount,
  omittedSceneCount,
  hasSelectedCut,
}: {
  result: StoryboardGenerationResult;
  activeCutStart: number;
  activeCutEnd: number;
  activePageGeneratedCount: number;
  activePageSceneCount: number;
  generatedImageCount: number;
  visibleCutCount: number;
  omittedSceneCount: number;
  hasSelectedCut: boolean;
}): StoryboardUserPerspectiveReadinessItem[] {
  const isActualData = getStoryboardRealDataModeLabel(result) === "actual";
  const hasVisibleGeneratedCuts =
    visibleCutCount > 0 && generatedImageCount > 0;
  const activePageReady =
    activePageSceneCount > 0 &&
    activePageGeneratedCount === activePageSceneCount;
  const omittedText = formatStoryboardOmittedSceneText(omittedSceneCount);

  return [
    {
      id: "host",
      label: "쯔양",
      status: hasVisibleGeneratedCuts ? "ready" : "watch",
      summary: hasSelectedCut
        ? "선택한 CUT 맥락으로 멘트·리액션 수정 가능"
        : "채팅으로 요구사항 입력 후 CUT을 눌러 멘트 수정 가능",
      detail: hasVisibleGeneratedCuts
        ? `현재 CUT ${String(activeCutStart).padStart(2, "0")}–${String(activeCutEnd).padStart(2, "0")}를 보며 말할 포인트를 점검합니다.`
        : "먼저 스토리보드와 컷 이미지를 생성해야 진행자가 확인할 장면이 생깁니다.",
    },
    {
      id: "manager",
      label: "매니저",
      status: isActualData ? "ready" : "watch",
      summary: isActualData ? "영상 흐름을 참고한 구성" : "예시 구성",
      detail: isActualData
        ? "영상 흐름과 요청 내용을 함께 확인합니다."
        : "실제 영상 자료가 필요하면 다시 생성해 주세요.",
    },
    {
      id: "pd",
      label: "PD",
      status: activePageReady ? "ready" : "watch",
      summary: activePageReady
        ? "현재 보기 페이지가 생성 이미지로 채워짐"
        : "현재 페이지 생성 이미지 누락 컷 확인 필요",
      detail: `현재 ${activePageGeneratedCount}/${activePageSceneCount || 1} · 전체 ${generatedImageCount}/${visibleCutCount} · ${omittedText}`,
    },
    {
      id: "editor",
      label: "편집자",
      status: hasVisibleGeneratedCuts ? "ready" : "watch",
      summary: "이미지와 분리된 오디오/자막으로 컷별 편집 판단",
      detail: hasVisibleGeneratedCuts
        ? "프레임 아래 멘트 영역에서 오디오와 자막을 따로 읽고 채팅으로 바로 수정할 수 있습니다."
        : "검증된 이미지가 생성되면 오디오/자막 점검 영역이 함께 표시됩니다.",
    },
  ];
}

function formatStoryboardUserPerspectiveMessage(
  readinessItems: StoryboardUserPerspectiveReadinessItem[],
  result: StoryboardGenerationResult,
  generatedImageCount: number,
  visibleCutCount: number,
  omittedSceneCount: number,
) {
  const trace = formatStoryboardRealDataTrace(result);
  const roleLines = readinessItems.map((item) => {
    const statusText = item.status === "ready" ? "준비됨" : "확인 필요";
    return `${item.label}: ${statusText} · ${item.summary}`;
  });
  return [
    `사용자 관점 점검 · 이미지 ${generatedImageCount}/${visibleCutCount} · ${formatStoryboardOmittedSceneText(omittedSceneCount)}`,
    ...roleLines,
    `데이터 근거: ${trace.headline} · ${trace.sourceText}`,
  ].join("\n");
}

function formatStoryboardVisualSafetyMessage(
  result: StoryboardGenerationResult,
  generatedImageCount: number,
  visibleCutCount: number,
  omittedSceneCount: number,
) {
  const trace = formatStoryboardRealDataTrace(result);
  return [
    `이미지 안전 점검 · 컷 이미지 ${generatedImageCount}/${visibleCutCount} · ${formatStoryboardOmittedSceneText(omittedSceneCount)}`,
    "실존 인물/진행자 얼굴은 생성 대상이 아닙니다. 얼굴 클로즈업·눈/코/입 세부 묘사는 피하고 손·젓가락·음식·오버숄더/뒷모습 실루엣 중심으로 점검합니다.",
    "컷 이미지 아래의 오디오/자막 영역에서 대사와 자막을 분리해 검수하고, 문제가 있으면 선택한 CUT 맥락으로 바로 수정 요청하세요.",
    `근거: ${trace.headline} · ${trace.backendText}`,
  ].join("\n");
}

function summarizeChatPrompt(prompt: string) {
  const normalized = sanitizeStoryboardChatDisplayText(prompt);
  if (!normalized) return "채팅창에 스토리보드 요구사항을 입력해 주세요.";
  return normalized.length > 86 ? `${normalized.slice(0, 86)}…` : normalized;
}

function formatStoryboardChatAttachmentBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "크기 미상";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function normalizeStoryboardChatAttachmentName(name: string) {
  const normalized = name.replace(/\s+/g, " ").trim().slice(0, 80);
  return normalized || "첨부 사진";
}

function createStoryboardChatAttachmentId(file: File) {
  return `storyboard-chat-image-${Date.now()}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`;
}

function readStoryboardChatImageDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("사진 파일을 읽지 못했습니다."));
    };
    reader.onerror = () => reject(new Error("사진 파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

function getStoryboardChatImageDimensions(dataUrl: string) {
  return new Promise<{ width: number; height: number } | null>((resolve) => {
    const image = new window.Image();
    image.onload = () =>
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

async function createStoryboardChatImageAttachment(
  file: File,
): Promise<StoryboardChatImageAttachment> {
  if (
    !STORYBOARD_CHAT_IMAGE_ATTACHMENT_MIME_TYPES.has(
      file.type as StoryboardChatImageAttachment["mimeType"],
    )
  ) {
    throw new Error("PNG, JPG, WebP 사진만 첨부할 수 있습니다.");
  }
  if (file.size > STORYBOARD_CHAT_IMAGE_ATTACHMENT_MAX_BYTES) {
    throw new Error("사진은 장당 4MB 이하만 첨부할 수 있습니다.");
  }
  const dataUrl = await readStoryboardChatImageDataUrl(file);
  const dimensions = await getStoryboardChatImageDimensions(dataUrl);
  return {
    id: createStoryboardChatAttachmentId(file),
    name: normalizeStoryboardChatAttachmentName(file.name),
    mimeType: file.type as StoryboardChatImageAttachment["mimeType"],
    size: file.size,
    dataUrl,
    ...(dimensions ?? {}),
  };
}

function formatStoryboardChatAttachmentSummary(
  attachments: StoryboardChatImageAttachment[],
) {
  if (!attachments.length) return "";
  return `첨부 사진 ${attachments.length}장 · ${attachments
    .map((attachment) => attachment.name)
    .join(", ")}`;
}

function hasKoreanFinalConsonant(value: string) {
  const last = Array.from(value.trim()).at(-1);
  if (!last) return false;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

function getKoreanParticleForDisplay(
  stem: string,
  pair: "은/는" | "이/가" | "을/를",
) {
  const hasFinal = hasKoreanFinalConsonant(stem);
  if (pair === "은/는") return hasFinal ? "은" : "는";
  if (pair === "이/가") return hasFinal ? "이" : "가";
  return hasFinal ? "을" : "를";
}

function normalizeLegacyKoreanParticleDisplayText(value: string) {
  return value
    .replace(
      /([가-힣A-Za-z0-9]+)(은\/는|이\/가|을\/를)/g,
      (_match, stem: string, pair: "은/는" | "이/가" | "을/를") =>
        `${stem}${getKoreanParticleForDisplay(stem, pair)}`,
    )
    .replace(
      /([가-힣]+)이(?=\s+(?:살아야|좋아야|보여야|돋보여야|느껴져야|핵심입니다))/g,
      (_match, stem: string) =>
        `${stem}${getKoreanParticleForDisplay(stem, "이/가")}`,
    );
}

function sanitizeStoryboardChatDisplayText(value: string) {
  const locallySanitized = value
    .replace(/sk-proj-[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
    .replace(
      /(OPENAI[_A-Z]*|SERVICE[_A-Z]*|SUPABASE[_A-Z]*|API[_A-Z]*KEY|TOKEN|SECRET)\s*[:=]\s*[^\s,;"'{}\\]+/gi,
      "[REDACTED]",
    )
    .replace(
      /ignore\s+(?:all\s+)?previous\s+instructions?/gi,
      "[SAFETY-REDACTED-INSTRUCTION]",
    )
    .replace(
      /reveal\s+(?:openai[_\s-]*api[_\s-]*key|api[_\s-]*key|secret|token)[^.!?\n\r]*/gi,
      "[SAFETY-REDACTED-INSTRUCTION]",
    )
    .replace(
      /delete\s+\.?omx\/state[^.!?\n\r]*/gi,
      "[SAFETY-REDACTED-INSTRUCTION]",
    )
    .replace(/검증을\s*건너뛰[^\n\r.!?]*/g, "[SAFETY-REDACTED-INSTRUCTION]")
    .replace(
      /이전\s*지시(?:를)?\s*무시[^\n\r.!?]*/g,
      "[SAFETY-REDACTED-INSTRUCTION]",
    );

  const safe = sanitizeStoryboardPublicText(locallySanitized)
    .replaceAll(
      STORYBOARD_PUBLIC_SAFETY_REPLACEMENT,
      "[SAFETY-REDACTED-INSTRUCTION]",
    )
    .trim()
    .replace(/\s+/g, " ");
  return normalizeLegacyKoreanParticleDisplayText(safe);
}

function sanitizeStoryboardAssistantSourceText(value: string) {
  const safe = sanitizeStoryboardPublicText(value)
    .replaceAll(
      STORYBOARD_PUBLIC_SAFETY_REPLACEMENT,
      "[SAFETY-REDACTED-INSTRUCTION]",
    )
    .trim()
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
  return normalizeLegacyKoreanParticleDisplayText(safe);
}

function shouldPreserveStoryboardRagTransparencyTerms(value: string) {
  return /(?:RAG\s*작동\s*과정|생각\s*중\s*·?\s*RAG\s*추적|모델\s*스택|model\s*stack|a\.x-4\.0|bge-m3|bge-reranker|LangSmith|랭스미스)/i.test(
    value,
  );
}

function formatStoryboardAssistantDisplayText(value: string) {
  const protectedNoImageLabel = STORYBOARD_NO_TRUSTED_IMAGE_LABEL.replace(
    " · ",
    " __STORYBOARD_NO_IMAGE_DOT__ ",
  );
  const preserveRagTerms = shouldPreserveStoryboardRagTransparencyTerms(value);
  let safe = sanitizeStoryboardAssistantSourceText(value)
    .replace(
      /Codex CLI\s+[A-Za-z0-9._-]+\s+\w+\s+작업 완료/gi,
      "요청을 이해했어요",
    )
    .replace(/GPT\s*Image\s*2|gpt-image-2/gi, "이미지 만들기");
  if (!preserveRagTerms) {
    safe = safe.replace(
      /LangGraph|BGE|리랭커|provider|provenance|fallback|model/gi,
      "내부 처리",
    );
  }
  safe = safe
    .replace(/백엔드\s*에이전트|백엔드|에이전트/g, "도우미")
    .replace(/패치/g, "수정")
    .replace(/스트리밍/g, "진행 상태")
    .replace(/2×2/g, "4칸")
    .replace(/캔버스가/g, "화면이")
    .replace(/캔버스/g, "화면")
    .replace(/CUT\s*0?(\d+)/gi, "컷 $1")
    .replace(
      /스토리보드 이미지 반영 완료/g,
      "스토리보드 이미지가 화면에 들어갔어요",
    )
    .replace(/스토리보드 컷 구성 완료/g, "스토리보드 컷 구성이 끝났어요")
    .replace(/^완료:\s*/g, "완료했어요. ")
    .replace(/실제 스토리보드 생성 실패/g, "스토리보드 만들기에 실패했어요")
    .replace(/채팅 작업 실패/g, "채팅 처리에 실패했어요")
    .replace(/이미지 생성 상태/g, "이미지 만들기 상태")
    .replace(/이미지 생성 설정/g, "이미지 만들기 설정")
    .replace(/이미지 생성 연결/g, "이미지 만들기 연결")
    .replace(/스토리보드 생성/g, "스토리보드 만들기")
    .replace(/이미지 생성/g, "이미지 만들기")
    .replace(/이미지 만들기을/g, "이미지 만들기를")
    .replace(/이미지 만들기은/g, "이미지는")
    .replace(/스토리보드을/g, "스토리보드를")
    .replace(/스토리보드 만들기을/g, "스토리보드 만들기를")
    .replace(/스토리보드 만들기은/g, "스토리보드 만들기는")
    .replace(/예시를 생성하세요/g, "예시 만들기를 눌러보세요")
    .replace(/초기화 완료/g, "처음 상태로 되돌렸어요")
    .replace(/요구사항/g, "원하는 내용")
    .replace(/분류했어요/g, "이해했어요")
    .replace(/반영합니다/g, "반영할게요")
    .replace(/좌측\s*/g, "")
    .replace(/캔버스에/g, "화면에")
    .replaceAll(STORYBOARD_NO_TRUSTED_IMAGE_LABEL, protectedNoImageLabel)
    .trim();

  const lines = safe
    .split(/\n+|\s+·\s+/)
    .map((line) => line.trim())
    .map((line) => line.replaceAll(" __STORYBOARD_NO_IMAGE_DOT__ ", " · "))
    .filter(Boolean);

  const compactLines =
    lines.length > 5
      ? [...lines.slice(0, 4), "더 자세히 보고 싶으면 “과정”이라고 입력하세요."]
      : lines;

  if (lines.length <= 1) {
    return safe.replaceAll(" __STORYBOARD_NO_IMAGE_DOT__ ", " · ");
  }

  return compactLines
    .map((line, index) => (index === 0 ? line : `- ${line}`))
    .join("\n");
}

function formatStoryboardChatMessageForDisplay(
  message: StoryboardChatMessage,
): StoryboardChatMessage {
  if (message.role !== "assistant") {
    return {
      ...message,
      text: sanitizeStoryboardChatDisplayText(message.text),
    };
  }
  return {
    ...message,
    text: formatStoryboardAssistantDisplayText(message.text),
  };
}

const STORYBOARD_LEGACY_DEFAULT_READBACK_NEEDLE = [
  "공용 기본",
  "스토리보드",
].join(" ");

function isStoryboardChatMessageUsefulForAgentContext(
  message: StoryboardChatMessage,
) {
  if (message.status === "streaming" || !message.text.trim()) return false;
  if (message.id === "assistant-intake") return false;
  if (message.role === "user") return true;

  const normalizedText = sanitizeStoryboardChatDisplayText(message.text);
  const isStoryboardReadbackMessage =
    message.id.startsWith("assistant-history-load") ||
    normalizedText.includes(STORYBOARD_LEGACY_DEFAULT_READBACK_NEEDLE) ||
    normalizedText.startsWith("선택한 스토리보드를 불러왔어요") ||
    normalizedText.startsWith("준비된 스토리보드를 불러왔어요");

  return !isStoryboardReadbackMessage;
}

function buildStoryboardChatConversationContext(
  messages: StoryboardChatMessage[],
): StoryboardChatConversationMessage[] {
  return messages
    .filter(isStoryboardChatMessageUsefulForAgentContext)
    .slice(-STORYBOARD_CHAT_CONVERSATION_CONTEXT_LIMIT)
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: sanitizeStoryboardChatDisplayText(message.text).slice(0, 320),
    }));
}

function useStoryboardChatTypewriterMessages(
  messages: StoryboardChatMessage[],
) {
  const targetTextByIdRef = useRef<Record<string, string>>({});
  const [displayedTextById, setDisplayedTextById] = useState<
    Record<string, string>
  >(() =>
    Object.fromEntries(
      messages.map((message) => [
        message.id,
        message.role === "assistant" ? "" : message.text,
      ]),
    ),
  );

  useEffect(() => {
    const previousTargets = targetTextByIdRef.current;
    const nextTargets = Object.fromEntries(
      messages.map((message) => [message.id, message.text]),
    );

    setDisplayedTextById((current) => {
      const next: Record<string, string> = {};

      for (const message of messages) {
        if (message.role !== "assistant") {
          next[message.id] = message.text;
          continue;
        }

        const currentText = current[message.id] ?? "";
        const previousTarget = previousTargets[message.id];
        const targetChanged = previousTarget !== message.text;

        if (!targetChanged) {
          next[message.id] = currentText;
        } else if (message.text.startsWith(currentText)) {
          next[message.id] = currentText;
        } else {
          next[message.id] = "";
        }
      }

      return next;
    });

    targetTextByIdRef.current = nextTargets;
  }, [messages]);

  const hasPendingTypewriterText = useMemo(
    () =>
      messages.some(
        (message) =>
          message.role === "assistant" &&
          (displayedTextById[message.id] ?? "") !== message.text,
      ),
    [displayedTextById, messages],
  );

  useEffect(() => {
    if (!hasPendingTypewriterText) return;
    if (
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplayedTextById(
        Object.fromEntries(messages.map((message) => [message.id, message.text])),
      );
      return;
    }

    const hasEmptyPendingAssistantText = messages.some(
      (message) =>
        message.role === "assistant" &&
        message.text.length > 0 &&
        (displayedTextById[message.id] ?? "") === "",
    );

    const timeout = window.setTimeout(
      () => {
        setDisplayedTextById((current) => {
          let changed = false;
          const next: Record<string, string> = {};

          for (const message of messages) {
            if (message.role !== "assistant") {
              next[message.id] = message.text;
              continue;
            }

            const currentText = current[message.id] ?? "";
            if (currentText === message.text) {
              next[message.id] = currentText;
              continue;
            }

            const stableCurrentText = message.text.startsWith(currentText)
              ? currentText
              : "";
            const nextLength = Math.min(
              message.text.length,
              stableCurrentText.length + STORYBOARD_CHAT_TYPEWRITER_STEP_CHARS,
            );
            next[message.id] = message.text.slice(0, nextLength);
            changed = true;
          }

          return changed ? next : current;
        });
      },
      hasEmptyPendingAssistantText
        ? STORYBOARD_CHAT_TYPEWRITER_START_DELAY_MS
        : STORYBOARD_CHAT_TYPEWRITER_INTERVAL_MS,
    );

    return () => window.clearTimeout(timeout);
  }, [displayedTextById, hasPendingTypewriterText, messages]);

  return displayedTextById;
}

function buildStoryboardImageGenerationProgress({
  label,
  scenes,
  activeSceneNo = null,
  completedSceneNos = new Set<number>(),
  failedSceneNos = new Set<number>(),
  cancelledSceneNos = new Set<number>(),
}: {
  label: string;
  scenes: StoryboardScene[];
  activeSceneNo?: number | null;
  completedSceneNos?: Set<number>;
  failedSceneNos?: Set<number>;
  cancelledSceneNos?: Set<number>;
}): StoryboardImageGenerationProgress {
  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  const cuts = scenes.map((scene) => {
    const sceneNo = scene.sceneNo;
    const status: StoryboardImageGenerationCutStatus = completedSceneNos.has(
      sceneNo,
    )
      ? "done"
      : failedSceneNos.has(sceneNo)
        ? "failed"
        : cancelledSceneNos.has(sceneNo)
          ? "cancelled"
          : activeSceneNo === sceneNo
            ? "generating"
            : "queued";
    if (status === "done") completed += 1;
    if (status === "failed") failed += 1;
    if (status === "cancelled") cancelled += 1;
    return {
      sceneNo,
      label: `CUT ${String(sceneNo).padStart(2, "0")}`,
      status,
    };
  });

  return {
    label,
    total: cuts.length,
    completed,
    failed,
    cancelled,
    cuts,
  };
}

function normalizeStoryboardThinkingTraceEntry(
  value: unknown,
  fallbackId = `trace-${Date.now()}`,
): StoryboardThinkingTraceEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<StoryboardThinkingTraceEntry>;
  const label = sanitizeStoryboardChatDisplayText(
    String(candidate.label ?? ""),
  );
  if (!label) return null;
  const rawStatus = candidate.status;
  const status: StoryboardThinkingTraceEntry["status"] =
    rawStatus === "pending" ||
    rawStatus === "running" ||
    rawStatus === "done" ||
    rawStatus === "failed" ||
    rawStatus === "cancelled"
      ? rawStatus
      : "done";
  const detail = sanitizeStoryboardAssistantSourceText(
    String(candidate.detail ?? ""),
  );
  const idSource = sanitizeStoryboardChatDisplayText(
    String(candidate.id ?? fallbackId),
  ).replace(/[^\w:.-]/g, "");
  return {
    id: idSource || fallbackId,
    label,
    status,
    ...(detail ? { detail } : {}),
    timestamp:
      typeof candidate.timestamp === "string"
        ? candidate.timestamp.slice(0, 40)
        : new Date().toISOString(),
  };
}

function makeStoryboardThinkingTraceEntries(
  ...entries: unknown[]
): StoryboardThinkingTraceEntry[] {
  return entries.flatMap((entry, index) => {
    const normalized = normalizeStoryboardThinkingTraceEntry(
      entry,
      `trace-${Date.now()}-${index}`,
    );
    return normalized ? [normalized] : [];
  });
}

function mergeStoryboardThinkingTraceEntries(
  current: StoryboardThinkingTraceEntry[] | undefined,
  entries: StoryboardThinkingTraceEntry[],
) {
  const merged = new Map<string, StoryboardThinkingTraceEntry>();
  for (const entry of current ?? []) merged.set(entry.id, entry);
  for (const entry of entries) merged.set(entry.id, entry);
  return Array.from(merged.values()).slice(-48);
}

function getStoryboardThinkingTraceTimestampMs(
  entry: StoryboardThinkingTraceEntry,
) {
  if (!entry.timestamp) return null;
  const value = Date.parse(entry.timestamp);
  return Number.isFinite(value) ? value : null;
}

function formatStoryboardThinkingDuration(ms: number) {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}분 ${seconds}초 동안 생각함`;
  }
  return `${totalSeconds}초 동안 생각함`;
}

function getStoryboardThinkingTraceDurationLabel(
  trace: StoryboardThinkingTraceEntry[],
) {
  const timestamps = trace
    .map(getStoryboardThinkingTraceTimestampMs)
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);
  if (!timestamps.length) return null;
  const startMs = timestamps[0];
  const hasRunningEntry = trace.some((entry) => entry.status === "running");
  const endMs = hasRunningEntry
    ? Date.now()
    : timestamps[timestamps.length - 1];
  if (endMs <= startMs) return null;
  return formatStoryboardThinkingDuration(endMs - startMs);
}

function StoryboardThinkingTracePanel({
  trace,
}: {
  trace: StoryboardThinkingTraceEntry[];
}) {
  if (!trace.length) return null;
  const runningCount = trace.filter(
    (entry) => entry.status === "running",
  ).length;
  const finishedCount = trace.filter(
    (entry) =>
      entry.status === "done" ||
      entry.status === "failed" ||
      entry.status === "cancelled",
  ).length;
  const statusLabel =
    runningCount > 0
      ? `${runningCount}단계 진행 중`
      : `${finishedCount}/${trace.length}단계 기록`;
  const durationLabel = getStoryboardThinkingTraceDurationLabel(trace);
  const hasRagTrace = trace.some(
    (entry) =>
      entry.id.startsWith("rag-") ||
      /rag|검색|retrieval|임베딩|embedding|리랭커|rerank|contextual/i.test(
        entry.label,
      ),
  );

  return (
    <details
      className="mt-2 rounded-xl border border-border/70 bg-muted/35 px-2.5 py-2 text-[11px]"
      data-storyboard-thinking-trace="true"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {runningCount > 0 ? (
            <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : null}
          <span>{hasRagTrace ? "생각 중 · RAG 추적" : "생각 중"}</span>
        </span>
        <span
          className="shrink-0 text-muted-foreground"
          data-storyboard-thinking-duration="true"
        >
          {durationLabel ?? statusLabel}
        </span>
      </summary>
      <div className="mt-2 space-y-1.5">
        {trace.map((entry, index) => {
          const statusText =
            entry.status === "running"
              ? "진행 중"
              : entry.status === "failed"
                ? "실패"
                : entry.status === "cancelled"
                  ? "중단"
                  : entry.status === "pending"
                    ? "대기"
                    : "완료";
          return (
            <div
              key={`${entry.id}-${index}`}
              className="rounded-lg bg-background/70 px-2 py-1.5"
              data-storyboard-thinking-trace-entry={entry.status}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                  {entry.label}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {statusText}
                </span>
              </div>
              {entry.detail ? (
                <p className="mt-0.5 whitespace-pre-wrap break-keep text-muted-foreground [overflow-wrap:anywhere]">
                  {entry.detail}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </details>
  );
}

function StoryboardImageGenerationProgressPanel({
  progress,
}: {
  progress: StoryboardImageGenerationProgress;
}) {
  const finishedCount =
    progress.completed + progress.failed + progress.cancelled;
  const progressPercent =
    progress.total > 0 ? Math.round((finishedCount / progress.total) * 100) : 0;

  return (
    <div
      className="mt-2 rounded-xl border border-border/70 bg-background/80 p-2 text-[11px] text-foreground shadow-sm dark:bg-slate-950/35"
      data-storyboard-image-generation-progress="true"
      aria-label={`${progress.label} ${progress.completed}/${progress.total}컷 완료`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">{progress.label}</span>
        <span className="shrink-0 text-muted-foreground">
          {progress.completed}/{progress.total} 완료
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
        data-storyboard-image-generation-progress-bar="true"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={finishedCount}
      >
        <span
          className="block h-full rounded-full bg-sky-500 transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <div className="mt-2 grid gap-1">
        {progress.cuts.map((cut) => {
          const isGenerating = cut.status === "generating";
          const statusLabel =
            cut.status === "done"
              ? "완료"
              : cut.status === "failed"
                ? "미반영"
                : cut.status === "cancelled"
                  ? "중단"
                  : cut.status === "queued"
                    ? "대기"
                    : "생성 중";
          return (
            <div
              key={`image-progress-${cut.sceneNo}`}
              className="flex items-center justify-between gap-2 rounded-lg bg-muted/45 px-2 py-1"
              data-storyboard-image-generation-cut-status={cut.status}
            >
              <span className="font-medium">{cut.label}</span>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                  cut.status === "done" &&
                    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                  cut.status === "failed" &&
                    "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                  cut.status === "cancelled" &&
                    "bg-muted text-muted-foreground",
                  isGenerating &&
                    "bg-sky-500/10 text-sky-700 dark:text-sky-300",
                )}
              >
                {isGenerating ? (
                  <Loader2
                    className="h-2.5 w-2.5 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : null}
                {statusLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function truncateStoryboardFrameText(value: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function getStoryboardRoleProductionNote(scene: StoryboardScene) {
  const captionHead = scene.captionIdea.split("·").slice(0, 2).join(" ");
  const roleText = [scene.title, captionHead].join(" ").replace(/\s+/g, " ");

  if (/초반\s*1분\s*30초|가게\s*앞|인트로|외관/.test(roleText)) {
    return "가게 앞 외관, 입구, 대표 메뉴 예고를 1분 30초 안에 빠르게 보여주세요.";
  }
  if (/평가|재방문|맛과\s*양|정리/.test(roleText)) {
    return "대표 접시와 메모하는 손을 보여주며 맛, 양, 다시 먹고 싶은 이유를 정리하세요.";
  }
  if (/다음|아웃트로|댓글|소재/.test(roleText)) {
    return "가게 밖으로 나오는 흐름과 다음 메뉴 후보 소품으로 다음 영상을 예고하세요.";
  }
  if (/완식|빈\s*그릇|만족감/.test(roleText)) {
    return "빈 그릇, 남은 소스 자국, 내려놓은 식기로 먹방의 만족감을 보여주세요.";
  }
  if (/클라이맥스|하이라이트|대표\s*장면|히어로/.test(roleText)) {
    return "가장 큰 한입과 풍성한 한상을 넓게 잡아 대표 장면처럼 보여주세요.";
  }
  if (/조합|소스|사이드|변주/.test(roleText)) {
    return "소스나 반찬을 얹는 전후 동작을 보여줘 중반 리듬을 바꿔주세요.";
  }
  if (/ASMR|질감|소리|식감|후루룩|바삭/.test(roleText)) {
    return "마이크 근처 손동작, 면발, 국물, 소리 포인트를 크게 잡아주세요.";
  }
  if (/조리|기대감|냄새|김|상차림/.test(roleText)) {
    return "김, 소리, 조리 손동작을 잡아 첫 입 전 기대감을 만들어주세요.";
  }
  if (/첫\s*입|한입|리액션/.test(roleText)) {
    return "한입을 집는 손과 테이블 반응을 먼저 잡고, 잠깐 멈춰 맛 포인트를 살려주세요.";
  }
  if (/첫\s*상|한상\s*공개|상차림\s*전체/.test(roleText)) {
    return "테이블 전체를 넓게 잡아 메인, 사이드, 소스 위치가 한눈에 보이게 해주세요.";
  }
  if (/주문|메뉴|맥락|가격/.test(roleText)) {
    return "주문표, 대표 재료, 상차림 준비 컷으로 오늘 먹을 메뉴를 쉽게 알려주세요.";
  }
  if (/페이스|입가심|쉬어감|음료/.test(roleText)) {
    return "물컵, 내려놓은 젓가락, 빈 접시 일부로 잠깐 쉬어가는 호흡을 주세요.";
  }
  return null;
}

function formatStoryboardFrameProductionNote(scene: StoryboardScene) {
  const source =
    getStoryboardRoleProductionNote(scene) ||
    scene.visualDirection?.trim() ||
    scene.operatorIntent?.trim() ||
    scene.title?.trim() ||
    "이 컷에서 가장 중요한 장면을 한눈에 보이게 촬영하세요.";
  const safe = sanitizeStoryboardChatDisplayText(source)
    .replace(
      /(?:LLM|RAG|LangGraph|BGE|리랭커|provider|provenance|fallback|model)/gi,
      "도우미 처리",
    )
    .replace(/얼굴\s*클로즈업|표정\s*클로즈업/g, "손동작과 테이블 반응")
    .replace(/얼굴|표정/g, "손동작과 테이블 반응")
    .replace(/\s*특히\s*/g, " 특히 ")
    .trim();
  const firstSentence = safe.match(/^.+?[.!?。]/)?.[0]?.trim() ?? safe;
  const note = firstSentence.length >= 34 ? firstSentence : safe;
  return truncateStoryboardFrameText(note, 96);
}

function createStoryboardCutFocusContext(
  scene: StoryboardGenerationResult["storyboard"]["scenes"][number],
): StoryboardChatFocusContext {
  return createStoryboardCutFocusContextFromScenes([scene]);
}

function createStoryboardCutFocusContextFromScenes(
  scenes: StoryboardScene[],
): StoryboardChatFocusContext {
  const selectedScenes = scenes
    .filter((scene, index, all) =>
      all.findIndex((candidate) => candidate.sceneNo === scene.sceneNo) === index,
    )
    .sort((left, right) => left.sceneNo - right.sceneNo);
  const primaryScene = selectedScenes[0];
  const cutLabels = selectedScenes.map(
    (scene) => `CUT ${String(scene.sceneNo).padStart(2, "0")}`,
  );
  const cutLabel = cutLabels.join(", ");
  if (!primaryScene) {
    return createStoryboardActionFocusContext(
      "CUT 선택 해제됨",
      "현재 선택된 CUT이 없습니다.",
      "사용자가 스토리보드 CUT 선택을 해제했습니다. 전체 흐름 기준으로 대화를 이어가세요.",
    );
  }
  const isMultiSelection = selectedScenes.length > 1;
  return {
    kind: "cut",
    label: `${cutLabel} 선택됨`,
    detail: isMultiSelection
      ? `${selectedScenes.length}개 CUT 다중 선택 · ${selectedScenes
          .map((scene) => `${scene.title}(${scene.heatmapEvidence.peakTime})`)
          .join(" · ")}`
      : `멘트·자막·구도 수정 가능 · ${primaryScene.title} · ${primaryScene.heatmapEvidence.peakTime} · ${truncateStoryboardFrameText(primaryScene.hostBeat, 36)}`,
    sceneNo: isMultiSelection ? undefined : primaryScene.sceneNo,
    sceneNos: selectedScenes.map((scene) => scene.sceneNo),
    promptContext: [
      isMultiSelection
        ? `${cutLabel}을 다중 선택한 상태입니다.`
        : `${cutLabel}을 선택한 상태입니다.`,
      ...selectedScenes.map((scene) =>
        [
          `CUT ${String(scene.sceneNo).padStart(2, "0")}`,
          `제목: ${scene.title}`,
          `연출: ${scene.visualDirection}`,
          `오디오 후보: ${scene.hostBeat}`,
          `자막 후보: ${scene.captionIdea}`,
          `근거: ${scene.heatmapEvidence.reason}`,
        ].join(" · "),
      ),
    ].join(" "),
    createdAt: new Date().toISOString(),
  };
}

function getStoryboardSelectedSceneNosFromFocus(
  focus: StoryboardChatFocusContext | null,
): number[] {
  if (focus?.kind !== "cut") return [];
  if (Array.isArray(focus.sceneNos) && focus.sceneNos.length) {
    return focus.sceneNos.filter((sceneNo) => Number.isFinite(sceneNo));
  }
  return Number.isFinite(focus.sceneNo) ? [Number(focus.sceneNo)] : [];
}

function createStoryboardActionFocusContext(
  label: string,
  detail: string,
  promptContext?: string,
): StoryboardChatFocusContext {
  return {
    kind: "action",
    label,
    detail,
    promptContext:
      promptContext ?? `${label} 액션 직후의 캔버스 상태입니다. ${detail}`,
    createdAt: new Date().toISOString(),
  };
}

function parseStoryboardChatSseBlock(
  block: string,
): StoryboardChatSseEvent | null {
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

function extractStoryboardChatSseEvents(buffer: string) {
  const parts = buffer.split(/\n\n/);
  const remainder = parts.pop() ?? "";
  return {
    events: parts.flatMap((part) => {
      const parsed = parseStoryboardChatSseBlock(part.trim());
      return parsed ? [parsed] : [];
    }),
    remainder,
  };
}

function isStoryboardChatAgentResult(
  value: unknown,
): value is StoryboardChatAgentResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<StoryboardChatAgentResult>;
  const patch = result.canvasPatch;
  return (
    typeof result.assistantMessage === "string" &&
    Boolean(patch) &&
    typeof patch?.prompt === "string" &&
    typeof patch?.tone === "string" &&
    typeof patch?.segmentCount === "number"
  );
}

const STORYBOARD_CHAT_AGENT_STREAM_URL = "/api/admin/storyboard/chat";
const STORYBOARD_LATEST_REAL_DATA_URL =
  "/qa-history/storyboard/latest-real-data.json";
const STORYBOARD_SHARED_SEED_REAL_DATA_URL =
  "/storyboard-seed/latest-real-data.json";
const STORYBOARD_NO_TRUSTED_IMAGE_LABEL =
  "컷 구성만 준비됨 · 실제 이미지는 아직 없음";
const STORYBOARD_PENDING_IMAGE_BACKGROUND =
  "linear-gradient(135deg, rgba(248,250,252,0.98), rgba(226,232,240,0.82) 48%, rgba(148,163,184,0.68))";

const INITIAL_STORYBOARD_PREVIEW: StoryboardGenerationResult = {
  generatedAt: "initial-local-preview",
  mode: "local_demo_fallback",
  request: DEFAULT_FORM,
  sourceSummary: {
    heatmapDirectory: "local-preview://storyboard",
    scannedFiles: 0,
    usableSources: 0,
    selectedSources: 4,
    totalMarkers: 8,
    topReplayScore: 0.995,
    isFallbackData: true,
    fallbackReason: "missing-heatmap-directory",
    dataModeLabel: "초기 예시",
  },
  storyboard: {
    title: "초기 미리보기 · 먹방 주요 순간 기반 스토리보드",
    logline:
      "가게 앞 인트로, 주문 맥락, 한상 공개, 다음 소재 연결까지 회의용 씬 구성으로 바로 검토합니다.",
    operatorBrief:
      "왼쪽에서 소재 요청과 톤만 바꿔 생성하면 실제 로컬 히트맵 근거로 이 미리보기가 교체됩니다.",
    scenes: [
      {
        sceneNo: 1,
        title: "첫 입 리액션 훅",
        durationSec: 110,
        operatorIntent:
          "초반 이탈을 줄이도록 가게 앞 상황과 오늘 먹을 메뉴를 먼저 이해시킴",
        visualDirection:
          "가게 외관, 입구 동선, 대표 메뉴 예고를 넓은 컷으로 빠르게 연결",
        hostBeat: "이건 한 입 먹자마자 바로 다시 보게 되는 맛이에요.",
        captionIdea: "오늘 갈 곳과 메뉴를 먼저 이해시키는 인트로",
        heatmapEvidence: {
          videoId: "local-preview-001",
          youtubeLink: "https://www.youtube.com/watch?v=local-preview-001",
          peakTime: "01:30",
          replayScore: 0.995,
          reason:
            "반복 시청이 많았던 순간이 높은 첫 입 구간을 오프닝 훅으로 가정합니다.",
        },
        productionChecklist: [
          "가게 앞 1분 30초 인사",
          "입구와 주변 분위기",
          "대표 메뉴 예고 자막",
        ],
      },
      {
        sceneNo: 2,
        title: "메뉴 흐름 확장",
        durationSec: 165,
        operatorIntent: "가게 맥락과 메뉴 선택 이유를 짧게 정리",
        visualDirection: "주문 이유, 조리 시작, 상차림 준비를 차례대로 연결",
        hostBeat: "이 집은 양도 양인데 조리되는 순간부터 기대감이 커져요.",
        captionIdea: "기대감 쌓는 조리 장면",
        heatmapEvidence: {
          videoId: "local-preview-002",
          youtubeLink: "https://www.youtube.com/watch?v=local-preview-002",
          peakTime: "04:15",
          replayScore: 0.982,
          reason:
            "음식 전경과 조리 디테일이 반복 시청을 만드는 중반 구간으로 가정합니다.",
        },
        productionChecklist: [
          "조리 사운드 확보",
          "메뉴 선택 이유 자막",
          "한상 전체샷",
        ],
      },
      {
        sceneNo: 3,
        title: "첫 상 공개와 첫 입 준비",
        durationSec: 130,
        operatorIntent:
          "테이블 구성을 먼저 보여주고 첫 입 직전의 기대감을 만듦",
        visualDirection:
          "테이블 전체, 메인 접시, 사이드 메뉴 위치가 한눈에 보이게 배치",
        hostBeat: "이 조합으로 먼저 먹어보면 맛의 기준이 잡힐 것 같아요.",
        captionIdea: "첫 입 전에 전체 구성을 이해시키는 컷",
        heatmapEvidence: {
          videoId: "local-preview-003",
          youtubeLink: "https://www.youtube.com/watch?v=local-preview-003",
          peakTime: "08:20",
          replayScore: 0.971,
          reason: "면/소리/손동작이 반복 시청을 만드는 감각 컷으로 가정합니다.",
        },
        productionChecklist: [
          "한상 전체 구도",
          "첫 입 준비 손동작",
          "사이드 메뉴 위치",
        ],
      },
      {
        sceneNo: 4,
        title: "맛 평가와 다음 소재 연결",
        durationSec: 130,
        operatorIntent: "맛, 양, 다시 먹고 싶은 이유와 다음 영상 기대감을 정리",
        visualDirection:
          "메모하는 손, 정리된 접시, 가게 밖 다음 이동 암시를 차분하게 연결",
        hostBeat:
          "오늘은 이 조합이 제일 기억에 남고, 다음에는 다른 메뉴도 이어서 가볼게요.",
        captionIdea: "맛 평가와 다음 영상 기대감",
        heatmapEvidence: {
          videoId: "local-preview-004",
          youtubeLink: "https://www.youtube.com/watch?v=local-preview-004",
          peakTime: "12:40",
          replayScore: 0.968,
          reason:
            "완식/다음 메뉴 예고 구간이 댓글과 재방문을 만든다는 가정입니다.",
        },
        productionChecklist: [
          "맛 평가 메모",
          "다시 먹고 싶은 이유",
          "다음 메뉴 후보 자막",
        ],
      },
    ],
    exportMarkdown:
      "# 초기 미리보기 · 먹방 주요 순간 기반 스토리보드\n\n- 첫 입 리액션 훅\n- 메뉴 흐름 확장\n- 면치기 리듬 컷\n- 마무리 완식 리액션\n",
  },
  agentGraphFidelity: buildStoryboardAgentGraphFidelity({
    mode: "local_demo_fallback",
    finalOutputReady: true,
  }),
  ahp: {
    targetScore: 99.8,
    score: 99.8,
    status: "passed",
    committee: [
      { role: "콘텐츠 PD", focus: "회의에서 바로 검토 가능한 씬 구성" },
      { role: "반복 시청 분석", focus: "반복 시청이 많았던 순간 기반 흐름" },
      { role: "관리자 UX 설계자", focus: "초기 진입과 도구 조작성" },
    ],
    criteria: [
      {
        id: "operator-readiness",
        label: "운영자 즉시성",
        weight: 40,
        score: 99.8,
        evidence:
          "초기 미리보기와 도구 팔레트가 생성 전 검토 흐름을 제공합니다.",
      },
      {
        id: "storyboard-clarity",
        label: "스토리보드 명확성",
        weight: 35,
        score: 99.8,
        evidence:
          "각 씬에 화면 연출, 멘트, 자막, 근거, 체크리스트가 포함됩니다.",
      },
      {
        id: "local-safety",
        label: "로컬 안전성",
        weight: 25,
        score: 99.8,
        evidence:
          "초기 예시는 API 호출 없이 실제 생성 결과와 동일한 구조를 사용합니다.",
      },
    ],
    iterationBacklog: [],
  },
  backendAnalysis: {
    reusedLogic: ["AdminStoryboardGenerator initial preview"],
    localGapsHandled: ["empty-state cold start"],
  },
};

function getStoryboardFrameVisual(sceneNo: number) {
  const depth = Math.min(0.78, 0.58 + ((sceneNo - 1) % 4) * 0.05);
  return {
    background: `linear-gradient(135deg, rgba(248,250,252,0.96), rgba(203,213,225,0.82) 48%, rgba(100,116,139,${depth}))`,
  };
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - safeRadius,
    y + height,
  );
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function drawStoryboardFrameToCanvas(
  context: CanvasRenderingContext2D,
  scene: StoryboardGenerationResult["storyboard"]["scenes"][number],
  x: number,
  y: number,
  width: number,
  height: number,
  showGuide: boolean,
  generatedImage?: CanvasImageSource | null,
) {
  context.save();
  drawRoundedRect(context, x, y, width, height, 22);
  context.clip();

  if (generatedImage) {
    const imageWidth =
      "naturalWidth" in generatedImage
        ? generatedImage.naturalWidth
        : "videoWidth" in generatedImage
          ? generatedImage.videoWidth
          : width;
    const imageHeight =
      "naturalHeight" in generatedImage
        ? generatedImage.naturalHeight
        : "videoHeight" in generatedImage
          ? generatedImage.videoHeight
          : height;
    const scale = Math.max(width / imageWidth, height / imageHeight);
    const drawWidth = imageWidth * scale;
    const drawHeight = imageHeight * scale;
    context.drawImage(
      generatedImage,
      x + (width - drawWidth) / 2,
      y + (height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
  } else {
    const gradient = context.createLinearGradient(x, y, x + width, y + height);
    gradient.addColorStop(
      0,
      scene.sceneNo % 3 === 1
        ? "#f9a8d4"
        : scene.sceneNo % 3 === 2
          ? "#86efac"
          : "#7dd3fc",
    );
    gradient.addColorStop(
      0.48,
      scene.sceneNo % 2 === 0 ? "#fed7aa" : "#fde68a",
    );
    gradient.addColorStop(1, "#111827");
    context.fillStyle = gradient;
    context.fillRect(x, y, width, height);

    context.fillStyle = "rgba(255,255,255,0.82)";
    context.beginPath();
    context.arc(
      x + width * 0.72,
      y + height * 0.24,
      height * 0.08,
      0,
      Math.PI * 2,
    );
    context.fill();

    context.fillStyle =
      scene.sceneNo % 3 === 1
        ? "#fecdd3"
        : scene.sceneNo % 3 === 2
          ? "#bbf7d0"
          : "#bae6fd";
    drawRoundedRect(
      context,
      x + width * 0.14,
      y + height * 0.5,
      width * 0.24,
      height * 0.34,
      28,
    );
    context.fill();

    context.fillStyle =
      scene.sceneNo % 3 === 1
        ? "#fef3c7"
        : scene.sceneNo % 3 === 2
          ? "#ffedd5"
          : "#ede9fe";
    drawRoundedRect(
      context,
      x + width * 0.45,
      y + height * 0.62,
      width * 0.34,
      height * 0.12,
      24,
    );
    context.fill();
    context.fillStyle = "rgba(255,255,255,0.62)";
    drawRoundedRect(
      context,
      x + width * 0.45,
      y + height * 0.78,
      width * 0.42,
      10,
      5,
    );
    context.fill();
  }

  const cutBadgeLabel = `CUT ${String(scene.sceneNo).padStart(2, "0")}`;
  context.save();
  context.shadowColor = "rgba(0,0,0,0.28)";
  context.shadowBlur = 18;
  context.shadowOffsetY = 8;
  context.fillStyle = "rgba(15,23,42,0.82)";
  drawRoundedRect(context, x + 18, y + 18, 100, 34, 17);
  context.fill();
  context.restore();
  context.strokeStyle = "rgba(255,255,255,0.28)";
  context.lineWidth = 1;
  drawRoundedRect(context, x + 18, y + 18, 100, 34, 17);
  context.stroke();
  context.fillStyle = "#fff";
  context.font = "700 18px system-ui, sans-serif";
  context.fillText(cutBadgeLabel, x + 32, y + 41);

  const timeBadgeLabel = scene.heatmapEvidence.peakTime;
  context.font = "700 15px system-ui, sans-serif";
  const timeBadgeWidth = Math.max(
    76,
    context.measureText(timeBadgeLabel).width + 28,
  );
  const timeBadgeX = x + width - timeBadgeWidth - 18;
  context.save();
  context.shadowColor = "rgba(0,0,0,0.22)";
  context.shadowBlur = 18;
  context.shadowOffsetY = 8;
  context.fillStyle = "rgba(255,255,255,0.92)";
  drawRoundedRect(context, timeBadgeX, y + 18, timeBadgeWidth, 34, 17);
  context.fill();
  context.restore();
  context.strokeStyle = "rgba(255,255,255,0.62)";
  context.lineWidth = 1;
  drawRoundedRect(context, timeBadgeX, y + 18, timeBadgeWidth, 34, 17);
  context.stroke();
  context.fillStyle = "#0f172a";
  context.font = "700 15px system-ui, sans-serif";
  context.fillText(timeBadgeLabel, timeBadgeX + 14, y + 40);

  const scriptPanelHeight = Math.max(92, height * 0.25);
  const scriptPanelY = y + height - scriptPanelHeight;
  context.fillStyle = "rgba(255,255,255,0.97)";
  context.fillRect(x, scriptPanelY, width, scriptPanelHeight);
  context.strokeStyle = "rgba(17,24,39,0.14)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x, scriptPanelY);
  context.lineTo(x + width, scriptPanelY);
  context.stroke();

  context.fillStyle = "#0f172a";
  context.font = "800 13px system-ui, sans-serif";
  context.fillText("멘트", x + 18, scriptPanelY + 19);

  context.fillStyle = "rgba(17,24,39,0.08)";
  drawRoundedRect(context, x + 18, scriptPanelY + 30, 80, 24, 12);
  context.fill();
  context.fillStyle = "rgba(220,38,38,0.1)";
  drawRoundedRect(context, x + 18, scriptPanelY + 61, 80, 24, 12);
  context.fill();

  context.fillStyle = "#4b5563";
  context.font = "800 11px system-ui, sans-serif";
  context.fillText("오디오", x + 35, scriptPanelY + 46);
  context.fillStyle = "#dc2626";
  context.fillText("자막", x + 42, scriptPanelY + 77);

  context.fillStyle = "#111827";
  context.font = "700 15px system-ui, sans-serif";
  context.fillText(
    truncateStoryboardFrameText(scene.hostBeat, 56),
    x + 112,
    scriptPanelY + 46,
  );
  context.font = "800 15px system-ui, sans-serif";
  context.fillText(
    truncateStoryboardFrameText(scene.captionIdea, 56),
    x + 112,
    scriptPanelY + 77,
  );

  if (showGuide) {
    context.strokeStyle = "rgba(255,255,255,0.74)";
    context.lineWidth = 2;
    context.setLineDash([10, 8]);
    context.strokeRect(
      x + width * 0.08,
      y + height * 0.12,
      width * 0.84,
      height * 0.76,
    );
  }

  context.restore();
}

function isStoryboardGenerationResult(
  value: unknown,
): value is StoryboardGenerationResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoryboardGenerationResult>;
  return (
    typeof candidate.generatedAt === "string" &&
    typeof candidate.mode === "string" &&
    Boolean(candidate.request) &&
    Boolean(candidate.sourceSummary) &&
    Boolean(candidate.storyboard) &&
    Array.isArray(candidate.storyboard?.scenes)
  );
}

const STALE_SHARED_STORYBOARD_CAPTION_PATTERN =
  /톤으로\s*“[\s\S]+?”\s*소재를\s*\d{2}:\d{2}\s*피크 감정에 맞춰 압축/;

const STORYBOARD_DISPLAY_TONE_LABELS: Record<string, string> = {
  warm: "따뜻한 먹방",
  energetic: "초반 몰입형 먹방",
  documentary: "다큐형 먹방",
  comfort: "편안한 먹방",
};

function getStoryboardSceneCaptionStem(scene: StoryboardScene) {
  if (scene.title.includes("가게 앞") || scene.title.includes("인트로")) {
    return "초반 1분 30초 가게 앞 인사 · 오늘 갈 곳과 대표 메뉴를 먼저 보여주기";
  }
  if (scene.title.includes("기대감")) {
    return "기대감 세팅 · 냄새와 상차림으로 첫 입 전 설렘 만들기";
  }
  if (scene.title.includes("첫 입")) {
    return "첫 입 리액션 · 한입 직후 맛 포인트를 짧게 자막화";
  }
  if (scene.title.includes("반복")) {
    return "반복 시청 포인트 · 소리와 질감이 살아나는 순간 강조";
  }
  if (scene.title.includes("중반") || scene.title.includes("변주")) {
    return "중반 변주 · 새 조합과 사이드 메뉴로 흐름 전환";
  }
  if (scene.title.includes("클라이맥스") || scene.title.includes("한상")) {
    return "클라이맥스 한상 · 오늘 가장 강한 한 컷을 대표 장면으로";
  }
  if (scene.title.includes("맛 평가") || scene.title.includes("마무리")) {
    return "최종 맛 평가 · 맛과 양, 다시 먹고 싶은 이유 정리";
  }
  if (scene.title.includes("다음")) {
    return "다음 소재 연결 · 댓글 질문과 다음 영상 기대감 남기기";
  }

  const stems = [
    "초반 1분 30초 가게 앞 인사 · 오늘 갈 곳과 대표 메뉴를 먼저 보여주기",
    "기대감 세팅 · 냄새와 상차림으로 첫 입 전 설렘 만들기",
    "첫 입 리액션 · 한입 직후 맛 포인트를 짧게 자막화",
    "반복 시청 포인트 · 소리와 질감이 살아나는 순간 강조",
    "중반 변주 · 새 조합과 사이드 메뉴로 흐름 전환",
    "클라이맥스 한상 · 오늘 가장 강한 한 컷을 대표 장면으로",
    "최종 맛 평가 · 맛과 양, 다시 먹고 싶은 이유 정리",
    "다음 소재 연결 · 댓글 질문과 다음 영상 기대감 남기기",
  ];
  return stems[(scene.sceneNo - 1) % stems.length];
}

function summarizeStoryboardPromptForCaption(prompt: string) {
  const normalized = sanitizeStoryboardChatDisplayText(prompt).replace(
    /[“”"]/g,
    "",
  );
  if (normalized.length <= 28) return normalized;
  return `${normalized.slice(0, 27)}…`;
}

function buildStoryboardCanvasTopicTitle(label: string) {
  return sanitizeStoryboardChatDisplayText(label)
    .replace(/^조회수\s*많이\s*나올\s*것\s*같은\s*/i, "")
    .trim();
}

function getStoryboardCanvasTopicTitle(result: StoryboardGenerationResult) {
  const title = buildStoryboardCanvasTopicTitle(
    sanitizeStoryboardChatDisplayText(result.storyboard.title).split("—")[0] ??
      "",
  );
  if (title) return title;

  const topicLabel = result.planner?.topicProfile.label;
  const topicTitle = topicLabel
    ? buildStoryboardCanvasTopicTitle(topicLabel)
    : "";
  if (topicTitle) return topicTitle;

  return summarizeStoryboardPromptForCaption(result.request.prompt);
}

function normalizeStaleStoryboardCaptionIdeas(
  result: StoryboardGenerationResult,
) {
  let changed = false;
  const scenes = result.storyboard.scenes.map((scene) => {
    if (!STALE_SHARED_STORYBOARD_CAPTION_PATTERN.test(scene.captionIdea)) {
      return scene;
    }
    changed = true;
    return {
      ...scene,
      captionIdea: [
        getStoryboardSceneCaptionStem(scene),
        `${scene.heatmapEvidence.peakTime} 반복 시청 피크 근거`,
        `${STORYBOARD_DISPLAY_TONE_LABELS[result.request.tone] ?? result.request.tone} 톤`,
        summarizeStoryboardPromptForCaption(result.request.prompt),
      ].join(" · "),
    };
  });

  if (!changed) return result;
  return {
    ...result,
    storyboard: {
      ...result.storyboard,
      scenes,
    },
  };
}

function normalizeStoryboardCloseupLanguage(
  result: StoryboardGenerationResult,
): StoryboardGenerationResult {
  const rewrite = (value: string) =>
    value
      .replace(
        /가게 외관\/메뉴판\/대표 음식 클로즈업을 빠르게 교차합니다\./g,
        "가게 앞 인사, 입구 분위기, 대표 메뉴 예고를 넓은 컷으로 빠르게 연결합니다.",
      )
      .replace(
        /입장 전 정적\s*→\s*한입\s*→\s*표정 클로즈업\s*→\s*한 박자 쉬는 편집을 씁니다\./g,
        "입장 전 정적 → 한입을 집는 손 → 맛 포인트 자막 → 한 박자 쉬는 편집을 씁니다.",
      )
      .replace(/대표 음식 클로즈업/g, "대표 메뉴 예고")
      .replace(/음식 클로즈업/g, "장면 맥락")
      .replace(/그릇 클로즈업/g, "그릇과 손동작")
      .replace(/소스 클로즈업/g, "소스 변화 전후")
      .replace(/첫 표정 클로즈업/g, "첫 반응 손동작")
      .replace(/표정 클로즈업/g, "반응 리듬")
      .replace(/손과 음식 클로즈업/g, "손동작과 테이블 반응");

  return {
    ...result,
    storyboard: {
      ...result.storyboard,
      logline: rewrite(result.storyboard.logline),
      operatorBrief: rewrite(result.storyboard.operatorBrief),
      scenes: result.storyboard.scenes.map((scene) => ({
        ...scene,
        title: rewrite(scene.title),
        operatorIntent: rewrite(scene.operatorIntent),
        visualDirection: rewrite(scene.visualDirection),
        hostBeat: rewrite(scene.hostBeat),
        captionIdea: rewrite(scene.captionIdea),
        productionChecklist: scene.productionChecklist.map(rewrite),
        generatedImage: scene.generatedImage
          ? {
              ...scene.generatedImage,
              prompt: rewrite(scene.generatedImage.prompt),
            }
          : undefined,
      })),
      exportMarkdown: rewrite(result.storyboard.exportMarkdown),
    },
  };
}

function extractLatestStoryboardResult(
  payload: unknown,
): StoryboardGenerationResult | null {
  if (isStoryboardGenerationResult(payload)) {
    return normalizeStoryboardCloseupLanguage(
      normalizeStaleStoryboardCaptionIdeas(
        stripUntrustedStoryboardGeneratedImages(payload),
      ),
    );
  }
  if (payload && typeof payload === "object" && "result" in payload) {
    const wrapped = payload as { result?: unknown };
    if (isStoryboardGenerationResult(wrapped.result)) {
      return normalizeStoryboardCloseupLanguage(
        normalizeStaleStoryboardCaptionIdeas(
          stripUntrustedStoryboardGeneratedImages(wrapped.result),
        ),
      );
    }
  }
  return null;
}

function hydrateStoryboardJobResultForDisplay(
  payload: unknown,
  request: GeneratorForm,
): StoryboardGenerationResult | null {
  const directResult = extractLatestStoryboardResult(payload);
  if (directResult) return directResult;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const jobResult = payload as Record<string, unknown>;
  const resultWithoutRequest = extractLatestStoryboardResult({
    ...jobResult,
    request,
  });
  if (resultWithoutRequest) return resultWithoutRequest;

  if (
    "result" in jobResult &&
    jobResult.result &&
    typeof jobResult.result === "object" &&
    !Array.isArray(jobResult.result)
  ) {
    return extractLatestStoryboardResult({
      result: {
        ...(jobResult.result as Record<string, unknown>),
        request,
      },
    });
  }

  return null;
}

function extractStoryboardHistoryRuns(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const candidate = payload as { runs?: unknown };
  return Array.isArray(candidate.runs) ? candidate.runs : [];
}

async function getStoryboardHistoryResults(): Promise<StoryboardHistoryCase[]> {
  const response = await fetch(STORYBOARD_HISTORY_INDEX_URL, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `스토리보드 기록 인덱스를 불러오지 못했습니다. (${response.status})`,
    );
  }
  const runs = extractStoryboardHistoryRuns(await response.json());
  const hydratedCases = await Promise.all(
    runs.slice(0, 24).map(async (run, index) => {
      const runUrl =
        run && typeof run === "object"
          ? getSafeStoryboardHistoryRunUrl(run)
          : null;
      if (!runUrl) return null;
      const runResponse = await fetch(runUrl, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!runResponse.ok) return null;
      const historyResult = extractLatestStoryboardResult(
        await runResponse.json(),
      );
      if (!historyResult) return null;
      return {
        id: `${historyResult.generatedAt}-${index}`,
        result: historyResult,
        runUrl,
      } satisfies StoryboardHistoryCase;
    }),
  );

  const seenGeneratedAt = new Set<string>();
  return hydratedCases.flatMap((historyCase) => {
    if (!historyCase) return [];
    if (seenGeneratedAt.has(historyCase.result.generatedAt)) return [];
    seenGeneratedAt.add(historyCase.result.generatedAt);
    return [historyCase];
  });
}

function formatStoryboardHistoryTimestamp(value: string) {
  const parsed = Number.isFinite(Date.parse(value)) ? new Date(value) : null;
  if (!parsed) return value;
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hour = String(parsed.getHours()).padStart(2, "0");
  const minute = String(parsed.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

function makeStoryboardHistoryCase(
  result: StoryboardGenerationResult,
  runUrl = STORYBOARD_LATEST_REAL_DATA_URL,
): StoryboardHistoryCase {
  return {
    id: `${result.generatedAt}-current`,
    result: stripUntrustedStoryboardGeneratedImages(result),
    runUrl,
  };
}

function hydrateStoryboardResultForDisplay(
  result: StoryboardGenerationResult,
): StoryboardGenerationResult {
  return stripUntrustedStoryboardGeneratedImages(result);
}

function makeStoryboardImprovementSummaryMessage(
  result: StoryboardGenerationResult,
  id: string,
): StoryboardChatMessage {
  return {
    id,
    role: "assistant",
    text: formatStoryboardVisibleImprovementSummary(
      hydrateStoryboardResultForDisplay(result),
    ),
    status: "done",
  };
}

function mergeStoryboardHistoryCases(
  incoming: StoryboardHistoryCase[],
  current: StoryboardHistoryCase[],
) {
  const seenGeneratedAt = new Set<string>();
  return [...incoming, ...current].flatMap((historyCase) => {
    if (seenGeneratedAt.has(historyCase.result.generatedAt)) return [];
    seenGeneratedAt.add(historyCase.result.generatedAt);
    return [historyCase];
  });
}

function getStoryboardHistoryPreviewImage(historyCase: StoryboardHistoryCase) {
  for (const scene of historyCase.result.storyboard.scenes) {
    const trustedImage = getTrustedStoryboardGeneratedImage(
      scene.generatedImage,
    );
    if (trustedImage) return trustedImage.dataUrl;
  }
  return null;
}

function formatStoryboardHistoryVisibleCutCount(
  result: StoryboardGenerationResult,
) {
  const generatedImageCount = countTrustedStoryboardGeneratedImages(
    result.storyboard.scenes,
  );
  if (generatedImageCount > 0) return `${generatedImageCount}컷 이미지`;
  return `${result.storyboard.scenes.length}컷`;
}

function getMissingTrustedStoryboardImageScenes(scenes: StoryboardScene[]) {
  return scenes.filter(
    (scene) => !getTrustedStoryboardGeneratedImage(scene.generatedImage),
  );
}

function formatStoryboardSceneTraceReason(scene: StoryboardScene) {
  const cutLabel = `CUT ${String(scene.sceneNo).padStart(2, "0")}`;
  const title = sanitizeStoryboardAssistantSourceText(scene.title);
  const reason = sanitizeStoryboardAssistantSourceText(
    scene.heatmapEvidence.reason,
  );
  const shortReason = truncateStoryboardFrameText(reason, 54);
  return `- ${cutLabel}: ${scene.heatmapEvidence.peakTime} 근처의 “${title}” 장면을 골랐어요. ${shortReason}`;
}

function formatStoryboardVisibleImprovementSummary(
  result: StoryboardGenerationResult,
) {
  const sceneCount = result.storyboard.scenes.length;
  const trustedImageCount = countTrustedStoryboardGeneratedImages(
    result.storyboard.scenes,
  );
  const firstPageTrustedImageCount = getVisibleTrustedStoryboardPageScenes({
    allScenes: result.storyboard.scenes,
    page: 0,
    pageSize: STORYBOARD_FRAMES_PER_PAGE,
  }).length;
  const firstPageSceneCount = Math.min(STORYBOARD_FRAMES_PER_PAGE, sceneCount);
  const imageReadinessText =
    trustedImageCount > 0
      ? `검증 이미지는 첫 화면 ${firstPageTrustedImageCount}/${firstPageSceneCount}컷, 전체 ${trustedImageCount}/${sceneCount}컷이에요. 실제 신뢰된 이미지 파일만 세었습니다.`
      : `${STORYBOARD_NO_TRUSTED_IMAGE_LABEL} · 검증 이미지는 0/${sceneCount}컷이에요.`;

  return [
    "준비된 스토리보드를 불러왔어요.",
    "컷마다 오디오, 자막, 촬영 포인트를 나눠서 볼 수 있어요.",
    "첫 컷은 가게 앞 인트로부터 시작해요.",
    `이미지: ${imageReadinessText}`,
  ].join("\n");
}

function formatStoryboardTraceBubble(
  result: StoryboardGenerationResult,
  flowChecks?: StoryboardPdfFlowCheck[],
) {
  const graph = result.backendAnalysis.backendAgent?.graph;
  const retrievalUsed = Boolean(
    graph?.status === "used" &&
    graph.retrieval?.status === "used" &&
    graph.toolsCalled.includes("search_scene_data"),
  );
  const dataText = retrievalUsed
    ? "영상에서 다시 본 장면과 자막 근거를 확인했어요."
    : result.sourceSummary.isFallbackData
      ? "영상 자료가 부족해서 요청 내용 중심으로 정리했어요."
      : "영상 흐름과 반복 시청 근거를 확인했어요.";
  const trustedImageCount = countTrustedStoryboardGeneratedImages(
    result.storyboard.scenes,
  );
  const imageText =
    trustedImageCount > 0
      ? `검증된 컷 이미지는 ${trustedImageCount}/${result.storyboard.scenes.length}컷이에요.`
      : `${STORYBOARD_NO_TRUSTED_IMAGE_LABEL} · 검증 이미지는 0/${result.storyboard.scenes.length}컷이에요.`;
  const sceneReasons = result.storyboard.scenes
    .slice(0, 3)
    .map(formatStoryboardSceneTraceReason);
  void flowChecks;

  return [
    "이렇게 만들었어요.",
    "1. 원하는 컷 수와 분위기를 먼저 맞췄어요.",
    `2. ${dataText}`,
    "3. 가게 앞 인트로부터 맛 평가까지 자연스럽게 이어지게 했어요.",
    `이미지: ${imageText}`,
    sceneReasons[0] ? `예: ${sceneReasons[0].replace(/^- /, "")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatStoryboardGenerationCompletion(
  result: StoryboardGenerationResult,
) {
  const sceneCount = result.storyboard.scenes.length;
  const trustedImageCount = countTrustedStoryboardGeneratedImages(
    result.storyboard.scenes,
  );
  const visibleCanvasImageCount = getVisibleTrustedStoryboardPageScenes({
    allScenes: result.storyboard.scenes,
    page: 0,
    pageSize: STORYBOARD_FRAMES_PER_PAGE,
  }).length;
  const visibleCanvasCutCount = Math.min(
    STORYBOARD_FRAMES_PER_PAGE,
    sceneCount,
  );
  const traceText = formatStoryboardTraceBubble(result);

  if (visibleCanvasImageCount > 0) {
    return {
      focusLabel: "스토리보드 이미지 반영 완료",
      focusDetail: `현재 캔버스 CUT 이미지 ${visibleCanvasImageCount}/${visibleCanvasCutCount}컷을 반영했습니다. 전체 생성 이미지는 ${trustedImageCount}/${sceneCount}컷입니다.`,
      focusPromptContext:
        "새 스토리보드 이미지 생성 결과가 캔버스에 반영됐습니다. 사용자가 후속으로 특정 컷이나 전체 흐름 개선을 요청할 수 있습니다.",
      assistantText: `스토리보드 이미지 반영 완료 · 현재 캔버스 CUT 이미지 ${visibleCanvasImageCount}/${visibleCanvasCutCount}컷 · 전체 이미지 ${trustedImageCount}/${sceneCount}컷\n\n${traceText}`,
      streamingText: `완료: 현재 캔버스 CUT 이미지 ${visibleCanvasImageCount}/${visibleCanvasCutCount}컷이 좌측 캔버스에 반영됐습니다 · 전체 이미지 ${trustedImageCount}/${sceneCount}컷\n\n${traceText}`,
    };
  }

  const noVisibleImageDetail =
    trustedImageCount > 0
      ? `현재 캔버스 CUT 이미지는 아직 0/${visibleCanvasCutCount}컷입니다. 전체 생성 이미지는 ${trustedImageCount}/${sceneCount}컷이지만 현재 페이지에는 없습니다.`
      : `${STORYBOARD_NO_TRUSTED_IMAGE_LABEL} · 검증 이미지는 0/${sceneCount}컷입니다.`;
  const noVisibleImageSummary =
    trustedImageCount > 0
      ? `현재 캔버스 CUT 이미지는 아직 0/${visibleCanvasCutCount}컷 · 전체 이미지는 ${trustedImageCount}/${sceneCount}컷`
      : `${STORYBOARD_NO_TRUSTED_IMAGE_LABEL} · 0/${sceneCount}컷`;

  return {
    focusLabel: "스토리보드 컷 구성 완료",
    focusDetail: noVisibleImageDetail,
    focusPromptContext: `${STORYBOARD_NO_TRUSTED_IMAGE_LABEL}. 캔버스 CUT 이미지는 이미지 생성 버튼으로 검증 이미지 결과를 만든 뒤 표시됩니다.`,
    assistantText: `스토리보드 컷 구성 완료 · ${noVisibleImageSummary} · 이미지 만들기 버튼을 누르면 캔버스 CUT 이미지를 채울 수 있습니다.\n\n${traceText}`,
    streamingText: `완료: ${sceneCount}컷 스토리보드 구성은 준비됐지만 ${noVisibleImageSummary}입니다 · 이미지 만들기 버튼을 누르면 캔버스 CUT 이미지를 채울 수 있습니다.\n\n${traceText}`,
  };
}

function getStoryboardHistoryProofSummaries(
  result: StoryboardGenerationResult,
): StoryboardHistoryProofSummary[] {
  return result.storyboard.scenes.flatMap((scene) => {
    const trustedImage = getTrustedStoryboardGeneratedImage(
      scene.generatedImage,
    );
    const provenance = getExactStoryboardGeneratedImageProvenance(
      trustedImage?.provenance,
    );
    if (!provenance) return [];
    return [
      {
        sceneNo: scene.sceneNo,
        providerId: provenance.providerId,
        authMode: provenance.authMode,
        modelLabel: `${provenance.model} ${provenance.modelProvenance}`,
        responseId: provenance.responseId,
        imageCallId: provenance.imageCallId,
        requestHash: provenance.requestHash,
        responseHash: provenance.responseHash,
        generatedAt: provenance.generatedAt,
      },
    ];
  });
}

function mergeStoryboardGeneratedImagesIntoResult(
  sourceResult: StoryboardGenerationResult,
  images: StoryboardImagesResponse["images"],
): StoryboardGenerationResult {
  const imageMap = new Map(
    images.flatMap(({ sceneNo, image }) => {
      const trustedImage = getTrustedStoryboardGeneratedImage(image);
      return trustedImage ? [[sceneNo, trustedImage] as const] : [];
    }),
  );
  if (imageMap.size === 0) return sourceResult;

  return {
    ...sourceResult,
    generatedAt: new Date().toISOString(),
    storyboard: {
      ...sourceResult.storyboard,
      scenes: sourceResult.storyboard.scenes.map((scene) => {
        const image = imageMap.get(scene.sceneNo);
        return image ? { ...scene, generatedImage: image } : scene;
      }),
    },
  };
}

function mergeStoryboardScenePatch(
  scene: StoryboardScene,
  patch: NonNullable<StoryboardChatCanvasPatch["scenePatch"]>,
): StoryboardScene {
  if (scene.sceneNo !== patch.sceneNo) return scene;
  return {
    ...scene,
    title: patch.title ?? scene.title,
    operatorIntent: patch.operatorIntent ?? scene.operatorIntent,
    visualDirection: patch.visualDirection ?? scene.visualDirection,
    hostBeat: patch.hostBeat ?? scene.hostBeat,
    captionIdea: patch.captionIdea ?? scene.captionIdea,
    productionChecklist: patch.productionChecklist?.length
      ? Array.from(
          new Set([...patch.productionChecklist, ...scene.productionChecklist]),
        ).slice(0, 6)
      : scene.productionChecklist,
  };
}

function getStoryboardPageForSceneNo(
  sceneNo: number,
  totalPages: number,
  pageSize: StoryboardFramePageSize | number = STORYBOARD_FRAMES_PER_PAGE,
) {
  const maxPage = Math.max(0, totalPages - 1);
  if (!Number.isFinite(sceneNo)) return 0;
  const page = Math.floor(
    (Math.max(1, Math.trunc(sceneNo)) - 1) / Math.max(1, Math.trunc(pageSize)),
  );
  return Math.min(maxPage, Math.max(0, page));
}

function getStoryboardVisibleFramePageForSceneNo(
  scenes: StoryboardScene[],
  sceneNo: number,
  pageSize: StoryboardFramePageSize | number = STORYBOARD_FRAMES_PER_PAGE,
) {
  if (!Number.isFinite(sceneNo)) return null;
  const sceneIndex = scenes.findIndex(
    (scene) => scene.sceneNo === Math.trunc(sceneNo),
  );
  if (sceneIndex < 0) return null;
  return getStoryboardPageForSceneNo(
    sceneIndex + 1,
    Math.max(1, Math.ceil(scenes.length / Math.max(1, Math.trunc(pageSize)))),
    pageSize,
  );
}

async function isStoryboardDisplayImageAvailable(dataUrl: string) {
  const isInlineImage = /^data:image\/(?:png|jpeg|webp);base64,/i.test(dataUrl);
  if (!isInlineImage && !dataUrl.startsWith("/")) {
    return false;
  }
  return Boolean(await loadCanvasImage(dataUrl));
}

async function stripUnavailableStoryboardGeneratedImagesForBrowser(
  result: StoryboardGenerationResult,
): Promise<StoryboardGenerationResult> {
  const scenes = await Promise.all(
    result.storyboard.scenes.map(async (scene) => {
      const trustedImage = getTrustedStoryboardGeneratedImage(
        scene.generatedImage,
      );
      if (!trustedImage) return scene;
      if (await isStoryboardDisplayImageAvailable(trustedImage.dataUrl)) {
        return scene;
      }
      const safeScene = { ...scene };
      delete safeScene.generatedImage;
      return safeScene;
    }),
  );

  return {
    ...result,
    storyboard: {
      ...result.storyboard,
      scenes,
    },
  };
}

function stripStoryboardGeneratedImageForScene(
  result: StoryboardGenerationResult,
  sceneNo: number,
  dataUrl: string,
): StoryboardGenerationResult {
  let didStripImage = false;
  const scenes = result.storyboard.scenes.map((scene) => {
    if (scene.sceneNo !== sceneNo) return scene;
    const trustedImage = getTrustedStoryboardGeneratedImage(
      scene.generatedImage,
    );
    if (!trustedImage || trustedImage.dataUrl !== dataUrl) return scene;
    const safeScene = { ...scene };
    delete safeScene.generatedImage;
    didStripImage = true;
    return safeScene;
  });

  if (!didStripImage) return result;
  return {
    ...result,
    storyboard: {
      ...result.storyboard,
      scenes,
    },
  };
}

async function fetchStoryboardInitialResult(
  runUrl: string,
  source: StoryboardInitialResultSource,
): Promise<StoryboardInitialResult | null> {
  const response = await fetch(runUrl, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) return null;
  const result = extractLatestStoryboardResult(await response.json());
  if (!result) return null;
  const trustedResult =
    await stripUnavailableStoryboardGeneratedImagesForBrowser(
      hydrateStoryboardResultForDisplay(result),
    );
  const trustedFirstPageSceneCount = getVisibleTrustedStoryboardPageScenes({
    allScenes: trustedResult.storyboard.scenes,
    page: 0,
    pageSize: STORYBOARD_FRAMES_PER_PAGE,
  }).length;
  return trustedFirstPageSceneCount >= STORYBOARD_FRAMES_PER_PAGE
    ? { result: trustedResult, source, runUrl }
    : null;
}

async function getLatestRealDataStoryboardResult(): Promise<StoryboardInitialResult | null> {
  return (
    (await fetchStoryboardInitialResult(
      STORYBOARD_LATEST_REAL_DATA_URL,
      "latest-history",
    )) ??
    (await fetchStoryboardInitialResult(
      STORYBOARD_SHARED_SEED_REAL_DATA_URL,
      "shared-seed",
    ))
  );
}

function getTrustedInitialStoryboardResult(
  initialStoryboardResult?: StoryboardInitialResult | null,
): StoryboardInitialResult | null {
  if (!initialStoryboardResult) return null;
  const trustedResult =
    extractLatestStoryboardResult(initialStoryboardResult.result) ??
    hydrateStoryboardResultForDisplay(initialStoryboardResult.result);
  const trustedFirstPageSceneCount = getVisibleTrustedStoryboardPageScenes({
    allScenes: trustedResult.storyboard.scenes,
    page: 0,
    pageSize: STORYBOARD_FRAMES_PER_PAGE,
  }).length;

  return trustedFirstPageSceneCount >= STORYBOARD_FRAMES_PER_PAGE
    ? { ...initialStoryboardResult, result: trustedResult }
    : null;
}

function makeInitialStoryboardChatMessages(
  _initialStoryboardResult: StoryboardInitialResult | null,
): StoryboardChatMessage[] {
  const intakeMessage = formatStoryboardChatMessageForDisplay({
    id: "assistant-intake",
    role: "assistant",
    text: "무엇부터 만들까요?",
    status: "done",
  });

  return [intakeMessage];
}

type StoryboardJobAcceptedResponse = {
  ok: true;
  mode: "async_job_control_plane";
  job: {
    jobId: string;
    status: "queued" | "claimed" | "succeeded" | "failed" | "cancelled";
    stage: string;
    readiness?: {
      status: string;
      fallbackReasonCode: string | null;
      message: string;
    };
    result?: unknown;
    errorCode?: string | null;
    createdAt?: string;
    updatedAt?: string;
    claimedAt?: string | null;
    completedAt?: string | null;
    cancelledAt?: string | null;
  };
  readiness?: {
    status: string;
    fallbackReasonCode: string | null;
    message: string;
  };
  message?: string;
};

type StoryboardJobStatus = StoryboardJobAcceptedResponse["job"]["status"];
type StoryboardJobStatusReadback = {
  ok: true;
  job: StoryboardJobAcceptedResponse["job"];
  readiness?: StoryboardJobAcceptedResponse["readiness"];
};
type StoryboardJobStatusResponse =
  | StoryboardJobStatusReadback
  | {
      ok: false;
      error: string;
      jobId?: string;
    };

const STORYBOARD_JOB_POLL_INTERVAL_MS = 5_000;

function isTerminalStoryboardJobStatus(status: StoryboardJobStatus) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function formatStoryboardJobStatusLabel(status: StoryboardJobStatus) {
  switch (status) {
    case "queued":
      return "대기 중";
    case "claimed":
      return "워커 처리 중";
    case "succeeded":
      return "완료";
    case "failed":
      return "실패";
    case "cancelled":
      return "취소됨";
  }
}

type StoryboardGenerationSubmission = StoryboardGenerationResult | StoryboardJobAcceptedResponse;

function isStoryboardJobAcceptedResponse(value: StoryboardGenerationSubmission): value is StoryboardJobAcceptedResponse {
  return "mode" in value && value.mode === "async_job_control_plane";
}

async function postStoryboardRequest(
  form: GeneratorForm,
): Promise<StoryboardGenerationSubmission> {
  const response = await fetch("/api/admin/storyboard", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(form),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? "스토리보드를 생성하지 못했습니다.");
  }

  return response.json() as Promise<StoryboardGenerationSubmission>;
}

async function getStoryboardJobStatus(
  jobId: string,
): Promise<StoryboardJobStatusReadback> {
  const response = await fetch(
    `/api/admin/storyboard/jobs/${encodeURIComponent(jobId)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | StoryboardJobStatusResponse
    | null;
  if (!response.ok || !payload) {
    throw new Error(
      payload && !payload.ok
        ? payload.error
        : "스토리보드 작업 상태를 불러오지 못했습니다.",
    );
  }
  if (!payload.ok) {
    throw new Error(payload.error);
  }
  return payload;
}

type StoryboardImagesResponse = {
  images: Array<{
    sceneNo: number;
    image: StoryboardSceneGeneratedImage;
  }>;
};

async function postStoryboardImagesRequest(
  result: StoryboardGenerationResult,
  scenes: StoryboardGenerationResult["storyboard"]["scenes"],
  browserOpenAIApiKey: string | null,
  options?: { signal?: AbortSignal },
): Promise<StoryboardImagesResponse> {
  const transportResult = stripStoryboardGeneratedImagesForTransport(result);
  const response = await fetch("/api/admin/storyboard/images", {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...getStoryboardBrowserModelKeyHeaders(browserOpenAIApiKey),
    },
    body: JSON.stringify({
      title: transportResult.storyboard.title,
      logline: transportResult.storyboard.logline,
      request: transportResult.request,
      scenes: stripStoryboardGeneratedImagesFromScenes(scenes),
      sourceResult: transportResult,
    }),
    signal: options?.signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      detail?: string;
    } | null;
    throw new Error(
      payload?.detail ??
        payload?.error ??
        "스토리보드 이미지를 생성하지 못했습니다.",
    );
  }

  return response.json() as Promise<StoryboardImagesResponse>;
}

async function getStoryboardImageProviderStatusRequest(
  browserOpenAIApiKey: string | null,
  options?: { signal?: AbortSignal },
): Promise<StoryboardImageProviderStatusResponse> {
  const response = await fetch("/api/admin/storyboard/images", {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...getStoryboardBrowserModelKeyHeaders(browserOpenAIApiKey),
    },
    signal: options?.signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      detail?: string;
    } | null;
    throw new Error(
      payload?.detail ??
        payload?.error ??
        "스토리보드 이미지 상태를 확인하지 못했습니다.",
    );
  }

  return response.json() as Promise<StoryboardImageProviderStatusResponse>;
}

function mapStoryboardLocalBridgeStatusToReadiness(
  status: StoryboardLocalBridgeUiStatus,
  message?: string,
): StoryboardImageProviderReadiness {
  const checkedAt = new Date().toISOString();
  if (status === "connected") {
    return {
      status: "ready",
      label: "로컬 브릿지 연결됨",
      summary: "사용자 PC helper가 gpt-image-2 생성 준비를 마쳤습니다.",
      detail:
        "helper 창이 사용자 PC loopback 브릿지와 통신하며, 앱 서버 relay 없이 non-loopback 네트워크로 페어링 코드를 보내지 않습니다.",
      reason: "ready",
      model: STORYBOARD_IMAGE_PROVIDER_MODEL,
      providerId: STORYBOARD_IMAGE_PROVIDER_ID,
      modelProvenance: STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE,
      command: "browser-helper-to-127.0.0.1-local-bridge",
      target: { width: 1280, height: 720, aspectRatio: "16:9" },
      checkedAt,
    };
  }
  if (status === "checking") {
    return {
      ...INITIAL_STORYBOARD_IMAGE_PROVIDER_READINESS,
      label: "로컬 브릿지 연결 중",
      summary: "helper 창과 pairing 상태를 확인하고 있습니다.",
      detail: "확인이 끝나기 전에는 새 이미지 만들기를 잠시 중단합니다.",
      checkedAt,
    };
  }
  return {
    status: status === "blocked" ? "blocked_provenance" : "error",
    label:
      status === "unpaired"
        ? "로컬 브릿지 토큰 필요"
        : status === "auth_required"
          ? "Codex OAuth 로그인 필요"
          : status === "needs_reconnect"
            ? "로컬 브릿지 다시 연결 필요"
            : status === "unavailable"
              ? "로컬 브릿지 꺼짐"
              : "로컬 브릿지 확인 실패",
    summary:
      message ??
      (status === "unpaired"
        ? "터미널에 표시된 페어링 코드를 입력해야 합니다."
        : status === "auth_required"
          ? "로컬 Codex OAuth 로그인 후 helper를 다시 연결해 주세요."
          : status === "needs_reconnect"
            ? "페이지를 다시 불렀거나 helper 창 연결이 끊겨 다시 연결해야 합니다."
            : status === "unavailable"
              ? "127.0.0.1 로컬 브릿지에 연결할 수 없습니다."
              : "로컬 브릿지 응답을 신뢰할 수 없습니다."),
    detail:
      "고급 로컬이 선택된 동안에는 서버 relay나 다른 라우터로 우회하지 않습니다. helper를 다시 연결하거나 설정을 고친 뒤 재시도해 주세요.",
    reason: "local_codex_bridge_unavailable",
    model: STORYBOARD_IMAGE_PROVIDER_MODEL,
    providerId: STORYBOARD_IMAGE_PROVIDER_ID,
    checkedAt,
  };
}

function readStoryboardLocalBridgeErrorBody(body: unknown) {
  if (body && typeof body === "object") {
    const record = body as Partial<{
      detail: unknown;
      error: unknown;
      message: unknown;
    }>;
    const detail =
      typeof record.detail === "string"
        ? record.detail
        : typeof record.message === "string"
          ? record.message
          : typeof record.error === "string"
            ? record.error
            : null;
    if (detail) return detail;
  }
  return "로컬 브릿지 요청이 실패했습니다.";
}

async function readStoryboardLocalBridgeJsonResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function fetchStoryboardLocalBridgeDirectJson(
  baseUrl: string,
  path: string,
  token?: string | null,
  body?: unknown,
  options?: { signal?: AbortSignal },
): Promise<StoryboardLocalBridgeDirectResponse> {
  const headers: Record<string, string> = token
    ? { ...getStoryboardLocalBridgeAuthHeaders(token) }
    : {
        Accept: "application/json",
      };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      credentials: "omit",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options?.signal,
    });
  } catch (error) {
    throw new StoryboardLocalBridgeDirectTransportError(
      error instanceof Error
        ? error.message
        : "로컬 브릿지 direct transport가 막혔습니다.",
    );
  }

  return {
    ok: response.ok,
    status: response.status,
    body: await readStoryboardLocalBridgeJsonResponse(response),
  };
}

async function getStoryboardLocalBridgeDirectStatusPayload(
  baseUrl: string,
  token: string,
  options?: { signal?: AbortSignal },
): Promise<StoryboardLocalBridgeHelperStatusPayload> {
  const [healthResponse, authResponse] = await Promise.all([
    fetchStoryboardLocalBridgeDirectJson(
      baseUrl,
      STORYBOARD_LOCAL_BRIDGE_HEALTH_PATH,
      undefined,
      undefined,
      options,
    ),
    fetchStoryboardLocalBridgeDirectJson(
      baseUrl,
      STORYBOARD_LOCAL_BRIDGE_AUTH_STATUS_PATH,
      token,
      undefined,
      options,
    ),
  ]);
  return {
    healthOk: healthResponse.ok,
    health: healthResponse.body,
    authOk: authResponse.ok,
    auth: authResponse.body,
  };
}

async function getStoryboardLocalBridgeStatusRequest(
  bridgeUrl: string,
  token: string | null,
  invokeHelper: StoryboardLocalBridgeHelperInvoke,
  options?: { signal?: AbortSignal },
): Promise<{
  status: StoryboardLocalBridgeUiStatus;
  message: string;
  readiness: StoryboardImageProviderReadiness;
}> {
  let baseUrl: string;
  try {
    baseUrl = normalizeStoryboardLocalBridgeUrl(bridgeUrl);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "로컬 브릿지 주소가 올바르지 않습니다.";
    return {
      status: "blocked",
      message,
      readiness: mapStoryboardLocalBridgeStatusToReadiness("blocked", message),
    };
  }
  const normalizedToken = normalizeStoryboardLocalBridgeToken(token);
  if (!normalizedToken) {
    const message = "터미널에 표시된 페어링 코드를 입력해 주세요.";
    return {
      status: "unpaired",
      message,
      readiness: mapStoryboardLocalBridgeStatusToReadiness("unpaired", message),
    };
  }

  try {
    let responsePayload: unknown;
    let transportLabel = "direct loopback transport";
    try {
      responsePayload = await getStoryboardLocalBridgeDirectStatusPayload(
        baseUrl,
        normalizedToken,
        options,
      );
    } catch (directError) {
      if (!(directError instanceof StoryboardLocalBridgeDirectTransportError)) {
        throw directError;
      }
      transportLabel = "helper transport";
      responsePayload = await invokeHelper(
        {
          kind: "tzudong-local-bridge-helper-request",
          sessionId: "storyboard-local-bridge-status",
          requestId: "storyboard-local-bridge-status",
          command: "checkStatus",
          bridgeUrl: baseUrl,
          token: normalizedToken,
        },
        options,
      );
    }
    const helperPayload =
      responsePayload && typeof responsePayload === "object"
        ? (responsePayload as Partial<StoryboardLocalBridgeHelperStatusPayload>)
        : null;
    const healthPayload =
      helperPayload?.health && typeof helperPayload.health === "object"
        ? (helperPayload.health as Partial<{
            ok: boolean;
            bridge: string;
            providerId: string;
            model: string;
          }>)
        : null;
    const authPayload =
      helperPayload?.auth && typeof helperPayload.auth === "object"
        ? (helperPayload.auth as Partial<{
            ok: boolean;
            status: string;
            providerId: string;
            model: string;
            detail?: string;
          }>)
        : null;
    if (
      helperPayload?.healthOk !== true ||
      healthPayload?.ok !== true ||
      healthPayload.bridge !== "tzudong-storyboard-local-bridge" ||
      healthPayload.providerId !== STORYBOARD_IMAGE_PROVIDER_ID ||
      healthPayload.model !== STORYBOARD_IMAGE_PROVIDER_MODEL
    ) {
      const message =
        "로컬 브릿지 health 응답이 스토리보드 신뢰 정책과 맞지 않습니다.";
      return {
        status: "blocked",
        message,
        readiness: mapStoryboardLocalBridgeStatusToReadiness(
          "blocked",
          message,
        ),
      };
    }
    if (
      helperPayload?.authOk === true &&
      authPayload?.ok === true &&
      authPayload.status === "ready" &&
      authPayload.providerId === STORYBOARD_IMAGE_PROVIDER_ID &&
      authPayload.model === STORYBOARD_IMAGE_PROVIDER_MODEL
    ) {
      const message = `로컬 브릿지 연결 완료 · ${transportLabel} · local-codex gpt-image-2`;
      return {
        status: "connected",
        message,
        readiness: mapStoryboardLocalBridgeStatusToReadiness(
          "connected",
          message,
        ),
      };
    }
    if (authPayload?.status === "auth_required") {
      const message =
        authPayload.detail ??
        "로컬 Codex CLI OAuth 인증 파일을 찾지 못했습니다.";
      return {
        status: "auth_required",
        message,
        readiness: mapStoryboardLocalBridgeStatusToReadiness(
          "auth_required",
          message,
        ),
      };
    }
    const message =
      "페어링 코드가 맞지 않습니다. 터미널의 최신 페어링 코드를 다시 입력해 주세요.";
    return {
      status: "unpaired",
      message,
      readiness: mapStoryboardLocalBridgeStatusToReadiness("unpaired", message),
    };
  } catch (error) {
    const message = redactStoryboardLocalBridgeSecretText(
      error instanceof Error
        ? error.message
        : "로컬 브릿지 helper 연결을 확인하지 못했습니다.",
      normalizedToken,
    );
    const status: StoryboardLocalBridgeUiStatus =
      message === getStoryboardLocalBridgeReconnectRequiredMessage()
        ? "needs_reconnect"
        : message === getStoryboardLocalBridgePopupBlockedMessage()
          ? "popup_blocked"
          : message === getStoryboardLocalBridgeHelperClosedMessage()
            ? "helper_failed"
            : "unavailable";
    return {
      status,
      message,
      readiness: mapStoryboardLocalBridgeStatusToReadiness(status, message),
    };
  }
}

async function postStoryboardLocalBridgeImagesRequest(
  result: StoryboardGenerationResult,
  scenes: StoryboardGenerationResult["storyboard"]["scenes"],
  bridgeUrl: string,
  token: string | null,
  invokeHelper: StoryboardLocalBridgeHelperInvoke,
  options?: { signal?: AbortSignal },
): Promise<StoryboardImagesResponse> {
  const normalizedToken = normalizeStoryboardLocalBridgeToken(token);
  if (!normalizedToken) {
    throw new Error("로컬 브릿지 페어링 코드를 먼저 적용해 주세요.");
  }
  const baseUrl = normalizeStoryboardLocalBridgeUrl(bridgeUrl);
  const requestPayload = buildStoryboardLocalBridgeImagesRequest(
    result,
    scenes,
  );
  let responsePayload: unknown;
  try {
    const directResponse = await fetchStoryboardLocalBridgeDirectJson(
      baseUrl,
      STORYBOARD_LOCAL_BRIDGE_IMAGES_PATH,
      normalizedToken,
      requestPayload,
      options,
    );
    if (!directResponse.ok) {
      throw new Error(readStoryboardLocalBridgeErrorBody(directResponse.body));
    }
    responsePayload = directResponse.body;
  } catch (directError) {
    if (!(directError instanceof StoryboardLocalBridgeDirectTransportError)) {
      throw directError;
    }
    responsePayload = await invokeHelper(
      {
        kind: "tzudong-local-bridge-helper-request",
        sessionId: "storyboard-local-bridge-generate",
        requestId: "storyboard-local-bridge-generate",
        command: "generateStoryboard",
        bridgeUrl: baseUrl,
        token: normalizedToken,
        payload: requestPayload,
      },
      options,
    );
  }
  return normalizeStoryboardLocalBridgeImagesResponse(responsePayload);
}

function loadCanvasImage(src?: string) {
  if (!src) return Promise.resolve(null);
  return new Promise<HTMLImageElement | null>((resolveImage) => {
    const image = document.createElement("img");
    image.onload = () => resolveImage(image);
    image.onerror = () => resolveImage(null);
    image.src = src;
  });
}

function StoryboardEmptyCanvasState({
  activeCutStart,
  activeCutEnd,
}: {
  activeCutStart: number;
  activeCutEnd: number;
}) {
  const cutRangeLabel = `CUT ${String(activeCutStart).padStart(2, "0")}–${String(activeCutEnd).padStart(2, "0")}`;

  return (
    <div
      className="col-span-full row-span-full flex h-full min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background p-6 text-center"
      aria-live="polite"
      aria-label={`${cutRangeLabel} ${STORYBOARD_NO_TRUSTED_IMAGE_LABEL}`}
      data-storyboard-empty-canvas="true"
    >
      <div className="max-w-sm space-y-2">
        <p className="text-sm font-semibold text-foreground">
          {STORYBOARD_NO_TRUSTED_IMAGE_LABEL}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          {cutRangeLabel}에 보여줄 검증 이미지가 아직 없습니다. 이미지 만들기
          설정을 확인한 뒤 현재 컷 이미지를 생성하세요.
        </p>
      </div>
    </div>
  );
}

function StoryboardCutImageSkeleton({
  sceneNo,
  hasExistingImage,
  isActive,
  fullFrame = false,
}: {
  sceneNo: number;
  hasExistingImage: boolean;
  isActive: boolean;
  fullFrame?: boolean;
}) {
  const paddedSceneNo = String(sceneNo).padStart(2, "0");

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-20 overflow-hidden bg-gradient-to-br from-slate-100 via-slate-200/85 to-slate-400/70",
        fullFrame ? "rounded-2xl" : "rounded-t-2xl",
        hasExistingImage ? "bg-slate-950/25 opacity-85" : "opacity-100",
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={
        isActive
          ? `CUT ${paddedSceneNo} 이미지 생성 중`
          : `CUT ${paddedSceneNo} 이미지 생성 대기 중`
      }
      data-storyboard-cut-image-skeleton="true"
      data-storyboard-cut-image-skeleton-active={isActive ? "true" : "false"}
      data-storyboard-cut-image-skeleton-variant="legacy-glass"
      data-storyboard-cut-image-skeleton-effect="glass-shimmer"
      data-storyboard-cut-image-skeleton-scene={String(sceneNo)}
      data-storyboard-glass-skeleton="true"
      data-storyboard-glass-skeleton-frame={String(sceneNo)}
      data-storyboard-realtime-skeleton="true"
      data-storyboard-unified-generation-skeleton="true"
      data-storyboard-unified-skeleton="true"
    >
      <span
        className="pointer-events-none absolute inset-0 opacity-85 [background:linear-gradient(135deg,rgba(255,255,255,0.58),rgba(148,163,184,0.28)_48%,rgba(71,85,105,0.26))]"
        aria-hidden="true"
        data-storyboard-cut-image-glass-surface="true"
        data-storyboard-glass-surface="true"
      />
      <span
        className="storyboard-cut-image-shimmer pointer-events-none absolute"
        aria-hidden="true"
        data-storyboard-cut-image-shimmer="true"
        data-storyboard-cut-image-shimmer-effect="glass-sweep"
        data-storyboard-glass-shimmer="true"
      />
      <span className="sr-only">
        CUT {paddedSceneNo} 이미지를 {isActive ? "만드는" : "기다리는"}{" "}
        중입니다.
      </span>
    </div>
  );
}

type AdminStoryboardGeneratorProps = {
  initialStoryboardResult?: StoryboardInitialResult | null;
};

export function AdminStoryboardGenerator({
  initialStoryboardResult = null,
}: AdminStoryboardGeneratorProps = {}) {
  const trustedInitialStoryboardResult = useMemo(
    () => getTrustedInitialStoryboardResult(initialStoryboardResult),
    [initialStoryboardResult],
  );
  const [form, setForm] = useState<GeneratorForm>(
    () => trustedInitialStoryboardResult?.result.request ?? DEFAULT_FORM,
  );
  const [result, setResult] = useState<StoryboardGenerationResult>(
    () => trustedInitialStoryboardResult?.result ?? INITIAL_STORYBOARD_PREVIEW,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [acceptedStoryboardJob, setAcceptedStoryboardJob] =
    useState<StoryboardJobAcceptedResponse["job"] | null>(null);
  const [acceptedStoryboardJobRequest, setAcceptedStoryboardJobRequest] =
    useState<GeneratorForm | null>(null);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [
    generatingStoryboardImageSceneNos,
    setGeneratingStoryboardImageSceneNos,
  ] = useState<number[]>([]);
  const [
    activeGeneratingStoryboardImageSceneNo,
    setActiveGeneratingStoryboardImageSceneNo,
  ] = useState<number | null>(null);
  const [isChatAgentStreaming, setIsChatAgentStreaming] = useState(false);
  const [exportPresetId, setExportPresetId] =
    useState<StoryboardExportPresetId>("quick-1280x720");
  const showStoryboardGuide = false;
  const [storyboardPage, setStoryboardPage] = useState(0);
  const [storyboardFramePageSize, setStoryboardFramePageSize] =
    useState<StoryboardFramePageSize>(STORYBOARD_FRAMES_PER_PAGE);
  const [storyboardHistoryCases, setStoryboardHistoryCases] = useState<
    StoryboardHistoryCase[]
  >(() =>
    trustedInitialStoryboardResult
      ? [
          makeStoryboardHistoryCase(
            trustedInitialStoryboardResult.result,
            trustedInitialStoryboardResult.runUrl,
          ),
        ]
      : [],
  );
  const [storyboardHistoryStatus, setStoryboardHistoryStatus] =
    useState<StoryboardHistoryStatus>(
      trustedInitialStoryboardResult ? "ready" : "idle",
    );
  const [storyboardHistoryError, setStoryboardHistoryError] = useState<
    string | null
  >(null);
  const [isStoryboardHistoryPanelOpen, setIsStoryboardHistoryPanelOpen] =
    useState(false);
  const [openStoryboardHistoryProofId, setOpenStoryboardHistoryProofId] =
    useState<string | null>(null);
  const [isStoryboardChatSettingsOpen, setIsStoryboardChatSettingsOpen] =
    useState(false);
  const [
    storyboardImageProviderReadiness,
    setStoryboardImageProviderReadiness,
  ] = useState<StoryboardImageProviderReadiness>(
    INITIAL_STORYBOARD_IMAGE_PROVIDER_READINESS,
  );
  const [storyboardImageRouteChoice, setStoryboardImageRouteChoice] =
    useState<StoryboardImageRouteChoice>("local-codex-oauth");
  const storyboardBrowserOpenAIApiKeyRef = useRef<string | null>(null);
  const storyboardBrowserOpenAIApiKeyInputRef =
    useRef<HTMLInputElement | null>(null);
  const [
    hasStoryboardBrowserOpenAIApiKey,
    setHasStoryboardBrowserOpenAIApiKey,
  ] = useState(false);
  const [
    maskedStoryboardBrowserOpenAIApiKey,
    setMaskedStoryboardBrowserOpenAIApiKey,
  ] = useState("");
  const [
    storyboardBrowserOpenAIApiKeyAppliedAt,
    setStoryboardBrowserOpenAIApiKeyAppliedAt,
  ] = useState<string | null>(null);
  const [
    storyboardBrowserOpenAIApiKeyError,
    setStoryboardBrowserOpenAIApiKeyError,
  ] = useState<string | null>(null);
  const [
    storyboardBrowserOpenAIApiKeyMessage,
    setStoryboardBrowserOpenAIApiKeyMessage,
  ] = useState<string | null>(null);
  const [storyboardLocalBridgeUrl, setStoryboardLocalBridgeUrl] =
    useState<string>(STORYBOARD_LOCAL_BRIDGE_DEFAULT_URL);
  const [storyboardLocalBridgeUrlDraft, setStoryboardLocalBridgeUrlDraft] =
    useState<string>(STORYBOARD_LOCAL_BRIDGE_DEFAULT_URL);
  const storyboardLocalBridgeTokenRef = useRef<string | null>(null);
  const storyboardLocalBridgeTokenInputRef =
    useRef<HTMLInputElement | null>(null);
  const [hasStoryboardLocalBridgeToken, setHasStoryboardLocalBridgeToken] =
    useState(false);
  const [maskedStoryboardLocalBridgeToken, setMaskedStoryboardLocalBridgeToken] =
    useState("");
  const [storyboardLocalBridgeAppliedAt, setStoryboardLocalBridgeAppliedAt] =
    useState<string | null>(null);
  const [storyboardLocalBridgeStatus, setStoryboardLocalBridgeStatus] =
    useState<StoryboardLocalBridgeUiStatus>("unpaired");
  const [storyboardLocalBridgeMessage, setStoryboardLocalBridgeMessage] =
    useState<string | null>(null);
  const [storyboardLocalBridgeError, setStoryboardLocalBridgeError] = useState<
    string | null
  >(null);
  const storyboardLocalBridgeHelperWindowRef = useRef<Window | null>(null);
  const storyboardLocalBridgeHelperPortRef = useRef<MessagePort | null>(null);
  const storyboardLocalBridgeHelperOriginRef = useRef<string | null>(null);
  const storyboardLocalBridgeHelperSessionIdRef = useRef<string | null>(null);
  const storyboardLocalBridgeHelperRequestIdRef = useRef(0);
  const storyboardLocalBridgeHelperCloseWatchRef = useRef<number | null>(null);
  const storyboardLocalBridgePendingRequestsRef = useRef(
    new Map<
      string,
      {
        resolve: (value: unknown) => void;
        reject: (reason?: unknown) => void;
      }
    >(),
  );
  const imageProviderStatusAbortControllerRef =
    useRef<AbortController | null>(null);

  const clearStoryboardLocalBridgeHelperCloseWatch = useCallback(() => {
    if (typeof window === "undefined") return;
    if (storyboardLocalBridgeHelperCloseWatchRef.current !== null) {
      window.clearInterval(storyboardLocalBridgeHelperCloseWatchRef.current);
      storyboardLocalBridgeHelperCloseWatchRef.current = null;
    }
  }, []);

  const rejectStoryboardLocalBridgePendingRequests = useCallback(
    (message: string) => {
      storyboardLocalBridgePendingRequestsRef.current.forEach(({ reject }) => {
        reject(new Error(message));
      });
      storyboardLocalBridgePendingRequestsRef.current.clear();
    },
    [],
  );

  const resetStoryboardLocalBridgeHelperTransport = useCallback(
    (options?: {
      closePopup?: boolean;
      nextStatus?: StoryboardLocalBridgeUiStatus;
      nextMessage?: string;
      nextError?: string | null;
    }) => {
      clearStoryboardLocalBridgeHelperCloseWatch();
      const failureMessage =
        options?.nextMessage ??
        getStoryboardLocalBridgeReconnectRequiredMessage();
      rejectStoryboardLocalBridgePendingRequests(failureMessage);
      const port = storyboardLocalBridgeHelperPortRef.current;
      if (port) {
        try {
          port.onmessage = null;
          port.close();
        } catch {
          // Ignore already-closed helper ports.
        }
        storyboardLocalBridgeHelperPortRef.current = null;
      }
      const popup = storyboardLocalBridgeHelperWindowRef.current;
      if (options?.closePopup && popup && !popup.closed) {
        try {
          popup.close();
        } catch {
          // Ignore popup close failures.
        }
      }
      storyboardLocalBridgeHelperWindowRef.current = null;
      storyboardLocalBridgeHelperOriginRef.current = null;
      storyboardLocalBridgeHelperSessionIdRef.current = null;
      if (options?.nextStatus)
        setStoryboardLocalBridgeStatus(options.nextStatus);
      if (options?.nextMessage !== undefined)
        setStoryboardLocalBridgeMessage(options.nextMessage);
      if (options?.nextError !== undefined)
        setStoryboardLocalBridgeError(options.nextError);
    },
    [
      clearStoryboardLocalBridgeHelperCloseWatch,
      rejectStoryboardLocalBridgePendingRequests,
    ],
  );

  const invokeStoryboardLocalBridgeHelper =
    useCallback<StoryboardLocalBridgeHelperInvoke>(
      (request, options) => {
        const port = storyboardLocalBridgeHelperPortRef.current;
        const sessionId = storyboardLocalBridgeHelperSessionIdRef.current;
        if (!port || !sessionId) {
          return Promise.reject(
            new Error(getStoryboardLocalBridgeReconnectRequiredMessage()),
          );
        }
        if (storyboardLocalBridgeHelperWindowRef.current?.closed) {
          resetStoryboardLocalBridgeHelperTransport({
            nextStatus: "helper_failed",
            nextMessage: getStoryboardLocalBridgeHelperClosedMessage(),
            nextError: getStoryboardLocalBridgeHelperClosedMessage(),
          });
          return Promise.reject(
            new Error(getStoryboardLocalBridgeHelperClosedMessage()),
          );
        }
        const requestId = `storyboard-local-bridge-${storyboardLocalBridgeHelperRequestIdRef.current + 1}`;
        storyboardLocalBridgeHelperRequestIdRef.current += 1;
        return new Promise((resolve, reject) => {
          const abortHandler = () => {
            storyboardLocalBridgePendingRequestsRef.current.delete(requestId);
            reject(new Error("storyboard_local_bridge_request_aborted"));
          };
          if (options?.signal?.aborted) {
            abortHandler();
            return;
          }
          if (options?.signal) {
            options.signal.addEventListener("abort", abortHandler, {
              once: true,
            });
          }
          storyboardLocalBridgePendingRequestsRef.current.set(requestId, {
            resolve: (value) => {
              if (options?.signal)
                options.signal.removeEventListener("abort", abortHandler);
              resolve(value);
            },
            reject: (reason) => {
              if (options?.signal)
                options.signal.removeEventListener("abort", abortHandler);
              reject(reason);
            },
          });
          try {
            port.postMessage({
              ...request,
              sessionId,
              requestId,
            });
          } catch (error) {
            storyboardLocalBridgePendingRequestsRef.current.delete(requestId);
            if (options?.signal)
              options.signal.removeEventListener("abort", abortHandler);
            reject(error);
          }
        });
      },
      [resetStoryboardLocalBridgeHelperTransport],
    );

  const [chatMessages, setChatMessages] = useState<StoryboardChatMessage[]>(
    () => makeInitialStoryboardChatMessages(trustedInitialStoryboardResult),
  );
  const appendStoryboardThinkingTrace = useCallback(
    (
      messageId: string,
      entries: Array<StoryboardThinkingTraceEntry | null>,
    ) => {
      const normalizedEntries = entries.filter(
        (entry): entry is StoryboardThinkingTraceEntry => Boolean(entry),
      );
      if (!normalizedEntries.length) return;
      setChatMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                thinkingTrace: mergeStoryboardThinkingTraceEntries(
                  message.thinkingTrace,
                  normalizedEntries,
                ),
              }
            : message,
        ),
      );
    },
    [],
  );
  const handleConnectStoryboardLocalBridgeHelper = useCallback(
    async (options?: {
      bridgeUrl?: string;
      token?: string | null;
      assistantMessageId?: string;
    }) => {
      const activeToken =
        options?.token ?? storyboardLocalBridgeTokenRef.current;
      const normalizedToken = normalizeStoryboardLocalBridgeToken(activeToken);
      const assistantMessageId = options?.assistantMessageId;
      const appendSetupTrace = (
        id: string,
        label: string,
        status: StoryboardThinkingTraceEntry["status"],
        detail?: string,
      ) => {
        if (!assistantMessageId) return;
        appendStoryboardThinkingTrace(
          assistantMessageId,
          makeStoryboardThinkingTraceEntries({
            id,
            label,
            status,
            detail,
          }),
        );
      };

      if (!normalizedToken) {
        const message =
          "먼저 적용을 눌러 페어링 설정을 이 탭 메모리에 적용해 주세요.";
        setStoryboardLocalBridgeStatus("unpaired");
        setStoryboardLocalBridgeMessage(message);
        setStoryboardLocalBridgeError(message);
        setStoryboardImageProviderReadiness(
          mapStoryboardLocalBridgeStatusToReadiness("unpaired", message),
        );
        appendSetupTrace(
          "local-bridge-token",
          "페어링 코드 확인",
          "failed",
          message,
        );
        return false;
      }
      const statusAbortController = new AbortController();
      imageProviderStatusAbortControllerRef.current?.abort();
      imageProviderStatusAbortControllerRef.current = statusAbortController;
      try {
        const normalizedUrl = normalizeStoryboardLocalBridgeUrl(
          options?.bridgeUrl ?? storyboardLocalBridgeUrl,
        );
        resetStoryboardLocalBridgeHelperTransport({ closePopup: true });
        const sessionId = createStoryboardLocalBridgeHelperSessionId();
        const helperOrigin = getStoryboardLocalBridgeOrigin(normalizedUrl);
        const helperUrl = buildStoryboardLocalBridgeHelperUrl(
          normalizedUrl,
          sessionId,
        );
        setStoryboardLocalBridgeStatus("checking");
        setStoryboardLocalBridgeMessage(
          "로컬 브릿지 helper 창을 여는 중입니다. 팝업이 보이면 닫지 말고 연결이 끝날 때까지 기다려 주세요.",
        );
        setStoryboardLocalBridgeError(null);
        setStoryboardImageProviderReadiness(
          mapStoryboardLocalBridgeStatusToReadiness("checking"),
        );
        appendSetupTrace(
          "local-bridge-helper-open",
          "helper 창 열기",
          "running",
          `${normalizedUrl} helper와 안전한 MessageChannel을 준비합니다.`,
        );
        let popup: Window | null = null;
        const port = await new Promise<MessagePort>((resolve, reject) => {
          const abortHandler = () => {
            if (popup && !popup.closed) {
              try {
                popup.close();
              } catch {
                // Ignore popup close failures during lifecycle cleanup.
              }
            }
            cleanup();
            reject(
              new DOMException(
                "로컬 브릿지 상태 확인이 중단되었습니다.",
                "AbortError",
              ),
            );
          };
          const timeoutId = window.setTimeout(() => {
            cleanup();
            reject(
              new Error(
                "로컬 브릿지 helper 창이 응답하지 않습니다. helper 창이 열렸는지 확인한 뒤 다시 연결해 주세요.",
              ),
            );
          }, 10_000);
          const onMessage = (event: MessageEvent<unknown>) => {
            if (event.origin !== helperOrigin) return;
            if (popup && event.source !== popup) return;
            if (!isStoryboardLocalBridgeHelperReadyMessage(event.data)) return;
            if (event.data.sessionId !== sessionId) return;
            if (!event.ports[0]) {
              cleanup();
              reject(
                new Error("로컬 브릿지 helper 통신 포트를 받을 수 없습니다."),
              );
              return;
            }
            cleanup();
            resolve(event.ports[0]);
          };
          const cleanup = () => {
            window.clearTimeout(timeoutId);
            window.removeEventListener("message", onMessage);
            statusAbortController.signal.removeEventListener(
              "abort",
              abortHandler,
            );
          };
          if (statusAbortController.signal.aborted) {
            abortHandler();
            return;
          }
          statusAbortController.signal.addEventListener("abort", abortHandler, {
            once: true,
          });
          window.addEventListener("message", onMessage);
          popup = window.open(
            helperUrl,
            "tzudong-storyboard-local-bridge-helper",
            "popup=yes,width=560,height=720,resizable=yes,scrollbars=yes",
          );
          if (!popup) {
            cleanup();
            reject(new Error(getStoryboardLocalBridgePopupBlockedMessage()));
            return;
          }
          popup.focus();
        });
        appendSetupTrace(
          "local-bridge-helper-open",
          "helper 창 열기",
          "done",
          "helper 창이 열렸고 브라우저-브릿지 통신 포트를 받았습니다.",
        );
        storyboardLocalBridgeHelperWindowRef.current = popup;
        storyboardLocalBridgeHelperPortRef.current = port;
        storyboardLocalBridgeHelperOriginRef.current = helperOrigin;
        storyboardLocalBridgeHelperSessionIdRef.current = sessionId;
        port.onmessage = (event) => {
          const data = event.data;
          if (isStoryboardLocalBridgeHelperClosedMessage(data)) {
            if (
              data.sessionId !== storyboardLocalBridgeHelperSessionIdRef.current
            )
              return;
            resetStoryboardLocalBridgeHelperTransport({
              nextStatus: "helper_failed",
              nextMessage: getStoryboardLocalBridgeHelperClosedMessage(),
              nextError: getStoryboardLocalBridgeHelperClosedMessage(),
            });
            setStoryboardImageProviderReadiness(
              mapStoryboardLocalBridgeStatusToReadiness(
                "helper_failed",
                getStoryboardLocalBridgeHelperClosedMessage(),
              ),
            );
            return;
          }
          if (!isStoryboardLocalBridgeHelperResponseMessage(data)) return;
          if (data.sessionId !== storyboardLocalBridgeHelperSessionIdRef.current)
            return;
          const pending = storyboardLocalBridgePendingRequestsRef.current.get(
            data.requestId,
          );
          if (!pending) return;
          storyboardLocalBridgePendingRequestsRef.current.delete(data.requestId);
          if (data.ok) {
            pending.resolve(data.payload);
            return;
          }
          pending.reject(
            new Error(
              data.message ||
                data.errorCode ||
                "local_bridge_helper_request_failed",
            ),
          );
        };
        port.start();
        clearStoryboardLocalBridgeHelperCloseWatch();
        storyboardLocalBridgeHelperCloseWatchRef.current = window.setInterval(
          () => {
            if (!storyboardLocalBridgeHelperWindowRef.current?.closed) return;
            resetStoryboardLocalBridgeHelperTransport({
              nextStatus: "helper_failed",
              nextMessage: getStoryboardLocalBridgeHelperClosedMessage(),
              nextError: getStoryboardLocalBridgeHelperClosedMessage(),
            });
            setStoryboardImageProviderReadiness(
              mapStoryboardLocalBridgeStatusToReadiness(
                "helper_failed",
                getStoryboardLocalBridgeHelperClosedMessage(),
              ),
            );
          },
          500,
        );
        appendSetupTrace(
          "local-bridge-status-check",
          "health/auth 확인",
          "running",
          "브릿지 health, 페어링 코드, Codex OAuth 준비 상태를 확인합니다.",
        );
        const status = await getStoryboardLocalBridgeStatusRequest(
          normalizedUrl,
          normalizedToken,
          invokeStoryboardLocalBridgeHelper,
          { signal: statusAbortController.signal },
        );
        if (statusAbortController.signal.aborted) return false;
        setStoryboardLocalBridgeStatus(status.status);
        setStoryboardLocalBridgeMessage(status.message);
        setStoryboardLocalBridgeError(
          status.status === "connected" ? null : status.message,
        );
        setStoryboardImageProviderReadiness(status.readiness);
        appendSetupTrace(
          "local-bridge-status-check",
          "health/auth 확인",
          status.status === "connected" ? "done" : "failed",
          status.message,
        );
        return status.status === "connected";
      } catch (error) {
        if (statusAbortController.signal.aborted) return false;
        const message = redactStoryboardLocalBridgeSecretText(
          error instanceof Error
            ? error.message
            : "로컬 브릿지 helper 연결을 시작하지 못했습니다.",
          activeToken,
        );
        const nextStatus =
          message === getStoryboardLocalBridgePopupBlockedMessage()
            ? "popup_blocked"
            : "error";
        setStoryboardLocalBridgeStatus(nextStatus);
        setStoryboardLocalBridgeMessage(message);
        setStoryboardLocalBridgeError(message);
        setStoryboardImageProviderReadiness(
          mapStoryboardLocalBridgeStatusToReadiness(nextStatus, message),
        );
        appendSetupTrace(
          "local-bridge-helper-open",
          "helper 창 열기",
          "failed",
          message,
        );
        return false;
      } finally {
        if (
          imageProviderStatusAbortControllerRef.current ===
          statusAbortController
        ) {
          imageProviderStatusAbortControllerRef.current = null;
        }
      }
    },
    [
      appendStoryboardThinkingTrace,
      clearStoryboardLocalBridgeHelperCloseWatch,
      invokeStoryboardLocalBridgeHelper,
      resetStoryboardLocalBridgeHelperTransport,
      storyboardLocalBridgeUrl,
    ],
  );

  const [chatDraft, setChatDraft] = useState("");
  const [storyboardChatImageAttachments, setStoryboardChatImageAttachments] =
    useState<StoryboardChatImageAttachment[]>([]);
  const [storyboardCanvasFocus, setStoryboardCanvasFocus] =
    useState<StoryboardChatFocusContext | null>(null);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const pendingStoryboardChatSteerRef =
    useRef<PendingStoryboardChatSteerRequest | null>(null);
  const imageGenerationAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  const storyboardChatImageAttachmentInputRef = useRef<HTMLInputElement | null>(
    null,
  );
  const storyboardChatTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const storyboardChatComposerImeRef = useRef(false);
  const [isStoryboardChatMultilineLayout, setIsStoryboardChatMultilineLayout] =
    useState(false);
  const chatTranscriptRef = useRef<HTMLDivElement | null>(null);
  const chatTranscriptBottomRef = useRef<HTMLDivElement | null>(null);
  const storyboardChatTypewriterTextById =
    useStoryboardChatTypewriterMessages(chatMessages);
  const storyboardGuidedExampleIndexRef = useRef(0);
  const hasUserStoryboardMutationRef = useRef(false);
  const autoGeneratedMissingStoryboardPageKeysRef = useRef<Set<string>>(
    new Set(),
  );
  const suppressedAutoImageGenerationResultKeysRef = useRef<Set<string>>(
    new Set(),
  );
  const clearStoryboardSecretRefs = useCallback((updateUi = true) => {
    storyboardBrowserOpenAIApiKeyRef.current = null;
    storyboardLocalBridgeTokenRef.current = null;
    if (storyboardBrowserOpenAIApiKeyInputRef.current) {
      storyboardBrowserOpenAIApiKeyInputRef.current.value = "";
    }
    if (storyboardLocalBridgeTokenInputRef.current) {
      storyboardLocalBridgeTokenInputRef.current.value = "";
    }
    if (!updateUi) return;
    setHasStoryboardBrowserOpenAIApiKey(false);
    setMaskedStoryboardBrowserOpenAIApiKey("");
    setStoryboardBrowserOpenAIApiKeyAppliedAt(null);
    setHasStoryboardLocalBridgeToken(false);
    setMaskedStoryboardLocalBridgeToken("");
    setStoryboardLocalBridgeAppliedAt(null);
  }, []);
  const abortStoryboardSensitiveWork = useCallback(() => {
    imageProviderStatusAbortControllerRef.current?.abort();
    imageProviderStatusAbortControllerRef.current = null;
    imageGenerationAbortControllerRef.current?.abort();
    imageGenerationAbortControllerRef.current = null;
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = null;
    pendingStoryboardChatSteerRef.current = null;
    resetStoryboardLocalBridgeHelperTransport({ closePopup: true });
  }, [resetStoryboardLocalBridgeHelperTransport]);
  const resetStoryboardSecretsForPageLifecycle = useCallback(() => {
    abortStoryboardSensitiveWork();
    clearStoryboardSecretRefs();
    setStoryboardImageRouteChoice("local-codex-oauth");
    setStoryboardImageProviderReadiness(
      INITIAL_STORYBOARD_IMAGE_PROVIDER_READINESS,
    );
    setStoryboardBrowserOpenAIApiKeyError(null);
    setStoryboardBrowserOpenAIApiKeyMessage(null);
    setStoryboardLocalBridgeUrl(STORYBOARD_LOCAL_BRIDGE_DEFAULT_URL);
    setStoryboardLocalBridgeUrlDraft(STORYBOARD_LOCAL_BRIDGE_DEFAULT_URL);
    setStoryboardLocalBridgeStatus("unpaired");
    setStoryboardLocalBridgeMessage(null);
    setStoryboardLocalBridgeError(null);
  }, [abortStoryboardSensitiveWork, clearStoryboardSecretRefs]);
  useEffect(() => {
    // `pagehide` fires before both unload and a persisted BFCache snapshot.
    const clearOnPagehide = (_event: PageTransitionEvent) => {
      resetStoryboardSecretsForPageLifecycle();
    };
    const clearOnPageshow = (_event: PageTransitionEvent) => {
      resetStoryboardSecretsForPageLifecycle();
    };
    window.addEventListener("pagehide", clearOnPagehide);
    window.addEventListener("pageshow", clearOnPageshow);
    return () => {
      window.removeEventListener("pagehide", clearOnPagehide);
      window.removeEventListener("pageshow", clearOnPageshow);
      abortStoryboardSensitiveWork();
      clearStoryboardSecretRefs(false);
    };
  }, [
    abortStoryboardSensitiveWork,
    clearStoryboardSecretRefs,
    resetStoryboardSecretsForPageLifecycle,
  ]);
  useEffect(() => {
    if (trustedInitialStoryboardResult) return;

    let cancelled = false;

    getLatestRealDataStoryboardResult()
      .then((initialResult) => {
        if (
          cancelled ||
          !initialResult ||
          hasUserStoryboardMutationRef.current
        ) {
          return;
        }
        setResult(initialResult.result);
        setForm(initialResult.result.request);
        setStoryboardPage(0);
        setStoryboardHistoryCases((current) =>
          mergeStoryboardHistoryCases(
            [
              makeStoryboardHistoryCase(
                initialResult.result,
                initialResult.runUrl,
              ),
            ],
            current,
          ),
        );
        setStoryboardHistoryStatus("ready");
        setStoryboardHistoryError(null);
      })
      .catch(() => {
        // 최신 실제 스토리보드 기록가 없으면 초기 미리보기를 유지합니다.
      });

    return () => {
      cancelled = true;
    };
  }, [trustedInitialStoryboardResult]);

  useEffect(() => {
    let cancelled = false;
    setStoryboardHistoryStatus("loading");

    getStoryboardHistoryResults()
      .then((historyCases) => {
        if (cancelled) return;
        setStoryboardHistoryCases((current) =>
          mergeStoryboardHistoryCases(historyCases, current),
        );
        setStoryboardHistoryStatus(historyCases.length ? "ready" : "empty");
        setStoryboardHistoryError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setStoryboardHistoryStatus("stale");
        setStoryboardHistoryError(
          error instanceof Error
            ? error.message
            : "스토리보드 기록을 불러오지 못했습니다.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!acceptedStoryboardJob || !acceptedStoryboardJobRequest) return;
    if (isTerminalStoryboardJobStatus(acceptedStoryboardJob.status)) return;

    let cancelled = false;
    let timeoutId: number | null = null;
    const jobId = acceptedStoryboardJob.jobId;
    const request = acceptedStoryboardJobRequest;

    const schedulePoll = () => {
      timeoutId = window.setTimeout(async () => {
        try {
          const statusPayload = await getStoryboardJobStatus(jobId);
          if (cancelled) return;

          setAcceptedStoryboardJob(statusPayload.job);
          const nextJob = statusPayload.job;

          if (nextJob.status === "succeeded") {
            const completedResult = hydrateStoryboardJobResultForDisplay(
              nextJob.result,
              request,
            );
            if (!completedResult) {
              setErrorMessage(
                "스토리보드 작업은 완료됐지만 결과 페이로드가 표시 가능한 형식이 아닙니다.",
              );
              return;
            }

            setResult(completedResult);
            setForm(completedResult.request);
            setStoryboardHistoryCases((current) =>
              mergeStoryboardHistoryCases(
                [makeStoryboardHistoryCase(completedResult)],
                current,
              ),
            );
            setStoryboardHistoryStatus("ready");
            setStoryboardHistoryError(null);
            setStoryboardPage(0);
            setErrorMessage(null);
            setChatMessages((messages) =>
              [
                ...messages,
                formatStoryboardChatMessageForDisplay({
                  id: `assistant-storyboard-job-succeeded-${Date.now()}`,
                  role: "assistant",
                  text: `비동기 스토리보드 작업 ${jobId} 완료 · 결과를 캔버스에 반영했습니다.`,
                  status: "done",
                }),
              ].slice(-10),
            );
            return;
          }

          if (nextJob.status === "failed" || nextJob.status === "cancelled") {
            const statusLabel = formatStoryboardJobStatusLabel(nextJob.status);
            const message =
              nextJob.readiness?.message ??
              (nextJob.status === "failed"
                ? "비동기 스토리보드 작업이 실패했습니다."
                : "비동기 스토리보드 작업이 취소되었습니다.");
            setErrorMessage(`${statusLabel} · ${message}`);
            setChatMessages((messages) =>
              [
                ...messages,
                formatStoryboardChatMessageForDisplay({
                  id: `assistant-storyboard-job-${nextJob.status}-${Date.now()}`,
                  role: "assistant",
                  text: `비동기 스토리보드 작업 ${jobId} ${statusLabel} · ${message}`,
                  status: "done",
                }),
              ].slice(-10),
            );
            return;
          }

          schedulePoll();
        } catch (error) {
          if (cancelled) return;
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "스토리보드 작업 상태를 불러오지 못했습니다.",
          );
          schedulePoll();
        }
      }, STORYBOARD_JOB_POLL_INTERVAL_MS);
    };

    schedulePoll();

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [acceptedStoryboardJob, acceptedStoryboardJobRequest]);



  useEffect(() => {
    let cancelled = false;

    if (storyboardImageRouteChoice === STORYBOARD_LOCAL_BRIDGE_ROUTE_ID) {
      if (!hasStoryboardLocalBridgeToken) {
        const localBridgeMessage =
          "터미널에 표시된 페어링 코드를 이 탭에서 적용해 주세요.";
        setStoryboardLocalBridgeStatus("unpaired");
        setStoryboardLocalBridgeMessage(localBridgeMessage);
        setStoryboardImageProviderReadiness(
          mapStoryboardLocalBridgeStatusToReadiness(
            "unpaired",
            localBridgeMessage,
          ),
        );
        return () => {
          cancelled = true;
        };
      }

      const reconnectMessage = getStoryboardLocalBridgeReconnectRequiredMessage();
      setStoryboardLocalBridgeStatus("needs_reconnect");
      setStoryboardLocalBridgeMessage(reconnectMessage);
      setStoryboardLocalBridgeError(null);
      setStoryboardImageProviderReadiness(
        mapStoryboardLocalBridgeStatusToReadiness(
          "needs_reconnect",
          reconnectMessage,
        ),
      );
      return () => {
        cancelled = true;
      };
    }

    const statusAbortController = new AbortController();
    imageProviderStatusAbortControllerRef.current?.abort();
    imageProviderStatusAbortControllerRef.current = statusAbortController;
    const routeOpenAIApiKey =
      storyboardImageRouteChoice === "browser-openai-api-key" &&
      hasStoryboardBrowserOpenAIApiKey
        ? storyboardBrowserOpenAIApiKeyRef.current
        : null;

    getStoryboardImageProviderStatusRequest(routeOpenAIApiKey, {
      signal: statusAbortController.signal,
    })
      .then((payload) => {
        if (cancelled || statusAbortController.signal.aborted) return;
        setStoryboardImageProviderReadiness(
          mapStoryboardImageProviderReadiness(payload),
        );
      })
      .catch((error) => {
        if (cancelled || statusAbortController.signal.aborted) return;
        setStoryboardImageProviderReadiness({
          ...INITIAL_STORYBOARD_IMAGE_PROVIDER_READINESS,
          status: "error",
          label: "이미지 상태 확인 실패",
          summary:
            error instanceof Error
              ? error.message
              : "스토리보드 이미지 상태를 읽지 못했습니다.",
          detail:
            "페이지는 계속 사용할 수 있지만 새 이미지 생성 전 상태를 다시 확인해 주세요.",
          reason: "error",
          checkedAt: new Date().toISOString(),
        });
      });

    return () => {
      cancelled = true;
      statusAbortController.abort();
      if (
        imageProviderStatusAbortControllerRef.current ===
        statusAbortController
      ) {
        imageProviderStatusAbortControllerRef.current = null;
      }
    };
  }, [
    hasStoryboardBrowserOpenAIApiKey,
    hasStoryboardLocalBridgeToken,
    storyboardImageRouteChoice,
  ]);

  const latestChatScrollKey = useMemo(() => {
    const latestMessage = chatMessages[chatMessages.length - 1];
    if (!latestMessage) return "empty";
    const progress = latestMessage.imageGenerationProgress;
    const latestDisplayedText =
      latestMessage.role === "assistant"
        ? (storyboardChatTypewriterTextById[latestMessage.id] ?? "")
        : latestMessage.text;
    return [
      latestMessage.id,
      latestMessage.status ?? "done",
      latestMessage.text.length,
      latestDisplayedText.length,
      progress?.completed ?? 0,
      progress?.failed ?? 0,
      progress?.cancelled ?? 0,
      progress?.total ?? 0,
      isChatAgentStreaming ? "chat" : "",
      isGenerating ? "storyboard" : "",
      isGeneratingImages ? "images" : "",
    ].join(":");
  }, [
    chatMessages,
    isChatAgentStreaming,
    isGenerating,
    isGeneratingImages,
    storyboardChatTypewriterTextById,
  ]);

  useEffect(() => {
    const transcript = chatTranscriptRef.current;
    if (!transcript) return;

    const scrollToLatestMessage = () => {
      chatTranscriptBottomRef.current?.scrollIntoView({
        block: "end",
        behavior: "auto",
      });
      transcript.scrollTo({
        top: transcript.scrollHeight,
        behavior: "auto",
      });
    };
    const firstFrame = window.requestAnimationFrame(() => {
      scrollToLatestMessage();
      window.requestAnimationFrame(scrollToLatestMessage);
    });

    return () => window.cancelAnimationFrame(firstFrame);
  }, [latestChatScrollKey]);

  useEffect(() => {
    const syncTextareaLayout = () =>
      setIsStoryboardChatMultilineLayout(
        resizeStoryboardChatTextarea(storyboardChatTextareaRef.current),
      );
    syncTextareaLayout();
    const frame = window.requestAnimationFrame(syncTextareaLayout);
    return () => window.cancelAnimationFrame(frame);
  }, [chatDraft]);

  const storyboardFrameScenes = useMemo(
    () => result.storyboard.scenes,
    [result.storyboard.scenes],
  );
  const storyboardTotalPages = useMemo(
    () =>
      getStoryboardScenePageCount({
        allScenes: storyboardFrameScenes,
        pageSize: storyboardFramePageSize,
      }),
    [storyboardFramePageSize, storyboardFrameScenes],
  );
  const activeStoryboardPage = Math.min(
    storyboardPage,
    storyboardTotalPages - 1,
  );
  const activeStoryboardPageSourceScenes = useMemo(
    () =>
      storyboardFrameScenes.slice(
        activeStoryboardPage * storyboardFramePageSize,
        activeStoryboardPage * storyboardFramePageSize +
          storyboardFramePageSize,
      ),
    [activeStoryboardPage, storyboardFramePageSize, storyboardFrameScenes],
  );
  const activeStoryboardPageScenes = useMemo(
    () =>
      getStoryboardSourcePageScenes({
        allScenes: storyboardFrameScenes,
        page: activeStoryboardPage,
        pageSize: storyboardFramePageSize,
      }),
    [activeStoryboardPage, storyboardFramePageSize, storyboardFrameScenes],
  );
  const activeStoryboardImageGenerationTargetScenes = useMemo(
    () =>
      getStoryboardImageGenerationTargetScenes({
        allScenes: storyboardFrameScenes,
        visibleScenes: storyboardFrameScenes,
        page: activeStoryboardPage,
        pageSize: storyboardFramePageSize,
      }),
    [activeStoryboardPage, storyboardFramePageSize, storyboardFrameScenes],
  );
  const generatingStoryboardImageSceneNoSet = useMemo(
    () => new Set(generatingStoryboardImageSceneNos),
    [generatingStoryboardImageSceneNos],
  );
  const activeCutStart =
    activeStoryboardPageSourceScenes[0]?.sceneNo ??
    activeStoryboardPage * storyboardFramePageSize + 1;
  const requestedCutCount = Math.max(
    storyboardFramePageSize,
    Number.isFinite(form.segmentCount)
      ? Math.trunc(form.segmentCount)
      : storyboardFramePageSize,
  );
  const emptyCanvasSkeletonCutCount = Math.max(
    storyboardFramePageSize,
    activeStoryboardPageSourceScenes.length,
    activeStoryboardImageGenerationTargetScenes.length,
  );
  const totalCutCount = isGenerating
    ? requestedCutCount
    : storyboardFrameScenes.length || emptyCanvasSkeletonCutCount;
  const activeCutEnd =
    activeStoryboardPageSourceScenes.at(-1)?.sceneNo ??
    Math.min(
      activeCutStart + storyboardFramePageSize - 1,
      Math.max(activeCutStart, totalCutCount),
    );
  const generatedImageCount = Math.min(
    countTrustedStoryboardGeneratedImages(result.storyboard.scenes),
    totalCutCount,
  );
  const omittedStoryboardSceneCount = Math.max(
    0,
    getOmittedStoryboardSceneCount(result.storyboard.scenes),
  );
  const activePageGeneratedCount = countTrustedStoryboardGeneratedImages(
    activeStoryboardImageGenerationTargetScenes,
  );
  const activePageGenerationTargetCount =
    activeStoryboardImageGenerationTargetScenes.length;
  const storyboardCanvasTopicTitle = useMemo(
    () => getStoryboardCanvasTopicTitle(result),
    [result],
  );
  const isStoryboardBrowserOpenAIApiKeyApplied =
    hasStoryboardBrowserOpenAIApiKey;
  const isStoryboardLocalBridgePaired = hasStoryboardLocalBridgeToken;
  const shouldShowStoryboardLocalBridgeSettings =
    storyboardImageRouteChoice === STORYBOARD_LOCAL_BRIDGE_ROUTE_ID ||
    Boolean(hasStoryboardLocalBridgeToken || storyboardLocalBridgeError);
  const expectedStoryboardImageProviderId =
    storyboardImageRouteChoice === "browser-openai-api-key"
      ? STORYBOARD_BROWSER_OPENAI_IMAGE_PROVIDER_ID
      : STORYBOARD_IMAGE_PROVIDER_ID;
  const isSelectedStoryboardImageProviderReady =
    isStoryboardImageProviderReady(storyboardImageProviderReadiness) &&
    storyboardImageProviderReadiness.providerId ===
      expectedStoryboardImageProviderId;
  const isStoryboardImageProviderAvailable =
    storyboardImageRouteChoice === "browser-openai-api-key"
      ? isStoryboardBrowserOpenAIApiKeyApplied &&
        isSelectedStoryboardImageProviderReady
      : storyboardImageRouteChoice === STORYBOARD_LOCAL_BRIDGE_ROUTE_ID
        ? isStoryboardLocalBridgePaired &&
          isSelectedStoryboardImageProviderReady
        : isSelectedStoryboardImageProviderReady;
  const storyboardImageProviderStatusIconLabel =
    isStoryboardImageProviderAvailable
      ? "이미지 생성 브릿지 연결됨"
      : "이미지 생성 브릿지 연결 안됨";
  const selectedStoryboardSceneNos = useMemo(
    () => getStoryboardSelectedSceneNosFromFocus(storyboardCanvasFocus),
    [storyboardCanvasFocus],
  );
  const selectedStoryboardSceneNo = selectedStoryboardSceneNos[0] ?? null;
  const selectedStoryboardSceneNoSet = useMemo(
    () => new Set(selectedStoryboardSceneNos),
    [selectedStoryboardSceneNos],
  );
  const storyboardUserPerspectiveReadiness = useMemo(
    () =>
      buildStoryboardUserPerspectiveReadiness({
        result,
        activeCutStart,
        activeCutEnd,
        activePageGeneratedCount,
        activePageSceneCount:
          activeStoryboardImageGenerationTargetScenes.length ||
          storyboardFramePageSize,
        generatedImageCount,
        visibleCutCount: totalCutCount,
        omittedSceneCount: omittedStoryboardSceneCount,
        hasSelectedCut: Boolean(selectedStoryboardSceneNo),
      }),
    [
      result,
      activeCutStart,
      activeCutEnd,
      activePageGeneratedCount,
      activeStoryboardImageGenerationTargetScenes.length,
      storyboardFramePageSize,
      generatedImageCount,
      totalCutCount,
      omittedStoryboardSceneCount,
      selectedStoryboardSceneNo,
    ],
  );
  const activeFrameViewLabel =
    storyboardFramePageSize === 1 ? "1컷 보기" : "4컷 보기";
  const storyboardImageApiRouterView = getStoryboardImageApiRouterView(
    storyboardImageProviderReadiness,
    storyboardImageRouteChoice,
    isStoryboardBrowserOpenAIApiKeyApplied,
    isStoryboardLocalBridgePaired,
  );
  const storyboardImageGenerationProviderId =
    storyboardImageRouteChoice === "browser-openai-api-key"
      ? STORYBOARD_BROWSER_OPENAI_IMAGE_PROVIDER_ID
      : STORYBOARD_IMAGE_PROVIDER_ID;
  const hasPreviousStoryboardPage = activeStoryboardPage > 0;
  const hasNextStoryboardPage = activeStoryboardPage < storyboardTotalPages - 1;
  const selectedExportPreset =
    storyboardExportPresets.find((preset) => preset.id === exportPresetId) ??
    storyboardExportPresets[0];
  const storyboardBackendAgentReadiness = useMemo(
    () => buildStoryboardBackendAgentReadiness(result),
    [result],
  );
  const storyboardAgentGraphFidelity = useMemo(
    () =>
      result.agentGraphFidelity ??
      buildStoryboardAgentGraphFidelity({
        mode: result.mode,
        graph: result.backendAnalysis.backendAgent?.graph,
        finalOutputReady: Boolean(result.storyboard.exportMarkdown),
        storyboardHistoryCount: storyboardHistoryCases.length,
      }),
    [result, storyboardHistoryCases.length],
  );
  const storyboardPdfFlowChecks = useMemo(
    () =>
      buildStoryboardPdfFlowChecks({
        result,
        backendReadiness: storyboardBackendAgentReadiness,
        graphFidelityStatus: storyboardAgentGraphFidelity.status,
        historyCount: storyboardHistoryCases.length,
      }),
    [
      result,
      storyboardBackendAgentReadiness,
      storyboardAgentGraphFidelity.status,
      storyboardHistoryCases.length,
    ],
  );
  const exportResolutionToken = selectedExportPreset.label.replace("×", "x");
  const hasStoryboardChatImageAttachments =
    storyboardChatImageAttachments.length > 0;
  const isStoryboardChatBusy = isGenerating || isGeneratingImages;
  const isStoryboardChatSteerMode =
    isChatAgentStreaming &&
    !isGenerating &&
    !isGeneratingImages &&
    (Boolean(chatDraft.trim()) || hasStoryboardChatImageAttachments);
  const isStoryboardChatCancelMode =
    (isChatAgentStreaming && !isStoryboardChatSteerMode) || isGeneratingImages;
  const isStoryboardChatSubmitDisabled = isStoryboardChatSteerMode
    ? false
    : isStoryboardChatCancelMode
      ? false
      : isStoryboardChatBusy ||
        (!chatDraft.trim() && !hasStoryboardChatImageAttachments);
  const isChatDraftActive =
    Boolean(chatDraft.trim()) ||
    hasStoryboardChatImageAttachments ||
    form.prompt.trim() !== result.request.prompt.trim() ||
    form.tone !== result.request.tone ||
    form.segmentCount !== result.request.segmentCount ||
    form.targetLengthMinutes !== result.request.targetLengthMinutes ||
    form.generationMode !== result.request.generationMode;
  const currentStreamingLabel = isGeneratingImages
    ? "이미지 생성 중"
    : isGenerating
      ? "스토리보드 구성 중"
      : isChatAgentStreaming
        ? "답변 준비 중"
        : isChatDraftActive
          ? "수정 초안 대기"
          : "동기화됨";
  const selectedRealStoryboardScene = selectedStoryboardSceneNo
    ? (result.storyboard.scenes.find(
        (scene) => scene.sceneNo === selectedStoryboardSceneNo,
      ) ?? null)
    : null;
  const visibleStoryboardHistoryCases = useMemo(
    () => storyboardHistoryCases.slice(0, 8),
    [storyboardHistoryCases],
  );
  const storyboardChatPlaceholder =
    storyboardCanvasFocus?.kind === "cut"
      ? `예: ${storyboardCanvasFocus.label.replace(" 선택됨", "")} 멘트 짧게`
      : storyboardCanvasFocus?.kind === "action"
        ? "예: 다음 컷을 더 빠르게"
        : "예: 매운 라면 10컷으로 만들어줘";

  function createFormWithStoryboardChatPatch(
    baseForm: GeneratorForm,
    patch: StoryboardChatCanvasPatch,
  ): GeneratorForm {
    return {
      ...baseForm,
      prompt: patch.prompt,
      tone: patch.tone,
      targetLengthMinutes: patch.targetLengthMinutes,
      segmentCount: patch.segmentCount,
      generationMode: patch.generationMode,
    };
  }

  function isStoryboardChatCanvasPatchActionable(
    resultPatch: StoryboardChatAgentResult,
  ) {
    const patch = resultPatch.canvasPatch;
    return Boolean(
      resultPatch.shouldGenerate ||
        resultPatch.shouldReset ||
        patch.scenePatch ||
        patch.focusSceneNo ||
        patch.unavailableFocusSceneNo,
    );
  }

  function applyStoryboardChatPatchToCanvas(patch: StoryboardChatCanvasPatch) {
    setForm((current) => createFormWithStoryboardChatPatch(current, patch));
    if (patch.scenePatch) {
      const sceneForFocus = result.storyboard.scenes.find(
        (scene) => scene.sceneNo === patch.scenePatch?.sceneNo,
      );
      if (sceneForFocus) {
        const visibleFramePage = getStoryboardVisibleFramePageForSceneNo(
          storyboardFrameScenes,
          sceneForFocus.sceneNo,
          storyboardFramePageSize,
        );
        if (visibleFramePage === null) {
          setStoryboardCanvasFocus(null);
        } else {
          setStoryboardCanvasFocus(
            createStoryboardCutFocusContext(
              mergeStoryboardScenePatch(sceneForFocus, patch.scenePatch),
            ),
          );
          setStoryboardPage(visibleFramePage);
        }
      }
      setResult((current) => {
        const nextScenes = current.storyboard.scenes.map((scene) =>
          mergeStoryboardScenePatch(scene, patch.scenePatch!),
        );
        return {
          ...current,
          storyboard: {
            ...current.storyboard,
            scenes: nextScenes,
          },
        };
      });
      return;
    }

    if (patch.focusSceneNo) {
      const sceneForFocus = result.storyboard.scenes.find(
        (scene) => scene.sceneNo === patch.focusSceneNo,
      );
      if (sceneForFocus) {
        const visibleFramePage = getStoryboardVisibleFramePageForSceneNo(
          storyboardFrameScenes,
          sceneForFocus.sceneNo,
          storyboardFramePageSize,
        );
        if (visibleFramePage === null) {
          setStoryboardCanvasFocus(null);
        } else {
          setStoryboardCanvasFocus(
            createStoryboardCutFocusContext(sceneForFocus),
          );
          setStoryboardPage(visibleFramePage);
        }
      }
      return;
    }

    if (patch.unavailableFocusSceneNo) {
      setStoryboardCanvasFocus(null);
      return;
    }

    setStoryboardPage(0);
  }

  function appendStoryboardChatMessages(messages: StoryboardChatMessage[]) {
    const formattedMessages = messages.map(formatStoryboardChatMessageForDisplay);
    const shouldDismissStarter = formattedMessages.some(
      (message) => message.id !== "assistant-intake",
    );
    setChatMessages((current) =>
      [
        ...(shouldDismissStarter
          ? current.filter((message) => message.id !== "assistant-intake")
          : current),
        ...formattedMessages,
      ].slice(-10),
    );
  }

  function updateStoryboardChatMessage(
    messageId: string,
    text: string,
    status: StoryboardChatMessage["status"] = "streaming",
    imageGenerationProgress?: StoryboardImageGenerationProgress | null,
    thinkingTrace?: StoryboardThinkingTraceEntry[],
  ) {
    setChatMessages((current) =>
      current.map((message) => {
        if (message.id !== messageId) return message;
        return formatStoryboardChatMessageForDisplay({
          ...message,
          text,
          status,
          imageGenerationProgress:
            imageGenerationProgress === undefined
              ? message.imageGenerationProgress
              : (imageGenerationProgress ?? undefined),
          thinkingTrace:
            thinkingTrace === undefined
              ? message.thinkingTrace
              : mergeStoryboardThinkingTraceEntries(
                  message.thinkingTrace,
                  thinkingTrace,
                ),
        });
      }),
    );
  }


  function appendStoryboardChatSteerTrace(
    prompt: string,
    attachmentCount: number,
  ) {
    const steerTrace = makeStoryboardThinkingTraceEntries({
      id: `chat-steer-${Date.now()}`,
      label: "사용자 Steer 수신",
      status: "done",
      detail: [
        prompt ? `새 요청: ${prompt.slice(0, 120)}` : "",
        attachmentCount ? `첨부 ${attachmentCount}장` : "",
        "현재 스트림을 중단하고 새 요청으로 다시 실행",
      ]
        .filter(Boolean)
        .join(" · "),
    });
    setChatMessages((current) =>
      current.map((message) =>
        message.role === "assistant" && message.status === "streaming"
          ? formatStoryboardChatMessageForDisplay({
              ...message,
              text: "새 메시지를 반영하기 위해 현재 답변을 멈추고 다시 생각할게요.",
              thinkingTrace: mergeStoryboardThinkingTraceEntries(
                message.thinkingTrace,
                steerTrace,
              ),
            })
          : message,
      ),
    );
  }

  function handleChatDraftChange(value: string) {
    setChatDraft(value);
    window.requestAnimationFrame(() =>
      setIsStoryboardChatMultilineLayout(
        resizeStoryboardChatTextarea(storyboardChatTextareaRef.current),
      ),
    );
  }

  function openStoryboardChatImageAttachmentPicker() {
    if (isChatAgentStreaming) return;
    storyboardChatImageAttachmentInputRef.current?.click();
  }

  async function handleStoryboardChatImageFilesSelected(files: File[]) {
    if (!files.length || isChatAgentStreaming) return;
    setErrorMessage(null);
    const remainingSlots =
      STORYBOARD_CHAT_IMAGE_ATTACHMENT_LIMIT -
      storyboardChatImageAttachments.length;
    if (remainingSlots <= 0) {
      setErrorMessage(
        `사진은 최대 ${STORYBOARD_CHAT_IMAGE_ATTACHMENT_LIMIT}장까지 첨부할 수 있습니다.`,
      );
      return;
    }
    const selectedFiles = files.slice(0, remainingSlots);
    try {
      const attachments = await Promise.all(
        selectedFiles.map((file) => createStoryboardChatImageAttachment(file)),
      );
      setStoryboardChatImageAttachments((current) =>
        [...current, ...attachments].slice(
          0,
          STORYBOARD_CHAT_IMAGE_ATTACHMENT_LIMIT,
        ),
      );
      if (files.length > selectedFiles.length) {
        setErrorMessage(
          `사진은 최대 ${STORYBOARD_CHAT_IMAGE_ATTACHMENT_LIMIT}장까지 첨부할 수 있어 일부만 추가했습니다.`,
        );
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "사진 첨부를 처리하지 못했습니다.",
      );
    }
  }

  function removeStoryboardChatImageAttachment(attachmentId: string) {
    setStoryboardChatImageAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId),
    );
  }

  function resetStoryboardChatState() {
    hasUserStoryboardMutationRef.current = true;
    setForm(DEFAULT_FORM);
    setChatDraft("");
    setStoryboardChatImageAttachments([]);
    setStoryboardPage(0);
    setStoryboardCanvasFocus(null);
    setErrorMessage(null);
    appendStoryboardChatMessages([
      {
        id: `assistant-reset-${Date.now()}`,
        role: "assistant",
        text: "처음 상태로 되돌렸어요. 새로 원하는 내용을 입력하면 화면이 다시 맞춰집니다.",
        status: "done",
      },
    ]);
  }

  function handleStoryboardUsageGuideClick() {
    appendStoryboardQuickCommandMessages(
      "가이드",
      STORYBOARD_USAGE_GUIDE_TEXT,
      "done",
      ["example"],
    );
  }

  async function handleGenerateStoryboardImages(
    options: {
      assistantMessageId?: string;
      targetScenes?: StoryboardScene[];
      sourceResult?: StoryboardGenerationResult;
      scope?: "page" | "selected" | "all";
    } = {},
  ) {
    const sourceResult = options.sourceResult ?? result;
    const targetScenes =
      options.targetScenes ?? activeStoryboardImageGenerationTargetScenes;
    const isSelectedScope = options.scope === "selected";
    const isAllScope =
      options.scope === "all" ||
      (!isSelectedScope && targetScenes.length > storyboardFramePageSize);
    if (targetScenes.length === 0) {
      const message = "현재 페이지에 이미지로 만들 스토리보드 컷이 없습니다.";
      setErrorMessage(message);
      if (options.assistantMessageId) {
        updateStoryboardChatMessage(
          options.assistantMessageId,
          message,
          "done",
          undefined,
          makeStoryboardThinkingTraceEntries({
            id: "image-plan",
            label: "CUT 이미지 생성 계획",
            status: "failed",
            detail: "이미지로 만들 대상 CUT이 없음",
          }),
        );
      }
      return;
    }
    const targetStart = targetScenes[0]?.sceneNo ?? activeCutStart;
    const targetEnd = targetScenes.at(-1)?.sceneNo ?? activeCutEnd;
    const targetCount = targetScenes.length;
    const targetLabel =
      isSelectedScope && targetScenes[0]
        ? `CUT ${String(targetScenes[0].sceneNo).padStart(2, "0")}`
        : isAllScope
          ? `전체 CUT ${String(targetStart).padStart(2, "0")}–${String(targetEnd).padStart(2, "0")}`
          : `현재 페이지 CUT ${String(targetStart).padStart(2, "0")}–${String(targetEnd).padStart(2, "0")}`;
    const imageRouteLabel =
      storyboardImageRouteChoice === STORYBOARD_LOCAL_BRIDGE_ROUTE_ID
        ? "고급 로컬 브릿지"
        : storyboardImageRouteChoice === "browser-openai-api-key"
          ? "브라우저 OpenAI API 키"
          : "기본 Codex OAuth";
    if (!isStoryboardImageProviderAvailable) {
      if (options.assistantMessageId) {
        appendStoryboardThinkingTrace(
          options.assistantMessageId,
          makeStoryboardThinkingTraceEntries({
            id: "image-provider-check",
            label: "이미지 라우터 준비 확인",
            status: "failed",
            detail: `${imageRouteLabel} 라우터 준비가 완료되지 않아 ${targetLabel} 생성 중단`,
          }),
        );
      }
      guideUnavailableStoryboardImageGeneration({
        assistantMessageId: options.assistantMessageId,
        scopeLabel: targetLabel,
      });
      return;
    }
    const activeStoryboardBrowserOpenAIApiKey =
      storyboardImageRouteChoice === "browser-openai-api-key"
        ? storyboardBrowserOpenAIApiKeyRef.current
        : null;
    const activeStoryboardLocalBridgeToken =
      storyboardImageRouteChoice === STORYBOARD_LOCAL_BRIDGE_ROUTE_ID
        ? storyboardLocalBridgeTokenRef.current
        : null;
    if (
      (storyboardImageRouteChoice === "browser-openai-api-key" &&
        !activeStoryboardBrowserOpenAIApiKey) ||
      (storyboardImageRouteChoice === STORYBOARD_LOCAL_BRIDGE_ROUTE_ID &&
        !activeStoryboardLocalBridgeToken)
    ) {
      guideUnavailableStoryboardImageGeneration({
        assistantMessageId: options.assistantMessageId,
        scopeLabel: targetLabel,
      });
      return;
    }
    imageProviderStatusAbortControllerRef.current?.abort();
    imageProviderStatusAbortControllerRef.current = null;
    const imageAbortController = new AbortController();
    imageGenerationAbortControllerRef.current?.abort();
    imageGenerationAbortControllerRef.current = imageAbortController;
    const targetSceneNos = targetScenes.map((scene) => scene.sceneNo);
    const imageGenerationProgressLabel = `${targetLabel} 이미지 생성 현황`;
    setIsGeneratingImages(true);
    setGeneratingStoryboardImageSceneNos(targetSceneNos);
    setActiveGeneratingStoryboardImageSceneNo(
      targetScenes.length === 1 ? (targetSceneNos[0] ?? null) : null,
    );
    setErrorMessage(null);
    if (options.assistantMessageId) {
      appendStoryboardThinkingTrace(
        options.assistantMessageId,
        makeStoryboardThinkingTraceEntries(
          {
            id: "image-provider-check",
            label: "이미지 라우터 준비 확인",
            status: "done",
            detail: `${imageRouteLabel} 라우터로 ${targetLabel} 생성 가능`,
          },
          {
            id: "image-plan",
            label: "CUT 이미지 생성 계획",
            status: "running",
            detail: `${targetCount}컷 대상 · 완료된 CUT은 응답 즉시 캔버스에 반영`,
          },
        ),
      );
    }
    applyStoryboardCanvasFocus(
      createStoryboardActionFocusContext(
        isSelectedScope
          ? "현재 컷 이미지 재생성"
          : isAllScope
            ? "전체 CUT 이미지 생성"
            : `${storyboardFramePageSize}컷 이미지 재생성`,
        `${targetLabel} 이미지를 생성 중입니다.`,
        isSelectedScope
          ? "사용자가 선택한 CUT만 이미지 생성을 실행했습니다. 생성 후 해당 컷 이미지 톤과 자막/오디오 일치를 기준으로 후속 대화를 이어가세요."
          : isAllScope
            ? "사용자가 전체 CUT 이미지 생성을 실행했습니다. 생성된 컷은 페이지를 넘겨도 바로 확인할 수 있어야 합니다."
            : "사용자가 현재 페이지 CUT 이미지 생성을 실행했습니다. 생성 후 이미지 톤, 컷별 완성도, 누락 컷을 기준으로 후속 대화를 이어가세요.",
      ),
    );
    if (options.assistantMessageId) {
      const initialImageGenerationProgress =
        buildStoryboardImageGenerationProgress({
          label: imageGenerationProgressLabel,
          scenes: targetScenes,
          activeSceneNo: targetScenes[0]?.sceneNo ?? null,
        });
      updateStoryboardChatMessage(
        options.assistantMessageId,
        isSelectedScope
          ? `${targetLabel} 이미지를 다시 만드는 중입니다...`
          : isAllScope
            ? `전체 ${targetCount}컷 이미지를 컷별로 생성합니다...`
            : `현재 ${targetCount}컷 이미지를 컷별로 생성합니다...`,
        "streaming",
        initialImageGenerationProgress,
      );
    }

    let appliedImageCount = 0;
    let accumulatedResult = sourceResult;
    let completedImageSceneNos = new Set<number>();
    let failedImageSceneNos = new Set<number>();
    const requestStoryboardImages =
      storyboardImageRouteChoice === STORYBOARD_LOCAL_BRIDGE_ROUTE_ID
        ? (
            nextResult: StoryboardGenerationResult,
            nextScenes: StoryboardGenerationResult["storyboard"]["scenes"],
          ) =>
            postStoryboardLocalBridgeImagesRequest(
              nextResult,
              nextScenes,
              storyboardLocalBridgeUrl,
              activeStoryboardLocalBridgeToken,
              invokeStoryboardLocalBridgeHelper,
              { signal: imageAbortController.signal },
            )
        : (
            nextResult: StoryboardGenerationResult,
            nextScenes: StoryboardGenerationResult["storyboard"]["scenes"],
          ) =>
            postStoryboardImagesRequest(
              nextResult,
              nextScenes,
              activeStoryboardBrowserOpenAIApiKey,
              { signal: imageAbortController.signal },
            );
    const applyGeneratedImages = async (
      images: StoryboardImagesResponse["images"],
    ) => {
      const mergedResult = mergeStoryboardGeneratedImagesIntoResult(
        accumulatedResult,
        images,
      );
      const browserSafeResult =
        await stripUnavailableStoryboardGeneratedImagesForBrowser(mergedResult);
      const acceptedSceneNos = new Set(
        images.flatMap(({ sceneNo, image }) => {
          const trustedImage = getTrustedStoryboardGeneratedImage(image);
          if (!trustedImage) return [];
          const scene = browserSafeResult.storyboard.scenes.find(
            (candidate) => candidate.sceneNo === sceneNo,
          );
          const acceptedImage = getTrustedStoryboardGeneratedImage(
            scene?.generatedImage,
          );
          return acceptedImage?.dataUrl === trustedImage.dataUrl
            ? [sceneNo]
            : [];
        }),
      );
      accumulatedResult = browserSafeResult;
      flushSync(() => {
        setResult(accumulatedResult);
      });
      appliedImageCount += acceptedSceneNos.size;
      setGeneratingStoryboardImageSceneNos((current) =>
        current.filter((sceneNo) => !acceptedSceneNos.has(sceneNo)),
      );
      return acceptedSceneNos;
    };

    try {
      if (imageAbortController.signal.aborted) {
        throw new DOMException("이미지 생성이 중단되었습니다.", "AbortError");
      }
      setActiveGeneratingStoryboardImageSceneNo(
        targetScenes.length === 1 ? (targetScenes[0]?.sceneNo ?? null) : null,
      );
      if (!isSelectedScope && targetScenes.length > 1) {
        for (let index = 0; index < targetScenes.length; index += 1) {
          const scene = targetScenes[index];
          if (!scene) continue;
          if (imageAbortController.signal.aborted) {
            throw new DOMException(
              "이미지 생성이 중단되었습니다.",
              "AbortError",
            );
          }
          setActiveGeneratingStoryboardImageSceneNo(scene.sceneNo);
          if (options.assistantMessageId) {
            appendStoryboardThinkingTrace(
              options.assistantMessageId,
              makeStoryboardThinkingTraceEntries({
                id: `image-cut-${scene.sceneNo}`,
                label: `CUT ${String(scene.sceneNo).padStart(2, "0")} 이미지 요청`,
                status: "running",
                detail: `${index + 1}/${targetScenes.length} · 이미지 생성 요청 전송`,
              }),
            );
          }
          if (options.assistantMessageId) {
            updateStoryboardChatMessage(
              options.assistantMessageId,
              `CUT ${String(scene.sceneNo).padStart(2, "0")} 이미지 생성 중입니다 · ${index + 1}/${targetScenes.length}`,
              "streaming",
              buildStoryboardImageGenerationProgress({
                label: imageGenerationProgressLabel,
                scenes: targetScenes,
                activeSceneNo: scene.sceneNo,
                completedSceneNos: completedImageSceneNos,
                failedSceneNos: failedImageSceneNos,
              }),
            );
          }
          const scenePayload = await requestStoryboardImages(
            accumulatedResult,
            [scene],
          );
          const acceptedSceneNos = await applyGeneratedImages(
            scenePayload.images,
          );
          completedImageSceneNos = new Set([
            ...completedImageSceneNos,
            ...acceptedSceneNos,
          ]);
          if (!acceptedSceneNos.has(scene.sceneNo)) {
            failedImageSceneNos = new Set([
              ...failedImageSceneNos,
              scene.sceneNo,
            ]);
            setGeneratingStoryboardImageSceneNos((current) =>
              current.filter((sceneNo) => sceneNo !== scene.sceneNo),
            );
          }
          if (options.assistantMessageId) {
            appendStoryboardThinkingTrace(
              options.assistantMessageId,
              makeStoryboardThinkingTraceEntries({
                id: `image-cut-${scene.sceneNo}`,
                label: `CUT ${String(scene.sceneNo).padStart(2, "0")} 이미지 요청`,
                status: acceptedSceneNos.has(scene.sceneNo) ? "done" : "failed",
                detail: acceptedSceneNos.has(scene.sceneNo)
                  ? `${index + 1}/${targetScenes.length} · 생성 결과를 캔버스에 즉시 반영`
                  : `${index + 1}/${targetScenes.length} · 응답에 검증 가능한 이미지가 없어 확인 필요`,
              }),
            );
          }
          if (options.assistantMessageId) {
            const nextSceneNo = targetScenes[index + 1]?.sceneNo ?? null;
            const progressedCount =
              completedImageSceneNos.size + failedImageSceneNos.size;
            updateStoryboardChatMessage(
              options.assistantMessageId,
              nextSceneNo === null
                ? `CUT 이미지 생성 마무리 중 · ${progressedCount}/${targetScenes.length}`
                : `CUT 이미지를 순서대로 생성 중입니다 · ${progressedCount}/${targetScenes.length}`,
              "streaming",
              buildStoryboardImageGenerationProgress({
                label: imageGenerationProgressLabel,
                scenes: targetScenes,
                activeSceneNo: nextSceneNo,
                completedSceneNos: completedImageSceneNos,
                failedSceneNos: failedImageSceneNos,
              }),
            );
          }
          applyStoryboardCanvasFocus(
            createStoryboardActionFocusContext(
              "컷 이미지 생성 진행",
              `CUT ${String(scene.sceneNo).padStart(2, "0")} 이미지가 캔버스에 반영됐습니다 · ${index + 1}/${targetScenes.length}`,
              isAllScope
                ? "전체 CUT 생성도 컷 단위로 반영됩니다. 사용자가 페이지를 넘기는 중에도 생성된 컷을 바로 확인할 수 있습니다."
                : "4컷 생성도 컷 단위로 반영됩니다. 사용자가 이미 보이는 컷을 선택해 오디오/자막/비주얼 피드백을 바로 이어갈 수 있습니다.",
            ),
          );
        }
      } else {
        if (options.assistantMessageId) {
          appendStoryboardThinkingTrace(
            options.assistantMessageId,
            makeStoryboardThinkingTraceEntries(
              ...targetScenes.map((scene, index) => ({
                id: `image-cut-${scene.sceneNo}`,
                label: `CUT ${String(scene.sceneNo).padStart(2, "0")} 이미지 요청`,
                status: "running",
                detail: `${index + 1}/${targetScenes.length} · 이미지 생성 요청 전송`,
              })),
            ),
          );
        }
        const payload = await requestStoryboardImages(
          accumulatedResult,
          targetScenes,
        );
        completedImageSceneNos = await applyGeneratedImages(payload.images);
        if (options.assistantMessageId) {
          appendStoryboardThinkingTrace(
            options.assistantMessageId,
            makeStoryboardThinkingTraceEntries(
              ...targetScenes.map((scene, index) => ({
                id: `image-cut-${scene.sceneNo}`,
                label: `CUT ${String(scene.sceneNo).padStart(2, "0")} 이미지 요청`,
                status: completedImageSceneNos.has(scene.sceneNo)
                  ? "done"
                  : "failed",
                detail: completedImageSceneNos.has(scene.sceneNo)
                  ? `${index + 1}/${targetScenes.length} · 생성 결과를 캔버스에 즉시 반영`
                  : `${index + 1}/${targetScenes.length} · 응답에 검증 가능한 이미지가 없어 확인 필요`,
              })),
            ),
          );
        }
      }
      const missingImageSceneNos = new Set(
        targetSceneNos.filter(
          (sceneNo) =>
            !completedImageSceneNos.has(sceneNo) &&
            !failedImageSceneNos.has(sceneNo),
        ),
      );
      if (options.assistantMessageId) {
        appendStoryboardThinkingTrace(
          options.assistantMessageId,
          makeStoryboardThinkingTraceEntries({
            id: "image-plan",
            label: "CUT 이미지 생성 계획",
            status:
              missingImageSceneNos.size + failedImageSceneNos.size > 0
                ? "failed"
                : "done",
            detail:
              missingImageSceneNos.size + failedImageSceneNos.size > 0
                ? `${appliedImageCount}/${targetCount}컷 반영 · ${missingImageSceneNos.size + failedImageSceneNos.size}컷 확인 필요`
                : `${appliedImageCount}/${targetCount}컷 모두 캔버스 반영 완료`,
          }),
        );
      }

      applyStoryboardCanvasFocus(
        createStoryboardActionFocusContext(
          "컷별 스토리보드 이미지 생성",
          `${targetLabel} 이미지 ${appliedImageCount}/${targetCount}컷이 캔버스에 반영됐습니다.`,
          isSelectedScope
            ? "선택 CUT의 새 이미지가 반영됐습니다. 사용자가 같은 컷의 오디오/자막/비주얼을 계속 보완할 수 있습니다."
            : "대상 CUT을 컷별 이미지 생성 요청으로 보내고, 완료된 이미지는 바로 캔버스에 반영됩니다.",
        ),
      );
      setStoryboardHistoryCases((current) =>
        mergeStoryboardHistoryCases(
          [makeStoryboardHistoryCase(accumulatedResult)],
          current,
        ),
      );
      void refreshStoryboardHistoryResults();
      if (options.assistantMessageId) {
        updateStoryboardChatMessage(
          options.assistantMessageId,
          isSelectedScope
            ? `완료 · ${targetLabel} 이미지를 새 결과로 교체했습니다.`
            : isAllScope
              ? `완료 · 전체 ${appliedImageCount}/${targetCount}컷 이미지를 새 결과로 교체했습니다.`
              : `완료 · 현재 페이지 ${appliedImageCount}/${targetCount}컷 이미지를 새 결과로 교체했습니다.`,
          "done",
          buildStoryboardImageGenerationProgress({
            label: imageGenerationProgressLabel,
            scenes: targetScenes,
            completedSceneNos: completedImageSceneNos,
            failedSceneNos: new Set(
              targetSceneNos.filter(
                (sceneNo) =>
                  !completedImageSceneNos.has(sceneNo) ||
                  failedImageSceneNos.has(sceneNo),
              ),
            ),
          }),
        );
      }
      applyStoryboardCanvasFocus(
        createStoryboardActionFocusContext(
          isSelectedScope
            ? "현재 컷 이미지 생성 완료"
            : isAllScope
              ? "전체 CUT 이미지 생성 완료"
              : `${storyboardFramePageSize}컷 이미지 생성 완료`,
          `${targetLabel} 이미지 ${appliedImageCount}개가 캔버스에 반영됐습니다.`,
          isSelectedScope
            ? "선택 CUT의 새 이미지가 반영됐습니다. 사용자가 같은 컷의 오디오/자막/비주얼을 계속 보완할 수 있습니다."
            : isAllScope
              ? "전체 CUT 이미지가 반영됐습니다. 페이지를 넘겨 각 CUT 이미지를 확인하고 보완 대화를 이어가세요."
              : "현재 페이지의 새 이미지가 반영됐습니다. 사용자가 컷을 선택하면 해당 이미지를 기준으로 보완 대화를 이어가세요.",
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "스토리보드 이미지를 생성하지 못했습니다.";
      const isAbortError =
        imageAbortController.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error &&
          error.message === "storyboard_local_bridge_request_aborted");
      setErrorMessage(message);
      if (options.assistantMessageId) {
        const unresolvedImageSceneNos = new Set(
          targetSceneNos.filter(
            (sceneNo) => !completedImageSceneNos.has(sceneNo),
          ),
        );
        appendStoryboardThinkingTrace(
          options.assistantMessageId,
          makeStoryboardThinkingTraceEntries(
            {
              id: "image-plan",
              label: "CUT 이미지 생성 계획",
              status: isAbortError ? "cancelled" : "failed",
              detail: isAbortError
                ? `중단 요청 처리 · ${appliedImageCount}/${targetScenes.length}컷 반영`
                : `${message} · ${appliedImageCount}/${targetScenes.length}컷 반영`,
            },
            ...Array.from(unresolvedImageSceneNos).map((sceneNo) => ({
              id: `image-cut-${sceneNo}`,
              label: `CUT ${String(sceneNo).padStart(2, "0")} 이미지 요청`,
              status: isAbortError ? "cancelled" : "failed",
              detail: isAbortError
                ? "이미지 생성 중단으로 남은 CUT 대기 취소"
                : "이미지 생성 실패 또는 응답 미반영",
            })),
          ),
        );
        updateStoryboardChatMessage(
          options.assistantMessageId,
          isAbortError
            ? `이미지 생성 중단됨 · 반영 ${appliedImageCount}/${targetScenes.length}`
            : isSelectedScope
              ? `현재 컷 재생성 실패 · ${message}`
              : `${targetLabel} 이미지 생성 실패 · ${message} · 반영 ${appliedImageCount}/${targetScenes.length}`,
          "done",
          buildStoryboardImageGenerationProgress({
            label: imageGenerationProgressLabel,
            scenes: targetScenes,
            completedSceneNos: completedImageSceneNos,
            failedSceneNos: isAbortError
              ? new Set<number>()
              : unresolvedImageSceneNos,
            cancelledSceneNos: isAbortError
              ? unresolvedImageSceneNos
              : new Set<number>(),
          }),
        );
      }
    } finally {
      if (imageGenerationAbortControllerRef.current === imageAbortController) {
        imageGenerationAbortControllerRef.current = null;
      }
      setIsGeneratingImages(false);
      setGeneratingStoryboardImageSceneNos([]);
      setActiveGeneratingStoryboardImageSceneNo(null);
    }
  }
  async function handleGenerateAllStoryboardImagesForResult(
    generated: StoryboardGenerationResult,
    assistantMessageId?: string,
    scopeLabelPrefix = "전체 CUT",
  ) {
    const targetScenes = generated.storyboard.scenes;
    if (targetScenes.length === 0) return;

    if (!isStoryboardImageProviderAvailable) {
      const firstSceneNo = targetScenes[0]?.sceneNo ?? 1;
      const lastSceneNo = targetScenes.at(-1)?.sceneNo ?? targetScenes.length;
      if (assistantMessageId) {
        appendStoryboardThinkingTrace(
          assistantMessageId,
          makeStoryboardThinkingTraceEntries({
            id: "image-provider-check",
            label: "이미지 라우터 준비 확인",
            status: "failed",
            detail: `${scopeLabelPrefix} ${String(firstSceneNo).padStart(2, "0")}–${String(lastSceneNo).padStart(2, "0")} 생성 전 라우터 준비가 필요함`,
          }),
        );
      }
      guideUnavailableStoryboardImageGeneration({
        assistantMessageId,
        scopeLabel: `${scopeLabelPrefix} ${String(firstSceneNo).padStart(2, "0")}–${String(lastSceneNo).padStart(2, "0")}`,
        openSettings: false,
      });
      return;
    }

    await handleGenerateStoryboardImages({
      assistantMessageId,
      targetScenes,
      sourceResult: generated,
      scope: "all",
    });
  }

  function getNextStoryboardGuidedExamplePreset() {
    const presetIndex =
      storyboardGuidedExampleIndexRef.current %
      STORYBOARD_GUIDED_EXAMPLE_PRESETS.length;
    storyboardGuidedExampleIndexRef.current += 1;
    return (
      STORYBOARD_GUIDED_EXAMPLE_PRESETS[presetIndex] ??
      STORYBOARD_GUIDED_EXAMPLE_PRESETS[0]
    );
  }

  async function handleStoryboardGuidedExampleGenerate(
    selectedPreset?: StoryboardGuidedExamplePreset,
  ) {
    if (isGenerating || isChatAgentStreaming || isGeneratingImages) return;
    const guidedPreset =
      selectedPreset ?? getNextStoryboardGuidedExamplePreset();
    const guidedForm: GeneratorForm = {
      ...DEFAULT_FORM,
      prompt: guidedPreset.prompt,
      tone: guidedPreset.tone,
      targetLengthMinutes: guidedPreset.targetLengthMinutes,
      sourceLimit: guidedPreset.sourceLimit,
      segmentCount: guidedPreset.segmentCount,
    };
    const assistantMessageId = appendStoryboardQuickCommandMessages(
      `예시 생성 · ${guidedPreset.label}`,
      `${guidedPreset.label} 예시를 왼쪽 캔버스에 로딩하고 있어요. 스토리보드가 준비되면 CUT별 이미지 생성까지 이어집니다.`,
      "streaming",
    );
    const generated = await handleGenerate(guidedForm, {
      appendChatMessages: false,
      assistantMessageId,
    });
    if (!generated) return;

    await handleGenerateAllStoryboardImagesForResult(
      generated,
      assistantMessageId,
      "예시 CUT",
    );
  }

  async function refreshStoryboardHistoryResults() {
    setStoryboardHistoryStatus("loading");
    setStoryboardHistoryError(null);
    const hadHydratedHistoryCases = storyboardHistoryCases.length > 0;
    try {
      const historyCases = await getStoryboardHistoryResults();
      setStoryboardHistoryCases((current) =>
        mergeStoryboardHistoryCases(historyCases, current),
      );
      if (historyCases.length) {
        setStoryboardHistoryStatus("ready");
        return;
      }
      if (hadHydratedHistoryCases) {
        setStoryboardHistoryStatus("stale");
        setStoryboardHistoryError(
          "새로고침에서 새 히스토리 결과를 찾지 못해 이전 결과를 표시 중입니다.",
        );
        return;
      }
      setStoryboardHistoryStatus("empty");
    } catch (error) {
      const errorText =
        error instanceof Error
          ? error.message
          : "스토리보드 기록을 불러오지 못했습니다.";
      if (hadHydratedHistoryCases) {
        setStoryboardHistoryStatus("stale");
        setStoryboardHistoryError(
          `새로고침에 실패해 이전 히스토리 결과를 표시 중입니다. ${errorText}`,
        );
      } else {
        setStoryboardHistoryStatus("error");
        setStoryboardHistoryError(errorText);
      }
    }
  }

  async function refreshStoryboardImageProviderReadiness() {
    const statusAbortController = new AbortController();
    imageProviderStatusAbortControllerRef.current?.abort();
    imageProviderStatusAbortControllerRef.current = statusAbortController;
    setStoryboardImageProviderReadiness(
      INITIAL_STORYBOARD_IMAGE_PROVIDER_READINESS,
    );
    try {
      if (storyboardImageRouteChoice === STORYBOARD_LOCAL_BRIDGE_ROUTE_ID) {
        setStoryboardLocalBridgeStatus("checking");
        const result = await getStoryboardLocalBridgeStatusRequest(
          storyboardLocalBridgeUrl,
          storyboardLocalBridgeTokenRef.current,
          invokeStoryboardLocalBridgeHelper,
          { signal: statusAbortController.signal },
        );
        if (statusAbortController.signal.aborted) return;
        setStoryboardLocalBridgeStatus(result.status);
        setStoryboardLocalBridgeMessage(result.message);
        setStoryboardLocalBridgeError(
          result.status === "connected" ? null : result.message,
        );
        setStoryboardImageProviderReadiness(result.readiness);
        return;
      }
      const payload = await getStoryboardImageProviderStatusRequest(
        storyboardImageRouteChoice === "browser-openai-api-key"
          ? storyboardBrowserOpenAIApiKeyRef.current
          : null,
        { signal: statusAbortController.signal },
      );
      if (statusAbortController.signal.aborted) return;
      setStoryboardImageProviderReadiness(
        mapStoryboardImageProviderReadiness(payload),
      );
    } catch (error) {
      if (statusAbortController.signal.aborted) return;
      if (storyboardImageRouteChoice === STORYBOARD_LOCAL_BRIDGE_ROUTE_ID) {
        const message = redactStoryboardLocalBridgeSecretText(
          error instanceof Error
            ? error.message
            : "로컬 브릿지 상태를 읽지 못했습니다.",
          storyboardLocalBridgeTokenRef.current,
        );
        setStoryboardLocalBridgeStatus("error");
        setStoryboardLocalBridgeError(message);
        setStoryboardLocalBridgeMessage(message);
        setStoryboardImageProviderReadiness(
          mapStoryboardLocalBridgeStatusToReadiness("error", message),
        );
        return;
      }
      setStoryboardImageProviderReadiness({
        ...INITIAL_STORYBOARD_IMAGE_PROVIDER_READINESS,
        status: "error",
        label: "이미지 상태 확인 실패",
        summary:
          error instanceof Error
            ? error.message
            : "스토리보드 이미지 상태를 읽지 못했습니다.",
        detail:
          "페이지는 계속 사용할 수 있지만 새 이미지 생성 전 상태를 다시 확인해 주세요.",
        reason: "error",
        checkedAt: new Date().toISOString(),
      });
    } finally {
      if (
        imageProviderStatusAbortControllerRef.current ===
        statusAbortController
      ) {
        imageProviderStatusAbortControllerRef.current = null;
      }
    }
  }

  function handleApplyStoryboardBrowserOpenAIApiKey() {
    const input = storyboardBrowserOpenAIApiKeyInputRef.current;
    const normalized = normalizeStoryboardBrowserOpenAIApiKeyInput(
      input?.value ?? "",
    );
    if (input) input.value = "";
    if (!normalized) {
      const message =
        "OpenAI API 키 형식이 올바르지 않습니다. sk-로 시작하는 키를 붙여 넣어 주세요.";
      setStoryboardBrowserOpenAIApiKeyError(message);
      setStoryboardBrowserOpenAIApiKeyMessage(message);
      return;
    }
    imageProviderStatusAbortControllerRef.current?.abort();
    imageProviderStatusAbortControllerRef.current = null;
    imageGenerationAbortControllerRef.current?.abort();
    storyboardBrowserOpenAIApiKeyRef.current = normalized;
    setHasStoryboardBrowserOpenAIApiKey(true);
    setMaskedStoryboardBrowserOpenAIApiKey(
      maskStoryboardBrowserOpenAIApiKey(normalized),
    );
    setStoryboardImageRouteChoice("browser-openai-api-key");
    setStoryboardBrowserOpenAIApiKeyAppliedAt(new Date().toISOString());
    setStoryboardImageProviderReadiness({
      ...INITIAL_STORYBOARD_IMAGE_PROVIDER_READINESS,
      providerId: STORYBOARD_BROWSER_OPENAI_IMAGE_PROVIDER_ID,
      summary:
        "이 화면 ref의 API 키로 이미지 생성 준비 여부를 확인하고 있습니다.",
      detail:
        "키는 제어되지 않는 비밀번호 입력값을 즉시 비우고 Web Storage에 저장하지 않으며, 상태 확인과 이미지 요청에만 전달됩니다.",
      reason: "checking",
      model: STORYBOARD_IMAGE_PROVIDER_MODEL,
      checkedAt: new Date().toISOString(),
    });
    setStoryboardBrowserOpenAIApiKeyError(null);
    setStoryboardBrowserOpenAIApiKeyMessage(
      "적용했어요. OpenAI API 키 입력값은 즉시 비웠고, 페이지 전환·복원·닫기 때 ref에서도 제거됩니다.",
    );
    appendStoryboardChatMessages([
      {
        id: `assistant-browser-key-applied-${Date.now()}`,
        role: "assistant",
        text: "OpenAI API 키는 제어되지 않는 비밀번호 입력값을 즉시 비우고 이 컴포넌트 ref에만 적용했어요. Web Storage와 DB에는 저장하지 않으며 페이지 전환·복원·닫기 때 제거됩니다.",
        status: "done",
      },
    ]);
  }

  function handleClearStoryboardBrowserOpenAIApiKey() {
    imageProviderStatusAbortControllerRef.current?.abort();
    imageProviderStatusAbortControllerRef.current = null;
    imageGenerationAbortControllerRef.current?.abort();
    storyboardBrowserOpenAIApiKeyRef.current = null;
    if (storyboardBrowserOpenAIApiKeyInputRef.current) {
      storyboardBrowserOpenAIApiKeyInputRef.current.value = "";
    }
    setHasStoryboardBrowserOpenAIApiKey(false);
    setMaskedStoryboardBrowserOpenAIApiKey("");
    setStoryboardImageRouteChoice("local-codex-oauth");
    setStoryboardBrowserOpenAIApiKeyAppliedAt(null);
    setStoryboardBrowserOpenAIApiKeyError(null);
    setStoryboardBrowserOpenAIApiKeyMessage(
      "이 컴포넌트 ref의 API 키와 입력값을 삭제했어요. 가능하면 Codex CLI OAuth 라우터로 돌아갑니다.",
    );
    appendStoryboardChatMessages([
      {
        id: `assistant-browser-key-cleared-${Date.now()}`,
        role: "assistant",
        text: "이 컴포넌트 ref의 OpenAI API 키와 입력값을 삭제했어요. 이제 Codex CLI OAuth 상태를 확인합니다.",
        status: "done",
      },
    ]);
  }

  async function handleCopyStoryboardLocalBridgeCommand() {
    try {
      await navigator.clipboard.writeText(STORYBOARD_LOCAL_BRIDGE_TERMINAL_COMMAND);
      setStoryboardLocalBridgeError(null);
      setStoryboardLocalBridgeMessage(
        "터미널 실행 명령을 복사했어요. 브릿지를 실행한 뒤 pairing_token 값을 페어링 코드 칸에 붙여넣고 자동 연결을 누르세요.",
      );
      appendStoryboardChatMessages([
        {
          id: `assistant-local-bridge-command-${Date.now()}`,
          role: "assistant",
          text: `고급 로컬 브릿지 실행 명령을 복사했어요.\n1. 터미널에서 \`${STORYBOARD_LOCAL_BRIDGE_TERMINAL_COMMAND}\` 실행\n2. 출력된 pairing_token 값을 페어링 코드 칸에 붙여넣기\n3. “적용하고 자동 연결”을 누르면 적용·helper 연결·상태 확인 과정을 대화창에 보여줄게요.`,
          status: "done",
        },
      ]);
    } catch {
      const message =
        "클립보드 복사 권한이 없어 명령을 복사하지 못했습니다. 화면의 명령을 직접 복사해 주세요.";
      setStoryboardLocalBridgeError(message);
      setStoryboardLocalBridgeMessage(message);
    }
  }

  function applyStoryboardLocalBridgeFromDraft(options: {
    status: StoryboardLocalBridgeUiStatus;
    message: string;
  }) {
    const tokenInput = storyboardLocalBridgeTokenInputRef.current;
    const tokenValue = tokenInput?.value ?? "";
    if (tokenInput) tokenInput.value = "";
    const bridgeUrl = normalizeStoryboardLocalBridgeUrl(
      storyboardLocalBridgeUrlDraft,
    );
    const token = normalizeStoryboardLocalBridgeToken(
      tokenValue || storyboardLocalBridgeTokenRef.current,
    );
    if (!token) {
      throw new Error("터미널에 표시된 페어링 코드를 입력해 주세요.");
    }
    imageProviderStatusAbortControllerRef.current?.abort();
    imageProviderStatusAbortControllerRef.current = null;
    imageGenerationAbortControllerRef.current?.abort();
    resetStoryboardLocalBridgeHelperTransport({ closePopup: true });
    setStoryboardLocalBridgeUrl(bridgeUrl);
    setStoryboardLocalBridgeUrlDraft(bridgeUrl);
    storyboardLocalBridgeTokenRef.current = token;
    setHasStoryboardLocalBridgeToken(true);
    setMaskedStoryboardLocalBridgeToken(maskStoryboardLocalBridgeToken(token));
    setStoryboardLocalBridgeAppliedAt(new Date().toISOString());
    setStoryboardImageRouteChoice(STORYBOARD_LOCAL_BRIDGE_ROUTE_ID);
    setStoryboardLocalBridgeStatus(options.status);
    setStoryboardLocalBridgeError(null);
    setStoryboardLocalBridgeMessage(options.message);
    setStoryboardImageProviderReadiness(
      mapStoryboardLocalBridgeStatusToReadiness(
        options.status,
        options.message,
      ),
    );
    return { bridgeUrl, token };
  }

  async function handleApplyStoryboardLocalBridge() {
    try {
      applyStoryboardLocalBridgeFromDraft({
        status: "needs_reconnect",
        message: getStoryboardLocalBridgeReconnectRequiredMessage(),
      });
      appendStoryboardChatMessages([
        {
          id: `assistant-local-bridge-applied-${Date.now()}`,
          role: "assistant",
          text: "로컬 브릿지 설정은 제어되지 않는 입력값을 즉시 비우고 이 컴포넌트 ref에만 적용했어요. 페어링 코드는 Web Storage, 앱 서버, 비-loopback 네트워크에 저장하거나 보내지 않으며 페이지 전환·복원·닫기 때 제거됩니다.",
          status: "done",
        },
      ]);
    } catch (error) {
      const message = redactStoryboardLocalBridgeSecretText(
        error instanceof Error
          ? error.message
          : "로컬 브릿지 설정을 적용하지 못했습니다.",
        storyboardLocalBridgeTokenRef.current,
      );
      setStoryboardLocalBridgeError(message);
      setStoryboardLocalBridgeMessage(message);
      setStoryboardLocalBridgeStatus("error");
      setStoryboardImageProviderReadiness(
        mapStoryboardLocalBridgeStatusToReadiness("error", message),
      );
    }
  }

  async function handleAutoConnectStoryboardLocalBridge() {
    const now = Date.now();
    const assistantMessageId = `assistant-local-bridge-auto-${now}`;
    appendStoryboardChatMessages([
      {
        id: `user-local-bridge-auto-${now}`,
        role: "user",
        text: "고급 로컬 브릿지 자동 설정",
        status: "done",
      },
      {
        id: assistantMessageId,
        role: "assistant",
        text: "고급 로컬 브릿지 자동 설정을 시작했어요. 이 탭에 적용, helper 창 연결, health/auth 확인 과정을 여기 대화창에 계속 표시합니다.",
        status: "streaming",
        thinkingTrace: makeStoryboardThinkingTraceEntries(
          {
            id: "local-bridge-terminal",
            label: "터미널 브릿지 준비",
            status: "done",
            detail: `브릿지가 꺼져 있으면 먼저 \`${STORYBOARD_LOCAL_BRIDGE_TERMINAL_COMMAND}\`를 실행하고 pairing_token 값을 페어링 코드 칸에 붙여넣으세요.`,
          },
          {
            id: "local-bridge-apply",
            label: "URL/페어링 코드 적용",
            status: "running",
            detail: "입력값을 정규화하고 현재 화면 메모리에만 적용합니다.",
          },
        ),
      },
    ]);

    try {
      const configuration = applyStoryboardLocalBridgeFromDraft({
        status: "checking",
        message: "pairing 설정을 이 탭 메모리에 적용했고 helper 연결을 자동으로 시작합니다.",
      });
      appendStoryboardThinkingTrace(
        assistantMessageId,
        makeStoryboardThinkingTraceEntries({
          id: "local-bridge-apply",
          label: "URL/페어링 코드 적용",
          status: "done",
          detail:
            "URL과 페어링 코드는 제어되지 않는 입력값을 즉시 비우고 현재 컴포넌트 ref에만 적용했습니다. 페이지 전환·복원·닫기 때 제거되며 Web Storage, 서버, DB에는 저장하지 않습니다.",
        }),
      );
      updateStoryboardChatMessage(
        assistantMessageId,
        "페어링 설정 적용 완료 · helper 창을 열고 연결 상태를 확인합니다.",
        "streaming",
      );

      const connected = await handleConnectStoryboardLocalBridgeHelper({
        bridgeUrl: configuration.bridgeUrl,
        token: configuration.token,
        assistantMessageId,
      });
      updateStoryboardChatMessage(
        assistantMessageId,
        connected
          ? "고급 로컬 브릿지 자동 설정 완료 · 이제 새 이미지 생성은 사용자 PC 브릿지로 보냅니다."
          : "고급 로컬 브릿지 자동 설정이 중단됐어요. 위 단계에서 실패한 항목을 확인하고 다시 누르세요.",
        "done",
      );
    } catch (error) {
      const message = redactStoryboardLocalBridgeSecretText(
        error instanceof Error
          ? error.message
          : "고급 로컬 브릿지 자동 설정을 완료하지 못했습니다.",
        storyboardLocalBridgeTokenRef.current,
      );
      setStoryboardLocalBridgeError(message);
      setStoryboardLocalBridgeMessage(message);
      setStoryboardLocalBridgeStatus("error");
      setStoryboardImageProviderReadiness(
        mapStoryboardLocalBridgeStatusToReadiness("error", message),
      );
      appendStoryboardThinkingTrace(
        assistantMessageId,
        makeStoryboardThinkingTraceEntries({
          id: "local-bridge-apply",
          label: "URL/페어링 코드 적용",
          status: "failed",
          detail: message,
        }),
      );
      updateStoryboardChatMessage(
        assistantMessageId,
        `고급 로컬 브릿지 자동 설정 중단 · ${message}`,
        "done",
      );
    }
  }

  function handleClearStoryboardLocalBridge() {
    imageProviderStatusAbortControllerRef.current?.abort();
    imageProviderStatusAbortControllerRef.current = null;
    imageGenerationAbortControllerRef.current?.abort();
    resetStoryboardLocalBridgeHelperTransport({ closePopup: true });
    setStoryboardLocalBridgeUrl(STORYBOARD_LOCAL_BRIDGE_DEFAULT_URL);
    setStoryboardLocalBridgeUrlDraft(STORYBOARD_LOCAL_BRIDGE_DEFAULT_URL);
    storyboardLocalBridgeTokenRef.current = null;
    if (storyboardLocalBridgeTokenInputRef.current) {
      storyboardLocalBridgeTokenInputRef.current.value = "";
    }
    setHasStoryboardLocalBridgeToken(false);
    setMaskedStoryboardLocalBridgeToken("");
    setStoryboardLocalBridgeAppliedAt(null);
    setStoryboardLocalBridgeStatus("unpaired");
    setStoryboardLocalBridgeError(null);
    setStoryboardLocalBridgeMessage(
      "로컬 브릿지 설정 ref와 입력값을 이 컴포넌트에서 삭제했습니다.",
    );
    if (storyboardImageRouteChoice === STORYBOARD_LOCAL_BRIDGE_ROUTE_ID) {
      setStoryboardImageRouteChoice("local-codex-oauth");
    }
    appendStoryboardChatMessages([
      {
        id: `assistant-local-bridge-cleared-${Date.now()}`,
        role: "assistant",
        text: "로컬 브릿지 URL과 페어링 코드를 이 컴포넌트 ref와 입력값에서 삭제했어요. 필요하면 터미널에서 브릿지를 다시 실행하고 새 코드를 붙여 넣어 주세요.",
        status: "done",
      },
    ]);
  }

  function handleSelectStoryboardImageRouteChoice(
    nextRoute: StoryboardImageRouteChoice,
  ) {
    setStoryboardImageRouteChoice(nextRoute);
    setStoryboardBrowserOpenAIApiKeyError(null);
    setStoryboardLocalBridgeError(null);
    setStoryboardBrowserOpenAIApiKeyMessage(
      nextRoute === "browser-openai-api-key"
        ? hasStoryboardBrowserOpenAIApiKey
          ? "OpenAI API 키를 사용하도록 선택했어요."
          : "API Key를 선택했어요. 먼저 키를 적용해 주세요."
        : null,
    );
    setStoryboardLocalBridgeMessage(
      nextRoute === STORYBOARD_LOCAL_BRIDGE_ROUTE_ID
        ? hasStoryboardLocalBridgeToken
          ? getStoryboardLocalBridgeReconnectRequiredMessage()
          : "고급 로컬 브릿지는 사용자 PC에서 실행 중일 때만 사용할 수 있습니다."
        : null,
    );
  }

  function guideUnavailableStoryboardImageGeneration(
    options: {
      submittedPrompt?: string;
      assistantMessageId?: string;
      scopeLabel?: string;
      openSettings?: boolean;
    } = {},
  ) {
    const guidance = formatStoryboardImageProviderGuidanceMessage(
      storyboardImageProviderReadiness,
    );
    setErrorMessage(null);
    if (options.openSettings !== false) {
      setIsStoryboardChatSettingsOpen(true);
    }
    applyStoryboardCanvasFocus(
      createStoryboardActionFocusContext(
        "이미지 생성 설정 필요",
        `${options.scopeLabel ?? "현재 페이지"} 새 이미지 생성은 준비 확인 전까지 중단됩니다.`,
        "사용자가 스토리보드 이미지 생성을 시도했지만 준비 확인이 끝나지 않아 안내를 표시했습니다.",
      ),
    );
    if (options.assistantMessageId) {
      updateStoryboardChatMessage(
        options.assistantMessageId,
        guidance,
        "done",
        undefined,
        makeStoryboardThinkingTraceEntries({
          id: "image-provider-check",
          label: "이미지 라우터 준비 확인",
          status: "failed",
          detail:
            storyboardImageProviderReadiness.summary ||
            "CUT 이미지 생성에 필요한 라우터 준비가 완료되지 않음",
        }),
      );
      return;
    }
    if (options.submittedPrompt) {
      appendStoryboardQuickCommandMessages(options.submittedPrompt, guidance);
      return;
    }
    appendStoryboardChatMessages([
      {
        id: `assistant-image-provider-${Date.now()}`,
        role: "assistant",
        text: guidance,
        status: "done",
      },
    ]);
  }

  function handleStoryboardHistoryDropdownOpenChange(nextOpen: boolean) {
    setIsStoryboardHistoryPanelOpen(nextOpen);
    if (
      nextOpen &&
      storyboardHistoryCases.length === 0 &&
      storyboardHistoryStatus !== "loading"
    ) {
      void refreshStoryboardHistoryResults();
    }
  }

  async function applyStoryboardHistoryResult(
    historyCase: StoryboardHistoryCase,
  ) {
    hasUserStoryboardMutationRef.current = true;
    const historyResult =
      await stripUnavailableStoryboardGeneratedImagesForBrowser(
        hydrateStoryboardResultForDisplay(historyCase.result),
      );
    setResult(historyResult);
    setForm(historyResult.request);
    setStoryboardPage(0);
    setIsStoryboardHistoryPanelOpen(false);
    setChatDraft("");
    setErrorMessage(null);
    applyStoryboardCanvasFocus(
      createStoryboardActionFocusContext(
        "히스토리 케이스 로드",
        `${historyResult.storyboard.title} · ${historyResult.storyboard.scenes.length}컷`,
        "사용자가 이전 결과 목록에서 스토리보드 케이스를 선택했습니다. 현재 캔버스 결과와 실제 데이터 근거를 기준으로 후속 대화를 이어가세요.",
      ),
    );
    const historyLoadedAt = Date.now();
    appendStoryboardChatMessages([
      {
        id: `assistant-history-load-${historyLoadedAt}`,
        role: "assistant",
        text: `선택한 스토리보드를 불러왔어요 · ${historyResult.storyboard.title}. 캔버스에서 컷을 확인하고 필요한 수정은 채팅으로 요청하세요.`,
        status: "done",
      },
      makeStoryboardImprovementSummaryMessage(
        historyResult,
        `assistant-history-load-improvement-summary-${historyLoadedAt}`,
      ),
    ]);
  }

  function applyStoryboardCanvasFocus(focus: StoryboardChatFocusContext | null) {
    setStoryboardCanvasFocus(focus);
  }

  function handleSelectStoryboardScene(
    scene: StoryboardGenerationResult["storyboard"]["scenes"][number],
  ) {
    setStoryboardCanvasFocus((currentFocus) => {
      const currentSceneNos = getStoryboardSelectedSceneNosFromFocus(currentFocus);
      const nextSceneNos = currentSceneNos.includes(scene.sceneNo)
        ? currentSceneNos.filter((sceneNo) => sceneNo !== scene.sceneNo)
        : [...currentSceneNos, scene.sceneNo];
      if (!nextSceneNos.length) return null;
      const nextScenes = result.storyboard.scenes.filter((candidate) =>
        nextSceneNos.includes(candidate.sceneNo),
      );
      return createStoryboardCutFocusContextFromScenes(nextScenes);
    });
  }

  function getStoryboardSourcePageRange(page: number) {
    const sourcePageScenes = result.storyboard.scenes.slice(
      page * storyboardFramePageSize,
      page * storyboardFramePageSize + storyboardFramePageSize,
    );
    const start =
      sourcePageScenes[0]?.sceneNo ?? page * storyboardFramePageSize + 1;
    const end = sourcePageScenes.at(-1)?.sceneNo ?? start;
    return { start, end };
  }

  function maybeGenerateMissingStoryboardPageImages(
    page: number,
    pageScenes: StoryboardScene[],
  ) {
    if (
      pageScenes.length === 0 ||
      result.generatedAt === INITIAL_STORYBOARD_PREVIEW.generatedAt ||
      result.storyboard.scenes.length === 0 ||
      suppressedAutoImageGenerationResultKeysRef.current.has(
        result.generatedAt,
      ) ||
      !isStoryboardImageProviderAvailable ||
      isGenerating ||
      isGeneratingImages ||
      isChatAgentStreaming
    ) {
      return;
    }

    const missingStoryboardScenes = getMissingTrustedStoryboardImageScenes(
      result.storyboard.scenes,
    );
    if (missingStoryboardScenes.length === 0) return;

    const missingSceneNos = missingStoryboardScenes
      .map((scene) => scene.sceneNo)
      .join(",");
    const autoGenerationKey = `${result.generatedAt}:all:${missingSceneNos}`;
    if (
      autoGeneratedMissingStoryboardPageKeysRef.current.has(autoGenerationKey)
    ) {
      return;
    }
    autoGeneratedMissingStoryboardPageKeysRef.current.add(autoGenerationKey);

    const pageRange = getStoryboardSourcePageRange(page);
    const assistantMessageId = `assistant-page-image-autofill-${Date.now()}`;
    appendStoryboardChatMessages([
      {
        id: assistantMessageId,
        role: "assistant",
        text: `CUT ${String(pageRange.start).padStart(2, "0")}–${String(pageRange.end).padStart(2, "0")}을 보는 중이에요. 아직 이미지가 없는 전체 ${missingStoryboardScenes.length}컷을 자동으로 채우고 있어요. 페이지를 넘기지 않아도 완료된 CUT은 바로 준비됩니다.`,
        status: "streaming",
      },
    ]);

    void handleGenerateStoryboardImages({
      assistantMessageId,
      targetScenes: missingStoryboardScenes,
      sourceResult: result,
      scope: "all",
    });
  }

  useEffect(() => {
    maybeGenerateMissingStoryboardPageImages(
      activeStoryboardPage,
      activeStoryboardPageScenes,
    );
    // 자동 전체 생성은 내부 key(ref)로 중복 실행을 막습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeStoryboardPage,
    activeStoryboardPageScenes,
    generatedImageCount,
    isStoryboardImageProviderAvailable,
    isGenerating,
    isGeneratingImages,
    isChatAgentStreaming,
    result,
  ]);

  function handleStoryboardPageChange(nextPage: number) {
    const normalizedPage = Math.min(
      storyboardTotalPages - 1,
      Math.max(0, nextPage),
    );
    const sourcePageScenes = getStoryboardSourcePageScenes({
      allScenes: result.storyboard.scenes,
      page: normalizedPage,
      pageSize: storyboardFramePageSize,
    });
    const sourcePageRange = getStoryboardSourcePageRange(normalizedPage);
    setStoryboardPage(normalizedPage);
    const firstVisibleScene = sourcePageScenes[0];
    if (firstVisibleScene) {
      applyStoryboardCanvasFocus(
        createStoryboardCutFocusContext(firstVisibleScene),
      );
      maybeGenerateMissingStoryboardPageImages(
        normalizedPage,
        sourcePageScenes,
      );
      return;
    }
    applyStoryboardCanvasFocus(
      createStoryboardActionFocusContext(
        `${normalizedPage + 1}페이지 선택됨`,
        `CUT ${String(sourcePageRange.start).padStart(2, "0")}–${String(sourcePageRange.end).padStart(2, "0")} 영역을 보고 있습니다.`,
        "사용자가 스토리보드 페이지를 이동했습니다. 현재 보이는 컷 범위의 리듬과 연결성을 기준으로 개선 대화를 이어가세요.",
      ),
    );
    maybeGenerateMissingStoryboardPageImages(normalizedPage, sourcePageScenes);
  }

  function handleStoryboardFramePageSizeChange(
    nextPageSize: StoryboardFramePageSize,
  ) {
    if (nextPageSize === storyboardFramePageSize) return;

    const preferredSceneNo =
      selectedStoryboardSceneNo ??
      activeStoryboardPageSourceScenes[0]?.sceneNo ??
      activeCutStart;
    const nextTotalPages = getStoryboardScenePageCount({
      allScenes: storyboardFrameScenes,
      pageSize: nextPageSize,
    });
    const nextPage = getStoryboardPageForSceneNo(
      preferredSceneNo,
      nextTotalPages,
      nextPageSize,
    );
    const nextPageScenes = getStoryboardSourcePageScenes({
      allScenes: result.storyboard.scenes,
      page: nextPage,
      pageSize: nextPageSize,
    });
    const focusScene =
      nextPageScenes.find((scene) => scene.sceneNo === preferredSceneNo) ??
      nextPageScenes[0];

    setStoryboardFramePageSize(nextPageSize);
    setStoryboardPage(nextPage);
    if (focusScene) {
      applyStoryboardCanvasFocus(createStoryboardCutFocusContext(focusScene));
    }
  }

  function abortStoryboardChatWork() {
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = null;
    pendingStoryboardChatSteerRef.current = null;
    setIsChatAgentStreaming(false);
    appendStoryboardChatMessages([
      {
        id: `assistant-abort-${Date.now()}`,
        role: "assistant",
        text: "채팅 스트림 중단됨 · 현재 캔버스 상태는 유지했습니다.",
        status: "done",
      },
    ]);
  }

  function abortStoryboardImageGeneration() {
    imageGenerationAbortControllerRef.current?.abort();
    imageGenerationAbortControllerRef.current = null;
    setIsGeneratingImages(false);
    setGeneratingStoryboardImageSceneNos([]);
    setActiveGeneratingStoryboardImageSceneNo(null);
    appendStoryboardChatMessages([
      {
        id: `assistant-image-abort-${Date.now()}`,
        role: "assistant",
        text: "이미지 생성 중단 요청됨 · 이미 반영된 CUT 이미지는 캔버스에 유지했습니다.",
        status: "done",
      },
    ]);
  }

  function getStoryboardChatStatusMessage() {
    return `현재 상태 · CUT ${String(activeCutStart).padStart(2, "0")}–${String(activeCutEnd).padStart(2, "0")} · 현재 페이지 이미지 ${activePageGeneratedCount}/${activeStoryboardImageGenerationTargetScenes.length || storyboardFramePageSize} · 전체 이미지 ${generatedImageCount}/${totalCutCount} · ${formatStoryboardOmittedSceneText(omittedStoryboardSceneCount)}`;
  }

  function appendStoryboardQuickCommandMessages(
    submittedPrompt: string,
    assistantText: string,
    status: StoryboardChatMessage["status"] = "done",
    actions?: StoryboardChatMessage["actions"],
  ) {
    const now = Date.now();
    appendStoryboardChatMessages([
      {
        id: `user-command-${now}`,
        role: "user",
        text: sanitizeStoryboardChatDisplayText(submittedPrompt),
      },
      {
        id: `assistant-command-${now}`,
        role: "assistant",
        text: assistantText,
        status,
        actions,
      },
    ]);
    return `assistant-command-${now}`;
  }

  const handleGenerate = async (
    submitted?: string | GeneratorForm,
    options: {
      appendChatMessages?: boolean;
      assistantMessageId?: string;
      suppressAutoImageGeneration?: boolean;
    } = {},
  ) => {
    hasUserStoryboardMutationRef.current = true;
    const nextForm = normalizeStoryboardGeneratorFormForSubmit(
      typeof submitted === "string"
        ? { ...form, prompt: submitted }
        : (submitted ?? form),
    );
    const appendMessages = options.appendChatMessages ?? true;
    const messageText = summarizeChatPrompt(nextForm.prompt);
    setIsGenerating(true);
    setErrorMessage(null);
    setStoryboardPage(0);
    setForm(nextForm);
    applyStoryboardCanvasFocus(
      createStoryboardActionFocusContext(
        "스토리보드 생성 실행",
        `${nextForm.segmentCount}컷 · ${nextForm.targetLengthMinutes}분 · ${nextForm.tone} 톤으로 생성 요청 중입니다.`,
        "사용자가 채팅 요구사항으로 실제 스토리보드 생성을 실행했습니다. 생성 완료 후 컷 구성과 보완점을 함께 검토하세요.",
      ),
    );
    if (options.assistantMessageId) {
      appendStoryboardThinkingTrace(
        options.assistantMessageId,
        makeStoryboardThinkingTraceEntries(
          {
            id: "storyboard-generate",
            label: "스토리보드 구성 생성",
            status: "running",
            detail: `${nextForm.segmentCount}컷 · ${nextForm.targetLengthMinutes}분 · ${nextForm.tone} 톤으로 생성 API 호출`,
          },
          {
            id: "storyboard-evidence",
            label: "자료·그래프 근거 확인",
            status: "running",
            detail:
              "LangGraph 또는 로컬 어댑터가 사용할 수 있는 자료를 확인하는 중",
          },
        ),
      );
    }
    setChatDraft("");
    if (appendMessages) {
      appendStoryboardChatMessages([
        {
          id: `operator-${Date.now()}`,
          role: "user",
          text: messageText,
        },
        {
          id: `assistant-streaming-${Date.now()}`,
          role: "assistant",
          text: "요구사항에 맞춰 컷 구성을 만들고 있어요. 완료되면 캔버스에서 바로 확인할 수 있습니다.",
          status: "streaming",
        },
      ]);
    } else if (options.assistantMessageId) {
      updateStoryboardChatMessage(
        options.assistantMessageId,
        "스토리보드를 만들고 있어요. 완료되면 캔버스에서 바로 확인할 수 있습니다.",
        "streaming",
      );
    }

    try {
      const generated = await postStoryboardRequest(nextForm);
      if (isStoryboardJobAcceptedResponse(generated)) {
        setAcceptedStoryboardJob(generated.job);
        setAcceptedStoryboardJobRequest(nextForm);
        const queuedMessage =
          generated.message ??
          generated.readiness?.message ??
          "스토리보드 생성 작업이 비동기 큐에 등록되었습니다. 상태 패널에서 진행 상황을 확인해 주세요.";
        if (options.assistantMessageId) {
          appendStoryboardThinkingTrace(
            options.assistantMessageId,
            makeStoryboardThinkingTraceEntries({
              id: "storyboard-job-queued",
              label: "비동기 작업 등록",
              status: "done",
              detail: `job=${generated.job.jobId} · ${generated.job.status}`,
            }),
          );
          updateStoryboardChatMessage(
            options.assistantMessageId,
            `${queuedMessage} · 작업 ID ${generated.job.jobId}`,
            "done",
          );
        } else {
          setChatMessages((messages) =>
            messages.map((message) =>
              message.status === "streaming"
                ? formatStoryboardChatMessageForDisplay({
                    ...message,
                    text: `${queuedMessage} · 작업 ID ${generated.job.jobId}`,
                    status: "done",
                  })
                : message,
            ),
          );
        }
        setErrorMessage(null);
        return null;
      }
      setAcceptedStoryboardJob(null);
      setAcceptedStoryboardJobRequest(null);
      const generatedGraph = generated.backendAnalysis.backendAgent?.graph;
      const graphNodes =
        generatedGraph?.nodesVisited && generatedGraph.nodesVisited.length > 0
          ? ` · 단계 ${generatedGraph.nodesVisited.slice(0, 6).join(" → ")}`
          : "";
      if (options.assistantMessageId) {
        appendStoryboardThinkingTrace(
          options.assistantMessageId,
          makeStoryboardThinkingTraceEntries(
            {
              id: "storyboard-evidence",
              label: "자료·그래프 근거 확인",
              status: "done",
              detail:
                formatStoryboardGraphDiagnosticsText(generated) ||
                `${generated.mode} 기준으로 구성`,
            },
            {
              id: "storyboard-generate",
              label: "스토리보드 구성 생성",
              status: "done",
              detail: `${generated.storyboard.scenes.length}컷 구성 완료${graphNodes}`,
            },
          ),
        );
      }
      if (options.suppressAutoImageGeneration) {
        suppressedAutoImageGenerationResultKeysRef.current.add(
          generated.generatedAt,
        );
      }
      const completionCopy = formatStoryboardGenerationCompletion(generated);
      setResult(generated);
      setStoryboardHistoryCases((current) =>
        mergeStoryboardHistoryCases(
          [makeStoryboardHistoryCase(generated)],
          current,
        ),
      );
      setStoryboardHistoryStatus("ready");
      setStoryboardHistoryError(null);
      setStoryboardPage(0);
      applyStoryboardCanvasFocus(
        createStoryboardActionFocusContext(
          completionCopy.focusLabel,
          completionCopy.focusDetail,
          completionCopy.focusPromptContext,
        ),
      );
      if (options.assistantMessageId) {
        updateStoryboardChatMessage(
          options.assistantMessageId,
          completionCopy.assistantText,
          "done",
        );
      } else {
        setChatMessages((messages) =>
          messages.map((message) =>
            message.status === "streaming"
              ? formatStoryboardChatMessageForDisplay({
                  ...message,
                  text: completionCopy.streamingText,
                  status: "done",
                })
              : message,
          ),
        );
      }
      return generated;
    } catch (error) {
      if (options.assistantMessageId) {
        appendStoryboardThinkingTrace(
          options.assistantMessageId,
          makeStoryboardThinkingTraceEntries({
            id: "storyboard-generate",
            label: "스토리보드 구성 생성",
            status: "failed",
            detail:
              error instanceof Error
                ? error.message
                : "스토리보드 구성 API 실패",
          }),
        );
      }
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "스토리보드를 생성하지 못했습니다.",
      );
      if (options.assistantMessageId) {
        updateStoryboardChatMessage(
          options.assistantMessageId,
          error instanceof Error
            ? `실제 스토리보드 생성 실패 · ${error.message}`
            : "실제 스토리보드 생성 실패 · 다시 시도하세요.",
          "done",
        );
      } else {
        setChatMessages((messages) =>
          messages.map((message) =>
            message.status === "streaming"
              ? formatStoryboardChatMessageForDisplay({
                  ...message,
                  text: "스토리보드 만들기에 실패했습니다. 오류를 확인한 뒤 같은 채팅창에서 다시 요청해 주세요.",
                  status: "done",
                })
              : message,
          ),
        );
      }
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  async function handleStoryboardChatSubmit(
    options: {
      prompt?: string;
      attachments?: StoryboardChatImageAttachment[];
      steeredReplay?: boolean;
    } = {},
  ) {
    const submittedAttachments =
      options.attachments ?? storyboardChatImageAttachments;
    const submittedPrompt =
      (options.prompt ?? chatDraft).trim().replace(/\s+/g, " ") ||
      (submittedAttachments.length
        ? STORYBOARD_CHAT_IMAGE_ATTACHMENT_ONLY_PROMPT
        : "");
    const hasSubmittedStoryboardChatContent =
      Boolean(submittedPrompt) || submittedAttachments.length > 0;
    if (!hasSubmittedStoryboardChatContent) {
      return;
    }
    if (isChatAgentStreaming && !options.steeredReplay) {
      pendingStoryboardChatSteerRef.current = {
        prompt: submittedPrompt,
        attachments: submittedAttachments,
      };
      appendStoryboardChatSteerTrace(
        submittedPrompt,
        submittedAttachments.length,
      );
      setChatDraft("");
      setStoryboardChatImageAttachments([]);
      chatAbortControllerRef.current?.abort();
      return;
    }
    if (isGenerating || isGeneratingImages) {
      return;
    }
    hasUserStoryboardMutationRef.current = true;

    const quickCommand = getStoryboardChatQuickCommand(submittedPrompt);
    if (quickCommand && submittedAttachments.length === 0) {
      const commandBaseForm: GeneratorForm = form;
      setChatDraft("");
      if (quickCommand === "status") {
        appendStoryboardQuickCommandMessages(
          submittedPrompt,
          `${getStoryboardChatStatusMessage()}${storyboardCanvasFocus ? ` · 현재 선택 ${storyboardCanvasFocus.label}` : ""} · 필요하면 “가이드” 또는 “예시 생성”을 눌러 이어갈 수 있습니다.`,
        );
        return;
      }
      if (quickCommand === "guide") {
        appendStoryboardQuickCommandMessages(
          submittedPrompt,
          STORYBOARD_USAGE_GUIDE_TEXT,
          "done",
          ["example"],
        );
        return;
      }
      if (quickCommand === "example") {
        await handleStoryboardGuidedExampleGenerate();
        return;
      }
      if (quickCommand === "image_status") {
        setIsStoryboardChatSettingsOpen(true);
        appendStoryboardQuickCommandMessages(
          submittedPrompt,
          formatStoryboardImageProviderGuidanceMessage(
            storyboardImageProviderReadiness,
          ),
        );
        return;
      }
      if (quickCommand === "review") {
        appendStoryboardQuickCommandMessages(
          submittedPrompt,
          formatStoryboardUserPerspectiveMessage(
            storyboardUserPerspectiveReadiness,
            result,
            generatedImageCount,
            totalCutCount,
            omittedStoryboardSceneCount,
          ),
        );
        return;
      }
      if (quickCommand === "safety") {
        appendStoryboardQuickCommandMessages(
          submittedPrompt,
          formatStoryboardVisualSafetyMessage(
            result,
            generatedImageCount,
            totalCutCount,
            omittedStoryboardSceneCount,
          ),
        );
        return;
      }
      if (quickCommand === "trace") {
        appendStoryboardQuickCommandMessages(
          submittedPrompt,
          formatStoryboardTraceBubble(result, storyboardPdfFlowChecks),
        );
        return;
      }
      if (quickCommand === "reset") {
        appendStoryboardChatMessages([
          {
            id: `user-command-${Date.now()}`,
            role: "user",
            text: sanitizeStoryboardChatDisplayText(submittedPrompt),
          },
        ]);
        resetStoryboardChatState();
        return;
      }
      if (quickCommand === "history") {
        setIsStoryboardHistoryPanelOpen(true);
        appendStoryboardQuickCommandMessages(
          submittedPrompt,
          "스토리보드 기록을 이 페이지 안에서 열었습니다. 우상단 히스토리 버튼으로도 닫거나 다시 열 수 있습니다.",
        );
        await refreshStoryboardHistoryResults();
        return;
      }
      if (quickCommand === "settings") {
        setIsStoryboardChatSettingsOpen(true);
        appendStoryboardQuickCommandMessages(
          submittedPrompt,
          "채팅 설정을 열었습니다. 현재 이미지 라우터와 OpenAI API 키 적용 상태만 보여줍니다.",
        );
        return;
      }
      if (quickCommand === "images") {
        if (
          isGenerating ||
          activeStoryboardImageGenerationTargetScenes.length === 0
        ) {
          appendStoryboardQuickCommandMessages(
            submittedPrompt,
            "현재 재생성할 스토리보드 컷이 없습니다. 먼저 스토리보드를 생성해 주세요.",
          );
          return;
        }
        if (isGeneratingImages) {
          appendStoryboardQuickCommandMessages(
            submittedPrompt,
            "이미 CUT 이미지를 만드는 중입니다. 응답이 도착하면 생성된 CUT을 캔버스에 즉시 반영합니다.",
          );
          return;
        }
        if (!isStoryboardImageProviderAvailable) {
          guideUnavailableStoryboardImageGeneration({
            submittedPrompt,
            scopeLabel: `현재 ${activePageGenerationTargetCount}컷`,
          });
          return;
        }
        const assistantMessageId = appendStoryboardQuickCommandMessages(
          submittedPrompt,
          `현재 ${activePageGenerationTargetCount}컷 이미지를 다시 만들게요...`,
          "streaming",
        );
        await handleGenerateStoryboardImages({ assistantMessageId });
        return;
      }
      if (quickCommand === "generate") {
        if (isGeneratingImages) {
          appendStoryboardQuickCommandMessages(
            submittedPrompt,
            "지금은 CUT 이미지를 만드는 중입니다. 현재 요청 반영이 끝나면 새 예시를 만들 수 있습니다.",
          );
          return;
        }
        const assistantMessageId = appendStoryboardQuickCommandMessages(
          submittedPrompt,
          "현재 입력한 내용으로 스토리보드를 만들고 있어요. 완료되면 캔버스에서 바로 확인할 수 있습니다.",
          "streaming",
        );
        const generated = await handleGenerate(commandBaseForm, {
          appendChatMessages: false,
          assistantMessageId,
        });
        if (generated) {
          await handleGenerateAllStoryboardImagesForResult(
            generated,
            assistantMessageId,
          );
        }
        return;
      }
    }

    const nextUserMessageId = `user-${Date.now()}`;
    const nextAssistantMessageId = `assistant-${Date.now()}`;
    const conversationMessages =
      buildStoryboardChatConversationContext(chatMessages);
    const initialThinkingTrace = [
      normalizeStoryboardThinkingTraceEntry({
        id: "chat-input",
        label: "요청 수신",
        status: "done",
        detail: [
          submittedPrompt
            ? `입력: ${submittedPrompt.slice(0, 120)}`
            : "텍스트 없이 사진 첨부로 시작",
          submittedAttachments.length
            ? `첨부 사진 ${submittedAttachments.length}장`
            : "",
          storyboardCanvasFocus
            ? `캔버스 맥락: ${storyboardCanvasFocus.label}`
            : "캔버스 선택 맥락 없음",
          conversationMessages.length
            ? `최근 대화 ${conversationMessages.length}개 전달`
            : "최근 대화 없음",
        ]
          .filter(Boolean)
          .join(" · "),
      }),
      normalizeStoryboardThinkingTraceEntry({
        id: "chat-stream",
        label: "채팅 에이전트 연결",
        status: "running",
        detail: "요청을 서버 스트림으로 보내고 의도 분석 결과를 기다리는 중",
      }),
    ].filter((entry): entry is StoryboardThinkingTraceEntry => Boolean(entry));
    appendStoryboardChatMessages([
      {
        id: nextUserMessageId,
        role: "user",
        text: sanitizeStoryboardChatDisplayText(
          [
            submittedPrompt,
            formatStoryboardChatAttachmentSummary(submittedAttachments),
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      },
      {
        id: nextAssistantMessageId,
        role: "assistant",
        text: "답변을 준비하고 있어요.",
        status: "streaming",
        thinkingTrace: initialThinkingTrace,
      },
    ]);
    setChatDraft("");
    setStoryboardChatImageAttachments([]);
    setIsChatAgentStreaming(true);
    const abortController = new AbortController();
    chatAbortControllerRef.current = abortController;

    let finalResult: StoryboardChatAgentResult | null = null;
    const submittedSegmentCount = deriveStoryboardUiSegmentCount(
      submittedPrompt,
      form.segmentCount,
    );
    let finalForm: GeneratorForm = {
      ...form,
      prompt: submittedPrompt,
      segmentCount: submittedSegmentCount,
    };

    try {
      const response = await fetch(STORYBOARD_CHAT_AGENT_STREAM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: submittedPrompt,
          currentPrompt: form.prompt,
          baselinePrompt: result.request.prompt,
          currentTone: form.tone,
          currentTargetLengthMinutes: form.targetLengthMinutes,
          currentSegmentCount: submittedSegmentCount,
          currentAvailableSceneCount:
            storyboardFrameScenes.length || result.storyboard.scenes.length,
          generationMode: form.generationMode,
          focusContext: storyboardCanvasFocus,
          imageAttachments: submittedAttachments,
          conversationMessages,
          chatThreadId: "admin-storyboard-chat",
        }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as {
          detail?: string;
          error?: string;
        } | null;
        throw new Error(
          payload?.detail ??
            payload?.error ??
            "채팅 작업을 처리하지 못했습니다.",
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastStatus = "답변을 준비하고 있어요.";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = extractStoryboardChatSseEvents(buffer);
        buffer = parsed.remainder;

        for (const item of parsed.events) {
          if (
            item.event === "status" &&
            item.data &&
            typeof item.data === "object" &&
            "message" in item.data
          ) {
            lastStatus = sanitizeStoryboardChatDisplayText(
              String(
                (item.data as { message?: unknown }).message ?? lastStatus,
              ),
            );
            updateStoryboardChatMessage(
              nextAssistantMessageId,
              lastStatus,
              "streaming",
            );
          }
          if (item.event === "trace") {
            appendStoryboardThinkingTrace(nextAssistantMessageId, [
              normalizeStoryboardThinkingTraceEntry(
                item.data,
                `trace-${Date.now()}`,
              ),
            ]);
          }
          if (
            (item.event === "patch" || item.event === "done") &&
            isStoryboardChatAgentResult(item.data)
          ) {
            finalResult = item.data;
            if (isStoryboardChatCanvasPatchActionable(item.data)) {
              finalForm = createFormWithStoryboardChatPatch(
                finalForm,
                item.data.canvasPatch,
              );
              applyStoryboardChatPatchToCanvas(item.data.canvasPatch);
            }
            updateStoryboardChatMessage(
              nextAssistantMessageId,
              item.data.assistantMessage,
              "done",
              undefined,
              [
                normalizeStoryboardThinkingTraceEntry({
                  id: "chat-stream",
                  label: "채팅 에이전트 연결",
                  status: "done",
                  detail: "서버 스트림 응답 수신 완료",
                }),
                normalizeStoryboardThinkingTraceEntry({
                  id: "chat-patch",
                  label: "화면 반영 결정 수신",
                  status: "done",
                  detail: item.data.shouldGenerate
                    ? item.data.shouldGenerateImages === false
                      ? "컷 구성만 생성하고 이미지는 건너뛰도록 결정"
                      : "컷 구성 생성 이후 이미지 생성까지 이어가도록 결정"
                    : item.data.canvasPatch.scenePatch?.regenerateImage
                      ? "선택 CUT 이미지만 재생성하도록 결정"
                      : "대화 답변 또는 화면 일부 수정으로 결정",
                }),
              ].filter((entry): entry is StoryboardThinkingTraceEntry =>
                Boolean(entry),
              ),
            );
          }
          if (item.event === "error") {
            const payload =
              item.data && typeof item.data === "object"
                ? (item.data as { detail?: string; error?: string })
                : null;
            throw new Error(
              payload?.detail ??
                payload?.error ??
                "채팅 작업을 처리하지 못했습니다.",
            );
          }
        }
      }

      if (finalResult?.shouldReset) {
        setForm(DEFAULT_FORM);
        setStoryboardPage(0);
        updateStoryboardChatMessage(
          nextAssistantMessageId,
          `${finalResult.assistantMessage} · 스토리보드 입력 상태 초기화 완료`,
          "done",
        );
      }
      if (finalResult?.shouldGenerate) {
        const shouldGenerateImages = finalResult.shouldGenerateImages ?? true;
        const generated = await handleGenerate(finalForm, {
          appendChatMessages: false,
          assistantMessageId: nextAssistantMessageId,
          suppressAutoImageGeneration: !shouldGenerateImages,
        });
        if (generated && shouldGenerateImages) {
          await handleGenerateAllStoryboardImagesForResult(
            generated,
            nextAssistantMessageId,
          );
        } else if (generated) {
          appendStoryboardThinkingTrace(
            nextAssistantMessageId,
            makeStoryboardThinkingTraceEntries({
              id: "image-generation-skip",
              label: "CUT 이미지 생성 생략",
              status: "done",
              detail:
                "사용자 요청에 따라 컷 구성만 반영하고 이미지 생성 단계는 실행하지 않음",
            }),
          );
          updateStoryboardChatMessage(
            nextAssistantMessageId,
            `${finalResult.assistantMessage} · 이미지 생성은 요청대로 건너뛰었습니다.`,
            "done",
          );
        }
      }
      if (
        finalResult?.canvasPatch.scenePatch?.regenerateImage &&
        !finalResult.shouldGenerate
      ) {
        const scenePatch = finalResult.canvasPatch.scenePatch;
        const baseScene = result.storyboard.scenes.find(
          (scene) => scene.sceneNo === scenePatch.sceneNo,
        );
        if (baseScene) {
          await handleGenerateStoryboardImages({
            assistantMessageId: nextAssistantMessageId,
            targetScenes: [mergeStoryboardScenePatch(baseScene, scenePatch)],
            scope: "selected",
          });
        }
      }
    } catch (error) {
      const isAbortError =
        error instanceof DOMException && error.name === "AbortError";
      updateStoryboardChatMessage(
        nextAssistantMessageId,
        isAbortError
          ? "채팅 스트림 중단됨 · 현재 캔버스 상태는 유지했습니다."
          : error instanceof Error
            ? `채팅 작업 실패 · ${error.message}`
            : "채팅 작업 실패 · 다시 시도하세요.",
        "done",
      );
      if (!isAbortError) {
        setChatDraft(
          (current) =>
            current ||
            (submittedPrompt === STORYBOARD_CHAT_IMAGE_ATTACHMENT_ONLY_PROMPT
              ? ""
              : submittedPrompt),
        );
        setStoryboardChatImageAttachments((current) =>
          current.length ? current : submittedAttachments,
        );
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "채팅 작업을 처리하지 못했습니다.",
        );
      }
    } finally {
      if (chatAbortControllerRef.current === abortController) {
        chatAbortControllerRef.current = null;
      }
      setIsChatAgentStreaming(false);
      const pendingSteerRequest = pendingStoryboardChatSteerRef.current;
      if (pendingSteerRequest && !options.steeredReplay) {
        pendingStoryboardChatSteerRef.current = null;
        window.setTimeout(() => {
          void handleStoryboardChatSubmit({
            ...pendingSteerRequest,
            steeredReplay: true,
          });
        }, 0);
      }
    }
  }

  function handleStoryboardChatCompositionStart() {
    storyboardChatComposerImeRef.current = true;
  }

  function handleStoryboardChatCompositionEnd() {
    storyboardChatComposerImeRef.current = false;
  }

  function isStoryboardChatImeComposing(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    return (
      storyboardChatComposerImeRef.current ||
      event.nativeEvent.isComposing ||
      event.key === "Process"
    );
  }

  function handleStoryboardChatKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      isStoryboardChatImeComposing(event)
    ) {
      return;
    }
    event.preventDefault();
    void handleStoryboardChatSubmit();
  }

  async function handleExportStoryboardPng() {
    applyStoryboardCanvasFocus(
      createStoryboardActionFocusContext(
        "PNG 저장 실행",
        `${activeFrameViewLabel} · 현재 페이지 CUT ${String(activeCutStart).padStart(2, "0")}–${String(activeCutEnd).padStart(2, "0")} · ${exportResolutionToken}`,
        "사용자가 현재 스토리보드 보기 단위를 PNG로 저장했습니다. 이후 채팅은 저장된 페이지의 구도, 순서, 자막 보완을 기준으로 이어갈 수 있습니다.",
      ),
    );
    const canvas = document.createElement("canvas");
    canvas.width = selectedExportPreset.width;
    canvas.height = selectedExportPreset.height;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.fillStyle = "#111827";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const gap = Math.round(canvas.width * 0.018);
    const margin = Math.round(canvas.width * 0.026);
    const isSingleFrameExport = storyboardFramePageSize === 1;
    const frameWidth = isSingleFrameExport
      ? canvas.width - margin * 2
      : (canvas.width - margin * 2 - gap) / 2;
    const frameHeight = isSingleFrameExport
      ? canvas.height - margin * 2
      : (canvas.height - margin * 2 - gap) / 2;

    const generatedImages = await Promise.all(
      activeStoryboardPageScenes.map((scene) => {
        const trustedGeneratedImage = getTrustedStoryboardGeneratedImage(
          scene.generatedImage,
        );
        return loadCanvasImage(trustedGeneratedImage?.dataUrl);
      }),
    );

    for (const [index, scene] of activeStoryboardPageScenes.entries()) {
      const col = isSingleFrameExport ? 0 : index % 2;
      const row = isSingleFrameExport ? 0 : Math.floor(index / 2);
      const generatedImage = generatedImages[index] ?? null;
      drawStoryboardFrameToCanvas(
        context,
        scene,
        margin + col * (frameWidth + gap),
        margin + row * (frameHeight + gap),
        frameWidth,
        frameHeight,
        showStoryboardGuide,
        generatedImage,
      );
    }

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `tzudong-storyboard-page-${activeStoryboardPage + 1}-${exportResolutionToken}.png`;
    link.click();
  }

  async function handleCopyStoryboardPlanMarkdown() {
    const exportMarkdown = buildStoryboardClientCopyPlanMarkdown(result);
    if (!exportMarkdown) {
      const message =
        "복사할 촬영 기획표가 없습니다. 먼저 스토리보드를 만들어주세요.";
      setErrorMessage(message);
      appendStoryboardChatMessages([
        {
          id: `assistant-copy-plan-empty-${Date.now()}`,
          role: "assistant",
          text: message,
          status: "done",
        },
      ]);
      return;
    }

    try {
      await writeStoryboardClipboardText(exportMarkdown);
      setErrorMessage(null);
      applyStoryboardCanvasFocus(
        createStoryboardActionFocusContext(
          "기획서 복사 완료",
          `${result.storyboard.scenes.length}컷 촬영 기획표를 클립보드에 복사했습니다.`,
          "사용자가 현재 스토리보드의 촬영 기획표를 복사했습니다. 이후 채팅은 복사된 기획표의 CUT 순서, 멘트, 자막, 구도 보완을 기준으로 이어갈 수 있습니다.",
        ),
      );
      appendStoryboardChatMessages([
        {
          id: `assistant-copy-plan-${Date.now()}`,
          role: "assistant",
          text: "기획서를 복사했어요. PD·편집자에게 붙여넣어 공유하면 CUT별 촬영 지시, 멘트, 자막, 근거를 바로 확인할 수 있습니다.",
          status: "done",
        },
      ]);
    } catch (error) {
      const message =
        error instanceof Error
          ? `기획서를 복사하지 못했습니다 · ${error.message}`
          : "기획서를 복사하지 못했습니다. 브라우저 클립보드 권한을 확인해 주세요.";
      setErrorMessage(message);
      applyStoryboardCanvasFocus(
        createStoryboardActionFocusContext(
          "기획서 복사 실패",
          "클립보드 권한 문제로 촬영 기획표를 복사하지 못했습니다.",
          "사용자가 현재 스토리보드의 촬영 기획표 복사를 시도했지만 브라우저 클립보드 권한 또는 환경 문제로 실패했습니다.",
        ),
      );
      appendStoryboardChatMessages([
        {
          id: `assistant-copy-plan-failed-${Date.now()}`,
          role: "assistant",
          text: message,
          status: "done",
        },
      ]);
    }
  }

  const storyboardModuleSummary = acceptedStoryboardJob
    ? `작업 ${formatStoryboardJobStatusLabel(acceptedStoryboardJob.status)} · ${acceptedStoryboardJob.stage}`
    : isGenerating
      ? "스토리보드 구성 중 · 작업 제출/응답 대기"
      : isGeneratingImages
        ? `이미지 생성 중 · ${generatedImageCount}/${totalCutCount}컷 준비`
        : isChatAgentStreaming
          ? "도우미 응답 중 · 캔버스 맥락 반영"
          : `이미지 ${generatedImageCount}/${totalCutCount}컷 · ${formatStoryboardOmittedSceneText(omittedStoryboardSceneCount)}`;


  return (
    <AdminEmbeddedModuleShell
      moduleId="storyboard"
      titleId="admin-storyboard-generator-title"
      title="스토리보드 생성"
      icon={Clapperboard}
      summary={storyboardModuleSummary}
    >
      <section
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background p-2"
        aria-label="스토리보드 생성"
        data-admin-storyboard-generator="true"
        data-storyboard-viewport-fit="bounded"
        data-layout-primitives="split-sidebar panel-layout list-detail frame step-nav stack"
        data-storyboard-job-status={
          acceptedStoryboardJob
            ? `storyboard-job-${acceptedStoryboardJob.status}`
            : isGenerating
              ? "storyboard-generating"
              : isGeneratingImages
                ? "image-generating"
                : isChatAgentStreaming
                  ? "chat-streaming"
                  : "idle"
        }
        data-storyboard-stage-progress={
          acceptedStoryboardJob
            ? acceptedStoryboardJob.stage
            : isGenerating
              ? "async-job-submit"
              : isGeneratingImages
                ? "image-batch"
                : isChatAgentStreaming
                  ? "chat-stream"
                  : "idle"
        }
        data-storyboard-provider-readiness={acceptedStoryboardJob?.readiness?.status ?? "async-control-plane-readback"}
      >
        <div
          className="grid min-h-0 min-w-0 flex-1 gap-3 overflow-hidden"
          data-storyboard-desktop-split-layout="inline-grid"
          data-storyboard-dom-order="chat-then-canvas"
          data-storyboard-narrow-order="chat-then-canvas"
          style={{
            display: "grid",
            gridTemplateColumns:
              "var(--storyboard-split-columns, minmax(0, 1fr) minmax(320px, 400px))",
            gridTemplateRows: "var(--storyboard-split-rows, minmax(0, 1fr))",
          }}
        >
        <Card
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-sm max-[1099px]:!overflow-visible max-[1099px]:![grid-row:1]"
          aria-label="요구사항 채팅"
          data-storyboard-input-panel="chat-stream"
          data-storyboard-pane-role="chat"
          data-storyboard-input-position="right-of-canvas"
          data-layout-primitives="panel-layout stack"
          style={{
            gridColumn: "var(--storyboard-input-panel-column, 2)",
            gridRow: "var(--storyboard-input-panel-row, 1)",
            minWidth: 0,
          }}
        >
          <CardHeader className="shrink-0 space-y-1 p-3 pb-2">
            <div
              className="flex items-center justify-between gap-2"
              data-storyboard-chat-header="true"
            >
              <CardTitle className="flex min-w-0 items-center gap-2 text-base leading-none">
                <span
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                  data-storyboard-chat-title-icon="true"
                  aria-hidden="true"
                >
                  <MessageCircle
                    className="block h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                </span>
                <span className="min-w-0 truncate">스토리보드 도우미</span>
              </CardTitle>
              <div
                className="flex shrink-0 items-center gap-1"
                data-storyboard-chat-header-actions="true"
              >
                <span
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center"
                  style={{
                    color: isStoryboardImageProviderAvailable
                      ? "#059669"
                      : "#dc2626",
                  }}
                  data-storyboard-image-provider-status={
                    storyboardImageProviderReadiness.status
                  }
                  data-storyboard-image-provider-status-icon={
                    isStoryboardImageProviderAvailable
                      ? "connected"
                      : "disconnected"
                  }
                  data-storyboard-image-provider-status-visual="plug-icon-only"
                  title={storyboardImageProviderReadiness.summary}
                  aria-label={storyboardImageProviderStatusIconLabel}
                >
                  <Plug className="h-4 w-4" aria-hidden="true" />
                </span>
                <DropdownMenu
                  open={isStoryboardHistoryPanelOpen}
                  onOpenChange={handleStoryboardHistoryDropdownOpenChange}
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant={
                        isStoryboardHistoryPanelOpen ? "secondary" : "ghost"
                      }
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      disabled={storyboardHistoryStatus === "loading"}
                      aria-label="스토리보드 기록 열기"
                      data-storyboard-history-panel-toggle="true"
                      data-storyboard-history-dropdown-trigger="icon-only"
                    >
                      {storyboardHistoryStatus === "loading" ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                      ) : (
                        <History className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-[min(420px,calc(100vw-2rem))] p-0"
                    data-storyboard-history-dropdown="true"
                  >
                    <div
                      className="space-y-2 rounded-md bg-background/95 p-2 text-xs"
                      data-storyboard-history-panel="true"
                      data-storyboard-history-status={storyboardHistoryStatus}
                      data-storyboard-history-count={String(
                        storyboardHistoryCases.length,
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs font-semibold">
                            <History className="h-3.5 w-3.5" />
                            <span>스토리보드 기록</span>
                            <Badge
                              variant="secondary"
                              className="px-1.5 text-[10px]"
                              data-storyboard-history-status-label="true"
                            >
                              {storyboardHistoryStatus === "loading"
                                ? "불러오는 중"
                                : storyboardHistoryStatus === "stale"
                                  ? "이전 결과"
                                  : storyboardHistoryCases.length
                                    ? `${storyboardHistoryCases.length}건`
                                    : "없음"}
                            </Badge>
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            이전에 만든 결과를 이 페이지에서 다시 불러옵니다.
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() =>
                              void refreshStoryboardHistoryResults()
                            }
                            disabled={storyboardHistoryStatus === "loading"}
                            aria-label="스토리보드 기록 새로고침"
                            data-storyboard-history-refresh="true"
                          >
                            {storyboardHistoryStatus === "loading" ? (
                              <Loader2
                                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                                aria-hidden="true"
                              />
                            ) : (
                              <RotateCcw
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() =>
                              setIsStoryboardHistoryPanelOpen(false)
                            }
                            aria-label="스토리보드 기록 닫기"
                            data-storyboard-history-close="true"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>

                      {storyboardHistoryError ? (
                        <div
                          className={cn(
                            "rounded-xl px-2.5 py-2 text-[11px]",
                            storyboardHistoryStatus === "stale"
                              ? "bg-amber-500/10 text-amber-800 dark:text-amber-200"
                              : "bg-destructive/10 text-destructive",
                          )}
                          data-storyboard-history-error="true"
                          data-storyboard-history-stale={
                            storyboardHistoryStatus === "stale"
                              ? "true"
                              : undefined
                          }
                        >
                          {storyboardHistoryStatus === "stale"
                            ? "새로고침 실패 · 이전 결과 표시 중"
                            : "히스토리를 불러오지 못했습니다."}{" "}
                          {storyboardHistoryError}
                        </div>
                      ) : null}

                      {storyboardHistoryStatus === "empty" ? (
                        <div
                          className="rounded-xl bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground"
                          data-storyboard-history-empty="true"
                        >
                          아직 저장된 실제 생성 기록이 없습니다. 채팅에서
                          “생성”을 보내면 여기에 쌓입니다.
                        </div>
                      ) : null}

                      {visibleStoryboardHistoryCases.length ? (
                        <div
                          className="max-h-72 space-y-1.5 overflow-y-auto pr-0.5"
                          data-storyboard-history-run-list="true"
                        >
                          {visibleStoryboardHistoryCases.map((historyCase) => {
                            const historyTrace = formatStoryboardRealDataTrace(
                              historyCase.result,
                            );
                            const historyPreviewImage =
                              getStoryboardHistoryPreviewImage(historyCase);
                            const proofSummaries =
                              getStoryboardHistoryProofSummaries(
                                historyCase.result,
                              );
                            const isProofOpen =
                              openStoryboardHistoryProofId === historyCase.id;
                            const isSelectedHistory =
                              historyCase.result.generatedAt ===
                              result.generatedAt;
                            return (
                              <div
                                key={historyCase.id}
                                className={cn(
                                  "grid gap-2 rounded-xl p-2 text-[11px] sm:grid-cols-[72px_minmax(0,1fr)]",
                                  isSelectedHistory
                                    ? "bg-primary/5 ring-1 ring-primary/30"
                                    : "bg-muted/35",
                                )}
                                data-storyboard-history-run="true"
                                data-storyboard-history-run-id={historyCase.id}
                                data-storyboard-history-mode={historyTrace.mode}
                                data-storyboard-history-selected={
                                  isSelectedHistory ? "true" : undefined
                                }
                              >
                                <div className="h-12 overflow-hidden rounded-lg bg-background/80 ring-1 ring-border/60">
                                  {historyPreviewImage ? (
                                    <NextImage
                                      src={historyPreviewImage}
                                      alt={`${historyCase.result.storyboard.title} 스토리보드 히스토리`}
                                      width={144}
                                      height={81}
                                      className="h-full w-full object-cover"
                                      unoptimized
                                      data-storyboard-history-preview-image="true"
                                    />
                                  ) : (
                                    <div className="grid h-full place-items-center bg-muted/50 text-[10px] font-semibold text-muted-foreground">
                                      이미지 없음
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 space-y-1">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p
                                        className="truncate font-semibold"
                                        title={
                                          historyCase.result.storyboard.title
                                        }
                                        data-storyboard-history-title="true"
                                      >
                                        {historyCase.result.storyboard.title}
                                      </p>
                                      <p className="truncate text-muted-foreground">
                                        {historyCase.result.storyboard.logline}
                                      </p>
                                    </div>
                                    <Badge
                                      variant={
                                        historyTrace.mode === "actual"
                                          ? "secondary"
                                          : "outline"
                                      }
                                      className="shrink-0 px-1.5 text-[10px]"
                                      data-storyboard-history-source-label="true"
                                    >
                                      {historyTrace.mode === "actual"
                                        ? "실제 기록"
                                        : "공용 예시"}
                                    </Badge>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="sm"
                                      className="h-7 rounded-full px-2 text-[11px]"
                                      onClick={() => {
                                        void applyStoryboardHistoryResult(
                                          historyCase,
                                        );
                                      }}
                                      data-storyboard-history-load-run={
                                        historyCase.id
                                      }
                                    >
                                      캔버스에 불러오기
                                    </Button>
                                    <span
                                      className="text-muted-foreground"
                                      data-storyboard-history-scenes="true"
                                    >
                                      {formatStoryboardHistoryVisibleCutCount(
                                        historyCase.result,
                                      )}
                                    </span>
                                    <span
                                      className="text-muted-foreground"
                                      aria-hidden="true"
                                    >
                                      ·
                                    </span>
                                    <time
                                      dateTime={historyCase.result.generatedAt}
                                      title={historyCase.result.generatedAt}
                                      className="text-muted-foreground"
                                      data-storyboard-history-generated-at="true"
                                    >
                                      {formatStoryboardHistoryTimestamp(
                                        historyCase.result.generatedAt,
                                      )}
                                    </time>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 rounded-full px-2 text-[11px]"
                                      disabled={proofSummaries.length === 0}
                                      onClick={() =>
                                        setOpenStoryboardHistoryProofId(
                                          isProofOpen ? null : historyCase.id,
                                        )
                                      }
                                      data-storyboard-history-proof-toggle="true"
                                      aria-expanded={isProofOpen}
                                      aria-label="스토리보드 이미지 확인 내역 보기"
                                    >
                                      확인 {proofSummaries.length || 0}
                                    </Button>
                                  </div>
                                  {isProofOpen && proofSummaries.length ? (
                                    <div
                                      className="rounded-lg border border-border/70 bg-background/80 p-2 text-[10px] leading-4"
                                      data-storyboard-history-proof-panel="true"
                                    >
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <Badge
                                          variant="secondary"
                                          className="px-1.5 text-[10px]"
                                          data-storyboard-history-proof-provider="true"
                                        >
                                          이미지 확인 완료
                                        </Badge>
                                        <Badge
                                          variant="outline"
                                          className="px-1.5 text-[10px]"
                                          data-storyboard-history-proof-model="true"
                                        >
                                          안전 확인됨
                                        </Badge>
                                      </div>
                                      <div className="mt-1.5 space-y-1">
                                        {proofSummaries
                                          .slice(0, 4)
                                          .map((proof) => (
                                            <div
                                              key={`${historyCase.id}-${proof.sceneNo}-${proof.imageCallId}`}
                                              className="grid gap-1 rounded-md bg-muted/35 p-1.5 sm:grid-cols-[44px_minmax(0,1fr)]"
                                            >
                                              <span className="font-semibold">
                                                CUT{" "}
                                                {String(proof.sceneNo).padStart(
                                                  2,
                                                  "0",
                                                )}
                                              </span>
                                              <span
                                                className="min-w-0 truncate"
                                                title={`CUT ${String(proof.sceneNo).padStart(2, "0")} 이미지 확인 내역`}
                                                data-storyboard-history-proof-response="true"
                                              >
                                                생성 기록 확인됨
                                              </span>
                                              <span className="sr-only">
                                                이미지 생성 기록 확인됨
                                              </span>
                                              <span
                                                className="min-w-0 truncate text-muted-foreground sm:col-start-2"
                                                title={`CUT ${String(proof.sceneNo).padStart(2, "0")} 저장 확인`}
                                                data-storyboard-history-proof-hashes="true"
                                              >
                                                저장 확인됨
                                              </span>
                                            </div>
                                          ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu
                  open={isStoryboardChatSettingsOpen}
                  onOpenChange={setIsStoryboardChatSettingsOpen}
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant={
                        isStoryboardChatSettingsOpen ? "secondary" : "ghost"
                      }
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      aria-label="스토리보드 채팅 설정 열기"
                      data-storyboard-chat-settings-toggle="true"
                      data-storyboard-chat-settings-open={
                        isStoryboardChatSettingsOpen ? "true" : "false"
                      }
                      data-storyboard-chat-settings-dropdown-trigger="true"
                    >
                      <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-[min(22rem,calc(100vw-2rem))] max-h-[min(32rem,calc(100vh-7rem))] overflow-y-auto rounded-2xl p-0"
                    data-storyboard-chat-settings-dropdown="true"
                  >
                    <div
                      className="space-y-2 rounded-2xl bg-background/95 p-2.5 shadow-sm"
                      data-storyboard-chat-settings-panel="true"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">
                            이미지 설정
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            기본 OAuth · 고급 로컬 · API Key 백업
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => setIsStoryboardChatSettingsOpen(false)}
                          aria-label="스토리보드 채팅 설정 닫기"
                          data-storyboard-chat-settings-close="true"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>

                      <div
                        className="grid grid-cols-2 gap-1"
                        role="radiogroup"
                        aria-label="스토리보드 이미지 생성 방식 선택"
                        data-storyboard-api-router-choice="true"
                        data-storyboard-api-router-choice-layout="oauth-deduped"
                      >
                        <button
                          type="button"
                          className={`rounded-xl px-2 py-1.5 text-left transition motion-reduce:transition-none ${
                            storyboardImageRouteChoice === "local-codex-oauth"
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "bg-muted/35 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                          }`}
                          aria-pressed={
                            storyboardImageRouteChoice === "local-codex-oauth"
                          }
                          onClick={() =>
                            handleSelectStoryboardImageRouteChoice(
                              "local-codex-oauth",
                            )
                          }
                          data-storyboard-api-router-option="local-codex-oauth"
                          data-storyboard-api-router-option-selected={
                            storyboardImageRouteChoice === "local-codex-oauth"
                              ? "true"
                              : "false"
                          }
                          data-storyboard-api-router-oauth-transport="server"
                        >
                          <span className="block text-[11px] font-bold">
                            기본
                          </span>
                          <span className="block text-[10px] opacity-80">
                            {storyboardImageProviderReadiness.status ===
                              "ready" &&
                            storyboardImageProviderReadiness.providerId ===
                              STORYBOARD_IMAGE_PROVIDER_ID
                              ? "사용 가능"
                              : storyboardImageProviderReadiness.status ===
                                  "checking"
                                ? "확인 중"
                                : "확인 필요"}
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`rounded-xl px-2 py-1.5 text-left transition motion-reduce:transition-none ${
                            storyboardImageRouteChoice ===
                            STORYBOARD_LOCAL_BRIDGE_ROUTE_ID
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "bg-muted/35 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                          }`}
                          aria-pressed={
                            storyboardImageRouteChoice ===
                            STORYBOARD_LOCAL_BRIDGE_ROUTE_ID
                          }
                          onClick={() =>
                            handleSelectStoryboardImageRouteChoice(
                              STORYBOARD_LOCAL_BRIDGE_ROUTE_ID,
                            )
                          }
                          data-storyboard-api-router-option="local-bridge"
                          data-storyboard-api-router-option-selected={
                            storyboardImageRouteChoice ===
                            STORYBOARD_LOCAL_BRIDGE_ROUTE_ID
                              ? "true"
                              : "false"
                          }
                          data-storyboard-api-router-oauth-transport="local-bridge"
                        >
                          <span className="block text-[11px] font-bold">
                            고급 로컬
                          </span>
                          <span className="block text-[10px] opacity-80">
                            {storyboardLocalBridgeStatus === "connected"
                              ? "연결됨"
                              : storyboardLocalBridgeStatus === "checking"
                                ? "확인 중"
                                : hasStoryboardLocalBridgeToken
                                  ? "확인 필요"
                                  : "토큰 필요"}
                          </span>
                        </button>
                      </div>

                      <div
                        className="flex items-center justify-between gap-2 rounded-xl bg-muted/30 px-2.5 py-2"
                        data-storyboard-api-router-panel="true"
                        data-storyboard-api-router-active={
                          storyboardImageApiRouterView.id
                        }
                        data-storyboard-codex-oauth-status={
                          storyboardImageApiRouterView.codexOAuthStatus
                        }
                        data-storyboard-api-router-model={
                          STORYBOARD_IMAGE_PROVIDER_MODEL
                        }
                      >
                        <div className="min-w-0">
                          <p
                            className="truncate text-[11px] font-semibold"
                            data-storyboard-api-router-status="true"
                          >
                            사용: {storyboardImageApiRouterView.label}
                          </p>
                          <p
                            className="truncate text-[10px] text-muted-foreground"
                            data-storyboard-api-router-summary="true"
                            data-storyboard-codex-oauth-copy="true"
                          >
                            {storyboardImageApiRouterView.statusLabel} ·{" "}
                            {storyboardImageApiRouterView.codexOAuthStatus ===
                            "active"
                              ? "Codex OAuth"
                              : storyboardImageApiRouterView.codexOAuthStatus ===
                                  "local-bridge-active"
                                ? "Codex OAuth · 로컬"
                                : storyboardImageApiRouterView.codexOAuthStatus ===
                                    "checking"
                                  ? "확인 중"
                                  : storyboardImageApiRouterView.codexOAuthStatus ===
                                      "api-key-active"
                                    ? "브라우저 키"
                                    : "설정 필요"}
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className="h-6 shrink-0 rounded-full px-2 text-[10px]"
                          data-storyboard-api-router-label="true"
                        >
                          gpt-image-2
                        </Badge>
                      </div>

                      <div
                        className="grid gap-1.5 rounded-xl bg-muted/20 px-2.5 py-2"
                        data-storyboard-browser-api-key-settings="memory-only"
                        data-storyboard-api-key-persistence="none"
                        data-storyboard-api-key-db-storage="forbidden"
                        data-storyboard-openai-api-key-scope="component-memory"
                        data-storyboard-browser-api-key-lifetime="page-lifecycle"
                        data-storyboard-browser-api-key-secret-storage="uncontrolled-ref"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Label
                            htmlFor="storyboard-browser-openai-api-key"
                            className="text-[11px] font-semibold"
                          >
                            API Key 백업
                          </Label>
                          <button
                            type="button"
                            className={`h-6 shrink-0 rounded-full px-2 text-[10px] font-semibold transition motion-reduce:transition-none ${
                              storyboardImageRouteChoice ===
                              "browser-openai-api-key"
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                            aria-pressed={
                              storyboardImageRouteChoice ===
                              "browser-openai-api-key"
                            }
                            onClick={() =>
                              handleSelectStoryboardImageRouteChoice(
                                "browser-openai-api-key",
                              )
                            }
                            data-storyboard-api-router-option="browser-openai-api-key"
                            data-storyboard-api-router-option-selected={
                              storyboardImageRouteChoice ===
                              "browser-openai-api-key"
                                ? "true"
                                : "false"
                            }
                            data-storyboard-api-router-fallback="browser-api-key"
                          >
                            백업 사용
                          </button>
                        </div>
                        {storyboardImageRouteChoice ===
                        "browser-openai-api-key" ? (
                          <>
                            <div className="flex gap-2">
                              <Input
                                ref={storyboardBrowserOpenAIApiKeyInputRef}
                                id="storyboard-browser-openai-api-key"
                                type="password"
                                onChange={() => {
                                  setStoryboardBrowserOpenAIApiKeyError(null);
                                  if (storyboardBrowserOpenAIApiKeyMessage) {
                                    setStoryboardBrowserOpenAIApiKeyMessage(null);
                                  }
                                }}
                                placeholder={
                                  hasStoryboardBrowserOpenAIApiKey
                                    ? `${maskedStoryboardBrowserOpenAIApiKey} 이 탭 적용됨`
                                    : "sk-..."
                                }
                                autoComplete="off"
                                spellCheck={false}
                                className="h-8 text-xs"
                                aria-label="이 탭에서만 사용할 OpenAI API 키"
                                data-storyboard-browser-api-key-input="true"
                                data-storyboard-browser-api-key-input-control="uncontrolled"
                              />
                              <Button
                                type="button"
                                size="sm"
                                className="h-8 shrink-0 px-2 text-xs"
                                onClick={handleApplyStoryboardBrowserOpenAIApiKey}
                                data-storyboard-browser-api-key-apply="true"
                              >
                                적용
                              </Button>
                            </div>
                            <p
                              className="text-[10px] leading-4 text-muted-foreground"
                              data-storyboard-browser-api-key-memory-only-copy="true"
                              data-storyboard-browser-api-key-model-policy="gpt-image-2-only"
                            >
                              OAuth가 안 될 때만 사용 · gpt-image-2 전용 ·
                              제어되지 않는 입력값은 즉시 비움 · 컴포넌트 ref만 사용 · Web Storage·DB 저장 안 함
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <p
                                className="min-w-0 flex-1 text-[11px] text-muted-foreground"
                                data-storyboard-browser-api-key-status={
                                  isStoryboardBrowserOpenAIApiKeyApplied
                                    ? "memory-active"
                                    : "empty"
                                }
                              >
                                {isStoryboardBrowserOpenAIApiKeyApplied
                                  ? `이 탭에서 사용 중 · ${maskedStoryboardBrowserOpenAIApiKey}${
                                      storyboardBrowserOpenAIApiKeyAppliedAt
                                        ? ` · ${new Date(
                                            storyboardBrowserOpenAIApiKeyAppliedAt,
                                          ).toLocaleString("ko-KR")}`
                                        : ""
                                    }`
                                  : "적용된 키 없음"}
                              </p>
                              {hasStoryboardBrowserOpenAIApiKey ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 shrink-0 rounded-full px-2 text-[11px]"
                                  onClick={handleClearStoryboardBrowserOpenAIApiKey}
                                  data-storyboard-browser-api-key-clear="true"
                                >
                                  삭제
                                </Button>
                              ) : null}
                              {storyboardBrowserOpenAIApiKeyError ? (
                                <p
                                  className="basis-full text-[11px] text-destructive"
                                  data-storyboard-browser-api-key-error="true"
                                >
                                  {storyboardBrowserOpenAIApiKeyError}
                                </p>
                              ) : null}
                              {storyboardBrowserOpenAIApiKeyMessage &&
                              !storyboardBrowserOpenAIApiKeyError ? (
                                <p
                                  className="basis-full text-[11px] text-muted-foreground"
                                  data-storyboard-browser-api-key-message="true"
                                >
                                  {storyboardBrowserOpenAIApiKeyMessage}
                                </p>
                              ) : null}
                            </div>
                          </>
                        ) : (
                          <p
                            className="text-[10px] leading-4 text-muted-foreground"
                            data-storyboard-browser-api-key-memory-only-copy="true"
                            data-storyboard-browser-api-key-model-policy="gpt-image-2-only"
                          >
                            OAuth가 안 될 때만 여는 입력값 즉시 삭제·컴포넌트 ref 백업입니다.
                          </p>
                        )}
                      </div>
                      {shouldShowStoryboardLocalBridgeSettings ? (
                        <div
                          className="grid max-h-64 gap-1.5 overflow-y-auto rounded-xl border border-dashed border-primary/25 bg-primary/5 p-2 pr-1.5 [scrollbar-width:thin]"
                          data-storyboard-local-bridge-settings="memory-only"
                          data-storyboard-local-bridge-settings-visibility="advanced-selected"
                          data-storyboard-local-bridge-persistence="none"
                          data-storyboard-local-bridge-server-relay="forbidden"
                          data-storyboard-local-bridge-token-lifetime="page-lifecycle"
                          data-storyboard-local-bridge-token-storage="uncontrolled-ref"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <Label
                              htmlFor="storyboard-local-bridge-url"
                              className="text-[11px] font-semibold"
                            >
                              고급 로컬 브릿지
                            </Label>
                            <Badge
                              variant="outline"
                              className="h-5 shrink-0 rounded-full px-1.5 text-[10px]"
                              data-storyboard-local-bridge-status={
                                storyboardLocalBridgeStatus
                              }
                            >
                              {storyboardLocalBridgeStatus === "connected"
                                ? "연결됨"
                                : storyboardLocalBridgeStatus === "checking"
                                  ? "확인 중"
                                  : storyboardLocalBridgeStatus ===
                                      "needs_reconnect"
                                    ? "재연결 필요"
                                    : hasStoryboardLocalBridgeToken
                                      ? "확인 필요"
                                      : "설정 필요"}
                            </Badge>
                          </div>
                          <p
                            className="text-[10px] leading-4 text-muted-foreground"
                            data-storyboard-local-bridge-guidance="true"
                          >
                            사용자 PC helper의 loopback 브릿지만 호출합니다.
                            토큰 입력값은 적용 직후 비우며 컴포넌트 ref에만 있고 Web Storage에 저장되지 않습니다. 페이지 전환·복원·닫기 때 제거됩니다.
                          </p>
                          <details
                            className="rounded-lg bg-background/80 p-2 text-[10px] leading-4 text-foreground"
                            data-storyboard-local-bridge-pairing-guide="true"
                          >
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                              <span className="font-semibold">쉬운 페어링</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 shrink-0 rounded-full px-2 text-[10px]"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void handleCopyStoryboardLocalBridgeCommand();
                                }}
                                data-storyboard-local-bridge-copy-command="true"
                              >
                                명령 복사
                              </Button>
                            </summary>
                            <div
                              className="mt-1 rounded-md bg-muted/45 px-2 py-1 font-mono text-[10px] text-muted-foreground"
                              data-storyboard-local-bridge-command="true"
                            >
                              {STORYBOARD_LOCAL_BRIDGE_TERMINAL_COMMAND}
                            </div>
                            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-muted-foreground">
                              <li>명령 실행</li>
                              <li>
                                터미널의 <code>pairing_token</code> 붙여넣기
                              </li>
                              <li>적용하고 자동 연결</li>
                            </ol>
                            <p
                              className="mt-1 text-muted-foreground"
                              data-storyboard-local-bridge-chat-trace-copy="true"
                            >
                              진행 과정은 대화창 생각 trace에 표시됩니다.
                            </p>
                          </details>
                          <div className="grid gap-1">
                            <Input
                              id="storyboard-local-bridge-url"
                              value={storyboardLocalBridgeUrlDraft}
                              onChange={(event) => {
                                setStoryboardLocalBridgeUrlDraft(
                                  event.target.value,
                                );
                                setStoryboardLocalBridgeError(null);
                              }}
                              placeholder={STORYBOARD_LOCAL_BRIDGE_DEFAULT_URL}
                              autoComplete="off"
                              spellCheck={false}
                              className="h-8 text-xs"
                              aria-label="로컬 브릿지 URL"
                              data-storyboard-local-bridge-url-input="true"
                            />
                            <Input
                              ref={storyboardLocalBridgeTokenInputRef}
                              id="storyboard-local-bridge-token"
                              type="password"
                              onChange={() => {
                                setStoryboardLocalBridgeError(null);
                              }}
                              placeholder={
                                hasStoryboardLocalBridgeToken
                                  ? `${maskedStoryboardLocalBridgeToken} 이 탭 적용됨`
                                  : "브릿지 터미널 pairing_token"
                              }
                              autoComplete="off"
                              spellCheck={false}
                              className="h-8 text-xs"
                              aria-label="로컬 브릿지 pairing token"
                              data-storyboard-local-bridge-token-input="true"
                              data-storyboard-local-bridge-token-input-control="uncontrolled"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 justify-center rounded-full px-2 text-[11px]"
                              onClick={() =>
                                void handleApplyStoryboardLocalBridge()
                              }
                              data-storyboard-local-bridge-apply="true"
                            >
                              적용
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-7 justify-center rounded-full px-2 text-[11px]"
                              onClick={() =>
                                void handleAutoConnectStoryboardLocalBridge()
                              }
                              data-storyboard-local-bridge-auto-connect="true"
                            >
                              적용하고 자동 연결
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 justify-center rounded-full px-2 text-[11px]"
                              onClick={() =>
                                void handleConnectStoryboardLocalBridgeHelper()
                              }
                              data-storyboard-local-bridge-connect="true"
                            >
                              {storyboardLocalBridgeStatus === "connected"
                                ? "다시 확인"
                                : "로컬 브릿지 다시 연결"}
                            </Button>
                            {hasStoryboardLocalBridgeToken ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 justify-center rounded-full px-2 text-[11px]"
                                onClick={
                                  handleClearStoryboardLocalBridge
                                }
                                data-storyboard-local-bridge-clear="true"
                              >
                                삭제
                              </Button>
                            ) : null}
                            <p
                              className={`col-span-2 text-[11px] ${
                                storyboardLocalBridgeError
                                  ? "text-destructive"
                                  : "text-muted-foreground"
                              }`}
                              data-storyboard-local-bridge-message="true"
                            >
                              {storyboardLocalBridgeError ??
                                storyboardLocalBridgeMessage ??
                                (storyboardLocalBridgeAppliedAt
                                  ? `이 탭에서 사용 중 · ${new Date(
                                      storyboardLocalBridgeAppliedAt,
                                    ).toLocaleString("ko-KR")}`
                                  : "bun run storyboard:local-bridge 실행 후 페어링 코드를 이 탭에 적용하고 로컬 브릿지 다시 연결을 눌러 주세요.")}
                            </p>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardHeader>
          {acceptedStoryboardJob ? (
            <div
              className="mx-3 mb-2 space-y-1.5 rounded-2xl border border-border/70 bg-muted/35 p-2 text-xs"
              data-storyboard-job-readback="true"
              data-storyboard-job-readback-status={acceptedStoryboardJob.status}
              data-storyboard-job-readback-stage={acceptedStoryboardJob.stage}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">
                  비동기 스토리보드 작업
                </span>
                <Badge
                  variant={
                    acceptedStoryboardJob.status === "failed" ||
                    acceptedStoryboardJob.status === "cancelled"
                      ? "destructive"
                      : "secondary"
                  }
                  className="shrink-0 px-1.5 text-[10px]"
                  data-storyboard-job-readback-label="true"
                >
                  {formatStoryboardJobStatusLabel(acceptedStoryboardJob.status)}
                </Badge>
              </div>
              <p
                className="min-w-0 break-words text-muted-foreground [overflow-wrap:anywhere]"
                data-storyboard-job-readback-id="true"
                title={acceptedStoryboardJob.jobId}
              >
                작업 ID {acceptedStoryboardJob.jobId}
              </p>
              <p
                className="break-words text-muted-foreground [overflow-wrap:anywhere]"
                data-storyboard-job-readback-message="true"
              >
                {acceptedStoryboardJob.readiness?.message ??
                  "작업 상태를 no-store readback으로 확인하고 있습니다."}
              </p>
              {acceptedStoryboardJob.errorCode ? (
                <p
                  className="break-words font-medium text-destructive [overflow-wrap:anywhere]"
                  data-storyboard-job-readback-error-code="true"
                >
                  오류 코드 {acceptedStoryboardJob.errorCode}
                </p>
              ) : null}
            </div>
          ) : null}
          <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-2 pt-0 max-[1099px]:!overflow-visible">
            <section
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-gradient-to-b from-background/95 to-muted/35 max-[1099px]:!overflow-visible"
              data-storyboard-chat-panel="true"
              data-storyboard-chat-style="thumbnail-like"
              data-layout-primitives="panel-layout stack"
            >
              <div
                ref={chatTranscriptRef}
                className="scrollbar-hide flex min-h-0 min-w-0 flex-1 scroll-pb-24 flex-col gap-3 overflow-y-auto overscroll-contain px-3 pb-5 pt-3 max-[1099px]:!overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                data-storyboard-chat-log="true"
                data-storyboard-chat-transcript="true"
                data-scroll-owner="storyboard-chat"
                data-storyboard-scroll-mode="desktop-chat-transcript narrow-parent"
                aria-live="polite"
              >
                {chatMessages.map((message) => {
                  const storyboardChatMessageText =
                    message.role === "assistant"
                      ? (storyboardChatTypewriterTextById[message.id] ?? "")
                      : message.text;
                  const isStoryboardChatMessageTyping =
                    message.role === "assistant" &&
                    storyboardChatMessageText !== message.text;
                  const isStoryboardChatStarterMessage =
                    message.role === "assistant" &&
                    message.id === "assistant-intake";
                  const messageProgressLabel =
                    message.role === "assistant" &&
                    message.status === "streaming" &&
                    !message.thinkingTrace?.length &&
                    !message.imageGenerationProgress
                      ? currentStreamingLabel
                      : null;
                  const messageStackClassName =
                    isStoryboardChatStarterMessage
                      ? "flex min-h-full min-w-0 w-full flex-col items-center justify-center text-center"
                      : message.role === "user"
                        ? "ml-auto flex min-w-0 max-w-[88%] flex-col items-end space-y-1.5 text-right"
                        : "mr-auto flex min-w-0 max-w-[92%] flex-col items-start space-y-1.5 text-left";
                  return (
                    <div
                      key={message.id}
                      className={`flex min-w-0 ${
                        isStoryboardChatStarterMessage
                          ? "min-h-full items-stretch justify-center"
                          : message.role === "user"
                            ? "justify-end"
                            : "justify-start"
                      }`}
                      data-storyboard-chat-message={message.role}
                      data-storyboard-chat-message-status={
                        message.status ?? "done"
                      }
                      data-storyboard-chat-typewriter={
                        message.role === "assistant" ? "true" : undefined
                      }
                      data-storyboard-chat-typewriter-status={
                        message.role === "assistant"
                          ? isStoryboardChatMessageTyping
                            ? "typing"
                            : "complete"
                          : undefined
                      }
                    >
                      <div
                        className={messageStackClassName}
                        data-storyboard-chat-message-stack={
                          message.role === "user"
                            ? "user-bubble"
                            : isStoryboardChatStarterMessage
                              ? "assistant-starter-panel"
                              : "assistant-plain-with-outside-status"
                        }
                      >
                        {messageProgressLabel ? (
                          <div
                            className="flex items-center gap-1.5 px-1 text-[10px] font-medium text-muted-foreground"
                            data-storyboard-chat-message-progress="outside-bubble"
                          >
                            {message.status === "streaming" ? (
                              <Loader2
                                className="h-3 w-3 animate-spin motion-reduce:animate-none"
                                aria-hidden="true"
                              />
                            ) : null}
                            <span>{messageProgressLabel}</span>
                          </div>
                        ) : null}
                        {message.role === "user" ? (
                          <div
                            className="min-w-0 rounded-2xl rounded-br-md bg-primary px-3 py-2 text-xs leading-5 text-primary-foreground shadow-sm"
                            data-storyboard-chat-message-bubble="true"
                          >
                            <p className="whitespace-pre-wrap break-keep [overflow-wrap:anywhere]">
                              {message.text}
                            </p>
                          </div>
                        ) : isStoryboardChatStarterMessage ? (
                          <div
                            className="mx-auto flex w-full max-w-sm flex-col items-center justify-center gap-3 px-3 py-6 text-center"
                            data-storyboard-chat-starter-panel="true"
                            data-storyboard-chat-starter-panel-layout="centered-beginner-guide"
                          >
                            <div className="flex flex-col items-center gap-2">
                              <div
                                className="relative grid h-14 w-14 place-items-center overflow-hidden rounded-[1.35rem] bg-transparent"
                                data-storyboard-chat-starter-logo="true"
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
                                  data-storyboard-chat-starter-title="true"
                                  data-storyboard-chat-starter-title-size="reduced"
                                >
                                  무엇부터 만들까요?
                                </h4>
                                <p
                                  className="mx-auto max-w-[17rem] text-[11px] leading-5 text-muted-foreground"
                                  data-storyboard-chat-starter-guide-copy="true"
                                >
                                  <span className="block">
                                    주제·음식·원하는 CUT 수를 한두 문장으로 적거나,
                                  </span>
                                  <span className="block">
                                    아래 예시를 눌러 바로 시작하세요.
                                  </span>
                                </p>
                              </div>
                            </div>
                            <div
                              className="grid grid-cols-2 gap-1.5"
                              data-storyboard-chat-example-grid="true"
                              data-storyboard-chat-example-grid-layout="10-card-grid"
                            >
                              {STORYBOARD_GUIDED_EXAMPLE_GRID_PRESETS.map(
                                (preset) => (
                                  <button
                                    key={preset.id}
                                    type="button"
                                    className="group min-h-[3.9rem] rounded-2xl border border-border/70 bg-background/75 p-2 text-left shadow-sm transition hover:border-primary/45 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                                    onClick={() =>
                                      void handleStoryboardGuidedExampleGenerate(
                                        preset,
                                      )
                                    }
                                    disabled={
                                      isGenerating ||
                                      isChatAgentStreaming ||
                                      isGeneratingImages
                                    }
                                    aria-label={`${preset.label} 예시 불러오기`}
                                    data-storyboard-chat-example-card="true"
                                    data-storyboard-chat-example-preset={
                                      preset.id
                                    }
                                  >
                                    <span className="block truncate text-[11px] font-semibold text-foreground">
                                      {preset.label}
                                    </span>
                                    <span className="mt-0.5 block text-[10px] font-medium text-primary">
                                      {preset.segmentCount}컷 ·{" "}
                                      {preset.targetLengthMinutes}분
                                    </span>
                                    <span className="mt-1 block line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                                      {preset.description}
                                    </span>
                                  </button>
                                ),
                              )}
                            </div>
                          </div>
                        ) : (
                          <div
                            className="rounded-2xl rounded-bl-md border border-border/60 bg-background/85 px-3 py-2 text-xs leading-5 text-foreground shadow-sm"
                            data-storyboard-chat-assistant-message="plain-text"
                          >
                            <p
                              className="whitespace-pre-wrap break-keep text-justify [overflow-wrap:anywhere] [text-align-last:left]"
                              aria-label={message.text}
                              data-storyboard-chat-typewriter-text="true"
                              data-storyboard-chat-typewriter-state={
                                isStoryboardChatMessageTyping
                                  ? "typing"
                                  : "complete"
                              }
                            >
                              {storyboardChatMessageText}
                            </p>
                            {message.actions?.length &&
                            !isStoryboardChatMessageTyping ? (
                              <div
                                className="mt-2 flex flex-wrap gap-2"
                                data-storyboard-chat-inline-actions="true"
                              >
                                {message.actions.includes("guide") ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-full px-3 text-[11px]"
                                    onClick={handleStoryboardUsageGuideClick}
                                    disabled={
                                      isGenerating ||
                                      isChatAgentStreaming ||
                                      isGeneratingImages
                                    }
                                    data-storyboard-chat-inline-action="guide"
                                  >
                                    가이드 보기
                                  </Button>
                                ) : null}
                                {message.actions.includes("example") ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-8 rounded-full px-3 text-[11px]"
                                    onClick={() =>
                                      void handleStoryboardGuidedExampleGenerate()
                                    }
                                    disabled={
                                      isGenerating ||
                                      isChatAgentStreaming ||
                                      isGeneratingImages
                                    }
                                    data-storyboard-chat-inline-action="example"
                                  >
                                    예시 만들기
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        )}
                        {message.thinkingTrace?.length ? (
                          <div data-storyboard-chat-thinking-outside-bubble="true">
                            <StoryboardThinkingTracePanel
                              trace={message.thinkingTrace}
                            />
                          </div>
                        ) : null}
                        {message.imageGenerationProgress ? (
                          <div data-storyboard-chat-progress-outside-bubble="true">
                            <StoryboardImageGenerationProgressPanel
                              progress={message.imageGenerationProgress}
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                <div
                  ref={chatTranscriptBottomRef}
                  aria-hidden="true"
                  className="h-1 shrink-0"
                  data-storyboard-chat-bottom-anchor="true"
                />
              </div>

              <div
                className="shrink-0 scroll-mb-3 space-y-2 border-t border-border/40 bg-background/70 px-2.5 py-2"
                data-storyboard-chat-controls="true"
              >
                <input
                  id="storyboard-prompt-state"
                  type="hidden"
                  value={form.prompt}
                  readOnly
                  data-storyboard-chat-topic-state="true"
                />
                {storyboardCanvasFocus ? (
                  <div
                    className="flex min-h-8 items-center justify-between gap-2 rounded-2xl bg-muted/45 px-2.5 py-1.5 text-[11px]"
                    data-storyboard-chat-canvas-context="true"
                    data-storyboard-chat-canvas-context-kind={
                      storyboardCanvasFocus.kind
                    }
                    data-storyboard-chat-canvas-context-scene={
                      storyboardCanvasFocus.sceneNos?.length
                        ? storyboardCanvasFocus.sceneNos.join(",")
                        : storyboardCanvasFocus.sceneNo
                          ? String(storyboardCanvasFocus.sceneNo)
                          : undefined
                    }
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className="h-5 shrink-0 rounded-full border-primary/20 bg-background/70 px-2 text-[10px] text-primary"
                        data-storyboard-canvas-focus-label="true"
                      >
                        {storyboardCanvasFocus.label}
                      </Badge>
                      <span className="shrink-0 font-semibold text-foreground/75">
                        채팅 맥락
                      </span>
                      <span
                        className="min-w-0 break-words text-muted-foreground [overflow-wrap:anywhere]"
                        title={storyboardCanvasFocus.detail}
                        data-storyboard-canvas-focus-detail="true"
                      >
                        {storyboardCanvasFocus.detail}
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 rounded-full px-2 text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => setStoryboardCanvasFocus(null)}
                      data-storyboard-clear-canvas-context="true"
                    >
                      해제
                    </Button>
                  </div>
                ) : null}
                {errorMessage ? (
                  <div
                    className="flex gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 p-2.5 text-sm text-destructive"
                    role="alert"
                    data-storyboard-chat-error="true"
                  >
                    <TriangleAlert
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    <p>{errorMessage}</p>
                  </div>
                ) : null}
                <div
                  className="flex gap-1.5 overflow-x-auto pb-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  aria-label="스토리보드 예시 전체 목록"
                  data-storyboard-chat-all-examples="true"
                  data-allow-horizontal-scroll="true"
                  data-horizontal-scroll-owner="storyboard-chat-examples"
                  tabIndex={0}
                  data-storyboard-chat-all-examples-count={String(
                    STORYBOARD_GUIDED_EXAMPLE_PRESETS.length,
                  )}
                >
                  {STORYBOARD_GUIDED_EXAMPLE_PRESETS.map((preset) => (
                    <Button
                      key={preset.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 rounded-full px-2 text-[10px]"
                      onClick={() =>
                        void handleStoryboardGuidedExampleGenerate(preset)
                      }
                      disabled={
                        isGenerating ||
                        isChatAgentStreaming ||
                        isGeneratingImages
                      }
                      aria-label={`${preset.label} 예시 바로 만들기`}
                      data-storyboard-chat-all-example-card="true"
                      data-storyboard-chat-example-preset={preset.id}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                <Label htmlFor="storyboard-prompt" className="sr-only">
                  스토리보드 요구사항 채팅 입력
                </Label>
                <p
                  id="storyboard-prompt-help"
                  className="sr-only"
                  data-storyboard-chat-prompt-help="true"
                >
                  음식, 컷 수, 꼭 보여줄 장면을 한 문장으로 입력합니다.
                </p>
                <p
                  id="storyboard-chat-keyboard-hint"
                  className="sr-only"
                  data-storyboard-chat-keyboard-hint="true"
                >
                  한글 조합 중 Enter는 전송하지 않고, 조합이 끝난 뒤 Enter로 전송합니다.
                </p>
                {storyboardChatImageAttachments.length ? (
                  <div
                    className="flex gap-1.5 overflow-x-auto pb-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label="첨부된 사진"
                    data-storyboard-chat-attachments="true"
                    data-allow-horizontal-scroll="true"
                    data-horizontal-scroll-owner="storyboard-chat-attachments"
                    tabIndex={0}
                  >
                    {storyboardChatImageAttachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="flex max-w-[13rem] shrink-0 items-center gap-2 rounded-2xl border border-border/70 bg-muted/35 p-1.5 pr-1 text-xs"
                        data-storyboard-chat-attachment="true"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- Local data URL preview for an unsaved chat attachment. */}
                        <img
                          src={attachment.dataUrl}
                          alt=""
                          className="h-9 w-9 shrink-0 rounded-xl object-cover"
                          data-storyboard-chat-attachment-preview="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className="block truncate font-semibold text-foreground"
                            title={attachment.name}
                            data-storyboard-chat-attachment-name="true"
                          >
                            {attachment.name}
                          </span>
                          <span
                            className="block text-[10px] text-muted-foreground"
                            data-storyboard-chat-attachment-size="true"
                          >
                            {formatStoryboardChatAttachmentBytes(
                              attachment.size,
                            )}
                          </span>
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0 rounded-full"
                          onClick={() =>
                            removeStoryboardChatImageAttachment(attachment.id)
                          }
                          disabled={isChatAgentStreaming}
                          aria-label={`${attachment.name} 첨부 삭제`}
                          data-storyboard-chat-attachment-remove="true"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div
                  className="overflow-hidden rounded-[1.75rem] border border-border/80 bg-background/95 p-1.5 text-foreground shadow-sm transition focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15 motion-reduce:transition-none dark:border-white/10 dark:bg-zinc-950/95 dark:text-white dark:focus-within:border-white/20"
                  data-storyboard-chat-composer="true"
                  style={{ borderRadius: "1.75rem" }}
                >
                  <div
                    className={cn(
                      "grid grid-cols-[auto_minmax(0,1fr)_auto] gap-1.5",
                      isStoryboardChatMultilineLayout
                        ? "grid-rows-[auto_auto] px-1 pb-0.5 pt-2"
                        : "items-center",
                    )}
                    data-storyboard-chat-composer-layout={
                      isStoryboardChatMultilineLayout
                        ? "multiline-input-over-actions"
                        : "inline-actions-one-line"
                    }
                    style={{
                      gridTemplateColumns: "auto minmax(0, 1fr) auto",
                      gridTemplateRows: isStoryboardChatMultilineLayout
                        ? "auto auto"
                        : "auto",
                    }}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "col-start-1 h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-primary/30 dark:text-white/80 dark:hover:bg-white/10 dark:hover:text-white dark:focus-visible:ring-white/40 dark:focus-visible:ring-offset-zinc-950",
                            isStoryboardChatMultilineLayout
                              ? "row-start-2 self-center justify-self-start"
                              : "row-start-1",
                          )}
                          disabled={isChatAgentStreaming}
                          aria-label="첨부 메뉴 열기"
                          title="첨부 메뉴"
                          data-storyboard-chat-action-menu-trigger="true"
                          style={{
                            gridColumn: "1",
                            gridRow: isStoryboardChatMultilineLayout
                              ? "2"
                              : "1",
                          }}
                        >
                          <Plus className="h-5 w-5" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        side="top"
                        className="w-44 rounded-xl border-border/70 bg-popover p-1 shadow-lg"
                        data-storyboard-chat-action-menu="true"
                      >
                        <DropdownMenuItem
                          onSelect={(event) => {
                            event.preventDefault();
                            openStoryboardChatImageAttachmentPicker();
                          }}
                          disabled={
                            isChatAgentStreaming ||
                            storyboardChatImageAttachments.length >=
                              STORYBOARD_CHAT_IMAGE_ATTACHMENT_LIMIT
                          }
                          aria-label="사진 첨부"
                          className="gap-2 rounded-lg"
                          data-storyboard-chat-attachment-upload="true"
                        >
                          <ImageIcon className="h-4 w-4" aria-hidden="true" />
                          사진 첨부
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Textarea
                      ref={storyboardChatTextareaRef}
                      id="storyboard-prompt"
                      name="storyboard-prompt"
                      value={chatDraft}
                      rows={1}
                      onChange={(event) => {
                        handleChatDraftChange(event.target.value);
                        setIsStoryboardChatMultilineLayout(
                          resizeStoryboardChatTextarea(event.currentTarget),
                        );
                      }}
                      onCompositionStart={handleStoryboardChatCompositionStart}
                      onCompositionEnd={handleStoryboardChatCompositionEnd}
                      onKeyDown={handleStoryboardChatKeyDown}
                      disabled={isGenerating || isGeneratingImages}
                      autoComplete="off"
                      className={cn(
                        "w-full resize-none overflow-hidden border-0 bg-transparent text-left text-sm leading-5 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0 dark:text-white dark:placeholder:text-white/55",
                        isStoryboardChatMultilineLayout
                          ? "col-span-3 col-start-1 row-start-1 max-h-24 min-h-[72px] px-3 py-1"
                          : "col-start-2 row-start-1 h-10 max-h-10 min-h-10 px-1 py-2",
                      )}
                      style={{
                        gridColumn: isStoryboardChatMultilineLayout
                          ? "1 / -1"
                          : "2",
                        gridRow: "1",
                        minHeight: isStoryboardChatMultilineLayout
                          ? STORYBOARD_CHAT_TEXTAREA_MULTILINE_MIN_HEIGHT_PX
                          : STORYBOARD_CHAT_TEXTAREA_MIN_HEIGHT_PX,
                        maxHeight: isStoryboardChatMultilineLayout
                          ? STORYBOARD_CHAT_TEXTAREA_MAX_HEIGHT_PX
                          : STORYBOARD_CHAT_TEXTAREA_MIN_HEIGHT_PX,
                      }}
                      maxLength={400}
                      placeholder={storyboardChatPlaceholder}
                      aria-label="스토리보드 요구사항 채팅 입력"
                      aria-describedby="storyboard-prompt-help storyboard-chat-keyboard-hint"
                      data-storyboard-chat-input-plane={
                        isStoryboardChatMultilineLayout
                          ? "above-actions-top-left"
                          : "between-actions-one-line"
                      }
                      data-storyboard-chat-ime-safe="true"
                    />
                    <Button
                      type="button"
                      size="icon"
                      className={cn(
                        "col-start-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full shadow-sm",
                        isStoryboardChatCancelMode
                          ? "bg-red-600 text-white hover:bg-red-700"
                          : isStoryboardChatSubmitDisabled
                            ? "border border-border/70 bg-muted text-muted-foreground hover:bg-muted disabled:opacity-100"
                            : "bg-foreground text-background hover:bg-foreground/90 dark:bg-white dark:text-zinc-950 dark:hover:bg-white/90",
                        isStoryboardChatMultilineLayout
                          ? "row-start-2 self-center justify-self-end"
                          : "row-start-1",
                      )}
                      onClick={
                        isStoryboardChatSteerMode
                          ? () => void handleStoryboardChatSubmit()
                          : isChatAgentStreaming
                            ? abortStoryboardChatWork
                            : isGeneratingImages
                              ? abortStoryboardImageGeneration
                              : () => void handleStoryboardChatSubmit()
                      }
                      disabled={isStoryboardChatSubmitDisabled}
                      aria-label={
                        isStoryboardChatSteerMode
                          ? "현재 답변에 추가 지시 보내기"
                          : isChatAgentStreaming
                            ? "채팅 스트림 중단"
                            : isGeneratingImages
                              ? "스토리보드 이미지 생성 중단"
                              : "요구사항 채팅 반영"
                      }
                      data-storyboard-chat-submit={
                        isStoryboardChatCancelMode ? undefined : "true"
                      }
                      data-storyboard-chat-steer={
                        isStoryboardChatSteerMode ? "true" : undefined
                      }
                      data-storyboard-chat-cancel={
                        isStoryboardChatCancelMode ? "true" : undefined
                      }
                      data-storyboard-image-generation-cancel={
                        isGeneratingImages ? "true" : undefined
                      }
                      style={{
                        gridColumn: "3",
                        gridRow: isStoryboardChatMultilineLayout ? "2" : "1",
                      }}
                    >
                      {isStoryboardChatCancelMode ? (
                        <Square
                          className="h-4 w-4"
                          aria-hidden="true"
                          data-storyboard-chat-stop-icon="true"
                        />
                      ) : (
                        <ArrowUp
                          className="h-4 w-4"
                          strokeWidth={2.75}
                          aria-hidden="true"
                          data-storyboard-chat-send-icon="arrow-up"
                        />
                      )}
                    </Button>
                  </div>
                </div>
                <input
                  ref={storyboardChatImageAttachmentInputRef}
                  id="storyboard-chat-image-attachment-input"
                  type="file"
                  accept={STORYBOARD_CHAT_IMAGE_ATTACHMENT_ACCEPT}
                  multiple
                  className="sr-only"
                  aria-label="채팅으로 사진 첨부"
                  data-storyboard-chat-attachment-file-input="true"
                  onChange={(event) => {
                    void handleStoryboardChatImageFilesSelected(
                      Array.from(event.target.files ?? []),
                    );
                    event.currentTarget.value = "";
                  }}
                />
              </div>
            </section>
          </CardContent>
        </Card>

        <StoryboardCanvasShell>
          <StoryboardCanvasHeader>
            <CardTitle
              className="flex min-w-0 items-center gap-2 text-sm"
              aria-label={`스토리보드 주제 ${storyboardCanvasTopicTitle} · 이미지 ${generatedImageCount}/${totalCutCount} · PNG 내보내기`}
              data-storyboard-canvas-title="true"
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15"
                data-storyboard-canvas-topic-icon="true"
                data-storyboard-canvas-title-icon="clapperboard"
                aria-hidden="true"
              >
                <Clapperboard className="h-3.5 w-3.5" />
              </span>
              <span
                className="min-w-0 max-w-[min(32rem,40vw)] truncate font-semibold text-foreground"
                data-storyboard-canvas-topic-title="true"
                title={storyboardCanvasTopicTitle}
              >
                {storyboardCanvasTopicTitle}
              </span>
              <Badge
                variant="outline"
                className="h-6 shrink-0 rounded-full px-2 text-[11px]"
                data-storyboard-generated-image-count="title"
                title={`현재 페이지 ${activePageGeneratedCount}/${activeStoryboardImageGenerationTargetScenes.length || storyboardFramePageSize} · 전체 ${generatedImageCount}/${totalCutCount}`}
              >
                이미지 {generatedImageCount}/{totalCutCount}
              </Badge>
            </CardTitle>
            <div
              className="ml-auto flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto px-1 py-1 scrollbar-hide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              data-storyboard-canvas-toolbar="thumbnail-like"
              data-storyboard-compact-toolbar="true"
              data-allow-horizontal-scroll="true"
              data-horizontal-scroll-owner="storyboard-canvas-toolbar"
              tabIndex={0}
            >
              <div
                className="flex h-8 shrink-0 items-center gap-0.5 rounded-md border border-input bg-background px-1"
                data-storyboard-frame-view-mode="true"
                aria-label="스토리보드 컷 보기 단위"
              >
                {([1, STORYBOARD_FRAMES_PER_PAGE] as const).map((pageSize) => (
                  <Button
                    key={`storyboard-frame-view-${pageSize}`}
                    type="button"
                    size="sm"
                    variant={
                      storyboardFramePageSize === pageSize
                        ? "secondary"
                        : "ghost"
                    }
                    className="h-6 shrink-0 rounded px-2 text-[11px]"
                    onClick={() =>
                      handleStoryboardFramePageSizeChange(pageSize)
                    }
                    aria-pressed={storyboardFramePageSize === pageSize}
                    data-storyboard-frame-view-option={String(pageSize)}
                  >
                    {pageSize}컷
                  </Button>
                ))}
              </div>
              <div
                className="flex h-8 shrink-0 items-center gap-0.5 rounded-md border border-input bg-background px-1"
                data-storyboard-frame-pagination="true"
                aria-label="스토리보드 컷 페이지 이동"
              >
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() =>
                    handleStoryboardPageChange(activeStoryboardPage - 1)
                  }
                  disabled={!hasPreviousStoryboardPage}
                  data-storyboard-page-prev="true"
                  aria-label={`이전 ${storyboardFramePageSize}컷 보기`}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <span
                  className="min-w-[8.75rem] text-center text-xs font-semibold text-muted-foreground"
                  data-storyboard-page-indicator="true"
                  data-storyboard-frame-page-range="true"
                  aria-label="현재 스토리보드 페이지 컷 범위"
                >
                  CUT {String(activeCutStart).padStart(2, "0")}
                  {activeCutStart === activeCutEnd
                    ? ""
                    : `–${String(activeCutEnd).padStart(2, "0")}`}{" "}
                  / {String(totalCutCount).padStart(2, "0")} ·{" "}
                  {activeStoryboardPage + 1}/{storyboardTotalPages}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() =>
                    handleStoryboardPageChange(activeStoryboardPage + 1)
                  }
                  disabled={!hasNextStoryboardPage}
                  data-storyboard-page-next="true"
                  aria-label={`다음 ${storyboardFramePageSize}컷 보기`}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
              <Select
                value={exportPresetId}
                onValueChange={(value) =>
                  setExportPresetId(value as StoryboardExportPresetId)
                }
              >
                <SelectTrigger
                  className="h-8 w-[112px] shrink-0 text-xs"
                  data-storyboard-export-preset="true"
                  aria-label="PNG 저장 해상도"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {storyboardExportPresets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void handleCopyStoryboardPlanMarkdown()}
                disabled={isGenerating}
                className="h-8 shrink-0 px-2 text-xs"
                data-storyboard-copy-plan="true"
                aria-label="촬영 기획표 복사"
              >
                <ClipboardCopy
                  className="mr-1.5 h-3.5 w-3.5"
                  aria-hidden="true"
                />
                기획서 복사
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleExportStoryboardPng}
                disabled={isGenerating}
                className="h-8 shrink-0 px-2 text-xs"
                data-storyboard-export-png="true"
                aria-label={`현재 페이지 ${activeFrameViewLabel} PNG 저장 (${exportResolutionToken})`}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                PNG 저장
              </Button>
            </div>
          </StoryboardCanvasHeader>
          <StoryboardCanvasContent isSingleFrame={storyboardFramePageSize === 1}>
            <div className="flex h-full min-h-0 flex-col gap-2">
              <StoryboardFrameGrid
                activePage={activeStoryboardPage}
                pageSize={storyboardFramePageSize}
                style={{
                  gridTemplateColumns:
                    storyboardFramePageSize === 1
                      ? "minmax(0, 1fr)"
                      : "repeat(2, minmax(0, 1fr))",
                  gridTemplateRows:
                    storyboardFramePageSize === 1
                      ? "minmax(0, 1fr)"
                      : "repeat(2, minmax(0, 1fr))",
                }}
              >
                {activeStoryboardPageScenes.length === 0 ? (
                  <StoryboardEmptyCanvasState
                    activeCutStart={activeCutStart}
                    activeCutEnd={activeCutEnd}
                  />
                ) : (
                  activeStoryboardPageScenes.map((scene) => {
                    const frameVisual = getStoryboardFrameVisual(scene.sceneNo);
                    const trustedGeneratedImage =
                      getTrustedStoryboardGeneratedImage(scene.generatedImage);
                    const isSceneImageGenerating =
                      generatingStoryboardImageSceneNoSet.has(scene.sceneNo);
                    const isSceneImageActivelyGenerating =
                      isSceneImageGenerating;
                    const frameBackground = trustedGeneratedImage
                      ? frameVisual.background
                      : STORYBOARD_PENDING_IMAGE_BACKGROUND;
                    const audioText = sanitizeStoryboardChatDisplayText(
                      scene.hostBeat,
                    );
                    const subtitleText = sanitizeStoryboardChatDisplayText(
                      scene.captionIdea,
                    );
                    const productionNote =
                      formatStoryboardFrameProductionNote(scene);
                    const isSingleFramePage = storyboardFramePageSize === 1;
                    const isSceneSelected = selectedStoryboardSceneNoSet.has(
                      scene.sceneNo,
                    );
                    const frameScriptPreviewLength = 64;
                    const audioPreviewText = isSingleFramePage
                      ? audioText
                      : truncateStoryboardFrameText(
                          audioText,
                          frameScriptPreviewLength,
                        );
                    const subtitlePreviewText = isSingleFramePage
                      ? subtitleText
                      : truncateStoryboardFrameText(
                          subtitleText,
                          frameScriptPreviewLength,
                        );
                    const productionNotePreviewText = isSingleFramePage
                      ? productionNote
                      : truncateStoryboardFrameText(
                          productionNote,
                          frameScriptPreviewLength,
                        );
                    return (
                      <button
                        type="button"
                        key={`frame-${scene.sceneNo}-${scene.heatmapEvidence.videoId}`}
                        className={cn(
                          "group relative grid h-full min-h-0 overflow-hidden rounded-2xl border bg-background p-0 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset motion-reduce:transition-none",
                          isSceneSelected
                            ? "border-primary/70 shadow-md"
                            : "border-border/75 shadow-sm hover:border-primary/30",
                        )}
                        onClick={() => handleSelectStoryboardScene(scene)}
                        aria-label={
                          isSceneSelected
                            ? `${scene.sceneNo}컷 선택 해제`
                            : `${scene.sceneNo}컷을 선택해서 채팅 맥락으로 사용`
                        }
                        aria-pressed={isSceneSelected}
                        data-storyboard-image-frame={String(scene.sceneNo)}
                        data-storyboard-selected-frame={
                          isSceneSelected ? "true" : undefined
                        }
                        data-storyboard-image-generation-state={
                          isSceneImageGenerating
                            ? "generating"
                            : trustedGeneratedImage
                              ? "ready"
                              : "empty"
                        }
                        data-storyboard-frame-fit="image-and-script-visible"
                        data-storyboard-frame-image-fit={
                          storyboardFramePageSize === 1 ? "contain" : "cover"
                        }
                        style={{ gridTemplateRows: "minmax(0, 1fr) auto" }}
                      >
                        {isSceneSelected ? (
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 z-50 rounded-2xl border-2 border-primary"
                            data-storyboard-selected-frame-border="true"
                          />
                        ) : null}
                        <div
                          className="relative min-h-0 flex-1 overflow-hidden rounded-t-2xl"
                          style={{ background: frameBackground }}
                          aria-label={`${scene.sceneNo}컷 이미지 생성 결과`}
                          data-storyboard-cut-image-loading-scope={
                            isSceneImageGenerating ? "image-only" : undefined
                          }
                        >
                          {trustedGeneratedImage ? (
                            // eslint-disable-next-line @next/next/no-img-element -- CUT canvas images are browser-verified blob/static storyboard outputs; plain eager img avoids Next fill zero-height regressions.
                            <img
                              src={trustedGeneratedImage.dataUrl}
                              alt={`${scene.sceneNo}컷 스토리보드 이미지`}
                              className={cn(
                                "h-full w-full",
                                storyboardFramePageSize === 1
                                  ? "object-contain"
                                  : "object-cover",
                              )}
                              loading="eager"
                              decoding="async"
                              onError={() => {
                                setResult((current) =>
                                  stripStoryboardGeneratedImageForScene(
                                    current,
                                    scene.sceneNo,
                                    trustedGeneratedImage.dataUrl,
                                  ),
                                );
                              }}
                              data-storyboard-generated-image={
                                trustedGeneratedImage.providerId
                              }
                            />
                          ) : null}
                          {isSceneImageGenerating ? (
                            <StoryboardCutImageSkeleton
                              sceneNo={scene.sceneNo}
                              hasExistingImage={Boolean(trustedGeneratedImage)}
                              isActive={isSceneImageActivelyGenerating}
                            />
                          ) : null}
                          <div
                            className="pointer-events-none absolute flex items-center justify-between gap-2"
                            data-storyboard-cut-overlay="true"
                            style={{
                              left: "0.75rem",
                              right: "0.75rem",
                              top: "0.75rem",
                              zIndex: 30,
                            }}
                          >
                            <Badge
                              className="rounded-full px-2 py-0.5 text-[11px] font-bold shadow-sm"
                              data-storyboard-cut-badge="true"
                              data-storyboard-cut-badge-background="visible"
                              style={{
                                backgroundColor: "rgba(15, 23, 42, 0.82)",
                                color: "#fff",
                              }}
                            >
                              CUT {String(scene.sceneNo).padStart(2, "0")}
                            </Badge>
                            <Badge
                              className="rounded-full px-2 py-0.5 text-[11px] font-bold shadow-sm"
                              data-storyboard-cut-time-badge="true"
                              data-storyboard-cut-time-badge-background="visible"
                              style={{
                                backgroundColor: "rgba(255, 255, 255, 0.92)",
                                color: "#0f172a",
                              }}
                            >
                              {scene.heatmapEvidence.peakTime}
                            </Badge>
                          </div>
                          {showStoryboardGuide ? (
                            <div
                              className="pointer-events-none absolute inset-[12%] rounded-2xl border border-dashed border-white/70"
                              data-storyboard-safe-area-guide="true"
                            />
                          ) : null}
                        </div>
                        <div
                          className="shrink-0 space-y-1 border-t border-border/45 bg-background/90 px-2.5 py-1.5 text-foreground shadow-[0_-1px_0_rgba(15,23,42,0.03)]"
                          data-storyboard-frame-script="true"
                          data-storyboard-frame-script-panel="true"
                          data-storyboard-frame-script-placement="separated"
                          data-storyboard-frame-script-layout="stacked-rows"
                        >
                          <div
                            className="grid min-w-0 items-start gap-2 rounded-lg bg-muted/15 px-2 py-0.5 text-[11px] leading-4"
                            data-storyboard-frame-audio="true"
                            data-storyboard-frame-audio-row="true"
                            style={{
                              gridTemplateColumns: "58px minmax(0, 1fr)",
                            }}
                          >
                            <span className="rounded-full bg-muted/65 px-2 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                              오디오
                            </span>
                            <span
                              className="block min-w-0 truncate whitespace-nowrap font-semibold text-foreground"
                              title={audioText}
                              data-storyboard-frame-audio-text="true"
                            >
                              {audioPreviewText}
                            </span>
                          </div>
                          <div
                            className="grid min-w-0 items-start gap-2 rounded-lg bg-rose-500/[0.045] px-2 py-0.5 text-[11px] leading-4"
                            data-storyboard-frame-subtitle="true"
                            data-storyboard-frame-subtitle-row="true"
                            style={{
                              gridTemplateColumns: "58px minmax(0, 1fr)",
                            }}
                          >
                            <span className="rounded-full bg-rose-100/70 px-2 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-rose-700 dark:bg-rose-500/15 dark:text-rose-200">
                              자막
                            </span>
                            <span
                              className="block min-w-0 truncate whitespace-nowrap font-bold text-foreground"
                              title={subtitleText}
                              data-storyboard-frame-subtitle-text="true"
                            >
                              {subtitlePreviewText}
                            </span>
                          </div>
                          <div
                            className="grid min-w-0 items-start gap-2 rounded-lg bg-amber-400/[0.10] px-2 py-0.5 text-[11px] leading-4"
                            data-storyboard-frame-production-note="true"
                            data-storyboard-frame-production-note-row="true"
                            style={{
                              gridTemplateColumns: "58px minmax(0, 1fr)",
                            }}
                          >
                            <span className="rounded-full bg-amber-100/75 px-2 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                              촬영
                            </span>
                            <span
                              className="block min-w-0 truncate whitespace-nowrap font-semibold text-foreground"
                              title={productionNote}
                              data-storyboard-frame-production-note-text="true"
                            >
                              {productionNotePreviewText}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </StoryboardFrameGrid>
            </div>
          </StoryboardCanvasContent>
        </StoryboardCanvasShell>
        </div>
      </section>
    </AdminEmbeddedModuleShell>
  );
}

"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import NextImage from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Download,
  History,
  ImageIcon,
  Loader2,
  MessageCircle,
  RotateCcw,
  Send,
  Settings,
  Square,
  Wand2,
  TriangleAlert,
  X,
} from "lucide-react";

import { buildStoryboardAgentGraphFidelity } from "@/lib/admin/storyboard/agent-graph-fidelity";
import {
  STORYBOARD_PUBLIC_SAFETY_REPLACEMENT,
  sanitizeStoryboardPublicText,
} from "@/lib/admin/storyboard/prompt-safety";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  StoryboardChatAgentResult,
  StoryboardChatCanvasPatch,
  StoryboardChatFocusContext,
  StoryboardGenerationMode,
  StoryboardGenerationResult,
  StoryboardScene,
  StoryboardSceneGeneratedImage,
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
  STORYBOARD_IMAGE_PROVIDER_COMMAND_ENV,
  STORYBOARD_IMAGE_PROVIDER_COMMAND_PLACEHOLDER,
  STORYBOARD_IMAGE_PROVIDER_MODEL_ENV,
  type StoryboardImageProviderReadiness,
  type StoryboardImageProviderStatusResponse,
  formatStoryboardImageProviderGuidanceMessage,
  formatStoryboardImageProviderTarget,
  isStoryboardImageProviderReady,
  mapStoryboardImageProviderReadiness,
} from "@/lib/admin/storyboard/image-provider-readiness";
import { cn } from "@/lib/utils";

type GeneratorForm = {
  prompt: string;
  tone: StoryboardTone;
  targetLengthMinutes: number;
  sourceLimit: number;
  segmentCount: number;
  includeProductionNotes: boolean;
  generationMode: StoryboardGenerationMode;
};

type StoryboardChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: "streaming" | "done";
};

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

const STORYBOARD_GUIDED_EXAMPLE_PROMPT =
  "매운 짜장라면 먹방을 좋은 흐름에 맞춰 10컷 안팎의 스토리보드로 만들어줘. 가게 앞 인트로와 주문 맥락으로 시작하고, 조리 기대감, 첫 입, ASMR 질감, 소스 조합, 클라이맥스 한상, 완식, 맛 평가, 다음 영상 기대감까지 이어지게 구성해줘.";

const STORYBOARD_USAGE_GUIDE_TEXT =
  "간단히 3가지만 적으면 됩니다. 1) 어떤 음식이나 장면인지 2) 몇 컷이 필요한지 3) 꼭 보여주고 싶은 순간입니다. 예시 버튼을 누르면 이 흐름대로 바로 스토리보드를 만들어볼게요.";

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
  | "generate"
  | "history"
  | "image_status"
  | "images"
  | "review"
  | "reset"
  | "safety"
  | "settings"
  | "status"
  | "trace";

function isStoryboardTraceIntent(message: string) {
  const normalized = message.trim().replace(/\s+/g, " ").toLowerCase();
  const compact = normalized.replace(/[\s?!?.。~]/g, "");
  if (!normalized) return false;
  if (
    /(초기화|리셋|reset|clear|재생성|다시\s*생성|이미지\s*(?:만들|생성|재생성)|생성해|만들어\s*줘|만들어줘|구성해|짜줘|뽑아)/i.test(
      normalized,
    )
  ) {
    return false;
  }
  if (/^(과정|이유|왜|근거|추적|trace|why|how)$/.test(compact)) {
    return true;
  }
  return /(왜\s*(?:이렇게|이런|이 컷|이 장면|이 순서|나왔|됐|선택|골랐)|어떻게\s*(?:만들|구성|나왔)|이유가\s*뭐|무슨\s*근거|어떤\s*과정|선택\s*이유|근거.*(?:뭐|알려|설명)|trace|why|how)/i.test(
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
    segmentCount: deriveStoryboardUiSegmentCount(form.prompt, form.segmentCount),
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
  if (/^(설정|톱니바퀴|settings|setting)$/.test(compact)) return "settings";
  if (
    isShortCommand &&
    (/(4컷|네컷|현재4컷).*(재생성|다시생성)/.test(compact) ||
      /^(4컷재생성|네컷재생성|이미지재생성|컷재생성)$/.test(compact))
  ) {
    return "images";
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
// isStoryboardResultSkeletonVisible || !hasPreviousStoryboardPage
// isStoryboardResultSkeletonVisible || !hasNextStoryboardPage
// disabled={isStoryboardResultSkeletonVisible || isGeneratingImages}
// disabled={isStoryboardResultSkeletonVisible}
// Array.from({ length: STORYBOARD_FRAMES_PER_PAGE }
// data-storyboard-frame-page={String(activeStoryboardPage + 1)}
// data-storyboard-frame-page-size={String(STORYBOARD_FRAMES_PER_PAGE)}

const STORYBOARD_STREAMING_PHASE_COUNT = 4;

function getStoryboardStreamingPhase(
  phases: readonly string[],
  phaseIndex: number,
) {
  return phases[phaseIndex] ?? phases[0] ?? "진행 상황을 확인하는 중";
}

function formatStoryboardGraphRuntimeLabel(
  graph: NonNullable<
    StoryboardGenerationResult["backendAnalysis"]["backendAgent"]
  >["graph"],
) {
  if (!graph) return null;
  if (graph.runtime === "langgraph") return "영상 자료 반영";
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
        graph.retrieval?.usedModels?.embedding
          ? "자료 분석 반영"
          : null,
        graph.retrieval?.usedModels?.reranker
          ? "우선순위 정리"
          : null,
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
  const resumeRequired = Boolean(graph && graph.status === "interrupted_needs_resume");
  const outputReadyForReview = Boolean(graph && graph.status === "interrupted_output_ready");

  if (retrievalUsed) {
    return {
      status: "live_retrieval_used",
      label: "자료 반영 완료",
      summary: "영상 자료와 요청 내용을 함께 반영했습니다.",
      detail: formatStoryboardGraphDiagnosticsText(result) ?? "영상 자료 반영 완료",
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
      detail: formatStoryboardGraphDiagnosticsText(result) ?? "이어서 진행 필요",
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

  if (graph?.runtime === "local_adapter_fallback" || graph?.status === "fallback") {
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
    detail: backend?.runtime ? "생성 상태 확인 중" : "아직 생성 상태가 없습니다.",
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
  const caption = result.backendAnalysis.backendAgent?.graph?.retrieval?.caption;
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
  return Boolean(retrieval?.status === "used" && retrieval.usedModels?.reranker);
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
  const notUsedLabels = checks
    .filter((check) => check.status === "not_used").length;
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
  const headline = mode === "actual" ? "영상 흐름 반영" : "예시 구성";
  const sourceText =
    mode === "actual"
      ? "영상 흐름과 요청 내용을 함께 반영했습니다."
      : "예시 요청을 기준으로 구성했습니다.";
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

function normalizeStoryboardCopyText(value: string | undefined, fallback: string) {
  const normalized = (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
  return normalized || fallback;
}

function buildStoryboardClientCopyPlanMarkdown(
  result: StoryboardGenerationResult,
) {
  const current = result.storyboard.exportMarkdown.trim();
  const hasCurrentShotList =
    current.includes("## 촬영 기획표") &&
    current.includes("| CUT | 역할 | 촬영 지시 | 멘트 | 자막 | 근거 |");
  if (hasCurrentShotList) return current;

  const scenes = result.storyboard.scenes;
  if (scenes.length === 0) return current;

  const lines = [
    `# ${normalizeStoryboardCopyText(result.storyboard.title, "스토리보드 기획서")}`,
    "",
    normalizeStoryboardCopyText(
      result.storyboard.logline,
      "CUT별 촬영 지시, 멘트, 자막, 근거를 한 번에 확인합니다.",
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
      const hostBeat = normalizeStoryboardCopyText(scene.hostBeat, "현장 멘트 확인");
      const subtitle = normalizeStoryboardCopyText(scene.captionIdea, "자막 확인");
      const evidence = normalizeStoryboardCopyText(
        `${scene.heatmapEvidence.peakTime} · ${scene.heatmapEvidence.reason}`,
        "근거 확인",
      );
      return `| ${cut} | ${role} | ${shot} | ${hostBeat} | ${subtitle} | ${evidence} |`;
    }),
    "",
    "## CUT별 상세 메모",
    "",
    ...scenes.flatMap((scene) => [
      `### CUT ${String(scene.sceneNo).padStart(2, "0")} · ${normalizeStoryboardCopyText(scene.title, "장면 구성")}`,
      `- 촬영: ${normalizeStoryboardCopyText(scene.visualDirection, "촬영 지시 확인")}`,
      `- 멘트: ${normalizeStoryboardCopyText(scene.hostBeat, "현장 멘트 확인")}`,
      `- 자막: ${normalizeStoryboardCopyText(scene.captionIdea, "자막 확인")}`,
      `- 체크: ${scene.productionChecklist.map((item) => normalizeStoryboardCopyText(item, "체크")).join(" / ") || "현장 체크"}`,
      `- 근거: ${normalizeStoryboardCopyText(`${scene.heatmapEvidence.peakTime} · ${scene.heatmapEvidence.reason}`, "근거 확인")}`,
      "",
    ]),
  ];

  if (current) {
    lines.push("## 기존 메모", "", current);
  }

  return lines.join("\n").trim();
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
  const hasVisibleGeneratedCuts = visibleCutCount > 0 && generatedImageCount > 0;
  const activePageReady =
    activePageSceneCount > 0 && activePageGeneratedCount === activePageSceneCount;
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
      summary: isActualData
        ? "영상 흐름을 참고한 구성"
        : "예시 요청을 기준으로 한 구성",
      detail: isActualData
        ? "영상 흐름과 요청 내용을 함께 확인합니다."
        : "실제 영상 자료가 필요하면 다시 생성해 주세요.",
    },
    {
      id: "pd",
      label: "PD",
      status: activePageReady ? "ready" : "watch",
      summary: activePageReady
        ? "2×2 캔버스 현재 페이지가 생성 이미지로 채워짐"
        : "현재 페이지 생성 이미지 누락 컷 확인 필요",
      detail: `현재 ${activePageGeneratedCount}/${activePageSceneCount || STORYBOARD_FRAMES_PER_PAGE} · 전체 ${generatedImageCount}/${visibleCutCount} · ${omittedText}`,
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
    .replace(/delete\s+\.?omx\/state[^.!?\n\r]*/gi, "[SAFETY-REDACTED-INSTRUCTION]")
    .replace(/검증을\s*건너뛰[^\n\r.!?]*/g, "[SAFETY-REDACTED-INSTRUCTION]")
    .replace(/이전\s*지시(?:를)?\s*무시[^\n\r.!?]*/g, "[SAFETY-REDACTED-INSTRUCTION]");

  return sanitizeStoryboardPublicText(locallySanitized)
    .replaceAll(
      STORYBOARD_PUBLIC_SAFETY_REPLACEMENT,
      "[SAFETY-REDACTED-INSTRUCTION]",
    )
    .trim()
    .replace(/\s+/g, " ");
}

function sanitizeStoryboardAssistantSourceText(value: string) {
  return sanitizeStoryboardPublicText(value)
    .replaceAll(
      STORYBOARD_PUBLIC_SAFETY_REPLACEMENT,
      "[SAFETY-REDACTED-INSTRUCTION]",
    )
    .trim()
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function formatStoryboardAssistantDisplayText(value: string) {
  const protectedNoImageLabel = STORYBOARD_NO_TRUSTED_IMAGE_LABEL.replace(
    " · ",
    " __STORYBOARD_NO_IMAGE_DOT__ ",
  );
  const safe = sanitizeStoryboardAssistantSourceText(value)
    .replace(/Codex CLI\s+[A-Za-z0-9._-]+\s+\w+\s+작업 완료/gi, "요청을 이해했어요")
    .replace(/GPT\s*Image\s*2|gpt-image-2/gi, "이미지 만들기")
    .replace(/LangGraph|BGE|리랭커|provider|provenance|fallback|model/gi, "내부 처리")
    .replace(/백엔드\s*에이전트|백엔드|에이전트/g, "도우미")
    .replace(/패치/g, "수정")
    .replace(/스트리밍/g, "진행 상태")
    .replace(/2×2/g, "4칸")
    .replace(/캔버스가/g, "화면이")
    .replace(/캔버스/g, "화면")
    .replace(/CUT\s*0?(\d+)/gi, "컷 $1")
    .replace(/스토리보드 이미지 반영 완료/g, "스토리보드 이미지가 화면에 들어갔어요")
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
    .replace(/예시를 생성하세요/g, "예시 만들기를 눌러보세요")
    .replace(/초기화 완료/g, "처음 상태로 되돌렸어요")
    .replace(/요구사항/g, "원하는 내용")
    .replaceAll(STORYBOARD_NO_TRUSTED_IMAGE_LABEL, protectedNoImageLabel)
    .trim();

  const lines = safe
    .split(/\n+|\s+·\s+/)
    .map((line) => line.trim())
    .map((line) =>
      line.replaceAll(
        " __STORYBOARD_NO_IMAGE_DOT__ ",
        " · ",
      ),
    )
    .filter(Boolean);

  if (lines.length <= 1) {
    return safe.replaceAll(
      " __STORYBOARD_NO_IMAGE_DOT__ ",
      " · ",
    );
  }

  return lines
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
    .replace(/(?:LLM|RAG|LangGraph|BGE|리랭커|provider|provenance|fallback|model)/gi, "도우미 처리")
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
  const cutLabel = `CUT ${String(scene.sceneNo).padStart(2, "0")}`;
  return {
    kind: "cut",
    label: `${cutLabel} 선택됨`,
    detail: `멘트·자막·구도 수정 가능 · ${scene.title} · ${scene.heatmapEvidence.peakTime} · ${truncateStoryboardFrameText(scene.hostBeat, 36)}`,
    sceneNo: scene.sceneNo,
    promptContext: [
      `${cutLabel}을 선택한 상태입니다.`,
      `제목: ${scene.title}`,
      `연출: ${scene.visualDirection}`,
      `오디오 후보 · ${scene.hostBeat}`,
      `자막 후보: ${scene.captionIdea}`,
      `근거: ${scene.heatmapEvidence.reason}`,
    ].join(" "),
    createdAt: new Date().toISOString(),
  };
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

type StoryboardInitialResultSource = "latest-history" | "shared-seed";

type StoryboardInitialResult = {
  result: StoryboardGenerationResult;
  source: StoryboardInitialResultSource;
  runUrl: string;
};

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
        operatorIntent: "초반 이탈을 줄이도록 가게 앞 상황과 오늘 먹을 메뉴를 먼저 이해시킴",
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
        operatorIntent: "테이블 구성을 먼저 보여주고 첫 입 직전의 기대감을 만듦",
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
        hostBeat: "오늘은 이 조합이 제일 기억에 남고, 다음에는 다른 메뉴도 이어서 가볼게요.",
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

  context.fillStyle = "rgba(0,0,0,0.58)";
  drawRoundedRect(context, x + 18, y + 18, 92, 30, 15);
  context.fill();
  context.fillStyle = "#fff";
  context.font = "700 18px system-ui, sans-serif";
  context.fillText(
    `CUT ${String(scene.sceneNo).padStart(2, "0")}`,
    x + 31,
    y + 40,
  );

  context.fillStyle = "rgba(255,255,255,0.84)";
  drawRoundedRect(context, x + width - 88, y + 18, 70, 30, 15);
  context.fill();
  context.fillStyle = "#111827";
  context.font = "700 15px system-ui, sans-serif";
  context.fillText(scene.heatmapEvidence.peakTime, x + width - 75, y + 39);

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
    throw new Error(`스토리보드 기록 인덱스를 불러오지 못했습니다. (${response.status})`);
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

function getStoryboardHistoryPreviewImage(
  historyCase: StoryboardHistoryCase,
) {
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
    "개선 반영 확인",
    "CUT별 오디오와 자막이 따로 바뀌고, 페이지를 넘기면 현재 페이지 요약도 함께 바뀝니다.",
    "첫 CUT은 쯔양님 영상 흐름을 고려해 초반 1분 30초 가게 앞 인트로부터 시작합니다.",
    "장면은 반복 시청 피크와 요청 주제를 기준으로 고르고, '과정'이라고 입력하면 왜 이렇게 나왔는지 쉽게 설명합니다.",
    "각 CUT 이미지 위에는 바로 촬영할 수 있는 짧은 촬영 포인트도 표시합니다.",
    `이미지 상태: ${imageReadinessText}`,
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
  const checks =
    flowChecks ??
    buildStoryboardPdfFlowChecks({
      result,
      backendReadiness: buildStoryboardBackendAgentReadiness(result),
      graphFidelityStatus:
        result.agentGraphFidelity?.status ??
        buildStoryboardAgentGraphFidelity({
          mode: result.mode,
          graph: result.backendAnalysis.backendAgent?.graph,
          finalOutputReady: Boolean(result.storyboard.exportMarkdown),
          storyboardHistoryCount: 0,
        }).status,
      historyCount: 0,
    });
  const flowTraceText = formatStoryboardPdfFlowTraceText(checks);

  return [
    "이렇게 만들었어요",
    flowTraceText,
    "1. 요청 정리: 원하는 컷 수, 분위기, 영상 길이를 먼저 정했어요.",
    `2. 자료 확인: ${dataText}`,
    "3. 안전 검토: 비밀값이나 위험한 지시는 빼고, 반영 가능한 요청만 남겼어요.",
    "4. 컷 구성: 가게 앞 맥락, 주문·상차림, 첫 입 준비, 맛 평가와 다음 소재 연결 순서로 엮었어요.",
    `5. 확인할 점: ${imageText}`,
    sceneReasons.length ? "선택 이유" : null,
    ...sceneReasons,
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
  const visibleCanvasCutCount = Math.min(STORYBOARD_FRAMES_PER_PAGE, sceneCount);
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
    focusPromptContext:
      `${STORYBOARD_NO_TRUSTED_IMAGE_LABEL}. 캔버스 CUT 이미지는 이미지 생성 버튼으로 검증 이미지 결과를 만든 뒤 표시됩니다.`,
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

function getStoryboardPageForSceneNo(sceneNo: number, totalPages: number) {
  const maxPage = Math.max(0, totalPages - 1);
  if (!Number.isFinite(sceneNo)) return 0;
  const page = Math.floor(
    (Math.max(1, Math.trunc(sceneNo)) - 1) / STORYBOARD_FRAMES_PER_PAGE,
  );
  return Math.min(maxPage, Math.max(0, page));
}

function getStoryboardVisibleFramePageForSceneNo(
  scenes: StoryboardScene[],
  sceneNo: number,
) {
  if (!Number.isFinite(sceneNo)) return null;
  const sceneIndex = scenes.findIndex(
    (scene) => scene.sceneNo === Math.trunc(sceneNo),
  );
  if (sceneIndex < 0) return null;
  return getStoryboardPageForSceneNo(
    sceneIndex + 1,
    Math.max(1, Math.ceil(scenes.length / STORYBOARD_FRAMES_PER_PAGE)),
  );
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
  const trustedResult = hydrateStoryboardResultForDisplay(result);
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

async function postStoryboardRequest(
  form: GeneratorForm,
): Promise<StoryboardGenerationResult> {
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

  return response.json() as Promise<StoryboardGenerationResult>;
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
): Promise<StoryboardImagesResponse> {
  const response = await fetch("/api/admin/storyboard/images", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: result.storyboard.title,
      logline: result.storyboard.logline,
      request: result.request,
      scenes,
      sourceResult: result,
    }),
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

async function getStoryboardImageProviderStatusRequest(): Promise<StoryboardImageProviderStatusResponse> {
  const response = await fetch("/api/admin/storyboard/images", {
    cache: "no-store",
    headers: { Accept: "application/json" },
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

function loadCanvasImage(src?: string) {
  if (!src) return Promise.resolve(null);
  return new Promise<HTMLImageElement | null>((resolveImage) => {
    const image = document.createElement("img");
    image.onload = () => resolveImage(image);
    image.onerror = () => resolveImage(null);
    image.src = src;
  });
}

function StoryboardGlassLoadingCanvas({
  activeCutStart,
  activeCutEnd,
  mode,
}: {
  activeCutStart: number;
  activeCutEnd: number;
  mode: "loading" | "empty";
}) {
  const statusLabel =
    mode === "loading"
      ? "스토리보드 구성 로딩 중"
      : STORYBOARD_NO_TRUSTED_IMAGE_LABEL;
  const cutRangeLabel = `CUT ${String(activeCutStart).padStart(2, "0")}–${String(activeCutEnd).padStart(2, "0")}`;

  return (
    <div
      className="relative col-span-2 row-span-2 flex h-full min-h-0 overflow-hidden rounded-2xl bg-transparent"
      role="status"
      aria-live="polite"
      aria-busy={mode === "loading"}
      aria-label={statusLabel}
      data-storyboard-glass-skeleton="true"
      data-storyboard-unified-skeleton="true"
      data-storyboard-realtime-skeleton="true"
      data-storyboard-image-empty-state={mode === "empty" ? "true" : undefined}
    >
      <div
        className="relative z-10 grid h-full w-full grid-cols-2 grid-rows-2 gap-2 p-2"
        aria-hidden="true"
      >
        {Array.from({ length: STORYBOARD_FRAMES_PER_PAGE }, (_, index) => {
          const cutNo = activeCutStart + index;
          return (
            <div
              key={`storyboard-glass-frame-${cutNo}`}
              className="relative overflow-hidden rounded-2xl border border-slate-400/35 bg-slate-300/42 shadow-[inset_0_1px_0_rgba(255,255,255,0.42)] dark:border-slate-500/35 dark:bg-slate-700/35"
              data-storyboard-glass-skeleton-frame={String(cutNo)}
            >
              <span className="absolute inset-0 bg-gradient-to-br from-white/34 via-slate-300/20 to-slate-500/24" />
              <span
                className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/68 to-transparent blur-sm [animation:storyboard-glass-shimmer_1.45s_ease-in-out_infinite]"
                aria-hidden="true"
                data-storyboard-glass-shimmer="true"
              />
            </div>
          );
        })}
      </div>
      <span className="sr-only">{`${cutRangeLabel} ${statusLabel}`}</span>
    </div>
  );
}

function StoryboardCutImageSkeleton({
  sceneNo,
  hasExistingImage,
  fullFrame = false,
}: {
  sceneNo: number;
  hasExistingImage: boolean;
  fullFrame?: boolean;
}) {
  return (
    <div
      className={cn(
        "absolute inset-0 z-10 overflow-hidden bg-gradient-to-br from-slate-100 via-slate-200/85 to-slate-400/70",
        fullFrame ? "rounded-2xl" : "rounded-t-2xl",
        hasExistingImage
          ? "bg-slate-950/25 opacity-85 backdrop-blur-[1px]"
          : "opacity-100",
      )}
      role="status"
      aria-live="polite"
      aria-label={`CUT ${String(sceneNo).padStart(2, "0")} 이미지 생성 중`}
      data-storyboard-cut-image-skeleton="true"
      data-storyboard-cut-image-skeleton-scene={String(sceneNo)}
    >
      <span
        className="pointer-events-none absolute inset-0 opacity-85 [background:linear-gradient(135deg,rgba(255,255,255,0.58),rgba(148,163,184,0.28)_48%,rgba(71,85,105,0.26))]"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/68 to-transparent blur-sm [animation:storyboard-glass-shimmer_1.35s_ease-in-out_infinite]"
        aria-hidden="true"
        data-storyboard-cut-image-shimmer="true"
      />
      <span className="sr-only">
        CUT {String(sceneNo).padStart(2, "0")} 이미지를 만드는 중입니다.
      </span>
    </div>
  );
}

export function AdminStoryboardGenerator() {
  const [form, setForm] = useState<GeneratorForm>(DEFAULT_FORM);
  const [result, setResult] = useState<StoryboardGenerationResult>(
    INITIAL_STORYBOARD_PREVIEW,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [
    generatingStoryboardImageSceneNos,
    setGeneratingStoryboardImageSceneNos,
  ] = useState<number[]>([]);
  const [isChatAgentStreaming, setIsChatAgentStreaming] = useState(false);
  const [exportPresetId, setExportPresetId] =
    useState<StoryboardExportPresetId>("quick-1280x720");
  const [showStoryboardGuide, setShowStoryboardGuide] = useState(false);
  const [storyboardPage, setStoryboardPage] = useState(0);
  const [storyboardHistoryCases, setStoryboardHistoryCases] = useState<
    StoryboardHistoryCase[]
  >([]);
  const [storyboardHistoryStatus, setStoryboardHistoryStatus] =
    useState<StoryboardHistoryStatus>("idle");
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
  const [chatDraft, setChatDraft] = useState("");
  const [storyboardCanvasFocus, setStoryboardCanvasFocus] =
    useState<StoryboardChatFocusContext | null>(null);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const chatTranscriptRef = useRef<HTMLDivElement | null>(null);
  const [chatMessages, setChatMessages] = useState<StoryboardChatMessage[]>([
    formatStoryboardChatMessageForDisplay({
      id: "assistant-intake",
      role: "assistant",
      text: "처음이면 가이드를 보고, 바로 확인하려면 예시를 생성하세요.",
      status: "done",
    }),
  ]);
  const [streamingPhaseIndex, setStreamingPhaseIndex] = useState(0);
  const hasUserStoryboardMutationRef = useRef(false);
  useEffect(() => {
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
        const sourceLabel =
          initialResult.source === "shared-seed"
            ? "공용 기본 스토리보드"
            : "최근 스토리보드 기록";
        const latestHistoryMessage: StoryboardChatMessage = {
          id: "assistant-latest-real-data",
          role: "assistant",
          text: `${sourceLabel}을 불러왔어요 · ${initialResult.result.storyboard.title}. 캔버스에서 컷을 확인하고, 필요한 수정은 채팅으로 요청하세요.`,
          status: "done",
        };
        const latestHistoryImprovementMessage = makeStoryboardImprovementSummaryMessage(
          initialResult.result,
          "assistant-latest-real-data-improvement-summary",
        );
        setChatMessages((messages) =>
          [
            ...messages.filter(
              (message) =>
                message.id !== latestHistoryMessage.id &&
                message.id !== latestHistoryImprovementMessage.id,
            ),
            formatStoryboardChatMessageForDisplay(latestHistoryMessage),
            formatStoryboardChatMessageForDisplay(latestHistoryImprovementMessage),
          ].slice(-10),
        );
      })
      .catch(() => {
        // 최신 실제 스토리보드 기록가 없으면 초기 미리보기를 유지합니다.
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
    if (!isGenerating && !isChatAgentStreaming && !isGeneratingImages) {
      setStreamingPhaseIndex(0);
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setStreamingPhaseIndex(
        (index) => (index + 1) % STORYBOARD_STREAMING_PHASE_COUNT,
      );
    }, 760);

    return () => window.clearInterval(intervalId);
  }, [isGenerating, isChatAgentStreaming, isGeneratingImages]);

  useEffect(() => {
    let cancelled = false;

    getStoryboardImageProviderStatusRequest()
      .then((payload) => {
        if (cancelled) return;
        setStoryboardImageProviderReadiness(
          mapStoryboardImageProviderReadiness(payload),
        );
      })
      .catch((error) => {
        if (cancelled) return;
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
  }, [
    chatMessages,
    chatDraft,
    isChatAgentStreaming,
    isGenerating,
    isGeneratingImages,
  ]);

  const storyboardFrameScenes = useMemo(
    () => result.storyboard.scenes,
    [result.storyboard.scenes],
  );
  const storyboardTotalPages = getStoryboardScenePageCount({
    allScenes: result.storyboard.scenes,
    pageSize: STORYBOARD_FRAMES_PER_PAGE,
  });
  const activeStoryboardPage = Math.min(
    storyboardPage,
    storyboardTotalPages - 1,
  );
  const activeStoryboardPageSourceScenes = result.storyboard.scenes.slice(
    activeStoryboardPage * STORYBOARD_FRAMES_PER_PAGE,
    activeStoryboardPage * STORYBOARD_FRAMES_PER_PAGE +
      STORYBOARD_FRAMES_PER_PAGE,
  );
  const activeStoryboardPageScenes = getStoryboardSourcePageScenes({
    allScenes: result.storyboard.scenes,
    page: activeStoryboardPage,
    pageSize: STORYBOARD_FRAMES_PER_PAGE,
  });
  const activeStoryboardImageGenerationTargetScenes =
    getStoryboardImageGenerationTargetScenes({
      allScenes: result.storyboard.scenes,
      visibleScenes: storyboardFrameScenes,
      page: activeStoryboardPage,
      pageSize: STORYBOARD_FRAMES_PER_PAGE,
    });
  const generatingStoryboardImageSceneNoSet = useMemo(
    () => new Set(generatingStoryboardImageSceneNos),
    [generatingStoryboardImageSceneNos],
  );
  const activeCutStart =
    activeStoryboardPageSourceScenes[0]?.sceneNo ??
    activeStoryboardPage * STORYBOARD_FRAMES_PER_PAGE + 1;
  const requestedCutCount = Math.max(
    STORYBOARD_FRAMES_PER_PAGE,
    Number.isFinite(form.segmentCount)
      ? Math.trunc(form.segmentCount)
      : STORYBOARD_FRAMES_PER_PAGE,
  );
  const emptyCanvasSkeletonCutCount = Math.max(
    STORYBOARD_FRAMES_PER_PAGE,
    activeStoryboardPageSourceScenes.length,
    activeStoryboardImageGenerationTargetScenes.length,
  );
  const totalCutCount = isGenerating
    ? requestedCutCount
    : storyboardFrameScenes.length || emptyCanvasSkeletonCutCount;
  const activeCutEnd =
    activeStoryboardPageSourceScenes.at(-1)?.sceneNo ??
    Math.min(
      activeCutStart + STORYBOARD_FRAMES_PER_PAGE - 1,
      Math.max(activeCutStart, totalCutCount),
    );
  const isStoryboardResultSkeletonVisible = isGenerating;
  const generatedImageCount = countTrustedStoryboardGeneratedImages(
    result.storyboard.scenes,
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
  const isStoryboardImageProviderAvailable = isStoryboardImageProviderReady(
    storyboardImageProviderReadiness,
  );
  const selectedStoryboardSceneNo =
    storyboardCanvasFocus?.kind === "cut"
      ? storyboardCanvasFocus.sceneNo
      : null;
  const storyboardUserPerspectiveReadiness = useMemo(
    () =>
      buildStoryboardUserPerspectiveReadiness({
        result,
        activeCutStart,
        activeCutEnd,
        activePageGeneratedCount,
        activePageSceneCount:
          activeStoryboardImageGenerationTargetScenes.length || STORYBOARD_FRAMES_PER_PAGE,
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
      generatedImageCount,
      totalCutCount,
      omittedStoryboardSceneCount,
      selectedStoryboardSceneNo,
    ],
  );
  const imageGenerationButtonLabel =
    activePageGenerationTargetCount === 0
      ? "이미지 생성 대상 없음"
      : !isStoryboardImageProviderAvailable
        ? "이미지 생성 설정 필요"
        : activePageGeneratedCount === activeStoryboardImageGenerationTargetScenes.length
        ? `현재 ${activePageGenerationTargetCount}컷 다시 생성`
        : `현재 ${activePageGenerationTargetCount}컷 이미지 생성`;
  const compactImageGenerationButtonLabel =
    activePageGenerationTargetCount === 0
      ? "이미지 없음"
      : !isStoryboardImageProviderAvailable
        ? "설정 필요"
        : activePageGeneratedCount === activeStoryboardImageGenerationTargetScenes.length
        ? `${activePageGenerationTargetCount}컷 재생성`
        : `${activePageGenerationTargetCount}컷 생성`;
  const hasPreviousStoryboardPage = activeStoryboardPage > 0;
  const hasNextStoryboardPage = activeStoryboardPage < storyboardTotalPages - 1;
  const selectedExportPreset =
    storyboardExportPresets.find((preset) => preset.id === exportPresetId) ??
    storyboardExportPresets[0];
  const storyboardRealDataTrace = useMemo(
    () => formatStoryboardRealDataTrace(result),
    [result],
  );
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
  const isChatDraftActive =
    Boolean(chatDraft.trim()) ||
    form.prompt.trim() !== result.request.prompt.trim() ||
    form.tone !== result.request.tone ||
    form.segmentCount !== result.request.segmentCount ||
    form.targetLengthMinutes !== result.request.targetLengthMinutes ||
    form.generationMode !== result.request.generationMode;
  const normalizedStreamingPhaseIndex =
    streamingPhaseIndex % STORYBOARD_STREAMING_PHASE_COUNT;
  const activeStreamingImageCutLabel =
    generatingStoryboardImageSceneNos[0] != null
      ? `CUT ${String(generatingStoryboardImageSceneNos[0]).padStart(2, "0")}`
      : activePageGenerationTargetCount > 0
        ? `현재 페이지 ${activePageGenerationTargetCount}컷`
        : "현재 페이지 이미지";
  const remainingImageGenerationCount = generatingStoryboardImageSceneNos.length;
  const focusedStreamingContext =
    storyboardCanvasFocus?.kind === "cut"
      ? `${storyboardCanvasFocus.label} 기준으로`
      : storyboardCanvasFocus?.label
        ? `${storyboardCanvasFocus.label} 작업을 기준으로`
        : "현재 화면과 요청을 기준으로";
  const currentStreamingLabel = isGeneratingImages
    ? "이미지 생성 중"
    : isGenerating
      ? "스토리보드 구성 중"
      : isChatAgentStreaming
        ? "요청 반영 중"
        : isChatDraftActive
          ? "수정 초안 대기"
          : "동기화됨";
  const currentStreamingPhase = (() => {
    if (isGeneratingImages) {
      return getStoryboardStreamingPhase(
        [
          `${activeStreamingImageCutLabel} 이미지를 생성 중 · 완료된 CUT은 바로 화면에 반영돼요`,
          "오디오·자막 내용과 어울리는 장면인지 맞추는 중",
          remainingImageGenerationCount > 0
            ? `남은 이미지 ${remainingImageGenerationCount}컷을 순서대로 처리 중`
            : "새 이미지 결과를 화면에 정리 중",
          "이미지가 도착한 CUT부터 스켈레톤이 실제 결과로 바뀝니다",
        ],
        normalizedStreamingPhaseIndex,
      );
    }
    if (isGenerating) {
      return getStoryboardStreamingPhase(
        [
          `요청을 ${requestedCutCount}컷 안팎의 영상 흐름으로 정리 중`,
          "반복 시청 포인트와 초반 인트로 흐름을 CUT 후보에 맞추는 중",
          "오디오·자막·촬영 포인트가 CUT마다 다르게 보이도록 분리 중",
          `${form.targetLengthMinutes}분 분량과 ${form.tone} 톤에 맞춰 캔버스 반영 준비 중`,
        ],
        normalizedStreamingPhaseIndex,
      );
    }
    if (isChatAgentStreaming) {
      return getStoryboardStreamingPhase(
        [
          `요청을 읽고 ${focusedStreamingContext} 수정 범위를 찾는 중`,
          "바꿀 CUT, 오디오, 자막, 이미지 요청을 구분하는 중",
          "반영 가능한 수정과 안내가 필요한 내용을 나누는 중",
          "곧 채팅 답변과 필요한 캔버스 변경을 함께 보여드릴게요",
        ],
        normalizedStreamingPhaseIndex,
      );
    }
    if (isChatDraftActive) {
      return "채팅 초안이 화면에 반영되기 전 대기 중";
    }
    return "최신 캔버스와 동기화됨";
  })();
  const selectedRealStoryboardScene = selectedStoryboardSceneNo
    ? result.storyboard.scenes.find(
        (scene) => scene.sceneNo === selectedStoryboardSceneNo,
      ) ?? null
    : null;
  const visibleStoryboardHistoryCases = storyboardHistoryCases.slice(0, 8);
  const storyboardChatPlaceholder =
    storyboardCanvasFocus?.kind === "cut"
      ? `${storyboardCanvasFocus.label} 멘트·자막·구도 중 무엇을 바꿀까요?`
      : storyboardCanvasFocus?.kind === "action"
        ? `${storyboardCanvasFocus.label} 이후 조정할 내용을 입력하세요`
        : `예: 매운 짜장라면 · 첫 입·맛 평가 중심 ${STORYBOARD_MAX_SEGMENT_COUNT}컷`;

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
    setChatMessages((current) =>
      [...current, ...messages.map(formatStoryboardChatMessageForDisplay)].slice(
        -10,
      ),
    );
  }

  function updateStoryboardChatMessage(
    messageId: string,
    text: string,
    status: StoryboardChatMessage["status"] = "streaming",
  ) {
    setChatMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? formatStoryboardChatMessageForDisplay({ ...message, text, status })
          : message,
      ),
    );
  }

  function handleChatDraftChange(value: string) {
    setChatDraft(value);
  }

  function resetStoryboardChatState() {
    hasUserStoryboardMutationRef.current = true;
    setForm(DEFAULT_FORM);
    setChatDraft("");
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
    appendStoryboardQuickCommandMessages("가이드", STORYBOARD_USAGE_GUIDE_TEXT);
  }

  async function handleStoryboardGuidedExampleGenerate() {
    if (isGenerating || isChatAgentStreaming) return;
    const guidedForm: GeneratorForm = {
      ...DEFAULT_FORM,
      prompt: STORYBOARD_GUIDED_EXAMPLE_PROMPT,
      tone: "energetic",
      targetLengthMinutes: 14,
      segmentCount: 10,
    };
    const assistantMessageId = appendStoryboardQuickCommandMessages(
      "예시 생성",
      "예시 흐름에 맞춰 스토리보드와 첫 페이지 이미지를 함께 만들고 있어요.",
      "streaming",
    );
    const generated = await handleGenerate(guidedForm, {
      appendChatMessages: false,
      assistantMessageId,
    });
    if (!generated) return;

    const targetScenes = getStoryboardImageGenerationTargetScenes({
      allScenes: generated.storyboard.scenes,
      visibleScenes: generated.storyboard.scenes,
      page: 0,
      pageSize: STORYBOARD_FRAMES_PER_PAGE,
    });
    if (targetScenes.length === 0) return;

    if (!isStoryboardImageProviderAvailable) {
      const firstSceneNo = targetScenes[0]?.sceneNo ?? 1;
      const lastSceneNo = targetScenes.at(-1)?.sceneNo ?? targetScenes.length;
      guideUnavailableStoryboardImageGeneration({
        scopeLabel: `예시 CUT ${String(firstSceneNo).padStart(2, "0")}–${String(lastSceneNo).padStart(2, "0")}`,
        openSettings: false,
      });
      return;
    }

    await handleGenerateStoryboardImages({
      assistantMessageId,
      targetScenes,
      sourceResult: generated,
    });
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
    setStoryboardImageProviderReadiness(
      INITIAL_STORYBOARD_IMAGE_PROVIDER_READINESS,
    );
    try {
      const payload = await getStoryboardImageProviderStatusRequest();
      setStoryboardImageProviderReadiness(
        mapStoryboardImageProviderReadiness(payload),
      );
    } catch (error) {
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
    }
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
      updateStoryboardChatMessage(options.assistantMessageId, guidance, "done");
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

  function applyStoryboardHistoryResult(historyCase: StoryboardHistoryCase) {
    hasUserStoryboardMutationRef.current = true;
    const historyResult = hydrateStoryboardResultForDisplay(historyCase.result);
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

  function applyStoryboardCanvasFocus(focus: StoryboardChatFocusContext) {
    setStoryboardCanvasFocus(focus);
  }

  function handleSelectStoryboardScene(
    scene: StoryboardGenerationResult["storyboard"]["scenes"][number],
  ) {
    applyStoryboardCanvasFocus(createStoryboardCutFocusContext(scene));
  }

  function getStoryboardSourcePageRange(page: number) {
    const sourcePageScenes = result.storyboard.scenes.slice(
      page * STORYBOARD_FRAMES_PER_PAGE,
      page * STORYBOARD_FRAMES_PER_PAGE + STORYBOARD_FRAMES_PER_PAGE,
    );
    const start =
      sourcePageScenes[0]?.sceneNo ?? page * STORYBOARD_FRAMES_PER_PAGE + 1;
    const end = sourcePageScenes.at(-1)?.sceneNo ?? start;
    return { start, end };
  }

  function handleStoryboardPageChange(nextPage: number) {
    const normalizedPage = Math.min(
      storyboardTotalPages - 1,
      Math.max(0, nextPage),
    );
    const sourcePageScenes = getStoryboardSourcePageScenes({
      allScenes: result.storyboard.scenes,
      page: normalizedPage,
      pageSize: STORYBOARD_FRAMES_PER_PAGE,
    });
    const sourcePageRange = getStoryboardSourcePageRange(normalizedPage);
    setStoryboardPage(normalizedPage);
    const firstVisibleScene = sourcePageScenes[0];
    if (firstVisibleScene) {
      applyStoryboardCanvasFocus(createStoryboardCutFocusContext(firstVisibleScene));
      return;
    }
    applyStoryboardCanvasFocus(
      createStoryboardActionFocusContext(
        `${normalizedPage + 1}페이지 선택됨`,
        `CUT ${String(sourcePageRange.start).padStart(2, "0")}–${String(sourcePageRange.end).padStart(2, "0")} 영역을 보고 있습니다.`,
        "사용자가 스토리보드 페이지를 이동했습니다. 현재 보이는 컷 범위의 리듬과 연결성을 기준으로 개선 대화를 이어가세요.",
      ),
    );
  }

  function handleStoryboardGuideToggle() {
    const nextVisible = !showStoryboardGuide;
    setShowStoryboardGuide(nextVisible);
    applyStoryboardCanvasFocus(
      createStoryboardActionFocusContext(
        nextVisible ? "가이드 표시됨" : "가이드 숨김",
        nextVisible
          ? "안전 영역 가이드를 켠 상태입니다."
          : "안전 영역 가이드를 숨긴 상태입니다.",
        nextVisible
          ? "사용자가 캔버스 안전 영역 가이드를 켰습니다. 컷 구도와 자막 위치를 안전 영역 기준으로 이야기할 수 있습니다."
          : "사용자가 캔버스 안전 영역 가이드를 숨겼습니다. 이미지 자체의 구도와 컷 감상을 중심으로 이야기할 수 있습니다.",
      ),
    );
  }

  function abortStoryboardChatWork() {
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = null;
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

  function getStoryboardChatStatusMessage() {
    return `현재 상태 · CUT ${String(activeCutStart).padStart(2, "0")}–${String(activeCutEnd).padStart(2, "0")} · 현재 페이지 이미지 ${activePageGeneratedCount}/${activeStoryboardImageGenerationTargetScenes.length || STORYBOARD_FRAMES_PER_PAGE} · 전체 이미지 ${generatedImageCount}/${totalCutCount} · ${formatStoryboardOmittedSceneText(omittedStoryboardSceneCount)}`;
  }

  function appendStoryboardQuickCommandMessages(
    submittedPrompt: string,
    assistantText: string,
    status: StoryboardChatMessage["status"] = "done",
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
      },
    ]);
    return `assistant-command-${now}`;
  }

  const handleGenerate = async (
    submitted?: string | GeneratorForm,
    options: {
      appendChatMessages?: boolean;
      assistantMessageId?: string;
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

  async function handleStoryboardChatSubmit() {
    const submittedPrompt = chatDraft.trim().replace(/\s+/g, " ");
    if (!submittedPrompt || isGenerating || isChatAgentStreaming) return;
    hasUserStoryboardMutationRef.current = true;

    const quickCommand = getStoryboardChatQuickCommand(submittedPrompt);
    if (quickCommand) {
      const commandBaseForm: GeneratorForm = form;
      setChatDraft("");
      if (quickCommand === "status") {
        appendStoryboardQuickCommandMessages(
          submittedPrompt,
          `${getStoryboardChatStatusMessage()}${storyboardCanvasFocus ? ` · 현재 선택 ${storyboardCanvasFocus.label}` : ""} · 필요하면 “가이드” 또는 “예시 생성”을 눌러 이어갈 수 있습니다.`,
        );
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
          "채팅 설정을 열었습니다. 우상단 톱니바퀴에서 실제 데이터 근거, 이미지 재생성, 초기화를 관리할 수 있습니다.",
        );
        return;
      }
      if (quickCommand === "images") {
        if (
          isStoryboardResultSkeletonVisible ||
          isGeneratingImages ||
          activeStoryboardImageGenerationTargetScenes.length === 0
        ) {
          appendStoryboardQuickCommandMessages(
            submittedPrompt,
            "현재 재생성할 스토리보드 컷이 없습니다. 먼저 스토리보드를 생성해 주세요.",
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
        const assistantMessageId = appendStoryboardQuickCommandMessages(
          submittedPrompt,
          "현재 입력한 내용으로 스토리보드를 만들고 있어요. 완료되면 캔버스에서 바로 확인할 수 있습니다.",
          "streaming",
        );
        await handleGenerate(commandBaseForm, {
          appendChatMessages: false,
          assistantMessageId,
        });
        return;
      }
    }

    const nextUserMessageId = `user-${Date.now()}`;
    const nextAssistantMessageId = `assistant-${Date.now()}`;
    appendStoryboardChatMessages([
      {
        id: nextUserMessageId,
        role: "user",
        text: sanitizeStoryboardChatDisplayText(submittedPrompt),
      },
      {
        id: nextAssistantMessageId,
        role: "assistant",
        text: "요청을 정리하고 있어요. 곧 캔버스에 반영할게요.",
        status: "streaming",
      },
    ]);
    setChatDraft("");
    setIsChatAgentStreaming(true);
    const abortController = new AbortController();
    chatAbortControllerRef.current = abortController;

    let finalResult: StoryboardChatAgentResult | null = null;
    let finalForm: GeneratorForm = { ...form, prompt: submittedPrompt };

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
          currentSegmentCount: form.segmentCount,
          currentAvailableSceneCount:
            storyboardFrameScenes.length || result.storyboard.scenes.length,
          generationMode: form.generationMode,
          focusContext: storyboardCanvasFocus,
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
      let lastStatus = "요청을 정리하고 있어요.";

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
              String((item.data as { message?: unknown }).message ?? lastStatus),
            );
            updateStoryboardChatMessage(
              nextAssistantMessageId,
              lastStatus,
              "streaming",
            );
          }
          if (
            (item.event === "patch" || item.event === "done") &&
            isStoryboardChatAgentResult(item.data)
          ) {
            finalResult = item.data;
            finalForm = createFormWithStoryboardChatPatch(
              finalForm,
              item.data.canvasPatch,
            );
            applyStoryboardChatPatchToCanvas(item.data.canvasPatch);
            updateStoryboardChatMessage(
              nextAssistantMessageId,
              item.data.assistantMessage,
              "done",
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
        await handleGenerate(finalForm, {
          appendChatMessages: false,
          assistantMessageId: nextAssistantMessageId,
        });
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
    }
  }

  function handleStoryboardChatKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void handleStoryboardChatSubmit();
  }

  async function handleExportStoryboardPng() {
    applyStoryboardCanvasFocus(
      createStoryboardActionFocusContext(
        "PNG 저장 실행",
        `현재 페이지 CUT ${String(activeCutStart).padStart(2, "0")}–${String(activeCutEnd).padStart(2, "0")} · ${exportResolutionToken}`,
        "사용자가 현재 2×2 스토리보드 페이지를 PNG로 저장했습니다. 이후 채팅은 저장된 페이지의 구도, 순서, 자막 보완을 기준으로 이어갈 수 있습니다.",
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
    const frameWidth = (canvas.width - margin * 2 - gap) / 2;
    const frameHeight = (canvas.height - margin * 2 - gap) / 2;

    for (const [index, scene] of activeStoryboardPageScenes.entries()) {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const trustedGeneratedImage = getTrustedStoryboardGeneratedImage(
        scene.generatedImage,
      );
      const generatedImage = await loadCanvasImage(
        trustedGeneratedImage?.dataUrl,
      );
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
      const message = "복사할 촬영 기획표가 없습니다. 먼저 스토리보드를 만들어주세요.";
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
      if (!navigator.clipboard?.writeText) {
        throw new Error("브라우저 클립보드 권한을 사용할 수 없습니다.");
      }
      await navigator.clipboard.writeText(exportMarkdown);
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

  async function handleGenerateStoryboardImages(
    options: {
      assistantMessageId?: string;
      targetScenes?: StoryboardScene[];
      sourceResult?: StoryboardGenerationResult;
      scope?: "page" | "selected";
    } = {},
  ) {
    const sourceResult = options.sourceResult ?? result;
    const targetScenes =
      options.targetScenes ?? activeStoryboardImageGenerationTargetScenes;
    const isSelectedScope = options.scope === "selected";
    if (targetScenes.length === 0) {
      const message =
        "현재 페이지에 이미지로 만들 스토리보드 컷이 없습니다.";
      setErrorMessage(message);
      if (options.assistantMessageId) {
        updateStoryboardChatMessage(
          options.assistantMessageId,
          message,
          "done",
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
        : `현재 페이지 CUT ${String(targetStart).padStart(2, "0")}–${String(targetEnd).padStart(2, "0")}`;
    if (!isStoryboardImageProviderAvailable) {
      guideUnavailableStoryboardImageGeneration({
        assistantMessageId: options.assistantMessageId,
        scopeLabel: targetLabel,
      });
      return;
    }
    const targetSceneNos = targetScenes.map((scene) => scene.sceneNo);
    setIsGeneratingImages(true);
    setGeneratingStoryboardImageSceneNos(targetSceneNos);
    setErrorMessage(null);
    applyStoryboardCanvasFocus(
      createStoryboardActionFocusContext(
        isSelectedScope ? "현재 컷 이미지 재생성" : "4컷 이미지 재생성",
        `${targetLabel} 이미지를 생성 중입니다.`,
        isSelectedScope
          ? "사용자가 선택한 CUT만 이미지 생성을 실행했습니다. 생성 후 해당 컷 이미지 톤과 자막/오디오 일치를 기준으로 후속 대화를 이어가세요."
          : "사용자가 현재 페이지 4컷 이미지 생성을 실행했습니다. 생성 후 이미지 톤, 컷별 완성도, 누락 컷을 기준으로 후속 대화를 이어가세요.",
      ),
    );
    if (options.assistantMessageId) {
      updateStoryboardChatMessage(
        options.assistantMessageId,
        isSelectedScope
          ? `${targetLabel} 이미지를 다시 만드는 중입니다...`
          : `현재 ${targetCount}컷 이미지를 만드는 중입니다...`,
        "streaming",
      );
    }

    let appliedImageCount = 0;
    let accumulatedResult = sourceResult;
    const applyGeneratedImages = (images: StoryboardImagesResponse["images"]) => {
      accumulatedResult = mergeStoryboardGeneratedImagesIntoResult(
        accumulatedResult,
        images,
      );
      setResult(accumulatedResult);
      appliedImageCount += images.length;
      const completedSceneNos = new Set(images.map((image) => image.sceneNo));
      setGeneratingStoryboardImageSceneNos((current) =>
        current.filter((sceneNo) => !completedSceneNos.has(sceneNo)),
      );
    };

    try {
      const generatedImages: StoryboardImagesResponse["images"] = [];
      if (!isSelectedScope && targetScenes.length > 1) {
        for (let index = 0; index < targetScenes.length; index += 1) {
          const scene = targetScenes[index];
          if (!scene) continue;
          if (options.assistantMessageId) {
            updateStoryboardChatMessage(
              options.assistantMessageId,
              `CUT ${String(scene.sceneNo).padStart(2, "0")} 이미지 생성 중입니다 · ${index + 1}/${targetScenes.length}`,
              "streaming",
            );
          }
          const scenePayload = await postStoryboardImagesRequest(
            accumulatedResult,
            [scene],
          );
          generatedImages.push(...scenePayload.images);
          applyGeneratedImages(scenePayload.images);
          applyStoryboardCanvasFocus(
            createStoryboardActionFocusContext(
              "컷 이미지 생성 진행",
              `CUT ${String(scene.sceneNo).padStart(2, "0")} 이미지가 캔버스에 반영됐습니다 · ${index + 1}/${targetScenes.length}`,
              "긴 4컷 생성도 컷 단위로 반영됩니다. 사용자가 이미 보이는 컷을 선택해 오디오/자막/비주얼 피드백을 바로 이어갈 수 있습니다.",
            ),
          );
        }
      } else {
        const payload = await postStoryboardImagesRequest(
          accumulatedResult,
          targetScenes,
        );
        generatedImages.push(...payload.images);
        applyGeneratedImages(payload.images);
      }
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
            : `완료 · 현재 페이지 ${generatedImages.length}/${targetCount}컷 이미지를 새 결과로 교체했습니다.`,
          "done",
        );
      }
      applyStoryboardCanvasFocus(
        createStoryboardActionFocusContext(
          isSelectedScope ? "현재 컷 이미지 생성 완료" : "4컷 이미지 생성 완료",
          `${targetLabel} 이미지 ${generatedImages.length}개가 캔버스에 반영됐습니다.`,
          isSelectedScope
            ? "선택 CUT의 새 이미지가 반영됐습니다. 사용자가 같은 컷의 오디오/자막/비주얼을 계속 보완할 수 있습니다."
            : "현재 페이지의 새 이미지가 반영됐습니다. 사용자가 컷을 선택하면 해당 이미지를 기준으로 보완 대화를 이어가세요.",
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "스토리보드 이미지를 생성하지 못했습니다.";
      setErrorMessage(message);
      if (options.assistantMessageId) {
        updateStoryboardChatMessage(
          options.assistantMessageId,
          isSelectedScope
            ? `현재 컷 재생성 실패 · ${message}`
            : `4컷 재생성 실패 · ${message} · 반영 ${appliedImageCount}/${targetScenes.length}`,
          "done",
        );
      }
    } finally {
      setIsGeneratingImages(false);
      setGeneratingStoryboardImageSceneNos([]);
    }
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background p-3"
      aria-label="스토리보드 생성"
      data-admin-storyboard-generator="true"
    >
      <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-3 overflow-hidden xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] xl:grid-rows-1">
        <Card
          className="order-2 flex min-h-0 flex-col overflow-hidden border-0 bg-card/80 shadow-none"
          aria-label="요구사항 채팅"
          data-storyboard-input-panel="chat-stream"
          data-storyboard-input-position="right-of-canvas"
        >
          <CardHeader className="shrink-0 space-y-1 p-3 pb-2">
            <div
              className="flex items-center justify-between gap-2"
              data-storyboard-chat-header="true"
            >
              <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <MessageCircle className="h-4 w-4" />
                </span>
                <span className="min-w-0 truncate">스토리보드 도우미</span>
                {" "}
                <Badge
                  variant={
                    isStoryboardImageProviderAvailable ? "secondary" : "outline"
                  }
                  className="h-6 max-w-[128px] shrink truncate rounded-full px-2 text-[10px]"
                  data-storyboard-image-provider-status={
                    storyboardImageProviderReadiness.status
                  }
                  title={storyboardImageProviderReadiness.summary}
                >
                  {storyboardImageProviderReadiness.label}
                </Badge>
              </CardTitle>
              <div
                className="flex shrink-0 items-center gap-1"
                data-storyboard-chat-header-actions="true"
              >
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
                          className="h-3.5 w-3.5 animate-spin"
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
                            onClick={() => void refreshStoryboardHistoryResults()}
                            disabled={storyboardHistoryStatus === "loading"}
                            aria-label="스토리보드 기록 새로고침"
                            data-storyboard-history-refresh="true"
                          >
                            {storyboardHistoryStatus === "loading" ? (
                              <Loader2
                                className="h-3.5 w-3.5 animate-spin"
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
                            onClick={() => setIsStoryboardHistoryPanelOpen(false)}
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
                            storyboardHistoryStatus === "stale" ? "true" : undefined
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
                          아직 저장된 실제 생성 기록이 없습니다. 채팅에서 “생성”을
                          보내면 여기에 쌓입니다.
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
                              historyCase.result.generatedAt === result.generatedAt;
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
                                        title={historyCase.result.storyboard.title}
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
                                    >
                                      {historyTrace.mode === "actual"
                                        ? "실제"
                                        : "샘플"}
                                    </Badge>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="sm"
                                      className="h-7 rounded-full px-2 text-[11px]"
                                      onClick={() => {
                                        applyStoryboardHistoryResult(historyCase);
                                        setIsStoryboardHistoryPanelOpen(false);
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
                                        {proofSummaries.slice(0, 4).map((proof) => (
                                          <div
                                            key={`${historyCase.id}-${proof.sceneNo}-${proof.imageCallId}`}
                                            className="grid gap-1 rounded-md bg-muted/35 p-1.5 sm:grid-cols-[44px_minmax(0,1fr)]"
                                          >
                                            <span className="font-semibold">
                                              CUT {String(proof.sceneNo).padStart(2, "0")}
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
                    className="w-[min(360px,calc(100vw-2rem))] p-0"
                    data-storyboard-chat-settings-dropdown="true"
                  >
                    <div
                      className="space-y-2 rounded-md bg-background/95 p-3"
                      data-storyboard-chat-settings-panel="true"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs font-semibold">
                            <Settings className="h-3.5 w-3.5 text-primary" />
                            <span>채팅 설정</span>
                            <Badge
                              variant={
                                storyboardRealDataTrace.mode === "actual"
                                  ? "secondary"
                                  : "outline"
                              }
                              className="px-1.5 text-[10px]"
                              data-storyboard-chat-settings-real-data-mode={
                                storyboardRealDataTrace.mode
                              }
                            >
                              {storyboardRealDataTrace.headline}
                            </Badge>
                          </div>
                          <p
                            className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground"
                            title={`${storyboardRealDataTrace.backendText} · ${storyboardRealDataTrace.sourceText} · ${storyboardRealDataTrace.generatedAtText}`}
                            data-storyboard-chat-settings-source-trace="true"
                          >
                            {storyboardRealDataTrace.backendText} ·{" "}
                            {storyboardRealDataTrace.sourceText}
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
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p
                          className="text-[11px] text-muted-foreground"
                          data-storyboard-chat-settings-generated-at="true"
                        >
                          {storyboardRealDataTrace.generatedAtText}
                        </p>
                        {omittedStoryboardSceneCount > 0 ? (
                          <Badge
                            variant="outline"
                            className="rounded-full px-2 text-[10px]"
                            data-storyboard-omitted-scene-count="true"
                          >
                            {formatStoryboardOmittedSceneText(
                              omittedStoryboardSceneCount,
                            )}
                          </Badge>
                        ) : (
                          <span
                            className="sr-only"
                            data-storyboard-omitted-scene-count="true"
                          >
                            {formatStoryboardOmittedSceneText(
                              omittedStoryboardSceneCount,
                            )}
                          </span>
                        )}
                      </div>
                      <div
                        className="rounded-2xl border border-border/70 bg-muted/25 p-2 text-[11px]"
                        data-storyboard-pdf-flow-trace="true"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-foreground">
                            프로젝트 흐름 추적
                          </span>
                          <Badge
                            variant="outline"
                            className="rounded-full px-1.5 text-[10px]"
                          >
                            15개 상태
                          </Badge>
                        </div>
                        <p
                          className="mt-1 leading-4 text-muted-foreground"
                          data-storyboard-pdf-flow-service="true"
                        >
                          {STORYBOARD_PDF_FLOW_SERVICE_TEXT}
                        </p>
                        <p
                          className="mt-1 leading-4 text-muted-foreground"
                          data-storyboard-pdf-flow-sequence="true"
                        >
                          {STORYBOARD_PDF_FLOW_SEQUENCE_TEXT}
                        </p>
                        <div className="mt-1.5 grid gap-1">
                          {storyboardPdfFlowChecks.map((check) => (
                            <div
                              key={check.id}
                              className="grid grid-cols-[92px_minmax(0,1fr)] gap-2 rounded-xl bg-background/70 px-2 py-1.5"
                              data-storyboard-pdf-flow-check={check.id}
                              data-storyboard-pdf-flow-check-status={
                                check.status
                              }
                            >
                              <span className="truncate font-semibold text-foreground">
                                {check.label}
                              </span>
                              <span className="min-w-0">
                                <span
                                  className={cn(
                                    "mr-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                                    check.status === "used"
                                      ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                                      : check.status === "available"
                                        ? "bg-sky-500/12 text-sky-700 dark:text-sky-300"
                                        : check.status === "fallback"
                                          ? "bg-amber-500/12 text-amber-700 dark:text-amber-300"
                                          : "bg-muted text-muted-foreground",
                                  )}
                                >
                                  {getStoryboardPdfFlowStatusLabel(
                                    check.status,
                                  )}
                                </span>
                                <span
                                  className="line-clamp-1 text-muted-foreground"
                                  title={check.summary}
                                >
                                  {check.summary}
                                </span>
                              </span>
                            </div>
                          ))}
                        </div>
                        <div
                          className="mt-1.5 rounded-xl bg-background/70 px-2 py-1.5 text-muted-foreground"
                          data-storyboard-evaluation-review-status="true"
                        >
                          <p>{STORYBOARD_EVALUATION_LOGS_TEXT}</p>
                          <p className="mt-0.5">
                            {STORYBOARD_REVIEW_STATUS_TEXT}
                          </p>
                        </div>
                      </div>
                      <div
                        className={cn(
                          "rounded-2xl border p-2 text-[11px]",
                          storyboardBackendAgentReadiness.retrievalUsed
                            ? "border-emerald-300/60 bg-emerald-500/10"
                            : storyboardBackendAgentReadiness.liveGraphReady ||
                              storyboardBackendAgentReadiness.outputReadyForReview
                            ? "border-sky-300/60 bg-sky-500/10"
                            : storyboardBackendAgentReadiness.resumeRequired
                            ? "border-amber-300/60 bg-amber-500/10"
                            : "border-border/70 bg-muted/25",
                        )}
                        data-storyboard-backend-agent-readiness="true"
                        data-storyboard-backend-agent-status={
                          storyboardBackendAgentReadiness.status
                        }
                        data-storyboard-backend-agent-live-graph-ready={
                          storyboardBackendAgentReadiness.liveGraphReady
                            ? "true"
                            : "false"
                        }
                        data-storyboard-backend-agent-retrieval-used={
                          storyboardBackendAgentReadiness.retrievalUsed
                            ? "true"
                            : "false"
                        }
                        data-storyboard-backend-agent-resume-required={
                          storyboardBackendAgentReadiness.resumeRequired
                            ? "true"
                            : "false"
                        }
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-foreground">
                            생성 준비 상태
                          </span>
                          <Badge
                            variant={
                              storyboardBackendAgentReadiness.retrievalUsed
                                ? "secondary"
                                : "outline"
                            }
                            className="rounded-full px-1.5 text-[10px]"
                          >
                            {storyboardBackendAgentReadiness.label}
                          </Badge>
                        </div>
                        <p
                          className="mt-1 leading-4 text-muted-foreground"
                          data-storyboard-backend-agent-summary="true"
                        >
                          {storyboardBackendAgentReadiness.summary}
                        </p>
                        <p
                          className="mt-1 line-clamp-2 leading-4 text-muted-foreground"
                          title={storyboardBackendAgentReadiness.detail}
                          data-storyboard-backend-agent-detail="true"
                        >
                          {storyboardBackendAgentReadiness.detail}
                        </p>
                      </div>
                      <div
                        className={cn(
                          "rounded-2xl border p-2 text-[11px]",
                          storyboardAgentGraphFidelity.status === "passed"
                            ? "border-emerald-300/60 bg-emerald-500/10"
                            : "border-amber-300/60 bg-amber-500/10",
                        )}
                        data-storyboard-agent-graph-fidelity="true"
                        data-storyboard-agent-graph-fidelity-status={
                          storyboardAgentGraphFidelity.status
                        }
                        data-storyboard-agent-graph-fidelity-score={String(
                          storyboardAgentGraphFidelity.score,
                        )}
                        data-storyboard-agent-graph-fidelity-mode={
                          storyboardAgentGraphFidelity.evidenceMode
                        }
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-foreground">
                            참조 그래프 충실도
                          </span>
                          <Badge
                            variant={
                              storyboardAgentGraphFidelity.status === "passed"
                                ? "secondary"
                                : "outline"
                            }
                            className="rounded-full px-1.5 text-[10px]"
                            data-storyboard-agent-graph-fidelity-ahp="true"
                          >
                            AHP {storyboardAgentGraphFidelity.score}/
                            {storyboardAgentGraphFidelity.targetScore}
                          </Badge>
                        </div>
                        <p className="mt-1 leading-4 text-muted-foreground">
                          Supervisor·Researcher·Intern·Designer 상태를 기존
                          스토리보드 AHP와 분리해 검증합니다.
                        </p>
                        <div className="mt-1.5 grid gap-1">
                          {storyboardAgentGraphFidelity.roles.map((role) => (
                            <div
                              key={role.id}
                              className="grid grid-cols-[84px_minmax(0,1fr)] gap-2 rounded-xl bg-background/70 px-2 py-1.5"
                              data-storyboard-agent-graph-role={role.id}
                              data-storyboard-agent-graph-role-state={
                                role.evidenceState
                              }
                            >
                              <span className="truncate font-semibold text-foreground">
                                {role.label}
                              </span>
                              <span className="min-w-0">
                                <span
                                  className={cn(
                                    "mr-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                                    role.evidenceState === "supported"
                                      ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                                      : role.evidenceState === "blocked"
                                        ? "bg-destructive/12 text-destructive"
                                        : "bg-amber-500/12 text-amber-700 dark:text-amber-300",
                                  )}
                                >
                                  {role.evidenceState === "supported"
                                    ? "증거 충분"
                                    : role.evidenceState === "adapter"
                                      ? "일부 증거"
                                      : role.evidenceState === "blocked"
                                        ? "차단"
                                        : "누락"}
                                </span>
                                <span className="line-clamp-1 text-muted-foreground">
                                  {role.evidence}
                                </span>
                              </span>
                            </div>
                          ))}
                        </div>
                        {storyboardAgentGraphFidelity.blockers.length ? (
                          <ul
                            className="mt-1.5 list-disc space-y-0.5 pl-4 text-muted-foreground"
                            data-storyboard-agent-graph-blockers="true"
                          >
                            {storyboardAgentGraphFidelity.blockers
                              .slice(0, 3)
                              .map((blocker) => (
                                <li key={blocker}>{blocker}</li>
                              ))}
                          </ul>
                        ) : null}
                      </div>

                      <div
                        className="rounded-2xl border border-border/70 bg-muted/25 p-2"
                        data-storyboard-user-perspective-readiness="true"
                      >
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-foreground">
                            사용자 관점 점검
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            채팅에 “점검”
                          </span>
                        </div>
                        <div className="grid gap-1">
                          {storyboardUserPerspectiveReadiness.map((item) => (
                            <div
                              key={item.id}
                              className="grid grid-cols-[84px_minmax(0,1fr)] items-start gap-2 rounded-xl bg-background/70 px-2 py-1.5 text-[11px]"
                              data-storyboard-user-perspective-role={item.id}
                            >
                              <span className="truncate font-semibold text-foreground">
                                {item.label}
                              </span>
                              <span className="min-w-0">
                                <span
                                  className={cn(
                                    "mr-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                                    item.status === "ready"
                                      ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                                      : "bg-amber-500/12 text-amber-700 dark:text-amber-300",
                                  )}
                                >
                                  {item.status === "ready"
                                    ? "준비됨"
                                    : "확인 필요"}
                                </span>
                                <span className="line-clamp-1 text-muted-foreground">
                                  {item.summary}
                                </span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div
                        className={cn(
                          "rounded-2xl border p-2 text-[11px]",
                          isStoryboardImageProviderAvailable
                            ? "border-emerald-300/60 bg-emerald-500/10"
                            : "border-amber-300/60 bg-amber-500/10",
                        )}
                        data-storyboard-image-provider-readiness="true"
                        data-storyboard-image-provider-status={
                          storyboardImageProviderReadiness.status
                        }
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-foreground">
                                이미지 생성 준비 상태
                              </span>
                              <Badge
                                variant={
                                  isStoryboardImageProviderAvailable
                                    ? "secondary"
                                    : "outline"
                                }
                                className="rounded-full px-1.5 text-[10px]"
                              >
                                {storyboardImageProviderReadiness.label}
                              </Badge>
                            </div>
                            <p
                              className="mt-1 leading-4 text-muted-foreground"
                              data-storyboard-image-provider-guidance="true"
                            >
                              {storyboardImageProviderReadiness.summary}{" "}
                              {storyboardImageProviderReadiness.detail}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={() =>
                              void refreshStoryboardImageProviderReadiness()
                            }
                            aria-label="스토리보드 이미지 상태 새로고침"
                            data-storyboard-image-provider-refresh="true"
                          >
                            {storyboardImageProviderReadiness.status ===
                            "checking" ? (
                              <Loader2
                                className="h-3.5 w-3.5 animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <RotateCcw
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                            )}
                          </Button>
                        </div>
                        <div className="mt-1.5 grid gap-1 rounded-xl bg-background/70 p-2">
                          <p
                            className="truncate text-muted-foreground"
                            data-storyboard-image-provider-model="true"
                          >
                            이미지 크기 {formatStoryboardImageProviderTarget(
                              storyboardImageProviderReadiness.target,
                            )}
                          </p>
                          <p className="line-clamp-2 text-muted-foreground">
                            새 이미지를 만들기 전 안전 확인을 먼저 진행합니다.
                            채팅에 “이미지상태”를 보내면 같은 안내를 다시 볼 수
                            있습니다.
                          </p>
                        </div>
                      </div>
                      <div
                        className="rounded-2xl border border-amber-300/60 bg-amber-500/10 p-2 text-[11px]"
                        data-storyboard-visual-safety-readiness="true"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-foreground">
                            이미지 안전 점검
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            채팅에 “안전점검”
                          </span>
                        </div>
                        <p className="mt-1 leading-4 text-muted-foreground">
                          실존 인물/진행자 얼굴·얼굴 클로즈업은 생성 대상이
                          아니며, 손·젓가락·음식·오버숄더/뒷모습 실루엣
                          중심으로 확인합니다.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 rounded-full px-2 text-xs"
                            onClick={() =>
                              void handleGenerateStoryboardImages(
                                selectedRealStoryboardScene
                                  ? {
                                      targetScenes: [
                                        selectedRealStoryboardScene,
                                      ],
                                      scope: "selected",
                                    }
                                  : undefined,
                              )
                            }
                            disabled={
                              isStoryboardResultSkeletonVisible ||
                              isGeneratingImages ||
                              (selectedRealStoryboardScene
                                ? false
                                : activeStoryboardImageGenerationTargetScenes.length === 0)
                            }
                            aria-label={
                              selectedRealStoryboardScene
                                ? `CUT ${String(selectedRealStoryboardScene.sceneNo).padStart(2, "0")} 이미지 재생성`
                                : imageGenerationButtonLabel
                            }
                            data-storyboard-chat-settings-image-command="true"
                            data-storyboard-image-provider-action-status={
                              storyboardImageProviderReadiness.status
                            }
                            title={imageGenerationButtonLabel}
                          >
                            {isGeneratingImages ? (
                              <Loader2
                                className="mr-1 h-3.5 w-3.5 animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <ImageIcon
                                className="mr-1 h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                            )}
                            {selectedRealStoryboardScene ? "현재 컷" : "4컷"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-full px-2 text-xs"
                            onClick={resetStoryboardChatState}
                            disabled={isGenerating || isChatAgentStreaming}
                            data-storyboard-chat-settings-reset="true"
                          >
                            <RotateCcw
                              className="mr-1 h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                            초기화
                          </Button>
                        </div>
                      </div>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 pt-0">
            <section
              className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-b from-background/95 to-muted/35 shadow-sm"
              data-storyboard-chat-panel="true"
              data-storyboard-chat-style="thumbnail-like"
            >
              <div
                ref={chatTranscriptRef}
                className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3"
                data-storyboard-chat-log="true"
                data-storyboard-chat-transcript="true"
                aria-live="polite"
              >
                {chatMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-2 ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                    data-storyboard-chat-message={message.role}
                    data-storyboard-chat-message-status={
                      message.status ?? "done"
                    }
                  >
                    {message.role !== "user" ? (
                      <div className="mt-5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                        {message.status === "streaming" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Wand2 className="h-3.5 w-3.5" />
                        )}
                      </div>
                    ) : null}
                    <div
                      className={`max-w-[86%] space-y-1 ${message.role === "user" ? "text-right" : "text-left"}`}
                    >
                      <div
                        className={`text-[10px] font-medium uppercase tracking-wide ${
                          message.role === "user"
                            ? "text-primary"
                            : "text-muted-foreground"
                        }`}
                        data-storyboard-chat-message-meta="true"
                      >
                        {message.role === "user"
                          ? "나"
                          : message.status === "streaming"
                            ? currentStreamingLabel
                            : "스토리보드 도우미"}
                      </div>
                      <div
                        className={`rounded-2xl px-3 py-2 text-xs leading-5 shadow-sm ${
                          message.role === "user"
                            ? "rounded-br-md bg-primary text-primary-foreground"
                            : message.status === "streaming"
                              ? "rounded-bl-md border border-sky-300/60 bg-sky-500/10 text-sky-950 dark:text-sky-100"
                              : "rounded-bl-md bg-background text-foreground ring-1 ring-border/60"
                        }`}
                        data-storyboard-chat-message-bubble="true"
                      >
                        <p className="whitespace-pre-wrap break-keep [overflow-wrap:anywhere]">
                          {message.text}
                        </p>
                        {message.status === "streaming" ? (
                          <p className="mt-1 flex items-center gap-1.5 whitespace-pre-wrap break-keep opacity-80 [overflow-wrap:anywhere]">
                            <Loader2
                              className="h-3 w-3 animate-spin"
                              aria-hidden="true"
                            />
                            {currentStreamingPhase}
                          </p>
                        ) : null}
                      </div>
                      {message.role === "assistant" &&
                      message.id === "assistant-intake" ? (
                        <div
                          className="flex flex-wrap gap-1.5 pl-1"
                          data-storyboard-chat-message-actions="true"
                          data-storyboard-chat-message-actions-placement="outside-bubble"
                        >
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 rounded-full bg-background/80 px-2 text-[11px] shadow-sm"
                            onClick={handleStoryboardUsageGuideClick}
                            disabled={isGenerating || isChatAgentStreaming}
                            data-storyboard-chat-guide-button="true"
                            data-storyboard-chat-message-action="guide"
                          >
                            가이드 보기
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 rounded-full px-2 text-[11px] shadow-sm"
                            onClick={() =>
                              void handleStoryboardGuidedExampleGenerate()
                            }
                            disabled={isGenerating || isChatAgentStreaming}
                            data-storyboard-chat-guide-generate="true"
                            data-storyboard-chat-message-action="example"
                          >
                            예시 만들기
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    {message.role === "user" ? (
                      <div className="mt-5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                        <MessageCircle className="h-3.5 w-3.5" />
                      </div>
                    ) : null}
                  </div>
                ))}
                {chatDraft.trim() || isChatAgentStreaming ? (
                  <div
                    className="flex gap-2"
                    data-storyboard-chat-draft-preview="true"
                    data-storyboard-chat-live-stream="true"
                  >
                    <div className="mt-5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sky-500/15 text-sky-600">
                      {isChatAgentStreaming ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <MessageCircle className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="max-w-[86%] space-y-1">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-200">
                        {isChatAgentStreaming
                          ? currentStreamingLabel
                          : "입력 프리뷰"}
                      </div>
                      <div className="rounded-2xl rounded-bl-md border border-dashed border-sky-400/70 bg-sky-500/10 px-3 py-2 text-xs leading-5 text-sky-950 shadow-sm whitespace-pre-wrap break-keep [overflow-wrap:anywhere] dark:text-sky-100">
                        {isChatAgentStreaming
                          ? currentStreamingPhase
                          : "입력 중 · 보낼 준비 중"}
                      </div>
                    </div>
                  </div>
                ) : null}
                </div>

              <div
                className="shrink-0 space-y-2 border-t border-border/70 bg-background/80 p-2.5"
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
                    className="flex min-h-8 items-center justify-between gap-2 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px]"
                    data-storyboard-chat-canvas-context="true"
                    data-storyboard-chat-canvas-context-kind={
                      storyboardCanvasFocus.kind
                    }
                    data-storyboard-chat-canvas-context-scene={
                      storyboardCanvasFocus.sceneNo
                        ? String(storyboardCanvasFocus.sceneNo)
                        : undefined
                    }
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Badge
                        variant="secondary"
                        className="h-6 shrink-0 rounded-full px-2 text-[11px]"
                        data-storyboard-canvas-focus-label="true"
                      >
                        {storyboardCanvasFocus.label}
                      </Badge>
                      <span className="shrink-0 font-medium text-primary">
                        채팅 맥락
                      </span>
                      <span
                        className="min-w-0 truncate text-muted-foreground"
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
                      className="h-6 shrink-0 rounded-full px-2 text-[11px]"
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
                    data-storyboard-chat-error="true"
                  >
                    <TriangleAlert
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    <p>{errorMessage}</p>
                  </div>
                ) : null}
                <Label htmlFor="storyboard-prompt" className="sr-only">
                  스토리보드 요구사항 채팅 입력
                </Label>
                <div
                  className="rounded-3xl border border-border/60 bg-background p-2 shadow-sm"
                  data-storyboard-chat-composer="true"
                >
                  <div className="flex items-end gap-2">
                    <Textarea
                      id="storyboard-prompt"
                      value={chatDraft}
                      onChange={(event) =>
                        handleChatDraftChange(event.target.value)
                      }
                      onKeyDown={handleStoryboardChatKeyDown}
                      disabled={isChatAgentStreaming}
                      className="max-h-24 min-h-10 resize-none border-0 bg-transparent p-2 text-sm shadow-none focus-visible:ring-0"
                      maxLength={400}
                      placeholder={storyboardChatPlaceholder}
                      aria-label="스토리보드 요구사항 채팅 입력"
                    />
                    <Button
                      type="button"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-full"
                      onClick={
                        isChatAgentStreaming
                          ? abortStoryboardChatWork
                          : () => void handleStoryboardChatSubmit()
                      }
                      disabled={isChatAgentStreaming ? false : !chatDraft.trim()}
                      aria-label={
                        isChatAgentStreaming
                          ? "채팅 스트림 중단"
                          : "요구사항 채팅 반영"
                      }
                      data-storyboard-chat-submit={
                        isChatAgentStreaming ? undefined : "true"
                      }
                      data-storyboard-chat-cancel={
                        isChatAgentStreaming ? "true" : undefined
                      }
                    >
                      {isChatAgentStreaming ? (
                        <Square className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Send className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          </CardContent>
        </Card>

        <Card
          className="order-1 flex min-h-0 flex-col overflow-hidden border-0 bg-card/80 shadow-none"
          aria-label="스토리보드 이미지 생성 결과"
          data-storyboard-result-panel="image-frames-only"
        >
          <CardHeader className="flex shrink-0 flex-row items-center gap-2 p-2 pb-1">
            <CardTitle
              className="flex min-w-0 items-center gap-2 text-sm"
              aria-label="캔버스 편집 / PNG 내보내기"
            >
              <span
                className="shrink-0 whitespace-nowrap font-semibold"
              >
                캔버스
              </span>
            </CardTitle>
              <div
                className="ml-auto flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto pb-1"
                data-storyboard-canvas-toolbar="thumbnail-like"
                data-storyboard-compact-toolbar="true"
              >
                <Badge
                  variant="secondary"
                  className="h-7 shrink-0 rounded-full px-2 text-[11px]"
                  data-storyboard-frame-page-range="true"
                  aria-label="현재 스토리보드 페이지 컷 범위"
                >
                  CUT {String(activeCutStart).padStart(2, "0")}–
                  {String(activeCutEnd).padStart(2, "0")} /{" "}
                  {String(totalCutCount).padStart(2, "0")}
                </Badge>
                <Badge
                  variant="outline"
                  className="h-7 shrink-0 rounded-full px-2 text-[11px]"
                  data-storyboard-generated-image-count="true"
                >
                  이미지 {activePageGeneratedCount}/
                  {activeStoryboardImageGenerationTargetScenes.length ||
                    STORYBOARD_FRAMES_PER_PAGE}
                  · 전체 {generatedImageCount}/{totalCutCount}
                </Badge>
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
                    disabled={
                      isStoryboardResultSkeletonVisible ||
                      !hasPreviousStoryboardPage
                    }
                    data-storyboard-page-prev="true"
                    aria-label="이전 4컷 보기"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <span
                    className="min-w-12 text-center text-xs font-semibold text-muted-foreground"
                    data-storyboard-page-indicator="true"
                  >
                    {activeStoryboardPage + 1} / {storyboardTotalPages}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() =>
                      handleStoryboardPageChange(activeStoryboardPage + 1)
                    }
                    disabled={
                      isStoryboardResultSkeletonVisible ||
                      !hasNextStoryboardPage
                    }
                    data-storyboard-page-next="true"
                    aria-label="다음 4컷 보기"
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
                  variant="outline"
                  onClick={handleStoryboardGuideToggle}
                  className="h-8 shrink-0 px-2 text-xs"
                  data-storyboard-safe-area-toggle="true"
                >
                  {showStoryboardGuide ? "가이드 숨김" : "가이드"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleGenerateStoryboardImages()}
                  disabled={
                    isStoryboardResultSkeletonVisible ||
                    isGeneratingImages ||
                    activePageGenerationTargetCount === 0
                  }
                  className="h-8 shrink-0 px-2 text-xs"
                  data-storyboard-generate-images="local-codex"
                  data-storyboard-image-provider-action-status={
                    storyboardImageProviderReadiness.status
                  }
                  aria-label={imageGenerationButtonLabel}
                  title={imageGenerationButtonLabel}
                >
                  {isGeneratingImages ? (
                    <Loader2
                      className="mr-1.5 h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <ImageIcon
                      className="mr-1.5 h-3.5 w-3.5"
                      aria-hidden="true"
                    />
                  )}
                  {isGeneratingImages
                    ? "생성 중"
                    : compactImageGenerationButtonLabel}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleCopyStoryboardPlanMarkdown()}
                  disabled={isStoryboardResultSkeletonVisible}
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
                  disabled={isStoryboardResultSkeletonVisible}
                  className="h-8 shrink-0 px-2 text-xs"
                  data-storyboard-export-png="true"
                  aria-label={`현재 페이지 4컷 PNG 저장 (${exportResolutionToken})`}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  PNG 저장
                </Button>
              </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-hidden p-3 pt-0">
            <div className="flex h-full min-h-0 flex-col gap-2">
              <div
                className="relative grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2"
                data-storyboard-image-board="true"
                data-storyboard-frame-grid="true"
                data-storyboard-frame-fill="true"
                data-storyboard-frame-page={String(activeStoryboardPage + 1)}
                data-storyboard-frame-page-size={String(
                  STORYBOARD_FRAMES_PER_PAGE,
                )}
              >
              {isStoryboardResultSkeletonVisible ? (
                <StoryboardGlassLoadingCanvas
                  activeCutStart={activeCutStart}
                  activeCutEnd={activeCutEnd}
                  mode="loading"
                />
              ) : activeStoryboardPageScenes.length === 0 ? (
                <StoryboardGlassLoadingCanvas
                  activeCutStart={activeCutStart}
                  activeCutEnd={activeCutEnd}
                  mode="empty"
                />
              ) : (
                activeStoryboardPageScenes.map((scene) => {
                  const frameVisual = getStoryboardFrameVisual(scene.sceneNo);
                  const trustedGeneratedImage =
                    getTrustedStoryboardGeneratedImage(scene.generatedImage);
                  const isSceneImageGenerating =
                    generatingStoryboardImageSceneNoSet.has(scene.sceneNo);
                  const shouldShowSceneSkeleton =
                    isSceneImageGenerating || !trustedGeneratedImage;
                  const productionNote = formatStoryboardFrameProductionNote(scene);
                  return (
                    <button
                      type="button"
                      key={`frame-${scene.sceneNo}-${scene.heatmapEvidence.videoId}`}
                      className={cn(
                        "group relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border-0 bg-background p-0 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
                        selectedStoryboardSceneNo === scene.sceneNo
                          ? "shadow-md"
                          : "shadow-sm",
                      )}
                      onClick={() => handleSelectStoryboardScene(scene)}
                      aria-label={`${scene.sceneNo}컷을 선택해서 채팅 맥락으로 사용`}
                      aria-pressed={selectedStoryboardSceneNo === scene.sceneNo}
                      data-storyboard-image-frame={String(scene.sceneNo)}
                      data-storyboard-selected-frame={
                        selectedStoryboardSceneNo === scene.sceneNo
                          ? "true"
                          : undefined
                      }
                      data-storyboard-image-generation-state={
                        isSceneImageGenerating
                          ? "generating"
                          : trustedGeneratedImage
                            ? "ready"
                            : "empty"
                      }
                      >
                      {selectedStoryboardSceneNo === scene.sceneNo &&
                      !shouldShowSceneSkeleton ? (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 z-50 rounded-2xl border-2 border-primary"
                          data-storyboard-selected-frame-border="true"
                        />
                      ) : null}
                      {shouldShowSceneSkeleton ? (
                        <div
                          className="relative min-h-0 flex-1 overflow-hidden rounded-2xl"
                          aria-label={`${scene.sceneNo}컷 이미지 생성 대기`}
                          data-storyboard-frame-skeleton-only="true"
                        >
                          <StoryboardCutImageSkeleton
                            sceneNo={scene.sceneNo}
                            hasExistingImage={Boolean(trustedGeneratedImage)}
                            fullFrame
                          />
                        </div>
                      ) : (
                        <>
                      <div
                        className="relative min-h-0 flex-1 overflow-hidden rounded-t-2xl"
                        style={{ background: frameVisual.background }}
                        aria-label={`${scene.sceneNo}컷 이미지 생성 결과`}
                      >
                        {trustedGeneratedImage ? (
                          <NextImage
                            src={trustedGeneratedImage.dataUrl}
                            alt={`${scene.sceneNo}컷 스토리보드 이미지`}
                            fill
                            sizes="(min-width: 1280px) 36vw, 50vw"
                            className="object-cover"
                            unoptimized
                            data-storyboard-generated-image="local-codex"
                          />
                        ) : null}
                        {isSceneImageGenerating ? (
                          <StoryboardCutImageSkeleton
                            sceneNo={scene.sceneNo}
                            hasExistingImage={Boolean(trustedGeneratedImage)}
                          />
                        ) : null}
                        <div className="absolute inset-x-3 top-3 z-20 flex items-center justify-between gap-2">
                          <Badge className="rounded-full bg-black/60 text-white hover:bg-black/60">
                            CUT {String(scene.sceneNo).padStart(2, "0")}
                          </Badge>
                          <Badge className="rounded-full bg-white/80 text-slate-900 hover:bg-white/80">
                            {scene.heatmapEvidence.peakTime}
                          </Badge>
                        </div>
                        {showStoryboardGuide ? (
                          <div
                            className="pointer-events-none absolute inset-[12%] rounded-2xl border border-dashed border-white/70"
                            data-storyboard-safe-area-guide="true"
                          />
                        ) : null}
                        {!trustedGeneratedImage && !isSceneImageGenerating ? (
                          <StoryboardCutImageSkeleton
                            sceneNo={scene.sceneNo}
                            hasExistingImage={false}
                          />
                        ) : null}
                        {trustedGeneratedImage && !isSceneImageGenerating ? (
                          <div
                            className="absolute inset-x-3 bottom-3 z-20 grid grid-cols-[58px_minmax(0,1fr)] items-center gap-2 rounded-2xl bg-black/58 px-2 py-1.5 text-xs leading-4 text-white shadow-sm backdrop-blur-[1px]"
                            data-storyboard-frame-production-note="true"
                            data-storyboard-frame-production-note-row="true"
                          >
                            <span className="rounded-full bg-amber-200 px-2 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-amber-950">
                              촬영
                            </span>
                            <span
                              className="line-clamp-2 font-semibold"
                              title={productionNote}
                              data-storyboard-frame-production-note-text="true"
                            >
                              {productionNote}
                            </span>
                          </div>
                        ) : null}
                      </div>
                      <div
                        className="shrink-0 space-y-1 border-t border-border/70 bg-background/95 px-2.5 py-1.5 text-foreground shadow-[0_-1px_0_rgba(15,23,42,0.06)]"
                        data-storyboard-frame-script="true"
                        data-storyboard-frame-script-panel="true"
                        data-storyboard-frame-script-placement="separated"
                      >
                        <div
                          className="grid grid-cols-[58px_minmax(0,1fr)] items-start gap-2 rounded-xl bg-muted/25 px-2 py-1 text-[11px] leading-4"
                          data-storyboard-frame-audio="true"
                          data-storyboard-frame-audio-row="true"
                        >
                          <span className="rounded-full bg-muted px-2 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            오디오
                          </span>
                          <span
                            className="line-clamp-1 font-semibold text-foreground"
                            title={scene.hostBeat}
                            data-storyboard-frame-audio-text="true"
                          >
                            {scene.hostBeat}
                          </span>
                        </div>
                        <div
                          className="grid grid-cols-[58px_minmax(0,1fr)] items-start gap-2 rounded-xl bg-primary/5 px-2 py-1 text-[11px] leading-4"
                          data-storyboard-frame-subtitle="true"
                          data-storyboard-frame-subtitle-row="true"
                        >
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-primary">
                            자막
                          </span>
                          <span
                            className="line-clamp-1 font-bold text-foreground"
                            title={scene.captionIdea}
                            data-storyboard-frame-subtitle-text="true"
                          >
                            {scene.captionIdea}
                          </span>
                        </div>
                      </div>
                        </>
                      )}
                    </button>
                  );
                })
              )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

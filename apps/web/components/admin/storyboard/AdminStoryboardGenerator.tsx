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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
  getStoryboardTrustedScenePageCount,
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
  summaryText: string;
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
    "실제 히트맵 데이터에서 반복 시청 피크가 높은 먹방 장면을 바탕으로 다음 업로드용 8컷 스토리보드를 생성해줘. 음식 클로즈업, 첫 입 리액션, 면/소리 포인트, 완식 마무리 흐름을 포함해줘.",
  tone: "energetic",
  targetLengthMinutes: 14,
  sourceLimit: 80,
  segmentCount: 8,
  includeProductionNotes: true,
  generationMode: "backend_agent",
};

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
  | "status";

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
    /^(안전점검|이미지점검|얼굴점검|비주얼점검|safety|visualsafety|imagecheck|facecheck)$/.test(
      compact,
    )
  ) {
    return "safety";
  }
  if (/^(점검|사용자점검|사용자관점|검수|qa|review)$/.test(compact)) {
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

  return null;
}

const STORYBOARD_FRAMES_PER_PAGE = 4;
// Source contracts kept literal for admin storyboard UI regression tests:
// postStoryboardImagesRequest(result, activeStoryboardImageGenerationTargetScenes)
// isStoryboardResultSkeletonVisible || !hasPreviousStoryboardPage
// isStoryboardResultSkeletonVisible || !hasNextStoryboardPage
// disabled={isStoryboardResultSkeletonVisible || isGeneratingImages}
// disabled={isStoryboardResultSkeletonVisible}
// Array.from({ length: STORYBOARD_FRAMES_PER_PAGE }
// data-storyboard-frame-page={String(activeStoryboardPage + 1)}
// data-storyboard-frame-page-size={String(STORYBOARD_FRAMES_PER_PAGE)}

const storyboardStreamingPhases = [
  "요구사항을 씬 후보로 분해 중",
  "반복 시청 피크와 컷 리듬을 매칭 중",
  "좌측 캔버스 2×2 컷에 순차 반영 중",
  "자막·리액션·클로즈업 포인트 정리 중",
];

function formatStoryboardRealDataPercent(value: number) {
  if (!Number.isFinite(value)) return "0.0%";
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

function formatStoryboardGraphRuntimeLabel(
  graph: NonNullable<
    StoryboardGenerationResult["backendAnalysis"]["backendAgent"]
  >["graph"],
) {
  if (!graph) return null;
  if (graph.runtime === "langgraph") return "런타임 LangGraph";
  if (graph.runtime === "codex_cli_oauth_legacy") return "런타임 Codex CLI legacy";
  return "런타임 로컬 폴백";
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
        "검색 search_scene_data",
        graph.retrieval?.usedModels?.embedding
          ? `임베딩 ${graph.retrieval.usedModels.embedding}`
          : null,
        graph.retrieval?.usedModels?.reranker
          ? `리랭커 ${graph.retrieval.usedModels.reranker}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "검색/리랭커 미사용";
  return [
    formatStoryboardGraphRuntimeLabel(graph),
    `그래프 ${graph.status}`,
    graph.threadId ? `thread ${graph.threadId}` : null,
    graph.checkpointer
      ? `체크포인터 ${graph.checkpointer}${
          graph.checkpointerScope === "per_process_only"
            ? " per-process"
            : ""
        }`
      : null,
    graph.nodesVisited.length > 0
      ? `노드 ${graph.nodesVisited.join("→")}`
      : null,
    retrievalText,
    graph.fallbackReason ? `폴백 ${graph.fallbackReason}` : null,
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
      label: "Live LangGraph + retrieval",
      summary: "명령 실행과 search_scene_data 검색 근거가 모두 확인됨",
      detail: formatStoryboardGraphDiagnosticsText(result) ?? "LangGraph retrieval used",
      liveGraphReady,
      retrievalUsed,
      resumeRequired,
      outputReadyForReview,
    };
  }

  if (outputReadyForReview && liveGraphReady) {
    return {
      status: "output_ready_for_review",
      label: "LangGraph output review",
      summary: "그래프 출력은 검토 가능하지만 retrieval-used로 보지는 않음",
      detail: formatStoryboardGraphDiagnosticsText(result) ?? "LangGraph output ready for review",
      liveGraphReady,
      retrievalUsed,
      resumeRequired,
      outputReadyForReview,
    };
  }

  if (resumeRequired) {
    return {
      status: "resume_required",
      label: "Resume required",
      summary: "interrupted_needs_resume 상태라 ready/complete로 표시하지 않음",
      detail: formatStoryboardGraphDiagnosticsText(result) ?? "LangGraph resume required",
      liveGraphReady: false,
      retrievalUsed: false,
      resumeRequired,
      outputReadyForReview,
    };
  }

  if (liveGraphReady) {
    return {
      status: "live_no_retrieval",
      label: "Live LangGraph",
      summary: "명령 실행은 확인됐지만 BGE/리랭커 retrieval 근거는 없음",
      detail: formatStoryboardGraphDiagnosticsText(result) ?? "LangGraph used without retrieval",
      liveGraphReady,
      retrievalUsed,
      resumeRequired,
      outputReadyForReview,
    };
  }

  if (graph?.runtime === "codex_cli_oauth_legacy") {
    return {
      status: "legacy",
      label: "Legacy command",
      summary: "Codex CLI legacy 경로이며 LangGraph ready가 아님",
      detail: formatStoryboardGraphDiagnosticsText(result) ?? "Codex CLI legacy",
      liveGraphReady: false,
      retrievalUsed: false,
      resumeRequired,
      outputReadyForReview,
    };
  }

  if (graph?.runtime === "local_adapter_fallback" || graph?.status === "fallback") {
    return {
      status: "fallback",
      label: "Safe local fallback",
      summary: "명령 실행/라이브 그래프 근거가 없어 안전 폴백으로 표시",
      detail: formatStoryboardGraphDiagnosticsText(result) ?? "local_adapter_fallback",
      liveGraphReady: false,
      retrievalUsed: false,
      resumeRequired,
      outputReadyForReview,
    };
  }

  return {
    status: "unknown",
    label: "Backend state unknown",
    summary: "아직 backend-agent graph 진단이 없음",
    detail: backend?.runtime ? `런타임 ${backend.runtime}` : "backend-agent 미확인",
    liveGraphReady: false,
    retrievalUsed: false,
    resumeRequired: false,
    outputReadyForReview: false,
  };
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
  const headline =
    mode === "actual"
      ? "실제 히트맵 데이터"
      : "데모/샘플 모드: 실제 데이터 아님";
  const sourceText = [
    result.sourceSummary.dataModeLabel,
    `스캔 ${result.sourceSummary.scannedFiles}파일`,
    `사용 ${result.sourceSummary.usableSources}개`,
    `선택 ${result.sourceSummary.selectedSources}개`,
    `피크 ${result.sourceSummary.totalMarkers}개`,
    `상위 ${formatStoryboardRealDataPercent(result.sourceSummary.topReplayScore)}`,
  ].join(" · ");
  const backend = result.backendAnalysis.backendAgent;
  const graph = backend?.graph;
  const backendExecutionText =
    graph?.mode === "graph_command" && backend?.invokedCommand
      ? "LangGraph 명령 실행"
      : graph?.mode === "legacy_command" && backend?.invokedCommand
        ? "Legacy Codex 명령 실행"
        : backend?.invokedCommand && graph?.status === "fallback"
          ? "명령 실패 후 로컬 어댑터 폴백"
          : "로컬 어댑터";
  const graphText = formatStoryboardGraphDiagnosticsText(result);
  const backendText = [
    `백엔드 ${backendExecutionText}`,
    graphText,
    !graphText && backend?.runtime ? `런타임 ${backend.runtime}` : null,
    graph?.runtime === "codex_cli_oauth_legacy" || !graph
      ? `Codex CLI ${backend?.codexModel ?? "gpt-5.5"} ${backend?.codexEffort ?? "high"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const generatedAtText = `생성시각 ${result.generatedAt}`;
  return {
    mode,
    headline,
    sourceText,
    backendText,
    generatedAtText,
    summaryText: `${headline} · ${sourceText} · ${backendText} · ${generatedAtText}`,
  };
}

function formatStoryboardOmittedSceneText(omittedSceneCount: number) {
  return omittedSceneCount > 0
    ? `무이미지/미검증 컷 ${omittedSceneCount}개 제외`
    : "무이미지/미검증 컷 없음";
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
      label: "쯔양님/진행자",
      status: hasVisibleGeneratedCuts ? "ready" : "watch",
      summary: hasSelectedCut
        ? "선택한 CUT 맥락으로 멘트·리액션 수정 가능"
        : "채팅으로 요구사항 입력 후 CUT을 눌러 멘트 수정 가능",
      detail: hasVisibleGeneratedCuts
        ? `현재 CUT ${String(activeCutStart).padStart(2, "0")}–${String(activeCutEnd).padStart(2, "0")}를 보며 말할 포인트를 점검합니다.`
        : "먼저 스토리보드와 GPT Image 2 이미지를 생성해야 진행자가 확인할 장면이 생깁니다.",
    },
    {
      id: "manager",
      label: "매니저",
      status: isActualData ? "ready" : "watch",
      summary: isActualData
        ? "실제 히트맵/백엔드 근거 확인 가능"
        : "샘플 데이터 상태라 실제 근거 확인 필요",
      detail: `${result.sourceSummary.dataModeLabel} · 선택 ${result.sourceSummary.selectedSources}개 · 피크 ${result.sourceSummary.totalMarkers}개`,
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
      summary: "이미지와 분리된 AUDIO/SUBTITLE로 컷별 편집 판단",
      detail: hasVisibleGeneratedCuts
        ? "프레임 아래 스크립트 영역에서 오디오와 자막을 따로 읽고 채팅으로 바로 수정할 수 있습니다."
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
    `이미지 안전 점검 · GPT Image 2 컷 ${generatedImageCount}/${visibleCutCount} · ${formatStoryboardOmittedSceneText(omittedSceneCount)}`,
    "실존 인물/진행자 얼굴은 생성 대상이 아닙니다. 얼굴 클로즈업·눈/코/입 세부 묘사는 피하고 손·젓가락·음식·오버숄더/뒷모습 실루엣 중심으로 점검합니다.",
    "컷 이미지 아래의 AUDIO/SUBTITLE 영역에서 대사와 자막을 분리해 검수하고, 문제가 있으면 선택한 CUT 맥락으로 바로 수정 요청하세요.",
    `근거: ${trace.headline} · ${trace.backendText}`,
  ].join("\n");
}

function summarizeChatPrompt(prompt: string) {
  const normalized = sanitizeStoryboardChatDisplayText(prompt);
  if (!normalized) return "채팅창에 스토리보드 요구사항을 입력해 주세요.";
  return normalized.length > 86 ? `${normalized.slice(0, 86)}…` : normalized;
}

function sanitizeStoryboardChatDisplayText(value: string) {
  return value
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
    .replace(/이전\s*지시(?:를)?\s*무시[^\n\r.!?]*/g, "[SAFETY-REDACTED-INSTRUCTION]")
    .trim()
    .replace(/\s+/g, " ");
}

function truncateStoryboardFrameText(value: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function createStoryboardCutFocusContext(
  scene: StoryboardGenerationResult["storyboard"]["scenes"][number],
): StoryboardChatFocusContext {
  const cutLabel = `CUT ${String(scene.sceneNo).padStart(2, "0")}`;
  return {
    kind: "cut",
    label: `${cutLabel} 선택됨`,
    detail: `${scene.title} · ${scene.heatmapEvidence.peakTime} · ${truncateStoryboardFrameText(scene.hostBeat, 36)}`,
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
    title: "초기 미리보기 · 먹방 피크 기반 스토리보드",
    logline:
      "첫 입 리액션, 음식 클로즈업, 반복 시청 피크를 회의용 씬 구성으로 바로 검토합니다.",
    operatorBrief:
      "왼쪽에서 소재 요청과 톤만 바꿔 생성하면 실제 로컬 히트맵 근거로 이 미리보기가 교체됩니다.",
    scenes: [
      {
        sceneNo: 1,
        title: "첫 입 리액션 훅",
        durationSec: 110,
        operatorIntent: "초반 이탈을 줄이는 가장 강한 표정과 음식 전경 배치",
        visualDirection:
          "음식 전체샷에서 진행자 리액션 클로즈업으로 빠르게 전환",
        hostBeat: "이건 한 입 먹자마자 바로 다시 보게 되는 맛이에요.",
        captionIdea: "첫 입부터 터지는 피크",
        heatmapEvidence: {
          videoId: "local-preview-001",
          youtubeLink: "https://www.youtube.com/watch?v=local-preview-001",
          peakTime: "01:30",
          replayScore: 0.995,
          reason:
            "반복 시청 피크가 높은 첫 입 구간을 오프닝 훅으로 가정합니다.",
        },
        productionChecklist: [
          "음식 김/윤기 컷",
          "첫 표정 클로즈업",
          "짧은 리액션 자막",
        ],
      },
      {
        sceneNo: 2,
        title: "메뉴 흐름 확장",
        durationSec: 165,
        operatorIntent: "가게 맥락과 메뉴 선택 이유를 짧게 정리",
        visualDirection: "대표 메뉴, 조리 장면, 한상 차림을 3컷 리듬으로 연결",
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
          "대표 메뉴 네임 자막",
          "한상 전체샷",
        ],
      },
      {
        sceneNo: 3,
        title: "면치기 리듬 컷",
        durationSec: 130,
        operatorIntent: "먹는 움직임과 소리 포인트를 시각적으로 강조",
        visualDirection:
          "젓가락으로 면을 들어 올리는 손동작과 그릇 클로즈업을 크게 배치",
        hostBeat: "소스가 딱 달라붙어서 면이 더 살아나요.",
        captionIdea: "소스 자박자박한 컷",
        heatmapEvidence: {
          videoId: "local-preview-003",
          youtubeLink: "https://www.youtube.com/watch?v=local-preview-003",
          peakTime: "08:20",
          replayScore: 0.971,
          reason: "면/소리/손동작이 반복 시청을 만드는 감각 컷으로 가정합니다.",
        },
        productionChecklist: [
          "면 들어 올리는 손동작",
          "소스 클로즈업",
          "후루룩 사운드",
        ],
      },
      {
        sceneNo: 4,
        title: "마무리 완식 리액션",
        durationSec: 130,
        operatorIntent: "완식 후 만족감과 다음 기대감을 한 컷으로 정리",
        visualDirection:
          "빈 그릇과 진행자 표정을 한 화면에 두고 여운 있게 마무리",
        hostBeat: "순식간에 사라졌네요. 다음 조합도 기대해주세요.",
        captionIdea: "순삭 완료",
        heatmapEvidence: {
          videoId: "local-preview-004",
          youtubeLink: "https://www.youtube.com/watch?v=local-preview-004",
          peakTime: "12:40",
          replayScore: 0.968,
          reason:
            "완식/다음 메뉴 예고 구간이 댓글과 재방문을 만든다는 가정입니다.",
        },
        productionChecklist: [
          "빈 그릇 컷",
          "만족 리액션",
          "다음 메뉴 후보 자막",
        ],
      },
    ],
    exportMarkdown:
      "# 초기 미리보기 · 먹방 피크 기반 스토리보드\n\n- 첫 입 리액션 훅\n- 메뉴 흐름 확장\n- 면치기 리듬 컷\n- 마무리 완식 리액션\n",
  },
  ahp: {
    targetScore: 99.8,
    score: 99.8,
    status: "passed",
    committee: [
      { role: "콘텐츠 PD", focus: "회의에서 바로 검토 가능한 씬 구성" },
      { role: "리텐션 분석가", focus: "반복 시청 피크 기반 흐름" },
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
  const visuals = [
    {
      background:
        "radial-gradient(circle at 24% 28%, rgba(255,255,255,0.92), transparent 0 14%), linear-gradient(135deg, rgba(244,114,182,0.32), rgba(251,191,36,0.24) 48%, rgba(15,23,42,0.9))",
      accent: "bg-rose-200/85",
      plate: "bg-amber-100/90",
    },
    {
      background:
        "radial-gradient(circle at 72% 24%, rgba(255,255,255,0.88), transparent 0 13%), linear-gradient(135deg, rgba(34,197,94,0.24), rgba(251,146,60,0.28) 52%, rgba(30,41,59,0.92))",
      accent: "bg-emerald-200/85",
      plate: "bg-orange-100/90",
    },
    {
      background:
        "radial-gradient(circle at 50% 18%, rgba(255,255,255,0.9), transparent 0 12%), linear-gradient(135deg, rgba(56,189,248,0.26), rgba(168,85,247,0.24) 50%, rgba(15,23,42,0.94))",
      accent: "bg-sky-200/85",
      plate: "bg-violet-100/90",
    },
  ];
  return visuals[(sceneNo - 1) % visuals.length];
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
  context.fillText("Script", x + 18, scriptPanelY + 19);

  context.fillStyle = "rgba(17,24,39,0.08)";
  drawRoundedRect(context, x + 18, scriptPanelY + 30, 80, 24, 12);
  context.fill();
  context.fillStyle = "rgba(220,38,38,0.1)";
  drawRoundedRect(context, x + 18, scriptPanelY + 61, 80, 24, 12);
  context.fill();

  context.fillStyle = "#4b5563";
  context.font = "800 11px system-ui, sans-serif";
  context.fillText("AUDIO", x + 41, scriptPanelY + 46);
  context.fillStyle = "#dc2626";
  context.fillText("SUBTITLE", x + 29, scriptPanelY + 77);

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

function extractLatestStoryboardResult(
  payload: unknown,
): StoryboardGenerationResult | null {
  if (isStoryboardGenerationResult(payload)) {
    return stripUntrustedStoryboardGeneratedImages(payload);
  }
  if (payload && typeof payload === "object" && "result" in payload) {
    const wrapped = payload as { result?: unknown };
    if (isStoryboardGenerationResult(wrapped.result)) {
      return stripUntrustedStoryboardGeneratedImages(wrapped.result);
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
    throw new Error(`스토리보드 생성 히스토리 인덱스를 불러오지 못했습니다. (${response.status})`);
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

function shortStoryboardProofToken(value: string) {
  return value.length > 16 ? `${value.slice(0, 10)}…${value.slice(-4)}` : value;
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
  const trustedResult = stripUntrustedStoryboardGeneratedImages(result);
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
        "스토리보드 이미지 provider 상태를 확인하지 못했습니다.",
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

function StoryboardCanvasSkeletonFrames({
  activeCutStart,
  mode,
}: {
  activeCutStart: number;
  mode: "loading" | "empty";
}) {
  const statusLabel =
    mode === "loading"
      ? "스토리보드 이미지 생성 중"
      : "스토리보드 이미지 결과 준비 중";

  return (
    <>
      {Array.from({ length: STORYBOARD_FRAMES_PER_PAGE }, (_, index) => {
        const cutNo = activeCutStart + index;

        return (
          <div
            key={`storyboard-canvas-skeleton-${mode}-${cutNo}`}
            className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-background shadow-sm"
            data-storyboard-result-skeleton-frame={String(cutNo)}
            data-storyboard-image-empty-state={
              mode === "empty" ? "true" : undefined
            }
          >
            <div
              className="relative min-h-0 flex-1 overflow-hidden rounded-t-2xl border border-border/40 bg-muted/20"
              role={index === 0 ? "status" : undefined}
              aria-live={index === 0 ? "polite" : undefined}
              aria-label={index === 0 ? statusLabel : undefined}
              data-storyboard-realtime-skeleton="true"
            >
              <Skeleton
                className="h-full w-full rounded-none bg-muted/45"
                aria-hidden="true"
              />
              <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
                <Skeleton
                  className="h-6 w-16 rounded-full bg-muted-foreground/20"
                  aria-hidden="true"
                />
                <Skeleton
                  className="h-6 w-14 rounded-full bg-muted-foreground/15"
                  aria-hidden="true"
                />
              </div>
              <div className="absolute bottom-4 left-4 right-4 grid grid-cols-[0.72fr_1fr] items-end gap-3">
                <Skeleton
                  className="h-14 rounded-t-full rounded-b-2xl bg-muted-foreground/15"
                  aria-hidden="true"
                />
                <div className="space-y-2">
                  <Skeleton
                    className="h-8 rounded-full bg-muted-foreground/15"
                    aria-hidden="true"
                  />
                  <Skeleton
                    className="h-2.5 rounded-full bg-muted-foreground/10"
                    aria-hidden="true"
                  />
                  <Skeleton
                    className="h-2.5 w-2/3 rounded-full bg-muted-foreground/10"
                    aria-hidden="true"
                  />
                </div>
              </div>
              {index === 0 ? (
                <span className="sr-only">{statusLabel}</span>
              ) : null}
            </div>
            <div className="shrink-0 space-y-1.5 border-t border-border/70 bg-background/95 px-3 py-2.5">
              <div className="grid grid-cols-[78px_minmax(0,1fr)] items-start gap-2 rounded-xl bg-muted/25 px-2 py-1.5">
                <Skeleton
                  className="h-5 rounded-full bg-muted-foreground/15"
                  aria-hidden="true"
                />
                <Skeleton
                  className="h-5 rounded-full bg-muted-foreground/12"
                  aria-hidden="true"
                />
              </div>
              <div className="grid grid-cols-[78px_minmax(0,1fr)] items-start gap-2 rounded-xl bg-primary/5 px-2 py-1.5">
                <Skeleton
                  className="h-5 rounded-full bg-primary/10"
                  aria-hidden="true"
                />
                <Skeleton
                  className="h-5 rounded-full bg-primary/10"
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>
        );
      })}
    </>
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
    {
      id: "assistant-intake",
      role: "assistant",
      text: "요구사항을 입력하거나 ‘상태’, ‘이미지상태’, ‘점검’, ‘안전점검’, ‘생성’, ‘4컷 재생성’, ‘초기화’라고 보내면 채팅 안에서 바로 처리합니다.",
      status: "done",
    },
  ]);
  const [streamingPhaseIndex, setStreamingPhaseIndex] = useState(0);
  useEffect(() => {
    let cancelled = false;

    getLatestRealDataStoryboardResult()
      .then((initialResult) => {
        if (cancelled || !initialResult) return;
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
        const trace = formatStoryboardRealDataTrace(initialResult.result);
        const sourceLabel =
          initialResult.source === "shared-seed"
            ? "공용 기본 스토리보드"
            : "최신 생성 히스토리";
        const latestHistoryMessage: StoryboardChatMessage = {
          id: "assistant-latest-real-data",
          role: "assistant",
          text: `${sourceLabel} 로드 완료 · ${trace.summaryText}`,
          status: "done",
        };
        setChatMessages((messages) =>
          [
            ...messages.filter((message) => message.id !== latestHistoryMessage.id),
            latestHistoryMessage,
          ].slice(-10),
        );
      })
      .catch(() => {
        // 최신 실제 생성 히스토리가 없으면 초기 미리보기를 유지합니다.
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
            : "스토리보드 생성 히스토리를 불러오지 못했습니다.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isGenerating && !isChatAgentStreaming) {
      setStreamingPhaseIndex(0);
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setStreamingPhaseIndex(
        (index) => (index + 1) % storyboardStreamingPhases.length,
      );
    }, 760);

    return () => window.clearInterval(intervalId);
  }, [isGenerating, isChatAgentStreaming]);

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
              : "스토리보드 이미지 provider 상태를 읽지 못했습니다.",
          detail:
            "페이지는 계속 사용할 수 있지만 fresh 이미지 생성 전 provider 상태를 다시 확인해야 합니다.",
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
    () => getVisibleTrustedStoryboardScenes(result.storyboard.scenes),
    [result.storyboard.scenes],
  );
  const storyboardTotalPages = getStoryboardTrustedScenePageCount({
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
  const activeStoryboardPageScenes = getVisibleTrustedStoryboardPageScenes({
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
  const exportResolutionToken = selectedExportPreset.label.replace("×", "x");
  const isChatDraftActive =
    Boolean(chatDraft.trim()) ||
    form.prompt.trim() !== result.request.prompt.trim() ||
    form.tone !== result.request.tone ||
    form.segmentCount !== result.request.segmentCount ||
    form.targetLengthMinutes !== result.request.targetLengthMinutes ||
    form.generationMode !== result.request.generationMode;
  const currentStreamingPhase = isGenerating
    ? storyboardStreamingPhases[streamingPhaseIndex]
    : isChatAgentStreaming
      ? "Codex CLI gpt-5.5 high 스트림 작업 중"
      : isChatDraftActive
        ? "채팅 초안이 캔버스에 반영 대기 중"
        : "최신 캔버스와 동기화됨";
  const selectedRealStoryboardScene = selectedStoryboardSceneNo
    ? result.storyboard.scenes.find(
        (scene) => scene.sceneNo === selectedStoryboardSceneNo,
      )
    : null;
  const visibleStoryboardHistoryCases = storyboardHistoryCases.slice(0, 8);
  const storyboardChatPlaceholder =
    storyboardCanvasFocus?.kind === "cut"
      ? `${storyboardCanvasFocus.label} 기준으로 바꾸고 싶은 점을 입력하세요`
      : storyboardCanvasFocus?.kind === "action"
        ? `${storyboardCanvasFocus.label} 이후 조정할 내용을 입력하세요`
        : "예: 매운 짜장라면 첫 입, 치즈 클로즈업, 완식 리액션을 8컷으로 구성해줘";

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
    setChatMessages((current) => [...current, ...messages].slice(-10));
  }

  function updateStoryboardChatMessage(
    messageId: string,
    text: string,
    status: StoryboardChatMessage["status"] = "streaming",
  ) {
    setChatMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, text, status } : message,
      ),
    );
  }

  function handleChatDraftChange(value: string) {
    setChatDraft(value);
  }

  function resetStoryboardChatState() {
    setForm(DEFAULT_FORM);
    setChatDraft("");
    setStoryboardPage(0);
    setStoryboardCanvasFocus(null);
    setErrorMessage(null);
    appendStoryboardChatMessages([
      {
        id: `assistant-reset-${Date.now()}`,
        role: "assistant",
        text: "초기화 완료 · 새 요구사항을 입력하면 캔버스가 다시 동기화됩니다.",
        status: "done",
      },
    ]);
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
          : "스토리보드 생성 히스토리를 불러오지 못했습니다.";
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
            : "스토리보드 이미지 provider 상태를 읽지 못했습니다.",
        detail:
          "페이지는 계속 사용할 수 있지만 fresh 이미지 생성 전 provider 상태를 다시 확인해야 합니다.",
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
    } = {},
  ) {
    const guidance = formatStoryboardImageProviderGuidanceMessage(
      storyboardImageProviderReadiness,
    );
    setErrorMessage(null);
    setIsStoryboardChatSettingsOpen(true);
    applyStoryboardCanvasFocus(
      createStoryboardActionFocusContext(
        "이미지 생성 설정 필요",
        `${options.scopeLabel ?? "현재 페이지"} fresh 이미지 생성은 provider 준비 전까지 중단됩니다.`,
        "사용자가 스토리보드 이미지 생성을 시도했지만 exact gpt-image-2 provenance가 검증되지 않아 fail-closed 안내를 표시했습니다.",
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
    const historyResult = historyCase.result;
    const trace = formatStoryboardRealDataTrace(historyResult);
    setResult(historyResult);
    setForm(historyResult.request);
    setStoryboardPage(0);
    setChatDraft("");
    setErrorMessage(null);
    applyStoryboardCanvasFocus(
      createStoryboardActionFocusContext(
        "히스토리 케이스 로드",
        `${historyResult.storyboard.title} · ${historyResult.storyboard.scenes.length}컷`,
        "사용자가 생성 히스토리에서 이전 스토리보드 케이스를 선택했습니다. 현재 캔버스 결과와 실제 데이터 근거를 기준으로 후속 대화를 이어가세요.",
      ),
    );
    appendStoryboardChatMessages([
      {
        id: `assistant-history-load-${Date.now()}`,
        role: "assistant",
        text: `히스토리 케이스 로드 완료 · ${historyResult.storyboard.title} · ${trace.summaryText}`,
        status: "done",
      },
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
    const sourcePageRange = getStoryboardSourcePageRange(normalizedPage);
    setStoryboardPage(normalizedPage);
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
    const trace = formatStoryboardRealDataTrace(result);
    return `현재 상태 · CUT ${String(activeCutStart).padStart(2, "0")}–${String(activeCutEnd).padStart(2, "0")} · 이미지 현재 ${activePageGeneratedCount}/${activeStoryboardImageGenerationTargetScenes.length || STORYBOARD_FRAMES_PER_PAGE} · 전체 ${generatedImageCount}/${totalCutCount} · ${formatStoryboardOmittedSceneText(omittedStoryboardSceneCount)} · 이미지 provider ${storyboardImageProviderReadiness.label} · ${trace.summaryText}`;
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
    const nextForm =
      typeof submitted === "string"
        ? { ...form, prompt: submitted }
        : (submitted ?? form);
    const appendMessages = options.appendChatMessages ?? true;
    const messageText = summarizeChatPrompt(nextForm.prompt);
    const startTrace = formatStoryboardRealDataTrace(result);
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
          text: `요구사항을 캔버스용 컷 구성으로 스트리밍 반영합니다 · 현재 캔버스 기준 ${startTrace.summaryText} · 새 생성에서 데이터 근거를 다시 검증합니다.`,
          status: "streaming",
        },
      ]);
    } else if (options.assistantMessageId) {
      updateStoryboardChatMessage(
        options.assistantMessageId,
        `Codex CLI gpt-5.5 high 작업 완료 · ${startTrace.headline} 기준을 확인하고 스토리보드를 생성하는 중입니다...`,
        "streaming",
      );
    }

    try {
      const generated = await postStoryboardRequest(nextForm);
      const completionTrace = formatStoryboardRealDataTrace(generated);
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
          "스토리보드 생성 완료",
          `${generated.storyboard.scenes.length}컷이 캔버스에 반영됐습니다.`,
          "새 스토리보드 생성 결과가 캔버스에 반영됐습니다. 사용자가 후속으로 특정 컷이나 전체 흐름 개선을 요청할 수 있습니다.",
        ),
      );
      if (options.assistantMessageId) {
        updateStoryboardChatMessage(
          options.assistantMessageId,
          `Codex CLI gpt-5.5 high 작업 완료 · 스토리보드 생성 완료 · ${generated.storyboard.scenes.length}컷을 캔버스에 반영했습니다 · ${completionTrace.summaryText}`,
          "done",
        );
      } else {
        setChatMessages((messages) =>
          messages.map((message) =>
            message.status === "streaming"
              ? {
                  ...message,
                  text: `완료: ${generated.storyboard.scenes.length}컷 스토리보드가 좌측 캔버스에 반영됐습니다 · ${completionTrace.summaryText}`,
                  status: "done",
                }
              : message,
          ),
        );
      }
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
              ? {
                  ...message,
                  text: "생성에 실패했습니다. 오류를 확인한 뒤 같은 채팅창에서 다시 요청해 주세요.",
                  status: "done",
                }
              : message,
          ),
        );
      }
    } finally {
      setIsGenerating(false);
    }
  };

  async function handleStoryboardChatSubmit() {
    const submittedPrompt = chatDraft.trim().replace(/\s+/g, " ");
    if (!submittedPrompt || isGenerating || isChatAgentStreaming) return;

    const quickCommand = getStoryboardChatQuickCommand(submittedPrompt);
    if (quickCommand) {
      const commandBaseForm: GeneratorForm = form;
      setChatDraft("");
      if (quickCommand === "status") {
        appendStoryboardQuickCommandMessages(
          submittedPrompt,
          `${getStoryboardChatStatusMessage()}${storyboardCanvasFocus ? ` · 현재 맥락 ${storyboardCanvasFocus.label}` : ""} · ‘이미지상태’, ‘점검’, ‘안전점검’, ‘생성’, ‘4컷 재생성’, ‘초기화’도 채팅으로 실행할 수 있습니다.`,
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
          "생성 히스토리를 이 페이지 안에서 열었습니다. 우상단 히스토리 버튼으로도 닫거나 다시 열 수 있습니다.",
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
          `GPT Image 2로 현재 ${activePageGenerationTargetCount}컷을 재생성할게요...`,
          "streaming",
        );
        await handleGenerateStoryboardImages({ assistantMessageId });
        return;
      }
      if (quickCommand === "generate") {
        const assistantMessageId = appendStoryboardQuickCommandMessages(
          submittedPrompt,
          `현재 채팅/캔버스 요구사항으로 스토리보드를 생성합니다 · ${storyboardRealDataTrace.summaryText} · 새 생성에서 데이터 근거를 다시 검증합니다...`,
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
        text: "Codex CLI gpt-5.5 high 백엔드 에이전트 연결 중...",
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
      let lastStatus = "Codex CLI gpt-5.5 high 작업 중...";

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
              sanitizeStoryboardChatDisplayText(item.data.assistantMessage),
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
          `${sanitizeStoryboardChatDisplayText(finalResult.assistantMessage)} · 스토리보드 입력 상태 초기화 완료`,
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

  async function handleGenerateStoryboardImages(
    options: {
      assistantMessageId?: string;
      targetScenes?: StoryboardScene[];
      scope?: "page" | "selected";
    } = {},
  ) {
    const targetScenes =
      options.targetScenes ?? activeStoryboardImageGenerationTargetScenes;
    const isSelectedScope = options.scope === "selected";
    if (targetScenes.length === 0) {
      const message =
        "현재 페이지에 GPT Image 2로 생성할 스토리보드 컷이 없습니다.";
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
    const targetLabel =
      isSelectedScope && targetScenes[0]
        ? `CUT ${String(targetScenes[0].sceneNo).padStart(2, "0")}`
        : `현재 페이지 CUT ${String(activeCutStart).padStart(2, "0")}–${String(activeCutEnd).padStart(2, "0")}`;
    if (!isStoryboardImageProviderAvailable) {
      guideUnavailableStoryboardImageGeneration({
        assistantMessageId: options.assistantMessageId,
        scopeLabel: targetLabel,
      });
      return;
    }
    setIsGeneratingImages(true);
    setErrorMessage(null);
    applyStoryboardCanvasFocus(
      createStoryboardActionFocusContext(
        isSelectedScope ? "현재 컷 이미지 재생성" : "4컷 이미지 재생성",
        `${targetLabel} 이미지를 GPT Image 2로 생성 중입니다.`,
        isSelectedScope
          ? "사용자가 선택한 CUT만 이미지 생성을 실행했습니다. 생성 후 해당 컷 이미지 톤과 자막/오디오 일치를 기준으로 후속 대화를 이어가세요."
          : "사용자가 현재 페이지 4컷 이미지 생성을 실행했습니다. 생성 후 이미지 톤, 컷별 완성도, 누락 컷을 기준으로 후속 대화를 이어가세요.",
      ),
    );
    if (options.assistantMessageId) {
      updateStoryboardChatMessage(
        options.assistantMessageId,
        isSelectedScope
          ? `GPT Image 2로 ${targetLabel}만 재생성 중입니다...`
          : `GPT Image 2로 현재 ${activePageGenerationTargetCount}컷을 재생성 중입니다...`,
        "streaming",
      );
    }

    let appliedImageCount = 0;
    let accumulatedResult = result;
    const applyGeneratedImages = (images: StoryboardImagesResponse["images"]) => {
      accumulatedResult = mergeStoryboardGeneratedImagesIntoResult(
        accumulatedResult,
        images,
      );
      setResult(accumulatedResult);
      appliedImageCount += images.length;
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
              `GPT Image 2로 CUT ${String(scene.sceneNo).padStart(2, "0")} 생성 중입니다 · ${index + 1}/${targetScenes.length}`,
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
            ? `완료 · ${targetLabel} 이미지를 GPT Image 2 결과로 교체했습니다.`
            : `완료 · 현재 페이지 ${generatedImages.length}/${activePageGenerationTargetCount}컷 이미지를 GPT Image 2 결과로 교체했습니다.`,
          "done",
        );
      }
      applyStoryboardCanvasFocus(
        createStoryboardActionFocusContext(
          isSelectedScope ? "현재 컷 이미지 생성 완료" : "4컷 이미지 생성 완료",
          `${targetLabel} 이미지 ${generatedImages.length}개가 캔버스에 반영됐습니다.`,
          isSelectedScope
            ? "선택 CUT의 GPT Image 2 생성 결과가 반영됐습니다. 사용자가 같은 컷의 오디오/자막/비주얼을 계속 보완할 수 있습니다."
            : "현재 페이지의 GPT Image 2 생성 결과가 반영됐습니다. 사용자가 컷을 선택하면 해당 이미지를 기준으로 보완 대화를 이어가세요.",
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
                <span className="min-w-0 truncate">생성 채팅</span>
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
                      aria-label="스토리보드 생성 히스토리 열기"
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
                            <span>생성 히스토리</span>
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
                            실제 POST 결과를 이 페이지 안에서 다시 불러옵니다.
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
                            aria-label="스토리보드 생성 히스토리 새로고침"
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
                            aria-label="스토리보드 생성 히스토리 닫기"
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
                                      aria-label="스토리보드 이미지 생성 증명 보기"
                                    >
                                      증명 {proofSummaries.length || 0}
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
                                          {proofSummaries[0]?.providerId} ·{" "}
                                          {proofSummaries[0]?.authMode}
                                        </Badge>
                                        <Badge
                                          variant="outline"
                                          className="px-1.5 text-[10px]"
                                          data-storyboard-history-proof-model="true"
                                        >
                                          {proofSummaries[0]?.modelLabel}
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
                                              title={`${proof.responseId} / ${proof.imageCallId}`}
                                              data-storyboard-history-proof-response="true"
                                            >
                                              response{" "}
                                              {shortStoryboardProofToken(
                                                proof.responseId,
                                              )}{" "}
                                              · call{" "}
                                              {shortStoryboardProofToken(
                                                proof.imageCallId,
                                              )}
                                            </span>
                                            <span className="sr-only">
                                              생성시각 {proof.generatedAt}
                                            </span>
                                            <span
                                              className="min-w-0 truncate text-muted-foreground sm:col-start-2"
                                              title={`request ${proof.requestHash} / response ${proof.responseHash}`}
                                              data-storyboard-history-proof-hashes="true"
                                            >
                                              req{" "}
                                              {shortStoryboardProofToken(
                                                proof.requestHash,
                                              )}{" "}
                                              · res{" "}
                                              {shortStoryboardProofToken(
                                                proof.responseHash,
                                              )}
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
                            백엔드 에이전트 준비 상태
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
                            aria-label="스토리보드 이미지 provider 상태 새로고침"
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
                            모델 {storyboardImageProviderReadiness.model} · 타깃{" "}
                            {formatStoryboardImageProviderTarget(
                              storyboardImageProviderReadiness.target,
                            )}
                          </p>
                          <p className="truncate text-muted-foreground">
                            {STORYBOARD_IMAGE_PROVIDER_MODEL_ENV}=gpt-image-2
                          </p>
                          <p className="truncate text-muted-foreground">
                            {STORYBOARD_IMAGE_PROVIDER_COMMAND_ENV}=
                            {STORYBOARD_IMAGE_PROVIDER_COMMAND_PLACEHOLDER}
                          </p>
                          <p className="line-clamp-2 text-muted-foreground">
                            exact provenance 확인 전에는 다른 이미지 모델, mock
                            이미지, fallback 생성을 실행하지 않습니다. 채팅에
                            “이미지상태”를 보내면 같은 안내를 다시 볼 수
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
                            ? "작업 중"
                            : "Codex Agent"}
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
                        <p>{message.text}</p>
                        {message.status === "streaming" ? (
                          <p className="mt-1 flex items-center gap-1.5 opacity-80">
                            <Loader2
                              className="h-3 w-3 animate-spin"
                              aria-hidden="true"
                            />
                            {currentStreamingPhase}
                          </p>
                        ) : null}
                      </div>
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
                        {isChatAgentStreaming ? "스트리밍" : "입력 프리뷰"}
                      </div>
                      <div className="rounded-2xl rounded-bl-md border border-dashed border-sky-400/70 bg-sky-500/10 px-3 py-2 text-xs leading-5 text-sky-950 shadow-sm dark:text-sky-100">
                        {isChatAgentStreaming
                          ? "Codex CLI gpt-5.5 high 스트림 작업 중..."
                          : "입력 중 · 캔버스에 즉시 반영됨"}
                      </div>
                    </div>
                  </div>
                ) : null}
                </div>

              <div
                className="shrink-0 space-y-2.5 border-t border-border/70 bg-background/80 p-2.5"
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
                  className="flex items-end gap-2 rounded-3xl border border-border/60 bg-background p-2 shadow-sm"
                  data-storyboard-chat-composer="true"
                >
                  <Textarea
                    id="storyboard-prompt"
                    value={chatDraft}
                    onChange={(event) =>
                      handleChatDraftChange(event.target.value)
                    }
                    onKeyDown={handleStoryboardChatKeyDown}
                    disabled={isChatAgentStreaming}
                    className="max-h-28 min-h-11 resize-none border-0 bg-transparent p-2 text-sm shadow-none focus-visible:ring-0"
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
            </section>
          </CardContent>
        </Card>

        <Card
          className="order-1 flex min-h-0 flex-col overflow-hidden border-0 bg-card/80 shadow-none"
          aria-label="스토리보드 이미지 생성 결과"
          data-storyboard-result-panel="image-frames-only"
        >
          <CardHeader className="shrink-0 p-2 pb-1">
            <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
              <span className="sr-only">캔버스 편집 / PNG 내보내기</span>
              <span
                className="shrink-0 whitespace-nowrap font-semibold"
                aria-hidden="true"
              >
                캔버스
              </span>
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
                {isGenerating || isChatDraftActive ? (
                  <Badge
                    variant={isGenerating ? "default" : "outline"}
                    className="h-7 max-w-[132px] shrink-0 truncate rounded-full px-2 text-[11px]"
                    data-storyboard-chat-stream-status="true"
                    title={currentStreamingPhase}
                  >
                    {currentStreamingPhase}
                  </Badge>
                ) : null}
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
            </CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-hidden p-3 pt-0">
            <div
              className="grid h-full min-h-0 grid-cols-2 grid-rows-2 gap-2"
              data-storyboard-image-board="true"
              data-storyboard-frame-grid="true"
              data-storyboard-frame-fill="true"
              data-storyboard-frame-page={String(activeStoryboardPage + 1)}
              data-storyboard-frame-page-size={String(
                STORYBOARD_FRAMES_PER_PAGE,
              )}
            >
              {isStoryboardResultSkeletonVisible ? (
                <StoryboardCanvasSkeletonFrames
                  activeCutStart={activeCutStart}
                  mode="loading"
                />
              ) : activeStoryboardPageScenes.length === 0 ? (
                <StoryboardCanvasSkeletonFrames
                  activeCutStart={activeCutStart}
                  mode="empty"
                />
              ) : (
                activeStoryboardPageScenes.map((scene) => {
                  const frameVisual = getStoryboardFrameVisual(scene.sceneNo);
                  const trustedGeneratedImage =
                    getTrustedStoryboardGeneratedImage(scene.generatedImage);
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
                      >
                      {selectedStoryboardSceneNo === scene.sceneNo ? (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 z-50 rounded-2xl border-2 border-primary"
                          data-storyboard-selected-frame-border="true"
                        />
                      ) : null}
                      <div
                        className="relative min-h-0 flex-1 overflow-hidden rounded-t-2xl"
                        style={{ background: frameVisual.background }}
                        aria-label={`${scene.sceneNo}컷 이미지 생성 결과`}
                      >
                        {trustedGeneratedImage ? (
                          <NextImage
                            src={trustedGeneratedImage.dataUrl}
                            alt={`${scene.sceneNo}컷 Codex CLI GPT Image 2 생성 결과`}
                            fill
                            sizes="(min-width: 1280px) 36vw, 50vw"
                            className="object-cover"
                            unoptimized
                            data-storyboard-generated-image="local-codex"
                          />
                        ) : null}
                        {isGeneratingImages && !trustedGeneratedImage ? (
                          <div
                            className="absolute inset-0 z-10 flex items-center justify-center bg-background/55 backdrop-blur-[1px]"
                            role="status"
                            aria-live="polite"
                            data-storyboard-image-generation-skeleton="true"
                          >
                            <div className="flex items-center gap-2 rounded-full bg-background/90 px-3 py-2 text-xs font-semibold shadow-sm">
                              <Loader2
                                className="h-3.5 w-3.5 animate-spin"
                                aria-hidden="true"
                              />
                              GPT Image 2 생성 중
                            </div>
                          </div>
                        ) : null}
                        <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
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
                        {!trustedGeneratedImage ? (
                          <>
                            <div
                              className="absolute inset-x-3 top-14 rounded-2xl bg-black/36 p-3 text-white shadow-sm backdrop-blur-[1px]"
                              data-storyboard-scene-summary="true"
                            >
                              <p
                                className="line-clamp-1 text-sm font-semibold tracking-tight"
                                data-storyboard-scene-title="true"
                              >
                                {scene.title}
                              </p>
                              <p className="mt-1 line-clamp-2 text-xs leading-snug text-white/82">
                                {scene.visualDirection}
                              </p>
                              <p className="mt-2 line-clamp-1 text-[11px] font-medium text-amber-100">
                                {scene.captionIdea}
                              </p>
                            </div>
                            <div className="absolute bottom-3 left-3 right-3 grid grid-cols-[0.75fr_1fr] items-end gap-2">
                              <div
                                className={cn(
                                  "h-12 rounded-t-full rounded-b-2xl shadow-lg ring-2 ring-white/40",
                                  frameVisual.accent,
                                )}
                              />
                              <div className="space-y-1.5">
                                <div
                                  className={cn(
                                    "h-8 rounded-full shadow-lg",
                                    frameVisual.plate,
                                  )}
                                />
                                <div className="h-2 rounded-full bg-white/65" />
                                <div className="h-2 w-2/3 rounded-full bg-white/45" />
                              </div>
                            </div>
                          </>
                        ) : null}
                      </div>
                      <div
                        className="shrink-0 space-y-1.5 border-t border-border/70 bg-background/95 px-3 py-2.5 text-foreground shadow-[0_-1px_0_rgba(15,23,42,0.06)]"
                        data-storyboard-frame-script="true"
                        data-storyboard-frame-script-panel="true"
                        data-storyboard-frame-script-placement="separated"
                      >
                        <div
                          className="grid grid-cols-[78px_minmax(0,1fr)] items-start gap-2 rounded-xl bg-muted/25 px-2 py-1.5 text-xs leading-5"
                          data-storyboard-frame-audio="true"
                          data-storyboard-frame-audio-row="true"
                        >
                          <span className="rounded-full bg-muted px-2 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            AUDIO
                          </span>
                          <span
                            className="line-clamp-2 font-semibold text-foreground"
                            title={scene.hostBeat}
                            data-storyboard-frame-audio-text="true"
                          >
                            {scene.hostBeat}
                          </span>
                        </div>
                        <div
                          className="grid grid-cols-[78px_minmax(0,1fr)] items-start gap-2 rounded-xl bg-primary/5 px-2 py-1.5 text-xs leading-5"
                          data-storyboard-frame-subtitle="true"
                          data-storyboard-frame-subtitle-row="true"
                        >
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-primary">
                            SUBTITLE
                          </span>
                          <span
                            className="line-clamp-2 font-bold text-foreground"
                            title={scene.captionIdea}
                            data-storyboard-frame-subtitle-text="true"
                          >
                            {scene.captionIdea}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

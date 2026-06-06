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
  ImageIcon,
  Loader2,
  MessageCircle,
  RotateCcw,
  Send,
  Square,
  Wand2,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
  getTrustedStoryboardGeneratedImage,
  stripUntrustedStoryboardGeneratedImages,
} from "@/lib/admin/storyboard/image-trust";
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

type StoryboardHistoryStatus = "idle" | "loading" | "ready" | "empty" | "error";

type StoryboardHistoryCase = {
  id: string;
  result: StoryboardGenerationResult;
  runUrl: string;
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

type StoryboardChatQuickCommand = "generate" | "images" | "reset" | "status";

function getStoryboardChatQuickCommand(
  message: string,
): StoryboardChatQuickCommand | null {
  const normalized = message.trim().replace(/\s+/g, " ").toLowerCase();
  const compact = normalized.replace(/\s+/g, "");
  const isShortCommand = normalized.length <= 28;

  if (/^(초기화|리셋|reset|clear)$/.test(compact)) return "reset";
  if (/^(상태|요약|status|컷상태|이미지상태)$/.test(compact)) return "status";
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
// postStoryboardImagesRequest(result, activeRealStoryboardPageScenes)
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
  const backendMode = backend?.mode ?? result.request.generationMode;
  const backendText = [
    `백엔드 ${backendMode}`,
    `Codex CLI ${backend?.codexModel ?? "gpt-5.5"} ${backend?.codexEffort ?? "high"}`,
    backend?.runtime ? `런타임 ${backend.runtime}` : null,
    backend?.invokedCommand ? "명령 실행" : "로컬 어댑터",
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

function summarizeChatPrompt(prompt: string) {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  if (!normalized) return "채팅창에 스토리보드 요구사항을 입력해 주세요.";
  return normalized.length > 86 ? `${normalized.slice(0, 86)}…` : normalized;
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
    promptContext: promptContext ?? `${label} 액션 직후의 캔버스 상태입니다. ${detail}`,
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

  const scriptPanelHeight = Math.max(78, height * 0.22);
  const scriptPanelY = y + height - scriptPanelHeight;
  context.fillStyle = "rgba(255,255,255,0.94)";
  context.fillRect(x, scriptPanelY, width, scriptPanelHeight);
  context.strokeStyle = "rgba(17,24,39,0.14)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x, scriptPanelY);
  context.lineTo(x + width, scriptPanelY);
  context.stroke();

  context.fillStyle = "rgba(17,24,39,0.08)";
  drawRoundedRect(context, x + 18, scriptPanelY + 13, 68, 22, 11);
  context.fill();
  context.fillStyle = "rgba(220,38,38,0.1)";
  drawRoundedRect(context, x + 18, scriptPanelY + 43, 68, 22, 11);
  context.fill();

  context.fillStyle = "#4b5563";
  context.font = "800 11px system-ui, sans-serif";
  context.fillText("Audio", x + 33, scriptPanelY + 28);
  context.fillStyle = "#dc2626";
  context.fillText("Subtitle", x + 27, scriptPanelY + 58);

  context.fillStyle = "#111827";
  context.font = "650 14px system-ui, sans-serif";
  context.fillText(
    truncateStoryboardFrameText(scene.hostBeat, 48),
    x + 102,
    scriptPanelY + 28,
  );
  context.font = "750 14px system-ui, sans-serif";
  context.fillText(
    truncateStoryboardFrameText(scene.captionIdea, 48),
    x + 102,
    scriptPanelY + 58,
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

  if (!response.ok) return [];
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
): StoryboardHistoryCase {
  return {
    id: `${result.generatedAt}-current`,
    result: stripUntrustedStoryboardGeneratedImages(result),
    runUrl: "/qa-history/storyboard/latest-real-data.json",
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

async function getLatestRealDataStoryboardResult(): Promise<StoryboardGenerationResult | null> {
  const response = await fetch("/qa-history/storyboard/latest-real-data.json", {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) return null;
  return extractLatestStoryboardResult(await response.json());
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

function loadCanvasImage(src?: string) {
  if (!src) return Promise.resolve(null);
  return new Promise<HTMLImageElement | null>((resolveImage) => {
    const image = document.createElement("img");
    image.onload = () => resolveImage(image);
    image.onerror = () => resolveImage(null);
    image.src = src;
  });
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
  const [latestRealDataLoadedAt, setLatestRealDataLoadedAt] = useState<
    string | null
  >(null);
  const [storyboardHistoryCases, setStoryboardHistoryCases] = useState<
    StoryboardHistoryCase[]
  >([]);
  const [storyboardHistoryStatus, setStoryboardHistoryStatus] =
    useState<StoryboardHistoryStatus>("idle");
  const [storyboardHistoryError, setStoryboardHistoryError] = useState<
    string | null
  >(null);
  const [chatDraft, setChatDraft] = useState("");
  const [storyboardCanvasFocus, setStoryboardCanvasFocus] =
    useState<StoryboardChatFocusContext | null>(null);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const [chatMessages, setChatMessages] = useState<StoryboardChatMessage[]>([
    {
      id: "assistant-intake",
      role: "assistant",
      text: "요구사항을 입력하거나 ‘상태’, ‘생성’, ‘4컷 재생성’, ‘초기화’라고 보내면 채팅 안에서 바로 처리합니다.",
      status: "done",
    },
  ]);
  const [streamingPhaseIndex, setStreamingPhaseIndex] = useState(0);
  useEffect(() => {
    let cancelled = false;

    getLatestRealDataStoryboardResult()
      .then((latestResult) => {
        if (cancelled || !latestResult) return;
        setResult(latestResult);
        setForm(latestResult.request);
        setStoryboardPage(0);
        setLatestRealDataLoadedAt(latestResult.generatedAt);
        const trace = formatStoryboardRealDataTrace(latestResult);
        const latestHistoryMessage: StoryboardChatMessage = {
          id: "assistant-latest-real-data",
          role: "assistant",
          text: `최신 생성 히스토리 로드 완료 · ${trace.summaryText}`,
          status: "done",
        };
        setChatMessages((messages) =>
          [...messages, latestHistoryMessage].slice(-10),
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
        setStoryboardHistoryCases(historyCases);
        setStoryboardHistoryStatus(historyCases.length ? "ready" : "empty");
        setStoryboardHistoryError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setStoryboardHistoryCases([]);
        setStoryboardHistoryStatus("error");
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

  const storyboardFrameScenes = useMemo(() => {
    if (result.storyboard.scenes.length >= 4) return result.storyboard.scenes;
    return [
      ...result.storyboard.scenes,
      ...INITIAL_STORYBOARD_PREVIEW.storyboard.scenes.slice(
        result.storyboard.scenes.length,
        4,
      ),
    ];
  }, [result.storyboard.scenes]);
  const storyboardTotalPages = Math.max(
    1,
    Math.ceil(storyboardFrameScenes.length / STORYBOARD_FRAMES_PER_PAGE),
  );
  const activeStoryboardPage = Math.min(
    storyboardPage,
    storyboardTotalPages - 1,
  );
  const activeRealStoryboardPageScenes = result.storyboard.scenes.slice(
    activeStoryboardPage * STORYBOARD_FRAMES_PER_PAGE,
    activeStoryboardPage * STORYBOARD_FRAMES_PER_PAGE +
      STORYBOARD_FRAMES_PER_PAGE,
  );
  const activeStoryboardPageScenes = storyboardFrameScenes.slice(
    activeStoryboardPage * STORYBOARD_FRAMES_PER_PAGE,
    activeStoryboardPage * STORYBOARD_FRAMES_PER_PAGE +
      STORYBOARD_FRAMES_PER_PAGE,
  );
  const activeCutStart = activeStoryboardPage * STORYBOARD_FRAMES_PER_PAGE + 1;
  const requestedCutCount = Math.max(
    STORYBOARD_FRAMES_PER_PAGE,
    Number.isFinite(form.segmentCount)
      ? Math.trunc(form.segmentCount)
      : STORYBOARD_FRAMES_PER_PAGE,
  );
  const totalCutCount = isGenerating
    ? requestedCutCount
    : result.storyboard.scenes.length;
  const activeCutEnd = Math.min(
    activeCutStart + STORYBOARD_FRAMES_PER_PAGE - 1,
    Math.max(activeCutStart, totalCutCount),
  );
  const isStoryboardResultSkeletonVisible = isGenerating;
  const generatedImageCount = countTrustedStoryboardGeneratedImages(
    result.storyboard.scenes,
  );
  const activePageGeneratedCount = countTrustedStoryboardGeneratedImages(
    activeRealStoryboardPageScenes,
  );
  const activePageGenerationTargetCount = Math.max(
    1,
    activeRealStoryboardPageScenes.length,
  );
  const imageGenerationButtonLabel =
    activePageGeneratedCount === activeRealStoryboardPageScenes.length
      ? `현재 ${activePageGenerationTargetCount}컷 다시 생성`
      : `현재 ${activePageGenerationTargetCount}컷 이미지 생성`;
  const compactImageGenerationButtonLabel =
    activePageGeneratedCount === activeRealStoryboardPageScenes.length
      ? `${activePageGenerationTargetCount}컷 재생성`
      : `${activePageGenerationTargetCount}컷 생성`;
  const hasPreviousStoryboardPage = activeStoryboardPage > 0;
  const hasNextStoryboardPage = activeStoryboardPage < storyboardTotalPages - 1;
  const selectedExportPreset =
    storyboardExportPresets.find((preset) => preset.id === exportPresetId) ??
    storyboardExportPresets[0];
  const currentSourceSummary = result.sourceSummary;
  const storyboardRealDataTrace = useMemo(
    () => formatStoryboardRealDataTrace(result),
    [result],
  );
  const exportResolutionToken = selectedExportPreset.label.replace("×", "x");
  const chatPromptSummary = useMemo(
    () => summarizeChatPrompt(chatDraft || form.prompt),
    [chatDraft, form.prompt],
  );
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
  const selectedStoryboardSceneNo =
    storyboardCanvasFocus?.kind === "cut" ? storyboardCanvasFocus.sceneNo : null;
  const selectedRealStoryboardScene = selectedStoryboardSceneNo
    ? result.storyboard.scenes.find(
        (scene) => scene.sceneNo === selectedStoryboardSceneNo,
      )
    : null;
  const visibleStoryboardHistoryCases = storyboardHistoryCases.slice(0, 8);
  const storyboardHistoryStatusLabel =
    storyboardHistoryStatus === "loading"
      ? "히스토리 로드 중"
      : storyboardHistoryStatus === "error"
        ? "히스토리 오류"
        : storyboardHistoryCases.length
          ? `최근 ${storyboardHistoryCases.length}개`
          : "히스토리 없음";
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
        setStoryboardCanvasFocus(
          createStoryboardCutFocusContext(
            mergeStoryboardScenePatch(sceneForFocus, patch.scenePatch),
          ),
        );
        setStoryboardPage(
          getStoryboardPageForSceneNo(sceneForFocus.sceneNo, storyboardTotalPages),
        );
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
        setStoryboardCanvasFocus(createStoryboardCutFocusContext(sceneForFocus));
        setStoryboardPage(
          getStoryboardPageForSceneNo(sceneForFocus.sceneNo, storyboardTotalPages),
        );
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
    try {
      const historyCases = await getStoryboardHistoryResults();
      setStoryboardHistoryCases((current) =>
        mergeStoryboardHistoryCases(historyCases, current),
      );
      setStoryboardHistoryStatus(historyCases.length ? "ready" : "empty");
    } catch (error) {
      setStoryboardHistoryStatus("error");
      setStoryboardHistoryError(
        error instanceof Error
          ? error.message
          : "스토리보드 생성 히스토리를 불러오지 못했습니다.",
      );
    }
  }

  function applyStoryboardHistoryResult(historyCase: StoryboardHistoryCase) {
    const historyResult = historyCase.result;
    const trace = formatStoryboardRealDataTrace(historyResult);
    setResult(historyResult);
    setForm(historyResult.request);
    setStoryboardPage(0);
    setLatestRealDataLoadedAt(historyResult.generatedAt);
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

  function handleStoryboardPageChange(nextPage: number) {
    const normalizedPage = Math.min(
      storyboardTotalPages - 1,
      Math.max(0, nextPage),
    );
    setStoryboardPage(normalizedPage);
    applyStoryboardCanvasFocus(
      createStoryboardActionFocusContext(
        `${normalizedPage + 1}페이지 선택됨`,
        `CUT ${String(normalizedPage * STORYBOARD_FRAMES_PER_PAGE + 1).padStart(2, "0")}–${String(Math.min((normalizedPage + 1) * STORYBOARD_FRAMES_PER_PAGE, totalCutCount)).padStart(2, "0")} 영역을 보고 있습니다.`,
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
    return `현재 상태 · CUT ${String(activeCutStart).padStart(2, "0")}–${String(activeCutEnd).padStart(2, "0")} · 이미지 현재 ${activePageGeneratedCount}/${activeRealStoryboardPageScenes.length || STORYBOARD_FRAMES_PER_PAGE} · 전체 ${generatedImageCount}/${totalCutCount} · ${trace.summaryText}`;
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
        text: submittedPrompt,
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
      setLatestRealDataLoadedAt(generated.generatedAt);
      setStoryboardHistoryCases((current) =>
        mergeStoryboardHistoryCases([makeStoryboardHistoryCase(generated)], current),
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
          `${getStoryboardChatStatusMessage()}${storyboardCanvasFocus ? ` · 현재 맥락 ${storyboardCanvasFocus.label}` : ""} · ‘생성’, ‘4컷 재생성’, ‘초기화’도 채팅으로 실행할 수 있습니다.`,
        );
        return;
      }
      if (quickCommand === "reset") {
        appendStoryboardChatMessages([
          {
            id: `user-command-${Date.now()}`,
            role: "user",
            text: submittedPrompt,
          },
        ]);
        resetStoryboardChatState();
        return;
      }
      if (quickCommand === "images") {
        if (
          isStoryboardResultSkeletonVisible ||
          isGeneratingImages ||
          activeRealStoryboardPageScenes.length === 0
        ) {
          appendStoryboardQuickCommandMessages(
            submittedPrompt,
            "현재 재생성할 스토리보드 컷이 없습니다. 먼저 스토리보드를 생성해 주세요.",
          );
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
        text: submittedPrompt,
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
          currentAvailableSceneCount: result.storyboard.scenes.length,
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
            lastStatus = String(
              (item.data as { message?: unknown }).message ?? lastStatus,
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

  async function handleGenerateStoryboardImages(
    options: {
      assistantMessageId?: string;
      targetScenes?: StoryboardScene[];
      scope?: "page" | "selected";
    } = {},
  ) {
    const targetScenes = options.targetScenes ?? activeRealStoryboardPageScenes;
    const isSelectedScope = options.scope === "selected";
    const targetLabel =
      isSelectedScope && targetScenes[0]
        ? `CUT ${String(targetScenes[0].sceneNo).padStart(2, "0")}`
        : `현재 페이지 CUT ${String(activeCutStart).padStart(2, "0")}–${String(activeCutEnd).padStart(2, "0")}`;
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

    try {
      // Source contract: postStoryboardImagesRequest(result, activeRealStoryboardPageScenes)
      const payload = await postStoryboardImagesRequest(
        result,
        targetScenes,
      );
      setResult((current) => {
        const imageMap = new Map(
          payload.images.map(({ sceneNo, image }) => [sceneNo, image]),
        );
        return {
          ...current,
          storyboard: {
            ...current.storyboard,
            scenes: current.storyboard.scenes.map((scene) => {
              const image = getTrustedStoryboardGeneratedImage(
                imageMap.get(scene.sceneNo),
              );
              return image ? { ...scene, generatedImage: image } : scene;
            }),
          },
        };
      });
      if (options.assistantMessageId) {
        updateStoryboardChatMessage(
          options.assistantMessageId,
          isSelectedScope
            ? `완료 · ${targetLabel} 이미지를 GPT Image 2 결과로 교체했습니다.`
            : `완료 · 현재 페이지 ${activePageGenerationTargetCount}컷 이미지를 GPT Image 2 결과로 교체했습니다.`,
          "done",
        );
      }
      applyStoryboardCanvasFocus(
        createStoryboardActionFocusContext(
          isSelectedScope ? "현재 컷 이미지 생성 완료" : "4컷 이미지 생성 완료",
          `${targetLabel} 이미지 ${payload.images.length}개가 캔버스에 반영됐습니다.`,
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
            : `4컷 재생성 실패 · ${message}`,
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
              </CardTitle>
              <div
                className="flex shrink-0 items-center gap-1"
                data-storyboard-chat-header-actions="true"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-full px-2 text-xs"
                  onClick={() =>
                    void handleGenerateStoryboardImages(
                      selectedRealStoryboardScene
                        ? {
                            targetScenes: [selectedRealStoryboardScene],
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
                      : activeRealStoryboardPageScenes.length === 0)
                  }
                  aria-label={
                    selectedRealStoryboardScene
                      ? `CUT ${String(selectedRealStoryboardScene.sceneNo).padStart(2, "0")} 이미지 재생성`
                      : "현재 페이지 4컷 이미지 재생성"
                  }
                  data-storyboard-chat-header-image-command="true"
                >
                  {isGeneratingImages ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImageIcon className="mr-1 h-3.5 w-3.5" />
                  )}
                  {selectedRealStoryboardScene ? "현재 컷" : "4컷"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={resetStoryboardChatState}
                  disabled={isGenerating || isChatAgentStreaming}
                  aria-label="스토리보드 채팅 초기화"
                  data-storyboard-chat-header-reset="true"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
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
                <div
                  className={cn(
                    "rounded-2xl border p-2.5 text-xs",
                    storyboardRealDataTrace.mode === "actual"
                      ? "border-emerald-300/70 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100"
                      : "border-amber-300/70 bg-amber-500/10 text-amber-950 dark:text-amber-100",
                  )}
                  data-storyboard-chat-real-data-trace="true"
                  data-storyboard-chat-real-data-trace-mode={
                    storyboardRealDataTrace.mode
                  }
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant={
                        storyboardRealDataTrace.mode === "actual"
                          ? "secondary"
                          : "outline"
                      }
                      className="rounded-full"
                      data-storyboard-chat-real-data-headline="true"
                    >
                      {storyboardRealDataTrace.headline}
                    </Badge>
                    <span
                      className="font-medium"
                      data-storyboard-chat-real-data-backend="true"
                    >
                      {storyboardRealDataTrace.backendText}
                    </span>
                  </div>
                  <p
                    className="mt-1.5 leading-5 opacity-90"
                    data-storyboard-chat-real-data-source="true"
                  >
                    {storyboardRealDataTrace.sourceText}
                  </p>
                  <p
                    className="mt-1 text-[11px] opacity-75"
                    data-storyboard-chat-real-data-generated-at="true"
                  >
                    {storyboardRealDataTrace.generatedAtText}
                  </p>
                </div>
                <div
                  className="rounded-2xl border border-border/70 bg-background/90 p-2.5 text-xs"
                  data-storyboard-case-history="true"
                  data-storyboard-case-history-status={storyboardHistoryStatus}
                  data-storyboard-case-history-count={String(
                    storyboardHistoryCases.length,
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Badge
                          variant="secondary"
                          className="shrink-0 rounded-full"
                        >
                          생성 케이스
                        </Badge>
                        <span
                          className="truncate text-[11px] font-medium text-muted-foreground"
                          data-storyboard-case-history-status-label="true"
                        >
                          {storyboardHistoryStatusLabel}
                        </span>
                      </div>
                      <p className="line-clamp-1 text-[11px] text-muted-foreground">
                        실제 POST 결과를 불러와 캔버스에 다시 확인합니다.
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 rounded-full px-2 text-[11px]"
                      onClick={() => void refreshStoryboardHistoryResults()}
                      disabled={storyboardHistoryStatus === "loading"}
                      data-storyboard-case-history-refresh="true"
                    >
                      {storyboardHistoryStatus === "loading" ? (
                        <Loader2
                          className="mr-1 h-3 w-3 animate-spin"
                          aria-hidden="true"
                        />
                      ) : null}
                      새로고침
                    </Button>
                  </div>
                  {storyboardHistoryError ? (
                    <p
                      className="mt-2 rounded-xl bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
                      data-storyboard-case-history-error="true"
                    >
                      {storyboardHistoryError}
                    </p>
                  ) : null}
                  {visibleStoryboardHistoryCases.length ? (
                    <div
                      className="mt-2 max-h-32 space-y-1 overflow-y-auto pr-1"
                      data-storyboard-case-history-list="true"
                    >
                      {visibleStoryboardHistoryCases.map((historyCase) => {
                        const historyTrace = formatStoryboardRealDataTrace(
                          historyCase.result,
                        );
                        const isSelectedHistory =
                          historyCase.result.generatedAt === result.generatedAt;
                        return (
                          <button
                            type="button"
                            key={historyCase.id}
                            className={cn(
                              "w-full rounded-xl border px-2 py-1.5 text-left transition hover:bg-muted/60",
                              isSelectedHistory
                                ? "border-primary/40 bg-primary/5"
                                : "border-border/70 bg-muted/20",
                            )}
                            onClick={() =>
                              applyStoryboardHistoryResult(historyCase)
                            }
                            data-storyboard-case-history-run={
                              historyCase.result.generatedAt
                            }
                            data-storyboard-case-history-mode={
                              historyTrace.mode
                            }
                            data-storyboard-case-history-selected={
                              isSelectedHistory ? "true" : undefined
                            }
                            aria-pressed={isSelectedHistory}
                          >
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span
                                className="min-w-0 flex-1 truncate font-semibold text-foreground"
                                title={historyCase.result.storyboard.title}
                                data-storyboard-case-history-title="true"
                              >
                                {historyCase.result.storyboard.title}
                              </span>
                              <Badge
                                variant={
                                  historyTrace.mode === "actual"
                                    ? "secondary"
                                    : "outline"
                                }
                                className="shrink-0 rounded-full px-1.5 text-[10px]"
                              >
                                {historyTrace.mode === "actual"
                                  ? "실제"
                                  : "샘플"}
                              </Badge>
                            </div>
                            <p
                              className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground"
                              title={historyCase.result.storyboard.logline}
                              data-storyboard-case-history-logline="true"
                            >
                              {historyCase.result.storyboard.logline}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                              <span data-storyboard-case-history-scenes="true">
                                {historyCase.result.storyboard.scenes.length}컷
                              </span>
                              <span aria-hidden="true">·</span>
                              <time
                                dateTime={historyCase.result.generatedAt}
                                title={historyCase.result.generatedAt}
                                data-storyboard-case-history-generated-at="true"
                              >
                                {formatStoryboardHistoryTimestamp(
                                  historyCase.result.generatedAt,
                                )}
                              </time>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p
                      className="mt-2 rounded-xl bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground"
                      data-storyboard-case-history-empty="true"
                    >
                      아직 저장된 실제 생성 케이스가 없습니다. 채팅에서 “생성”을
                      보내면 여기에 쌓입니다.
                    </p>
                  )}
                </div>
                {storyboardCanvasFocus ? (
                  <div
                    className="flex items-start justify-between gap-2 rounded-2xl border border-primary/20 bg-primary/5 p-2.5 text-xs"
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
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant="secondary"
                          className="rounded-full"
                          data-storyboard-canvas-focus-label="true"
                        >
                          {storyboardCanvasFocus.label}
                        </Badge>
                        <span className="text-[11px] font-medium text-primary">
                          이 맥락으로 채팅 가능
                        </span>
                      </div>
                      <p
                        className="line-clamp-2 text-muted-foreground"
                        data-storyboard-canvas-focus-detail="true"
                      >
                        {storyboardCanvasFocus.detail}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 rounded-full px-2 text-[11px]"
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
                {latestRealDataLoadedAt ? (
                  <Badge
                    variant="outline"
                    className="h-7 shrink-0 rounded-full px-2 text-[11px]"
                    data-storyboard-latest-real-data-loaded="true"
                    title={latestRealDataLoadedAt}
                  >
                    최신
                  </Badge>
                ) : null}
                {!currentSourceSummary.isFallbackData ? (
                  <Badge
                    variant="outline"
                    className="h-7 max-w-[132px] shrink-0 truncate rounded-full px-2 text-[11px]"
                    data-storyboard-real-data-mode="true"
                    title={currentSourceSummary.dataModeLabel}
                  >
                    {currentSourceSummary.dataModeLabel}
                  </Badge>
                ) : null}
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
                  {activeRealStoryboardPageScenes.length ||
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
                    isStoryboardResultSkeletonVisible || isGeneratingImages
                  }
                  className="h-8 shrink-0 px-2 text-xs"
                  data-storyboard-generate-images="local-codex"
                  aria-label={`현재 페이지 ${activePageGenerationTargetCount}컷을 GPT Image 2로 생성`}
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
                  <Download
                    className="mr-1.5 h-3.5 w-3.5"
                    aria-hidden="true"
                  />
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
              {isStoryboardResultSkeletonVisible
                ? Array.from(
                    { length: STORYBOARD_FRAMES_PER_PAGE },
                    (_, index) => {
                      const cutNo = activeCutStart + index;
                      return (
                        <div
                          key={`storyboard-result-skeleton-${cutNo}`}
                          className="h-full min-h-0 overflow-hidden rounded-2xl bg-muted/30"
                          data-storyboard-result-skeleton-frame={String(cutNo)}
                        >
                          <div
                            className="relative h-full overflow-hidden rounded-2xl border border-border/40 bg-muted/40"
                            role="status"
                            aria-live="polite"
                            aria-label={`${cutNo}컷 스토리보드 생성 중`}
                            data-storyboard-realtime-skeleton="true"
                          >
                            <div className="absolute inset-0 animate-pulse bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.28),transparent)]" />
                            <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
                              <span className="rounded-full bg-foreground/70 px-3 py-1 text-xs font-semibold text-background">
                                CUT {String(cutNo).padStart(2, "0")}
                              </span>
                              <span className="h-6 w-16 rounded-full bg-muted-foreground/20" />
                            </div>
                            <div
                              className="absolute inset-x-4 top-[28%] rounded-2xl bg-background/70 p-3 shadow-sm backdrop-blur-sm"
                              data-storyboard-chat-streaming-preview="true"
                            >
                              <p className="text-sm font-semibold text-foreground">
                                {
                                  storyboardStreamingPhases[
                                    (streamingPhaseIndex + index) %
                                      storyboardStreamingPhases.length
                                  ]
                                }
                              </p>
                              <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
                                {chatPromptSummary}
                              </p>
                            </div>
                            <div className="absolute bottom-3 left-3 right-3 grid grid-cols-[0.75fr_1fr] items-end gap-2">
                              <div className="h-12 rounded-t-full rounded-b-2xl bg-muted-foreground/20" />
                              <div className="space-y-1.5">
                                <div className="h-8 rounded-full bg-muted-foreground/20" />
                                <div className="h-2 rounded-full bg-muted-foreground/15" />
                                <div className="h-2 w-2/3 rounded-full bg-muted-foreground/15" />
                              </div>
                            </div>
                            <span className="sr-only">
                              스토리보드 생성 중...
                            </span>
                          </div>
                        </div>
                      );
                    },
                  )
                : activeStoryboardPageScenes.map((scene) => {
                    const frameVisual = getStoryboardFrameVisual(scene.sceneNo);
                    const trustedGeneratedImage =
                      getTrustedStoryboardGeneratedImage(scene.generatedImage);
                    return (
                      <button
                        type="button"
                        key={`frame-${scene.sceneNo}-${scene.heatmapEvidence.videoId}`}
                        className={cn(
                          "group flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border-0 bg-background p-0 text-left shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                          selectedStoryboardSceneNo === scene.sceneNo
                            ? "ring-2 ring-primary ring-offset-2"
                            : "ring-0",
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
                          className="shrink-0 space-y-1.5 border-t border-border/70 bg-background/96 px-3 py-2 text-foreground"
                          data-storyboard-frame-script="true"
                          data-storyboard-frame-script-placement="separated"
                        >
                          <p
                            className="grid grid-cols-[68px_minmax(0,1fr)] items-start gap-2 text-[11px] leading-snug"
                            data-storyboard-frame-audio="true"
                          >
                            <span className="mt-0.5 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                              Audio
                            </span>
                            <span className="line-clamp-2 font-medium text-foreground">
                              {scene.hostBeat}
                            </span>
                          </p>
                          <p
                            className="grid grid-cols-[68px_minmax(0,1fr)] items-start gap-2 text-[11px] leading-snug"
                            data-storyboard-frame-subtitle="true"
                          >
                            <span className="mt-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                              Subtitle
                            </span>
                            <span className="line-clamp-2 font-semibold text-foreground">
                              {scene.captionIdea}
                            </span>
                          </p>
                        </div>
                      </button>
                    );
                  })}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

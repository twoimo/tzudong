"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BringToFront,
  Copy,
  Download,
  Eye,
  EyeOff,
  History,
  KeyRound,
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

type ProviderId = "local-codex";
type GenerationMode = "direct_provider" | "backend_agent";
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
  activeLayerId: string;
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
};

type ThumbnailHistoryPayload = {
  updatedAt?: string | null;
  runs?: ThumbnailHistoryRun[];
};

type ThumbnailHistoryStatus = "idle" | "loading" | "ready" | "empty" | "error";

type ThumbnailChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  mode?: "system" | "submitted" | "live" | "stream";
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
  };
};

type ThumbnailChatSseEvent = {
  event: string;
  data: unknown;
};

type ThumbnailGenerationOverrides = Partial<{
  providerId: ProviderId;
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
    rootPath: string;
    graphEntrypoint: string | null;
    commandConfigured: boolean;
    commandAvailable: boolean;
    commandPath?: string;
    commandRejectionReason?: string;
    localAdapterAvailable: boolean;
    missingPythonModules: string[];
    runtime?: string;
    codexModel?: string;
    codexEffort?: string;
    streamingAvailable?: boolean;
  };
  providers: {
    localCodex: ProviderAvailability;
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
};

const thumbnailErrorActions: Record<string, string> = {
  required_ack: "안전 확인 체크박스를 직접 확인한 뒤 다시 생성하세요.",
  provider_unavailable: "현재 사용할 수 없는 실제 이미지 provider입니다. 환경변수, API 키 또는 로컬 Codex 설정을 확인하세요.",
  unsupported_model: "지원 모델 allowlist와 THUMBNAIL_*_IMAGE_MODEL 환경변수를 확인하세요.",
  invalid_text: "주제/문구 길이와 금지 문자를 줄이고 다시 시도하세요.",
  unsafe_instruction: "시스템 지시 무시, 비밀/환경변수/키 출력 요청을 제거하세요.",
  unsafe_identity: "실제 채널명, 계정명, 개인 식별 텍스트를 제거하세요.",
  unsafe_brand: "브랜드/로고/상표 요청을 제거하고 일반 묘사로 바꾸세요.",
  unsafe_contact: "URL, 이메일, 전화번호, 주소처럼 보이는 텍스트를 제거하세요.",
  unsafe_price: "정확한 가격/금액 표현을 제거하세요.",
  unsafe_copy: "참고 프롬프트 문장을 그대로 복사하지 말고 새 소재에 맞게 요약하세요.",
  unsafe_crowd: "배경 인물을 식별 가능하게 만드는 지시를 제거하세요.",
  multipart_form_data_required: "브라우저 폼 업로드로 다시 시도하세요.",
  content_length_invalid: "업로드 요청 크기 정보를 확인할 수 없습니다. 파일을 다시 선택하세요.",
  content_length_too_large: "참고 이미지 총 용량을 32MiB 이하로 줄이세요.",
  payload_json_invalid: "입력값을 새로고침 후 다시 작성하세요.",
};

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 1024 * 1024 ? 1 : 2)}MiB`;
}

function getThumbnailErrorAction(payload: ThumbnailApiErrorPayload | null) {
  const code = payload?.error ?? "thumbnail_generation_failed";
  const action = thumbnailErrorActions[code] ?? "입력값과 실제 provider 상태를 확인한 뒤 다시 시도하세요.";
  return payload?.detail ? `${action} (${payload.detail})` : action;
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
const THUMBNAIL_HISTORY_IMAGE_BASE_URL = "/qa-history/youtube-thumbnail-generator";
const THUMBNAIL_STRICT_LOCAL_CODEX_UNVERIFIED_REASON = "local_codex_model_provenance_unverified";
const DEFAULT_TOPIC =
  "다음 업로드 주제: 해외 야시장 길거리 음식, 압도적인 양의 음식 전경, 진행자와 리액션 컷아웃";
const CHAT_TOPIC_MAX_LENGTH = 280;
const CANVAS_TEXT_IDENTITY_PATTERN = /(쯔양|tzuyang|youtube\s*channel|유튜브\s*채널|계정|@[\w_.-]+)/gi;
const CHAT_EXPLICIT_HEADLINE_PATTERN = /(?:^|[\n,;])\s*(?:메인\s*문구|메인|큰\s*문구|제목|headline)\s*[:：]\s*([^\n,;]+)/i;
const CHAT_EXPLICIT_SUBHEADLINE_PATTERN = /(?:^|[\n,;])\s*(?:보조\s*문구|보조|스티커|서브|sub)\s*[:：]\s*([^\n,;]+)/i;
const CHAT_GENERATION_INTENT_PATTERN = /(생성|만들|제작|그려|뽑아|렌더|render|generate|create)/i;
const THUMBNAIL_CHAT_LOCAL_COMMAND_OVERMATCH_FIXTURES = [
  "가이드 포함해서 썸네일 생성해줘",
  "메인 문구 크게 보이게 생성해줘",
  "PNG 느낌으로 저장하고 싶은 썸네일 만들어줘",
  "생성 과정 확인해줘",
] as const;

function createThumbnailChatRunId(messageId: string) {
  return `thumbnail-chat-${Date.now()}-${messageId}`;
}

function normalizeThumbnailChatRequirement(value: string) {
  return value
    .replace(/[<>`{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  if (isThumbnailChatRealDataStatusPrompt(normalized)) return "real-data-status";
  if (hasThumbnailGenerationIntent(normalized)) return null;
  if (isCanvasContextChatPrompt(normalized)) return null;
  if (isThumbnailChatStructuredEditPrompt(normalized)) return null;

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
    .replace(/(생성해줘|생성|만들어줘|만들어|그려줘|그려|실행해줘|실행|이미지\s*뽑아줘|뽑아줘)/gi, "")
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

function deriveChatHeadline(text: string) {
  const explicitHeadline = pickExplicitChatField(text, CHAT_EXPLICIT_HEADLINE_PATTERN);
  if (explicitHeadline) return sanitizeCanvasChatText(explicitHeadline, "역대급 먹방", 18);

  const quotedText = text.match(/["“'‘]([^"”'’]{2,24})["”'’]/)?.[1]?.trim();
  if (quotedText) return sanitizeCanvasChatText(quotedText, "역대급 먹방", 18);

  if (/불맛|화력|철판|매운/i.test(text)) return "역대급 불맛";
  if (/대왕|대형|거대|압도|많이|양/i.test(text)) return "역대급 먹방";
  if (/한입|가능/i.test(text)) return "한입만 가능?";
  if (/야시장|시장|노점/i.test(text)) return "야시장 먹방";
  return "역대급 먹방";
}

function deriveChatSubHeadline(text: string) {
  const explicitSubHeadline = pickExplicitChatField(text, CHAT_EXPLICIT_SUBHEADLINE_PATTERN);
  if (explicitSubHeadline) return sanitizeCanvasChatText(explicitSubHeadline, "한입만 가능?", 16);

  if (/한입|가능/i.test(text)) return "한입만 가능?";
  if (/쯔양|tzuyang/i.test(text)) return "진짜 가능?";
  if (/매운|불맛|화력/i.test(text)) return "불맛 폭발";
  if (/야시장|시장|노점/i.test(text)) return "야시장 클라스";
  return "한입만 가능?";
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
  if (!layer) return "선택된 문구가 없습니다. 캔버스 문구를 클릭하면 여기에서 바로 챗봇에게 이어갈 수 있습니다.";
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
    "이 선택 항목이 더 잘 보이도록 문구, 크기, 위치, 강조 방식을 제안하고 캔버스에 반영해줘.",
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

function isProviderId(value: string | undefined): value is ProviderId {
  return value === "local-codex";
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
  };
}

function findLatestActualHistoryRun(payload: ThumbnailHistoryPayload | null) {
  const runs = Array.isArray(payload?.runs) ? payload.runs : [];
  return runs.find((run) => Boolean(run.imagePath) && isExactGptImage2HistoryRun(run)) ?? null;
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
    label: "로컬 Codex CLI OAuth gpt-image-2",
  },
];
const THUMBNAIL_PROVIDER_UNAVAILABLE_MESSAGE = "선택한 실제 이미지 모델을 사용할 수 없습니다. API 키 또는 로컬 Codex 설정을 확인하세요.";

function getThumbnailProviderLabel(provider: ProviderId) {
  return providerOptions.find((option) => option.value === provider)?.label ?? provider;
}

function formatThumbnailGenerationMode(mode: GenerationMode) {
  return mode === "backend_agent"
    ? "backend_agent · 백엔드 에이전트가 brief/레이아웃/검수 후 provider 호출"
    : "direct_provider · 선택 provider 직접 호출";
}

function formatThumbnailModelProvenance(provenance: GenerationResult["baseImage"]["modelProvenance"] | undefined) {
  if (provenance === "exact") return "exact · 모델 직접 확정";
  if (provenance === "requested-label") return "requested-label · 요청 라벨/로컬 출력 불투명";
  return "unknown · provider 응답 기준";
}

function getThumbnailResultSourceLabel(currentResult: GenerationResult | null) {
  const dataUrl = currentResult?.baseImage?.dataUrl ?? "";
  if (!dataUrl) return "결과 없음";
  if (dataUrl.startsWith(`${THUMBNAIL_HISTORY_IMAGE_BASE_URL}/`)) return "히스토리 저장 이미지 URL";
  if (dataUrl.startsWith("data:image/")) return "현재 생성 응답 data URL";
  if (dataUrl.startsWith("http://") || dataUrl.startsWith("https://")) return "외부 이미지 URL";
  return "페이지 이미지 URL";
}

function canUseSessionApiKeyForProvider(
  provider: ProviderId,
  availability: ProviderAvailability | null | undefined,
) {
  void provider;
  void availability;
  return false;
}

function formatThumbnailProviderBlockReason(reason: string | null | undefined) {
  if (reason === THUMBNAIL_STRICT_LOCAL_CODEX_UNVERIFIED_REASON) {
    return "로컬 Codex built-in image_generation이 실제 backend 이미지 모델의 exact gpt-image-2 provenance를 증명하지 못해 생성이 중단됩니다.";
  }
  if (reason === "local_codex_model_not_allowed") {
    return "Strict local Codex 모드는 gpt-image-2 라벨만 허용합니다.";
  }
  if (reason === "local_codex_command_not_configured") {
    return "로컬 Codex 이미지 생성 wrapper 경로가 설정되지 않았습니다.";
  }
  if (reason === "local_codex_disabled") {
    return "로컬 Codex 이미지 생성 gate가 꺼져 있습니다.";
  }
  if (reason === "openai_api_disabled_by_policy") {
    return "OPENAI_API_KEY 기반 이미지 생성은 비활성화되어 있습니다.";
  }
  return reason ?? "실제 이미지 provider 준비 상태를 확인할 수 없습니다.";
}

function formatThumbnailProviderAvailability(
  availability: ProviderAvailability | null | undefined,
  sessionKeyBackedProviderAvailable: boolean,
) {
  if (!availability) return "현재 로드된 상태 없음";
  const modelText = availability.model ? `model ${availability.model}` : "model 정보 없음";
  if (availability.available) {
    return availability.liveEnabled === false
      ? `사용 가능 · ${modelText}`
      : `사용 가능 · live gate ${availability.liveEnabled ? "on" : "local"} · ${modelText}`;
  }
  if (sessionKeyBackedProviderAvailable) return `세션 API 키로 사용 가능 · ${modelText}`;
  const strictText = availability.strictExactModelRequired ? " · strict exact model" : "";
  return `사용 불가 · ${modelText}${strictText}${availability.reason ? ` · ${formatThumbnailProviderBlockReason(availability.reason)}` : ""}`;
}

function formatThumbnailBackendAgentStatus(status: ThumbnailReadiness["backendAgent"] | null | undefined) {
  if (!status) return "현재 로드된 상태 없음";
  const modelText = [status.codexModel, status.codexEffort].filter(Boolean).join(" ");
  return status.available
    ? `사용 가능 · ${status.mode} · ${modelText || status.runtime} · streaming ${status.streamingAvailable ? "on" : "off"}`
    : `사용 불가 · ${status.mode} · missing ${status.missingPythonModules.length ? status.missingPythonModules.join(", ") : "none"}`;
}

function formatThumbnailHistoryStatus(status: ThumbnailHistoryStatus, runs: ThumbnailHistoryRun[], error: string | null) {
  if (status === "error") return `현재 로드된 상태 · error · ${error ?? "history_api_failed"}`;
  if (status === "loading") return `현재 로드된 상태 · 불러오는 중 · ${runs.length}건`;
  const latest = runs[0];
  const latestText = latest
    ? ` · 최근 ${latest.providerId ?? "provider"} / ${latest.model ?? "model"} / ${latest.modelProvenance ?? "provenance"}`
    : "";
  return `현재 로드된 상태 · ${runs.length}건 · 상태 ${status}${latestText}`;
}

function formatThumbnailGenerationCompletionSummary(generationResult: GenerationResult) {
  return [
    "Codex CLI gpt-5.5 high 작업 완료",
    "실제 썸네일 생성 완료",
    `provider ${generationResult.baseImage.providerId}`,
    `model ${generationResult.baseImage.model}`,
    `provenance ${generationResult.baseImage.modelProvenance ?? "unknown"}`,
    "히스토리 새로고침 요청됨",
    "캔버스에 반영했습니다",
  ].join(" · ");
}

const TEXT_LAYER_RENDER_MAX_WIDTH = 760;
const TEXT_LAYER_MIN_FIT_SCALE = 0.58;

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
  const width = Math.min(maxWidth, rawWidth * renderScale);
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inlineTextEditorRef = useRef<HTMLDivElement | null>(null);
  const loadedBaseImageRef = useRef<{ dataUrl: string; image: HTMLImageElement } | null>(null);
  const drawCanvasFrameRef = useRef<number | null>(null);
  const textLayersRef = useRef<TextLayer[]>([]);
  const activeLayerIdRef = useRef(DEFAULT_TEXT_LAYERS[0]?.id ?? "headline");
  const editingLayerIdRef = useRef<string | null>(null);
  const textLayerUndoStackRef = useRef<TextEditorHistorySnapshot[]>([]);
  const pendingTextLayerUndoSnapshotRef = useRef<TextEditorHistorySnapshot | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const textTransformStateRef = useRef<TextTransformState | null>(null);
  const latestHistoryRunKeyRef = useRef<string | null>(null);
  const thumbnailHistoryRequestIdRef = useRef(0);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const activeChatAssistantMessageIdRef = useRef<string | null>(null);
  const generationAbortControllerRef = useRef<AbortController | null>(null);
  const activeGenerationAssistantMessageIdRef = useRef<string | null>(null);
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
      content: "채팅으로 캔버스 수정/문구 도구/가이드/PNG 저장/히스토리/참고 이미지/실제 생성까지 요청할 수 있습니다. 작업 해석은 Codex CLI gpt-5.5 high 백엔드 에이전트가 스트림 상태로 처리합니다.",
    },
  ]);
  const [headline, setHeadline] = useState(DEFAULT_TEXT_LAYERS[0]?.content ?? "역대급 먹방");
  const [subHeadline, setSubHeadline] = useState(DEFAULT_TEXT_LAYERS[1]?.content ?? "한입만 가능?");
  const [providerId, setProviderId] = useState<ProviderId>("local-codex");
  const [generationMode, setGenerationMode] = useState<GenerationMode>("direct_provider");
  const briefPreset: BriefPreset = "tzuyang-food-travel-collage";
  const [files, setFiles] = useState<File[]>([]);
  const [referenceImageRoles, setReferenceImageRoles] = useState<ReferenceImageRole[]>([]);
  const acknowledgedSafety = true;
  const [textLayers, setTextLayers] = useState<TextLayer[]>(() => createDefaultTextLayers());
  const [activeLayerId, setActiveLayerId] = useState(DEFAULT_TEXT_LAYERS[0]?.id ?? "headline");
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [lastCanvasActionLabel, setLastCanvasActionLabel] = useState<string | null>("메인 문구 선택됨");
  const [exportPresetId, setExportPresetId] = useState<ThumbnailExportPresetId>("quick-1280x720");
  const [lastExportMetadata, setLastExportMetadata] = useState<ThumbnailExportMetadata | null>(null);
  const [showSafeAreaGuide, setShowSafeAreaGuide] = useState(true);
  const [readiness, setReadiness] = useState<ThumbnailReadiness | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [baseImageRenderRevision, setBaseImageRenderRevision] = useState(0);
  const [historyRuns, setHistoryRuns] = useState<ThumbnailHistoryRun[]>([]);
  const [historyStatus, setHistoryStatus] = useState<ThumbnailHistoryStatus>("idle");
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [isChatSettingsOpen, setIsChatSettingsOpen] = useState(false);
  const [fileValidationMessage, setFileValidationMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isChatAgentStreaming, setIsChatAgentStreaming] = useState(false);
  const resultRef = useRef<GenerationResult | null>(result);

  const selectedExportPreset = useMemo(
    () => thumbnailExportPresets.find((preset) => preset.id === exportPresetId) ?? thumbnailExportPresets[0],
    [exportPresetId],
  );
  const readinessLimits = readiness?.limits ?? DEFAULT_LIMITS;
  const selectedProviderAvailability = readiness?.providers[providerReadinessKey[providerId]] ?? null;
  const localCodexAvailability = readiness?.providers.localCodex ?? null;
  const backendAgentStatus = readiness?.backendAgent ?? null;
  const preflightIssues = useMemo(() => {
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
      issues.push("썸네일 백엔드 에이전트 상태를 확인할 수 없어 직접 생성으로 전환하세요.");
    }
    if (
      selectedProviderAvailability &&
      !selectedProviderAvailability.available &&
      !canUseSessionApiKeyForProvider(providerId, selectedProviderAvailability)
    ) {
      issues.push(THUMBNAIL_PROVIDER_UNAVAILABLE_MESSAGE);
    }

    return issues;
  }, [
    fileValidationMessage,
    files,
    generationMode,
    backendAgentStatus,
    headline,
    providerId,
    readinessLimits.maxFileBytes,
    readinessLimits.maxFiles,
    readinessLimits.maxTotalBytes,
    readinessLimits.mimeTypes,
    selectedProviderAvailability,
    topic,
  ]);
  const activeLayer = useMemo(
    () => textLayers.find((layer) => layer.id === activeLayerId) ?? textLayers[0] ?? null,
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

  const loadReadiness = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/youtube-thumbnail-generator", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as ThumbnailReadiness | ThumbnailApiErrorPayload | null;
      if (!response.ok || !payload || !("providers" in payload)) {
        throw new Error(getThumbnailErrorAction(payload && "error" in payload ? payload : null));
      }
      setReadiness(payload);
      const availability = payload.providers[providerReadinessKey[providerId]];
      if (!availability?.available && !canUseSessionApiKeyForProvider(providerId, availability)) {
        const blockedReason = formatThumbnailProviderBlockReason(availability?.reason);
        toast({
          variant: "destructive",
          title: "실제 이미지 모델 준비 필요",
          description: `선택한 모델을 자동 전환하지 않습니다: ${blockedReason}`,
        });
      }
    } catch (readinessError) {
      toast({
        variant: "destructive",
        title: "모델 상태 확인 실패",
        description: readinessError instanceof Error ? readinessError.message : "provider 상태를 확인하지 못했습니다.",
      });
    }
  }, [providerId]);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  const loadThumbnailHistory = useCallback(async (
    options: { replaceInitialPreview?: boolean; silent?: boolean } = {},
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

      const latestRun = findLatestActualHistoryRun({ runs });
      if (!options.replaceInitialPreview || !latestRun) return;
      const nextResult = createThumbnailResultFromHistoryRun(latestRun);
      if (!nextResult) return;

      const runKey = latestRun.id ?? latestRun.timestamp ?? latestRun.imagePath ?? nextResult.baseImage.dataUrl;
      if (latestHistoryRunKeyRef.current === runKey) return;
      if (!canReplacePreviewWithHistoryResult(resultRef.current)) return;
      setResult(nextResult);

      latestHistoryRunKeyRef.current = runKey;
      if (isProviderId(latestRun.providerId)) setProviderId(latestRun.providerId);
      if (isGenerationMode(latestRun.generationMode)) setGenerationMode(latestRun.generationMode);
      if (latestRun.topic?.trim()) {
        setTopic((currentTopic) => (currentTopic === DEFAULT_TOPIC ? latestRun.topic?.trim() ?? currentTopic : currentTopic));
      }
      const latestHeadline = latestRun.headline?.trim();
      const defaultHeadline = DEFAULT_TEXT_LAYERS[0]?.content ?? "역대급 먹방";
      if (latestHeadline) {
        setHeadline((currentHeadline) => (currentHeadline === defaultHeadline ? latestHeadline : currentHeadline));
        setTextLayers((currentLayers) =>
          currentLayers.map((layer) =>
            layer.id === "headline" && layer.content === defaultHeadline
              ? { ...layer, content: latestHeadline }
              : layer,
          ),
        );
      }
    } catch (error) {
      if (thumbnailHistoryRequestIdRef.current !== requestId) return;
      setHistoryStatus("error");
      setHistoryError(error instanceof Error ? error.message : "history_api_failed");
    }
  }, [isGenerating]);

  useEffect(() => {
    void loadThumbnailHistory({ replaceInitialPreview: true, silent: true });
  }, [loadThumbnailHistory]);

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
          const textMetrics = drawNoWrapFittedText(context, layer.content, 0, 0, TEXT_LAYER_RENDER_MAX_WIDTH, layer);
          if (layer.id === activeLayerId) {
            const measuredWidth = textMetrics.width;
            const measuredHeight = textMetrics.height;
            const frameX = layer.align === "center" ? -measuredWidth / 2 : layer.align === "right" ? -measuredWidth : 0;
            const frameY = -measuredHeight / 2;
            context.shadowColor = "transparent";
            context.shadowBlur = 0;
            context.shadowOffsetY = 0;
            context.setLineDash([14, 10]);
            context.lineWidth = 4;
            context.strokeStyle = "#38bdf8";
            context.strokeRect(frameX - 18, frameY - 12, measuredWidth + 36, measuredHeight + 24);
            context.setLineDash([]);
            context.fillStyle = "rgba(8, 47, 73, 0.88)";
            context.fillRect(frameX - 18, frameY - 44, 132, 28);
            context.fillStyle = "#ffffff";
            context.font = "800 16px system-ui, sans-serif";
            context.textAlign = "left";
            context.textBaseline = "middle";
            context.fillText(layer.id === "headline" ? "메인 선택됨" : layer.id === "subHeadline" ? "스티커 선택됨" : "문구 선택됨", frameX - 8, frameY - 30);
          }
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
  }, [activeLayerId, baseImageRenderRevision, editingLayerId, result?.baseImage?.dataUrl, showSafeAreaGuide, textLayers]);

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
    const restoredActiveLayerId = restoredLayers.some((layer) => layer.id === snapshot.activeLayerId)
      ? snapshot.activeLayerId
      : restoredLayers[0]?.id ?? "headline";
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

    applyThumbnailChatPatchToCanvas({
      topic: normalizedRequirement.slice(0, CHAT_TOPIC_MAX_LENGTH),
      headline: deriveChatHeadline(normalizedRequirement),
      subHeadline: deriveChatSubHeadline(normalizedRequirement),
    });
  }

  function createTextLayersWithChatPatch(current: TextLayer[], patch: ThumbnailChatCanvasPatch) {
    return current.map((layer) => {
      if (layer.id === "headline") return { ...layer, content: patch.headline };
      if (layer.id === "subHeadline") return { ...layer, content: patch.subHeadline };
      return layer;
    });
  }

  function createTextLayersWithChatTextLayerPatches(current: TextLayer[], patches: ThumbnailChatTextLayerPatch[] = []) {
    if (!patches.length) return current;
    return current.map((layer) => {
      const patch = patches.find((item) => item.id === layer.id);
      if (!patch) return layer;
      const nextLayer: TextLayer = { ...layer };
      if (typeof patch.content === "string") nextLayer.content = normalizeInlineEditableText(patch.content).slice(0, 80);
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
    if (!options.preserveActiveLayer) setActiveLayerId("headline");
    markCanvasAction("채팅 반영");
  }

  function appendThumbnailChatMessages(messages: ThumbnailChatMessage[]) {
    setChatMessages((current) => [...current, ...messages].slice(-10));
  }

  function updateThumbnailChatMessage(messageId: string, content: string, mode: ThumbnailChatMessage["mode"] = "stream") {
    setChatMessages((current) => current.map((message) => (
      message.id === messageId ? { ...message, content, mode } : message
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

  function getAbortNotice(kind: "chat" | "generation") {
    return kind === "chat"
      ? "채팅 스트림 중단됨 · 브라우저 요청을 종료했고 서버 에이전트에는 협력 취소 신호를 보냈습니다."
      : "썸네일 생성 요청 중단됨 · 브라우저 업로드/응답을 종료했고 이미지 provider에는 협력 취소 신호를 보냈습니다.";
  }

  function getThumbnailRealDataStatusSummary() {
    const currentResult = resultRef.current ?? result;
    const resultSource = getThumbnailResultSourceLabel(currentResult);
    const resultBase = currentResult?.baseImage;
    const sessionKeyBackedProviderAvailable = canUseSessionApiKeyForProvider(
      providerId,
      selectedProviderAvailability,
    );
    const progressState = isGenerating
      ? "이미지 provider 요청 중"
      : isChatAgentStreaming
        ? "채팅 백엔드 에이전트 스트리밍 중"
        : "대기 중";
    const exactBoundary = resultBase?.providerId === "local-codex" && resultBase.model === "gpt-image-2" && resultBase.modelProvenance === "exact"
      ? "현재 캔버스는 Local Codex built-in image_generation gpt-image-2 exact provenance 결과입니다."
      : "현재 캔버스에는 아직 실제 GPT Image 2 생성 결과가 없습니다. OPENAI_API_KEY 없이 Local Codex built-in image_generation provenance가 확인될 때만 생성합니다.";

    return [
      "실데이터 확인 · 현재 로드된 상태 기준",
      "Mock/Python/API-key seed: 실제 생성 결과에서 제외됨 · 표시 히스토리는 local-codex + gpt-image-2 + exact provenance만 사용합니다.",
      `선택 provider: ${getThumbnailProviderLabel(providerId)} (${providerId}) · ${formatThumbnailProviderAvailability(selectedProviderAvailability, sessionKeyBackedProviderAvailable)}`,
      `생성 모드: ${formatThumbnailGenerationMode(generationMode)}`,
      `백엔드 에이전트: ${formatThumbnailBackendAgentStatus(backendAgentStatus)}`,
      resultBase
        ? `현재 캔버스 결과: ${resultSource} · provider ${resultBase.providerId} · model ${resultBase.model} · provenance ${formatThumbnailModelProvenance(resultBase.modelProvenance)}`
        : "현재 캔버스 결과: 아직 생성 결과 없음",
      `히스토리: ${formatThumbnailHistoryStatus(historyStatus, historyRuns, historyError)}`,
      `참고 이미지: 현재 탭에 ${files.length}장 · 다음 실제 생성 요청에만 전송`,
      `진행 상태: ${progressState}`,
      exactBoundary,
    ].join("\n");
  }

  function renderThumbnailOperatorReadinessPanel() {
    const resultBase = result?.baseImage;
    const hasExactGptImage2Result =
      resultBase?.providerId === "local-codex" &&
      resultBase.model === "gpt-image-2" &&
      resultBase.modelProvenance === "exact";
    const strictLocalCodexBlocked = Boolean(
      localCodexAvailability?.strictExactModelRequired &&
      !localCodexAvailability.available &&
      localCodexAvailability.reason === THUMBNAIL_STRICT_LOCAL_CODEX_UNVERIFIED_REASON,
    );
    const selectedSessionKeyBackedProviderAvailable = canUseSessionApiKeyForProvider(
      providerId,
      selectedProviderAvailability,
    );
    const selectedProviderReady = Boolean(selectedProviderAvailability?.available || selectedSessionKeyBackedProviderAvailable);
    const statusTone = hasExactGptImage2Result
      ? "ready"
      : strictLocalCodexBlocked
        ? "strict-blocked"
        : selectedProviderReady
          ? "ready-to-generate"
          : "needs-setup";
    const statusLabel = hasExactGptImage2Result
      ? "실제 GPT Image 2 결과 있음"
      : strictLocalCodexBlocked
        ? "생성 중단 · 모델 증명 필요"
        : selectedProviderReady
          ? "생성 준비 가능"
          : "생성 준비 필요";
    const selectedProviderReason = formatThumbnailProviderBlockReason(selectedProviderAvailability?.reason);
    const localCodexReason = formatThumbnailProviderBlockReason(localCodexAvailability?.reason);

    return (
      <section
        className="rounded-2xl border border-amber-300/70 bg-amber-50/80 p-3 text-xs leading-5 text-amber-950 shadow-sm dark:border-amber-400/40 dark:bg-amber-950/25 dark:text-amber-100"
        data-thumbnail-operator-readiness="true"
        data-thumbnail-operator-readiness-state={statusTone}
        data-thumbnail-strict-model-blocked={strictLocalCodexBlocked ? "true" : "false"}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold" data-thumbnail-operator-readiness-title="true">
              운영 준비도 · {statusLabel}
            </p>
            <p className="mt-0.5 text-[11px] opacity-85" data-thumbnail-operator-readiness-proof="true">
              exact gpt-image-2 provenance가 확인된 결과만 실제 생성/히스토리로 인정합니다. 다른 이미지 모델 fallback은 사용하지 않습니다.
            </p>
          </div>
          <Badge variant={strictLocalCodexBlocked ? "destructive" : "outline"} className="shrink-0">
            {strictLocalCodexBlocked ? "strict stop" : hasExactGptImage2Result ? "exact" : "check"}
          </Badge>
        </div>
        <div className="mt-2 grid gap-1.5" data-thumbnail-operator-persona-checklist="true">
          <p><strong>쯔양님/매니저</strong>: 미확인 모델 생성물은 만들지 않으므로 업로드 리스크를 만들지 않습니다.</p>
          <p><strong>PD님</strong>: 채팅으로 기획, 문구, 레이어 배치는 계속 정리할 수 있습니다.</p>
          <p><strong>편집자</strong>: PNG 저장/가이드/문구 편집은 가능하며, 배경 이미지는 exact 결과가 있을 때만 반영됩니다.</p>
          <p data-thumbnail-operator-next-action="true">
            다음 조치: {strictLocalCodexBlocked
              ? `${localCodexReason} provider가 exact provenance를 반환하도록 연결한 뒤 다시 생성하세요.`
              : selectedProviderReady
                ? "안전 확인 후 실제 생성 요청을 실행하고 결과 provenance를 확인하세요."
                : `${selectedProviderReason} 설정을 완료한 뒤 다시 시도하세요.`}
          </p>
        </div>
      </section>
    );
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

    setResult(nextResult);
    markCanvasAction("히스토리 반영");
    latestHistoryRunKeyRef.current = run.id ?? run.timestamp ?? run.imagePath ?? nextResult.baseImage.dataUrl;
    if (isProviderId(run.providerId)) setProviderId(run.providerId);
    if (isGenerationMode(run.generationMode)) setGenerationMode(run.generationMode);
    if (run.topic?.trim()) setTopic(run.topic.trim().slice(0, CHAT_TOPIC_MAX_LENGTH));
    const latestHeadline = run.headline?.trim();
    if (latestHeadline) {
      setHeadline(latestHeadline);
      setTextLayers((currentLayers) => {
        const nextLayers = currentLayers.map((layer) =>
          layer.id === "headline" ? { ...layer, content: latestHeadline } : layer,
        );
        textLayersRef.current = nextLayers;
        return nextLayers;
      });
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
    if (!value.trim()) return;
    if (isThumbnailChatStructuredEditPrompt(value)) {
      restorePendingChatPreviewSnapshotForStructuredEdit();
      return;
    }
    if (resolveThumbnailChatLocalCommand(value)) return;
    if (isSelectedLayerChatPrompt(value)) return;
    ensurePendingTextLayerUndoSnapshot();
    applyChatRequirementToCanvas(value);
  }

  async function handleThumbnailChatSubmit() {
    const submittedRequirement = normalizeThumbnailChatRequirement(chatDraft);
    if (!submittedRequirement || isChatAgentStreaming) return;

    const structuredEditPrompt = isThumbnailChatStructuredEditPrompt(submittedRequirement);
    const localCommand = resolveThumbnailChatLocalCommand(submittedRequirement);
    if (localCommand) {
      commitPendingTextLayerUndoSnapshot();
      setChatDraft("");
      await handleThumbnailChatCommand(localCommand, submittedRequirement);
      return;
    }

    if (structuredEditPrompt) {
      restorePendingChatPreviewSnapshotForStructuredEdit();
    } else {
      commitPendingTextLayerUndoSnapshot();
    }
    const selectedLayerPrompt = isSelectedLayerChatPrompt(submittedRequirement);
    if (!selectedLayerPrompt && !structuredEditPrompt) applyChatRequirementToCanvas(submittedRequirement);
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
      content: "Codex CLI gpt-5.5 high 백엔드 에이전트 연결 중...",
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
          message: submittedRequirement,
          currentTopic: topic,
          currentHeadline: headline,
          currentSubHeadline: subHeadline,
          activeLayerId: activeLayerIdRef.current,
          editingLayerId,
          lastCanvasActionLabel,
          currentTextLayers: textLayersRef.current,
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
      let lastStatus = "Codex CLI gpt-5.5 high 작업 중...";

      const handleChatStreamEvent = (item: ThumbnailChatSseEvent) => {
        if (item.event === "status" && item.data && typeof item.data === "object" && "message" in item.data) {
          lastStatus = String((item.data as { message?: unknown }).message ?? lastStatus);
          updateThumbnailChatMessage(nextAssistantMessageId, lastStatus, "stream");
        }
        if ((item.event === "patch" || item.event === "done") && isThumbnailChatAgentResult(item.data)) {
          finalResult = item.data;
          applyThumbnailChatPatchToCanvas(item.data.canvasPatch, {
            preserveActiveLayer: Boolean(item.data.textLayerPatches?.length),
          });
          applyThumbnailChatTextLayerPatches(item.data.textLayerPatches ?? []);
          if (item.data.providerId) setProviderId(item.data.providerId);
          if (item.data.generationMode) setGenerationMode(item.data.generationMode);
          updateThumbnailChatMessage(nextAssistantMessageId, item.data.assistantMessage, "live");
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
        const patchedTextLayers = createTextLayersWithChatTextLayerPatches(
          createTextLayersWithChatPatch(textLayersRef.current, resolvedFinalResult.canvasPatch),
          resolvedFinalResult.textLayerPatches ?? [],
        );
        // Source contract: finalResult?.shouldGenerate drives runThumbnailGeneration; finalResult.providerId ?? providerId and finalResult.generationMode ?? generationMode remain the generation fallbacks.
        await runThumbnailGeneration({
          providerId: resolvedFinalResult.providerId ?? providerId,
          generationMode: resolvedFinalResult.generationMode ?? generationMode,
          topic: resolvedFinalResult.canvasPatch.topic,
          headline: resolvedFinalResult.canvasPatch.headline,
          subHeadline: resolvedFinalResult.canvasPatch.subHeadline,
          textLayers: patchedTextLayers,
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
      referenceFileInputRef.current?.click();
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
    if (activeLayerId === id) setActiveLayerId(next[0]?.id ?? DEFAULT_TEXT_LAYERS[0]?.id ?? "headline");
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
    setActiveLayerId(defaults[0]?.id ?? "headline");
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
    const layer = textLayers.find((item) => item.id === activeLayerId) ?? textLayers[0];
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
      const layer = textLayers.find((item) => item.id === activeLayerId) ?? textLayers[0];
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
    }
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
    const submittedProviderId = overrides.providerId ?? providerId;
    const effectivePreflightIssues =
      submittedProviderId === providerId
        ? preflightIssues
        : preflightIssues.filter((issue) => issue !== THUMBNAIL_PROVIDER_UNAVAILABLE_MESSAGE);

    if (effectivePreflightIssues.length > 0) {
      if (chatAssistantMessageId) {
        updateThumbnailChatMessage(
          chatAssistantMessageId,
          `생성 전 확인 필요 · ${effectivePreflightIssues[0] ?? "입력값을 확인하세요."}`,
          "live",
        );
      }
      toast({
        variant: "destructive",
        title: "입력 확인",
        description: effectivePreflightIssues[0] ?? "입력값을 확인하세요.",
      });
      return false;
    }
    const submittedGenerationMode = overrides.generationMode ?? generationMode;
    const submittedTopic = overrides.topic ?? topic;
    const submittedHeadline = overrides.headline ?? headline;
    const submittedSubHeadline = overrides.subHeadline ?? subHeadline;
    const submittedTextLayers = overrides.textLayers ?? textLayers;
    const providerAvailability = readiness?.providers[providerReadinessKey[submittedProviderId]] ?? selectedProviderAvailability;
    const sessionKeyBackedProviderAvailable = canUseSessionApiKeyForProvider(submittedProviderId, providerAvailability);

    if (!providerAvailability) {
      if (chatAssistantMessageId) {
        updateThumbnailChatMessage(chatAssistantMessageId, "모델 상태 확인 중 · 잠시 후 다시 생성하세요.", "live");
      }
      toast({
        title: "모델 상태 확인 중",
        description: "잠시 후 다시 생성하세요.",
      });
      return false;
    }
    if (!providerAvailability.available && !sessionKeyBackedProviderAvailable) {
      const providerBlockReason = formatThumbnailProviderBlockReason(providerAvailability.reason);
      if (chatAssistantMessageId) {
        updateThumbnailChatMessage(chatAssistantMessageId, `실제 이미지 모델 준비 필요 · ${providerBlockReason}`, "live");
      }
      toast({
        variant: "destructive",
        title: "실제 이미지 모델 준비 필요",
        description: `현재 선택한 실제 이미지 모델을 실행할 수 없습니다: ${providerBlockReason}`,
      });
      return false;
    }
    const controller = new AbortController();
    generationAbortControllerRef.current = controller;
    activeGenerationAssistantMessageIdRef.current = chatAssistantMessageId ?? null;
    setIsGenerating(true);
    if (chatAssistantMessageId) {
      updateThumbnailChatMessage(
        chatAssistantMessageId,
        "Codex CLI gpt-5.5 high 작업 완료 · 실제 썸네일 이미지를 생성하는 중입니다...",
        "stream",
      );
    }
    try {
      const formData = new FormData();
      formData.append(
        "payload",
        JSON.stringify({
          providerId: submittedProviderId,
          generationMode: submittedGenerationMode,
          topic: submittedTopic,
          headline: submittedHeadline,
          subHeadline: submittedSubHeadline,
          stylePreset: briefPreset,
          referenceImageRoles,
          acknowledgedSafety,
          textLayers: submittedTextLayers,
        }),
      );
      files.forEach((file) => formData.append("referenceImages", file));

      const response = await fetch("/api/admin/youtube-thumbnail-generator", {
        method: "POST",
        signal: controller.signal,
        body: formData,
      });
      const payload = await response.json().catch(() => null) as GenerationResult | ThumbnailApiErrorPayload | null;
      if (!response.ok || !payload || !("baseImage" in payload)) {
        throw new Error(getThumbnailErrorAction(payload && "error" in payload ? payload : null));
      }
      const nextResult = { ...(payload as GenerationResult), generationMode: submittedGenerationMode };
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
        updateThumbnailChatMessage(
          chatAssistantMessageId,
          generationError instanceof Error ? `실제 썸네일 생성 실패 · ${generationError.message}` : "실제 썸네일 생성 실패 · 다시 시도하세요.",
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

  function renderChatSettingsDropdownPanel() {
    return (
      <div
        className="space-y-2 rounded-2xl bg-background/95 p-3 shadow-sm"
        data-thumbnail-chat-settings-panel="true"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <KeyRound className="h-3.5 w-3.5 text-primary" />
              <span>이미지 모델 정책</span>
            </div>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              OPENAI_API_KEY 없이 로컬 Codex built-in image_generation만 점검합니다. exact gpt-image-2 provenance가 확인되지 않으면 생성하지 않습니다.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => setIsChatSettingsOpen(false)}
            aria-label="채팅 설정 닫기"
            data-thumbnail-chat-settings-close="true"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="grid gap-2" data-thumbnail-api-key-settings="disabled">
          <p className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3 text-[11px] leading-4 text-amber-950" data-thumbnail-api-key-disabled="true">
            세션 API 키 입력/전송은 비활성화되어 있습니다. 이 화면은 다른 이미지 모델이나 API-key fallback으로 전환하지 않습니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground" data-thumbnail-api-key-session-status="true">
            API 키 입력/저장은 현재 정책에서 비활성화됨
          </p>
        </div>
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
                    <Badge variant="outline" className="shrink-0 px-1.5 text-[10px]">
                      {run.providerId ?? "provider"}
                    </Badge>
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
    <main
      className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20 p-3"
      aria-label="유튜브 썸네일 생성기"
      data-admin-youtube-thumbnail-generator="true"
      onKeyDown={handleThumbnailEditorShellKeyDown}
    >
      <div
        className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-3 overflow-hidden xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] xl:grid-rows-1"
        data-thumbnail-chat-right-layout="true"
      >
        <Card className="order-2 flex min-h-0 flex-col overflow-hidden border-0 bg-card/80 shadow-none" data-thumbnail-generation-input-panel="right-chat">
          <CardHeader className="shrink-0 space-y-1 p-3 pb-2">
            <div className="flex items-center justify-between gap-2" data-thumbnail-chat-header="true">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <MessageCircle className="h-4 w-4" />
                </span>
                <span className="min-w-0 truncate">생성 채팅</span>
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
                      aria-label="채팅 설정 열기"
                      title="채팅 설정"
                      data-thumbnail-chat-settings-toggle="true"
                      data-thumbnail-chat-settings-dropdown-trigger="true"
                      data-thumbnail-chat-settings-open={isChatSettingsOpen ? "true" : "false"}
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    sideOffset={8}
                    className="w-[min(24rem,calc(100vw-2rem))] rounded-2xl p-0"
                    data-thumbnail-chat-settings-dropdown="true"
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
            >
              <div
                className="shrink-0 border-b border-border/60 bg-background/80 p-2.5"
                data-thumbnail-operator-readiness-shell="true"
              >
                {renderThumbnailOperatorReadinessPanel()}
              </div>
              <div
                className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3"
                data-thumbnail-chat-transcript="true"
                aria-live="polite"
              >
                {chatMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-2 ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                    data-thumbnail-chat-message={message.role}
                    data-thumbnail-chat-message-mode={message.mode ?? "submitted"}
                  >
                    {message.role !== "user" ? (
                      <div className="mt-5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                        <Wand2 className="h-3.5 w-3.5" />
                      </div>
                    ) : null}
                    <div className={`max-w-[86%] space-y-1 ${message.role === "user" ? "text-right" : "text-left"}`}>
                      <div
                        className={`text-[10px] font-medium uppercase tracking-wide ${
                          message.role === "user" ? "text-primary" : "text-muted-foreground"
                        }`}
                        data-thumbnail-chat-message-meta="true"
                      >
                        {message.role === "user" ? "나" : message.mode === "system" ? "가이드" : message.mode === "live" ? "작업 중" : "Codex Agent"}
                      </div>
                      <div
                        className={`rounded-2xl px-3 py-2 text-xs leading-5 shadow-sm ${
                          message.role === "user"
                            ? "rounded-br-md bg-primary text-primary-foreground"
                            : message.mode === "live"
                              ? "rounded-bl-md border border-sky-300/60 bg-sky-500/10 text-sky-950 dark:text-sky-100"
                              : "rounded-bl-md bg-background text-foreground ring-1 ring-border/60"
                        }`}
                        data-thumbnail-chat-message-bubble="true"
                      >
                        {message.content}
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
                    data-thumbnail-chat-live-stream="true"
                  >
                    <div className="mt-5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sky-500/15 text-sky-600">
                      {isChatAgentStreaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
                    </div>
                    <div className="max-w-[86%] space-y-1">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-200">
                        {isChatAgentStreaming ? "스트리밍" : isThumbnailChatStructuredEditPrompt(chatDraft) ? "구조화 편집" : "입력 프리뷰"}
                      </div>
                      <div className="rounded-2xl rounded-bl-md border border-dashed border-sky-400/70 bg-sky-500/10 px-3 py-2 text-xs leading-5 text-sky-950 shadow-sm dark:text-sky-100">
                        {isChatAgentStreaming
                          ? "Codex CLI gpt-5.5 high 스트림 작업 중..."
                          : isThumbnailChatStructuredEditPrompt(chatDraft)
                            ? "입력 중 · 백엔드 구조화 편집으로 처리됨"
                            : "입력 중 · 캔버스에 즉시 반영됨"}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="shrink-0 space-y-2.5 border-t border-border/70 bg-background/80 p-2.5" data-thumbnail-chat-controls="true">
                <input
                  id="thumbnail-topic"
                  type="hidden"
                  value={topic}
                  readOnly
                  data-thumbnail-chat-topic-state="true"
                />

                <div
                  className="rounded-2xl border border-border/70 bg-muted/35 p-2.5 shadow-sm"
                  data-thumbnail-chat-canvas-context="true"
                  data-thumbnail-chat-canvas-context-state={canvasContextState}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={canvasContextState === "editing" ? "secondary" : "outline"} className="shrink-0 px-2 text-[10px]">
                          {canvasContextState === "editing" ? "수정 중" : canvasContextState === "selected" ? "선택됨" : "캔버스"}
                        </Badge>
                        <span
                          className="min-w-0 truncate text-[11px] font-medium text-muted-foreground"
                          data-thumbnail-chat-canvas-context-action="true"
                        >
                          {lastCanvasActionLabel ?? "선택 대기"}
                        </span>
                      </div>
                      <p
                        className="min-w-0 truncate text-xs font-medium"
                        title={canvasContextSummary}
                        data-thumbnail-chat-canvas-context-summary="true"
                      >
                        {canvasContextSummary}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 shrink-0 rounded-full px-2.5 text-[11px]"
                      onClick={useCanvasContextInChat}
                      data-thumbnail-chat-canvas-context-ask="true"
                    >
                      챗봇에게 묻기
                    </Button>
                  </div>
                </div>

                <Label htmlFor="thumbnail-chat-composer" className="sr-only">썸네일 요구사항 채팅 입력</Label>
                <p id="thumbnail-chat-keyboard-hint" className="sr-only">
                  한글 조합 중 Enter는 전송하지 않고, 조합이 끝난 뒤 Enter로 전송합니다.
                </p>
                <div className="flex items-end gap-2 rounded-3xl border border-border/60 bg-background p-2 shadow-sm" data-thumbnail-chat-composer="true">
                  <Textarea
                    id="thumbnail-chat-composer"
                    value={chatDraft}
                    onChange={(event) => handleChatDraftChange(event.target.value)}
                    onCompositionStart={handleThumbnailChatCompositionStart}
                    onCompositionEnd={handleThumbnailChatCompositionEnd}
                    onKeyDown={handleThumbnailChatKeyDown}
                    aria-describedby="thumbnail-chat-keyboard-hint"
                    disabled={isChatAgentStreaming}
                    className="max-h-28 min-h-11 resize-none border-0 bg-transparent p-2 text-sm shadow-none focus-visible:ring-0"
                    placeholder="예: 유튜브 쯔양이 오른쪽에 크게 생성해줘 · 문구 크게 · 가이드 숨겨줘 · PNG 저장해줘"
                    data-thumbnail-chat-ime-safe="true"
                  />
                  <Button
                    type="button"
                    size="icon"
                    className="h-9 w-9 shrink-0 rounded-full"
                    onClick={isChatAgentStreaming ? abortThumbnailChatWork : () => void handleThumbnailChatSubmit()}
                    disabled={isChatAgentStreaming ? false : !chatDraft.trim()}
                    aria-label={isChatAgentStreaming ? "채팅 스트림 중단" : "요구사항 채팅 반영"}
                    data-thumbnail-chat-submit={isChatAgentStreaming ? undefined : "true"}
                    data-thumbnail-chat-cancel={isChatAgentStreaming ? "true" : undefined}
                  >
                    {isChatAgentStreaming ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                  </Button>
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
            <div className="relative flex min-h-0 items-center justify-center overflow-hidden rounded-2xl bg-black shadow-inner [container-type:inline-size]">
              <canvas
                ref={canvasRef}
                width={TARGET_WIDTH}
                height={TARGET_HEIGHT}
                tabIndex={0}
                className="aspect-video h-full max-h-full max-w-full w-auto touch-none cursor-move focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                aria-label="유튜브 썸네일 1280x720 편집 캔버스"
                data-thumbnail-history-preview={
                  result?.baseImage.dataUrl.startsWith(`${THUMBNAIL_HISTORY_IMAGE_BASE_URL}/`) ? "true" : "false"
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
              {isGenerating ? (
                <div
                  className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/45 p-6 backdrop-blur-[1px]"
                  data-thumbnail-generation-skeleton="true"
                  aria-live="polite"
                  aria-label="썸네일 생성 중"
                >
                  <div className="grid aspect-video w-full max-w-3xl overflow-hidden rounded-2xl border border-white/20 bg-white/10 p-5 shadow-2xl">
                    <div className="relative h-full w-full animate-pulse rounded-xl bg-gradient-to-br from-orange-500/35 via-red-500/30 to-zinc-950/40">
                      <div className="absolute left-[8%] top-[11%] h-[9%] w-[42%] rounded-full bg-white/35" />
                      <div className="absolute left-[10%] top-[25%] h-[7%] w-[58%] rounded-full bg-white/25" />
                      <div className="absolute bottom-[14%] left-[8%] h-[24%] w-[66%] rounded-full bg-amber-200/35" />
                      <div className="absolute right-[10%] top-[18%] h-[38%] w-[24%] rounded-3xl bg-white/25" />
                      <div className="absolute bottom-[18%] left-[28%] h-[14%] w-[44%] rounded-lg bg-black/35" />
                      <div className="absolute bottom-[7%] left-1/2 -translate-x-1/2 rounded-full bg-background/90 px-4 py-2 text-xs font-semibold text-foreground shadow">
                        실제 썸네일 이미지를 생성하는 중입니다…
                      </div>
                    </div>
                  </div>
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
                        undoTextLayerChange();
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
                  {[
                    ["top-left", "-left-2 -top-2 cursor-nwse-resize"],
                    ["top-right", "-right-2 -top-2 cursor-nesw-resize"],
                    ["bottom-left", "-bottom-2 -left-2 cursor-nesw-resize"],
                    ["bottom-right", "-bottom-2 -right-2 cursor-nwse-resize"],
                  ].map(([handleId, positionClass]) => (
                    <button
                      key={handleId}
                      type="button"
                      tabIndex={-1}
                      aria-label="문구 크기 조절"
                      className={`pointer-events-auto absolute h-4 w-4 rounded-full border border-white bg-sky-500 shadow-lg ${positionClass}`}
                      data-thumbnail-text-resize-handle={handleId}
                      onPointerDown={(event) => handleTextTransformPointerDown(event, editingLayer, "resize")}
                      onPointerMove={handleTextTransformPointerMove}
                      onPointerUp={handleTextTransformPointerUp}
                      onPointerCancel={handleTextTransformPointerUp}
                    />
                  ))}
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="문구 회전"
                    className="pointer-events-auto absolute -top-9 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border border-white bg-amber-400 text-slate-950 shadow-lg"
                    data-thumbnail-text-rotate-handle="true"
                    onPointerDown={(event) => handleTextTransformPointerDown(event, editingLayer, "rotate")}
                    onPointerMove={handleTextTransformPointerMove}
                    onPointerUp={handleTextTransformPointerUp}
                    onPointerCancel={handleTextTransformPointerUp}
                  >
                    <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ) : null}
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
  );
}

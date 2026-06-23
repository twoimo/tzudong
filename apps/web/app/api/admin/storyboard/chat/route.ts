import { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import type { StoryboardThinkingTraceEntry } from '@/lib/admin/storyboard/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const streamHeaders = {
  'Cache-Control': 'no-store, no-transform',
  'Content-Type': 'text/event-stream; charset=utf-8',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

function encodeSse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function jsonError(error: string, status: number, detail?: string) {
  return Response.json({ error, detail }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function normalizeRouteError(error: unknown) {
  console.error('[admin/storyboard/chat] unexpected failure:', error);
  return {
    error: 'storyboard_chat_agent_failed',
    detail: error instanceof Error ? error.message : '채팅 작업을 처리하지 못했습니다.',
    status: 500,
  };
}
type StoryboardChatAgentResultForRoute = {
  assistantMessage: string;
  canvasPatch: {
    segmentCount?: number;
    targetLengthMinutes?: number;
    focusSceneNo?: number;
    unavailableFocusSceneNo?: number;
    scenePatch?: {
      sceneNo?: number;
      regenerateImage?: boolean;
    };
  };
  shouldGenerate: boolean;
  shouldGenerateImages?: boolean;
  shouldReset: boolean;
  backendAgent: {
    diagnostics: Record<string, unknown> & {
      chatIntent?: unknown;
    };
  };
};


function toPublicStoryboardChatAgentResult(
  result: StoryboardChatAgentResultForRoute,
) {
  return {
    assistantMessage: result.assistantMessage,
    canvasPatch: result.canvasPatch,
    shouldGenerate: result.shouldGenerate,
    shouldGenerateImages: result.shouldGenerateImages ?? result.shouldGenerate,
    shouldReset: result.shouldReset,
  };
}

type StoryboardChatPayload = Record<string, unknown>;
type SseSend = (event: string, data: unknown) => void;
type StoryboardRouteTraceStatus = StoryboardThinkingTraceEntry['status'];

type StoryboardChatImageAttachmentForRoute = {
  id: string;
  name: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  size: number;
  dataUrl: string;
  width?: number;
  height?: number;
};

type StoryboardChatConversationMessageForRoute = {
  role: 'user' | 'assistant';
  content: string;
  id?: string;
  createdAt?: string;
};

const CONVERSATION_STREAM_CHUNK_SIZE = 14;
const CONVERSATION_STREAM_DELAY_MS = 12;
const STORYBOARD_CHAT_IMAGE_ATTACHMENT_LIMIT = 3;
const STORYBOARD_CHAT_IMAGE_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
const STORYBOARD_CHAT_IMAGE_ATTACHMENT_MAX_DATA_URL_LENGTH = 6_000_000;
const STORYBOARD_CHAT_IMAGE_ATTACHMENT_ONLY_MESSAGE =
  '첨부한 사진을 참고해서 스토리보드 방향을 제안해줘.';
const STORYBOARD_CHAT_IMAGE_ATTACHMENT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
] as const);
const STORYBOARD_CHAT_CONVERSATION_MESSAGE_LIMIT = 8;
const STORYBOARD_CHAT_CONVERSATION_CONTENT_LIMIT = 320;

function shouldSkipLocalStoryboardBackendAgentOnVercel() {
  return (
    process.env.VERCEL === '1' &&
    !process.env.STORYBOARD_AGENT_COMMAND?.trim() &&
    !process.env.STORYBOARD_AGENT_ROOT?.trim()
  );
}

function sanitizeStatusText(value: unknown, maxLength = 90) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function createRouteTraceEntry({
  id,
  label,
  status,
  detail,
}: {
  id: string;
  label: string;
  status: StoryboardRouteTraceStatus;
  detail?: unknown;
}): StoryboardThinkingTraceEntry {
  return {
    id: sanitizeStatusText(id, 80) || `route-trace-${Date.now()}`,
    label: sanitizeStatusText(label, 80) || '처리 단계',
    status,
    ...(detail ? { detail: sanitizeStatusText(detail, 180) } : {}),
    timestamp: new Date().toISOString(),
  };
}

function sendTrace(
  send: SseSend,
  entry: Parameters<typeof createRouteTraceEntry>[0],
) {
  send('trace', createRouteTraceEntry(entry));
}

function normalizeRouteConversationMessages(value: unknown):
  | {
      ok: true;
      conversationMessages: StoryboardChatConversationMessageForRoute[];
    }
  | { ok: false; error: string; detail: string; status: number } {
  if (value == null) return { ok: true, conversationMessages: [] };
  if (!Array.isArray(value)) {
    return {
      ok: false,
      error: 'conversation_messages_invalid',
      detail: '이전 대화 목록 형식이 올바르지 않습니다.',
      status: 400,
    };
  }

  const conversationMessages: StoryboardChatConversationMessageForRoute[] = value
    .slice(-STORYBOARD_CHAT_CONVERSATION_MESSAGE_LIMIT)
    .flatMap((item): StoryboardChatConversationMessageForRoute[] => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const candidate = item as Record<string, unknown>;
      const role =
        candidate.role === 'user' || candidate.role === 'assistant'
          ? candidate.role
          : null;
      const content = sanitizeStatusText(
        candidate.content,
        STORYBOARD_CHAT_CONVERSATION_CONTENT_LIMIT,
      );
      if (!role || !content) return [];
      const id = sanitizeStatusText(candidate.id, 80);
      const createdAt = sanitizeStatusText(candidate.createdAt, 80);
      return [
        {
          role,
          content,
          ...(id ? { id } : {}),
          ...(createdAt ? { createdAt } : {}),
        },
      ];
    });

  return { ok: true, conversationMessages };
}

function normalizeRouteImageAttachmentName(value: unknown) {
  const normalized = sanitizeStatusText(value, 80);
  return normalized || '첨부 사진';
}

function normalizeRouteImageAttachments(value: unknown):
  | { ok: true; attachments: StoryboardChatImageAttachmentForRoute[] }
  | { ok: false; error: string; detail: string; status: number } {
  if (value == null) return { ok: true, attachments: [] };
  if (!Array.isArray(value)) {
    return {
      ok: false,
      error: 'image_attachments_invalid',
      detail: '사진 첨부 목록 형식이 올바르지 않습니다.',
      status: 400,
    };
  }
  if (value.length > STORYBOARD_CHAT_IMAGE_ATTACHMENT_LIMIT) {
    return {
      ok: false,
      error: 'image_attachments_too_many',
      detail: `사진은 최대 ${STORYBOARD_CHAT_IMAGE_ATTACHMENT_LIMIT}장까지 첨부할 수 있습니다.`,
      status: 400,
    };
  }

  const attachments: StoryboardChatImageAttachmentForRoute[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return {
        ok: false,
        error: 'image_attachment_invalid',
        detail: '첨부 사진 정보가 올바르지 않습니다.',
        status: 400,
      };
    }
    const candidate = item as Record<string, unknown>;
    const mimeType = candidate.mimeType;
    const dataUrl = candidate.dataUrl;
    const size = Number(candidate.size);
    if (
      typeof mimeType !== 'string' ||
      !STORYBOARD_CHAT_IMAGE_ATTACHMENT_MIME_TYPES.has(
        mimeType as StoryboardChatImageAttachmentForRoute['mimeType'],
      ) ||
      typeof dataUrl !== 'string' ||
      !dataUrl.startsWith(`data:${mimeType};base64,`) ||
      dataUrl.length > STORYBOARD_CHAT_IMAGE_ATTACHMENT_MAX_DATA_URL_LENGTH ||
      !Number.isFinite(size) ||
      size <= 0 ||
      size > STORYBOARD_CHAT_IMAGE_ATTACHMENT_MAX_BYTES
    ) {
      return {
        ok: false,
        error: 'image_attachment_invalid',
        detail: '첨부 사진은 PNG, JPG, WebP 형식의 4MB 이하 파일만 가능합니다.',
        status: 400,
      };
    }
    const width = Number(candidate.width);
    const height = Number(candidate.height);
    attachments.push({
      id:
        sanitizeStatusText(candidate.id, 80) ||
        `storyboard-chat-image-${attachments.length + 1}`,
      name: normalizeRouteImageAttachmentName(candidate.name),
      mimeType: mimeType as StoryboardChatImageAttachmentForRoute['mimeType'],
      size: Math.trunc(size),
      dataUrl,
      ...(Number.isFinite(width) && width > 0
        ? { width: Math.trunc(width) }
        : {}),
      ...(Number.isFinite(height) && height > 0
        ? { height: Math.trunc(height) }
        : {}),
    });
  }
  return { ok: true, attachments };
}


function getRoutePayloadNumber(payload: StoryboardChatPayload, key: string) {
  const value = Number(payload[key]);
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

function getRouteFocusSummary(payload: StoryboardChatPayload) {
  const focusContext = payload.focusContext;
  if (!focusContext || typeof focusContext !== 'object' || Array.isArray(focusContext)) {
    return '현재 화면 기준';
  }
  const candidate = focusContext as { kind?: unknown; label?: unknown; sceneNo?: unknown };
  const label = sanitizeStatusText(candidate.label, 48);
  const sceneNo = Number(candidate.sceneNo);
  if (candidate.kind === 'cut' && Number.isFinite(sceneNo)) {
    return `CUT ${String(Math.trunc(sceneNo)).padStart(2, '0')} 선택 기준`;
  }
  return label ? `${label} 기준` : '현재 화면 기준';
}

function getRouteRequestSummary(payload: StoryboardChatPayload) {
  const message = sanitizeStatusText(payload.message, 54);
  const imageAttachmentCount = Array.isArray(payload.imageAttachments)
    ? payload.imageAttachments.length
    : 0;
  const segmentCount =
    getRoutePayloadNumber(payload, 'currentSegmentCount') ??
    getRoutePayloadNumber(payload, 'currentAvailableSceneCount');
  const targetLength = getRoutePayloadNumber(payload, 'currentTargetLengthMinutes');
  return [
    message ? `요청: “${message}”` : '채팅 요청',
    imageAttachmentCount ? `사진 ${imageAttachmentCount}장 첨부` : null,
    segmentCount ? `${segmentCount}컷 흐름` : null,
    targetLength ? `${targetLength}분 안팎` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
function normalizeRouteChatMessage(message: string) {
  return message.replace(/\s+/g, ' ').trim();
}

function isRouteCasualStoryboardChatMessage(message: string) {
  const normalized = normalizeRouteChatMessage(message);
  if (!normalized) return false;
  const compact = normalized.replace(/[\s!?.,。~…]+/g, '').toLowerCase();
  return /^(ㅎㅇ+|하이+|안녕|안녕하세(?:요|여)|안뇽|hi|hello|hey|yo)$/.test(compact);
}

function isRouteStoryboardGenerationQuestion(message: string) {
  return /[?？]/.test(message) || /(?:얼마나|언제|어떻게|왜|무엇|뭐|뭔가|어디|가능|필요|되나|되나요|돼|돼요|될까|걸려|걸리|알려|설명|방법|하려면|하면\s*돼)/i.test(message);
}

function hasRouteStoryboardFullGenerationNegation(message: string) {
  const compact = message.replace(/[\s!?.,。~…]+/g, '').toLowerCase();
  return (
    /^(하지마|하지말아|생성하지마|생성하지말아|만들지마|만들지말아|구성하지마|구성하지말아|생성금지|멈춰|중단|stop|cancel)$/.test(compact) ||
    /(?:스토리보드|컷|cut|장면|구성|흐름|전체)[^.!?\n]{0,36}(?:생성|만들|구성|작성|뽑|실행|반영)\s*지?\s*(?:마|말|말고|마세요|말아|않|안\s*해|금지|중단|멈춰)/i.test(
      message,
    )
  );
}

function hasRouteStoryboardImageGenerationNegation(message: string) {
  return (
    /(?:이미지|컷\s*이미지|스토리보드\s*이미지)[^.!?\n]{0,36}(?:만들|생성|재생성|실행)\s*지?\s*(?:마|말|말고|마세요|말아|않|안\s*해|금지|중단|멈춰|나중)/i.test(
      message,
    ) ||
    /(?:이미지|컷\s*이미지|스토리보드\s*이미지)(?:는|은|를|을)?[^.!?\n]{0,28}(?:나중|다음에|추후|후에|아직)[^.!?\n]{0,28}(?:만들|생성|재생성|실행|하자|할게|해|진행)?/i.test(
      message,
    ) ||
    /(?:이미지|컷\s*이미지|스토리보드\s*이미지)\s*(?:없이|빼고|제외|나중|아직\s*말고|필요\s*없)/i.test(
      message,
    )
  );
}

function wantsRouteStoryboardGeneration(message: string) {
  if (hasRouteStoryboardFullGenerationNegation(message)) return false;
  const explicitCommand =
    /(?:생성|만들|구성|작성|뽑|실행)\s*(?:해\s*)?(?:줘|주세요|줘요|주라|줘라)/i.test(message) ||
    /(?:짜\s*줘|짜\s*주세요|만들어\s*(?:줘|주세요|줘요|주라|줘라)|뽑아\s*(?:줘|주세요|줘요|주라|줘라)?|반영해\s*(?:줘|주세요|줘요)?)/i.test(message);
  if (explicitCommand) return true;
  if (hasRouteStoryboardImageGenerationNegation(message)) return false;
  if (isRouteStoryboardGenerationQuestion(message)) return false;
  return (
    /(?:예시\s*만들기|예시\s*(?:보여줘|보여\s*줘|보여주세요)|생성\s*시작|생성\s*실행|스토리보드\s*실행|이미지\s*실행)/i.test(message) ||
    /(?:스토리보드|컷|cut|이미지).*(?:생성|만들|짜|구성|뽑|작성|실행)|(?:생성|만들|짜|구성|뽑|작성|실행).*(?:스토리보드|컷|cut|이미지)/i.test(message) ||
    /(?:생성해|만들어|구성해|작성해|뽑아|실행해|짜줘|짜\s*줘)$/i.test(message.trim())
  );
}

function hasRouteStoryboardMutationCommand(message: string) {
  return (
    /(?:초기화|리셋|reset)/i.test(message) ||
    wantsRouteStoryboardGeneration(message) ||
    /(?:수정|변경|바꿔|바꿔줘|고쳐|보완|짧게|줄여|재생성|다시\s*생성|보여줘|이동|가줘|열어|선택|포커스|focus|show|open)/i.test(message)
  );
}

function hasRouteStoryboardDirectPatchCommandLanguage(message: string) {
  return /(?:수정|변경|바꿔|바꿔줘|고쳐|보완|짧게|줄여|교체|재작성|다시\s*써|반영해|반영해\s*줘)/i.test(
    message,
  );
}

function isRouteStoryboardSuggestionConversation(message: string) {
  if (/(검토|리뷰|평가|피드백)/i.test(message)) return false;
  if (
    hasRouteStoryboardDirectPatchCommandLanguage(message) &&
    !/(?:추천|아이디어|예시|후보|방법|어떻게|어떤|뭐가\s*좋)/i.test(message)
  ) {
    return false;
  }
  if (
    /(?:스토리보드|컷|cut|장면|구성|흐름).*(?:생성해|생성\s*해|만들어|구성해|작성해|반영해|짜줘|짜\s*줘|뽑아)/i.test(
      message,
    ) ||
    /(?:생성해|생성\s*해|만들어|구성해|작성해|반영해|짜줘|짜\s*줘|뽑아).*(?:스토리보드|컷|cut|장면|구성|흐름)/i.test(
      message,
    )
  ) {
    return false;
  }
  return (
    /(?:추천|아이디어|메뉴|소재|주제|컨셉|방향|흐름|분위기|스타일|톤|무드|레퍼런스|자막|문구|카피|오디오|멘트|대사|나레이션|후킹|훅|샷|장면|비주얼|맛|식감|조명|색감).*(?:해줘|줘|있|좋|어때|뭐|궁금|알려|추천|예시|후보)/i.test(message) ||
    /(?:뭐\s*먹(?:지|을까|으면|을지)?|무슨\s*메뉴|어떤\s*(?:주제|소재|컨셉|방향|흐름)).*(?:좋|추천|있|어때|\?)/i.test(message) ||
    /(?:영상|스토리보드).*(?:어떤|무슨).*(?:흐름|방향).*(?:좋|어때|\?)/i.test(message)
  );
}

function isRouteStoryboardFieldQuestion(message: string) {
  if (/(검토|리뷰|평가|피드백)/i.test(message)) return false;
  if (!/[?？]|(?:해야|해도|넣어야|필요|가능|되나|되나요|돼|돼요|될까|어디|어떻게|방법|알려|설명|꼭|잘\s*보)/i.test(message)) {
    return false;
  }
  const directCommand =
    /(?:수정|변경|바꿔|바꿔줘|고쳐|보완|짧게|줄여|줄여줘|보이게\s*바꿔|생성해줘|만들어줘|만들어\s*줘)$/i.test(
      message.trim(),
    );
  const explanationIntent =
    /(?:해야|해도|넣어야|필요|가능|되나|되나요|돼|돼요|될까|어디|어떻게|방법|알려|설명|꼭|잘\s*보)/i.test(
      message,
    );
  if (directCommand && !explanationIntent) return false;
  return /(?:자막|subtitle|문구|카피|caption|오디오|멘트|대사|나레이션|이미지|컷|cut|스토리보드|PNG|저장|다운로드|복사|장면|음식|구도|화면|비주얼|리액션|표정|훅|맛있|먹음직|식감|조명|색감|분위기|톤|무드)/i.test(message);
}

function isRouteStoryboardReviewRequest(message: string) {
  if (wantsRouteStoryboardGeneration(message) || /(?:초기화|리셋|reset)/i.test(message)) return false;
  if (isRouteStoryboardSuggestionConversation(message) || isRouteStoryboardFieldQuestion(message)) return false;
  return /(검토|리뷰|평가|피드백|설명|알려줘|요약|정리|괜찮|어때|확인)/i.test(message);
}

function isRouteGeneralStoryboardConversationMessage(message: string) {
  const normalized = normalizeRouteChatMessage(message);
  if (!normalized || isRouteCasualStoryboardChatMessage(normalized)) return false;

  const compact = normalized.replace(/[\s!?.,。~…]+/g, '').toLowerCase();
  if (/^(고마워|고맙|감사|감사해|땡큐|thanks|thankyou|ok|okay|ㅇㅋ|오케이|좋아|좋습니다|괜찮아|ㅋㅋ+|ㅎㅎ+|굿|nice)$/.test(compact)) {
    return true;
  }

  if (/^(멈춰|중단|취소|그만|stop|cancel)$/.test(compact)) {
    return true;
  }

  if (/(뭐\s*할\s*수|무엇을\s*할\s*수|사용법|도움말|도와줘|처음(?:인데|이면)?|시작(?:하려면|하는\s*법)?|뭘\s*입력|무슨\s*말|help|what can you do|how do i use)/i.test(normalized)) {
    return true;
  }

  if (/(?:오류|에러|실패|안\s*돼|안됨|문제|멈췄|느려|느림|작동|권한|permission|denied|clipboard|클립보드|복사).*(?:왜|뭐|어떻게|가능|해결|확인|알려|설명|\?)/i.test(normalized)) {
    return true;
  }

  if (/(?:얼마나|언제|대기|기다|진행|상태|설정|연결|브릿지|토큰|키|provider|이미지|컷|cut).*(?:걸려|걸리|돼|되나|가능|필요|어디|뭐|뭔가|알려|설명|\?)/i.test(normalized)) {
    return true;
  }

  if (isRouteStoryboardSuggestionConversation(normalized)) return true;

  if (isRouteStoryboardFieldQuestion(normalized)) return true;

  if (/(?:너|도우미|챗봇).*(?:누구|뭐야|무엇|가능|할 수|답변|대화)/i.test(normalized)) {
    return true;
  }

  if (hasRouteStoryboardMutationCommand(normalized)) return false;

  return /[?？]$/.test(normalized);
}
function isConversationRequest(payload: StoryboardChatPayload) {
  const message = String(payload.message ?? '');
  return (
    isRouteCasualStoryboardChatMessage(message) ||
    isRouteGeneralStoryboardConversationMessage(message)
  );
}

function isReviewRequest(payload: StoryboardChatPayload) {
  const message = String(payload.message ?? '');
  return isRouteStoryboardReviewRequest(normalizeRouteChatMessage(message));
}

function isConversationResult(
  result: StoryboardChatAgentResultForRoute,
) {
  const chatIntent = String(result.backendAgent.diagnostics.chatIntent ?? '');
  return chatIntent === 'casual_chat' || chatIntent === 'conversation';
}

function isAnswerOnlyResult(
  result: StoryboardChatAgentResultForRoute,
) {
  const chatIntent = String(result.backendAgent.diagnostics.chatIntent ?? '');
  return isConversationResult(result) || chatIntent === 'review';
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function streamConversationMessage(send: SseSend, message: string) {
  const characters = Array.from(message);
  let rendered = '';
  for (
    let index = 0;
    index < characters.length;
    index += CONVERSATION_STREAM_CHUNK_SIZE
  ) {
    rendered += characters
      .slice(index, index + CONVERSATION_STREAM_CHUNK_SIZE)
      .join('');
    send('status', { message: rendered });
    await wait(CONVERSATION_STREAM_DELAY_MS);
  }
}


function getInitialStatusMessages(payload: StoryboardChatPayload) {
  const imageAttachmentCount = Array.isArray(payload.imageAttachments)
    ? payload.imageAttachments.length
    : 0;
  if (imageAttachmentCount > 0 && (isConversationRequest(payload) || isReviewRequest(payload))) {
    return [`${getRouteRequestSummary(payload)}을 확인하고 있어요.`];
  }
  if (isConversationRequest(payload) || isReviewRequest(payload)) return [];

  const focusSummary = getRouteFocusSummary(payload);
  return [
    `${getRouteRequestSummary(payload)}을 확인하고 있어요.`,
    `${focusSummary}에서 바꿀 부분을 찾고 있어요.`,
    '곧 화면에 바로 반영할게요.',
  ];
}

function getResolvedStatusMessage(
  result: StoryboardChatAgentResultForRoute,
) {
  if (isAnswerOnlyResult(result)) return result.assistantMessage;
  const patch = result.canvasPatch;
  const sceneNo = patch.scenePatch?.sceneNo;
  const intent = result.shouldReset
    ? '초기화'
    : result.shouldGenerate
      ? '스토리보드 생성'
      : patch.scenePatch?.regenerateImage
        ? '선택 CUT 이미지 재생성'
        : patch.scenePatch
          ? '선택 CUT 수정'
          : patch.focusSceneNo
            ? 'CUT 화면 이동'
            : patch.unavailableFocusSceneNo
              ? '없는 CUT 안내'
              : '검토/설명';
  const scope = sceneNo
    ? `CUT ${String(sceneNo).padStart(2, '0')}`
    : `${patch.segmentCount}컷 · 약 ${patch.targetLengthMinutes}분`;
  return `${intent} 작업으로 이해했어요. ${scope} 기준으로 화면에 반영할게요.`;
}

function getRouteAgentTraceDetail(result: StoryboardChatAgentResultForRoute) {
  const diagnostics = result.backendAgent.diagnostics;
  const intent = sanitizeStatusText(diagnostics.chatIntent, 40) || 'unknown';
  const imageAction =
    sanitizeStatusText(diagnostics.imageGenerationAction, 40) ||
    (result.shouldGenerateImages === false
      ? 'skip_images'
      : result.shouldGenerate
        ? 'generate_images'
        : 'no_image_action');
  const turnCount = Number(diagnostics.conversationTurnCount);
  return [
    `의도 ${intent}`,
    `이미지 단계 ${imageAction}`,
    Number.isFinite(turnCount) && turnCount > 0
      ? `최근 대화 ${Math.trunc(turnCount)}개 반영`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function getRouteDecisionTraceDetail(result: StoryboardChatAgentResultForRoute) {
  const patch = result.canvasPatch;
  if (result.shouldReset) return '입력 상태를 초기화하는 요청으로 분류';
  if (result.shouldGenerate) {
    return result.shouldGenerateImages === false
      ? `${patch.segmentCount}컷 구성 생성 · CUT 이미지는 사용자 요청으로 생략`
      : `${patch.segmentCount}컷 구성 생성 · 이후 CUT 이미지 생성 단계로 연결`;
  }
  if (patch.scenePatch?.regenerateImage) {
    return `CUT ${String(patch.scenePatch.sceneNo).padStart(2, '0')} 이미지 재생성`;
  }
  if (patch.scenePatch) {
    return `CUT ${String(patch.scenePatch.sceneNo).padStart(2, '0')} 멘트·자막·구도 보정`;
  }
  if (patch.focusSceneNo) {
    return `CUT ${String(patch.focusSceneNo).padStart(2, '0')} 화면 이동`;
  }
  return '대화 답변 또는 현재 화면 검토';
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
  if (!auth.ok) return auth.response;

  const payload = await request.json().catch(() => null) as unknown;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return jsonError('payload_json_invalid', 400, '채팅 요청 JSON이 필요합니다.');
  }
  const imageAttachmentResult = normalizeRouteImageAttachments(
    (payload as { imageAttachments?: unknown }).imageAttachments,
  );
  if (!imageAttachmentResult.ok) {
    return jsonError(
      imageAttachmentResult.error,
      imageAttachmentResult.status,
      imageAttachmentResult.detail,
    );
  }
  const conversationMessageResult = normalizeRouteConversationMessages(
    (payload as { conversationMessages?: unknown }).conversationMessages,
  );
  if (!conversationMessageResult.ok) {
    return jsonError(
      conversationMessageResult.error,
      conversationMessageResult.status,
      conversationMessageResult.detail,
    );
  }
  const message = (payload as { message?: unknown }).message;
  const normalizedMessage = typeof message === 'string' ? message.trim() : '';
  if (!normalizedMessage && imageAttachmentResult.attachments.length === 0) {
    return jsonError('message_required', 400, '채팅에 반영할 내용을 입력해 주세요.');
  }
  const normalizedPayload: StoryboardChatPayload = {
    ...(payload as StoryboardChatPayload),
    message: normalizedMessage || STORYBOARD_CHAT_IMAGE_ATTACHMENT_ONLY_MESSAGE,
    imageAttachments: imageAttachmentResult.attachments,
    conversationMessages: conversationMessageResult.conversationMessages,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(encodeSse(event, data)));
      };

      try {
        sendTrace(send, {
          id: 'route-received',
          label: '서버 요청 수신',
          status: 'done',
          detail: getRouteRequestSummary(normalizedPayload),
        });
        for (const statusMessage of getInitialStatusMessages(normalizedPayload)) {
          send('status', { message: statusMessage });
        }
        if (shouldSkipLocalStoryboardBackendAgentOnVercel()) {
          throw new Error('Vercel production does not include the local storyboard backend agent. Configure STORYBOARD_AGENT_COMMAND to enable storyboard chat.');
        }
        sendTrace(send, {
          id: 'route-agent',
          label: '채팅 에이전트 실행',
          status: 'running',
          detail: '의도 분류, 화면 반영안, 이미지 생성 여부를 계산 중',
        });
        const { generateStoryboardChatWithBackendAgent } = await import('@/lib/admin/storyboard/backend-agent');
        const result = await generateStoryboardChatWithBackendAgent(
          normalizedPayload as Parameters<typeof generateStoryboardChatWithBackendAgent>[0],
          process.env,
        ) as StoryboardChatAgentResultForRoute;
        const publicResult = toPublicStoryboardChatAgentResult(result);
        sendTrace(send, {
          id: 'route-agent',
          label: '채팅 에이전트 실행',
          status: 'done',
          detail: getRouteAgentTraceDetail(result),
        });
        sendTrace(send, {
          id: 'route-decision',
          label: '화면 반영 결정',
          status: 'done',
          detail: getRouteDecisionTraceDetail(result),
        });
        if (isAnswerOnlyResult(result)) {
          sendTrace(send, {
            id: 'route-answer-stream',
            label: '답변 스트리밍',
            status: 'running',
            detail: '대화형 답변을 말풍선에 순차 표시',
          });
          await streamConversationMessage(send, result.assistantMessage);
          sendTrace(send, {
            id: 'route-answer-stream',
            label: '답변 스트리밍',
            status: 'done',
            detail: '대화형 답변 표시 완료',
          });
        } else {
          send('status', { message: getResolvedStatusMessage(result) });
        }
        send('patch', publicResult);
        send('done', publicResult);
      } catch (error) {
        sendTrace(send, {
          id: 'route-agent',
          label: '채팅 에이전트 실행',
          status: 'failed',
          detail: error instanceof Error ? error.message : '채팅 처리 실패',
        });
        send('error', normalizeRouteError(error));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: streamHeaders });
}

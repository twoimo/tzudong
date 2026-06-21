import { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';

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
  shouldReset: boolean;
  backendAgent: {
    diagnostics: {
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
    shouldReset: result.shouldReset,
  };
}

type StoryboardChatPayload = Record<string, unknown>;
type SseSend = (event: string, data: unknown) => void;

const CONVERSATION_STREAM_CHUNK_SIZE = 14;
const CONVERSATION_STREAM_DELAY_MS = 12;

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
  const segmentCount =
    getRoutePayloadNumber(payload, 'currentSegmentCount') ??
    getRoutePayloadNumber(payload, 'currentAvailableSceneCount');
  const targetLength = getRoutePayloadNumber(payload, 'currentTargetLengthMinutes');
  return [
    message ? `요청: “${message}”` : '채팅 요청',
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

function hasRouteStoryboardMutationCommand(message: string) {
  return (
    /(생성|만들|짜줘|구성해|구성|실행|뽑아|스토리보드|초기화|리셋|reset)/i.test(message) ||
    /(?:수정|변경|바꿔|바꿔줘|고쳐|보완|짧게|줄여|재생성|다시\s*생성|생성해|만들어\s*줘|만들어줘|구성해|짜줘|뽑아|보여줘|이동|가줘|열어|선택|포커스|focus|show|open|해줘)/i.test(message)
  );
}

function isRouteGeneralStoryboardConversationMessage(message: string) {
  const normalized = normalizeRouteChatMessage(message);
  if (!normalized || isRouteCasualStoryboardChatMessage(normalized)) return false;
  if (hasRouteStoryboardMutationCommand(normalized)) return false;

  const compact = normalized.replace(/[\s!?.,。~…]+/g, '').toLowerCase();
  if (/^(고마워|고맙|감사|감사해|땡큐|thanks|thankyou|ok|okay|ㅇㅋ|오케이|좋아|좋습니다|괜찮아|ㅋㅋ+|ㅎㅎ+|굿|nice)$/.test(compact)) {
    return true;
  }

  if (/(뭐\s*할\s*수|무엇을\s*할\s*수|사용법|도움말|도와줘|help|what can you do|how do i use)/i.test(normalized)) {
    return true;
  }

  if (/(?:얼마나|언제|대기|기다|진행|상태|설정|연결|브릿지|토큰|키|provider|이미지|컷|cut).*(?:걸려|걸리|돼|되나|가능|필요|어디|뭐|뭔가|알려|설명|\?)/i.test(normalized)) {
    return true;
  }

  return /[?？]$/.test(normalized);
}
function isConversationRequest(payload: StoryboardChatPayload) {
  const message = String(payload.message ?? '');
  return (
    isRouteCasualStoryboardChatMessage(message) ||
    isRouteGeneralStoryboardConversationMessage(message)
  );
}

function isConversationResult(
  result: StoryboardChatAgentResultForRoute,
) {
  const chatIntent = String(result.backendAgent.diagnostics.chatIntent ?? '');
  return chatIntent === 'casual_chat' || chatIntent === 'conversation';
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
  if (isConversationRequest(payload)) return [];

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
  if (isConversationResult(result)) return result.assistantMessage;
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

export async function POST(request: NextRequest) {
  const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
  if (!auth.ok) return auth.response;

  const payload = await request.json().catch(() => null) as unknown;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return jsonError('payload_json_invalid', 400, '채팅 요청 JSON이 필요합니다.');
  }
  const message = (payload as { message?: unknown }).message;
  if (typeof message !== 'string' || !message.trim()) {
    return jsonError('message_required', 400, '채팅에 반영할 내용을 입력해 주세요.');
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(encodeSse(event, data)));
      };

      try {
        for (const statusMessage of getInitialStatusMessages(payload as StoryboardChatPayload)) {
          send('status', { message: statusMessage });
        }
        if (shouldSkipLocalStoryboardBackendAgentOnVercel()) {
          throw new Error('Vercel production does not include the local storyboard backend agent. Configure STORYBOARD_AGENT_COMMAND to enable storyboard chat.');
        }
        const { generateStoryboardChatWithBackendAgent } = await import('@/lib/admin/storyboard/backend-agent');
        const result = await generateStoryboardChatWithBackendAgent(
          payload as Parameters<typeof generateStoryboardChatWithBackendAgent>[0],
          process.env,
        ) as StoryboardChatAgentResultForRoute;
        const publicResult = toPublicStoryboardChatAgentResult(result);
        if (isConversationResult(result)) {
          await streamConversationMessage(send, result.assistantMessage);
        } else {
          send('status', { message: getResolvedStatusMessage(result) });
        }
        send('patch', publicResult);
        send('done', publicResult);
      } catch (error) {
        send('error', normalizeRouteError(error));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: streamHeaders });
}

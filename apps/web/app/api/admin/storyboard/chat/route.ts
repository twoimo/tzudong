import { NextRequest } from 'next/server';

import { generateStoryboardChatWithBackendAgent } from '@/lib/admin/storyboard/backend-agent';
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

function toPublicStoryboardChatAgentResult(
  result: Awaited<ReturnType<typeof generateStoryboardChatWithBackendAgent>>,
) {
  return {
    assistantMessage: result.assistantMessage,
    canvasPatch: result.canvasPatch,
    shouldGenerate: result.shouldGenerate,
    shouldReset: result.shouldReset,
  };
}

type StoryboardChatPayload = Record<string, unknown>;

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

function getInitialStatusMessages(payload: StoryboardChatPayload) {
  const focusSummary = getRouteFocusSummary(payload);
  return [
    `${getRouteRequestSummary(payload)}을 ${focusSummary}으로 해석하고 있어요.`,
    `${focusSummary}에서 바꿀 항목을 구분 중이에요: 컷 수, 오디오, 자막, 이미지 요청.`,
    '생성/수정/검토/초기화 중 어떤 작업인지 판단한 뒤 캔버스 패치로 바꿉니다.',
  ];
}

function getResolvedStatusMessage(
  result: Awaited<ReturnType<typeof generateStoryboardChatWithBackendAgent>>,
) {
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
  return `${intent}으로 분류했어요. ${scope} 기준 패치를 만들고 캔버스에 반영합니다.`;
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
        for (const message of getInitialStatusMessages(payload as StoryboardChatPayload)) {
          send('status', { message });
        }
        const result = await generateStoryboardChatWithBackendAgent(
          payload as Parameters<typeof generateStoryboardChatWithBackendAgent>[0],
          process.env,
        );
        const publicResult = toPublicStoryboardChatAgentResult(result);
        send('status', { message: getResolvedStatusMessage(result) });
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

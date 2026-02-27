import { expect, test, type APIRequestContext } from '@playwright/test';
import { getAdminRequestHeaders, hasAdminSession } from './helpers';

type InsightChatStreamChunk = {
    text?: string;
    requestId?: string;
    error?: string;
};

type InsightChatResponse = {
    asOf?: string;
    content?: string;
    sources?: unknown[];
    meta?: {
        source?: string;
        fallbackReason?: string;
        requestId?: string;
        model?: string;
    };
    visualComponent?: string;
    [key: string]: unknown;
};

const BASE_URL = process.env.INSIGHT_CHAT_QA_BASE_URL || 'http://localhost:8080';

async function isAdminRouteUsable(request: APIRequestContext): Promise<boolean> {
    if (!hasAdminSession()) {
        return false;
    }

    const response = await request.get(`${BASE_URL}/api/admin/insight/chat/bootstrap`, {
        headers: getAdminRequestHeaders(),
    });

    return response.status() === 200;
}

function nextRequestId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function extractStreamRequestIds(raw: string): string[] {
    const requestIds = [] as string[];

    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') {
            continue;
        }

        const payload = trimmed.slice(6).trim();
        if (!payload) {
            continue;
        }

        try {
            const parsed = JSON.parse(payload) as InsightChatStreamChunk;
            if (parsed.requestId) {
                requestIds.push(parsed.requestId);
            }
        } catch {
            // ignore malformed chunks
        }
    }

    return requestIds;
}

function parseJsonBody(text: string): InsightChatResponse | null {
    if (!text) return null;

    try {
        return JSON.parse(text) as InsightChatResponse;
    } catch {
        return null;
    }
}

test.describe('인사이트 챗봇 스트림 에러 처리 e2e', () => {
    test.skip(!hasAdminSession(), 'INSIGHTS_CHAT_ADMIN_COOKIE 또는 tests/.auth/admin.json의 관리자 쿠키가 필요합니다.');

    test('stream route returns SSE stream with DONE and requestId when streaming succeeds', async ({ request }) => {
        if (!(await isAdminRouteUsable(request))) {
            test.skip(true, '관리자 세션이 없어 인증 라우트를 확인할 수 없습니다.');
        }

        const requestId = nextRequestId('stream-sse');
        const response = await request.post(`${BASE_URL}/api/admin/insight/chat/stream`, {
            headers: getAdminRequestHeaders({
                'Content-Type': 'application/json',
            }),
            data: {
                message: '트리맵으로 조회수 분포 보여줘',
                requestId,
            },
        });

        const contentType = response.headers()['content-type'] ?? '';
        const raw = await response.text();
        expect([200, 400]).toContain(response.status());

        if (contentType.includes('text/event-stream')) {
            const requestIds = extractStreamRequestIds(raw);
            const hasDone = raw.includes('data: [DONE]');
            expect(hasDone, 'SSE 응답에 [DONE]이 있어야 함').toBeTruthy();
            expect(requestIds, '첫 SSE token에 requestId 반영').toContain(requestId);
        } else {
            const body = parseJsonBody(raw);

            expect(body, '비스트림 fallback 응답').toBeTruthy();
            expect(body?.meta?.source, 'fallback reason 검증').toBe('fallback');
            expect(body?.meta?.requestId).toBe(requestId);
        }
    });

    test('stream route empty_input falls back with requestId and 400', async ({ request }) => {
        if (!(await isAdminRouteUsable(request))) {
            test.skip(true, '관리자 세션이 없어 인증 라우트를 확인할 수 없습니다.');
        }

        const requestId = nextRequestId('stream-empty');
        const response = await request.post(`${BASE_URL}/api/admin/insight/chat/stream`, {
            headers: getAdminRequestHeaders({
                'Content-Type': 'application/json',
            }),
            data: {
                message: '   ',
                requestId,
            },
        });

        expect(response.status(), 'empty_input fallback status').toBe(400);
        const body = parseJsonBody(await response.text());

        expect(body, 'fallback payload').toBeTruthy();
        expect(body?.meta?.source, 'fallback source').toBe('fallback');
        expect(body?.meta?.requestId).toBe(requestId);
        expect(body?.meta?.fallbackReason).toBe('empty_input');
        expect(body?.error).toBe('empty_input');
    });
});

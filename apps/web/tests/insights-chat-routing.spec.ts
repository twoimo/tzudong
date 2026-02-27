import { expect, test, type APIRequestContext } from '@playwright/test';
import { getAdminRequestHeaders, hasAdminSession } from './helpers';

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

async function readJsonResponse(response: import('@playwright/test').APIResponse): Promise<InsightChatResponse | null> {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text) as InsightChatResponse;
    } catch {
        return null;
    }
}

test.describe('인사이트 챗봇 라우팅 e2e', () => {
    test.skip(!hasAdminSession(), 'INSIGHTS_CHAT_ADMIN_COOKIE 또는 tests/.auth/admin.json의 관리자 쿠키가 필요합니다.');

    test('chat route preserves requestId for keyword routing intent', async ({ request }) => {
        if (!(await isAdminRouteUsable(request))) {
            test.skip(true, '관리자 세션이 없어 인증 라우트를 확인할 수 없습니다.');
        }

        const requestId = nextRequestId('chat-wordcloud');
        const response = await request.post(`${BASE_URL}/api/admin/insight/chat`, {
            headers: getAdminRequestHeaders({
                'Content-Type': 'application/json',
            }),
            data: {
                message: '인기 키워드 보여줘',
                requestId,
            },
        });

        expect(response.status(), 'chat route status').toBe(200);
        const body = await readJsonResponse(response);
        expect(body, 'chat payload should parse as JSON').toBeTruthy();
        expect(body?.meta?.requestId).toBe(requestId);
        expect(typeof body?.content).toBe('string');
        expect(body?.meta?.source).toMatch(/^(local|gemini|llm|fallback|openai|anthropic|mock)$/);

        if (body?.meta?.source !== 'fallback') {
            expect(body?.visualComponent).toBe('wordcloud');
        }
    });

    test('chat route preserves requestId for treemap routing intent', async ({ request }) => {
        if (!(await isAdminRouteUsable(request))) {
            test.skip(true, '관리자 세션이 없어 인증 라우트를 확인할 수 없습니다.');
        }

        const requestId = nextRequestId('chat-treemap');
        const response = await request.post(`${BASE_URL}/api/admin/insight/chat`, {
            headers: getAdminRequestHeaders({
                'Content-Type': 'application/json',
            }),
            data: {
                message: '인기 분포 트리맵 보여줘',
                requestId,
            },
        });

        expect(response.status(), 'chat route status').toBe(200);
        const body = await readJsonResponse(response);
        expect(body, 'chat payload should parse as JSON').toBeTruthy();
        expect(body?.meta?.requestId).toBe(requestId);
        expect(typeof body?.content).toBe('string');

        if (body?.meta?.source !== 'fallback') {
            expect(body?.visualComponent).toBe('treemap');
        }
    });

    test('chat route empty input returns fallback with requestId preserved', async ({ request }) => {
        if (!(await isAdminRouteUsable(request))) {
            test.skip(true, '관리자 세션이 없어 인증 라우트를 확인할 수 없습니다.');
        }

        const requestId = nextRequestId('chat-empty');
        const response = await request.post(`${BASE_URL}/api/admin/insight/chat`, {
            headers: getAdminRequestHeaders({
                'Content-Type': 'application/json',
            }),
            data: {
                message: '   ',
                requestId,
            },
        });

        expect(response.status(), 'empty_input should return 400').toBe(400);
        const body = await readJsonResponse(response);
        expect(body, 'fallback payload').toBeTruthy();
        expect(body?.meta?.requestId).toBe(requestId);
        expect(body?.meta?.source).toBe('fallback');
        expect(body?.meta?.fallbackReason).toBe('empty_input');
    });
});

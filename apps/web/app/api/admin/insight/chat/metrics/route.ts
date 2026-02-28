import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import {
    CHAT_ROUTE_NO_STORE_HEADERS,
    getInsightChatRouteGuardrailMetricsSnapshot,
} from '@/lib/insight/insight-chat-route-utils';

export const runtime = 'nodejs';

export async function GET() {
    try {
        const auth = await requireAdmin();
        if (!auth.ok) return auth.response;

        return NextResponse.json(
            getInsightChatRouteGuardrailMetricsSnapshot(),
            {
                headers: CHAT_ROUTE_NO_STORE_HEADERS,
            },
        );
    } catch (error) {
        console.error('[admin/insight/chat/metrics] failed:', error);
        return NextResponse.json(
            { error: 'Failed to build insight chat guardrail metrics.' },
            {
                status: 500,
                headers: CHAT_ROUTE_NO_STORE_HEADERS,
            },
        );
    }
}

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import {
    CHAT_ROUTE_NO_STORE_HEADERS,
    resetInsightChatRouteGuardrails,
} from '@/lib/insight/insight-chat-route-utils';

export const runtime = 'nodejs';

export async function POST() {
    try {
        const auth = await requireAdmin();
        if (!auth.ok) return auth.response;

        resetInsightChatRouteGuardrails();

        return NextResponse.json(
            { success: true, message: 'Insight chat guardrail metrics reset.' },
            {
                headers: CHAT_ROUTE_NO_STORE_HEADERS,
            },
        );
    } catch (error) {
        console.error('[admin/insight/chat/metrics/reset] failed:', error);
        return NextResponse.json(
            { error: 'Failed to reset insight chat guardrail metrics.' },
            {
                status: 500,
                headers: CHAT_ROUTE_NO_STORE_HEADERS,
            },
        );
    }
}

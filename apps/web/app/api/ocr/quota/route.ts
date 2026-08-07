import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOcrQuotaStatus } from '@/lib/ocr/quota';
const noStoreJson = (body: unknown, init?: ResponseInit) =>
    NextResponse.json(body, {
        ...init,
        headers: { ...init?.headers, 'Cache-Control': 'no-store' },
    });

export async function GET() {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return noStoreJson({ error: 'Unauthorized' }, { status: 401 });
        }

        const quota = await getOcrQuotaStatus({
            quotaClient: supabase as never,
        });

        return noStoreJson(quota);

    } catch {
        return noStoreJson({ error: 'OCR_QUOTA_UNAVAILABLE' }, { status: 503 });
    }
}

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOcrQuotaStatus } from '@/lib/ocr/quota';

export async function GET() {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const quota = await getOcrQuotaStatus({
            userId: user.id,
            logsClient: supabase as never,
            roleClient: supabase as never,
        });

        return NextResponse.json(quota);

    } catch (error: unknown) {
        console.error('Quota check failed:', error);
        const message = error instanceof Error ? error.message : 'Quota check failed';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

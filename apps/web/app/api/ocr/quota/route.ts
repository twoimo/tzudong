import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
    try {
        const supabase = await createServerClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const MAX_DAILY_QUOTA = 5;

        // Service Role 클라이언트 생성 (RLS 우회)
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { count, error: countError } = await (supabaseAdmin
            .from('ocr_logs') as any)
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .gte('created_at', today.toISOString());

        if (countError) {
            throw countError;
        }

        const used = count || 0;
        const remaining = Math.max(0, MAX_DAILY_QUOTA - used);

        return NextResponse.json({
            used,
            max: MAX_DAILY_QUOTA,
            remaining
        });

    } catch (error: any) {
        console.error('Quota check failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

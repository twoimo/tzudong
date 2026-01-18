import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const MAX_DAILY_QUOTA = 5;

        const { count, error: countError } = await (supabase
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

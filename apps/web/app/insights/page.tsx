import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import InsightsClient from './insights-client';

export default async function InsightsPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        redirect('/');
    }

    return <InsightsClient />;
}

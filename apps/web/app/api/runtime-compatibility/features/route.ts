import { NextResponse } from 'next/server';

import { FEATURE_DATABASE_HELD } from '@/lib/runtime-feature-readiness-contract';
import { readFeatureDatabaseReadiness } from '@/lib/server/runtime-feature-readiness';
import { createClient } from '@/lib/supabase/server';

const headers = Object.freeze({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json(FEATURE_DATABASE_HELD, { headers, status: 401 });
    }
    return NextResponse.json(await readFeatureDatabaseReadiness({ ownerId: user.id }), { headers, status: 200 });
  } catch {
    return NextResponse.json(FEATURE_DATABASE_HELD, { headers, status: 503 });
  }
}

import { NextResponse } from 'next/server';
import {
  buildAnyCapGptImageReadinessError,
  probeAnyCapGptImageReadiness,
} from '@/lib/admin/anycap-gpt-image-readiness';
import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const readiness = await probeAnyCapGptImageReadiness();
    return NextResponse.json(readiness, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return NextResponse.json(buildAnyCapGptImageReadinessError(error), {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }
}

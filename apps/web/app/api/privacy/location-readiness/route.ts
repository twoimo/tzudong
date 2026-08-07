import { NextResponse } from 'next/server';

import { resolveDeviceLocationReadiness } from '@/lib/privacy/location-readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(resolveDeviceLocationReadiness(), {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

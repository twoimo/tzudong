import { NextResponse } from 'next/server';

import { resolveDeviceLocationReadiness } from '@/lib/privacy/location-readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  const readiness = resolveDeviceLocationReadiness(process.env);

  return NextResponse.json(readiness, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

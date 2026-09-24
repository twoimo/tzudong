import { NextResponse } from 'next/server';

import { resolveDeviceLocationReadiness } from '@/lib/privacy/location-readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export async function GET() {
  const readiness = resolveDeviceLocationReadiness();
  return NextResponse.json(
    { status: readiness.status, reasonCode: 'DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED' },
    {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

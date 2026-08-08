import { NextResponse } from 'next/server';

import {
  isLimitedPublicMode,
  isLimitedPublicModeAllowAuth,
  isPublicDemoMode,
} from '@/lib/site-config';
import {
  getReleaseModeReadback,
  type ReleaseModeReadback,
} from '@/lib/release-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-static';


export function GET() {
  return NextResponse.json(getReleaseModeReadback(), {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

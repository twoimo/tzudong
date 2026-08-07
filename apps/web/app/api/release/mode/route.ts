import { NextResponse } from 'next/server';

import {
  isLimitedPublicMode,
  isLimitedPublicModeAllowAuth,
  isPublicDemoMode,
} from '@/lib/site-config';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

export type ReleaseModeInputs = Readonly<{
  isPublicDemoMode: boolean;
  isLimitedPublicMode: boolean;
  isLimitedPublicModeAllowAuth: boolean;
}>;

export type ReleaseModeReadback = Readonly<{
  isPublicDemoMode: boolean;
  isLimitedPublicMode: boolean;
  isLimitedPublicModeAllowAuth: boolean;
  isPublicRestrictedMode: boolean;
  publicMapContentEnabled: true;
  authUiEnabled: boolean;
  writeUiEnabled: boolean;
  marketingUiEnabled: boolean;
  notificationsUiEnabled: boolean;
  locationUiEnabled: boolean;
  under14Enabled: false;
}>;

export const buildReleaseModeReadback = (
  flags: ReleaseModeInputs,
): ReleaseModeReadback => {
  const isPublicRestrictedMode =
    flags.isPublicDemoMode
    || (flags.isLimitedPublicMode && !flags.isLimitedPublicModeAllowAuth);

  return {
    isPublicDemoMode: flags.isPublicDemoMode,
    isLimitedPublicMode: flags.isLimitedPublicMode,
    isLimitedPublicModeAllowAuth: flags.isLimitedPublicModeAllowAuth,
    isPublicRestrictedMode,
    publicMapContentEnabled: true,
    authUiEnabled: !isPublicRestrictedMode,
    writeUiEnabled: !isPublicRestrictedMode,
    marketingUiEnabled: !flags.isPublicDemoMode && !flags.isLimitedPublicMode,
    notificationsUiEnabled: !isPublicRestrictedMode,
    locationUiEnabled: !isPublicRestrictedMode,
    under14Enabled: false,
  };
};

export const getReleaseModeReadback = (): ReleaseModeReadback =>
  buildReleaseModeReadback({
    isPublicDemoMode,
    isLimitedPublicMode,
    isLimitedPublicModeAllowAuth,
  });

export function GET() {
  return NextResponse.json(getReleaseModeReadback(), {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

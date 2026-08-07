import {
  isLimitedPublicMode,
  isLimitedPublicModeAllowAuth,
  isPublicDemoMode,
} from '@/lib/site-config';

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

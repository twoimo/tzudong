import { describe, expect, test } from 'bun:test';

import {
  isLimitedPublicMode,
  isLimitedPublicModeAllowAuth,
  isPublicDemoMode,
  isPublicRestrictedMode,
  parseStrictBuildFlag,
} from '../lib/site-config';
import {
  buildReleaseModeReadback,
  getReleaseModeReadback,
} from '../lib/release-mode';

describe('release mode flags', () => {
  test('accepts only explicit true and 1 values', () => {
    for (const value of ['true', 'TRUE', ' 1 ']) {
      expect(parseStrictBuildFlag(value)).toBe(true);
    }

    for (const value of [undefined, null, '', 'false', '0', 'yes', 'on', true, 1]) {
      expect(parseStrictBuildFlag(value)).toBe(false);
    }
  });

  test('readback contains only non-secret mode and capability flags', () => {
    const readback = getReleaseModeReadback();

    expect(Object.keys(readback).sort()).toEqual([
      'authUiEnabled',
      'isLimitedPublicMode',
      'isLimitedPublicModeAllowAuth',
      'isPublicDemoMode',
      'isPublicRestrictedMode',
      'locationUiEnabled',
      'marketingUiEnabled',
      'notificationsUiEnabled',
      'publicMapContentEnabled',
      'under14Enabled',
      'writeUiEnabled',
    ]);
    expect(readback.publicMapContentEnabled).toBe(true);
    expect(readback.under14Enabled).toBe(false);
    expect(readback.isLimitedPublicMode).toBe(isLimitedPublicMode);
    expect(readback.isLimitedPublicModeAllowAuth).toBe(isLimitedPublicModeAllowAuth);
    expect(readback.isPublicDemoMode).toBe(isPublicDemoMode);
    expect(readback.isPublicRestrictedMode).toBe(isPublicRestrictedMode);
    expect(readback.authUiEnabled).toBe(!isPublicRestrictedMode);
    expect(readback.writeUiEnabled).toBe(!isPublicRestrictedMode);
    expect(readback.locationUiEnabled).toBe(!isPublicRestrictedMode);
    expect(readback.notificationsUiEnabled).toBe(!isPublicRestrictedMode);
    expect(readback.marketingUiEnabled).toBe(!isPublicDemoMode && !isLimitedPublicMode);
  });

  test('restricted-mode matrix fails closed unless limited auth is explicitly allowed', () => {
    for (const isPublicDemoMode of [false, true]) {
      for (const isLimitedPublicMode of [false, true]) {
        for (const isLimitedPublicModeAllowAuth of [false, true]) {
          const readback = buildReleaseModeReadback({
            isPublicDemoMode,
            isLimitedPublicMode,
            isLimitedPublicModeAllowAuth,
          });
          const restricted =
            isPublicDemoMode
            || (isLimitedPublicMode && !isLimitedPublicModeAllowAuth);

          expect(readback.isPublicRestrictedMode).toBe(restricted);
          expect(readback.authUiEnabled).toBe(!restricted);
          expect(readback.writeUiEnabled).toBe(!restricted);
          expect(readback.notificationsUiEnabled).toBe(!restricted);
          expect(readback.locationUiEnabled).toBe(!restricted);
          expect(readback.publicMapContentEnabled).toBe(true);
          expect(readback.under14Enabled).toBe(false);
          expect(readback.marketingUiEnabled).toBe(
            !isPublicDemoMode && !isLimitedPublicMode,
          );
        }
      }
    }
  });
});

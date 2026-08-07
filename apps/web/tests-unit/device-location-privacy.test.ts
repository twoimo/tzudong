import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import * as locationGate from '../lib/privacy/location-gate';
import {
  DEVICE_LOCATION_DENIED_DESTINATIONS,
  DEVICE_LOCATION_NETWORK_SINK,
  DeviceLocationDestinationError,
  acquireDeviceLocationUseAuthorization,
  assertDeviceLocationDestination,
  createDeviceLocationTrackingLifecycle,
  evaluateLocationUse,
  revokeDeviceLocationUseAuthorization,
  type DeviceLocationUseAuthorization,
  type LocationDestination,
} from '../lib/privacy/location-gate';
import { isPublicRestrictedMode } from '../lib/site-config';

const webRoot = path.resolve(import.meta.dir, '..');
const homeClientSource = readFileSync(
  path.join(webRoot, 'app/home-client.tsx'),
  'utf8',
);
const locationGateSource = readFileSync(
  path.join(webRoot, 'lib/privacy/location-gate.ts'),
  'utf8',
);
const naverMapSource = readFileSync(
  path.join(webRoot, 'components/map/NaverMapView.tsx'),
  'utf8',
);
const READY_AVAILABLE = {
  status: 'available',
  reasonCode: 'DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED',
} as const;
const READY_UNAVAILABLE = {
  status: 'unavailable',
  reasonCode: 'DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED',
} as const;

type FetchCall = Readonly<{
  input: RequestInfo | URL;
  init?: RequestInit;
}>;

async function withReadinessResponse<T>(
  payload: unknown,
  callback: (calls: FetchCall[]) => Promise<T>,
  status = 200,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify(payload) ?? '', { status });
  };

  try {
    return await callback(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const networkUse = (authorization: DeviceLocationUseAuthorization | null) =>
  evaluateLocationUse({
    purpose: 'home-map-device-marker',
    destination: 'network',
    networkSink: DEVICE_LOCATION_NETWORK_SINK,
    authorization,
  });

test('readback acquisition is the only mint boundary and validates the exact response schema', async () => {
  expect(acquireDeviceLocationUseAuthorization.length).toBe(0);

  await withReadinessResponse(READY_AVAILABLE, async (calls) => {
    const authorization = await acquireDeviceLocationUseAuthorization();
    if (isPublicRestrictedMode) {
      expect(authorization).toBeNull();
      expect(calls).toHaveLength(0);
      return;
    }

    expect(authorization).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe('/api/privacy/location-readiness');
    expect(calls[0]?.init).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      mode: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  for (const payload of [
    READY_UNAVAILABLE,
    { ...READY_AVAILABLE, unexpected: true },
    { status: 'available' },
    { reasonCode: 'DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED' },
    ['available', 'DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED'],
    null,
  ]) {
    await withReadinessResponse(payload, async () => {
      expect(await acquireDeviceLocationUseAuthorization()).toBeNull();
    });
  }

  await withReadinessResponse(READY_AVAILABLE, async () => {
    expect(await acquireDeviceLocationUseAuthorization()).toBeNull();
  }, 503);
});

test('readiness literals, spreads, clones, and JSON cannot mint a capability without the removed factory API', async () => {
  const readinessForms = [
    READY_AVAILABLE,
    { ...READY_AVAILABLE },
    structuredClone(READY_AVAILABLE),
    JSON.parse(JSON.stringify(READY_AVAILABLE)),
  ];
  const gateApi = locationGate as unknown as Record<string, unknown>;

  for (const readiness of readinessForms) {
    expect(readiness).toEqual(READY_AVAILABLE);
    expect(Object.hasOwn(gateApi, 'createDeviceLocationUseAuthorization')).toBe(false);
    expect(gateApi.createDeviceLocationUseAuthorization).toBeUndefined();
  }

  await withReadinessResponse(READY_UNAVAILABLE, async () => {
    const acquireWithIgnoredArgument =
      acquireDeviceLocationUseAuthorization as unknown as (
        readiness: typeof READY_AVAILABLE,
      ) => Promise<DeviceLocationUseAuthorization | null>;

    for (const readiness of readinessForms) {
      expect(await acquireWithIgnoredArgument(readiness)).toBeNull();
    }
  });
});

test('device coordinates use only approved memory and the exact Naver network sink', async () => {
  const devicePosition = { latitude: 37.5665, longitude: 126.978 };
  const sinkCalls: Array<{ destination: LocationDestination; value: unknown }> = [];

  const sendToSink = (destination: LocationDestination) => {
    assertDeviceLocationDestination(destination, 'home-map-device-marker');
    sinkCalls.push({ destination, value: devicePosition });
  };

  await withReadinessResponse(READY_AVAILABLE, async () => {
    const authorization = await acquireDeviceLocationUseAuthorization();
    if (isPublicRestrictedMode) {
      expect(authorization).toBeNull();
      return;
    }
    expect(authorization).not.toBeNull();

    expect(evaluateLocationUse({
      purpose: 'home-map-device-marker',
      destination: 'memory',
      authorization,
    })).toEqual({
      allowed: true,
      reasonCode: 'DEVICE_LOCATION_MEMORY_ONLY',
    });
    expect(networkUse(authorization)).toEqual({
      allowed: true,
      reasonCode: 'DEVICE_LOCATION_MAP_PROVIDER_NETWORK_ALLOWED',
    });

    for (const deniedUse of [
      {
        purpose: 'restaurant-map-marker',
        destination: 'network',
        networkSink: DEVICE_LOCATION_NETWORK_SINK,
      },
      {
        purpose: 'home-map-device-marker',
        destination: 'network',
        networkSink: 'maplibre-overseas',
      },
      {
        purpose: 'home-map-device-marker',
        destination: 'network',
        networkSink: '/api/location',
      },
      {
        purpose: 'home-map-device-marker',
        destination: 'network',
        networkSink: DEVICE_LOCATION_NETWORK_SINK,
        endpoint: '/api/location',
      },
      {
        purpose: 'home-map-device-marker',
        destination: 'url',
      },
    ] as const) {
      expect(evaluateLocationUse({
        ...deniedUse,
        authorization,
      })).toEqual({
        allowed: false,
        reasonCode: 'DEVICE_LOCATION_DESTINATION_DENIED',
      });
    }

    for (const destination of DEVICE_LOCATION_DENIED_DESTINATIONS) {
      if (destination !== 'network') {
        expect(evaluateLocationUse({
          purpose: 'home-map-device-marker',
          destination,
          authorization,
        })).toEqual({
          allowed: false,
          reasonCode: 'DEVICE_LOCATION_DESTINATION_DENIED',
        });
      }
      expect(() => sendToSink(destination)).toThrow(DeviceLocationDestinationError);
    }
  });

  expect(devicePosition).toEqual({ latitude: 37.5665, longitude: 126.978 });
  expect(sinkCalls).toEqual([]);
});

test('business source relabels do not bypass the device coordinate gate', async () => {
  await withReadinessResponse(READY_AVAILABLE, async () => {
    const authorization = await acquireDeviceLocationUseAuthorization();
    const businessRelabel = {
      source: 'business',
      purpose: 'home-map-device-marker',
      destination: 'network',
      networkSink: DEVICE_LOCATION_NETWORK_SINK,
      authorization,
    } as unknown as Parameters<typeof evaluateLocationUse>[0];

    expect(evaluateLocationUse(businessRelabel)).toEqual({
      allowed: false,
      reasonCode: 'DEVICE_LOCATION_DESTINATION_DENIED',
    });
    expect(locationGateSource).not.toContain('LocationSource');
    expect(locationGateSource).not.toContain('BUSINESS_LOCATION_DESTINATION_ALLOWED');
    expect(locationGateSource).not.toContain('source === "business"');
  });
});

test('capabilities are opaque, revocable, and reject clone or relabel attempts', async () => {
  await withReadinessResponse(READY_AVAILABLE, async () => {
    const authorization = await acquireDeviceLocationUseAuthorization();
    if (isPublicRestrictedMode) {
      expect(authorization).toBeNull();
      return;
    }
    expect(authorization).not.toBeNull();
    if (!authorization) throw new Error('Expected ready authorization.');
    expect(Object.isFrozen(authorization)).toBe(true);

    const mutatedCopy = { ...authorization };
    mutatedCopy.expiresAt += 5 * 60 * 1000;
    const forgedAuthorizations = [
      { ...authorization },
      structuredClone(authorization),
      JSON.parse(JSON.stringify(authorization)),
      mutatedCopy,
      Object.freeze({ ...authorization }),
    ];

    for (const forgedAuthorization of forgedAuthorizations) {
      expect(networkUse(forgedAuthorization)).toEqual({
        allowed: false,
        reasonCode: 'DEVICE_LOCATION_DESTINATION_DENIED',
      });
    }
    expect(() => {
      (authorization as { grantedAt: number }).grantedAt += 1;
    }).toThrow();

    const retainedReference = authorization;
    revokeDeviceLocationUseAuthorization(authorization);
    revokeDeviceLocationUseAuthorization(authorization);
    expect(networkUse(retainedReference)).toEqual({
      allowed: false,
      reasonCode: 'DEVICE_LOCATION_DESTINATION_DENIED',
    });
  });
});

test('monotonic expiry cannot be revived by replaying an earlier clock value', async () => {
  const clock = { value: 1_000 };
  const originalNowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis.performance,
    'now',
  );
  Object.defineProperty(globalThis.performance, 'now', {
    configurable: true,
    value: () => clock.value,
  });

  let clockedGate: typeof import('../lib/privacy/location-gate');
  try {
    clockedGate = await import(
      `../lib/privacy/location-gate.ts?monotonic-clock=${Math.random()}`,
    );
  } finally {
    if (originalNowDescriptor) {
      Object.defineProperty(globalThis.performance, 'now', originalNowDescriptor);
    } else {
      delete (globalThis.performance as { now?: () => number }).now;
    }
  }

  await withReadinessResponse(READY_AVAILABLE, async () => {
    const authorization = await clockedGate.acquireDeviceLocationUseAuthorization();
    if (isPublicRestrictedMode) {
      expect(authorization).toBeNull();
      return;
    }
    expect(authorization).not.toBeNull();
    if (!authorization) throw new Error('Expected ready authorization.');

    expect(clockedGate.evaluateLocationUse({
      purpose: 'home-map-device-marker',
      destination: 'network',
      networkSink: 'naver-maps-javascript',
      authorization,
    })).toMatchObject({ allowed: true });

    clock.value = authorization.expiresAt;
    expect(clockedGate.evaluateLocationUse({
      purpose: 'home-map-device-marker',
      destination: 'network',
      networkSink: 'naver-maps-javascript',
      authorization,
    })).toMatchObject({ allowed: false });

    clock.value = authorization.grantedAt + 1;
    expect(clockedGate.evaluateLocationUse({
      purpose: 'home-map-device-marker',
      destination: 'network',
      networkSink: 'naver-maps-javascript',
      authorization,
    })).toMatchObject({ allowed: false });
  });

  expect(locationGateSource).toContain(
    'const capturedMonotonicNow = globalThis.performance.now.bind(globalThis.performance);',
  );
  expect(locationGateSource).not.toContain('now?:');
  expect(locationGateSource).not.toContain('Date.now()');
});

test('tracking lifecycle revokes the genuine capability exactly once on every stop path', async () => {
  await withReadinessResponse(READY_AVAILABLE, async () => {
    const stopFor = async (
      invoke: (
        lifecycle: ReturnType<typeof createDeviceLocationTrackingLifecycle>,
      ) => void,
    ) => {
      const authorization = await acquireDeviceLocationUseAuthorization();
      if (isPublicRestrictedMode) {
        expect(authorization).toBeNull();
        return;
      }
      expect(authorization).not.toBeNull();
      if (!authorization) throw new Error('Expected ready authorization.');

      let stopCount = 0;
      const lifecycle = createDeviceLocationTrackingLifecycle(
        () => {
          stopCount += 1;
        },
        authorization,
      );

      invoke(lifecycle);
      lifecycle.onModeChange(false);
      lifecycle.onVisibilityChange('hidden');
      lifecycle.dispose();

      expect(stopCount).toBe(1);
      expect(networkUse(authorization)).toEqual({
        allowed: false,
        reasonCode: 'DEVICE_LOCATION_DESTINATION_DENIED',
      });
    };

    await stopFor((lifecycle) => lifecycle.onModeChange(false));
    await stopFor((lifecycle) => lifecycle.onVisibilityChange('hidden'));
    await stopFor((lifecycle) => lifecycle.dispose());
  });
});

test('home client revokes retained capabilities on readiness failure, lifecycle cleanup, and errors', () => {
  const clearStart = homeClientSource.indexOf(
    'const clearDeviceLocationState = useCallback',
  );
  const clearEnd = homeClientSource.indexOf(
    'const startDeviceOrientationTracking',
    clearStart,
  );
  const handlerStart = homeClientSource.indexOf(
    'const handleDeviceLocationClick = useCallback',
  );
  const visibilityStart = homeClientSource.indexOf(
    'const handleVisibilityChange = () =>',
  );
  const renderStart = homeClientSource.indexOf(
    'const shouldRenderSidePanels',
    visibilityStart,
  );
  const watchStart = homeClientSource.indexOf(
    'const startDeviceLocationWatch = useCallback',
  );
  const handlerSource = homeClientSource.slice(handlerStart, visibilityStart);
  const clearSource = homeClientSource.slice(clearStart, clearEnd);
  const visibilitySource = homeClientSource.slice(visibilityStart, renderStart);
  const watchSource = homeClientSource.slice(watchStart, handlerStart);

  expect(clearSource).toContain('revokeDeviceLocationUseAuthorization(authorization);');
  expect(clearSource).toContain('deviceLocationAuthorizationRef.current = null;');
  expect(clearSource).toContain('setDeviceLocation(null);');
  expect(clearSource).toContain('setIsDeviceHeadingMode(false);');
  expect(handlerSource).toContain(
    'const authorization = await acquireDeviceLocationUseAuthorization();',
  );
  expect(handlerSource).toContain('if (!authorization)');
  expect(handlerSource).toContain('clearDeviceLocationState();');
  expect(handlerSource).toContain('revokeDeviceLocationUseAuthorization(authorization);');
  expect(handlerSource).toContain('deviceLocationAuthorizationExpiryTimerRef');
  expect(watchSource).toContain(
    'createDeviceLocationTrackingLifecycle(\n        stopDeviceHeadingWatchers,\n        authorization,',
  );
  expect(watchSource).toContain('clearDeviceLocationState();');
  expect(visibilitySource).toContain('onVisibilityChange(');
  expect(visibilitySource).toContain(
    'document.removeEventListener("visibilitychange", handleVisibilityChange)',
  );
  expect(visibilitySource).toContain('deviceLocationMountedRef.current = false;');
  expect(visibilitySource).toContain('clearDeviceLocationState();');
});

test('home client keeps the capability boundary before disclosure and confines rendering to Naver', () => {
  const handlerStart = homeClientSource.indexOf(
    'const handleDeviceLocationClick = useCallback',
  );
  const handlerEnd = homeClientSource.indexOf(
    'const shouldRenderSidePanels',
    handlerStart,
  );
  const handlerSource = homeClientSource.slice(handlerStart, handlerEnd);
  const authorizationIndex = handlerSource.indexOf(
    'const authorization = await acquireDeviceLocationUseAuthorization()',
  );
  const deniedGuardIndex = handlerSource.indexOf('if (!authorization)');
  const disclosureIndex = handlerSource.indexOf(
    'window.confirm(DEVICE_LOCATION_DISCLOSURE)',
  );
  const geolocationIndex = handlerSource.indexOf(
    'navigator.geolocation.getCurrentPosition',
  );

  expect(authorizationIndex).toBeGreaterThan(-1);
  expect(deniedGuardIndex).toBeGreaterThan(authorizationIndex);
  expect(disclosureIndex).toBeGreaterThan(deniedGuardIndex);
  expect(geolocationIndex).toBeGreaterThan(disclosureIndex);
  expect(homeClientSource).toContain('networkSink: DEVICE_LOCATION_NETWORK_SINK');
  expect(homeClientSource).toContain(
    'deviceLocation={mapMode === "domestic" ? deviceLocation : null}',
  );
  expect(homeClientSource).toContain(
    'if (mapMode === "overseas") {\n      clearDeviceLocationState();',
  );
  expect(homeClientSource).toContain(
    '현재 위치 좌표는 현재 React 메모리에만 보관되며 Tzudong에 저장되지 않습니다. 브라우저 지도 렌더링 및 화면 이동은 승인된 지도 제공자 경계를 통과할 수 있습니다.',
  );
  expect(homeClientSource).toContain(
    '현재 위치 기능은 운영자 위치 증빙 확인이 완료될 때까지 사용할 수 없어요.',
  );
  expect(naverMapSource).toContain(
    '// Renders authorized device coordinates at the approved map-provider boundary.',
  );
});

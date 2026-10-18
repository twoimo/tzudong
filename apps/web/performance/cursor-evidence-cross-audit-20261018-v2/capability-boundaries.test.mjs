import { expect, test } from 'bun:test';

let importSequence = 0;
async function withClock(initial, run) {
  const clock = { value: initial };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.performance, 'now');
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis.performance, 'now', {
    configurable: true, value: () => clock.value,
  });
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: 'available', reasonCode: 'DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED',
  }), { status: 200 });
  try {
    const gate = await import(`../../lib/privacy/location-gate.ts?audit-boundary=${++importSequence}`);
    return await run(gate, clock);
  } finally {
    if (descriptor) Object.defineProperty(globalThis.performance, 'now', descriptor);
    else delete globalThis.performance.now;
    globalThis.fetch = originalFetch;
  }
}

const invalidClocks = [
  ['NaN', Number.NaN],
  ['positive infinity', Number.POSITIVE_INFINITY],
  ['negative infinity', Number.NEGATIVE_INFINITY],
  ['above safe magnitude', Number.MAX_SAFE_INTEGER + 1],
  ['below safe magnitude', -Number.MAX_SAFE_INTEGER - 1],
];

for (const [label, value] of invalidClocks) {
  test(`W001-F3: mint fails closed at ${label}`, async () => {
    await withClock(value, async (gate) => {
      expect(await gate.acquireDeviceLocationUseAuthorization()).toBeNull();
    });
  });

  test(`W001-F3: ${label} during use revokes rather than revives the capability`, async () => {
    await withClock(1000, async (gate, clock) => {
      const authorization = await gate.acquireDeviceLocationUseAuthorization();
      expect(authorization).not.toBeNull();
      const use = () => gate.evaluateLocationUse({
        purpose: 'home-map-device-marker', destination: 'network',
        networkSink: gate.DEVICE_LOCATION_NETWORK_SINK, authorization,
      });
      expect(use().allowed).toBe(true);
      clock.value = value;
      expect(use().allowed).toBe(false);
      clock.value = 1001;
      expect(use().allowed).toBe(false);
    });
  });
}

test('W001-F1: stored deadline remains a strict half-open boundary at fractional uptime', async () => {
  await withClock(262144.02702702704, async (gate, clock) => {
    const authorization = await gate.acquireDeviceLocationUseAuthorization();
    expect(authorization).not.toBeNull();
    if (!authorization) throw Error('EXPECTED_CAPABILITY');
    expect(authorization.expiresAt).toBe(authorization.grantedAt + 300000);
    expect(authorization.expiresAt - authorization.grantedAt).not.toBe(300000);
    const use = () => gate.evaluateLocationUse({
      purpose: 'home-map-device-marker', destination: 'network',
      networkSink: gate.DEVICE_LOCATION_NETWORK_SINK, authorization,
    });
    clock.value = authorization.expiresAt - 0.001;
    expect(use().allowed).toBe(true);
    clock.value = authorization.expiresAt;
    expect(use().allowed).toBe(false);
    clock.value = authorization.grantedAt + 1;
    expect(use().allowed).toBe(false);
  });
});

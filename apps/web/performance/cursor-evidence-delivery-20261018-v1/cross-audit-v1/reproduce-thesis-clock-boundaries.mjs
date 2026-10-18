// Diagnostic of an external audit claim, not a new product requirement.
import { writeFile, access } from 'node:fs/promises';
const out = new URL('thesis-clock-boundaries-observed-v1.json', import.meta.url);
try { await access(out); throw Error('PRESERVE_EXISTING_RESULT'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
const originalFetch = globalThis.fetch;
let now = 1000;
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
globalThis.fetch = async () => new Response(JSON.stringify({
  status: 'available', reasonCode: 'DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED',
}), { status: 200 });
try {
  const gate = await import('../../../lib/privacy/location-gate.ts');
  const authorization = await gate.acquireDeviceLocationUseAuthorization();
  if (!authorization) throw Error('SYNTHETIC_MINT_FAILED');
  const allowed = () => gate.evaluateLocationUse({
    purpose: 'home-map-device-marker', destination: 'network',
    networkSink: gate.DEVICE_LOCATION_NETWORK_SINK, authorization,
  }).allowed;
  const steps = [];
  for (const time of [1000, 2000, 1500, 301000, 1500]) {
    now = time;
    steps.push({ syntheticNow: now, allowed: allowed() });
  }
  if (steps.map(x => x.allowed).join() !== 'true,true,true,false,false') throw Error('AUDIT_CLAIM_NOT_REPRODUCED');
  const fractional = 262144.02702702704;
  const numeric = { grantedAt: fractional, storedDeadline: fractional + 300000,
    subtraction: (fractional + 300000) - fractional,
    storedSumEquality: fractional + 300000 === fractional + 300000 };
  if (numeric.subtraction === 300000 || !numeric.storedSumEquality) throw Error('NUMERIC_COUNTEREXAMPLE_NOT_REPRODUCED');
  await writeFile(out, JSON.stringify({
    source: '9228c1454393560bcd37240f793065e450f85683',
    scope: 'Actual private API in one isolated Bun process; synthetic nonconforming clock and readiness only. No actual location/permission/network/account operation.',
    steps, numeric,
    conclusion: 'Intra-window backwards synthetic time is not independently detected. Stored exact deadline rejects and deletes capability; later rewind cannot revive it. Do not claim generic rewind-proof or real-number-exact five minutes.',
    productChange: false, performanceClaim: false,
  }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ reproduced: true, steps, numeric }));
} finally {
  Object.defineProperty(globalThis, 'performance', descriptor);
  globalThis.fetch = originalFetch;
}

import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { callGeminiReceiptOcr } from '../lib/ocr/gemini';

const baselineSha = '65bf3a584e55a849bdf5f3e8dcf5cc2e739f1fbb';
const baselineSource = execFileSync('git', ['show', `${baselineSha}:apps/web/lib/ocr/gemini.ts`], { encoding: 'utf8' });
const temporary = mkdtempSync('lib/ocr/.runtime-benchmark-');
const baselinePath = join(temporary, 'baseline.ts');
writeFileSync(baselinePath, baselineSource);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
  const baseline = await import(join(process.cwd(), baselinePath));
  const synthetic = JSON.stringify({ store_name: '합성 검증점', total_amount: 10000, confidence: 0.9 });
  const cases = ['unchanged', 'duplicate-model-fallback', 'already-cancelled', 'cancel-during-fallback'] as const;
  const runs: Array<{ kind: typeof cases[number]; repeat: number; variant: string; operations: number; wallMs: number;
    adapterCalls: number; completed: number; cancelledCompletions: number; resultHashes: string[] }> = [];
  for (const kind of cases) for (let repeat = 0; repeat < 7; repeat++) {
    for (const variant of repeat % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const invoke = variant === 'baseline' ? baseline.callGeminiReceiptOcr : callGeminiReceiptOcr;
      let adapterCalls = 0, completed = 0, cancelledCompletions = 0;
      const resultHashes = [];
      const start = performance.now();
      for (let index = 0; index < 50; index++) {
        const controller = new AbortController();
        if (kind === 'already-cancelled') controller.abort();
        const models = kind === 'duplicate-model-fallback' ? 'unavailable,unavailable,gemini-3.6-flash'
          : kind === 'cancel-during-fallback' ? 'unavailable,gemini-3.6-flash' : 'gemini-3.6-flash';
        try {
          const result = await invoke({ apiKey: 'synthetic-key', imageBase64: '', mimeType: 'image/png', prompt: 'synthetic',
            env: { GEMINI_OCR_MODEL: models }, signal: controller.signal,
            generateContentImpl: async ({ model }: { model: string }) => {
              adapterCalls++; await new Promise((resolve) => setTimeout(resolve, 1));
              if (kind === 'cancel-during-fallback' && model === 'unavailable') { controller.abort(); throw new DOMException('cancelled', 'AbortError'); }
              if (model === 'unavailable') throw new Error('synthetic-failure');
              return synthetic;
            } });
          completed++; if (controller.signal.aborted) cancelledCompletions++;
          resultHashes.push(hash(result.data));
        } catch { /* Failure content is never persisted. */ }
      }
      runs.push({ kind, repeat, variant, operations: 50, wallMs: performance.now() - start,
        adapterCalls, completed, cancelledCompletions, resultHashes: [...new Set(resultHashes)] });
    }
  }
  const percentile = (values: number[], q: number) => { const sorted = [...values].sort((a, b) => a - b); const position = (sorted.length - 1) * q, lower = Math.floor(position); return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower); };
  let seed = 3102026;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  const summaries = cases.map((kind) => {
    const before = runs.filter((run) => run.kind === kind && run.variant === 'baseline');
    const after = runs.filter((run) => run.kind === kind && run.variant === 'candidate');
    const beforeP75 = percentile(before.map((run) => run.wallMs), .75), afterP75 = percentile(after.map((run) => run.wallMs), .75);
    const boot = Array.from({ length: 5000 }, () => {
      const indices = Array.from({ length: 7 }, () => Math.floor(random() * 7));
      return (1 - percentile(indices.map((i) => after[i].wallMs), .75) / percentile(indices.map((i) => before[i].wallMs), .75)) * 100;
    });
    return { kind, pairs: 7, operationsPerBatch: 50, wallP75Ms: { before: beforeP75, after: afterP75,
      absoluteDifference: afterP75 - beforeP75, reductionPercent: (1 - afterP75 / beforeP75) * 100,
      reduction95CI: [percentile(boot, .025), percentile(boot, .975)] },
      adapterCallsPerBatch: { before: before[0].adapterCalls, after: after[0].adapterCalls },
      cancelledCompletionsPerBatch: { before: before[0].cancelledCompletions, after: after[0].cancelledCompletions },
      nonCancelledResultHashesMatch: !kind.includes('cancel') && JSON.stringify(before[0].resultHashes) === JSON.stringify(after[0].resultHashes) };
  });
  const result = { kind: 'controlled-ocr-provider-replay', baselineSha, baselineSourceSha256: hash(baselineSource),
    environment: { bun: process.versions.bun ?? 'unknown', sdk: '2.18.0', nodeCompatibility: process.version, fakeProviderDelayMs: 1 },
    actualGoogleRequests: 0, monetarySavingsVerified: false, summaries, runs,
    limitations: ['Injected provider adapter counts are not real Google network calls or billed calls.', 'The SDK can reject an already-aborted signal before network transmission even on the baseline.', 'Cancelled outputs intentionally change; non-cancelled normalization equality does not establish real OCR accuracy.'] };
  mkdirSync('performance/ui-renewal-20261003', { recursive: true });
  writeFileSync('performance/ui-renewal-20261003/ocr-runtime-replay.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ actualGoogleRequests: 0, summaries }));
} finally { rmSync(temporary, { recursive: true, force: true }); }

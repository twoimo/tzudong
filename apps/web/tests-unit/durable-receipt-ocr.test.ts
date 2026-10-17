import { describe, expect, test } from 'bun:test';
import {
  DurableReceiptOcrPendingError,
  type DurableReceiptOcrBinding,
  type DurableReceiptOcrPayload,
  type DurableReceiptOcrStore,
  buildDurableReceiptOcrPayload,
  buildOcrInputContextHash,
  createSupabaseDurableReceiptOcrStore,
  executeDurableReceiptOcr,
  hasDurableOcrReviewResult,
  pollDurableReceiptOcrResult,
  RECEIPT_OCR_DEFAULT_GENERATION,
} from '@/lib/ocr/durable-result';
import { getGeminiOcrInferenceConfigSnapshot } from '@/lib/ocr/gemini';
import { buildReceiptOcrEnvelope, RECEIPT_OCR_NORMALIZATION_VERSION } from '@/lib/ocr/receipt-normalization';
import { ReviewSaveOperation } from '@/lib/reviews/review-save-operation';
import { buildReviewPhotoObjectPath } from '@/lib/review-photo-url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';

function binding(overrides: Partial<DurableReceiptOcrBinding> = {}): DurableReceiptOcrBinding {
  return {
    userId: USER_A,
    imageHash: 'a'.repeat(64),
    inputContextHash: 'b'.repeat(64),
    provider: 'gemini',
    modelPolicy: ['gemini-3.6-flash'],
    generation: RECEIPT_OCR_DEFAULT_GENERATION,
    promptVersion: 'receipt-extraction-v2',
    preprocessVersion: 'receipt-image-v3',
    normalizationVersion: RECEIPT_OCR_NORMALIZATION_VERSION,
    ...overrides,
  };
}

function payload(model = 'gemini-3.6-flash', normalizationVersion = RECEIPT_OCR_NORMALIZATION_VERSION): DurableReceiptOcrPayload {
  return {
    ...buildDurableReceiptOcrPayload({
    provider: 'gemini',
    model,
    envelope: buildReceiptOcrEnvelope({
      provider: 'gemini',
      model,
      attempts: [{ model, ok: true, elapsedMs: 1 }],
      data: {
        store_name: '테스트 식당',
        date: '2026-10-13',
        time: '12:34',
        total_amount: 12300,
        items: [{ name: '비빔밥', price: 12300 }],
        confidence: 0.98,
      },
    }),
    }),
    normalization_version: normalizationVersion,
  };
}

function fingerprint(value: DurableReceiptOcrBinding): string {
  return JSON.stringify([
    value.userId, value.imageHash, value.inputContextHash, value.provider, value.modelPolicy, value.generation,
    value.promptVersion, value.preprocessVersion, value.normalizationVersion,
  ]);
}

function fakeStore(): DurableReceiptOcrStore {
  const rows = new Map<string, {
    resultRef: string;
    claimToken: string | null;
    status: 'processing' | 'succeeded' | 'indeterminate';
    dispatchStage: 'reserved' | 'possibly_dispatched' | 'completed' | 'uncertain';
    payload?: DurableReceiptOcrPayload;
    resultRevision?: string;
  }>();
  let sequence = 1;
  return {
    async claim(input) {
      const key = fingerprint(input);
      let row = rows.get(key);
      if (!row) {
        const suffix = String(sequence++).padStart(12, '0');
        row = {
          resultRef: `10000000-0000-4000-8000-${suffix}`,
          claimToken: input.operationId,
          status: 'processing',
          dispatchStage: 'reserved',
        };
        rows.set(key, row);
        return { status: 'claimed', resultRef: row.resultRef, claimToken: input.operationId };
      }
      if (row.status === 'succeeded' && (!input.forceRefresh || row.dispatchStage === 'uncertain')) {
        return {
          status: 'cached',
          resultRef: row.resultRef,
          resultRevision: row.resultRevision!,
          payload: row.payload!,
        };
      }
      if (row.status === 'processing') {
        if (input.forceRefresh && row.dispatchStage === 'reserved') {
          row.claimToken = input.operationId;
          return { status: 'claimed', resultRef: row.resultRef, claimToken: input.operationId };
        }
        if (input.forceRefresh && row.dispatchStage === 'possibly_dispatched') {
          row.status = row.payload ? 'succeeded' : 'indeterminate';
          row.dispatchStage = 'uncertain';
          row.claimToken = null;
          return row.payload
            ? {
                status: 'cached',
                resultRef: row.resultRef,
                resultRevision: row.resultRevision!,
                payload: row.payload,
              }
            : { status: 'indeterminate', resultRef: row.resultRef };
        }
        return { status: 'processing', resultRef: row.resultRef };
      }
      if (row.status === 'indeterminate' || !input.forceRefresh) return { status: 'indeterminate', resultRef: row.resultRef };
      row.status = 'processing';
      row.dispatchStage = 'reserved';
      row.claimToken = input.operationId;
      return { status: 'claimed', resultRef: row.resultRef, claimToken: input.operationId };
    },
    async markDispatched(input) {
      const row = rows.get(fingerprint(input.binding));
      if (!row || row.resultRef !== input.resultRef || row.claimToken !== input.claimToken || row.status !== 'processing') throw new Error('claim mismatch');
      if (row.dispatchStage === 'reserved') row.dispatchStage = 'possibly_dispatched';
      if (row.dispatchStage !== 'possibly_dispatched') throw new Error('dispatch mismatch');
    },
    async complete(input) {
      const row = rows.get(fingerprint(input.binding));
      if (!row || row.resultRef !== input.resultRef || row.claimToken !== input.claimToken || row.status !== 'processing' || row.dispatchStage !== 'possibly_dispatched') throw new Error('claim mismatch');
      row.status = 'succeeded';
      row.dispatchStage = 'completed';
      row.claimToken = null;
      row.payload = input.payload;
      row.resultRevision = crypto.randomUUID();
      return row.resultRevision;
    },
    async markIndeterminate(input) {
      const row = rows.get(fingerprint(input.binding));
      if (!row || row.resultRef !== input.resultRef || row.claimToken !== input.claimToken || row.status !== 'processing' || row.dispatchStage !== 'possibly_dispatched') throw new Error('claim mismatch');
      row.status = row.payload ? 'succeeded' : 'indeterminate';
      row.dispatchStage = 'uncertain';
      row.claimToken = null;
    },
    async release(input) {
      const key = fingerprint(input.binding);
      const row = rows.get(key);
      if (!row || row.resultRef !== input.resultRef || row.claimToken !== input.claimToken || row.status !== 'processing' || row.dispatchStage !== 'reserved') throw new Error('claim mismatch');
      if (row.payload) {
        row.status = 'succeeded';
        row.dispatchStage = 'completed';
        row.claimToken = null;
      } else {
        rows.delete(key);
      }
    },
    async read(input) {
      const row = rows.get(fingerprint(input));
      if (!row) return { status: 'not_found' };
      if (row.status === 'succeeded') return {
        status: 'succeeded',
        resultRef: row.resultRef,
        resultRevision: row.resultRevision!,
        payload: row.payload!,
      };
      return { status: row.status, resultRef: row.resultRef };
    },
  };
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('durable receipt OCR execution', () => {
  test('calls the funded provider once, then reuses the verified result without consuming another call', async () => {
    const store = fakeStore();
    let providerCalls = 0;
    let quotaReservations = 0;
    const run = () => executeDurableReceiptOcr({
      store,
      binding: binding(),
      operationId: crypto.randomUUID(),
      forceRefresh: false,
      beforeProvider: async () => { quotaReservations++; },
      runProvider: async () => { providerCalls++; return payload(); },
    });

    const first = await run();
    const reused = await run();
    expect(first.cacheReused).toBe(false);
    expect(reused.cacheReused).toBe(true);
    expect(reused.resultRef).toBe(first.resultRef);
    expect(reused.resultRevision).toBe(first.resultRevision);
    expect(providerCalls).toBe(1);
    expect(quotaReservations).toBe(1);
  });

  test('reuses identical inference settings, but misses when the effective thinking level changes', async () => {
    const store = fakeStore();
    const imageHash = 'c'.repeat(64);
    const mediumConfig = getGeminiOcrInferenceConfigSnapshot({
      GEMINI_OCR_THINKING_LEVEL: 'medium',
    } as NodeJS.ProcessEnv);
    const highConfig = getGeminiOcrInferenceConfigSnapshot({
      GEMINI_OCR_THINKING_LEVEL: 'high',
    } as NodeJS.ProcessEnv);
    const contextHash = (config: typeof mediumConfig) => buildOcrInputContextHash(imageHash, null, config);
    const mediumBinding = binding({ imageHash, inputContextHash: contextHash(mediumConfig) });
    const highBinding = binding({ imageHash, inputContextHash: contextHash(highConfig) });
    let providerCalls = 0;
    const run = (durableBinding: DurableReceiptOcrBinding) => executeDurableReceiptOcr({
      store,
      binding: durableBinding,
      operationId: crypto.randomUUID(),
      forceRefresh: false,
      runProvider: async () => { providerCalls++; return payload(); },
    });

    const first = await run(mediumBinding);
    const samePolicy = await run(mediumBinding);
    const changedPolicy = await run(highBinding);

    expect(contextHash(mediumConfig)).toBe(contextHash(getGeminiOcrInferenceConfigSnapshot({
      GEMINI_OCR_THINKING_LEVEL: 'MEDIUM',
    } as NodeJS.ProcessEnv)));
    expect(contextHash(highConfig)).not.toBe(contextHash(mediumConfig));
    expect(first.cacheReused).toBe(false);
    expect(samePolicy.cacheReused).toBe(true);
    expect(changedPolicy.cacheReused).toBe(false);
    expect(changedPolicy.resultRef).not.toBe(first.resultRef);
    expect(providerCalls).toBe(2);

    const statusRead = await pollDurableReceiptOcrResult({
      store,
      binding: mediumBinding,
      attempts: 1,
    });
    expect(statusRead.status).toBe('succeeded');
    expect(providerCalls).toBe(2);
  });

  test('binds the ordered model policy while preserving the actual fallback response model', async () => {
    const store = fakeStore();
    const policyBinding = binding({ modelPolicy: ['gemini-primary', 'gemini-fallback'] });
    const first = await executeDurableReceiptOcr({
      store,
      binding: policyBinding,
      operationId: crypto.randomUUID(),
      forceRefresh: false,
      runProvider: async () => payload('gemini-fallback'),
    });
    expect(first.payload.model).toBe('gemini-fallback');
    expect((await store.read(policyBinding))).toMatchObject({
      status: 'succeeded',
      resultRef: first.resultRef,
      resultRevision: first.resultRevision,
      payload: { model: 'gemini-fallback' },
    });
    const reused = await executeDurableReceiptOcr({
      store,
      binding: policyBinding,
      operationId: crypto.randomUUID(),
      forceRefresh: false,
      runProvider: async () => { throw new Error('unexpected_provider_call'); },
    });
    expect(reused.cacheReused).toBe(true);
  });

  test('bounded owner-scoped readback receives a committed result without another claim or provider call', async () => {
    const expected = payload('gemini-fallback');
    const states = [
      { status: 'not_found' as const },
      { status: 'processing' as const, resultRef: '10000000-0000-4000-8000-000000000001' },
      {
        status: 'succeeded' as const,
        resultRef: '10000000-0000-4000-8000-000000000001',
        resultRevision: '20000000-0000-4000-8000-000000000001',
        payload: expected,
      },
    ];
    let reads = 0;
    let waits = 0;
    const result = await pollDurableReceiptOcrResult({
      store: { read: async () => states[reads++] ?? states.at(-1)! },
      binding: binding({ modelPolicy: ['gemini-primary', 'gemini-fallback'] }),
      attempts: 4,
      wait: async () => { waits++; },
    });
    expect(result).toEqual(states[2]);
    expect(reads).toBe(3);
    expect(waits).toBe(2);
  });

  test('bounded readback never turns processing or missing state into a claim', async () => {
    for (const status of ['not_found', 'processing'] as const) {
      let reads = 0;
      const result = await pollDurableReceiptOcrResult({
        store: { read: async () => {
          reads++;
          return status === 'processing'
            ? { status, resultRef: '10000000-0000-4000-8000-000000000001' }
            : { status };
        } },
        binding: binding(),
        attempts: 4,
      });
      expect(result.status).toBe(status);
      expect(reads).toBe(4);
    }
  });

  test('admits one provider call for concurrent duplicate requests', async () => {
    const store = fakeStore();
    const entered = gate();
    const finish = gate();
    let providerCalls = 0;
    const first = executeDurableReceiptOcr({
      store,
      binding: binding(),
      operationId: crypto.randomUUID(),
      forceRefresh: false,
      runProvider: async () => {
        providerCalls++;
        entered.resolve();
        await finish.promise;
        return payload();
      },
    });
    await entered.promise;
    await expect(executeDurableReceiptOcr({
      store,
      binding: binding(),
      operationId: crypto.randomUUID(),
      forceRefresh: false,
      runProvider: async () => { providerCalls++; return payload(); },
    })).rejects.toMatchObject({ state: 'processing' } satisfies Partial<DurableReceiptOcrPendingError>);
    finish.resolve();
    await first;
    expect(providerCalls).toBe(1);
  });

  test('does not reuse across owner, input, model, prompt, preprocess or normalization boundaries', async () => {
    const store = fakeStore();
    let providerCalls = 0;
    for (const bound of [
      binding(),
      binding({ userId: USER_B }),
      binding({ imageHash: 'c'.repeat(64) }),
      binding({ inputContextHash: 'd'.repeat(64) }),
      binding({ modelPolicy: ['gemini-next'] }),
      binding({ generation: '00000000-0000-4000-8000-000000000099' }),
      binding({ promptVersion: 'receipt-extraction-v3' }),
      binding({ preprocessVersion: 'receipt-image-v4' }),
      binding({ normalizationVersion: 'receipt-normalization-v2' }),
    ]) {
      await executeDurableReceiptOcr({
        store,
        binding: bound,
        operationId: crypto.randomUUID(),
        forceRefresh: false,
        runProvider: async () => { providerCalls++; return payload(bound.modelPolicy[0], bound.normalizationVersion); },
      });
    }
    expect(providerCalls).toBe(9);
  });

  test('keeps an uncertain provider call non-retryable even when force refresh is requested', async () => {
    const store = fakeStore();
    let providerCalls = 0;
    const first = () => executeDurableReceiptOcr({
      store,
      binding: binding(),
      operationId: crypto.randomUUID(),
      forceRefresh: false,
      runProvider: async () => { providerCalls++; throw new Error('synthetic lost response'); },
    });
    await expect(first()).rejects.toThrow('synthetic lost response');
    await expect(first()).rejects.toMatchObject({ state: 'indeterminate' } satisfies Partial<DurableReceiptOcrPendingError>);
    expect(providerCalls).toBe(1);

    await expect(executeDurableReceiptOcr({
      store,
      binding: binding(),
      operationId: crypto.randomUUID(),
      forceRefresh: true,
      runProvider: async () => { providerCalls++; return payload(); },
    })).rejects.toMatchObject({ state: 'indeterminate' } satisfies Partial<DurableReceiptOcrPendingError>);
    expect(providerCalls).toBe(1);
  });

  test('recovers only an explicitly forced reservation that was durably undispatched', async () => {
    const store = fakeStore();
    const abandoned = await store.claim({
      ...binding(), operationId: '10000000-0000-4000-8000-000000000091', forceRefresh: false,
    });
    expect(abandoned.status).toBe('claimed');
    let providerCalls = 0;
    const recovered = await executeDurableReceiptOcr({
      store,
      binding: binding(),
      operationId: '10000000-0000-4000-8000-000000000092',
      forceRefresh: true,
      runProvider: async () => { providerCalls++; return payload(); },
    });
    expect(recovered.cacheReused).toBe(false);
    expect(providerCalls).toBe(1);
    if (abandoned.status === 'claimed') {
      await expect(store.markDispatched({
        binding: binding(), resultRef: abandoned.resultRef, claimToken: abandoned.claimToken,
      })).rejects.toThrow('claim mismatch');
    }
  });

  test('turns a possibly dispatched abandoned claim uncertain without replaying it', async () => {
    const store = fakeStore();
    const abandoned = await store.claim({
      ...binding(), operationId: '10000000-0000-4000-8000-000000000093', forceRefresh: false,
    });
    expect(abandoned.status).toBe('claimed');
    if (abandoned.status !== 'claimed') throw new Error('fixture claim failed');
    await store.markDispatched({
      binding: binding(), resultRef: abandoned.resultRef, claimToken: abandoned.claimToken,
    });
    let providerCalls = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(executeDurableReceiptOcr({
        store,
        binding: binding(),
        operationId: crypto.randomUUID(),
        forceRefresh: true,
        runProvider: async () => { providerCalls++; return payload(); },
      })).rejects.toMatchObject({ state: 'indeterminate' } satisfies Partial<DurableReceiptOcrPendingError>);
    }
    expect(providerCalls).toBe(0);
  });

  test('does not call the provider when dispatch-stage acknowledgement is lost', async () => {
    const delegate = fakeStore();
    let loseDispatchAck = true;
    const store: DurableReceiptOcrStore = {
      ...delegate,
      async markDispatched(input) {
        await delegate.markDispatched(input);
        if (loseDispatchAck) {
          loseDispatchAck = false;
          throw new Error('synthetic dispatch ACK loss');
        }
      },
    };
    let providerCalls = 0;
    await expect(executeDurableReceiptOcr({
      store,
      binding: binding(),
      operationId: crypto.randomUUID(),
      forceRefresh: false,
      runProvider: async () => { providerCalls++; return payload(); },
    })).rejects.toThrow('synthetic dispatch ACK loss');
    await expect(executeDurableReceiptOcr({
      store,
      binding: binding(),
      operationId: crypto.randomUUID(),
      forceRefresh: true,
      runProvider: async () => { providerCalls++; return payload(); },
    })).rejects.toMatchObject({ state: 'indeterminate' } satisfies Partial<DurableReceiptOcrPendingError>);
    expect(providerCalls).toBe(0);
  });

  test('reuses a committed result after completion acknowledgement loss with one provider call', async () => {
    const delegate = fakeStore();
    let loseCompletionAck = true;
    const store: DurableReceiptOcrStore = {
      ...delegate,
      async complete(input) {
        const resultRevision = await delegate.complete(input);
        if (loseCompletionAck) {
          loseCompletionAck = false;
          throw new Error('synthetic completion ACK loss');
        }
        return resultRevision;
      },
    };
    let providerCalls = 0;
    const run = () => executeDurableReceiptOcr({
      store,
      binding: binding(),
      operationId: crypto.randomUUID(),
      forceRefresh: false,
      runProvider: async () => { providerCalls++; return payload(); },
    });
    await expect(run()).rejects.toThrow('synthetic completion ACK loss');
    expect((await run()).cacheReused).toBe(true);
    expect(providerCalls).toBe(1);
  });

  test('rejects tab A revision after tab B force-refreshes the same result reference', async () => {
    const store = fakeStore();
    const tabA = await executeDurableReceiptOcr({
      store,
      binding: binding(),
      operationId: crypto.randomUUID(),
      forceRefresh: false,
      runProvider: async () => payload(),
    });
    const replacement = payload();
    replacement.normalized = { ...replacement.normalized, total_amount: 45600 };
    const tabB = await executeDurableReceiptOcr({
      store,
      binding: binding(),
      operationId: crypto.randomUUID(),
      forceRefresh: true,
      runProvider: async () => replacement,
    });

    expect(tabB.resultRef).toBe(tabA.resultRef);
    expect(tabB.resultRevision).not.toBe(tabA.resultRevision);
    const saveAgainstCurrentRevision = (revision: string) => {
      if (revision !== tabB.resultRevision) throw new Error('receipt_ocr_result_stale');
      return replacement.normalized.total_amount;
    };
    expect(() => saveAgainstCurrentRevision(tabA.resultRevision)).toThrow('receipt_ocr_result_stale');
    expect(saveAgainstCurrentRevision(tabB.resultRevision)).toBe(45600);
  });

  test('keeps the last verified result when a forced replacement fails before or after provider dispatch', async () => {
    const store = fakeStore();
    let providerCalls = 0;
    const runNormal = () => executeDurableReceiptOcr({
      store,
      binding: binding(),
      operationId: crypto.randomUUID(),
      forceRefresh: false,
      runProvider: async () => { providerCalls++; return payload(); },
    });
    const original = await runNormal();

    await expect(executeDurableReceiptOcr({
      store,
      binding: binding(),
      operationId: crypto.randomUUID(),
      forceRefresh: true,
      beforeProvider: async () => { throw new Error('synthetic quota unavailable'); },
      runProvider: async () => { providerCalls++; return payload(); },
    })).rejects.toThrow('synthetic quota unavailable');
    expect((await runNormal()).resultRef).toBe(original.resultRef);
    expect(providerCalls).toBe(1);

    await expect(executeDurableReceiptOcr({
      store,
      binding: binding(),
      operationId: crypto.randomUUID(),
      forceRefresh: true,
      runProvider: async () => { providerCalls++; throw new Error('synthetic lost refresh response'); },
    })).rejects.toThrow('synthetic lost refresh response');
    expect((await runNormal()).resultRef).toBe(original.resultRef);
    expect(providerCalls).toBe(2);
  });

  test('rejects a tampered cached payload before it reaches the review flow', async () => {
    const valid = payload();
    const tamperedPayloads = [
      { ...valid, provider: 'other-provider' },
      { ...valid, model: 'gemini-other' },
      { ...valid, normalization_version: 'receipt-normalization-other' },
      { ...valid, normalized: { ...valid.normalized, raw_text: 'provider output' } },
      { ...valid, normalized: { ...valid.normalized, store_name: 'x'.repeat(161) } },
      {
        ...valid,
        field_trust: valid.field_trust.map((entry, index) => index === 0
          ? { ...entry, rawValue: 'provider raw value' }
          : entry),
      },
    ];
    for (const resultPayload of tamperedPayloads) {
      const store = createSupabaseDurableReceiptOcrStore({
        rpc: async () => ({
          error: null,
          data: {
            status: 'cached',
            result_ref: '10000000-0000-4000-8000-000000000001',
            result_revision: '20000000-0000-4000-8000-000000000001',
            result_payload: resultPayload,
          },
        }),
      });
      await expect(store.claim({ ...binding(), operationId: crypto.randomUUID(), forceRefresh: false }))
        .rejects.toThrow('OCR_RESULT_PERSISTENCE_FAILED');
    }
  });

  test('persists only the bounded public receipt contract', () => {
    const durable = buildDurableReceiptOcrPayload({
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      envelope: buildReceiptOcrEnvelope({
        provider: 'gemini',
        model: 'gemini-3.6-flash',
        attempts: [{ model: 'gemini-3.6-flash', ok: true, elapsedMs: 25, error: 'must not persist' }],
        data: {
          store_name: '테스트 식당',
          date: '2026-10-13',
          time: '12:34',
          total_amount: 12300,
          category: '한식',
          review_draft: '맛있게 먹은 메뉴를 확인해서 작성해주세요.',
          items: [{ name: '비빔밥', price: 12300 }],
          confidence: 0.98,
        },
      }),
    });
    expect(Object.keys(durable.normalized).sort()).toEqual([
      'category', 'confidence', 'date', 'items', 'review_draft', 'store_name', 'time', 'total_amount',
    ]);
    expect(durable).not.toHaveProperty('raw');
    expect(durable).not.toHaveProperty('attempts');
    expect(durable.field_trust.every((entry) => !('rawValue' in entry) && !('normalizedValue' in entry))).toBe(true);
  });

  test('preserves an administrator-corrected receipt instead of scheduling another provider call', () => {
    expect(hasDurableOcrReviewResult({
      ocr_processed_at: '2026-10-13T10:00:00.000Z',
      receipt_data: {
        schema_version: 'receipt_summary_v1',
        status: 'processed',
        store_name: '관리자 교정 상호',
        corrected_by_admin: true,
      },
    })).toBe(true);
    expect(hasDurableOcrReviewResult({
      ocr_processed_at: null,
      receipt_data: { status: 'operator_corrected', store_name: '부분 교정 상호' },
      receipt_hash: null,
      is_duplicate: false,
    })).toBe(true);
    expect(hasDurableOcrReviewResult({
      ocr_processed_at: null,
      receipt_data: null,
      receipt_hash: 'a'.repeat(64),
      is_duplicate: false,
    })).toBe(true);
    expect(hasDurableOcrReviewResult({ ocr_processed_at: null, receipt_data: null })).toBe(false);
    const adminProcessor = readFileSync(join(import.meta.dir, '../lib/ocr/admin-receipt-processor.ts'), 'utf8');
    expect(adminProcessor).toContain('if (hasDurableOcrReviewResult(review))');
    expect(adminProcessor).toContain('getReviewReceiptOcrGeneration(');
    expect(adminProcessor).toContain('publishReviewReceiptOcrResult(');
    expect(adminProcessor).toContain('forceRefresh: false');
    expect(adminProcessor).not.toContain('.from(\'reviews\')\n        .update(update)');
  });

  test('binds an administrator reset to a fresh durable generation before processing', () => {
    const migration = readFileSync(join(
      import.meta.dir,
      '../../../backend/supabase/migrations/20261013190000_durable_receipt_ocr_results.sql',
    ), 'utf8');
    const adminProcessor = readFileSync(join(import.meta.dir, '../lib/ocr/admin-receipt-processor.ts'), 'utf8');

    expect(migration).toContain('CREATE TRIGGER review_ocr_generation_on_reset');
    expect(migration).toContain('EXECUTE FUNCTION ocr_private.register_review_ocr_generation()');
    expect(adminProcessor.indexOf('getReviewReceiptOcrGeneration(')).toBeLessThan(
      adminProcessor.indexOf('executeDurableReceiptOcr({'),
    );
    expect(adminProcessor).toContain('generation,');
    expect(adminProcessor).toContain('forceRefresh: false');
  });

  test('serializes concurrent review saves and requires OCR reference readback', async () => {
    const entered = gate();
    const finish = gate();
    let inserts = 0;
    let saved = false;
    const reviewId = '20000000-0000-4000-8000-000000000001';
    const ocrResultRef = '30000000-0000-4000-8000-000000000001';
    const ocrResultRevision = '30000000-0000-4000-8000-000000000002';
    const ownerId = USER_A;
    const restaurantId = '40000000-0000-4000-8000-000000000001';
    const verification = buildReviewPhotoObjectPath({ ownerId, reviewId, purpose: 'verification' }, 'receipt.jpg')!;
    const food = buildReviewPhotoObjectPath({ ownerId, reviewId, purpose: 'food' }, 'food.webp')!;
    const operation = new ReviewSaveOperation({
      currentOwner: () => ownerId,
      newId: () => reviewId,
      prepare: async () => [
        { path: verification, purpose: 'verification', file: new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' }) },
        { path: food, purpose: 'food', file: new File(['food'], 'food.webp', { type: 'image/webp' }) },
      ],
      upload: async () => ({ error: null }),
      insert: async () => {
        inserts++;
        entered.resolve();
        await finish.promise;
        saved = true;
        return { error: null };
      },
      read: async () => ({
        error: null,
        data: saved ? {
          id: reviewId,
          user_id: ownerId,
          restaurant_id: restaurantId,
          verification_photo: verification,
          food_photos: [food],
          receipt_data: { ocr_result_id: ocrResultRef, ocr_result_revision: ocrResultRevision },
          ocr_processed_at: '2026-10-13T10:00:00.000Z',
        } : null,
      }),
      cleanup: async () => true,
    });
    const draft = {
      ownerId,
      restaurantId,
      title: '테스트 리뷰',
      content: '동시 저장 테스트를 위한 충분히 긴 리뷰 내용입니다.',
      visitedAt: '2026-10-13T12:34:00',
      categories: ['한식'],
      verificationPhoto: new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' }),
      foodPhotos: [new File(['food'], 'food.webp', { type: 'image/webp' })],
      ocrResultRef,
      ocrResultRevision,
    };
    const first = operation.submit(draft);
    await entered.promise;
    expect(await operation.submit(draft)).toBe('blocked');
    expect(inserts).toBe(1);
    finish.resolve();
    expect(await first).toBe('saved');
  });

  test('review save sends only an OCR result reference and revision while the server derives receipt fields', () => {
    const modal = readFileSync(join(import.meta.dir, '../components/reviews/ReviewModal.tsx'), 'utf8');
    const route = readFileSync(join(import.meta.dir, '../app/api/ocr/reviews/save/route.ts'), 'utf8');
    expect(modal).toContain('ocrResultRef: draft.ocrResultRef');
    expect(modal).toContain('ocrResultRevision: draft.ocrResultRevision');
    expect(modal).not.toContain('receipt_data: data');
    expect(route).toContain(".rpc('create_review_with_receipt_ocr");
    expect(route).toContain('p_ocr_result_id: body.ocrResultRef');
    expect(route).toContain('p_ocr_result_revision: body.ocrResultRevision');
    expect(route).toContain('receiptData?.ocr_result_id !== body.ocrResultRef');
    expect(route).toContain('receiptData?.ocr_result_revision !== body.ocrResultRevision');
  });

  test('migration keeps durable results private, version-bound and non-expiring on uncertainty', () => {
    const migration = readFileSync(join(import.meta.dir, '../../../backend/supabase/migrations/20261013190000_durable_receipt_ocr_results.sql'), 'utf8');
    expect(migration).toContain('CREATE SCHEMA IF NOT EXISTS ocr_private');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS receipt_hash text');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS receipt_data jsonb');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS is_duplicate boolean DEFAULT false');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS ocr_processed_at timestamptz');
    expect(migration).toContain("RAISE EXCEPTION 'REVIEW_OCR_COLUMN_CONTRACT_DRIFT'");
    expect(migration).toContain("attribute.attidentity = ''");
    expect(migration).toContain("attribute.attgenerated = ''");
    expect(migration).toContain('attribute.atttypmod = -1');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_receipt_hash');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS reviews_ocr_pending_idx');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS reviews_duplicate_idx');
    expect(migration).toContain("RAISE EXCEPTION 'REVIEW_OCR_INDEX_CONTRACT_DRIFT'");
    expect(migration).toContain("access_method.amname = 'btree'");
    expect(migration).toContain('index_row.indisvalid');
    expect(migration).toContain('index_row.indisready');
    expect(migration).toContain('index_row.indislive');
    expect(migration).toContain('v_review_ocr_columns_ready boolean');
    expect(migration).toContain('v_review_ocr_indexes_ready boolean');
    expect(migration).toContain('AND coalesce(v_review_ocr_columns_ready, false)');
    expect(migration).toContain('AND coalesce(v_review_ocr_indexes_ready, false)');
    expect(migration).toContain('ALTER TABLE ocr_private.receipt_results FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE ocr_private.receipt_results FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.claim_receipt_ocr_result');
    expect(migration).toContain('TO service_role');
    expect(migration).toContain('user_id,\n    image_hash,\n    input_context_hash,\n    provider,\n    model_policy,\n    generation,\n    prompt_version,\n    preprocess_version,\n    normalization_version');
    expect(migration).toContain("status IN ('processing', 'succeeded', 'indeterminate')");
    expect(migration).toContain('model_policy jsonb NOT NULL');
    expect(migration).toContain('generation uuid NOT NULL');
    expect(migration).toContain('public.read_receipt_ocr_result(');
    expect(migration).toContain('public.get_review_receipt_ocr_generation(');
    expect(migration).toContain('public.publish_review_receipt_ocr_result(');
    expect(migration).toContain('CREATE FUNCTION ocr_private.register_review_ocr_generation()');
    expect(migration).toContain('SECURITY DEFINER\nSET search_path = \'\'');
    expect(migration).toContain('REVOKE ALL ON FUNCTION ocr_private.register_review_ocr_generation() FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain('Rows have no automatic TTL');
    expect(migration).toContain("WHERE id = p_result_id\n    AND user_id = p_user_id\n    AND generation = p_generation\n    AND status = 'succeeded'\n  FOR SHARE;");
    expect(migration).toContain('v_result.result_revision IS DISTINCT FROM p_ocr_result_revision');
    expect(migration).toContain("RAISE EXCEPTION 'receipt_ocr_result_stale'");
    expect(migration.indexOf('FROM public.reviews\n  WHERE id = p_review_id AND user_id = p_user_id\n  FOR UPDATE;')).toBeLessThan(
      migration.indexOf('FROM ocr_private.review_generations\n  WHERE review_id = p_review_id AND user_id = p_user_id\n  FOR SHARE;'),
    );
    expect(migration).toContain('pg_advisory_xact_lock');
  });
});

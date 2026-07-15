import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createNotificationRealtimeSubscription,
  NOTIFICATION_CLIENT_ACQUISITION_TIMEOUT_MS,
  NOTIFICATION_FIRST_STATUS_TIMEOUT_MS,
  NOTIFICATION_READBACK_TIMEOUT_MS,
  prependRealtimeNotification,
  reconcileNotificationReadback,
  createNotificationLoadRequestTracker,
  replayNotificationMutations,
  runOwnerNotificationMutation,
  applyOwnerNotificationMutation,
  type NotificationRpcClient,
} from '../contexts/NotificationContext';
import { NextRequest } from 'next/server';
import {
  createMarketingCampaignPost,
  type MarketingCampaignRpcClient,
} from '../lib/privacy/marketing-campaigns';

const notificationFixture = (id: string, isRead = false) => ({
  id,
  type: 'admin_announcement' as const,
  title: '알림 제목',
  message: '알림 내용',
  createdAt: new Date('2026-07-13T00:00:00.000Z'),
  isRead,
  data: {},
});

const webSource = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const repoSource = (relativePath: string) => readFileSync(join(import.meta.dir, '..', '..', '..', relativePath), 'utf8');
const MARKETING_ROUTE_IDS = {
  actor: '14300000-0000-4000-8000-000000000001',
  recipient: '14300000-0000-4000-8000-000000000002',
  operation: '14300000-0000-4000-8000-000000000010',
  batch: '14300000-0000-4000-8000-000000000011',
  claim: '14300000-0000-4000-8000-000000000012',
  attempt: '14300000-0000-4000-8000-000000000013',
};
const MARKETING_ROUTE_PREVIEW_HASH = 'a'.repeat(64);
const MARKETING_ROUTE_PAYLOAD_DIGEST = 'b'.repeat(64);
const MARKETING_ROUTE_IDEMPOTENCY_KEY = 'g014-route-test-0001';

const marketingRouteReceipt = {
  operationId: MARKETING_ROUTE_IDS.operation,
  status: 'applied',
  auditId: null,
  counts: { requested: 1, sent: 1, suppressed: 0, failed: 0 },
  readback: { passed: true, notificationRows: 1 },
};

const marketingRouteClaim = {
  status: 'claimed',
  operationId: MARKETING_ROUTE_IDS.operation,
  batchId: MARKETING_ROUTE_IDS.batch,
  claimToken: MARKETING_ROUTE_IDS.claim,
  providerAttemptId: MARKETING_ROUTE_IDS.attempt,
  providerIdentity: 'g014_https_provider_v1',
  idempotencyKey: MARKETING_ROUTE_IDEMPOTENCY_KEY,
  payloadDigest: MARKETING_ROUTE_PAYLOAD_DIGEST,
  payload: {
    operationId: MARKETING_ROUTE_IDS.operation,
    batchId: MARKETING_ROUTE_IDS.batch,
    claimToken: MARKETING_ROUTE_IDS.claim,
    providerAttemptId: MARKETING_ROUTE_IDS.attempt,
    idempotencyKey: MARKETING_ROUTE_IDEMPOTENCY_KEY,
    channel: 'sms',
    title: '발송 안내',
    message: '동의한 사용자에게만 발송합니다.',
    data: {},
    recipientUserIds: [MARKETING_ROUTE_IDS.recipient],
  },
};

const marketingApplyRequest = () => new NextRequest('http://localhost/api/admin/marketing-campaigns', {
  method: 'POST',
  headers: {
    authorization: 'Bearer g014-route-test-token',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    action: 'apply',
    operationId: MARKETING_ROUTE_IDS.operation,
    previewHash: MARKETING_ROUTE_PREVIEW_HASH,
    confirmationText: '마케팅 발송을 확인합니다',
    idempotencyKey: MARKETING_ROUTE_IDEMPOTENCY_KEY,
  }),
});

type MarketingRouteHarnessOptions = {
  provider?: { identity: 'g014_https_provider_v1'; endpoint: string; token: string } | null;
  resolveDns?: (hostname: string) => Promise<readonly { address: string }[]>;
  fetch?: (url: URL, init: RequestInit) => Promise<Response>;
  rpc?: (fn: string, params: Record<string, unknown>) => Promise<unknown>;
  providerTimeoutMs?: number;
};

function createMarketingRouteHarness(options: MarketingRouteHarnessOptions = {}) {
  const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  const client: MarketingCampaignRpcClient = {
    rpc: async (fn, params = {}) => {
      rpcCalls.push({ fn, params });
      const data = options.rpc
        ? await options.rpc(fn, params)
        : fn === 'prepare_marketing_campaign_batch'
          ? { status: 'prepared', replayed: false, operationId: MARKETING_ROUTE_IDS.operation, batchId: MARKETING_ROUTE_IDS.batch }
          : fn === 'claim_marketing_campaign_dispatch'
            ? marketingRouteClaim
            : marketingRouteReceipt;
      return { data, error: null };
    },
  };
  const post = createMarketingCampaignPost({
    requireAdmin: async () => ({ ok: true, userId: MARKETING_ROUTE_IDS.actor }),
    createServiceClient: () => client,
    provider: options.provider === undefined
      ? { identity: 'g014_https_provider_v1' as const, endpoint: 'https://synthetic-provider.test.example/v1/dispatch', token: 'synthetic-test-token' }
      : options.provider,
    resolveDns: options.resolveDns ?? (async () => [{ address: '203.0.113.20' }]),
    fetch: options.fetch ?? (async () => new Response(JSON.stringify({
      acceptedRecipientIds: [MARKETING_ROUTE_IDS.recipient],
      providerReceiptId: 'provider-receipt-1',
      idempotencyKey: MARKETING_ROUTE_IDEMPOTENCY_KEY,
      providerAttemptId: MARKETING_ROUTE_IDS.attempt,
      payloadDigest: MARKETING_ROUTE_PAYLOAD_DIGEST,
    }), { status: 200 })),
    now: () => Date.parse('2026-07-13T00:00:00.000Z'),
    providerTimeoutMs: options.providerTimeoutMs ?? 20,
  });

  return { post, rpcCalls };
}

describe('G010 notification consent contract', () => {
  test('owner mark and delete mutations use exact RPC payloads and update local state after success', async () => {
    const rpcCalls: Array<{ fn: string; params: Record<string, unknown> | undefined }> = [];
    const rpc: NotificationRpcClient['rpc'] = async (request) => {
      rpcCalls.push({
        fn: request.fn,
        params: 'params' in request ? request.params : undefined,
      });
      return { data: null, error: null };
    };
    let notifications = [
      notificationFixture('notification-read'),
      notificationFixture('notification-delete'),
    ];

    await runOwnerNotificationMutation('mark-as-read', 'notification-read', () => {
      notifications = applyOwnerNotificationMutation('mark-as-read', 'notification-read', notifications);
    }, rpc);
    await runOwnerNotificationMutation('remove', 'notification-delete', () => {
      notifications = applyOwnerNotificationMutation('remove', 'notification-delete', notifications);
    }, rpc);

    expect(rpcCalls).toEqual([
      {
        fn: 'mark_notification_read',
        params: { notification_uuid: 'notification-read' },
      },
      {
        fn: 'delete_notification',
        params: { notification_uuid: 'notification-delete' },
      },
    ]);
    expect(notifications).toEqual([notificationFixture('notification-read', true)]);
    expect(webSource('contexts/NotificationContext.tsx')).toContain(
      "params: NotificationRpcDefinitions['mark_notification_read']['Args'];",
    );
    expect(webSource('contexts/NotificationContext.tsx')).not.toContain(
      'as unknown as SupabaseRpcClient',
    );
  });

  test('owner mutation RPC failures leave local state unchanged and report bounded errors', async () => {
    const failures = [
      {
        mutation: 'mark-as-read' as const,
        id: 'notification-read',
        message: '알림을 읽음 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      },
      {
        mutation: 'remove' as const,
        id: 'notification-delete',
        message: '알림을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      },
    ];

    for (const failure of failures) {
      const initialNotifications = [notificationFixture(failure.id)];
      let notifications = initialNotifications;
      let successCalls = 0;

      await expect(runOwnerNotificationMutation(
        failure.mutation,
        failure.id,
        () => {
          successCalls += 1;
          notifications = applyOwnerNotificationMutation(failure.mutation, failure.id, notifications);
        },
        async () => ({
          data: null,
          error: { code: '42501', message: 'raw database failure' },
        }),
      )).rejects.toThrow(failure.message);

      expect(successCalls).toBe(0);
      expect(notifications).toBe(initialNotifications);
    }
  });
  test('failed notification mutations never change local state as success', () => {
    const source = webSource('contexts/NotificationContext.tsx');
    expect(source).toContain("throw new Error('알림을 읽음 처리하지 못했습니다.");
    expect(source).toContain("throw new Error('알림을 삭제하지 못했습니다.");
    expect(source).toContain("throw new Error('알림을 만들지 못했습니다.");
    expect(source).toContain("throw new Error('invalid_notification_payload');");
    expect(source).not.toContain('서버 함수가 없는 경우');
    expect(source).not.toContain('알림 시스템이 아직 설정되지 않았습니다.');
    expect(source).not.toContain("console.error('알림 삭제 실패:'");
  });

  test('schema makes transactional bypass explicit and marketing consent channel-bound', () => {
    const migration = repoSource('backend/supabase/migrations/20260712000200_g010_notification_marketing.sql');
    expect(migration).toContain("classification in ('transactional', 'marketing')");
    expect(migration).toContain("classification = 'transactional' and consent_event_id is null");
    expect(migration).toContain("state.purpose=p_channel || '_marketing'");
    expect(migration).toContain("state.decision='granted'");
    expect(migration).toContain("state.purpose='night_marketing'");
    expect(migration).toContain("p_channel <> 'email'");
    expect(migration).toContain("time '21:00' or v_local_time < time '08:00'");
    expect(migration).toContain('revoke all on table public.notifications from public, anon, authenticated;');
    expect(migration).toContain('create policy notifications_owner_select');
    expect(migration).not.toContain('grant insert on table public.notifications to authenticated;');
    expect(migration).toContain("public.privacy_resolve_audit_retention_until('privacy_marketing_audit',v_occurred_at)");
    expect(migration).toContain("jsonb_build_object('route','/api/admin/marketing-campaigns')");
    expect(migration).not.toContain("interval '1 year'");
    expect(migration).toContain('pg_catalog.clock_timestamp()');
    expect(migration).not.toContain("timezone('utc'");
  });

  test('campaign route durably claims an unknown attempt before synthetic provider egress and finalizes only its exact binding', async () => {
    const events: string[] = [];
    const { post, rpcCalls } = createMarketingRouteHarness({
      rpc: async (fn) => {
        events.push(`rpc:${fn}`);
        if (fn === 'prepare_marketing_campaign_batch') {
          return { status: 'prepared', replayed: false, operationId: MARKETING_ROUTE_IDS.operation, batchId: MARKETING_ROUTE_IDS.batch };
        }
        if (fn === 'claim_marketing_campaign_dispatch') {
          events.push('durable-unknown-attempt');
          return marketingRouteClaim;
        }
        return marketingRouteReceipt;
      },
      fetch: async () => {
        events.push('fetch');
        expect(events).toEqual([
          'rpc:prepare_marketing_campaign_batch',
          'rpc:claim_marketing_campaign_dispatch',
          'durable-unknown-attempt',
          'fetch',
        ]);
        return new Response(JSON.stringify({
          acceptedRecipientIds: [MARKETING_ROUTE_IDS.recipient.toUpperCase()],
          providerReceiptId: 'provider-receipt-1',
          idempotencyKey: MARKETING_ROUTE_IDEMPOTENCY_KEY,
          providerAttemptId: MARKETING_ROUTE_IDS.attempt,
          payloadDigest: MARKETING_ROUTE_PAYLOAD_DIGEST,
        }), { status: 200 });
      },
    });

    const response = await post(marketingApplyRequest());

    expect(response.status).toBe(200);
    expect(events).toEqual([
      'rpc:prepare_marketing_campaign_batch',
      'rpc:claim_marketing_campaign_dispatch',
      'durable-unknown-attempt',
      'fetch',
      'rpc:finalize_marketing_campaign_batch',
    ]);
    const finalize = rpcCalls.find(({ fn }) => fn === 'finalize_marketing_campaign_batch');
    expect(finalize?.params).toMatchObject({
      p_operation_id: MARKETING_ROUTE_IDS.operation,
      p_batch_id: MARKETING_ROUTE_IDS.batch,
      p_claim_token: MARKETING_ROUTE_IDS.claim,
      p_provider_attempt_id: MARKETING_ROUTE_IDS.attempt,
      p_provider_payload_digest: MARKETING_ROUTE_PAYLOAD_DIGEST,
      p_accepted_user_ids: [MARKETING_ROUTE_IDS.recipient],
    });
    expect(finalize?.params.p_provider_receipt_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('production marketing egress remains unavailable without a reviewed provider configuration', async () => {
    let dnsCalls = 0;
    let fetchCalls = 0;
    const { post, rpcCalls } = createMarketingRouteHarness({
      provider: null,
      resolveDns: async () => {
        dnsCalls += 1;
        return [{ address: '203.0.113.20' }];
      },
      fetch: async () => {
        fetchCalls += 1;
        return new Response();
      },
    });

    const response = await post(marketingApplyRequest());

    expect(response.status).toBe(503);
    expect(dnsCalls).toBe(0);
    expect(fetchCalls).toBe(0);
    expect(rpcCalls.map(({ fn }) => fn)).toEqual([
      'prepare_marketing_campaign_batch',
      'fail_marketing_campaign_batch',
    ]);
  });

  test('private and mixed DNS answers are rejected before claim or egress', async () => {
    for (const addresses of [
      [{ address: '127.0.0.1' }],
      [{ address: '203.0.113.20' }, { address: '10.0.0.7' }],
    ]) {
      let fetchCalls = 0;
      const { post, rpcCalls } = createMarketingRouteHarness({
        resolveDns: async () => addresses,
        fetch: async () => {
          fetchCalls += 1;
          return new Response();
        },
      });

      const response = await post(marketingApplyRequest());

      expect(response.status).toBe(503);
      expect(fetchCalls).toBe(0);
      expect(rpcCalls.map(({ fn }) => fn)).toEqual([
        'prepare_marketing_campaign_batch',
        'fail_marketing_campaign_batch',
      ]);
    }
  });

  test('ambiguous, redirected, slow, oversized, and malformed provider outcomes are bounded and never finalized or retried', async () => {
    const slowBody = new ReadableStream<Uint8Array>({
      start() {
        // The route deadline must cancel this body without provider diagnostics.
      },
    });
    const cases: Array<{ name: string; fetch: () => Promise<Response> }> = [
      { name: 'transport timeout', fetch: async () => { throw new Error('timeout'); } },
      { name: 'redirect', fetch: async () => new Response(null, { status: 302 }) },
      { name: 'slow body', fetch: async () => new Response(slowBody) },
      { name: 'oversized body', fetch: async () => new Response(new Uint8Array(16_385)) },
      { name: 'malformed utf8', fetch: async () => new Response(new Uint8Array([0xff])) },
      { name: 'malformed json', fetch: async () => new Response('{') },
    ];

    for (const providerCase of cases) {
      let fetchCalls = 0;
      const { post, rpcCalls } = createMarketingRouteHarness({
        providerTimeoutMs: 1,
        fetch: async () => {
          fetchCalls += 1;
          return providerCase.fetch();
        },
      });

      const response = await post(marketingApplyRequest());
      const body = await response.json();

      expect(providerCase.name).toBeTruthy();
      expect(response.status).toBe(503);
      expect(body).toEqual({
        error: 'marketing_provider_outcome_unknown',
        message: '제공자 발송 결과를 확인하지 못해 재전송하지 않았습니다. 운영자 확인이 필요합니다.',
        retryable: false,
      });
      expect(fetchCalls).toBe(1);
      expect(rpcCalls.map(({ fn }) => fn)).toEqual([
        'prepare_marketing_campaign_batch',
        'claim_marketing_campaign_dispatch',
      ]);
    }
  });

  test('only stable failed provider evidence reaches the failure RPC and never the finalize RPC', async () => {
    const { post, rpcCalls } = createMarketingRouteHarness({
      fetch: async () => new Response(JSON.stringify({
        status: 'failed',
        providerReceiptId: 'provider-receipt-rejected',
        idempotencyKey: MARKETING_ROUTE_IDEMPOTENCY_KEY,
        providerAttemptId: MARKETING_ROUTE_IDS.attempt,
        payloadDigest: MARKETING_ROUTE_PAYLOAD_DIGEST,
        errorCode: 'provider_rejected',
      }), { status: 200 }),
    });

    const response = await post(marketingApplyRequest());

    expect(response.status).toBe(502);
    expect(rpcCalls.map(({ fn }) => fn)).toEqual([
      'prepare_marketing_campaign_batch',
      'claim_marketing_campaign_dispatch',
      'fail_marketing_campaign_provider_attempt',
    ]);
    const failed = rpcCalls.at(-1);
    expect(failed?.params).toMatchObject({
      p_operation_id: MARKETING_ROUTE_IDS.operation,
      p_batch_id: MARKETING_ROUTE_IDS.batch,
      p_claim_token: MARKETING_ROUTE_IDS.claim,
      p_provider_attempt_id: MARKETING_ROUTE_IDS.attempt,
      p_provider_payload_digest: MARKETING_ROUTE_PAYLOAD_DIGEST,
      p_error_code: 'provider_rejected',
    });
    expect(failed?.params.p_provider_receipt_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('G014 state machine binds claims, immutable evidence, receipts, and service-only mutation', () => {
    const migration = repoSource('backend/supabase/migrations/20260713002200_g014_marketing_state_machine.sql');
    const sql = repoSource('backend/supabase/tests/g014_marketing_state_machine.sql');
    const concurrency = repoSource('backend/supabase/tests/g014_marketing_state_machine_concurrency.test.mjs');

    expect(migration).toContain('CREATE TABLE privacy_retention.marketing_campaign_batch_recipients');
    expect(migration).toContain('g014_marketing_batch_recipients_batch_operation_fk');
    expect(migration).toContain('g014_marketing_batch_recipients_ordinary_consent_binding_fk');
    expect(migration).toContain('CREATE TABLE privacy_retention.marketing_campaign_provider_attempts');
    expect(migration).toContain("status IN ('unknown', 'accepted', 'failed')");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.claim_marketing_campaign_dispatch');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.fail_marketing_campaign_provider_attempt');
    expect(migration).toContain('p_provider_receipt_hash');
    expect(migration).toContain('marketing_provider_outcome_unknown');
    expect(migration).toContain('marketing_operation_has_unresolved_recipients');
    expect(migration).toContain('actor_ref_hash');
    expect(migration).toContain('ON DELETE SET NULL');
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.notifications');
    expect(migration).toContain('SET search_path = \'\'');

    expect(sql).toContain('20:59 ordinary consent should be allowed');
    expect(sql).toContain('21:00 exact night consent should be allowed');
    expect(sql).toContain('withdrawn latest consent must fail closed');
    expect(sql).toContain('different auth.uid must not alter service evaluator target');
    expect(sql).toContain('provider attempt was not durable before egress');
    expect(sql).toContain('unknown provider attempt replay unexpectedly produced a second claim');
    expect(sql).toContain('terminal operation retained pending/eligible/claimed recipients');
    expect(sql).toContain('actor deletion was blocked or erased the durable actor hash');
    expect(sql).toContain('accepted recipient canonical digest contract failed');
    expect(sql).toContain('owner path deleted provider attempt evidence');
    expect(concurrency).toContain('G014_CONCURRENCY_GATE_MISSING');
    expect(concurrency).toContain('new Client');
    expect(concurrency).toContain('await setServiceRoleTransaction(clientA)');
    expect(concurrency).toContain("await clientA.query('COMMIT')");
    expect(concurrency).toContain("assert(error?.code === '55000')");
  });
  test('SQL fixture covers consent withdrawal boundaries, email exception, and client denial', () => {
    const sql = repoSource('backend/supabase/tests/g010_notification_marketing_rls.sql');
    expect(sql).toContain("'2026-07-12 20:59:00+09'");
    expect(sql).toContain("'2026-07-12 21:00:00+09'");
    expect(sql).toContain("'2026-07-13 07:59:00+09'");
    expect(sql).toContain("'2026-07-13 08:00:00+09'");
    expect(sql).toContain("'ordinary_consent_missing'");
    expect(sql).toContain("'night_consent_missing'");
    expect(sql).toContain("has_table_privilege('authenticated','public.notifications','INSERT')");
    expect(sql).toContain("has_function_privilege('authenticated','public.preview_marketing_campaign");
  });
});
type StatusHandler = (status: string) => void;

type TestChannel = {
  on: (
    event: string,
    filter: Record<string, unknown>,
    onInsert: (payload: { new: Record<string, unknown> }) => void,
  ) => TestChannel;
  subscribe: (onStatus: StatusHandler) => TestChannel;
  emitStatus: (status: string) => void;
  emitInsert: (payload: { new: Record<string, unknown> }) => void;
};

type ScheduledRetry = {
  callback: () => void;
  delayMs: number;
  cancelled: boolean;
};
type RealtimeHarnessHooks = {
  onReadbackInvalidated?: () => void;
  onTransportDegraded?: () => void;
};

const settleRealtime = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
function createDeferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function createRealtimeHarness(
  readback: () => Promise<boolean> = async () => true,
  userId = 'notification-owner',
  getClientOverride?: () => Promise<unknown>,
  hooks: RealtimeHarnessHooks = {},
) {
  const channels: TestChannel[] = [];
  const retries: ScheduledRetry[] = [];
  const deadlines: ScheduledRetry[] = [];
  let transportDegradedCount = 0;
  let recoveredCount = 0;
  let insertedCount = 0;
  let removedChannelCount = 0;
  let invalidatedReadbackRequestCount = 0;

  const client = {
    channel: () => {
      let onStatus: StatusHandler | undefined;
      let onInsert: ((payload: { new: Record<string, unknown> }) => void) | undefined;
      const channel: TestChannel = {
        on: (_event, _filter, callback) => {
          onInsert = callback;
          return channel;
        },
        subscribe: (callback) => {
          onStatus = callback;
          return channel;
        },
        emitStatus: (status) => onStatus?.(status),
        emitInsert: (payload) => onInsert?.(payload),
      };

      channels.push(channel);
      return channel;
    },
    removeChannel: async () => {
      removedChannelCount += 1;
    },
  };

  const subscription = createNotificationRealtimeSubscription({
    userId,
    getClient: async () => (getClientOverride ? await getClientOverride() : client) as never,
    reloadFromServer: (_isReadbackActive, registerInvalidate) => {
      registerInvalidate(() => {
        invalidatedReadbackRequestCount += 1;
        hooks.onReadbackInvalidated?.();
      });
      return readback();
    },
    onInsert: () => {
      insertedCount += 1;
    },
    onTransportDegraded: () => {
      transportDegradedCount += 1;
      hooks.onTransportDegraded?.();
    },
    onRecovered: () => {
      recoveredCount += 1;
    },
    scheduleRetry: (callback, delayMs) => {
      const retry = { callback, delayMs, cancelled: false };
      retries.push(retry);
      return retry as unknown as ReturnType<typeof setTimeout>;
    },
    cancelRetry: (timer) => {
      (timer as unknown as ScheduledRetry).cancelled = true;
    },
    scheduleDeadline: (callback, delayMs) => {
      const deadline = { callback, delayMs, cancelled: false };
      deadlines.push(deadline);
      return deadline as unknown as ReturnType<typeof setTimeout>;
    },
    cancelDeadline: (timer) => {
      (timer as unknown as ScheduledRetry).cancelled = true;
    },
  });

  return {
    channels,
    client,
    retries,
    deadlines,
    subscription,
    get transportDegradedCount() {
      return transportDegradedCount;
    },
    get recoveredCount() {
      return recoveredCount;
    },
    get insertedCount() {
      return insertedCount;
    },
    get removedChannelCount() {
      return removedChannelCount;
    },
    get invalidatedReadbackRequestCount() {
      return invalidatedReadbackRequestCount;
    },
  };
}

describe('G010 notification realtime truthfulness contract', () => {
  test('marks every failed or unexpected subscription status as degraded without fabricating a notification', async () => {
    for (const status of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED', 'UNEXPECTED_CLOSURE']) {
      const harness = createRealtimeHarness();

      await settleRealtime();
      expect(harness.channels).toHaveLength(1);

      harness.channels[0].emitStatus(status);

      expect(harness.transportDegradedCount).toBe(1);
      expect(harness.insertedCount).toBe(0);
      expect(harness.removedChannelCount).toBe(1);
      expect(harness.retries.map((retry) => retry.delayMs)).toEqual([1_000]);

      harness.subscription.stop();
    }
  });

  test('uses bounded backoff and only clears degraded state after a subscribed server readback succeeds', async () => {
    let readbackAttempt = 0;
    const harness = createRealtimeHarness(async () => {
      readbackAttempt += 1;
      return readbackAttempt > 1;
    });

    await settleRealtime();
    harness.channels[0].emitStatus('CHANNEL_ERROR');
    expect(harness.retries.map((retry) => retry.delayMs)).toEqual([1_000]);

    harness.retries[0].callback();
    await settleRealtime();
    harness.channels[1].emitStatus('SUBSCRIBED');
    await settleRealtime();

    expect(harness.recoveredCount).toBe(0);
    expect(harness.transportDegradedCount).toBe(2);
    expect(harness.retries.map((retry) => retry.delayMs)).toEqual([1_000, 2_000]);

    harness.retries[1].callback();
    await settleRealtime();
    harness.channels[2].emitStatus('SUBSCRIBED');
    await settleRealtime();

    expect(harness.recoveredCount).toBe(1);
    expect(harness.retries.map((retry) => retry.delayMs)).toEqual([1_000, 2_000]);

    harness.channels[2].emitStatus('CHANNEL_ERROR');
    harness.retries[2].callback();
    await settleRealtime();
    harness.channels[3].emitStatus('TIMED_OUT');
    harness.retries[3].callback();
    await settleRealtime();
    harness.channels[4].emitStatus('CLOSED');
    harness.retries[4].callback();
    await settleRealtime();
    harness.channels[5].emitStatus('UNEXPECTED_CLOSURE');

    expect(harness.retries.map((retry) => retry.delayMs)).toEqual([1_000, 2_000, 1_000, 2_000, 4_000]);
    expect(harness.retries).toHaveLength(5);

    harness.subscription.stop();
  });
  test('degrades and retries when client acquisition or first status never settles, then ignores late settlement', async () => {
    const clientAcquisition = createDeferred<unknown>();
    const acquisitionHarness = createRealtimeHarness(
      async () => true,
      'acquisition-owner',
      () => clientAcquisition.promise,
    );

    await settleRealtime();
    expect(acquisitionHarness.channels).toHaveLength(0);
    expect(acquisitionHarness.deadlines.map((deadline) => deadline.delayMs)).toEqual([
      NOTIFICATION_CLIENT_ACQUISITION_TIMEOUT_MS,
    ]);

    acquisitionHarness.deadlines[0].callback();
    await settleRealtime();
    expect(acquisitionHarness.transportDegradedCount).toBe(1);
    expect(acquisitionHarness.retries.map((retry) => retry.delayMs)).toEqual([1_000]);
    expect(acquisitionHarness.deadlines[0].cancelled).toBe(true);
    expect(acquisitionHarness.invalidatedReadbackRequestCount).toBe(0);

    clientAcquisition.resolve(acquisitionHarness.client);
    await settleRealtime();
    expect(acquisitionHarness.channels).toHaveLength(0);
    expect(acquisitionHarness.recoveredCount).toBe(0);
    acquisitionHarness.subscription.stop();

    const statusHarness = createRealtimeHarness();
    await settleRealtime();
    expect(statusHarness.deadlines.map((deadline) => deadline.delayMs)).toEqual([
      NOTIFICATION_CLIENT_ACQUISITION_TIMEOUT_MS,
      NOTIFICATION_FIRST_STATUS_TIMEOUT_MS,
    ]);

    statusHarness.deadlines[1].callback();
    await settleRealtime();
    expect(statusHarness.transportDegradedCount).toBe(1);
    expect(statusHarness.retries.map((retry) => retry.delayMs)).toEqual([1_000]);
    expect(statusHarness.invalidatedReadbackRequestCount).toBe(0);
    statusHarness.channels[0].emitStatus('SUBSCRIBED');
    await settleRealtime();
    expect(statusHarness.recoveredCount).toBe(0);
    statusHarness.subscription.stop();
  });

  test('uses exactly three 1s, 2s, 4s retries when subscribed readback never settles and cancels deadlines', async () => {
    const neverSettles = () => new Promise<boolean>(() => undefined);
    const harness = createRealtimeHarness(neverSettles);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await settleRealtime();
      harness.channels[attempt].emitStatus('SUBSCRIBED');
      await settleRealtime();

      const readbackDeadline = harness.deadlines.at(-1);
      expect(readbackDeadline?.delayMs).toBe(NOTIFICATION_READBACK_TIMEOUT_MS);
      readbackDeadline?.callback();
      await settleRealtime();

      if (attempt < 3) {
        harness.retries[attempt].callback();
      }
    }

    expect(harness.transportDegradedCount).toBe(4);
    expect(harness.retries.map((retry) => retry.delayMs)).toEqual([1_000, 2_000, 4_000]);
    expect(harness.retries).toHaveLength(3);
    expect(harness.deadlines.filter((deadline) => !deadline.cancelled)).toHaveLength(0);
    expect(harness.invalidatedReadbackRequestCount).toBe(4);
    harness.subscription.stop();
  });

  test('scopes a pending A readback to its channel so B reconnect can recover without late A settlement', async () => {
    const firstReadback = createDeferred<boolean>();
    const secondReadback = createDeferred<boolean>();
    let readbackCalls = 0;
    const harness = createRealtimeHarness(() => {
      readbackCalls += 1;
      return readbackCalls === 1 ? firstReadback.promise : secondReadback.promise;
    }, 'same-owner');

    await settleRealtime();
    harness.channels[0].emitStatus('SUBSCRIBED');
    await settleRealtime();
    harness.channels[0].emitStatus('CHANNEL_ERROR');
    expect(harness.retries.map((retry) => retry.delayMs)).toEqual([1_000]);

    harness.retries[0].callback();
    await settleRealtime();
    harness.channels[1].emitStatus('SUBSCRIBED');
    await settleRealtime();

    secondReadback.resolve(true);
    await settleRealtime();
    expect(harness.recoveredCount).toBe(1);

    firstReadback.reject(new Error('late A readback failure'));
    await settleRealtime();
    expect(harness.recoveredCount).toBe(1);
    expect(harness.transportDegradedCount).toBe(1);
    harness.subscription.stop();
  });

  test('cancels retry and closes the owner channel for user switches and unmount cleanup', async () => {
    const previousUser = createRealtimeHarness(async () => true, 'previous-owner');

    await settleRealtime();
    previousUser.channels[0].emitStatus('CHANNEL_ERROR');
    expect(previousUser.retries).toHaveLength(1);

    previousUser.subscription.stop();
    previousUser.retries[0].callback();
    previousUser.channels[0].emitStatus('SUBSCRIBED');
    await settleRealtime();

    expect(previousUser.retries[0].cancelled).toBe(true);
    expect(previousUser.channels).toHaveLength(1);
    expect(previousUser.removedChannelCount).toBe(1);
    expect(previousUser.recoveredCount).toBe(0);

    const nextUser = createRealtimeHarness(async () => true, 'next-owner');
    await settleRealtime();

    expect(nextUser.channels).toHaveLength(1);
    nextUser.subscription.stop();
    expect(nextUser.removedChannelCount).toBe(1);
    expect(nextUser.deadlines.at(-1)?.cancelled).toBe(true);
    const providerSource = webSource('contexts/NotificationContext.tsx');
    expect(providerSource).toContain('ownerScopeRef.current.generation');
    expect(providerSource).toContain('notificationSnapshot.ownerId === userId');
    expect(providerSource).toContain('commitOwnerSnapshot(scope');
  });

  test('provider exposes realtime degradation without leaving the visible snapshot loading', () => {
    const source = webSource('contexts/NotificationContext.tsx');
    const notificationPanel = webSource('components/home/DesktopLeftPanelNotifications.tsx');
    const degradedHandler = source.slice(
      source.indexOf('onTransportDegraded: () => {'),
      source.indexOf('onRecovered: () => {'),
    );

    expect(degradedHandler).toContain('isLoading: false,');
    expect(degradedHandler).toContain('isError: true,');
    expect(degradedHandler).not.toContain('invalidateLoadRequest');
    expect(source).toContain('reloadFromServer: (isReadbackActive, registerInvalidate) => loadNotifications(scope, {');
    expect(source).toContain('subscription.stop();');
    expect(notificationPanel).toContain(') : isError ? (');
    expect(notificationPanel).toContain('알림을 불러오지 못했습니다');
    expect(notificationPanel).toContain('잠시 후 다시 열어 주세요.');
  });
  test('reconciles readback with inserts after query start without duplicates, stale removals, or unread drift', () => {
    const notification = (id: string, createdAt: string, isRead: boolean) => ({
      id,
      type: 'admin_announcement' as const,
      title: id,
      message: id,
      createdAt: new Date(createdAt),
      isRead,
      data: {},
    });
    const serverOnly = notification('server-only', '2026-07-13T00:00:00.000Z', true);
    const removedByServer = notification('removed-by-server', '2026-07-12T00:00:00.000Z', false);
    const insertedAfterQuery = notification('inserted-after-query', '2026-07-14T00:00:00.000Z', false);

    const localBeforeReadback = prependRealtimeNotification([removedByServer], insertedAfterQuery);
    expect(localBeforeReadback.map((entry) => entry.id)).toEqual([
      'inserted-after-query',
      'removed-by-server',
    ]);

    const responseMissesInsert = reconcileNotificationReadback([serverOnly], [insertedAfterQuery]);
    expect(responseMissesInsert.map((entry) => entry.id)).toEqual([
      'inserted-after-query',
      'server-only',
    ]);
    expect(responseMissesInsert.filter((entry) => !entry.isRead)).toHaveLength(1);

    const authoritativeInsert = { ...insertedAfterQuery, isRead: true };
    const responseContainsInsert = reconcileNotificationReadback(
      [authoritativeInsert, serverOnly],
      [insertedAfterQuery],
    );
    expect(responseContainsInsert.map((entry) => entry.id)).toEqual([
      'inserted-after-query',
      'server-only',
    ]);
    expect(responseContainsInsert.filter((entry) => !entry.isRead)).toHaveLength(0);
    expect(responseContainsInsert.find((entry) => entry.id === 'removed-by-server')).toBeUndefined();

    const capped = reconcileNotificationReadback(
      [serverOnly],
      Array.from({ length: 60 }, (_, index) => notification(
        `realtime-${index}`,
        `2026-07-01T00:00:${String(index).padStart(2, '0')}.000Z`,
        false,
      )),
    );
    expect(capped).toHaveLength(50);
    expect(new Set(capped.map((entry) => entry.id)).size).toBe(50);
  });

  test('owner-tagged snapshots guard every deferred mutation result and unmount from stale success or failure state', () => {
    const source = webSource('contexts/NotificationContext.tsx');
    const mutationSections = [
      source.slice(source.indexOf('const markAsRead'), source.indexOf('const markAllAsRead')),
      source.slice(source.indexOf('const markAllAsRead'), source.indexOf('const addNotification')),
      source.slice(source.indexOf('const addNotification'), source.indexOf('const removeNotification')),
      source.slice(source.indexOf('const removeNotification'), source.indexOf('const value: NotificationContextType')),
    ];

    expect(source).toContain('ownerScopeRef.current = {');
    expect(source).toContain('notificationSnapshot.ownerId === userId');
    expect(source).toContain('isMountedRef.current = false;');
    expect(source).toContain('entry.scope.generation === scope.generation');
    for (const section of mutationSections) {
      expect(section).toContain('const scope = ownerScopeRef.current;');
      expect(section).toContain('commitOwnerSnapshot(scope');
    }
  });
  test('invalidates a timed-out provider readback A before B and rejects A late settlement', async () => {
    const tracker = createNotificationLoadRequestTracker();
    const scope = { userId: 'same-owner', generation: 7 };
    const timedOutA = createDeferred<string>();
    const requestA = tracker.begin(scope);
    const commitA = timedOutA.promise.then((value) => (tracker.isActive(requestA) ? value : null));

    tracker.invalidate(scope);
    const readbackB = createDeferred<string>();
    const requestB = tracker.begin(scope);
    const commitB = readbackB.promise.then((value) => (tracker.isActive(requestB) ? value : null));

    readbackB.resolve('B-authoritative');
    await expect(commitB).resolves.toBe('B-authoritative');
    timedOutA.resolve('A-late');
    await expect(commitA).resolves.toBeNull();
    expect(tracker.isActive(requestB)).toBe(true);
  });

  test('keeps the newest overlapping provider load when it settles before the older request', async () => {
    const tracker = createNotificationLoadRequestTracker();
    const scope = { userId: 'same-owner', generation: 8 };
    const older = createDeferred<string>();
    const newer = createDeferred<string>();
    const olderRequest = tracker.begin(scope);
    const olderCommit = older.promise.then((value) => (tracker.isActive(olderRequest) ? value : null));
    const newerRequest = tracker.begin(scope);
    const newerCommit = newer.promise.then((value) => (tracker.isActive(newerRequest) ? value : null));

    newer.resolve('newest');
    await expect(newerCommit).resolves.toBe('newest');
    older.resolve('older');
    await expect(olderCommit).resolves.toBeNull();
  });

  test('replays each successful mutation completed during an in-flight readback with exact unread state', async () => {
    const notification = (id: string, isRead: boolean) => ({
      id,
      type: 'admin_announcement' as const,
      title: id,
      message: id,
      createdAt: new Date('2026-07-13T00:00:00.000Z'),
      isRead,
      data: {},
    });
    const scope = { userId: 'same-owner', generation: 9 };
    const response = [
      notification('read-target', false),
      notification('remove-target', false),
      notification('other', false),
    ];
    const cases = [
      {
        operation: { kind: 'mark-as-read' as const, id: 'read-target' },
        ids: ['read-target', 'remove-target', 'other'],
        unreadCount: 2,
      },
      {
        operation: { kind: 'mark-all-as-read' as const },
        ids: ['read-target', 'remove-target', 'other'],
        unreadCount: 0,
      },
      {
        operation: { kind: 'remove' as const, id: 'remove-target' },
        ids: ['read-target', 'other'],
        unreadCount: 2,
      },
    ];

    for (const [index, current] of cases.entries()) {
      const inFlightReadback = createDeferred<typeof response>();
      const reconciled = inFlightReadback.promise.then((authoritative) => replayNotificationMutations(
        authoritative,
        [{ scope, sequence: index + 1, mutation: current.operation }],
      ));

      inFlightReadback.resolve(response);
      const notifications = await reconciled;
      expect(notifications.map((entry) => entry.id)).toEqual(current.ids);
      expect(notifications.filter((entry) => !entry.isRead)).toHaveLength(current.unreadCount);
    }
  });

  test('provider loads and reconciliation explicitly use request generations and mutation journals', () => {
    const source = webSource('contexts/NotificationContext.tsx');

    expect(source).toContain('const request = loadRequestTrackerRef.current.begin(scope);');
    expect(source).toContain('const canCommitRequest = () => isCurrentLoadRequest(scope, request);');
    expect(source).toContain('shouldStart: isReadbackActive,');
    expect(source).toContain('onRequestStarted: registerInvalidate,');
    expect(source).toContain('loadRequestTrackerRef.current.invalidateRequest(request)');
    expect(source).toContain('isIdleAfterInvalidating(request)');
    expect(source).toContain('queryStartMutationSequence');
    expect(source).toContain('replayNotificationMutations(');
    expect(source).toContain("recordNotificationMutation(scope, { kind: 'mark-as-read', id });");
    expect(source).toContain("recordNotificationMutation(scope, { kind: 'mark-all-as-read' });");
    expect(source).toContain("recordNotificationMutation(scope, { kind: 'remove', id });");
  });
  test('controlled acquisition and first-status deadlines end visible loading while keeping the initial load owner active', async () => {
    const scope = { userId: 'same-owner', generation: 10 };
    const acquisitionTracker = createNotificationLoadRequestTracker();
    const pendingClient = createDeferred<unknown>();
    const acquisitionInitialLoad = createDeferred<string>();
    const acquisitionState = { isLoading: true, isError: false, lateInitialLoad: null as string | null };
    const acquisitionRequest = acquisitionTracker.begin(scope);
    const acquisitionLateCommit = acquisitionInitialLoad.promise.then((result) => {
      if (!acquisitionTracker.isActive(acquisitionRequest)) return null;

      acquisitionState.lateInitialLoad = result;
      return result;
    });
    const acquisitionHarness = createRealtimeHarness(
      async () => true,
      scope.userId,
      () => pendingClient.promise,
      {
        onTransportDegraded: () => {
          acquisitionState.isLoading = false;
          acquisitionState.isError = true;
        },
      },
    );

    acquisitionHarness.deadlines[0].callback();
    await settleRealtime();

    expect(acquisitionTracker.isActive(acquisitionRequest)).toBe(true);
    expect(acquisitionState).toEqual({ isLoading: false, isError: true, lateInitialLoad: null });
    expect(acquisitionHarness.invalidatedReadbackRequestCount).toBe(0);

    acquisitionInitialLoad.resolve('acquisition-late-authoritative');
    await expect(acquisitionLateCommit).resolves.toBe('acquisition-late-authoritative');
    expect(acquisitionState).toEqual({
      isLoading: false,
      isError: true,
      lateInitialLoad: 'acquisition-late-authoritative',
    });
    acquisitionHarness.subscription.stop();

    const statusTracker = createNotificationLoadRequestTracker();
    const statusInitialLoad = createDeferred<string>();
    const statusState = { isLoading: true, isError: false, lateInitialLoad: null as string | null };
    const statusRequest = statusTracker.begin(scope);
    const statusLateCommit = statusInitialLoad.promise.then((result) => {
      if (!statusTracker.isActive(statusRequest)) return null;

      statusState.lateInitialLoad = result;
      return result;
    });
    const statusHarness = createRealtimeHarness(
      async () => true,
      scope.userId,
      undefined,
      {
        onTransportDegraded: () => {
          statusState.isLoading = false;
          statusState.isError = true;
        },
      },
    );
    await settleRealtime();
    statusHarness.deadlines[1].callback();
    await settleRealtime();

    expect(statusTracker.isActive(statusRequest)).toBe(true);
    expect(statusState).toEqual({ isLoading: false, isError: true, lateInitialLoad: null });
    expect(statusHarness.invalidatedReadbackRequestCount).toBe(0);

    statusInitialLoad.resolve('status-late-authoritative');
    await expect(statusLateCommit).resolves.toBe('status-late-authoritative');
    expect(statusState).toEqual({
      isLoading: false,
      isError: true,
      lateInitialLoad: 'status-late-authoritative',
    });
    statusHarness.subscription.stop();
  });

  test('controlled readback deadlines finish only their request as loading false and deny a timed-out late commit', async () => {
    const scope = { userId: 'same-owner', generation: 11 };
    const tracker = createNotificationLoadRequestTracker();
    const state = { isLoading: true, isError: false, lateCommitted: false };
    const lateReadback = createDeferred<boolean>();
    let ownedRequest: ReturnType<typeof tracker.begin> | undefined;
    const harness = createRealtimeHarness(
      () => {
        const request = tracker.begin(scope);
        ownedRequest = request;
        return lateReadback.promise.then((result) => {
          if (tracker.isActive(request)) {
            state.lateCommitted = true;
          }
          return result;
        });
      },
      scope.userId,
      undefined,
      {
        onReadbackInvalidated: () => {
          if (
            ownedRequest
            && tracker.invalidateRequest(ownedRequest)
            && tracker.isIdleAfterInvalidating(ownedRequest)
          ) {
            state.isLoading = false;
          }
        },
        onTransportDegraded: () => {
          state.isError = true;
        },
      },
    );

    await settleRealtime();
    harness.channels[0].emitStatus('SUBSCRIBED');
    await settleRealtime();
    const readbackDeadline = harness.deadlines.at(-1);
    expect(readbackDeadline?.delayMs).toBe(NOTIFICATION_READBACK_TIMEOUT_MS);
    readbackDeadline?.callback();
    await settleRealtime();

    expect(state).toEqual({ isLoading: false, isError: true, lateCommitted: false });
    expect(ownedRequest && tracker.isActive(ownedRequest)).toBe(false);
    lateReadback.resolve(true);
    await settleRealtime();
    expect(state.lateCommitted).toBe(false);
    harness.subscription.stop();
  });

  test('exhausted controlled 1s, 2s, 4s readback retries end context loading and leave degradation visible', async () => {
    const scope = { userId: 'same-owner', generation: 12 };
    const tracker = createNotificationLoadRequestTracker();
    const state = { isLoading: true, isError: false };
    let ownedRequest: ReturnType<typeof tracker.begin> | undefined;
    const harness = createRealtimeHarness(
      () => {
        ownedRequest = tracker.begin(scope);
        return new Promise<boolean>(() => undefined);
      },
      scope.userId,
      undefined,
      {
        onReadbackInvalidated: () => {
          if (
            ownedRequest
            && tracker.invalidateRequest(ownedRequest)
            && tracker.isIdleAfterInvalidating(ownedRequest)
          ) {
            state.isLoading = false;
          }
        },
        onTransportDegraded: () => {
          state.isError = true;
        },
      },
    );

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await settleRealtime();
      harness.channels[attempt].emitStatus('SUBSCRIBED');
      await settleRealtime();
      harness.deadlines.at(-1)?.callback();
      await settleRealtime();
      if (attempt < 3) harness.retries[attempt].callback();
    }

    expect(harness.retries.map((retry) => retry.delayMs)).toEqual([1_000, 2_000, 4_000]);
    expect(state).toEqual({ isLoading: false, isError: true });
    harness.subscription.stop();
  });
  });

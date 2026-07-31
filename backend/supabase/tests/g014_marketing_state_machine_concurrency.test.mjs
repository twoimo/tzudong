import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const GATE_MISSING_EXIT_CODE = 78;
const CONNECTION_TIMEOUT_MS = 3_000;
const STATEMENT_TIMEOUT_MS = 5_000;
const LOCK_TIMEOUT_MS = 5_000;
const CLAIM_START_WAIT_MS = 100;

function fixedFailure(code, exitCode = 1) {
  process.stderr.write(`${code}\n`);
  process.exitCode = exitCode;
}

function assert(condition) {
  if (!condition) {
    throw new Error('g014_concurrency_assertion_failed');
  }
}

function createClient(connectionString, applicationName) {
  return new Client({
    connectionString,
    application_name: applicationName,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    lock_timeout: LOCK_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS,
  });
}

async function setBoundedTransaction(client, role) {
  await client.query('BEGIN');
  await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
  await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
  await client.query(`SET LOCAL ROLE ${role}`);
}

async function setServiceRoleTransaction(client) {
  await setBoundedTransaction(client, 'service_role');
  await client.query(
    "SELECT pg_catalog.set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)",
  );
}

async function rollbackQuietly(client) {
  if (!client) return;
  try {
    await client.query('ROLLBACK');
  } catch {
    // A fixed outer diagnostic is emitted only when the harness fails.
  }
}

async function closeQuietly(client) {
  if (!client) return;
  try {
    await client.end();
  } catch {
    // A fixed outer diagnostic is emitted only when the harness fails.
  }
}

async function createPreparedBatchFixture(client) {
  const fixtureId = randomUUID();
  const actorId = randomUUID();
  const recipientId = randomUUID();
  const suffix = fixtureId.replaceAll('-', '');
  const previewHash = '6'.repeat(64);
  const idempotencyKey = `g014concurrency${suffix}`;
  const passwordMarker = randomUUID();
  let policy;

  await client.query('BEGIN');
  await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
  await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
  await client.query(
    `INSERT INTO auth.users (
       id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at
     ) VALUES
       ($1, 'authenticated', 'authenticated', $2, $3, pg_catalog.clock_timestamp(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
       ($4, 'authenticated', 'authenticated', $5, $3, pg_catalog.clock_timestamp(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())`,
    [
      actorId,
      `g014-concurrency-actor-${suffix}@example.invalid`,
      passwordMarker,
      recipientId,
      `g014-concurrency-recipient-${suffix}@example.invalid`,
    ],
  );
  await client.query('SET LOCAL ROLE privacy_workflow_owner');
  try {
    const policyResult = await client.query(
      `SELECT id, content_sha256
       FROM privacy_retention.privacy_policy_versions
       WHERE status = 'published' AND effective_at <= pg_catalog.clock_timestamp()
       ORDER BY effective_at DESC, id DESC
       LIMIT 1`,
    );

    if (policyResult.rowCount === 0) {
      const createdPolicy = await client.query(
        `INSERT INTO privacy_retention.privacy_policy_versions (
           version, locale, status, content_sha256, effective_at, published_at, operator_approval_ref
         ) VALUES ($1, 'ko-KR', 'published', $2, pg_catalog.clock_timestamp() - interval '1 minute',
                   pg_catalog.clock_timestamp() - interval '1 minute', 'G014-CONCURRENCY-TEST')
         RETURNING id, content_sha256`,
        [`g014-concurrency-${suffix}`, 'a'.repeat(64)],
      );
      policy = createdPolicy.rows[0];
    } else {
      policy = policyResult.rows[0];
    }


    await client.query(
      `INSERT INTO privacy_retention.privacy_age_profiles (
         user_id, age_band, attested_at, method, status, policy_version_id
       ) VALUES ($1, 'age_14_plus', pg_catalog.clock_timestamp(), 'self_attestation', 'eligible', $2)`,
      [recipientId, policy.id],
    );
    await client.query(
      `INSERT INTO privacy_retention.privacy_consent_events (
         user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256,
         source, correlation_id, idempotency_key, occurred_at
       ) VALUES
         ($1, 'self', 'sms_marketing', 'sms', 'granted', $2, $3, 'settings',
          extensions.gen_random_uuid(), $4, pg_catalog.clock_timestamp() - interval '2 seconds'),
         ($1, 'self', 'night_marketing', 'sms', 'granted', $2, $3, 'settings',
          extensions.gen_random_uuid(), $5, pg_catalog.clock_timestamp() - interval '1 second')`,
      [recipientId, policy.id, policy.content_sha256, `g014concsm${suffix}`, `g014concnight${suffix}`],
    );

    await client.query('SET LOCAL ROLE service_role');
    await client.query(
      "SELECT pg_catalog.set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)",
    );
    const preview = await client.query(
      `SELECT public.preview_marketing_campaign(
         $1::uuid, 'sms', ARRAY[$2::uuid], 'G014 concurrency', 'Durable claim race fixture.',
         '{}'::jsonb, $3, pg_catalog.clock_timestamp() + interval '10 minutes'
       ) AS result`,
      [actorId, recipientId, previewHash],
    );
    const operationId = preview.rows[0]?.result?.operationId;
    assert(typeof operationId === 'string');

    const prepared = await client.query(
      `SELECT public.prepare_marketing_campaign_batch(
         $1::uuid, $2::uuid, $3, $4, 1, 'Asia/Seoul'
       ) AS result`,
      [operationId, actorId, previewHash, idempotencyKey],
    );
    const batch = prepared.rows[0]?.result;
    assert(batch?.status === 'prepared' && typeof batch.batchId === 'string');

    await client.query('COMMIT');
    return {
      actorId,
      batchId: batch.batchId,
      idempotencyKey,
      operationId,
      previewHash,
      recipientId,
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  }
}

function claimQuery(fixture) {
  return {
    text: `SELECT public.claim_marketing_campaign_dispatch(
      $1::uuid, $2::uuid, $3::uuid, $4, $5, 'Asia/Seoul'
    ) AS result`,
    values: [
      fixture.operationId,
      fixture.batchId,
      fixture.actorId,
      fixture.previewHash,
      fixture.idempotencyKey,
    ],
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function assertDurableWinner(client, fixture, winningClaim) {
  await setBoundedTransaction(client, 'privacy_workflow_owner');
  try {
    const result = await client.query(
      `SELECT
         (SELECT count(*)::integer
          FROM privacy_retention.marketing_campaign_provider_attempts
          WHERE operation_id = $1::uuid AND batch_id = $2::uuid) AS provider_attempt_count,
         (SELECT count(*)::integer
          FROM privacy_retention.marketing_campaign_provider_attempts
          WHERE operation_id = $1::uuid AND batch_id = $2::uuid AND status = 'unknown') AS unknown_attempt_count,
         (SELECT count(*)::integer
          FROM privacy_retention.marketing_campaign_provider_attempts
          WHERE id = $4::uuid AND operation_id = $1::uuid AND batch_id = $2::uuid
            AND status = 'unknown') AS winning_unknown_attempt_count,
         (SELECT count(DISTINCT provider_identity)::integer
          FROM privacy_retention.marketing_campaign_provider_attempts
          WHERE operation_id = $1::uuid AND batch_id = $2::uuid) AS provider_identity_count,
         (SELECT bool_and(provider_identity = 'g014_https_provider_v1')
          FROM privacy_retention.marketing_campaign_provider_attempts
          WHERE operation_id = $1::uuid AND batch_id = $2::uuid) AS only_expected_provider_identity,
         (SELECT count(*)::integer
          FROM privacy_retention.marketing_campaign_batch_recipients
          WHERE operation_id = $1::uuid AND batch_id = $2::uuid AND status = 'claimed'
            AND claim_token = $3::uuid) AS claimed_recipient_count,
         (SELECT count(*)::integer
          FROM public.marketing_campaign_batches
          WHERE id = $2::uuid AND operation_id = $1::uuid AND status = 'claimed'
            AND claim_token = $3::uuid) AS claimed_batch_count,
         (SELECT count(*)::integer
          FROM public.notifications
          WHERE campaign_operation_id = $1::uuid) AS notification_count`,
      [
        fixture.operationId,
        fixture.batchId,
        winningClaim.claimToken,
        winningClaim.providerAttemptId,
      ],
    );
    const state = result.rows[0];
    assert(
      state.provider_attempt_count === 1
      && state.unknown_attempt_count === 1
      && state.winning_unknown_attempt_count === 1
      && state.provider_identity_count === 1
      && state.only_expected_provider_identity === true
      && state.claimed_recipient_count === 1
      && state.claimed_batch_count === 1
      && state.notification_count === 0,
    );
    await client.query('COMMIT');
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  }
}

async function run() {
  const databaseUrl = process.env.G014_TEST_DATABASE_URL;
  if (!databaseUrl) {
    fixedFailure('G014_CONCURRENCY_GATE_MISSING', GATE_MISSING_EXIT_CODE);
    return;
  }
  if (process.argv.length !== 2) {
    fixedFailure('G014_CONCURRENCY_ARGUMENTS_FORBIDDEN', GATE_MISSING_EXIT_CODE);
    return;
  }

  let setupClient;
  let clientA;
  let clientB;
  let loserSettled = false;

  try {
    setupClient = createClient(databaseUrl, 'g014-marketing-concurrency-setup');
    clientA = createClient(databaseUrl, 'g014-marketing-concurrency-a');
    clientB = createClient(databaseUrl, 'g014-marketing-concurrency-b');
    await Promise.all([setupClient.connect(), clientA.connect(), clientB.connect()]);

    const fixture = await createPreparedBatchFixture(setupClient);
    await setServiceRoleTransaction(clientA);
    await setServiceRoleTransaction(clientB);

    const winnerResult = await clientA.query(claimQuery(fixture));
    const winningClaim = winnerResult.rows[0]?.result;
    assert(
      winningClaim?.status === 'claimed'
      && typeof winningClaim.claimToken === 'string'
      && typeof winningClaim.providerAttemptId === 'string',
    );

    const loserPromise = clientB.query(claimQuery(fixture)).then(
      (result) => {
        loserSettled = true;
        return result;
      },
      (error) => {
        loserSettled = true;
        throw error;
      },
    );
    await delay(CLAIM_START_WAIT_MS);
    assert(loserSettled === false);

    await clientA.query('COMMIT');
    try {
      await loserPromise;
      throw new Error('g014_concurrency_loser_claim_succeeded');
    } catch (error) {
      assert(error?.code === '55000');
    }

    await assertDurableWinner(setupClient, fixture, winningClaim);
  } finally {
    await Promise.all([
      rollbackQuietly(clientA),
      rollbackQuietly(clientB),
      rollbackQuietly(setupClient),
    ]);
    await Promise.all([
      closeQuietly(clientA),
      closeQuietly(clientB),
      closeQuietly(setupClient),
    ]);
  }
}

run().catch(() => fixedFailure('G014_CONCURRENCY_FAILED'));

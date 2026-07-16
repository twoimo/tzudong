import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const GATE_EXIT_CODE = 78;
const TIMEOUT_MS = 7_000;
const MARKER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

class FixedFailure extends Error {
  constructor(code, exitCode = 1) {
    super(code);
    this.code = code;
    this.exitCode = exitCode;
  }
}

function output(code, exitCode = 0) {
  (exitCode === 0 ? process.stdout : process.stderr).write(`${code}\n`);
  process.exitCode = exitCode;
}

function assert(condition) {
  if (!condition) throw new Error('g014_deletion_concurrency_assertion_failed');
}

function gate() {
  const databaseUrl = process.env.G014_TEST_DATABASE_URL;
  const marker = process.env.G014_TEST_DATABASE_MARKER;
  if (!databaseUrl || !marker) {
    throw new FixedFailure('G014_DELETION_CONCURRENCY_GATE_MISSING', GATE_EXIT_CODE);
  }
  if (!MARKER_PATTERN.test(marker) || process.argv.length !== 2) {
    throw new FixedFailure('G014_DELETION_CONCURRENCY_GATE_INVALID', GATE_EXIT_CODE);
  }
  const parsed = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname) {
    throw new FixedFailure('G014_DELETION_CONCURRENCY_GATE_INVALID', GATE_EXIT_CODE);
  }
  return { databaseUrl, marker };
}

function client(connectionString, applicationName) {
  return new Client({
    connectionString,
    application_name: applicationName,
    connectionTimeoutMillis: 3_000,
    statement_timeout: TIMEOUT_MS,
    lock_timeout: 5_000,
    query_timeout: TIMEOUT_MS,
  });
}

async function begin(client, serviceRole = false) {
  await client.query('BEGIN');
  await client.query(`SET LOCAL statement_timeout = '${TIMEOUT_MS}ms'`);
  if (serviceRole) {
    await client.query('SET LOCAL ROLE service_role');
    await client.query("SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true)");
    await client.query("SELECT pg_catalog.set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
  }
}

async function rollback(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The fixed outer result intentionally omits database diagnostics.
  }
}

async function close(client) {
  try {
    await client.end();
  } catch {
    // The fixed outer result intentionally omits connection diagnostics.
  }
}

async function verifyDisposableTarget(coordinator, marker) {
  const result = await coordinator.query(
    `WITH target AS (
       SELECT database_row.oid AS database_oid, role_row.oid AS role_oid
       FROM pg_catalog.pg_database AS database_row
       JOIN pg_catalog.pg_roles AS role_row ON role_row.rolname = CURRENT_USER
       WHERE database_row.datname = pg_catalog.current_database()
     )
     SELECT pg_catalog.current_setting('app.g014_test_marker', true) AS configured_marker,
            EXISTS (
              SELECT 1
              FROM target
              JOIN pg_catalog.pg_db_role_setting AS setting_row
                ON setting_row.setdatabase IN (0, target.database_oid)
               AND setting_row.setrole IN (0, target.role_oid)
              CROSS JOIN LATERAL pg_catalog.unnest(setting_row.setconfig) AS configured(value)
              WHERE configured.value = 'app.g014_test_marker=' || $1
            ) AS marker_is_persistent`,
    [marker],
  );
  if (result.rows[0]?.configured_marker !== marker || result.rows[0]?.marker_is_persistent !== true) {
    throw new FixedFailure('G014_DELETION_CONCURRENCY_TARGET_REJECTED', GATE_EXIT_CODE);
  }
}

async function verifyCatalog(coordinator) {
  const result = await coordinator.query(`SELECT
    pg_catalog.to_regprocedure('public.claim_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid)') IS NOT NULL
      AND pg_catalog.to_regprocedure('public.prepare_account_deletion_external_egress(uuid,uuid,uuid,text,text,text,text,uuid)') IS NOT NULL
      AND pg_catalog.to_regprocedure('public.run_account_deletion_session_family_cleanup(uuid,uuid,uuid,text,text,text,uuid)') IS NOT NULL
      AND pg_catalog.to_regprocedure('public.get_account_deletion_storage_work(uuid,uuid,uuid,text,text,text,uuid)') IS NOT NULL
      AND pg_catalog.to_regprocedure('public.reconcile_account_deletion_storage_job(uuid,uuid,uuid,text,text,text,uuid)') IS NOT NULL
      AND pg_catalog.to_regprocedure('public.reconcile_account_deletion_auth_job(uuid,uuid,uuid,text,text,text,uuid)') IS NOT NULL
      AND pg_catalog.to_regclass('privacy_retention.account_deletion_external_jobs') IS NOT NULL
      AND pg_catalog.to_regclass('privacy_retention.account_deletion_external_job_attempts') IS NOT NULL
      AND NOT pg_catalog.has_function_privilege(
        'service_role',
        'public.claim_account_deletion_external_phase(uuid,uuid,uuid,text,text,text,text)'::regprocedure,
        'EXECUTE'
      ) AS contract_ready`);
  assert(result.rows[0]?.contract_ready === true);
}

async function prepareFixtureBoundary(coordinator) {
  await begin(coordinator);
  try {
    const result = await coordinator.query(
      `UPDATE privacy_retention.privacy_retention_classes
       SET data_class = 'privacy_account_deletion_audit',
           basis_code = 'g014.test.account_deletion_audit',
           trigger_type = 'event_occurred',
           retention_period = interval '30 days',
           status = 'active',
           approved_evidence_ref = 'G014-05-TEST-ACCOUNT-DELETION-AUDIT',
           version = 'g014-05-test-v1'
       WHERE code = 'privacy_account_deletion_audit'
       RETURNING code`,
    );
    assert(result.rowCount === 1);
    await coordinator.query('COMMIT');
  } catch (error) {
    await rollback(coordinator);
    throw error;
  }
}

async function createFixture(coordinator) {
  const suffix = randomUUID().replaceAll('-', '');
  const targetId = randomUUID();
  const adminOneId = randomUUID();
  const adminTwoId = randomUUID();
  const ids = [targetId, adminOneId, adminTwoId];

  await begin(coordinator);
  try {
    const policy = await coordinator.query(
      `SELECT version, confirmation_text
       FROM public.account_deletion_policies
       WHERE status = 'active'
       ORDER BY version
       LIMIT 1`,
    );
    assert(policy.rowCount === 1 && policy.rows[0]?.confirmation_text);
    const users = await coordinator.query(
      `INSERT INTO auth.users (
         id, aud, role, email, encrypted_password, email_confirmed_at, last_sign_in_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at
       ) VALUES
         ($1, 'authenticated', 'authenticated', $2, 'disabled', clock_timestamp(), clock_timestamp(), '{"provider":"email","providers":["email"]}', '{}'::jsonb, clock_timestamp(), clock_timestamp()),
         ($3, 'authenticated', 'authenticated', $4, 'disabled', clock_timestamp(), clock_timestamp(), '{"provider":"email","providers":["email"]}', '{}'::jsonb, clock_timestamp(), clock_timestamp()),
         ($5, 'authenticated', 'authenticated', $6, 'disabled', clock_timestamp(), clock_timestamp(), '{"provider":"email","providers":["email"]}', '{}'::jsonb, clock_timestamp(), clock_timestamp())
       RETURNING id, last_sign_in_at`,
      [targetId, `g014-${suffix}-target@example.invalid`, adminOneId, `g014-${suffix}-admin-one@example.invalid`, adminTwoId, `g014-${suffix}-admin-two@example.invalid`],
    );
    assert(users.rowCount === ids.length);
    const reauth = new Map(users.rows.map((row) => [row.id, row.last_sign_in_at]));
    await coordinator.query(
      `INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin'), ($2, 'admin')`,
      [adminOneId, adminTwoId],
    );
    await coordinator.query(
      `INSERT INTO public.user_account_status (user_id, account_status) VALUES ($1, 'active'), ($2, 'active')`,
      [adminOneId, adminTwoId],
    );
    await coordinator.query(
      `INSERT INTO storage.buckets (id, name, public) VALUES ($1, $1, false)
       ON CONFLICT (id) DO NOTHING`,
      [`g014-${suffix}`],
    );
    await coordinator.query(
      `INSERT INTO storage.objects (id, bucket_id, name, owner_id, version)
       VALUES
         ($1, $2, 'concurrency-delete-one.bin', $3, 'g014-concurrency-version-one'),
         ($4, $2, 'concurrency-delete-two.bin', $3, 'g014-concurrency-version-two')`,
      [randomUUID(), `g014-${suffix}`, targetId, randomUUID()],
    );
    await coordinator.query('COMMIT');
    return {
      actorId: targetId,
      targetId,
      reauthenticatedAt: reauth.get(targetId),
      confirmationText: policy.rows[0].confirmation_text,
    };
  } catch (error) {
    await rollback(coordinator);
    throw error;
  }
}

function binding(subject, preview, idempotencyKey) {
  return [
    subject.actorId,
    subject.targetId,
    preview.request_id,
    preview.preview_hash,
    idempotencyKey,
    preview.source_manifest_hash,
  ];
}

async function beginAndCleanDatabase(worker, subject) {
  await begin(worker, true);
  try {
    const previewResult = await worker.query(
      `SELECT * FROM public.preview_account_deletion($1::uuid, $2::uuid, $3::timestamptz)`,
      [subject.actorId, subject.targetId, subject.reauthenticatedAt],
    );
    const preview = previewResult.rows[0];
    assert(preview?.status === 'previewed' && /^[0-9a-f]{64}$/.test(preview.source_manifest_hash));
    const idempotencyKey = `g014-concurrency-${randomUUID().replaceAll('-', '')}`;
    const values = binding(subject, preview, idempotencyKey);
    const apply = await worker.query(
      `SELECT * FROM public.begin_account_deletion_apply(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::timestamptz, $8::text
      )`,
      [...values.slice(0, 4), subject.confirmationText, idempotencyKey, subject.reauthenticatedAt, values[5]],
    );
    assert(apply.rows[0]?.status === 'applying');
    const cleanup = await worker.query(
      `SELECT * FROM public.apply_account_deletion_database_cleanup(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text
      )`,
      values,
    );
    assert(cleanup.rows[0]?.db_readback_passed === true && cleanup.rows[0]?.session_readback_passed === false);
    await worker.query('COMMIT');
    return { preview, idempotencyKey };
  } catch (error) {
    await rollback(worker);
    throw error;
  }
}

async function expectSqlFailure(promise, code, message) {
  try {
    await promise;
  } catch (error) {
    assert(error?.code === code && error?.message === message);
    return;
  }
  throw new Error('g014_deletion_concurrency_unexpected_success');
}

async function run() {
  const { databaseUrl, marker } = gate();
  const coordinator = client(databaseUrl, 'g014-deletion-jobs-coordinator');
  const workerA = client(databaseUrl, 'g014-deletion-jobs-a');
  const workerB = client(databaseUrl, 'g014-deletion-jobs-b');
  try {
    await Promise.all([coordinator.connect(), workerA.connect(), workerB.connect()]);
    await verifyDisposableTarget(coordinator, marker);
    await verifyCatalog(coordinator);
    await prepareFixtureBoundary(coordinator);
    const subject = await createFixture(coordinator);
    const { preview, idempotencyKey } = await beginAndCleanDatabase(workerA, subject);
    const values = binding(subject, preview, idempotencyKey);

    // Client A claims.  Client B, with no token, receives busy/null rather than
    // a second egress authorization; only A's exact token may replay.
    await begin(workerA, true);
    const firstClaim = await workerA.query(
      `SELECT * FROM public.claim_account_deletion_external_job(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, 'session', NULL
      )`,
      values,
    );
    const first = firstClaim.rows[0];
    assert(first?.claim_status === 'claimed' && typeof first.attempt_token === 'string');
    await workerA.query('COMMIT');

    await begin(workerB, true);
    const competing = await workerB.query(
      `SELECT * FROM public.claim_account_deletion_external_job(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, 'session', NULL
      )`,
      values,
    );
    assert(competing.rows[0]?.claim_status === 'busy' && competing.rows[0]?.attempt_token == null);
    const replay = await workerB.query(
      `SELECT * FROM public.claim_account_deletion_external_job(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, 'session', $7::uuid
      )`,
      [...values, first.attempt_token],
    );
    assert(replay.rows[0]?.claim_status === 'replayed' && replay.rows[0]?.attempt_token === first.attempt_token);
    await workerB.query('COMMIT');

    // A live attempt serializes every way a mapped hold can become active for
    // this subject: activation, expiry extension, subject move, and class move.
    const otherSubjectId = randomUUID();
    await begin(coordinator);
    await coordinator.query(
      `INSERT INTO privacy_retention.privacy_legal_holds (
        subject_ref_hash, data_class, reason_code, status, released_at, approved_by, approved_evidence_ref
      ) VALUES (
        privacy_retention.g014_account_deletion_subject_hash($1::uuid),
        'account_deletion', 'g014.test.hold', 'released', clock_timestamp(), $1::uuid, 'G014-05-CONCURRENCY-ACTIVATE'
      )`,
      [subject.targetId],
    );
    await coordinator.query(
      `INSERT INTO privacy_retention.privacy_legal_holds (
        subject_ref_hash, data_class, reason_code, status, expires_at, approved_by, approved_evidence_ref
      ) VALUES (
        privacy_retention.g014_account_deletion_subject_hash($1::uuid),
        'account_deletion', 'g014.test.hold', 'active', clock_timestamp() - interval '1 hour', $1::uuid, 'G014-05-CONCURRENCY-EXPIRY'
      )`,
      [subject.targetId],
    );
    await coordinator.query(
      `INSERT INTO privacy_retention.privacy_legal_holds (
        subject_ref_hash, data_class, reason_code, status, expires_at, approved_by, approved_evidence_ref
      ) VALUES (
        privacy_retention.g014_account_deletion_subject_hash($1::uuid),
        'account_deletion', 'g014.test.hold', 'active', clock_timestamp() + interval '1 hour', $2::uuid, 'G014-05-CONCURRENCY-SUBJECT'
      )`,
      [otherSubjectId, subject.targetId],
    );
    await coordinator.query(
      `INSERT INTO privacy_retention.privacy_legal_holds (
        subject_ref_hash, data_class, reason_code, status, expires_at, approved_by, approved_evidence_ref
      ) VALUES (
        privacy_retention.g014_account_deletion_subject_hash($1::uuid),
        'g014_unmapped_class', 'g014.test.hold', 'active', clock_timestamp() + interval '1 hour', $1::uuid, 'G014-05-CONCURRENCY-CLASS'
      )`,
      [subject.targetId],
    );
    await coordinator.query('COMMIT');
    await begin(workerB);
    await expectSqlFailure(
      workerB.query(
        `INSERT INTO privacy_retention.privacy_legal_holds (
          subject_ref_hash, data_class, reason_code, status, approved_by, approved_evidence_ref
        ) VALUES (
          privacy_retention.g014_account_deletion_subject_hash($1::uuid),
          'account_deletion', 'g014.test.hold', 'active', $1::uuid, 'G014-05-CONCURRENCY-INSERT'
        )`,
        [subject.targetId],
      ),
      '55000',
      'account_deletion_external_job_blocks_hold_activation',
    );
    await rollback(workerB);

    for (const statement of [
      `UPDATE privacy_retention.privacy_legal_holds
       SET status = 'active', released_at = NULL, expires_at = clock_timestamp() + interval '1 hour'
       WHERE approved_evidence_ref = 'G014-05-CONCURRENCY-ACTIVATE'`,
      `UPDATE privacy_retention.privacy_legal_holds
       SET expires_at = clock_timestamp() + interval '2 hours'
       WHERE approved_evidence_ref = 'G014-05-CONCURRENCY-EXPIRY'`,
      `UPDATE privacy_retention.privacy_legal_holds
       SET subject_ref_hash = privacy_retention.g014_account_deletion_subject_hash('${subject.targetId}'::uuid)
       WHERE approved_evidence_ref = 'G014-05-CONCURRENCY-SUBJECT'`,
      `UPDATE privacy_retention.privacy_legal_holds
       SET data_class = 'account_deletion'
       WHERE approved_evidence_ref = 'G014-05-CONCURRENCY-CLASS'`,
    ]) {
      await begin(workerB);
      await expectSqlFailure(
        workerB.query(statement),
        '55000',
        'account_deletion_external_job_blocks_hold_activation',
      );
      await rollback(workerB);
    }
    // An expired pre-egress lease is released before re-claiming.  Across two
    // workers, exactly one replacement token becomes current.
    await begin(coordinator);
    await coordinator.query(
      `UPDATE privacy_retention.account_deletion_external_job_attempts
       SET claimed_at = clock_timestamp() - interval '10 minutes',
           lease_expires_at = clock_timestamp() - interval '5 minutes'
       WHERE attempt_token = $1::uuid`,
      [first.attempt_token],
    );
    await coordinator.query('COMMIT');

    await begin(workerA, true);
    const recovered = await workerA.query(
      `SELECT * FROM public.claim_account_deletion_external_job(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, 'session', NULL
      )`,
      values,
    );
    const replacement = recovered.rows[0];
    assert(replacement?.claim_status === 'claimed' && replacement.attempt_token !== first.attempt_token);
    await workerA.query('COMMIT');

    await begin(workerB, true);
    const replacementCompeting = await workerB.query(
      `SELECT * FROM public.claim_account_deletion_external_job(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, 'session', NULL
      )`,
      values,
    );
    assert(replacementCompeting.rows[0]?.claim_status === 'busy' && replacementCompeting.rows[0]?.attempt_token == null);
    await workerB.query('COMMIT');

    const recoveryInvariant = await coordinator.query(
      `SELECT
         (SELECT state
          FROM privacy_retention.account_deletion_external_job_attempts
          WHERE attempt_token = $1::uuid) AS prior_state,
         (SELECT current_attempt_token
          FROM privacy_retention.account_deletion_external_jobs
          WHERE request_id = $2::uuid AND phase = 'session') AS current_attempt_token,
         (SELECT count(*)
          FROM privacy_retention.account_deletion_external_job_attempts
          WHERE request_id = $2::uuid
            AND phase = 'session'
            AND state = 'leased')::integer AS live_attempt_count`,
      [first.attempt_token, preview.request_id],
    );
    assert(
      recoveryInvariant.rows[0]?.prior_state === 'released'
        && recoveryInvariant.rows[0]?.current_attempt_token === replacement.attempt_token
        && recoveryInvariant.rows[0]?.live_attempt_count === 1,
    );
    // The storage phase is object-granular: object one can crash after durable
    // prepare, be recovered tokenlessly by a verifier, and release exactly one
    // fresh authority for object two.
    await begin(workerA, true);
    const sessionCompletion = await workerA.query(
      `SELECT * FROM public.run_account_deletion_session_family_cleanup(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::uuid
      )`,
      [...values, replacement.attempt_token],
    );
    assert(sessionCompletion.rows[0]?.session_readback_passed === true);
    await workerA.query('COMMIT');

    await begin(workerA, true);
    const storageFirstResult = await workerA.query(
      `SELECT * FROM public.claim_account_deletion_external_job(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, 'storage', NULL
      )`,
      values,
    );
    const storageFirst = storageFirstResult.rows[0];
    assert(storageFirst?.claim_status === 'claimed' && typeof storageFirst.attempt_token === 'string');
    const storageFirstWorkResult = await workerA.query(
      `SELECT * FROM public.get_account_deletion_storage_work(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::uuid
      )`,
      [...values, storageFirst.attempt_token],
    );
    const storageFirstWork = storageFirstWorkResult.rows;
    assert(
      storageFirstWork.length === 1
        && storageFirstWork[0]?.work_mode === 'delete_then_verify'
        && typeof storageFirstWork[0]?.object_locator_hash === 'string',
    );
    const storageFirstPrepare = await workerA.query(
      `SELECT * FROM public.prepare_account_deletion_external_egress(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, 'storage', $7::uuid
      )`,
      [...values, storageFirst.attempt_token],
    );
    assert(storageFirstPrepare.rows[0]?.egress_state === 'egress_unknown');
    await workerA.query('COMMIT');

    await begin(workerB, true);
    const storageFirstRecoveryResult = await workerB.query(
      `SELECT * FROM public.claim_account_deletion_external_job(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, 'storage', NULL
      )`,
      values,
    );
    const storageFirstRecovery = storageFirstRecoveryResult.rows[0];
    assert(
      storageFirstRecovery?.claim_status === 'replayed'
        && storageFirstRecovery.attempt_token === storageFirst.attempt_token
        && storageFirstRecovery.lease_expires_at == null
        && storageFirstRecovery.checkpoint_state === 'verify_absence_only',
    );
    const storageFirstVerificationResult = await workerB.query(
      `SELECT * FROM public.get_account_deletion_storage_work(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::uuid
      )`,
      [...values, storageFirstRecovery.attempt_token],
    );
    const storageFirstVerification = storageFirstVerificationResult.rows;
    assert(
      storageFirstVerification.length === 1
        && storageFirstVerification[0]?.work_mode === 'verify_absence_only'
        && storageFirstVerification[0]?.object_locator_hash === storageFirstWork[0]?.object_locator_hash,
    );
    await workerB.query('COMMIT');

    await begin(coordinator);
    await coordinator.query(
      `DELETE FROM storage.objects WHERE bucket_id = $1::text AND name = $2::text`,
      [storageFirstWork[0].bucket_id, storageFirstWork[0].object_name],
    );
    await coordinator.query('COMMIT');

    await begin(workerB, true);
    await workerB.query(
      `SELECT * FROM public.record_account_deletion_external_provider_proof(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
        'storage', $7::uuid, $8::text, $9::text, $10::text, $11::text
      )`,
      [
        ...values,
        storageFirstRecovery.attempt_token,
        'g014-concurrency-receipt-001',
        'a'.repeat(64),
        storageFirstVerification[0].object_locator_hash,
        storageFirstVerification[0].object_version_hash,
      ],
    );
    const storageFirstReconcile = await workerB.query(
      `SELECT * FROM public.reconcile_account_deletion_storage_job(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::uuid
      )`,
      [...values, storageFirstRecovery.attempt_token],
    );
    assert(
      storageFirstReconcile.rows[0]?.storage_readback_passed === false
        && storageFirstReconcile.rows[0]?.job_state === 'pending'
        && storageFirstReconcile.rows[0]?.expected_work_count === 1
        && storageFirstReconcile.rows[0]?.provider_proof_count === 1,
    );
    await workerB.query('COMMIT');

    await begin(workerA, true);
    const storageSecondResult = await workerA.query(
      `SELECT * FROM public.claim_account_deletion_external_job(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, 'storage', NULL
      )`,
      values,
    );
    const storageSecond = storageSecondResult.rows[0];
    assert(
      storageSecond?.claim_status === 'claimed'
        && storageSecond.attempt_token !== storageFirst.attempt_token,
    );
    const storageSecondWorkResult = await workerA.query(
      `SELECT * FROM public.get_account_deletion_storage_work(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::uuid
      )`,
      [...values, storageSecond.attempt_token],
    );
    const storageSecondWork = storageSecondWorkResult.rows;
    assert(
      storageSecondWork.length === 1
        && storageSecondWork[0]?.work_mode === 'delete_then_verify'
        && storageSecondWork[0]?.object_locator_hash !== storageFirstWork[0]?.object_locator_hash,
    );
    const storageSecondPrepare = await workerA.query(
      `SELECT * FROM public.prepare_account_deletion_external_egress(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, 'storage', $7::uuid
      )`,
      [...values, storageSecond.attempt_token],
    );
    assert(storageSecondPrepare.rows[0]?.egress_state === 'egress_unknown');
    await workerA.query('COMMIT');

    await begin(workerB, true);
    const storageSecondRecoveryResult = await workerB.query(
      `SELECT * FROM public.claim_account_deletion_external_job(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, 'storage', NULL
      )`,
      values,
    );
    const storageSecondRecovery = storageSecondRecoveryResult.rows[0];
    assert(
      storageSecondRecovery?.claim_status === 'replayed'
        && storageSecondRecovery.attempt_token === storageSecond.attempt_token
        && storageSecondRecovery.lease_expires_at == null
        && storageSecondRecovery.checkpoint_state === 'verify_absence_only',
    );
    await workerB.query('COMMIT');

    await begin(coordinator);
    await coordinator.query(
      `DELETE FROM storage.objects WHERE bucket_id = $1::text AND name = $2::text`,
      [storageSecondWork[0].bucket_id, storageSecondWork[0].object_name],
    );
    await coordinator.query('COMMIT');

    await begin(workerB, true);
    await workerB.query(
      `SELECT * FROM public.record_account_deletion_external_provider_proof(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
        'storage', $7::uuid, $8::text, $9::text, $10::text, $11::text
      )`,
      [
        ...values,
        storageSecondRecovery.attempt_token,
        'g014-concurrency-receipt-002',
        'b'.repeat(64),
        storageSecondWork[0].object_locator_hash,
        storageSecondWork[0].object_version_hash,
      ],
    );
    const storageSecondReconcile = await workerB.query(
      `SELECT * FROM public.reconcile_account_deletion_storage_job(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::uuid
      )`,
      [...values, storageSecondRecovery.attempt_token],
    );
    assert(
      storageSecondReconcile.rows[0]?.storage_readback_passed === true
        && storageSecondReconcile.rows[0]?.job_state === 'completed'
        && storageSecondReconcile.rows[0]?.expected_work_count === 2
        && storageSecondReconcile.rows[0]?.provider_proof_count === 2,
    );
    const storageAttemptInvariant = await workerB.query(
      `SELECT
         count(*) FILTER (WHERE state = 'completed')::integer AS completed_attempt_count,
         count(DISTINCT storage_object_locator_hash)::integer AS distinct_object_count,
         count(*) FILTER (WHERE state IN ('leased', 'egress_unknown', 'reconciliation_required'))::integer AS live_attempt_count
       FROM privacy_retention.account_deletion_external_job_attempts
       WHERE request_id = $1::uuid AND phase = 'storage'`,
      [preview.request_id],
    );
    assert(
      storageAttemptInvariant.rows[0]?.completed_attempt_count === 2
        && storageAttemptInvariant.rows[0]?.distinct_object_count === 2
        && storageAttemptInvariant.rows[0]?.live_attempt_count === 0,
    );
    await workerB.query('COMMIT');
  } finally {
    await Promise.all([rollback(workerA), rollback(workerB), rollback(coordinator)]);
    await Promise.all([close(workerA), close(workerB), close(coordinator)]);
  }
}

run().then(
  () => output('G014_DELETION_CONCURRENCY_OK'),
  (error) => {
    if (error instanceof FixedFailure) {
      output(error.code, error.exitCode);
      return;
    }
    output('G014_DELETION_CONCURRENCY_FAILED', 1);
  },
);

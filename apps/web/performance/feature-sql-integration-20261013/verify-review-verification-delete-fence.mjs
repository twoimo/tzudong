#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const BASE_HARNESS = resolve(HERE, 'verify-feature-migrations.mjs');
const MIGRATION = resolve(
  ROOT,
  'backend/supabase/migrations/20261013190200_review_verification_immutable_key_fence.sql',
);
const SOURCE_CONTRACT = resolve(
  ROOT,
  'apps/web/tests-unit/review-verification-immutable-storage.test.ts',
);
const SELF = fileURLToPath(import.meta.url);

const sha256 = value => createHash('sha256').update(value).digest('hex');

function replaceOnce(source, anchor, replacement) {
  const first = source.indexOf(anchor);
  if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) {
    throw new Error('DELETE_FENCE_HARNESS_ANCHOR_INVALID');
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
}

function reproduceBaselineReviewVerificationDelete() {
  const objectId = '00000000-0000-4000-8000-000000000140';
  const objectPath = `${ids.owner}/reviews/${ids.preservedReview}/verification/preserved.jpg`;
  // The Storage API sets this transaction setting before deleting metadata.
  // Apply the same setting to every disposable-clone connection so the test
  // exercises project RLS/triggers instead of storage.protect_delete().
  psql("ALTER DATABASE postgres SET storage.allow_delete_query='true';", {
    actor: 'supabase_admin',
  });
  psql(`INSERT INTO storage.objects(id,bucket_id,name,owner_id,version,updated_at,metadata)
    VALUES('${objectId}','review-verifications',${quote(objectPath)},'${ids.owner}','baseline-v1',
      '2026-10-13T00:00:00Z','{}');`);

  const policies = json(`SELECT jsonb_agg(jsonb_build_object(
      'name',p.polname,
      'command',p.polcmd,
      'permissive',p.polpermissive,
      'roles',ARRAY(SELECT role_row.rolname FROM unnest(p.polroles) role_oid
        JOIN pg_roles role_row ON role_row.oid=role_oid),
      'using',pg_get_expr(p.polqual,p.polrelid)
    ) ORDER BY p.polname)::text
    FROM pg_policy p
    WHERE p.polrelid='storage.objects'::regclass
      AND p.polname IN ('review_verifications_owner_delete','review_verifications_safe_delete');`);
  const ownerPolicy = policies.find(row => row.name === 'review_verifications_owner_delete');
  const safePolicy = policies.find(row => row.name === 'review_verifications_safe_delete');
  if (policies.length !== 2
    || ownerPolicy?.command !== 'd'
    || ownerPolicy?.permissive !== true
    || safePolicy?.command !== 'd'
    || safePolicy?.permissive !== false
    || JSON.stringify(ownerPolicy?.roles) !== JSON.stringify(['authenticated'])
    || JSON.stringify(safePolicy?.roles) !== JSON.stringify(['authenticated'])) {
    fail('DELETE_FENCE_BASELINE_POLICY_COMPOSITION_INVALID');
  }

  const attempt = psql(`BEGIN;
SET ROLE supabase_storage_admin;
ALTER TABLE storage.objects DISABLE TRIGGER protect_objects_delete;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='${ids.owner}';
SET ROLE authenticated;
WITH deleted AS (
  DELETE FROM storage.objects WHERE id='${objectId}' RETURNING 1
)
SELECT count(*) FROM deleted;
RESET ROLE;
ROLLBACK;`, { actor: 'supabase_admin' });
  if (attempt.stdout.trim() !== '0'
    || scalar(`SELECT count(*) FROM storage.objects WHERE id='${objectId}';`) !== '1'
    || scalar(`SELECT count(*) FROM review_media_private.cleanup WHERE path=${quote(objectPath)};`) !== '0') {
    fail('DELETE_FENCE_BASELINE_REFERENCED_DELETE_WAS_NOT_DENIED');
  }

  return Object.freeze({
    policies,
    effectiveComposition: 'permissive_owner_AND_restrictive_safe_delete',
    permissivePoliciesAreOrCombined: false,
    referencedAuthenticatedDeleteRows: 0,
    referencedObjectPreserved: true,
    tombstoneNotCreatedForDeniedDelete: true,
    storageApiMetadataDeleteAdapterEnabled: true,
    fixture: Object.freeze({ objectId, objectPath }),
  });
}

async function verifyReviewVerificationDeleteFence(baseline) {
  const createFirstObject = '00000000-0000-4000-8000-000000000141';
  const createFirstReview = '00000000-0000-4000-8000-000000000142';
  const createFirstPath = `${ids.owner}/reviews/${createFirstReview}/verification/create-first.jpg`;
  const deleteFirstObject = '00000000-0000-4000-8000-000000000143';
  const deleteFirstReview = '00000000-0000-4000-8000-000000000144';
  const deleteFirstPath = `${ids.owner}/reviews/${deleteFirstReview}/verification/delete-first.jpg`;

  const catalog = json(`SELECT jsonb_build_object(
    'deleteTrigger',(SELECT jsonb_build_object(
      'name',trigger_row.tgname,
      'enabled',trigger_row.tgenabled,
      'type',trigger_row.tgtype,
      'function',trigger_row.tgfoid::regprocedure::text)
      FROM pg_trigger trigger_row
      WHERE trigger_row.tgrelid='storage.objects'::regclass
        AND trigger_row.tgname='a01_review_verification_guard_delete'
        AND NOT trigger_row.tgisinternal),
    'deleteFunction',(SELECT jsonb_build_object(
      'owner',owner_role.rolname,
      'securityDefiner',procedure.prosecdef,
      'config',procedure.proconfig,
      'returnType',procedure.prorettype::regtype::text)
      FROM pg_proc procedure JOIN pg_roles owner_role ON owner_role.oid=procedure.proowner
      WHERE procedure.oid=to_regprocedure('review_media_private.guard_verification_object_delete()')),
    'executeExposure',(SELECT coalesce(jsonb_agg(role_matrix.role_name ORDER BY role_matrix.role_name),'[]'::jsonb)
      FROM (VALUES ('anon'::name),('authenticated'::name),('service_role'::name),
        ('supabase_storage_admin'::name),('postgres'::name)) role_matrix(role_name)
      WHERE has_function_privilege(role_matrix.role_name,
        'review_media_private.guard_verification_object_delete()','EXECUTE')),
    'publicExecute',(SELECT EXISTS (
      SELECT 1
      FROM pg_proc procedure
      CROSS JOIN LATERAL aclexplode(coalesce(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )) acl
      WHERE procedure.oid=to_regprocedure('review_media_private.guard_verification_object_delete()')
        AND acl.grantee=0
        AND acl.privilege_type='EXECUTE'))
  )::text;`);
  if (catalog.deleteTrigger?.enabled !== 'O'
    || catalog.deleteTrigger?.type !== 11
    || catalog.deleteTrigger?.function !== 'review_media_private.guard_verification_object_delete()'
    || catalog.deleteFunction?.owner !== 'privacy_workflow_owner'
    || catalog.deleteFunction?.securityDefiner !== true
    || JSON.stringify(catalog.deleteFunction?.config) !== JSON.stringify(['search_path=""'])
    || catalog.deleteFunction?.returnType !== 'trigger'
    || catalog.executeExposure?.length !== 0
    || catalog.publicExecute !== false) {
    fail('DELETE_FENCE_CATALOG_INVALID');
  }

  const privilegedReferenced = psql(`DELETE FROM storage.objects
    WHERE id='${baseline.fixture.objectId}';`, {
    actor: 'supabase_admin', role: 'supabase_storage_admin', allowFailure: true,
  });
  if (privilegedReferenced.status === 0
    || !/REVIEW_VERIFICATION_OBJECT_REFERENCED/.test(privilegedReferenced.stderr)
    || scalar(`SELECT count(*) FROM storage.objects WHERE id='${baseline.fixture.objectId}';`) !== '1') {
    fail('DELETE_FENCE_PRIVILEGED_REFERENCED_DELETE_NOT_REJECTED');
  }

  const foodDelete = psql(`BEGIN;
WITH deleted AS (
  DELETE FROM storage.objects WHERE id='${ids.foodObject}' RETURNING id
)
SELECT count(*) FROM deleted;
ROLLBACK;`, { actor: 'supabase_admin', role: 'supabase_storage_admin' });
  if (foodDelete.stdout.trim() !== '1'
    || scalar(`SELECT count(*) FROM storage.objects WHERE id='${ids.foodObject}';`) !== '1') {
    fail('DELETE_FENCE_OTHER_BUCKET_OVERBLOCKED');
  }

  psql(`DELETE FROM public.reviews WHERE id='${ids.createdReview}';`);
  const retiredDelete = psql(`WITH deleted AS (
      DELETE FROM storage.objects WHERE id='${ids.verificationObject}' RETURNING id
    ) SELECT count(*) FROM deleted;`, {
    actor: 'supabase_admin', role: 'supabase_storage_admin',
  });
  if (retiredDelete.stdout.trim() !== '1') fail('DELETE_FENCE_RETIRED_DELETE_FAILED');
  const retiredReadback = json(`SELECT jsonb_build_object(
    'objectCount',(SELECT count(*) FROM storage.objects WHERE id='${ids.verificationObject}'),
    'reviewCount',(SELECT count(*) FROM public.reviews WHERE id='${ids.createdReview}'),
    'cleanup',(SELECT jsonb_build_object('retired',retired,'complete',complete,'owner',owner_id,
      'review',review_id,'purpose',purpose) FROM review_media_private.cleanup
      WHERE path=${quote(`${ids.owner}/reviews/${ids.createdReview}/verification/receipt.jpg`)})
  )::text;`);
  if (retiredReadback.objectCount !== 0
    || retiredReadback.reviewCount !== 0
    || retiredReadback.cleanup?.retired !== true
    || retiredReadback.cleanup?.complete !== false
    || retiredReadback.cleanup?.owner !== ids.owner
    || retiredReadback.cleanup?.review !== ids.createdReview
    || retiredReadback.cleanup?.purpose !== 'verification') {
    fail('DELETE_FENCE_RETIRED_READBACK_INVALID');
  }

  psql(`INSERT INTO storage.objects(id,bucket_id,name,owner_id,version,updated_at,metadata)
    VALUES
      ('${createFirstObject}','review-verifications',${quote(createFirstPath)},'${ids.owner}','race-v1',now(),'{}'),
      ('${deleteFirstObject}','review-verifications',${quote(deleteFirstPath)},'${ids.owner}','race-v1',now(),'{}');`);

  const createSession = startPsqlSession('delete_fence_create_first');
  const deleteAfterCreateSession = startPsqlSession('delete_fence_delete_after_create', 'supabase_admin');
  try {
    createSession.child.stdin.write(`BEGIN;
SET statement_timeout='8s';
INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo,food_photos)
VALUES('${createFirstReview}','${ids.owner}','${ids.restaurant}','create first','create first',now(),
  ${quote(createFirstPath)},ARRAY[]::text[]);
SELECT 'create_first_held';
`);
    await waitUntil(
      () => createSession.output().stdout.includes('create_first_held'),
      'DELETE_FENCE_CREATE_FIRST_NOT_HELD',
    );
    deleteAfterCreateSession.child.stdin.end(`BEGIN;
SET statement_timeout='8s';
SET ROLE supabase_storage_admin;
DELETE FROM storage.objects WHERE id='${createFirstObject}';
COMMIT;
\\q
`);
    const createFirstWait = await waitUntil(() => {
      const wait = json(`SELECT coalesce(jsonb_agg(jsonb_build_object(
        'application',application_name,'waitType',wait_event_type,'waitEvent',wait_event
      ) ORDER BY application_name),'[]'::jsonb)::text
      FROM pg_stat_activity
      WHERE application_name='delete_fence_delete_after_create'
        AND wait_event_type='Lock';`);
      return wait.length > 0 ? wait : null;
    }, 'DELETE_FENCE_DELETE_AFTER_CREATE_DID_NOT_WAIT');
    createSession.child.stdin.end('COMMIT;\n\\q\n');
    const [createCompleted, deleteAfterCreateCompleted] = await Promise.all([
      createSession.completed,
      deleteAfterCreateSession.completed,
    ]);
    if (createCompleted.status !== 0
      || deleteAfterCreateCompleted.status === 0
      || !/REVIEW_VERIFICATION_OBJECT_REFERENCED/.test(deleteAfterCreateCompleted.stderr)) {
      fail('DELETE_FENCE_CREATE_FIRST_RACE_INVALID');
    }
    if (scalar(`SELECT count(*) FROM public.reviews WHERE id='${createFirstReview}';`) !== '1'
      || scalar(`SELECT count(*) FROM storage.objects WHERE id='${createFirstObject}';`) !== '1') {
      fail('DELETE_FENCE_CREATE_FIRST_READBACK_INVALID');
    }

    const deleteFirstSession = startPsqlSession('delete_fence_delete_first', 'supabase_admin');
    const createAfterDeleteSession = startPsqlSession('delete_fence_create_after_delete');
    try {
      deleteFirstSession.child.stdin.write(`BEGIN;
SET statement_timeout='8s';
SET ROLE supabase_storage_admin;
DELETE FROM storage.objects WHERE id='${deleteFirstObject}';
SELECT 'delete_first_held';
`);
      await waitUntil(
        () => deleteFirstSession.output().stdout.includes('delete_first_held'),
        'DELETE_FENCE_DELETE_FIRST_NOT_HELD',
      );
      createAfterDeleteSession.child.stdin.end(`BEGIN;
SET statement_timeout='8s';
INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo,food_photos)
VALUES('${deleteFirstReview}','${ids.owner}','${ids.restaurant}','delete first','delete first',now(),
  ${quote(deleteFirstPath)},ARRAY[]::text[]);
COMMIT;
\\q
`);
      const deleteFirstWait = await waitUntil(() => {
        const wait = json(`SELECT coalesce(jsonb_agg(jsonb_build_object(
          'application',application_name,'waitType',wait_event_type,'waitEvent',wait_event
        ) ORDER BY application_name),'[]'::jsonb)::text
        FROM pg_stat_activity
        WHERE application_name='delete_fence_create_after_delete'
          AND wait_event_type='Lock';`);
        return wait.length > 0 ? wait : null;
      }, 'DELETE_FENCE_CREATE_AFTER_DELETE_DID_NOT_WAIT');
      deleteFirstSession.child.stdin.end('COMMIT;\n\\q\n');
      const [deleteFirstCompleted, createAfterDeleteCompleted] = await Promise.all([
        deleteFirstSession.completed,
        createAfterDeleteSession.completed,
      ]);
      if (deleteFirstCompleted.status !== 0
        || createAfterDeleteCompleted.status === 0
        || !/REVIEW_MEDIA_RETIRED/.test(createAfterDeleteCompleted.stderr)) {
        fail('DELETE_FENCE_DELETE_FIRST_RACE_INVALID');
      }
      const deleteFirstReadback = json(`SELECT jsonb_build_object(
        'objectCount',(SELECT count(*) FROM storage.objects WHERE id='${deleteFirstObject}'),
        'reviewCount',(SELECT count(*) FROM public.reviews WHERE id='${deleteFirstReview}'),
        'retired',(SELECT retired FROM review_media_private.cleanup WHERE path=${quote(deleteFirstPath)}),
        'complete',(SELECT complete FROM review_media_private.cleanup WHERE path=${quote(deleteFirstPath)})
      )::text;`);
      if (deleteFirstReadback.objectCount !== 0
        || deleteFirstReadback.reviewCount !== 0
        || deleteFirstReadback.retired !== true
        || deleteFirstReadback.complete !== false) {
        fail('DELETE_FENCE_DELETE_FIRST_READBACK_INVALID');
      }
      return Object.freeze({
        catalog,
        authenticatedReferencedDeleteRejected: true,
        privilegedReferencedDeleteRejected: true,
        unrelatedBucketDeleteAllowed: true,
        deletedReviewCleanupAllowed: true,
        referenceRemovedThenCleanupAllowed: true,
        createFirstRace: Object.freeze({
          waiterObserved: true,
          waits: createFirstWait,
          reviewCommitted: true,
          objectPreserved: true,
          deleteRejectedAsReferenced: true,
        }),
        deleteFirstRace: Object.freeze({
          waiterObserved: true,
          waits: deleteFirstWait,
          objectDeleted: true,
          tombstoneCommitted: true,
          laterReviewRejectedAsRetired: true,
        }),
      });
    } finally {
      if (deleteFirstSession.child.exitCode === null) await closePsqlSession(deleteFirstSession);
      if (createAfterDeleteSession.child.exitCode === null) await closePsqlSession(createAfterDeleteSession);
    }
  } finally {
    if (createSession.child.exitCode === null) await closePsqlSession(createSession);
    if (deleteAfterCreateSession.child.exitCode === null) await closePsqlSession(deleteAfterCreateSession);
  }
}

const frozenBefore = Object.freeze({
  baseHarness: sha256(readFileSync(BASE_HARNESS)),
  migration: sha256(readFileSync(MIGRATION)),
  sourceContract: sha256(readFileSync(SOURCE_CONTRACT)),
  deleteFenceHarness: sha256(readFileSync(SELF)),
});

let source = readFileSync(BASE_HARNESS, 'utf8');
source = replaceOnce(
  source,
  "const HERE = dirname(fileURLToPath(import.meta.url));\nconst ROOT = resolve(HERE, '../../../..');",
  `const HERE = ${JSON.stringify(HERE)};\nconst ROOT = ${JSON.stringify(ROOT)};`,
);
source = replaceOnce(
  source,
  '\nlet created = false;',
  `\n${reproduceBaselineReviewVerificationDelete.toString()}\n\n${verifyReviewVerificationDeleteFence.toString()}\n\nlet created = false;`,
);
source = replaceOnce(
  source,
  '  const storageBefore = storageContractState();\n  const featureHashesBefore',
  '  const storageBefore = storageContractState();\n  const baselineReviewVerificationDelete = reproduceBaselineReviewVerificationDelete();\n  const featureHashesBefore',
);
source = replaceOnce(
  source,
  '  const ocr = await verifyOcr();',
  '  const ocr = await verifyOcr();\n  const reviewVerificationDeleteFence = await verifyReviewVerificationDeleteFence(baselineReviewVerificationDelete);',
);
source = replaceOnce(
  source,
  '      ocr,\n      preexistingReviewAndAdminCorrectionExact:',
  '      ocr,\n      baselineReviewVerificationDelete,\n      reviewVerificationDeleteFence,\n      preexistingReviewAndAdminCorrectionExact:',
);
source = source.replace(
  'The immutable Storage metadata policy and trigger do not fence credentials that can overwrite provider bytes directly; those credentials remain an operating authority boundary.',
  'The database metadata fence does not fence credentials that overwrite provider bytes directly without a storage.objects transaction; direct S3 credentials remain an operating authority boundary.',
);

let captured = '';
const originalWrite = process.stdout.write.bind(process.stdout);
Error.stackTraceLimit = 0;
process.stdout.write = chunk => {
  captured += String(chunk);
  return true;
};
try {
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
} finally {
  process.stdout.write = originalWrite;
}

const frozenAfter = Object.freeze({
  baseHarness: sha256(readFileSync(BASE_HARNESS)),
  migration: sha256(readFileSync(MIGRATION)),
  sourceContract: sha256(readFileSync(SOURCE_CONTRACT)),
  deleteFenceHarness: sha256(readFileSync(SELF)),
});
if (JSON.stringify(frozenAfter) !== JSON.stringify(frozenBefore)) {
  throw new Error('DELETE_FENCE_SOURCE_CHANGED_DURING_REPLAY');
}

const proof = JSON.parse(captured.trim());
proof.kind = 'review-verification-delete-fence-existing-catalog-delta';
proof.sources.deleteFenceHarness = {
  path: 'apps/web/performance/feature-sql-integration-20261013/verify-review-verification-delete-fence.mjs',
  sha256: frozenAfter.deleteFenceHarness,
};
proof.sources.deleteFenceSourceContract = {
  path: 'apps/web/tests-unit/review-verification-immutable-storage.test.ts',
  sha256: frozenAfter.sourceContract,
};
proof.sources.frozenBefore = frozenBefore;
proof.sources.frozenAfter = frozenAfter;
proof.sources.exactFreezeVerified = true;
proof.limitations = Array.from(new Set([
  ...proof.limitations,
  'The race checks exercise storage.objects metadata transactions only; no Storage HTTP or provider-byte delete was sent.',
  'Account deletion and guarded-admin source and catalog preservation are covered by the enclosing exact-clone replay; this focused delta proves their shared reference-removed-then-delete ordering rather than invoking both full RPC flows.',
]));

const canonicalProof = value => Array.isArray(value)
  ? value.map(canonicalProof)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalProof(value[key])]))
    : value;
const receipt = `${JSON.stringify(canonicalProof(proof))}\n`;
const outputPath = process.env.DELETE_FENCE_RECEIPT_PATH;
if (outputPath) {
  const absoluteOutput = resolve(ROOT, outputPath);
  writeFileSync(absoluteOutput, receipt, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  writeFileSync(`${absoluteOutput}.sha256`, `${sha256(receipt)}  ${outputPath}\n`, {
    encoding: 'utf8', flag: 'wx', mode: 0o600,
  });
}
originalWrite(receipt);

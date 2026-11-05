import { createHash } from 'node:crypto';

import { expect, test } from 'bun:test';

import {
  assertEvidencePrefixedLaunchReady,
  buildEvidencePrefixedSuccessorStateQuery,
  compileEvidencePrefixedApplyPlan,
  compileEvidencePrefixedRehearsalAggregatePlan,
  ledgerIdentityRoot,
  loadEvidencePrefixedSuccessorManifest,
  validateEvidencePrefixedStageStates,
} from '../scripts/review-media-evidence-prefixed-sql-successors.mjs';
import {
  elevenMigrationBundleSuffixRoot,
  fiveMigrationBundleSuffixRoot,
} from '../scripts/supabase-migration-bundle.mjs';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const emptyRoot = sha256('');

function predecessorLegacyStages(record: any) {
  const manifest = record.targetRecord.manifest;
  const rawPrefixRoot = '1'.repeat(64);
  return Array.from({ length: 12 }, (_, index) => ({
    bundle: {
      ledgerCount: 89 + index,
      prefixRoot: rawPrefixRoot,
      priorCount: 89,
      suffixRoot: index === 11 ? elevenMigrationBundleSuffixRoot(manifest.migrations) : null,
      targetCount: index,
    },
    state: {
      activeReviewItems: 0,
      currentUser: 'postgres',
      databaseName: 'postgres',
      finishCleanupBodySha256: index === 10
        ? manifest.terminalContract.finishPreimageSha256
        : index === 11
          ? manifest.terminalContract.finishPostimageSha256
          : index === 0 ? null : sha256(`finish-${index}`),
      g014Root: index < 3 ? '2'.repeat(64) : '3'.repeat(64),
      ledgerRoot: index === 0 ? rawPrefixRoot : sha256(`predecessor-ledger-${index}`),
      ownerAuthorityReady: true,
      reviewItems: 0,
      reviewPolicyEnabled: false,
      reviewRuns: 0,
      schemaRoot: sha256(`predecessor-schema-${index}`),
      serverMajor: 17,
      sessionUser: 'postgres',
      storageRoot: sha256(`predecessor-storage-${index}`),
      terminalContractReady: index === 11,
    },
  }));
}

function featureLegacyStages(record: any) {
  const manifest = record.targetRecord.manifest;
  const rawPrefixRoot = '8'.repeat(64);
  const roleRoot = sha256('feature-role-root');
  const g014Before = sha256('feature-g014-before');
  const g014After = sha256('feature-g014-after');
  const storageBefore = sha256('feature-storage-before');
  const storageAfter = sha256('feature-storage-after');
  const storyboardBefore = sha256('feature-storyboard-before');
  const storyboardAfter = sha256('feature-storyboard-after');
  return Array.from({ length: 6 }, (_, index) => ({
    bundle: {
      ledgerCount: 100 + index,
      prefixRoot: rawPrefixRoot,
      priorCount: 100,
      suffixRoot: index === 5 ? fiveMigrationBundleSuffixRoot(manifest.migrations) : null,
      targetCount: index,
    },
    state: {
      activeReviewItems: 0,
      baseReviewReady: true,
      catalogRoot: sha256(`feature-catalog-${index}`),
      currentUser: 'postgres',
      databaseName: 'postgres',
      featureRuntimeReady: index >= 5,
      g014Ready: index >= 3,
      g014Root: index < 3 ? g014Before : g014After,
      immutableReady: index >= 4,
      ledgerRoot: index === 0 ? rawPrefixRoot : sha256(`feature-ledger-${index}`),
      ocrReady: index >= 2,
      predecessorReady: true,
      reviewPolicyEnabled: false,
      reviewRuns: 0,
      roleRoot,
      runtimePredicateReady: index >= 5,
      serverMajor: 17,
      sessionUser: 'postgres',
      storageRoot: index < 4 ? storageBefore : storageAfter,
      storyboardReady: index >= 1,
      storyboardRoot: index === 0 ? storyboardBefore : storyboardAfter,
    },
  }));
}

function stageStates(record: any, mode: 'operating' | 'rehearsal' = 'operating') {
  const legacy = record.manifest.phase === 'predecessor'
    ? predecessorLegacyStages(record)
    : featureLegacyStages(record);
  const targetRoots = record.manifest.operatingIdentity.targetStageRoots;
  const prefixRoot = mode === 'operating'
    ? record.manifest.operatingIdentity.prefixIdentityRoot
    : sha256(`fixture-prefix-${record.manifest.phase}`);
  const baseRoot = mode === 'operating'
    ? record.manifest.baseMapping.baseIdentityRoot
    : sha256(`fixture-base-${record.manifest.phase}`);
  const predecessorFullRoot = ledgerIdentityRoot(record.predecessorRows);
  return legacy.map((legacyStage: any, index: number) => ({
    bundle: {
      ledgerCount: record.manifest.operatingTransition.before + index,
      prefixRoot,
      priorCount: record.manifest.operatingTransition.before,
      suffixRoot: legacyStage.bundle.suffixRoot,
      targetCount: index,
    },
    state: {
      baseIdentityRoot: baseRoot,
      baseRowCount: 86,
      evidenceCount: 3,
      evidenceIdentityRoot: record.manifest.operatingIdentity.evidenceIdentityRoot,
      evidenceReady: true,
      featureCount: record.manifest.phase === 'feature' ? index : 0,
      featureIdentityRoot: record.manifest.phase === 'feature' ? targetRoots[index] : emptyRoot,
      featureReady: record.manifest.phase === 'feature' ? index === 5 : false,
      historicalAppliedVariantReady: mode === 'operating',
      ledgerIdentityRoot: mode === 'operating'
        ? record.manifest.operatingIdentity.ledgerStageRoots[index]
        : sha256(`fixture-ledger-${record.manifest.phase}-${index}`),
      legacyBundle: legacyStage.bundle,
      legacyState: legacyStage.state,
      operatingBaseReady: mode === 'operating',
      predecessorCount: record.manifest.phase === 'predecessor' ? index : 11,
      predecessorIdentityRoot: record.manifest.phase === 'predecessor'
        ? targetRoots[index]
        : predecessorFullRoot,
      predecessorReady: record.manifest.phase === 'predecessor' ? index === 11 : true,
      targetIdentityRoot: targetRoots[index],
      targetStageIndex: index,
    },
  }));
}

test('loads separately held 89->100 and 100->105 contracts', () => {
  const predecessor = loadEvidencePrefixedSuccessorManifest('predecessor');
  const feature = loadEvidencePrefixedSuccessorManifest('feature');

  expect(predecessor.manifest.operatingTransition).toEqual({ before: 89, after: 100 });
  expect(feature.manifest.operatingTransition).toEqual({ before: 100, after: 105 });
  expect(predecessor.targetRows).toHaveLength(11);
  expect(feature.targetRows).toHaveLength(5);
  expect(predecessor.evidenceRows).toHaveLength(3);
  expect(predecessor.manifest.baseMapping.baseIdentityRoot)
    .toBe(feature.manifest.baseMapping.baseIdentityRoot);
  expect(() => assertEvidencePrefixedLaunchReady(predecessor))
    .toThrow('EVIDENCE_PREFIXED_PREDECESSOR_LAUNCH_HELD');
  expect(() => assertEvidencePrefixedLaunchReady(feature))
    .toThrow('EVIDENCE_PREFIXED_FEATURE_LAUNCH_HELD');
});

test('state queries pin exact identity scopes and historical applied row', () => {
  for (const phase of ['predecessor', 'feature'] as const) {
    const record = loadEvidencePrefixedSuccessorManifest(phase);
    const query = buildEvidencePrefixedSuccessorStateQuery(record);
    expect(query).toContain('statement_vector_sha256');
    expect(query).toContain("octet_length(convert_to(version,'UTF8'))");
    expect(query).toContain('20261017043000');
    expect(query).toContain('20261017140000');
    expect(query).toContain('20261017160000');
    expect(query).toContain('20261008124858');
    expect(query).toContain('historicalAppliedVariantReady');
  }
});

test('accepts exact operating stages for each separate transition', () => {
  for (const phase of ['predecessor', 'feature'] as const) {
    const record = loadEvidencePrefixedSuccessorManifest(phase);
    const stages = stageStates(record);
    expect(validateEvidencePrefixedStageStates(stages, record, { mode: 'operating' }))
      .toMatchObject({ priorCount: record.manifest.operatingTransition.before, mode: 'operating' });
  }
});

test('keeps rehearsal fixture identity separate from hosted baseline identity', () => {
  for (const phase of ['predecessor', 'feature'] as const) {
    const record = loadEvidencePrefixedSuccessorManifest(phase);
    const rehearsal = stageStates(record, 'rehearsal');
    expect(validateEvidencePrefixedStageStates(rehearsal, record, { mode: 'rehearsal' }).mode)
      .toBe('rehearsal');
    expect(() => validateEvidencePrefixedStageStates(rehearsal, record, { mode: 'operating' }))
      .toThrow('EVIDENCE_PREFIXED_STAGE_INVALID');
  }
});

test('rejects evidence, historical variant, stage and ledger drift', () => {
  const predecessor = loadEvidencePrefixedSuccessorManifest('predecessor');
  for (const mutate of [
    (stages: any[]) => { stages[0].state.evidenceIdentityRoot = '0'.repeat(64); },
    (stages: any[]) => { stages[0].state.historicalAppliedVariantReady = false; },
    (stages: any[]) => { stages[4].state.targetStageIndex = 3; },
    (stages: any[]) => { stages[11].bundle.ledgerCount = 105; },
  ]) {
    const stages = structuredClone(stageStates(predecessor));
    mutate(stages);
    expect(() => validateEvidencePrefixedStageStates(stages, predecessor, { mode: 'operating' }))
      .toThrow('EVIDENCE_PREFIXED_STAGE_INVALID');
  }
});

test('compiles distinct atomic apply plans only from operating admissions', () => {
  for (const phase of ['predecessor', 'feature'] as const) {
    const record = loadEvidencePrefixedSuccessorManifest(phase);
    const stages = stageStates(record);
    const plan = compileEvidencePrefixedApplyPlan(record, {
      baseMappingSha256: record.manifest.baseMapping.sha256,
      kind: 'evidence-prefixed-successor-local-admission',
      manifestSha256: record.manifestSha256,
      phase,
      stageStates: stages,
    });
    expect(plan.plans).toHaveLength(phase === 'predecessor' ? 11 : 5);
    expect(plan.priorCount).toBe(record.manifest.operatingTransition.before);
    expect(plan.prefixRoot).toBe(record.manifest.operatingIdentity.prefixIdentityRoot);
    expect(plan.sql).toContain('pg_advisory_xact_lock');
    expect(plan.sql).toContain('MIGRATION_TERMINAL_READBACK_FAILED');
  }
});

test('compiles local aggregate SQL against rehearsal identity without reusing hosted roots', () => {
  for (const phase of ['predecessor', 'feature'] as const) {
    const record = loadEvidencePrefixedSuccessorManifest(phase);
    const rehearsal = stageStates(record, 'rehearsal');
    const plan = compileEvidencePrefixedRehearsalAggregatePlan(record, rehearsal);
    expect(plan.identityMode).toBe('rehearsal');
    expect(plan.plans).toHaveLength(phase === 'predecessor' ? 11 : 5);
    expect(plan.prefixRoot).toBe(rehearsal[0].bundle.prefixRoot);
    expect(plan.prefixRoot).not.toBe(record.manifest.operatingIdentity.prefixIdentityRoot);
    expect(plan.sql).toContain('MIGRATION_TERMINAL_READBACK_FAILED');
  }
});

test('rejects cross-phase and stale-baseline admissions', () => {
  const predecessor = loadEvidencePrefixedSuccessorManifest('predecessor');
  const stages = stageStates(predecessor);
  expect(() => compileEvidencePrefixedApplyPlan(predecessor, {
    baseMappingSha256: '0'.repeat(64),
    kind: 'evidence-prefixed-successor-local-admission',
    manifestSha256: predecessor.manifestSha256,
    phase: 'predecessor',
    stageStates: stages,
  })).toThrow('EVIDENCE_PREFIXED_ADMISSION_INVALID');
  expect(() => compileEvidencePrefixedApplyPlan(predecessor, {
    baseMappingSha256: predecessor.manifest.baseMapping.sha256,
    kind: 'evidence-prefixed-successor-local-admission',
    manifestSha256: predecessor.manifestSha256,
    phase: 'feature',
    stageStates: stages,
  })).toThrow('EVIDENCE_PREFIXED_ADMISSION_INVALID');
});

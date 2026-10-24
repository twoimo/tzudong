import { createHash } from 'node:crypto';
import { loadRecovery108ChainSource } from '../../scripts/receipt-ocr-recovery108-chain-plan.mjs';
import { ledgerIdentityRoot } from '../../scripts/review-media-evidence-prefixed-sql-successors.mjs';
import { elevenMigrationBundleSuffixRoot, fiveMigrationBundleSuffixRoot } from '../../scripts/supabase-migration-bundle.mjs';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

// Operating-shaped synthetic source fixture. No DB state or receipt is inferred.
function stages(record: any) {
  const predecessor = record.manifest.phase === 'predecessor';
  const size = predecessor ? 11 : 5;
  const suffix = predecessor
    ? elevenMigrationBundleSuffixRoot(record.targetRecord.manifest.migrations)
    : fiveMigrationBundleSuffixRoot(record.targetRecord.manifest.migrations);
  const legacyPrefix = predecessor ? '1'.repeat(64) : '8'.repeat(64);
  const roots = record.manifest.operatingIdentity;
  const priorPredecessorRoot = ledgerIdentityRoot(record.predecessorRows);
  return Array.from({ length: size + 1 }, (_, index) => {
    const legacyBundle = {
      ledgerCount: (predecessor ? 89 : 100) + index,
      prefixRoot: legacyPrefix,
      priorCount: predecessor ? 89 : 100,
      suffixRoot: index === size ? suffix : null,
      targetCount: index,
    };
    const legacyState = predecessor ? {
      activeReviewItems: 0, currentUser: 'postgres', databaseName: 'postgres',
      finishCleanupBodySha256: index === 10
        ? record.targetRecord.manifest.terminalContract.finishPreimageSha256
        : index === 11 ? record.targetRecord.manifest.terminalContract.finishPostimageSha256
          : index === 0 ? null : sha(`finish-${index}`),
      g014Root: index < 3 ? '2'.repeat(64) : '3'.repeat(64),
      ledgerRoot: index === 0 ? legacyPrefix : sha(`predecessor-ledger-${index}`),
      ownerAuthorityReady: true, reviewItems: 0, reviewPolicyEnabled: false, reviewRuns: 0,
      schemaRoot: sha(`predecessor-schema-${index}`), serverMajor: 17,
      sessionUser: 'postgres', storageRoot: sha(`predecessor-storage-${index}`),
      terminalContractReady: index === 11,
    } : {
      activeReviewItems: 0, baseReviewReady: true,
      catalogRoot: sha(`feature-catalog-${index}`), currentUser: 'postgres',
      databaseName: 'postgres', featureRuntimeReady: index >= 5, g014Ready: index >= 3,
      g014Root: index < 3 ? sha('feature-g014-before') : sha('feature-g014-after'),
      immutableReady: index >= 4,
      ledgerRoot: index === 0 ? legacyPrefix : sha(`feature-ledger-${index}`),
      ocrReady: index >= 2, predecessorReady: true, reviewPolicyEnabled: false, reviewRuns: 0,
      roleRoot: sha('feature-role-root'), runtimePredicateReady: index >= 5,
      serverMajor: 17, sessionUser: 'postgres',
      storageRoot: index < 4 ? sha('feature-storage-before') : sha('feature-storage-after'),
      storyboardReady: index >= 1,
      storyboardRoot: index === 0 ? sha('feature-storyboard-before') : sha('feature-storyboard-after'),
    };
    return {
      bundle: {
        ledgerCount: record.manifest.operatingTransition.before + index,
        prefixRoot: roots.prefixIdentityRoot,
        priorCount: record.manifest.operatingTransition.before,
        suffixRoot: legacyBundle.suffixRoot,
        targetCount: index,
      },
      state: {
        baseIdentityRoot: record.manifest.baseMapping.baseIdentityRoot,
        baseRowCount: 86, evidenceCount: 3, evidenceIdentityRoot: roots.evidenceIdentityRoot,
        evidenceReady: true, featureCount: predecessor ? 0 : index,
        featureIdentityRoot: predecessor ? sha('') : roots.targetStageRoots[index],
        featureReady: !predecessor && index === 5,
        historicalAppliedVariantReady: true,
        ledgerIdentityRoot: roots.ledgerStageRoots[index],
        legacyBundle, legacyState, operatingBaseReady: true,
        predecessorCount: predecessor ? index : 11,
        predecessorIdentityRoot: predecessor ? roots.targetStageRoots[index] : priorPredecessorRoot,
        predecessorReady: predecessor ? index === 11 : true,
        targetIdentityRoot: roots.targetStageRoots[index], targetStageIndex: index,
      },
    };
  });
}

export function syntheticRecovery108Input() {
  const source = loadRecovery108ChainSource();
  const admission = (record: any) => ({
    kind: 'evidence-prefixed-successor-local-admission', phase: record.manifest.phase,
    baseMappingSha256: record.manifest.baseMapping.sha256,
    manifestSha256: record.manifestSha256, stageStates: stages(record),
  });
  return {
    predecessorAdmission: admission(source.predecessor),
    featureAdmission: admission(source.feature),
    now: '2026-10-20T00:00:00.000Z', expiresAt: '2026-10-20T00:10:00.000Z',
  };
}

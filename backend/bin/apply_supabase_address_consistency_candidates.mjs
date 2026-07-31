#!/usr/bin/env node
/** Compatibility entrypoint for the authoritative signed address-evidence ledger. */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as applyLedger } from './apply_tzuyang_address_evidence_ledger.mjs';
import { logSafeError } from '../utils/privacy-log.mjs';

function legacyConsistencyError() {
  const error = new Error('legacy_consistency_report_not_authoritative');
  error.code = 'legacy_consistency_report_not_authoritative';
  return error;
}

function assertAuthoritativeLedgerArgs(argv) {
  for (const arg of argv) {
    if (arg === '--report-dir' || arg.startsWith('--report-dir=')
      || arg === '--provider-response' || arg.startsWith('--provider-response=')) {
      throw legacyConsistencyError();
    }
  }
}

export async function main(argv = process.argv.slice(2), options = {}) {
  assertAuthoritativeLedgerArgs(argv);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: node bin/apply_supabase_address_consistency_candidates.mjs --ledger-dir DIR --review-manifest NAME --confirm-manifest-sha256 LOWERCASE_SHA256 [--apply --allow-db-write --admin-user-id UUID] [--ids id1,id2] [--fixture-dry-run]');
    console.log('This compatibility entrypoint delegates only to the authoritative schema-v2 signed address-evidence ledger. Legacy --report-dir consistency reports are not authoritative.');
    return undefined;
  }
  return applyLedger(argv, options);
}

if (process.argv[1] && import.meta.url === (process.argv[1].startsWith('file:')
  ? new URL(process.argv[1]).href
  : pathToFileURL(path.resolve(process.argv[1])).href)) {
  main().catch((error) => {
    process.stderr.write('apply_supabase_address_consistency_candidates failed: ');
    logSafeError(error);
    process.exitCode = 1;
  });
}

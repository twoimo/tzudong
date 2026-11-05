#!/usr/bin/env node
import { mainEvidencePrefixedSuccessor } from './review-media-evidence-prefixed-sql-successors.mjs';

try {
  mainEvidencePrefixedSuccessor('predecessor');
} catch (error) {
  process.stderr.write(`${error?.code ?? 'EVIDENCE_PREFIXED_FAILURE'}\n`);
  process.exitCode = 1;
}

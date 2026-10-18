// Integrity/presence checks only; does not certify web research or runtime behavior.
import { readFile, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, '../../../..');
const sha = data => createHash('sha256').update(data).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = code => { throw Error(code); };

async function artifact(path) {
  if (typeof path !== 'string' || isAbsolute(path)) fail('INVALID_ARTIFACT_PATH');
  const candidate = resolve(root, path);
  const rel = relative(repo, candidate);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) fail('ARTIFACT_OUTSIDE_REPOSITORY');
  const stat = await lstat(candidate);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) fail('INVALID_ARTIFACT_FILE');
  if (await realpath(candidate) !== candidate) fail('ARTIFACT_SYMLINK_PARENT');
  return readFile(candidate);
}

async function verify(manifest) {
  if (manifest.thread_id !== '01a14e99-77bf-7531-b29e-a612bd99b540'
    || !/^[a-f0-9]{40}$/.test(manifest.source_revision || '')
    || !hex(manifest.source_bundle_sha256)
    || !Array.isArray(manifest.reports)
    || !Array.isArray(manifest.findings)
    || !Array.isArray(manifest.verification_artifacts)
    || !Array.isArray(manifest.remaining_blockers)) fail('INVALID_MANIFEST_SCHEMA');
  if (sha(await artifact(manifest.source_bundle_path)) !== manifest.source_bundle_sha256) fail('SOURCE_BUNDLE_HASH_MISMATCH');
  const seenStages = new Set();
  const expected = new Map([['thesis', 'ChatGPT'], ['antithesis', 'Gemini'], ['reverse', 'ChatGPT']]);
  for (const report of manifest.reports) {
    if (!expected.has(report.stage) || seenStages.has(report.stage)
      || expected.get(report.stage) !== report.provider) fail('INVALID_REPORT_STAGE');
    seenStages.add(report.stage);
    if (!hex(report.sha256) || !Number.isFinite(Date.parse(report.completed_at))) fail('INVALID_REPORT_METADATA');
    const url = new URL(report.conversation_url);
    if (url.protocol !== 'https:' || !['chatgpt.com', 'gemini.google.com'].includes(url.hostname)) fail('INVALID_REPORT_URL');
    if (report.provider === 'ChatGPT' && (report.model_label !== 'GPT-6' || report.reasoning_label !== 'Pro')) fail('WRONG_REQUESTED_MODEL');
    if (report.provider === 'Gemini' && (!/4\s*Argon/.test(report.model_label) || !/최고가|Max/i.test(report.reasoning_label))) fail('WRONG_REQUESTED_MODEL');
    if (!/심층 리서치|Deep Research/.test(report.research_mode)) fail('MISSING_RESEARCH_MODE');
    const body = await artifact(report.report_path);
    if (!body.length || sha(body) !== report.sha256) fail('REPORT_HASH_MISMATCH');
  }
  const evidence = new Set();
  for (const item of manifest.verification_artifacts) {
    if (evidence.has(item.path) || !hex(item.sha256)) fail('INVALID_VERIFICATION_ARTIFACT');
    evidence.add(item.path);
    const body = await artifact(item.path);
    if (body.length !== item.bytes || sha(body) !== item.sha256) fail('VERIFICATION_ARTIFACT_HASH_MISMATCH');
  }
  const ids = new Set();
  for (const finding of manifest.findings) {
    if (!finding.id || ids.has(finding.id)) fail('DUPLICATE_OR_MISSING_FINDING_ID');
    ids.add(finding.id);
    if (!['ACCEPT', 'CONDITIONAL', 'REJECT', 'DEFER'].includes(finding.decision)
      || !finding.reason || !finding.actual_action || !finding.verification_artifacts?.length) fail('INCOMPLETE_FINDING');
    if (finding.verification_artifacts.some(path => !evidence.has(path))) fail('FINDING_EVIDENCE_NOT_INDEXED');
    if (['CONDITIONAL', 'DEFER'].includes(finding.decision) && !finding.remaining_condition) fail('MISSING_REMAINING_CONDITION');
  }
  const missingStages = [...expected.keys()].filter(stage => !seenStages.has(stage));
  const eligible = missingStages.length === 0 && manifest.remaining_blockers.length === 0;
  if (manifest.status === 'complete' && !eligible) fail('PREMATURE_COMPLETE');
  return { passed: true, status: manifest.status, reports: seenStages.size,
    findings: ids.size, artifacts: evidence.size, missingStages, completionEligible: eligible,
    scope: 'Saved-file schema/hash/reference integrity only; cannot prove actual UI research completion, backend identity, runtime behavior or findings resolution.' };
}

try {
  const file = process.argv[2] ? resolve(root, process.argv[2]) : resolve(root, 'completion-manifest.json');
  const result = await verify(JSON.parse(await readFile(file, 'utf8')));
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ passed: false, code: error.message }) + '\n');
  process.exitCode = 1;
}

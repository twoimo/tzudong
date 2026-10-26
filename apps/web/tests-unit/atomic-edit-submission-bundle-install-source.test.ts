import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../..');
const read = (path: string) => readFileSync(resolve(root, path));
const digest = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const current = JSON.parse(read('.github/atomic-edit-submission-install.v2.json').toString());
const original = JSON.parse(read('.github/atomic-edit-submission-install.v1.json').toString());
const workflow = read('.github/workflows/atomic-edit-submission-bundle-install.yml').toString();

test('bundle preserves frozen original admissions and each individual original vector', () => {
  for (const [path, sha] of [
    ['.github/supabase-migration-release-manifest.v1.json', '515743d094b4b431a29df772a363837bdad8f7541aa3acf4a923efb79f460c0d'],
    ['.github/hosted-pending-custody-install.v1.json', '4e5c741526ba9cec547879c03b4bbf0a5b4598c593aa3f6397263d078334d926'],
    ['.github/atomic-edit-submission-install.v1.json', 'fc7b5720016e59b96470cc1245a53fbfff35f6cab511d5de2bcdc5bcfa7b2b25'],
    ['backend/supabase/migrations/20261025063810_hosted_pending_atomic_delivery.sql', '02bc9c5dab0e16a46a28a7993e9c75524813d0bc713c60782881eb4d5ddd2165'],
    ['backend/supabase/migrations/20261026120000_atomic_edit_submission_request.sql', 'da5f023379cc28614c2ede21b31e482198bb81217ee60093df20755824fe9f21'],
  ]) expect(digest(read(path!))).toBe(sha!);
  expect(current.migrations).toHaveLength(2);
  expect(current.migrations.map((m: { originalStatementVector: string[] }) => m.originalStatementVector.length)).toEqual([24, 5]);
  expect(digest(JSON.stringify(current.migrations[0].originalStatementVector))).toBe(original.statementVectorSha256);
  for (const member of current.migrations) {
    expect(digest(read(member.path))).toBe(member.sha256);
    expect(digest(JSON.stringify(member.originalStatementVector))).toBe(member.statementVectorSha256);
  }
});

test('bundle admits only custody94 then exact edit95 and corrected96 without translating PG17 metadata', () => {
  expect(current.expectedPriorState.expected.custodyOriginalTerminal.ledgerCount).toBe(94);
  expect(current.migrations[0].terminalReadback.expected.legacy.ledgerCount).toBe(95);
  expect(current.terminalReadback.expected.legacy.ledgerCount).toBe(96);
  expect(digest(JSON.stringify(current.expectedPriorState))).toBe(digest(JSON.stringify(original.migration.expectedPriorState)));
  expect(digest(JSON.stringify(current.migrations[1].expectedPriorState))).toBe(digest(JSON.stringify(original.migration.terminalReadback)));
  expect(current.bindingEvidence.operatingExecutionVerified).toBe(false);
  expect(current.bindingEvidence.metadataValueTranslation).toBe(false);
  const footprint = current.terminalReadback.expected.edit;
  expect(footprint.functionCount).toBe(2);
  expect(footprint.binding.acl).toContainEqual(['postgres', 'postgres', 'MAINTAIN', false]);
  expect(footprint.functions[0][18]).not.toBe(original.migration.terminalReadback.expected.edit.functions[0][18]);
  expect(digest(JSON.stringify(footprint.functions[1]))).toBe(digest(JSON.stringify(original.migration.terminalReadback.expected.edit.functions[1])));
  const query = current.terminalReadback.query;
  expect(query).toContain("WHERE version NOT IN ('20261025063810','20261026120000','20261026130000')");
  expect(query).not.toContain("p.proname<>'submit_restaurant_edit_request'");
});

test('new bundle dispatch keeps owner protected main attempt1 exact source and producer fence', () => {
  for (const condition of ["github.ref == 'refs/heads/main'", 'github.ref_protected', 'github.actor == github.repository_owner',
    'github.triggering_actor == github.repository_owner', 'github.event.sender.login == github.repository_owner',
    'github.sha == inputs.source_sha', "inputs.mode == 'observe' || github.run_attempt == 1"])
    expect(workflow).toContain(condition);
  expect(workflow).toContain('node apps/web/scripts/atomic-edit-submission-bundle-operation.mjs "$MODE"');
  expect(workflow).toContain('disabled_manually');
  expect(workflow).toContain('test -z "$(git status --porcelain --untracked-files=all)"');
  expect(workflow).not.toMatch(/\b(?:push|pull_request|schedule|pull_request_target):/);
  expect(workflow).not.toContain('continue-on-error: true');
  expect(workflow).not.toContain('secrets.SUPABASE_ACCESS_TOKEN');
});

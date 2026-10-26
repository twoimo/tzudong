import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dir, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const original = JSON.parse(read('.github/hosted-pending-custody-install.v1.json'));
const current = JSON.parse(read('.github/atomic-edit-submission-install.v1.json'));
const workflow = read('.github/workflows/atomic-edit-submission-install.yml');
const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)])) : value;
const objectDigest = (value: unknown) => digest(JSON.stringify(normalize(value)));

test('edit installation preserves both existing immutable release contracts', () => {
  expect(digest(read('.github/hosted-pending-custody-install.v1.json'))).toBe('4e5c741526ba9cec547879c03b4bbf0a5b4598c593aa3f6397263d078334d926');
  expect(digest(read('.github/supabase-migration-release-manifest.v1.json'))).toBe('515743d094b4b431a29df772a363837bdad8f7541aa3acf4a923efb79f460c0d');
  expect(current.projectRef).toBe('aqlcofblfxdrjhhdmarw');
  expect(current.migration.path).toBe('backend/supabase/migrations/20261026120000_atomic_edit_submission_request.sql');
  expect(current.migration.sha256).toBe('da5f023379cc28614c2ede21b31e482198bb81217ee60093df20755824fe9f21');
  expect(digest(read(current.migration.path))).toBe(current.migration.sha256);
  expect(current.originalStatementVector).toHaveLength(24);
  expect(current.statementVectorSha256).toBe('44400a0ff2dfd37e8275aac60942e4b66ed75d86d9758b2477cc3fe4aba0475b');
  expect(current.statementVectorSha256).toBe(digest(JSON.stringify(current.originalStatementVector)));
  expect(current.bindingEvidence.operatingExecutionVerified).toBe(false);
  expect(current.bindingEvidence.comparison.metadataValueTranslation).toBe(false);
});

test('new admission starts only at the original custody terminal94 and excludes an existing edit install', () => {
  const expected = current.migration.expectedPriorState.expected;
  expect(objectDigest(expected.custodyOriginalTerminal)).toBe(objectDigest(original.migration.terminalReadback.expected));
  expect(expected.editAbsent).toBe(true);
  expect(expected.custodyOriginalTerminal.ledgerCount).toBe(94);
  const terminal = current.migration.terminalReadback.expected;
  expect(terminal.legacy.ledgerCount).toBe(95);
  expect(objectDigest({ ...terminal.legacy, ledgerCount: 94 })).toBe(objectDigest(expected.custodyOriginalTerminal));
  expect(terminal.edit.functionCount).toBe(2);
  expect(terminal.edit.binding.owner).toBe('postgres');
  expect(terminal.edit.binding.rls).toBe(true);
  expect(terminal.edit.binding.forceRls).toBe(true);
  const query = current.migration.terminalReadback.query;
  expect(query).not.toContain("p.proname<>'submit_restaurant_edit_request'");
  for (const schema of ['public', 'pipeline_control']) expect(query).toContain(`to_regprocedure('${schema}.submit_restaurant_edit_request(uuid,text,uuid,jsonb)')`);
  for (const field of ['p.prorettype', 'p.proretset', 'p.proargnames', 'p.proargmodes', 'p.provariadic', 'p.pronargdefaults', 'p.proisstrict', 'p.proleakproof', 'p.prokind', 'p.proparallel']) expect(query).toContain(field);
  for (const fn of terminal.edit.functions as unknown[][]) {
    expect(fn[8]).toBe('jsonb');
    expect(fn[9]).toBe(false);
    expect(fn[10]).toEqual(['p_user_id', 'p_client_request_key', 'p_target_restaurant_id', 'p_payload']);
    expect(fn[11]).toBeNull();
    expect(fn[12]).toBe('0');
    expect(fn[13]).toBe(0);
    expect(fn[14]).toBe(false);
    expect(fn[15]).toBe(false);
    expect(fn[16]).toBe('f');
    expect(fn[17]).toBe('u');
  }
  const fk = (terminal.edit.binding.constraints as unknown[][]).filter(row => row[1] === 'f');
  expect(fk).toHaveLength(1);
  expect(fk[0]?.[2]).toContain('REFERENCES public.restaurant_submissions(id)');
  const parentTriggers = terminal.edit.parentFkTriggers as unknown[][];
  expect(parentTriggers).toHaveLength(2);
  expect(parentTriggers.map(row => row[4])).toEqual(['RI_FKey_cascade_del', 'RI_FKey_noaction_upd']);
  expect(parentTriggers.every(row => row[0] === true && row[1] === 'O' && row[3] === 'pg_catalog')).toBe(true);
  expect(terminal.edit.binding.acl).toContainEqual(['postgres', 'postgres', 'MAINTAIN', false]);
  expect((terminal.edit.binding.acl as unknown[][]).every(row => row[0] === 'postgres' && row[1] === 'postgres' && row[3] === false)).toBe(true);
  expect(current.migration.terminalReadback.query).toContain("edit_fk.confrelid='public.restaurant_submissions'::regclass");
  expect(current.migration.terminalReadback.query).toContain("edit_fk.conrelid=to_regclass('pipeline_control.restaurant_edit_request_bindings')");
});

test('standalone manual operation is owner-only, exact protected main and first apply attempt', () => {
  expect(workflow).toContain('workflow_dispatch:');
  for (const condition of ["github.ref == 'refs/heads/main'", 'github.ref_protected', 'github.actor == github.repository_owner', 'github.triggering_actor == github.repository_owner', 'github.event.sender.login == github.repository_owner', 'github.sha == inputs.source_sha', "inputs.mode == 'observe' || github.run_attempt == 1"]) expect(workflow).toContain(condition);
  expect(workflow).toContain('apps/web/scripts/atomic-edit-submission-operation.mjs');
  expect(workflow).toContain('disabled_manually');
  expect(workflow).toContain('test -z "$(git status --porcelain --untracked-files=all)"');
  expect(workflow).not.toMatch(/\b(?:push|pull_request|schedule|pull_request_target):/);
  expect(workflow).not.toContain('continue-on-error: true');
  expect(workflow).not.toContain('secrets.SUPABASE_ACCESS_TOKEN');
});

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

import { createRecovery108PsqlReadbackExecutor, prepareRecovery108ChainReadback } from '../scripts/receipt-ocr-recovery108-chain-readback.mjs';
import { syntheticRecovery108Input as syntheticInput } from './fixtures/receipt-ocr-chain-input.ts';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

const encode = (status: string, reason: string) => JSON.stringify({ status, reason });
const match = encode('settled_initial_match', 'SETTLED_INITIAL_MATCH');
function targetEnvironment() {
  const url = new URL('postgresql://postgres@db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres?sslmode=require');
  url.password = randomUUID();
  return { SUPABASE_DB_URL: url.toString() };
}

describe('single-process OCR full-chain readback', () => {
  test('compiles conditional state lookup after the same-connection locks and ends with rollback', () => {
    const p = prepareRecovery108ChainReadback(syntheticInput()), sql = p.readOnlyScript;
    expect(p.readbackCompilerSha256).toBe(sha(readFileSync(new URL('../scripts/receipt-ocr-recovery108-chain-readback.mjs', import.meta.url)).toString()));
    expect(p.readbackSourceRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(sql.startsWith('BEGIN;\n')).toBe(true);
    expect(sql.indexOf('SET TRANSACTION READ ONLY;')).toBeLessThan(sql.indexOf('pg_try_advisory_xact_lock'));
    expect(sql.indexOf('LOCK TABLE supabase_migrations.schema_migrations')).toBeLessThan(sql.indexOf('AS available'));
    expect(sql.indexOf('\\gset ocr108_available_')).toBeLessThan(sql.indexOf('AS identified'));
    expect(sql).toContain('\\if :ocr108_identity_initial_match');
    expect(sql).toContain('\\elif :ocr108_identity_terminal_match');
    expect(sql).toContain('count(*)=1 AND bool_and(');
    expect(sql.endsWith('ROLLBACK;\n')).toBe(true);
    expect(sql).not.toMatch(/\bCOMMIT\s*;/i);
  }, 30000);
  test('accepts only one fixed result after the entire transport succeeds', async () => {
    const p = prepareRecovery108ChainReadback(syntheticInput());
    for (const [status, reason] of [['settled_initial_match', 'SETTLED_INITIAL_MATCH'], ['settled_terminal_match', 'SETTLED_TERMINAL_MATCH'], ['conflict', 'STATE_CONFLICT'], ['conflict', 'IDENTITY_CONFLICT'], ['unknown', 'LEDGER_UNAVAILABLE'], ['unknown', 'IDENTITY_UNAVAILABLE']]) {
      let calls = 0;
      expect(await p.execute({ runReadOnlyScript(sql: string) { calls++; expect(sql).toBe(p.readOnlyScript); return encode(status, reason); } })).toEqual({ status, reason });
      expect(calls).toBe(1);
    }
    for (const raw of ['', match + '\n' + match, 'x'.repeat(65537), '[]', encode('settled_initial_match', 'STATE_CONFLICT'), '{"status":"committed","reason":"OK"}', JSON.stringify({ status: 'settled_initial_match', reason: 'SETTLED_INITIAL_MATCH', settled: true })]) {
      expect(await p.execute({ runReadOnlyScript: () => raw })).toEqual({ status: 'unknown', reason: 'READBACK_INVALID' });
    }
  }, 30000);
  test('never touches an existing query client or accepts caller settlement flags', async () => {
    const p = prepareRecovery108ChainReadback(syntheticInput()); let queries = 0;
    const old = { query() { queries++; throw new Error('existing transaction'); } };
    expect(await p.execute(old)).toEqual({ status: 'unknown', reason: 'TRANSPORT_INVALID' });
    expect(await p.execute({ ...old, runReadOnlyScript: () => match })).toEqual({ status: 'unknown', reason: 'TRANSPORT_INVALID' });
    expect(queries).toBe(0);
    expect(() => prepareRecovery108ChainReadback({ ...syntheticInput(), settled: true })).toThrow('RECEIPT_OCR_CHAIN_INPUT_INVALID');
    const original = p.readOnlyScript; p.queryPlan.settlement.lockSql = 'SELECT 1;';
    await p.execute({ runReadOnlyScript(sql: string) { expect(sql).toBe(original); return match; } });
  }, 30000);
  test('actual creator starts one new psql per readback with bounded IO and no credential argv', async () => {
    const environment = targetEnvironment(), spawned: any[] = [];
    const execute = createRecovery108PsqlReadbackExecutor({ environment, spawnImpl(binary: string, args: string[], options: any) { spawned.push({ binary, args, options }); return { status: 0, stdout: match, stderr: '' }; } });
    const input = syntheticInput();
    for (let i = 0; i < 2; i++)expect(await execute(input)).toEqual({ status: 'settled_initial_match', reason: 'SETTLED_INITIAL_MATCH' });
    expect(spawned).toHaveLength(2);
    for (const c of spawned) {
      expect(c.args).toContain('--no-psqlrc'); expect(c.args).toContain('--file=-'); expect(c.args).toContain('--no-password');
      expect(c.args.join(' ')).not.toContain(environment.SUPABASE_DB_URL);
      expect(c.options.env.PGHOST).toBe('db.aqlcofblfxdrjhhdmarw.supabase.co');
      expect(c.options.env.PGOPTIONS).toBe('-c default_transaction_read_only=on'); expect(c.options.env.PGCONNECT_TIMEOUT).toBe('5');
      expect(c.options.input).toContain('SET TRANSACTION READ ONLY;'); expect(c.options.input.trimEnd().endsWith('ROLLBACK;')).toBe(true);
      expect(c.options.timeout).toBe(30000); expect(c.options.killSignal).toBe('SIGKILL'); expect(c.options.maxBuffer).toBe(65536);
    }
  }, 30000);
  test('failed exit or timeout discards matching partial stdout and never leaks diagnostics', async () => {
    for (const result of [{ status: 3, stdout: match, stderr: 'private detail' }, { status: null, stdout: match, stderr: '', error: { code: 'ETIMEDOUT' } }]) {
      let calls = 0; const execute = createRecovery108PsqlReadbackExecutor({ environment: targetEnvironment(), spawnImpl() { calls++; return result; } });
      const value = await execute(syntheticInput()); expect(value).toEqual({ status: 'unknown', reason: 'READBACK_UNAVAILABLE' });
      expect(JSON.stringify(value)).not.toContain('private'); expect(calls).toBe(1);
    }
  }, 30000);
  test('rejects missing, wrong-project and overlapping management authority before spawning', () => {
    for (const environment of [{}, { SUPABASE_DB_URL: 'postgresql://postgres@db.aqlcofblfxdrjhhdmarw.supabase.co:5432/postgres' }, { SUPABASE_DB_URL: 'postgresql://postgres@db.other.supabase.co:5432/postgres' }, { ...targetEnvironment(), SUPABASE_ACCESS_TOKEN: randomUUID() }]) {
      let calls = 0; expect(() => createRecovery108PsqlReadbackExecutor({ environment, spawnImpl() { calls++; } })).toThrow('RECEIPT_OCR_CHAIN_READBACK_TARGET_INVALID'); expect(calls).toBe(0);
    }
  }, 30000);
});

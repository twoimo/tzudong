/** Pure admission/SQL compilation for the existing reviewed migration caller. */
import { createHash } from 'node:crypto';
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const sha = value => createHash('sha256').update(value).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const trim = value => value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');

// Positions, not a SQL rewriter. Dollar bodies, quoted identifiers/strings and comments remain byte-identical.
export function statementSpans(source) {
  const spans = []; let start = 0; let quoteKind = null; let dollar = null; let block = 0; let line = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '/' && n === '*') { block++; i++; } else if (c === '*' && n === '/') { block--; i++; } continue; }
    if (dollar) { if (source.startsWith(dollar, i)) { i += dollar.length - 1; dollar = null; } continue; }
    if (quoteKind) {
      if (c === '\\' && quoteKind === "'") { i++; continue; }
      if (c === quoteKind) { if (n === c) i++; else quoteKind = null; } continue;
    }
    if (c === '\\') fail('MIGRATION_SQL_META_COMMAND_DENIED');
    if (c === '-' && n === '-') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = 1; i++; continue; }
    if (c === "'" || c === '"') { quoteKind = c; continue; }
    if (c === '$') { const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(i))?.[0]; if (tag) { dollar = tag; i += tag.length - 1; continue; } }
    if (c === ';') { const token = trim(source.slice(start, i)); if (token) spans.push({ start, end: i + 1, token }); start = i + 1; }
  }
  if (quoteKind || dollar || block) fail('MIGRATION_SQL_UNTERMINATED');
  const token = trim(source.slice(start)); if (token) spans.push({ start, end: source.length, token });
  return spans;
}
function leadingSql(token) {
  let value = trim(token);
  for (;;) {
    if (value.startsWith('--')) { const end = value.indexOf('\n'); value = end < 0 ? '' : trim(value.slice(end + 1)); }
    else if (value.startsWith('/*')) { let depth = 1, i = 2; while (depth && i < value.length) { if (value.startsWith('/*', i)) { depth++; i += 2; } else if (value.startsWith('*/', i)) { depth--; i += 2; } else i++; } if (depth) fail('MIGRATION_SQL_UNTERMINATED'); value = trim(value.slice(i)); }
    else return value;
  }
}
export function migrationEnvelope(bytes, migration, originalVector) {
  if (!Buffer.isBuffer(bytes) || sha(bytes) !== migration.sha256) fail('MIGRATION_FILE_DIGEST_MISMATCH');
  const source = bytes.toString('utf8'); if (!Buffer.from(source).equals(bytes)) fail('MIGRATION_SQL_ENCODING_INVALID');
  const spans = statementSpans(source);
  if (!Array.isArray(originalVector) || !originalVector.length || JSON.stringify(spans.map(s => s.token)) !== JSON.stringify(originalVector)) fail('MIGRATION_VECTOR_MISMATCH');
  const controls = spans.map((s, i) => /^(?:BEGIN|COMMIT|END|ROLLBACK|ABORT|START\s+TRANSACTION|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION)\b/i.test(leadingSql(s.token)) ? i : -1).filter(i => i >= 0);
  let execution = source;
  if (controls.length) {
    if (controls.length !== 2 || controls[0] !== 0 || controls[1] !== spans.length - 1 || leadingSql(spans[0].token).toUpperCase() !== 'BEGIN' || leadingSql(spans.at(-1).token).toUpperCase() !== 'COMMIT') fail('MIGRATION_TRANSACTION_CONTROL_DENIED');
    const first = spans[0], last = spans.at(-1);
    const beginStart = first.end - 1 - 5; // Exactly BEGIN; after admitted leading comments/whitespace.
    if (source.slice(beginStart, first.end).toUpperCase() !== 'BEGIN;') fail('MIGRATION_TRANSACTION_ENVELOPE_INVALID');
    const commitMatch = /COMMIT\s*;?\s*$/i.exec(source.slice(last.start, last.end));
    if (!commitMatch) fail('MIGRATION_TRANSACTION_ENVELOPE_INVALID');
    const commitStart = last.start + commitMatch.index;
    const prefix = source.slice(0, beginStart), middle = source.slice(first.end, commitStart), suffix = source.slice(last.end);
    execution = prefix + middle + suffix;
    const inverse = execution.slice(0, prefix.length) + source.slice(beginStart, first.end) + execution.slice(prefix.length, prefix.length + middle.length) + source.slice(commitStart, last.end) + execution.slice(prefix.length + middle.length);
    if (!Buffer.from(inverse).equals(bytes)) fail('MIGRATION_TRANSACTION_INVERSE_MISMATCH');
  }
  const match = /^backend\/supabase\/migrations\/(\d{14})_([a-z0-9_]+)\.sql$/.exec(migration.path);
  if (!match) fail('MIGRATION_LEDGER_IDENTITY_INVALID');
  return { execution, originalVector, version: match[1], name: match[2], sourceSha256: migration.sha256, vectorSha256: sha(JSON.stringify(originalVector)) };
}
function readQuery(contract) {
  const spans = statementSpans(contract?.query ?? '');
  if (spans.length !== 1 || !/^SELECT\b/i.test(leadingSql(spans[0].token)) || !contract.expected || typeof contract.expected !== 'object' || Array.isArray(contract.expected) || !Object.keys(contract.expected).length) fail('MIGRATION_READBACK_CONTRACT_INSUFFICIENT');
  // Trusted manifest queries only; disallow mutation/transaction keywords outside literals/comments.
  const sql = leadingSql(spans[0].token);
  const masked = sql.replace(/'(?:''|\\.|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
  if (/\b(?:INSERT|UPDATE|DELETE|MERGE|COPY|CALL|DO|COMMIT|ROLLBACK|BEGIN|INTO|FOR\s+UPDATE|FOR\s+SHARE)\b/i.test(masked)) fail('MIGRATION_READBACK_CONTRACT_INSUFFICIENT');
  return sql;
}
function capture(query, variable) {
  return `EXECUTE ${quote(`SELECT jsonb_agg(to_jsonb(r)) FROM (${query}) r`)} INTO STRICT rows_value;
 IF jsonb_typeof(rows_value) IS DISTINCT FROM 'array' OR jsonb_array_length(rows_value)<>1 OR (SELECT count(*) FROM jsonb_object_keys(rows_value->0))<>1 THEN RAISE EXCEPTION 'MIGRATION_READBACK_INVALID'; END IF;
 SELECT value INTO STRICT ${variable} FROM jsonb_each(rows_value->0);
 IF jsonb_typeof(${variable})='string' THEN ${variable}:=(${variable}#>>'{}')::jsonb; END IF;
 IF jsonb_typeof(${variable}) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'MIGRATION_READBACK_INVALID'; END IF;`;
}
function block(body) { const tag = `$migration_${sha(body).slice(0, 24)}$`; if (body.includes(tag)) fail('MIGRATION_SQL_DELIMITER_COLLISION'); return `DO ${tag}\nDECLARE rows_value jsonb; observed jsonb; terminal_value jsonb;\nBEGIN\n${body}\nEND;\n${tag};`; }
function ledgerEqual(plan) { return `EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(plan.version)} AND name IS NOT DISTINCT FROM ${quote(plan.name)} AND statements IS NOT DISTINCT FROM ARRAY(SELECT jsonb_array_elements_text(${quote(JSON.stringify(plan.originalVector))}::jsonb)))`; }
export function atomicMigrationSql(plan, migration) {
  const prior = readQuery(migration.expectedPriorState), terminal = readQuery(migration.terminalReadback);
  const expectedPrior = `${quote(JSON.stringify(migration.expectedPriorState.expected))}::jsonb`, expectedTerminal = `${quote(JSON.stringify(migration.terminalReadback.expected))}::jsonb`;
  const admission = block(`IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'MIGRATION_LEDGER_UNAVAILABLE'; END IF;
 IF NOT has_schema_privilege(current_user,'supabase_migrations','USAGE') OR (NOT has_table_privilege(current_user,'supabase_migrations.schema_migrations','SELECT') OR NOT has_table_privilege(current_user,'supabase_migrations.schema_migrations','INSERT')) THEN RAISE EXCEPTION 'MIGRATION_LEDGER_UNAVAILABLE'; END IF;
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND NOT attisdropped AND attnum>0 AND ((attname='version' AND atttypid='text'::regtype) OR (attname='name' AND atttypid='text'::regtype) OR (attname='statements' AND atttypid='text[]'::regtype)))<>3 THEN RAISE EXCEPTION 'MIGRATION_LEDGER_CONTRACT_INSUFFICIENT'; END IF;
 IF ((SELECT count(*) FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attnum>0 AND NOT attisdropped) NOT IN(3,6) OR ((SELECT count(*) FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attnum>0 AND NOT attisdropped)=6 AND (SELECT count(*) FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attnum>0 AND NOT attisdropped AND NOT attnotnull AND NOT atthasdef AND ((attname IN('created_by','idempotency_key') AND atttypid='text'::regtype) OR (attname='rollback' AND atttypid='text[]'::regtype)))<>3)) OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='supabase_migrations.schema_migrations'::regclass AND relkind='r' AND relpersistence='p' AND NOT relrowsecurity) OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='supabase_migrations.schema_migrations'::regclass AND contype='p' AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attname='version')]::smallint[]) THEN RAISE EXCEPTION 'MIGRATION_LEDGER_CONTRACT_INSUFFICIENT'; END IF;`);
  const priorGuard = block(`${capture(prior, 'observed')}
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(plan.version)}) THEN
  ${capture(terminal, 'terminal_value')}
  IF ${ledgerEqual(plan)} AND terminal_value=${expectedTerminal} THEN RAISE EXCEPTION 'MIGRATION_ALREADY_APPLIED'; END IF;
  RAISE EXCEPTION 'MIGRATION_LEDGER_CONFLICT';
 END IF;
 IF observed IS DISTINCT FROM ${expectedPrior} THEN RAISE EXCEPTION 'MIGRATION_PRIOR_STATE_MISMATCH'; END IF;`);
  const terminalGuard = block(`${capture(terminal, 'observed')}
 IF observed IS DISTINCT FROM ${expectedTerminal} THEN RAISE EXCEPTION 'MIGRATION_TERMINAL_READBACK_FAILED'; END IF;`);
  const ledgerGuard = block(`IF NOT ${ledgerEqual(plan)} THEN RAISE EXCEPTION 'MIGRATION_LEDGER_READBACK_FAILED'; END IF;`);
  return `SET LOCAL standard_conforming_strings=on; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='120s';\n${admission}\nLOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;\n${priorGuard}\n${plan.execution}\n${terminalGuard}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(plan.version)},${quote(plan.name)},ARRAY(SELECT jsonb_array_elements_text(${quote(JSON.stringify(plan.originalVector))}::jsonb)));\n${ledgerGuard}\n${terminal};\n`;
}
function readbackExpression(query) {
  return `(SELECT CASE WHEN jsonb_typeof(value)='string' THEN (value#>>'{}')::jsonb ELSE value END FROM jsonb_each((SELECT to_jsonb(r) FROM (${query}) r)))`;
}
export function reconciliationSql(plan, migration) {
  const prior = readQuery(migration.expectedPriorState), terminal = readQuery(migration.terminalReadback);
  // One fresh read-only snapshot, one JSON result; no execution or retry.
  return `SET TRANSACTION READ ONLY; SET LOCAL statement_timeout='15s';
 SELECT json_build_object('ledger_exists',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(plan.version)}),'ledger_equal',${ledgerEqual(plan)},'prior',${readbackExpression(prior)},'terminal',${readbackExpression(terminal)})::text;`;
}
export function reconciliationOutcome(value, migration) {
  const normalize = v => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, normalize(v[k])])) : Array.isArray(v) ? v.map(normalize) : v;
  const parse = v => typeof v === 'string' ? JSON.parse(v) : v;
  try {
    const equal = (a, b) => JSON.stringify(normalize(parse(a))) === JSON.stringify(normalize(b));
    if (value.ledger_exists === true && value.ledger_equal === true && equal(value.terminal, migration.terminalReadback.expected)) return 'committed';
    if (value.ledger_exists === false && value.ledger_equal === false && equal(value.prior, migration.expectedPriorState.expected)) return 'not_applied';
    return 'partial_conflict';
  } catch { return 'unknown'; }
}

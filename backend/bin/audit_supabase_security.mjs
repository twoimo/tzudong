#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { logSafeError } from '../utils/privacy-log.mjs';

const SEVERITY_RANK = Object.freeze({ info: 0, low: 1, medium: 2, high: 3, critical: 4 });
const MAX_FINDINGS = 1_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

export const SUPABASE_SECURITY_QUERIES = Object.freeze([
  {
    code: 'PUBLIC_TABLE_RLS_DISABLED',
    severity: 'critical',
    sql: `
      SELECT namespace.nspname AS schema_name, relation.relname AS object_name,
             relation.relkind::text AS object_kind
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p')
        AND NOT relation.relrowsecurity
      ORDER BY relation.relname
    `,
  },
  {
    code: 'PUBLIC_TABLE_RLS_NOT_FORCED',
    severity: 'medium',
    sql: `
      SELECT namespace.nspname AS schema_name, relation.relname AS object_name,
             relation.relkind::text AS object_kind
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p')
        AND relation.relrowsecurity
        AND NOT relation.relforcerowsecurity
      ORDER BY relation.relname
    `,
  },
  {
    code: 'PUBLIC_DANGEROUS_TABLE_GRANT',
    severity: 'critical',
    sql: `
      SELECT grant_table.table_schema AS schema_name,
             grant_table.table_name AS object_name,
             'grant:' || grant_table.grantee || ':' || grant_table.privilege_type AS object_kind
      FROM information_schema.role_table_grants AS grant_table
      WHERE grant_table.table_schema = 'public'
        AND grant_table.grantee = 'PUBLIC'
        AND grant_table.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
      ORDER BY grant_table.table_name, grant_table.privilege_type
    `,
  },
  {
    code: 'SECURITY_DEFINER_MUTABLE_SEARCH_PATH',
    severity: 'critical',
    sql: `
      SELECT namespace.nspname AS schema_name,
             routine.proname || '(' || pg_catalog.pg_get_function_identity_arguments(routine.oid) || ')' AS object_name,
             'security_definer_function' AS object_kind
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'public'
        AND routine.prosecdef
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(COALESCE(routine.proconfig, ARRAY[]::text[])) AS setting(value)
          WHERE setting.value LIKE 'search_path=%'
        )
      ORDER BY routine.proname, pg_catalog.pg_get_function_identity_arguments(routine.oid)
    `,
  },
  {
    code: 'SECURITY_DEFINER_PUBLIC_EXECUTE',
    severity: 'critical',
    sql: `
      SELECT namespace.nspname AS schema_name,
             routine.proname || '(' || pg_catalog.pg_get_function_identity_arguments(routine.oid) || ')' AS object_name,
             'security_definer_function' AS object_kind
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'public'
        AND routine.prosecdef
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
          ) AS privilege
          WHERE privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
        )
      ORDER BY routine.proname, pg_catalog.pg_get_function_identity_arguments(routine.oid)
    `,
  },
  {
    code: 'PUBLIC_VIEW_NOT_SECURITY_INVOKER',
    severity: 'high',
    sql: `
      SELECT namespace.nspname AS schema_name, relation.relname AS object_name,
             'view' AS object_kind
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind = 'v'
        AND NOT COALESCE('security_invoker=true' = ANY(relation.reloptions), false)
      ORDER BY relation.relname
    `,
  },
  {
    code: 'PUBLIC_SENSITIVE_COLUMN',
    severity: 'high',
    sql: `
      SELECT columns.table_schema AS schema_name,
             columns.table_name || '.' || columns.column_name AS object_name,
             'column' AS object_kind
      FROM information_schema.columns AS columns
      WHERE columns.table_schema = 'public'
        AND columns.column_name ~* '(password|passwd|secret|credential|private_key|service_role|cookie|session|resident|rrn|raw_ocr|oauth_nonce|guardian_(name|contact)_ciphertext)'
      ORDER BY columns.table_name, columns.ordinal_position
    `,
  },
  {
    code: 'UNVALIDATED_CONSTRAINT',
    severity: 'high',
    sql: `
      SELECT namespace.nspname AS schema_name,
             relation.relname || '.' || constraint_record.conname AS object_name,
             'constraint:' || constraint_record.contype::text AS object_kind
      FROM pg_catalog.pg_constraint AS constraint_record
      JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_record.conrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname IN ('public', 'privacy_retention')
        AND NOT constraint_record.convalidated
      ORDER BY namespace.nspname, relation.relname, constraint_record.conname
    `,
  },
  {
    code: 'EXTENSION_IN_EXPOSED_SCHEMA',
    severity: 'medium',
    sql: `
      SELECT namespace.nspname AS schema_name, extension.extname AS object_name,
             'extension' AS object_kind
      FROM pg_catalog.pg_extension AS extension
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = extension.extnamespace
      WHERE namespace.nspname = 'public'
      ORDER BY extension.extname
    `,
  },
  {
    code: 'SENSITIVE_REALTIME_PUBLICATION',
    severity: 'high',
    sql: `
      SELECT publication.schemaname AS schema_name, publication.tablename AS object_name,
             'publication:' || publication.pubname AS object_kind
      FROM pg_catalog.pg_publication_tables AS publication
      WHERE publication.schemaname IN ('public', 'privacy_retention')
        AND publication.tablename ~* '(privacy|audit|consent|guardian|incident|deletion|retention|ocr|session|user)'
      ORDER BY publication.pubname, publication.schemaname, publication.tablename
    `,
  },
]);

function parseArgs(argv) {
  const options = { failOn: 'high', json: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--fail-on') options.failOn = argv[++index] ?? '';
    else throw new Error('SUPABASE_SECURITY_AUDIT_ARGUMENT_INVALID');
  }
  if (!(options.failOn in SEVERITY_RANK)) throw new Error('SUPABASE_SECURITY_AUDIT_FAIL_LEVEL_INVALID');
  return options;
}

function readDatabaseUrl(env = process.env) {
  const value = env.SUPABASE_DB_URL?.trim() || env.DATABASE_URL?.trim();
  if (!value) throw new Error('SUPABASE_SECURITY_AUDIT_DATABASE_URL_REQUIRED');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('SUPABASE_SECURITY_AUDIT_DATABASE_URL_INVALID');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('SUPABASE_SECURITY_AUDIT_DATABASE_URL_INVALID');
  }
  return value;
}

function normalizeFinding(query, row) {
  return Object.freeze({
    code: query.code,
    severity: query.severity,
    schema: typeof row.schema_name === 'string' ? row.schema_name : 'unknown',
    object: typeof row.object_name === 'string' ? row.object_name.slice(0, 512) : 'unknown',
    kind: typeof row.object_kind === 'string' ? row.object_kind.slice(0, 128) : 'unknown',
  });
}

export async function auditSupabaseSecurity({ databaseUrl, statementTimeoutMs = DEFAULT_STATEMENT_TIMEOUT_MS }) {
  if (!Number.isSafeInteger(statementTimeoutMs) || statementTimeoutMs < 1_000 || statementTimeoutMs > 60_000) {
    throw new Error('SUPABASE_SECURITY_AUDIT_TIMEOUT_INVALID');
  }

  const { Client } = await import('pg');
  const client = new Client({
    connectionString: databaseUrl,
    application_name: 'tzudong-supabase-security-audit',
    statement_timeout: statementTimeoutMs,
    query_timeout: statementTimeoutMs + 5_000,
  });
  const findings = [];
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`);
    await client.query("SET LOCAL lock_timeout = '2s'");
    for (const query of SUPABASE_SECURITY_QUERIES) {
      const result = await client.query(query.sql);
      for (const row of result.rows) {
        if (findings.length >= MAX_FINDINGS) throw new Error('SUPABASE_SECURITY_AUDIT_FINDING_LIMIT_EXCEEDED');
        findings.push(normalizeFinding(query, row));
      }
    }
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }

  const counts = Object.fromEntries(Object.keys(SEVERITY_RANK).map((severity) => [
    severity,
    findings.filter((finding) => finding.severity === severity).length,
  ]));
  return Object.freeze({
    schemaVersion: 1,
    status: findings.length === 0 ? 'clear' : 'findings',
    readOnly: true,
    findingCount: findings.length,
    counts,
    findings,
  });
}

async function main() {
  const options = parseArgs(process.argv);
  const report = await auditSupabaseSecurity({ databaseUrl: readDatabaseUrl() });
  const blockingCount = report.findings.filter(
    (finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[options.failOn],
  ).length;
  const output = options.json
    ? report
    : { schemaVersion: report.schemaVersion, status: report.status, readOnly: true, findingCount: report.findingCount, counts: report.counts, blockingCount };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (blockingCount > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    logSafeError(error, (line) => process.stderr.write(`[supabase-security-audit] ${line}`));
    process.exitCode = 2;
  });
}

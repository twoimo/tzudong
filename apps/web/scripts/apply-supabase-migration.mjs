#!/usr/bin/env node
/** Apply one Supabase SQL migration through direct Postgres or the Supabase Management API. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';

function parseArgs(argv) {
  const args = { migrationFile: '', name: '', verifyTable: '', dryRun: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--migration-file') args.migrationFile = argv[++i] || '';
    else if (arg === '--name') args.name = argv[++i] || '';
    else if (arg === '--verify-table') args.verifyTable = argv[++i] || '';
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/apply-supabase-migration.mjs --migration-file PATH --name NAME [--verify-table TABLE] [--dry-run] [--json]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.migrationFile) throw new Error('--migration-file is required');
  if (!args.name) throw new Error('--name is required');
  return args;
}

function envValue(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
  }
  return '';
}

function projectRefFromUrl(url) {
  if (!url) return '';
  try {
    const host = new URL(url).hostname;
    if (host.endsWith('.supabase.co')) return host.split('.')[0] || '';
  } catch {}
  return '';
}

async function restVerifyTable(table) {
  if (!table) return null;
  const supabaseUrl = envValue('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const serviceRole = envValue('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRole) return { ok: false, reason: 'missing_supabase_rest_credentials' };
  const url = new URL(`/rest/v1/${table}`, supabaseUrl);
  url.searchParams.set('select', 'id');
  url.searchParams.set('limit', '1');
  const response = await fetch(url, {
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
    },
  });
  const body = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    reason: response.ok ? 'table_visible' : body.slice(0, 500),
  };
}

function applyWithPsql(databaseUrl, query) {
  const result = spawnSync(
    'psql',
    ['--set=ON_ERROR_STOP=1', '--single-transaction', databaseUrl],
    {
      encoding: 'utf8',
      input: query,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  if (result.error) {
    throw new Error(`psql execution failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').slice(0, 1500);
    const stdout = (result.stdout || '').slice(0, 1500);
    throw new Error(`psql migration failed (${result.status}): ${stderr || stdout || 'no output'}`);
  }
  return {
    stdout: (result.stdout || '').slice(-1500),
  };
}

async function applyWithManagementApi(projectRef, accessToken, name, query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/migrations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, query }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase migration API failed (${response.status}): ${body.slice(0, 1000)}`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const query = await fs.readFile(args.migrationFile, 'utf8');
  const projectRef = envValue('SUPABASE_PROJECT_REF') || projectRefFromUrl(envValue('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'));
  const accessToken = envValue('SUPABASE_ACCESS_TOKEN');
  const databaseUrl = envValue('SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL');
  const missing = [];
  if (!args.dryRun && !databaseUrl) {
    if (!projectRef) missing.push('SUPABASE_PROJECT_REF or SUPABASE_URL');
    if (!accessToken) missing.push('SUPABASE_DB_URL or SUPABASE_ACCESS_TOKEN');
  }
  if (missing.length) throw new Error(`Missing required migration credential(s): ${missing.join(', ')}`);

  const result = {
    migration_file: args.migrationFile,
    name: args.name,
    project_ref_source: projectRef ? (envValue('SUPABASE_PROJECT_REF') ? 'SUPABASE_PROJECT_REF' : 'SUPABASE_URL') : 'unavailable',
    apply_method: databaseUrl ? 'psql' : accessToken ? 'management_api' : 'not_selected',
    dry_run: args.dryRun,
    migration_applied: false,
    verification: null,
  };

  if (!args.dryRun) {
    if (databaseUrl) applyWithPsql(databaseUrl, query);
    else await applyWithManagementApi(projectRef, accessToken, args.name, query);
    result.migration_applied = true;
  }

  result.verification = await restVerifyTable(args.verifyTable);
  if (!args.dryRun && args.verifyTable && !result.verification?.ok) {
    throw new Error(`Migration applied but table verification failed: ${result.verification?.reason || 'unknown'}`);
  }
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`Supabase migration ${args.dryRun ? 'dry-run checked' : 'applied'}: ${args.name}`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}

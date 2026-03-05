import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readSelectedDotEnv(filePath, keys) {
  if (!fs.existsSync(filePath)) return {};

  const selected = {};
  const content = fs.readFileSync(filePath, 'utf8');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx < 1) continue;

    const key = line.slice(0, eqIdx).trim();
    if (!keys.has(key)) continue;

    const value = stripQuotes(line.slice(eqIdx + 1));
    selected[key] = value;
  }

  return selected;
}

function inferProjectId() {
  const explicit =
    process.env.SUPABASE_PROJECT_ID ||
    process.env.SUPABASE_PROJECT_REF ||
    process.env.SUPABASE_PROJECT;

  if (explicit) return explicit;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url) return null;

  const match = url.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return match?.[1] || null;
}

function splitSchemas(value) {
  return value
    .split(',')
    .map((schema) => schema.trim())
    .filter(Boolean);
}

const schemas = splitSchemas(process.env.SUPABASE_SCHEMAS || 'public,auth,storage');
if (schemas.length === 0) {
  console.error('[supabase-gen-types] No schema provided (SUPABASE_SCHEMAS).');
  process.exit(1);
}

const outFile =
  process.env.SUPABASE_TYPES_OUT_FILE ||
  path.resolve(process.cwd(), 'integrations/supabase/database.types.ts');

const backendEnvKeys = new Set([
  'SUPABASE_DB_HOST',
  'SUPABASE_DB_PORT',
  'SUPABASE_DB_NAME',
  'SUPABASE_DB_USER',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_DB_SSLMODE',
]);

const backendEnvPath = path.resolve(process.cwd(), '..', '..', 'backend', '.env');
const backendEnv = readSelectedDotEnv(backendEnvPath, backendEnvKeys);

function getDbUrl() {
  const explicit = process.env.SUPABASE_DB_URL;
  if (explicit) return explicit;

  const host = process.env.SUPABASE_DB_HOST || backendEnv.SUPABASE_DB_HOST;
  const port = process.env.SUPABASE_DB_PORT || backendEnv.SUPABASE_DB_PORT || '5432';
  const name = process.env.SUPABASE_DB_NAME || backendEnv.SUPABASE_DB_NAME || 'postgres';
  const user = process.env.SUPABASE_DB_USER || backendEnv.SUPABASE_DB_USER;
  const password = process.env.SUPABASE_DB_PASSWORD || backendEnv.SUPABASE_DB_PASSWORD;
  const sslmode = process.env.SUPABASE_DB_SSLMODE || backendEnv.SUPABASE_DB_SSLMODE || 'require';

  if (!host || !user || !password) return null;

  const safeUser = encodeURIComponent(stripQuotes(user));
  const safePassword = encodeURIComponent(stripQuotes(password));
  const safeSslMode = encodeURIComponent(stripQuotes(sslmode));

  return `postgresql://${safeUser}:${safePassword}@${host}:${port}/${name}?sslmode=${safeSslMode}`;
}

function makeArgs() {
  // Prefer DB URL when access token is missing (works for remote-only workflows).
  const dbUrl = getDbUrl();
  if (!process.env.SUPABASE_ACCESS_TOKEN && dbUrl) {
    const args = ['gen', 'types', '--db-url', dbUrl, '--lang', 'typescript'];
    for (const schema of schemas) {
      args.push('--schema', schema);
    }
    return { args, mode: 'db-url' };
  }

  const projectId = inferProjectId();
  if (!projectId) {
    console.error(
      [
        '[supabase-gen-types] Missing project id.',
        'Set SUPABASE_PROJECT_ID (or SUPABASE_PROJECT_REF) or NEXT_PUBLIC_SUPABASE_URL.',
      ].join('\n'),
    );
    process.exit(1);
  }

  const args = ['gen', 'types', '--project-id', projectId, '--lang', 'typescript'];
  for (const schema of schemas) {
    args.push('--schema', schema);
  }
  return { args, mode: 'project-id' };
}

try {
  const { args } = makeArgs();
  const stdout = execFileSync('supabase', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, stdout, 'utf8');

  console.log(`[supabase-gen-types] Wrote ${outFile}`);
} catch (error) {
  const message = error?.stderr?.toString?.() || error?.message || String(error);

  if (message.includes('Access token not provided')) {
    const dbUrl = getDbUrl();
    if (dbUrl) {
      try {
        const fallbackArgs = ['gen', 'types', '--db-url', dbUrl, '--lang', 'typescript'];
        for (const schema of schemas) {
          fallbackArgs.push('--schema', schema);
        }

        const stdout = execFileSync('supabase', fallbackArgs, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, stdout, 'utf8');
        console.log(`[supabase-gen-types] Wrote ${outFile}`);
        process.exit(0);
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError?.stderr?.toString?.() ||
          fallbackError?.message ||
          String(fallbackError);

        console.error('[supabase-gen-types] Access token missing and DB URL fallback failed.');
        console.error(fallbackMessage);
        process.exit(2);
      }
    }

    console.error(
      [
        '[supabase-gen-types] Supabase access token is missing.',
        'Run: supabase login --token <YOUR_TOKEN>',
        'Or set: $env:SUPABASE_ACCESS_TOKEN="<YOUR_TOKEN>"',
        'Or set SUPABASE_DB_URL (or SUPABASE_DB_HOST/USER/PASSWORD) for DB URL generation.',
      ].join('\n'),
    );
    process.exit(2);
  }

  console.error('[supabase-gen-types] Failed to generate types.');
  console.error(message);
  process.exit(1);
}

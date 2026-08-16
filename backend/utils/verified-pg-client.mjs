import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

const MAX_DATABASE_URL_BYTES = 8 * 1024;
const MAX_CA_BYTES = 128 * 1024;
const CONNECT_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 30_000;
const STATEMENT_TIMEOUT_MS = 30_000;
const LOCK_TIMEOUT_MS = 5_000;
const URL_ENV = 'SUPABASE_DB_URL';
const PLAINTEXT_LOCAL_OPT_IN_ENV = 'SUPABASE_PG_ALLOW_PLAINTEXT_LOCAL';
const CA_PEM_ENV = 'SUPABASE_DB_CA_PEM';
const CA_FILE_ENV = 'SUPABASE_DB_CA_FILE';
const APPLICATION_NAME_RE = /^[a-z][a-z0-9-]{2,62}$/;
const DIRECT_DATABASE_HOST_RE = /^db\.[a-z0-9]{20}\.supabase\.co$/;
const POOLER_HOST_RE = /^aws-\d+-(?:[a-z]+-)+\d+\.pooler\.supabase\.com$/;

function fixedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isFixedError(error) {
  return Boolean(error && typeof error.code === 'string' && error.code.startsWith('SUPABASE_PG_'));
}

function requiredText(env, name, code) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim()) throw fixedError(code);
  return value.trim();
}

function decodeUrlComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw fixedError('SUPABASE_PG_URL_INVALID');
  }
}

function normalizeHostname(hostname) {
  return String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
}

export function isLoopbackPgHost(hostname) {
  const host = normalizeHostname(hostname);
  if (host === 'localhost' || host === '::1') return true;
  const octets = host.split('.');
  return octets.length === 4
    && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    && Number(octets[0]) === 127;
}

export function isSupabaseProductionPgHost(hostname) {
  const host = normalizeHostname(hostname);
  return DIRECT_DATABASE_HOST_RE.test(host) || POOLER_HOST_RE.test(host);
}

function parseDatabaseUrl(env) {
  const connectionString = requiredText(env, URL_ENV, 'SUPABASE_PG_URL_REQUIRED');
  if (Buffer.byteLength(connectionString, 'utf8') > MAX_DATABASE_URL_BYTES) throw fixedError('SUPABASE_PG_URL_INVALID');

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw fixedError('SUPABASE_PG_URL_INVALID');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.hash || parsed.search) {
    throw fixedError('SUPABASE_PG_URL_OVERRIDE_REJECTED');
  }

  const host = normalizeHostname(parsed.hostname);
  const databasePath = parsed.pathname.replace(/^\//, '');
  const user = decodeUrlComponent(parsed.username);
  const password = decodeUrlComponent(parsed.password);
  const database = decodeUrlComponent(databasePath);
  const port = parsed.port ? Number(parsed.port) : 5432;

  if (!host || !database || database.includes('/') || !user || !password || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw fixedError('SUPABASE_PG_URL_INVALID');
  }

  return { host, port, database, user, password };
}

function isLocalDevelopmentOrTest(env) {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  return nodeEnv === 'development' || nodeEnv === 'test';
}

function plaintextLocalOptIn(env, host) {
  const optIn = env[PLAINTEXT_LOCAL_OPT_IN_ENV] === '1';
  if (!optIn) return false;
  if (!isLocalDevelopmentOrTest(env) || !isLoopbackPgHost(host)) {
    throw fixedError('SUPABASE_PG_PLAINTEXT_FORBIDDEN');
  }
  return true;
}

function validateConnectionTarget(env, host) {
  const isLoopback = isLoopbackPgHost(host);
  if (isLoopback) {
    if (!isLocalDevelopmentOrTest(env)) throw fixedError('SUPABASE_PG_LOOPBACK_ENV_REJECTED');
    return;
  }
  if (!isSupabaseProductionPgHost(host)) throw fixedError('SUPABASE_PG_HOST_REJECTED');
}

function validateApplicationName(applicationName) {
  if (typeof applicationName !== 'string' || !APPLICATION_NAME_RE.test(applicationName)) {
    throw fixedError('SUPABASE_PG_APPLICATION_NAME_INVALID');
  }
  return applicationName;
}

function validatePem(value, code) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_CA_BYTES) throw fixedError(code);
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('PRIVATE KEY') || !trimmed.startsWith('-----BEGIN CERTIFICATE-----') || !trimmed.includes('-----END CERTIFICATE-----')) {
    throw fixedError(code);
  }
  return trimmed;
}

async function readBoundedCaFile(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw fixedError('SUPABASE_PG_CA_FILE_INVALID');

  let before;
  let handle;
  try {
    before = await fs.lstat(filePath);
    if (!before.isFile() || before.isSymbolicLink() || !Number.isSafeInteger(before.size) || before.size < 1 || before.size > MAX_CA_BYTES) {
      throw fixedError('SUPABASE_PG_CA_FILE_INVALID');
    }

    const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
    handle = await fs.open(filePath, fsConstants.O_RDONLY | noFollow);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.isSymbolicLink() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw fixedError('SUPABASE_PG_CA_FILE_INVALID');
    }

    const buffer = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) throw fixedError('SUPABASE_PG_CA_FILE_INVALID');
      offset += bytesRead;
    }
    return validatePem(buffer.toString('utf8'), 'SUPABASE_PG_CA_FILE_INVALID');
  } catch (error) {
    if (isFixedError(error)) throw error;
    throw fixedError('SUPABASE_PG_CA_FILE_INVALID');
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function loadOperatorCa(env) {
  const pem = typeof env[CA_PEM_ENV] === 'string' && env[CA_PEM_ENV].trim() ? env[CA_PEM_ENV] : '';
  const file = typeof env[CA_FILE_ENV] === 'string' && env[CA_FILE_ENV].trim() ? env[CA_FILE_ENV].trim() : '';
  if (pem && file) throw fixedError('SUPABASE_PG_CA_SOURCE_CONFLICT');
  if (pem) return validatePem(pem, 'SUPABASE_PG_CA_PEM_INVALID');
  if (file) return readBoundedCaFile(file);
  return undefined;
}

function wrapClientMethod(client, method, code) {
  const original = client[method].bind(client);
  client[method] = async (...args) => {
    try {
      return await original(...args);
    } catch {
      throw fixedError(code);
    }
  };
}

export async function buildVerifiedPgClientConfig({ applicationName, env = process.env } = {}) {
  if (typeof env !== 'object' || env === null) throw fixedError('SUPABASE_PG_ENV_INVALID');
  if (typeof env.SUPABASE_DB_SSL === 'string' && env.SUPABASE_DB_SSL.trim()) {
    throw fixedError('SUPABASE_PG_LEGACY_TLS_OVERRIDE_REJECTED');
  }

  const connection = parseDatabaseUrl(env);
  validateConnectionTarget(env, connection.host);
  const plaintext = plaintextLocalOptIn(env, connection.host);
  const ca = plaintext ? undefined : await loadOperatorCa(env);

  return {
    ...connection,
    ssl: plaintext ? false : { rejectUnauthorized: true, servername: connection.host, ...(ca ? { ca } : {}) },
    application_name: validateApplicationName(applicationName),
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    lock_timeout: LOCK_TIMEOUT_MS,
  };
}

export async function createVerifiedPgClient(options = {}) {
  const config = await buildVerifiedPgClientConfig(options);
  let client;
  try {
    const { default: pg } = await import('pg');
    client = new pg.Client(config);
  } catch {
    throw fixedError('SUPABASE_PG_CLIENT_INIT_FAILED');
  }
  wrapClientMethod(client, 'connect', 'SUPABASE_PG_CONNECT_FAILED');
  wrapClientMethod(client, 'query', 'SUPABASE_PG_QUERY_FAILED');
  wrapClientMethod(client, 'end', 'SUPABASE_PG_CLOSE_FAILED');
  return client;
}

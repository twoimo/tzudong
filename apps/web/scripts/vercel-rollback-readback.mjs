import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const TZUDONG_VERCEL_PROJECT_ID = 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl';
export const TZUDONG_VERCEL_TEAM_ID = 'team_OUj64KeLxJI3PkEbOaFZnorA';
export const TZUDONG_GITHUB_REPOSITORY = 'twoimo/tzudong';
export const TZUDONG_PRODUCTION_ALIASES = Object.freeze(['tzudong.app', 'www.tzudong.app']);

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 256 * 1024;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const IMMUTABLE_HOST = /^tzudong-[a-z0-9-]+\.vercel\.app$/;

export class RollbackReadbackError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RollbackReadbackError';
    this.code = code;
  }
}

const fail = code => {
  throw new RollbackReadbackError(code);
};

const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;

export const canonicalJsonBytes = value => Buffer.from(`${JSON.stringify(canonical(value))}\n`);

function exactKeys(value, keys) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

export function normalizeVercelRollbackExpected(expected) {
  if (!exactKeys(expected, ['deploymentId', 'deploymentUrl', 'gitRef', 'gitSha'])
    || !DEPLOYMENT_ID.test(expected.deploymentId)
    || !GIT_SHA.test(expected.gitSha)
    || expected.gitRef !== 'main') fail('ROLLBACK_READBACK_CONFIG_INVALID');

  let deploymentUrl;
  try {
    deploymentUrl = new URL(expected.deploymentUrl);
  } catch {
    fail('ROLLBACK_READBACK_CONFIG_INVALID');
  }
  if (deploymentUrl.protocol !== 'https:'
    || deploymentUrl.username
    || deploymentUrl.password
    || deploymentUrl.port
    || deploymentUrl.pathname !== '/'
    || deploymentUrl.search
    || deploymentUrl.hash
    || !IMMUTABLE_HOST.test(deploymentUrl.hostname)) fail('ROLLBACK_READBACK_CONFIG_INVALID');

  return Object.freeze({
    deploymentId: expected.deploymentId,
    deploymentUrl: deploymentUrl.href,
    deploymentHost: deploymentUrl.hostname,
    gitRef: expected.gitRef,
    gitSha: expected.gitSha,
  });
}

function parseBody(raw) {
  if (!(typeof raw === 'string' || Buffer.isBuffer(raw))) fail('ROLLBACK_READBACK_JSON_INVALID');
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (bytes.length === 0 || bytes.length > DEFAULT_MAX_BYTES) fail('ROLLBACK_READBACK_OUTPUT_INVALID');
  try {
    const body = JSON.parse(bytes.toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('ROLLBACK_READBACK_JSON_INVALID');
    return body;
  } catch (error) {
    if (error instanceof RollbackReadbackError) throw error;
    fail('ROLLBACK_READBACK_JSON_INVALID');
  }
}

function deploymentEndpoint(deploymentId) {
  return `/v13/deployments/${deploymentId}?teamId=${TZUDONG_VERCEL_TEAM_ID}`;
}

function aliasEndpoint(host) {
  return `/v4/aliases/${host}?teamId=${TZUDONG_VERCEL_TEAM_ID}`;
}

function allowedReadEndpoint(endpoint) {
  const deploymentPrefix = '/v13/deployments/';
  const deploymentSuffix = `?teamId=${TZUDONG_VERCEL_TEAM_ID}`;
  if (endpoint.startsWith(deploymentPrefix) && endpoint.endsWith(deploymentSuffix)) {
    const id = endpoint.slice(deploymentPrefix.length, -deploymentSuffix.length);
    return DEPLOYMENT_ID.test(id);
  }
  return TZUDONG_PRODUCTION_ALIASES.some(host => endpoint === aliasEndpoint(host));
}

function transportArguments(endpoint) {
  return [
    'api',
    endpoint,
    '--scope',
    TZUDONG_VERCEL_TEAM_ID,
    '--raw',
  ];
}

function validateTransportConfig({ cliPath, maxBytes, requestImpl, timeoutMs }) {
  if (typeof cliPath !== 'string' || cliPath.length === 0
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > DEFAULT_MAX_BYTES
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000
    || typeof requestImpl !== 'function') fail('ROLLBACK_READBACK_CONFIG_INVALID');
}

function validateEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || /[\r\n\0]/.test(endpoint) || !allowedReadEndpoint(endpoint)) {
    fail('ROLLBACK_READBACK_CONFIG_INVALID');
  }
}

export function createScopedVercelApiTransport({
  cliPath = process.env.VERCEL_CLI_PATH || 'vercel',
  maxBytes = DEFAULT_MAX_BYTES,
  spawnImpl = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  validateTransportConfig({ cliPath, maxBytes, requestImpl: spawnImpl, timeoutMs });

  return Object.freeze({
    request(endpoint) {
      try { validateEndpoint(endpoint); } catch (error) { return Promise.reject(error); }
      return new Promise((resolve, reject) => {
        let settled = false;
        let size = 0;
        const chunks = [];
        const finish = callback => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          callback();
        };
        let child;
        try {
          child = spawnImpl(cliPath, transportArguments(endpoint), {
            env: process.env,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          });
        } catch {
          reject(new RollbackReadbackError('ROLLBACK_READBACK_CLI_FAILED'));
          return;
        }
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          const forceKill = setTimeout(() => child.kill('SIGKILL'), 250);
          forceKill.unref?.();
          finish(() => reject(new RollbackReadbackError('ROLLBACK_READBACK_TIMEOUT')));
        }, timeoutMs);
        child.stdout.on('data', chunk => {
          if (settled) return;
          size += chunk.length;
          if (size > maxBytes) {
            child.kill('SIGTERM');
            const forceKill = setTimeout(() => child.kill('SIGKILL'), 250);
            forceKill.unref?.();
            finish(() => reject(new RollbackReadbackError('ROLLBACK_READBACK_OUTPUT_INVALID')));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        // Read and discard stderr so provider or local authentication diagnostics are never persisted.
        child.stderr.on('data', () => {});
        child.on('error', () => finish(() => reject(new RollbackReadbackError('ROLLBACK_READBACK_CLI_FAILED'))));
        child.on('close', code => finish(() => {
          if (code !== 0) reject(new RollbackReadbackError('ROLLBACK_READBACK_CLI_FAILED'));
          else resolve(Buffer.concat(chunks));
        }));
      });
    },
  });
}

export function createScopedVercelApiTransportSync({
  cliPath = process.env.VERCEL_CLI_PATH || 'vercel',
  maxBytes = DEFAULT_MAX_BYTES,
  spawnSyncImpl = spawnSync,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  validateTransportConfig({ cliPath, maxBytes, requestImpl: spawnSyncImpl, timeoutMs });

  return Object.freeze({
    request(endpoint) {
      validateEndpoint(endpoint);
      let result;
      try {
        result = spawnSyncImpl(cliPath, transportArguments(endpoint), {
          encoding: null,
          env: process.env,
          killSignal: 'SIGKILL',
          maxBuffer: maxBytes,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs,
          windowsHide: true,
        });
      } catch {
        fail('ROLLBACK_READBACK_CLI_FAILED');
      }
      const errorCode = typeof result?.error?.code === 'string' ? result.error.code : '';
      if (errorCode === 'ETIMEDOUT') fail('ROLLBACK_READBACK_TIMEOUT');
      if (errorCode === 'ENOBUFS') fail('ROLLBACK_READBACK_OUTPUT_INVALID');
      const stdout = Buffer.isBuffer(result?.stdout)
        ? result.stdout
        : typeof result?.stdout === 'string'
          ? Buffer.from(result.stdout)
          : Buffer.alloc(0);
      if (stdout.length > maxBytes) fail('ROLLBACK_READBACK_OUTPUT_INVALID');
      if (result?.status !== 0 || result?.error) fail('ROLLBACK_READBACK_CLI_FAILED');
      return stdout;
    },
  });
}

export function validateVercelRollbackIdentity({
  aliases,
  deployment,
  expected,
  observedAt,
} = {}) {
  const contract = normalizeVercelRollbackExpected(expected);
  if (!deployment || typeof deployment !== 'object' || Array.isArray(deployment)
    || !Array.isArray(aliases) || aliases.length !== TZUDONG_PRODUCTION_ALIASES.length) {
    fail('ROLLBACK_READBACK_JSON_INVALID');
  }
  const metadata = deployment.meta;
  if (deployment.id !== contract.deploymentId
    || deployment.projectId !== TZUDONG_VERCEL_PROJECT_ID
    || deployment.ownerId !== TZUDONG_VERCEL_TEAM_ID
    || deployment.url !== contract.deploymentHost
    || deployment.readyState !== 'READY'
    || deployment.target !== 'production'
    || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || metadata.githubCommitOrg !== 'twoimo'
    || metadata.githubCommitRepo !== 'tzudong'
    || metadata.githubCommitSha !== contract.gitSha
    || metadata.githubCommitRef !== contract.gitRef) {
    fail('ROLLBACK_READBACK_DEPLOYMENT_MISMATCH');
  }

  aliases.forEach((alias, index) => {
    const host = TZUDONG_PRODUCTION_ALIASES[index];
    if (!alias || typeof alias !== 'object' || Array.isArray(alias)
      || alias.alias !== host
      || alias.deploymentId !== contract.deploymentId
      || alias.projectId !== TZUDONG_VERCEL_PROJECT_ID
      || !alias.deployment || typeof alias.deployment !== 'object' || Array.isArray(alias.deployment)
      || alias.deployment.id !== contract.deploymentId) fail('ROLLBACK_READBACK_ALIAS_MISMATCH');
  });

  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    fail('ROLLBACK_READBACK_CONFIG_INVALID');
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: 'vercel-rollback-readback',
    projectId: TZUDONG_VERCEL_PROJECT_ID,
    teamId: TZUDONG_VERCEL_TEAM_ID,
    deploymentId: contract.deploymentId,
    deploymentUrl: contract.deploymentUrl,
    readyState: 'READY',
    target: 'production',
    repository: TZUDONG_GITHUB_REPOSITORY,
    gitSha: contract.gitSha,
    gitRef: contract.gitRef,
    productionAliases: [...TZUDONG_PRODUCTION_ALIASES],
    observedAt: observedAt.toISOString(),
  });
}

export async function captureVercelRollbackReadback({
  expected,
  now = () => new Date(),
  transport = createScopedVercelApiTransport(),
} = {}) {
  const contract = normalizeVercelRollbackExpected(expected);
  if (!transport || typeof transport.request !== 'function' || typeof now !== 'function') {
    fail('ROLLBACK_READBACK_CONFIG_INVALID');
  }

  let deployment;
  try {
    deployment = parseBody(await transport.request(deploymentEndpoint(contract.deploymentId)));
  } catch (error) {
    if (error instanceof RollbackReadbackError) throw error;
    fail('ROLLBACK_READBACK_CLI_FAILED');
  }
  const aliases = [];
  for (const host of TZUDONG_PRODUCTION_ALIASES) {
    let alias;
    try {
      alias = parseBody(await transport.request(aliasEndpoint(host)));
    } catch (error) {
      if (error instanceof RollbackReadbackError) throw error;
      fail('ROLLBACK_READBACK_CLI_FAILED');
    }
    aliases.push(alias);
  }
  return validateVercelRollbackIdentity({
    aliases,
    deployment,
    expected,
    observedAt: now(),
  });
}

export function captureVercelRollbackReadbackSync({
  expected,
  now = () => new Date(),
  transport = createScopedVercelApiTransportSync(),
} = {}) {
  const contract = normalizeVercelRollbackExpected(expected);
  if (!transport || typeof transport.request !== 'function' || typeof now !== 'function') {
    fail('ROLLBACK_READBACK_CONFIG_INVALID');
  }
  let deployment;
  const aliases = [];
  try {
    deployment = parseBody(transport.request(deploymentEndpoint(contract.deploymentId)));
    for (const host of TZUDONG_PRODUCTION_ALIASES) {
      aliases.push(parseBody(transport.request(aliasEndpoint(host))));
    }
  } catch (error) {
    if (error instanceof RollbackReadbackError) throw error;
    fail('ROLLBACK_READBACK_CLI_FAILED');
  }
  return validateVercelRollbackIdentity({
    aliases,
    deployment,
    expected,
    observedAt: now(),
  });
}

async function main() {
  try {
    const readback = await captureVercelRollbackReadback({
      expected: {
        deploymentId: process.env.TZUDONG_ROLLBACK_DEPLOYMENT_ID,
        deploymentUrl: process.env.TZUDONG_ROLLBACK_DEPLOYMENT_URL,
        gitRef: process.env.TZUDONG_ROLLBACK_GIT_REF,
        gitSha: process.env.TZUDONG_ROLLBACK_GIT_SHA,
      },
    });
    process.stdout.write(canonicalJsonBytes(readback));
  } catch (error) {
    const code = error instanceof RollbackReadbackError ? error.code : 'ROLLBACK_READBACK_INTERNAL';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();

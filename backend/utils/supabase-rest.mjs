import { isIP } from 'node:net';
const SUPABASE_REST_CONFIGURATION_ERROR = 'SUPABASE_REST_CONFIGURATION_INVALID';
const SUPABASE_REST_ALLOW_LOOPBACK_HTTP_ENV = 'SUPABASE_REST_ALLOW_LOOPBACK_HTTP';
const NODE_ENV = 'NODE_ENV';
const MAX_SERVICE_ROLE_KEY_LENGTH = 4_096;
const PROJECT_HOST_RE = /^[a-z0-9]{20}\.supabase\.co$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export class SupabaseRestConfigurationError extends Error {
  constructor() {
    super(SUPABASE_REST_CONFIGURATION_ERROR);
    this.name = 'SupabaseRestConfigurationError';
    this.code = SUPABASE_REST_CONFIGURATION_ERROR;
  }
}

function configurationError() {
  throw new SupabaseRestConfigurationError();
}

function environmentValue(environment, name) {
  const value = environment?.[name];
  if (typeof value !== 'string') configurationError();
  return value;
}

function isAscii(value) {
  return /^[\x00-\x7f]*$/.test(value);
}

function jwtRole(key) {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof claims?.role === 'string' ? claims.role : null;
  } catch {
    return null;
  }
}

function isObviousPublicKey(key) {
  const lowered = key.toLowerCase();
  return lowered.startsWith('sb_publishable_')
    || lowered.startsWith('sb_anon_')
    || lowered.startsWith('publishable_')
    || lowered.startsWith('anon_')
    || ['anon', 'authenticated'].includes(jwtRole(key));
}

function validateServiceRoleKey(environment) {
  const key = environmentValue(environment, 'SUPABASE_SERVICE_ROLE_KEY');
  if (
    !key
    || key !== key.trim()
    || /\s/.test(key)
    || key.length > MAX_SERVICE_ROLE_KEY_LENGTH
    || !isAscii(key)
    || CONTROL_CHARACTERS.test(key)
    || isObviousPublicKey(key)
  ) {
    configurationError();
  }
  return key;
}

function validateUrlText(url) {
  if (
    !url
    || url !== url.trim()
    || !isAscii(url)
    || CONTROL_CHARACTERS.test(url)
    || url.includes('?')
    || url.includes('#')
  ) {
    configurationError();
  }
}

function productionUrl(url) {
  const match = /^https:\/\/([a-z0-9]{20}\.supabase\.co)\/?$/.exec(url);
  if (!match || !PROJECT_HOST_RE.test(match[1])) return null;
  return `https://${match[1]}`;
}

function loopbackHttpIsExplicitlyAllowed(environment) {
  return environment?.[SUPABASE_REST_ALLOW_LOOPBACK_HTTP_ENV] === '1'
    && ['development', 'test'].includes(environment?.[NODE_ENV]);
}

function loopbackUrl(url) {
  const match = /^http:\/\/(\[[^\]]+\]|[^/:]+)(?::([0-9]+))?\/?$/.exec(url);
  if (!match) return null;

  const [, rawHost, rawPort] = match;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    return null;
  }

  const port = rawPort === undefined ? 80 : Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return null;

  let renderedHost;
  if (rawHost.startsWith('[') && rawHost.endsWith(']')) {
    const host = rawHost.slice(1, -1);
    if (isIP(host) !== 6 || parsed.hostname.replace(/^\[|\]$/g, '') !== '::1') return null;
    renderedHost = '[::1]';
  } else {
    if (isIP(rawHost) !== 4 || rawHost !== '127.0.0.1') return null;
    const octets = rawHost.split('.').map(Number);
    if (octets.some((octet) => octet > 255) || parsed.hostname !== rawHost) return null;
    renderedHost = rawHost;
  }

  return `http://${renderedHost}${port === 80 ? '' : `:${port}`}`;
}

export function resolvePrivilegedSupabaseRestCredentials(environment = process.env) {
  const url = environmentValue(environment, 'SUPABASE_URL');
  const serviceRoleKey = validateServiceRoleKey(environment);
  validateUrlText(url);

  const canonicalUrl = productionUrl(url)
    || (loopbackHttpIsExplicitlyAllowed(environment) ? loopbackUrl(url) : null);
  if (!canonicalUrl) configurationError();
  return Object.freeze({ url: canonicalUrl, serviceRoleKey });
}

export {
  MAX_SERVICE_ROLE_KEY_LENGTH,
  NODE_ENV,
  SUPABASE_REST_ALLOW_LOOPBACK_HTTP_ENV,
  SUPABASE_REST_CONFIGURATION_ERROR,
};

const DEFAULT_PRODUCTION_REDIRECT_ORIGIN = 'https://www.tzudong.app';

type AuthCallbackOriginEnv = Partial<Pick<
  NodeJS.ProcessEnv,
  'NEXT_PUBLIC_SITE_URL' | 'NODE_ENV' | 'VERCEL_ENV' | 'VERCEL_URL' | 'VERCEL_BRANCH_URL'
>>;

function isValidHostnameLabel(label: string) {
  return label.length >= 1
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label);
}

function parseVercelSystemHost(value: string | undefined) {
  const host = value?.trim();
  if (!host || host.length > 253) return null;

  const labels = host.split('.');
  if (
    labels.length < 3
    || labels.at(-2)?.toLowerCase() !== 'vercel'
    || labels.at(-1)?.toLowerCase() !== 'app'
    || labels.some((label) => !isValidHostnameLabel(label))
  ) {
    return null;
  }

  return `https://${host.toLowerCase()}`;
}

function parseExactHttpsOrigin(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.port
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function getTrustedVercelPreviewOrigins(env: AuthCallbackOriginEnv) {
  if (env.VERCEL_ENV !== 'preview') return [];

  return [...new Set([
    parseVercelSystemHost(env.VERCEL_URL),
    parseVercelSystemHost(env.VERCEL_BRANCH_URL),
  ].filter((origin): origin is string => origin !== null))];
}

export function getTrustedAuthCallbackOrigin(
  requestOrigin: string,
  env: AuthCallbackOriginEnv = process.env,
) {
  const previewOrigins = getTrustedVercelPreviewOrigins(env);
  if (previewOrigins.length > 0) {
    const candidate = parseExactHttpsOrigin(requestOrigin);
    if (candidate && previewOrigins.includes(candidate)) return candidate;
    return previewOrigins[0];
  }

  const configuredSiteUrl = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredSiteUrl) {
    if (env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production') {
      return parseExactHttpsOrigin(configuredSiteUrl) ?? DEFAULT_PRODUCTION_REDIRECT_ORIGIN;
    }
    try {
      return new URL(configuredSiteUrl).origin;
    } catch {
      return DEFAULT_PRODUCTION_REDIRECT_ORIGIN;
    }
  }

  if (env.NODE_ENV !== 'production') {
    try {
      return new URL(requestOrigin).origin;
    } catch {
      return DEFAULT_PRODUCTION_REDIRECT_ORIGIN;
    }
  }

  return DEFAULT_PRODUCTION_REDIRECT_ORIGIN;
}

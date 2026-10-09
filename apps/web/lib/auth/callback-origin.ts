const DEFAULT_PRODUCTION_REDIRECT_ORIGIN = 'https://www.tzudong.app';

type AuthCallbackOriginEnv = Partial<Pick<
  NodeJS.ProcessEnv,
  'NEXT_PUBLIC_SITE_URL' | 'NODE_ENV' | 'VERCEL_ENV' | 'VERCEL_URL'
>>;

function isValidHostnameLabel(label: string) {
  return label.length >= 1
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label);
}

function getVercelPreviewOrigin(env: AuthCallbackOriginEnv) {
  if (env.VERCEL_ENV !== 'preview') return null;

  const deploymentHost = env.VERCEL_URL?.trim();
  if (!deploymentHost || deploymentHost.length > 253) return null;

  const labels = deploymentHost.split('.');
  if (
    labels.length < 3
    || labels.at(-2)?.toLowerCase() !== 'vercel'
    || labels.at(-1)?.toLowerCase() !== 'app'
    || labels.some((label) => !isValidHostnameLabel(label))
  ) {
    return null;
  }

  return `https://${deploymentHost.toLowerCase()}`;
}

export function getTrustedAuthCallbackOrigin(
  requestOrigin: string,
  env: AuthCallbackOriginEnv = process.env,
) {
  const previewOrigin = getVercelPreviewOrigin(env);
  if (previewOrigin) return previewOrigin;

  const configuredSiteUrl = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredSiteUrl) {
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

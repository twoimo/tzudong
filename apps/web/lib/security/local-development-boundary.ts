function localOrigin(raw: string | undefined) {
  try {
    const url = new URL(raw ?? '');
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && Number(url.port) >= 1024 && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash ? url : null;
  } catch { return null; }
}

/** Private markers/URLs are populated only after dev startup validates stack provenance. */
export function isBoundLocalDevelopmentRequest(request: Request, env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== 'development' || env.TZUDONG_LOCAL_SUPABASE_DEV !== '1'
      || !env.LOCAL_SUPABASE_STATE_ROOT) return false;
  const database = localOrigin(env.SUPABASE_URL);
  const publicDatabase = localOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  const app = localOrigin(env.NEXT_PUBLIC_SITE_URL);
  const origin = localOrigin(new URL(request.url).origin);
  return Boolean(database && publicDatabase && database.origin === publicDatabase.origin
    && app && origin && app.port === origin.port && ['3000', '8080', '18080'].includes(origin.port));
}

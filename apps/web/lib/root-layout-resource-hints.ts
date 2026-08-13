export type RootLayoutResourceHintPolicy = {
  emitHostedResourceHints: boolean;
  supabasePreconnectUrl?: string;
};

const LOOPBACK_HOSTNAMES = new Set([
  '127.0.0.1',
  '::1',
  '[::1]',
  'localhost',
]);

function parseHttpUrl(raw: string | undefined): URL | undefined {
  const candidate = raw?.trim();
  if (!candidate) return undefined;

  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

export function resolveRootLayoutResourceHintPolicy({
  localRuntime,
  supabaseUrl,
}: {
  localRuntime: string | undefined;
  supabaseUrl: string | undefined;
}): RootLayoutResourceHintPolicy {
  const strictLocalRuntime = localRuntime === '1';
  const parsedSupabaseUrl = parseHttpUrl(supabaseUrl);
  const supabasePreconnectUrl = parsedSupabaseUrl
    && (!strictLocalRuntime || LOOPBACK_HOSTNAMES.has(parsedSupabaseUrl.hostname))
    ? supabaseUrl?.trim()
    : undefined;

  return {
    emitHostedResourceHints: !strictLocalRuntime,
    ...(supabasePreconnectUrl ? { supabasePreconnectUrl } : {}),
  };
}

// server-only: privileged Storage access must never be imported by browser components.
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

if (typeof window !== 'undefined') throw new Error('Supabase storage server client is server-only.');

const CACHE_TTL_MS = 5 * 60 * 1000;
type StorageClient = SupabaseClient<Database>['storage'];
type CacheEntry<T> = { expiresAt: number; value: T } | null;
let storageServerClientCache: CacheEntry<StorageClient> = null;

function isExactLoopbackStorageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:'
      && parsed.hostname === '127.0.0.1'
      && Boolean(parsed.port)
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

type StorageServerEnvironment = Record<string, string | undefined>;

function resolveStorageServerConfiguration(environment: StorageServerEnvironment) {
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) throw new Error('Supabase storage server environment is missing.');

  const localMarker = environment.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME?.trim();
  if (localMarker && localMarker !== '1') {
    throw new Error('Supabase storage server environment is invalid.');
  }
  const strictLocal = localMarker === '1';
  if (strictLocal !== isExactLoopbackStorageUrl(supabaseUrl)) {
    throw new Error('Supabase storage server environment is invalid.');
  }

  const storageServerKey = strictLocal
    ? environment.SUPABASE_STORAGE_SERVER_KEY?.trim()
    : environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!storageServerKey) throw new Error('Supabase storage server environment is missing.');
  return { strictLocal, supabaseUrl, storageServerKey };
}

export function createSupabaseStorageServerClient(): StorageClient {
  if (storageServerClientCache && storageServerClientCache.expiresAt > Date.now()) return storageServerClientCache.value;
  const { supabaseUrl, storageServerKey } = resolveStorageServerConfiguration(process.env);
  const storage = createClient<Database>(supabaseUrl, storageServerKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage;
  storageServerClientCache = { expiresAt: Date.now() + CACHE_TTL_MS, value: storage };
  return storage;
}

export const __storageServerForTests = { resolveStorageServerConfiguration };

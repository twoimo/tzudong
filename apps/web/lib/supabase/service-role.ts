// server-only: this service-role client must never be imported by browser components.
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

if (typeof window !== 'undefined') {
  throw new Error('Supabase service-role client is server-only.');
}

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
} | null;

let supabaseAdminClientCache: CacheEntry<SupabaseClient<Database>> = null;

export function createSupabaseServiceRoleClient(): SupabaseClient<Database> {
  if (supabaseAdminClientCache && supabaseAdminClientCache.expiresAt > Date.now()) {
    return supabaseAdminClientCache.value;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Supabase environment variables are missing (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).');
  }

  const client = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        'X-Client-Info': 'tzudong-service-role',
      },
    },
  });

  supabaseAdminClientCache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: client,
  };

  return client;
}

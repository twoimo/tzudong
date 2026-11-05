import { createClient, type SupabaseClient, type UserAttributes } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { getSupabaseBrowserClient } from '@/integrations/supabase/client';
import { captureBrowserLogout } from './browser-logout';

// Reauthentication and account maintenance must not publish a login or invoke
// SDK error cleanup against the application's shared cookie storage.
export function createMemoryAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) throw new Error('AUTH_ACCOUNT_UNAVAILABLE');
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function withBrowserAccount<T>(userId: string | undefined, action: (client: SupabaseClient<Database>) => Promise<T>) {
  const owner = captureBrowserLogout();
  const { data: { session }, error } = await getSupabaseBrowserClient().auth.getSession();
  if (error || !session || (userId && session.user.id !== userId) || !owner.isCurrent()) {
    throw new Error('AUTH_ACCOUNT_SUPERSEDED');
  }
  const client = createMemoryAuthClient();
  try {
    const initialized = await client.auth.setSession(session);
    if (initialized.error || !owner.isCurrent()) throw new Error('AUTH_ACCOUNT_SUPERSEDED');
    const result = await action(client);
    if (!owner.isCurrent()) throw new Error('AUTH_ACCOUNT_SUPERSEDED');
    return result;
  } finally { await client.auth.dispose(); }
}

export function readCurrentBrowserAuthUser() {
  return withBrowserAccount(undefined, client => client.auth.getUser());
}

export function updateCurrentBrowserAuthUser(userId: string, attributes: UserAttributes) {
  if (!userId) throw new Error('AUTH_ACCOUNT_REQUIRED');
  return withBrowserAccount(userId, client => client.auth.updateUser(attributes));
}

export async function reauthenticateBrowserAccount(input: { userId: string; email: string; password: string }) {
  const owner = captureBrowserLogout();
  const { data: { session: current }, error } = await getSupabaseBrowserClient().auth.getSession();
  if (error || current?.user.id !== input.userId || !owner.isCurrent()) throw new Error('AUTH_ACCOUNT_SUPERSEDED');
  const client = createMemoryAuthClient();
  let token: string | null = null;
  let disposed = false;
  let disposal: Promise<boolean> | null = null;
  const dispose = () => {
    if (disposal) return disposal;
    disposed = true;
    const capturedToken = token;
    token = null;
    disposal = (async () => {
      try { return !capturedToken || !(await client.auth.admin.signOut(capturedToken, 'local')).error; }
      catch { return false; }
      finally { await client.auth.dispose(); }
    })();
    return disposal;
  };
  try {
    const result = await client.auth.signInWithPassword({ email: input.email, password: input.password });
    token = result.data.session?.access_token ?? null;
    if (result.error || !token || result.data.user?.id !== input.userId || !owner.isCurrent()) {
      throw new Error('AUTH_REAUTHENTICATION_FAILED');
    }
    return {
      client, bearerToken: token, dispose,
      isCurrent: () => !disposed && owner.isCurrent(),
      clearBrowserSession: () => owner.clearIfCurrent(() => !disposed && owner.isCurrent()),
    };
  } catch {
    await dispose();
    throw new Error('AUTH_REAUTHENTICATION_FAILED');
  }
}

export async function changeBrowserAccountPassword(input: { userId: string; email: string; password: string; newPassword: string }) {
  const reauthenticated = await reauthenticateBrowserAccount(input);
  let revoked = false;
  try {
    if (!reauthenticated.isCurrent()) throw new Error('AUTH_ACCOUNT_SUPERSEDED');
    const result = await reauthenticated.client.auth.updateUser({ password: input.newPassword });
    if (result.error || !reauthenticated.isCurrent()) throw new Error('AUTH_PASSWORD_UPDATE_FAILED');
  } finally { revoked = await reauthenticated.dispose(); }
  if (!revoked) throw new Error('AUTH_ISOLATED_SESSION_CLEANUP_FAILED');
}

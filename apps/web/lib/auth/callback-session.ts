import { createClient } from '@/lib/supabase/server';
import { getCurrentPrivacyEligibility, hasLivePrivacyEligibilityReceipt } from '@/lib/privacy/eligibility';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function createCallbackSupabaseClient() {
  return createClient();
}

export async function hasEligibleOrdinaryOAuthSession(
  supabase: Awaited<ReturnType<typeof createCallbackSupabaseClient>>,
  code: string,
) {
  try {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) return false;

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user?.id || !UUID_PATTERN.test(user.id)) return false;

    const eligibility = await getCurrentPrivacyEligibility(supabase);
    return hasLivePrivacyEligibilityReceipt(eligibility);
  } catch {
    return false;
  }
}

type CallbackAuthClient = {
  auth: {
    signOut: (args: { scope: 'global' | 'local' }) => Promise<unknown>;
  };
};

export async function revokeRejectedCallbackSession(supabase: CallbackAuthClient) {
  try {
    await supabase.auth.signOut({ scope: 'global' });
  } catch {
    // A rejected callback must still attempt local cookie cleanup.
  }

  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // The rejection redirect clears onboarding and browser auth cookies.
  }
}

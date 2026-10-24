import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { dispatchHomeAuthSessionUpdated } from '@/lib/home-auth-events';
import { signOutRejectedPrivacySession } from '@/lib/privacy/eligibility';

export async function rejectPrivacyIneligibleBrowserSession(
  client: SupabaseClient<Database>,
  userId?: string | null,
) {
  let signedOut = false;
  try {
    signedOut = await signOutRejectedPrivacySession(client);
  } catch {
    // Keep the home session provider mounted when cleanup cannot be verified.
  }

  if (signedOut) {
    dispatchHomeAuthSessionUpdated({
      hasSession: false,
      source: 'auth-modal-rejected-login',
    });
  }

  if (userId) {
    try {
      const { clearBrowserDraftsForUser } = await import('@/lib/privacy/browser-draft-cleanup');
      await clearBrowserDraftsForUser(userId);
    } catch {
      // Browser drafts must not cause a rejected login to publish success.
    }
  }

  return signedOut;
}

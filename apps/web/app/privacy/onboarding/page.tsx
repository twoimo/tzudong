import { redirect } from 'next/navigation';

import { buildHomePrivacyOnboardingPath } from '@/lib/auth/auth-redirect';

export default function PrivacyOnboardingPage() {
  redirect(buildHomePrivacyOnboardingPath());
}

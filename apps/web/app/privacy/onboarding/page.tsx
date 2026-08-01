'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import AuthModal from '@/components/auth/AuthModal';

export default function PrivacyOnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasQuery = (searchParams?.toString().length ?? 0) > 0;

  useEffect(() => {
    if (hasQuery) router.replace('/');
  }, [hasQuery, router]);

  if (hasQuery) return null;

  return (
    <main className="min-h-screen bg-background">
      <AuthModal
        isOpen
        onClose={() => router.replace('/')}
        initialAuthTab="signup"
      />
    </main>
  );
}

'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import FeedContent from '@/components/feed/FeedContent';
import { BREAKPOINTS } from '@/hooks/useDeviceType';
import AuthModal from '@/components/auth/AuthModal';

function FeedPageContent() {
    const router = useRouter();
    const [isMounted, setIsMounted] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

    useEffect(() => {
        setIsMounted(true);

        const redirectIfDesktop = () => {
            if (window.innerWidth > BREAKPOINTS.tabletMax) {
                router.replace('/');
            }
        };

        redirectIfDesktop();
        window.addEventListener('resize', redirectIfDesktop, { passive: true });

        return () => {
            window.removeEventListener('resize', redirectIfDesktop);
        };
    }, [router]);

    // Mount 전에는 아무것도 렌더링하지 않음 (Hydration Mismatch 방지)
    if (!isMounted) return null;
    if (typeof window !== 'undefined' && window.innerWidth > BREAKPOINTS.tabletMax) return null;

    return (
        <div className="h-full w-full bg-background overflow-hidden" data-testid="feed-page-container">
            <FeedContent
                variant="page"
                onOpenAuth={() => setIsAuthModalOpen(true)}
            />
            {isAuthModalOpen && (
                <AuthModal
                    isOpen={isAuthModalOpen}
                    onClose={() => setIsAuthModalOpen(false)}
                />
            )}
        </div>
    );
}

export default function FeedPage() {
    return (
        <Suspense fallback={<div className="h-screen w-full flex items-center justify-center">Loading...</div>}>
            <FeedPageContent />
        </Suspense>
    );
}

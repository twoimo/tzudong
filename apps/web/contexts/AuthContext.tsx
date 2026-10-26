'use client';
import { BROWSER_DRAFT_AUTHORITY_KEY, activateBrowserDraftOwner, beginBrowserDraftCleanup, canResumeBrowserDraftOwner, captureBrowserDraftEpoch, isBrowserDraftEpochCurrent, isBrowserDraftOwnerActive, readBrowserDraftAuthority } from "@/lib/privacy/browser-draft-lifecycle";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { AuthContext, type AuthContextType } from "@/contexts/AuthContextBase";
import { dispatchHomeAuthSessionUpdated, HOME_AUTH_SESSION_UPDATED_EVENT, type HomeAuthSessionUpdatedDetail } from "@/lib/home-auth-events";
import { isExistingAccountPrivacyRecoveryActive } from "@/lib/auth/existing-account-recovery";
import { isHomePrivacyOnboardingRequest } from "@/lib/auth/auth-redirect";
import { DEBUG_LOG_EVENT, DEBUG_LOG_REASON_CODE, debugLog } from "@/lib/debug-log";
import { recordPasswordRecoveryProof } from "@/lib/auth/password-recovery-proof";
import { captureBrowserLogout } from "@/lib/auth/browser-logout";
import { updateCurrentBrowserAuthUser } from "@/lib/auth/isolated-browser-account";
import { requestBrowserPasswordRecovery } from "@/lib/auth/isolated-browser-pkce";
import { AuthLogoutSupersededError } from "@/lib/auth/logout-result";
import {
    getCurrentPrivacyEligibility,
    hasLivePrivacyEligibilityReceipt,
    signOutRejectedPrivacySession,
} from "@/lib/privacy/eligibility";
import { hasSupabaseAuthSessionHint } from "@/lib/supabase-auth-session-hints";
import {
    isPublicProfileInvalidSessionError,
    readPublicProfileSummaries,
} from "@/lib/public-profile-read";

export { AnonymousHomeAuthProvider, useAuth } from "@/contexts/AuthContextBase";

type SupabaseClient = typeof import("@/integrations/supabase/client").supabase;

let supabaseClientPromise: Promise<SupabaseClient> | null = null;

function getSupabaseClient(): Promise<SupabaseClient> {
    supabaseClientPromise ??= import("@/integrations/supabase/client").then((mod) => mod.supabase);
    return supabaseClientPromise;
}

const HOME_AUTH_BOOTSTRAP_DELAY_MS = 30000;
const HOME_AUTH_BOOTSTRAP_EVENTS = ['pointerdown', 'keydown'] as const;

function shouldDelayAuthBootstrap() {
    return (
        typeof window !== 'undefined'
        && window.location.pathname === '/'
        && !window.location.search
        && !window.location.hash
        && !hasPersistedSupabaseSessionHint()
    );
}

function hasPersistedSupabaseSessionHint() {
    return hasSupabaseAuthSessionHint();
}

function shouldBootstrapAuthOnGeneralInteraction() {
    if (typeof window === 'undefined') return false;
    if (hasPersistedSupabaseSessionHint()) return true;

    return window.matchMedia('(min-width: 1024px)').matches;
}

function isLiteralLoopSafePrivacyOnboarding() {
    if (typeof window === 'undefined' || window.location.hash) return false;

    return (
        window.location.pathname === '/privacy/onboarding'
        && !window.location.search
    ) || isHomePrivacyOnboardingRequest(window.location);
}
function isLiteralPasswordRecoveryRoute() {
    return typeof window !== 'undefined'
        && window.location.pathname === '/auth/reset-password';
}

const isRefreshTokenNotFoundError = (error: unknown) => {
    if (!error || typeof error !== 'object') return false;

    const code = 'code' in error ? String(error.code) : '';
    if (code === 'refresh_token_not_found') return true;

    const message = 'message' in error ? String(error.message).toLowerCase() : '';
    return message.includes('invalid refresh token') || message.includes('refresh token not found');
};

const isExpiredJwtError = (error: unknown) => {
    if (!error || typeof error !== 'object') return false;

    const code = 'code' in error ? String(error.code) : '';
    if (code === 'PGRST303') return true;

    const message = 'message' in error ? String(error.message).toLowerCase() : '';
    return message.includes('jwt expired') || message.includes('invalid jwt');
};

const isAuthSessionInvalidError = (error: unknown) => {
    return isRefreshTokenNotFoundError(error)
        || isExpiredJwtError(error)
        || isPublicProfileInvalidSessionError(error);
};

const isSessionExpired = (currentSession: Session | null) => {
    if (!currentSession?.expires_at) return false;
    return currentSession.expires_at * 1000 <= Date.now();
};

const PASSWORD_SIGN_IN_ERROR = 'AUTH_PASSWORD_SIGN_IN_FAILED';

type AuthUserState = {
    isEligible: boolean;
    isAdmin: boolean;
    needsNicknameSetup: boolean;
    profileNickname: string | null;
};

const INELIGIBLE_AUTH_USER_STATE: AuthUserState = {
    isEligible: false,
    isAdmin: false,
    needsNicknameSetup: false,
    profileNickname: null,
};

async function fetchAuthUserState(userId: string): Promise<AuthUserState> {
    const supabase = await getSupabaseClient();
    const eligibility = await getCurrentPrivacyEligibility(supabase);
    if (!hasLivePrivacyEligibilityReceipt(eligibility)) {
        return INELIGIBLE_AUTH_USER_STATE;
    }

    const [roleResponse, profileResponse] = await Promise.all([
        supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", userId)
            .eq("role", "admin")
            .maybeSingle(),
        readPublicProfileSummaries(supabase, [userId])
            .then((profiles) => ({ data: profiles[0] ?? null, error: null }))
            .catch((error: unknown) => ({ data: null, error })),
    ]);

    if (roleResponse.error && isAuthSessionInvalidError(roleResponse.error)) {
        throw roleResponse.error;
    }
    if (profileResponse.error && isAuthSessionInvalidError(profileResponse.error)) {
        throw profileResponse.error;
    }

    if (profileResponse.error) {
        debugLog(DEBUG_LOG_EVENT.AUTH_PROFILE_LOOKUP_FAILED, {
            reason: DEBUG_LOG_REASON_CODE.AUTH_PROFILE_LOOKUP_FAILED,
        });
    }

    const profileData = profileResponse.data;
    const nickname = profileData?.nickname;
    return {
        isEligible: true,
        isAdmin: !roleResponse.error && Boolean(roleResponse.data),
        needsNicknameSetup: profileResponse.error ? false : !profileData || nickname === "탈퇴한 사용자",
        profileNickname: typeof nickname === "string" && nickname.trim().length > 0 ? nickname.trim() : null,
    };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);
    const [needsNicknameSetup, setNeedsNicknameSetup] = useState(false);
    const [profileNickname, setProfileNickname] = useState<string | null>(null);
    const documentLifecycleRef = useRef({ active: true, revision: 0 });
    const activeAuthUserIdRef = useRef<string | null>(null);
    const pendingAuthUserIdRef = useRef<string | null>(null);
    const authEventGenerationRef = useRef(0);
    const publishedAuthGenerationRef = useRef(0);
    const publishedAccessTokenRef = useRef<string | null>(null);

    const clearPrivateDrafts = useCallback(async (userId: string | null) => {
        if (!userId || !documentLifecycleRef.current.active) return false;

        const epoch = beginBrowserDraftCleanup(userId);
        try {
            const { clearBrowserDraftsForUser } = await import("@/lib/privacy/browser-draft-cleanup");
            const readback = await clearBrowserDraftsForUser(userId, epoch);
            return Object.values(readback).every(Boolean);
        } catch {
            // Session state still clears; local draft access stays blocked.
            return false;
        }
    }, []);

    const clearPublishedAuthState = useCallback((source: string, generation?: number) => {
        if (generation !== undefined && authEventGenerationRef.current !== generation) return;
        activeAuthUserIdRef.current = null;
        pendingAuthUserIdRef.current = null;
        setSession(null);
        publishedAccessTokenRef.current = null;
        setUser(null);
        setIsAdmin(false);
        setNeedsNicknameSetup(false);
        setProfileNickname(null);
        setIsLoading(false);
        dispatchHomeAuthSessionUpdated({ hasSession: false, source });
    }, []);

    const clearStaleSession = useCallback(async (userId: string | undefined, generation: number) => {
        const expectedGeneration = generation;
        const isCurrentGeneration = () => documentLifecycleRef.current.active && authEventGenerationRef.current === expectedGeneration;
        if (!isCurrentGeneration()) return;
        let cookieOwner: ReturnType<typeof captureBrowserLogout>;
        try {
            cookieOwner = captureBrowserLogout();
        } catch {
            // Cookie access failure must not adopt a later session for cleanup.
            // Block this owner's drafts and publication without deleting cookies.
            const rejectedUserId = userId ?? pendingAuthUserIdRef.current ?? activeAuthUserIdRef.current;
            await clearPrivateDrafts(rejectedUserId);
            if (isCurrentGeneration()) clearPublishedAuthState('auth-clear-stale-session', generation);
            return;
        }
        const ownsRequest = () => isCurrentGeneration() && cookieOwner.isCurrent();
        if (!ownsRequest()) return;

        const signedOutUserId = userId ?? pendingAuthUserIdRef.current ?? activeAuthUserIdRef.current;
        await clearPrivateDrafts(signedOutUserId);
        if (!isCurrentGeneration()) return;

        try {
            const supabase = await getSupabaseClient();
            if (!ownsRequest()) return;
            const cleared = await signOutRejectedPrivacySession(supabase, {
                userId: signedOutUserId ?? undefined,
                isCurrent: isCurrentGeneration,
                browserLogout: cookieOwner,
                scope: 'local',
            });
            if (!cleared && !ownsRequest()) return;
        } catch {
            // The local React state below must be cleared even when the client cannot be loaded.
        }

        if (isCurrentGeneration()) {
            clearPublishedAuthState('auth-clear-stale-session', generation);
        }
    }, [clearPrivateDrafts, clearPublishedAuthState]);

    const publishEligibleSession = useCallback(async (
        nextSession: Session,
        generation: number,
        allowPasswordRecovery = false,
        allowDraftActivation = true,
    ) => {
        if (!documentLifecycleRef.current.active) return;
        const documentRevision = documentLifecycleRef.current.revision;
        const authority = readBrowserDraftAuthority();
        const userId = nextSession.user?.id;
        if (!userId) {
            await clearStaleSession(undefined, generation);
            return;
        }

        pendingAuthUserIdRef.current = userId;
        try {
            const state = await fetchAuthUserState(userId);
            if (!documentLifecycleRef.current.active || documentLifecycleRef.current.revision !== documentRevision || authEventGenerationRef.current !== generation) return;
            if (!state.isEligible) {
                if (
                    isExistingAccountPrivacyRecoveryActive(nextSession.user.email)
                    || isLiteralLoopSafePrivacyOnboarding()
                    || (allowPasswordRecovery && isLiteralPasswordRecoveryRoute())
                ) {
                    pendingAuthUserIdRef.current = null;
                    setIsLoading(false);
                    return;
                }
                await clearStaleSession(userId, generation);
                return;
            }

            // Eligibility can finish after another tab changed accounts. Re-read
            // the SDK session outside its auth callback before publishing anything.
            const supabase = await getSupabaseClient();
            const { data: { session: currentSession }, error } = await supabase.auth.getSession();
            if (!documentLifecycleRef.current.active || documentLifecycleRef.current.revision !== documentRevision || authEventGenerationRef.current !== generation || readBrowserDraftAuthority() !== authority) return;
            if (error || currentSession?.user?.id !== userId) {
                clearPublishedAuthState('auth-session-replaced', generation);
                return;
            }
            // Focus/pageshow cannot turn a logout marker back into a login while
            // the originating tab is still completing signOut.
            if (!allowDraftActivation && !canResumeBrowserDraftOwner(userId)) {
                clearPublishedAuthState('auth-drafts-revoked', generation);
                return;
            }

            // A quick re-login may finish before an older lazy cleanup. Clear
            // the blocked epoch ourselves, then invalidate older cleanups when
            // activating. A failed readback keeps local draft access closed.
            const draftsReady = isBrowserDraftOwnerActive(userId) || await clearPrivateDrafts(userId);
            if (!documentLifecycleRef.current.active || documentLifecycleRef.current.revision !== documentRevision || authEventGenerationRef.current !== generation) return;
            if (draftsReady) activateBrowserDraftOwner(userId);
            publishedAuthGenerationRef.current = generation;
            activeAuthUserIdRef.current = userId;
            pendingAuthUserIdRef.current = null;
            setSession(nextSession);
            publishedAccessTokenRef.current = nextSession.access_token;
            setUser(nextSession.user);
            setIsAdmin(state.isAdmin);
            setNeedsNicknameSetup(state.needsNicknameSetup);
            setProfileNickname(state.profileNickname);
            setIsLoading(false);
            dispatchHomeAuthSessionUpdated({ hasSession: true, source: 'auth-eligible-session' });
        } catch {
            if (!documentLifecycleRef.current.active || documentLifecycleRef.current.revision !== documentRevision || authEventGenerationRef.current !== generation) return;
            debugLog(DEBUG_LOG_EVENT.AUTH_USER_STATE_LOAD_FAILED, {
                reason: DEBUG_LOG_REASON_CODE.AUTH_USER_STATE_LOAD_FAILED,
            });
            await clearStaleSession(userId, generation);
        }
    }, [clearPrivateDrafts, clearPublishedAuthState, clearStaleSession]);

    const refreshPublishedAuthUserState = useCallback(async (userId: string) => {
        const generation = authEventGenerationRef.current;
        const isCurrent = () => authEventGenerationRef.current === generation && activeAuthUserIdRef.current === userId;
        try {
            const state = await fetchAuthUserState(userId);
            if (!isCurrent()) return;
            if (!state.isEligible) {
                await clearStaleSession(userId, generation);
                return;
            }
            setIsAdmin(state.isAdmin);
            setNeedsNicknameSetup(state.needsNicknameSetup);
            setProfileNickname(state.profileNickname);
        } catch {
            if (!isCurrent()) return;
            debugLog(DEBUG_LOG_EVENT.AUTH_USER_STATE_LOAD_FAILED, {
                reason: DEBUG_LOG_REASON_CODE.AUTH_USER_STATE_LOAD_FAILED,
            });
            await clearStaleSession(userId, generation);
        }
    }, [clearStaleSession]);

    useEffect(() => {
        const documentLifecycle = documentLifecycleRef.current;
        documentLifecycle.active = true;
        if (window.location.pathname === '/auth/complete') {
            // The callback document owns one guarded session publication. Do
            // not reject/clean the previous session while it is completing.
            // Full navigation resumes the normal eligibility/bootstrap checks.
            setIsLoading(false);
            return () => { documentLifecycle.active = false; documentLifecycle.revision += 1; };
        }
        let subscription: { unsubscribe: () => void } | undefined;
        let isCancelled = false;
        let hasBootstrapped = false;
        let resumeInFlight = false;
        let resumeAgain = false;
        const resumeSession = () => {
            if (isCancelled || !documentLifecycleRef.current.active || !hasBootstrapped || document.visibilityState === 'hidden') return;
            if (resumeInFlight) { resumeAgain = true; return; }
            resumeInFlight = true;
            let generation = authEventGenerationRef.current;
            const documentRevision = documentLifecycleRef.current.revision;
            void getSupabaseClient().then(async (supabase) => {
                const { data: { session: currentSession }, error } = await supabase.auth.getSession();
                if (isCancelled || !documentLifecycleRef.current.active || documentLifecycleRef.current.revision !== documentRevision || authEventGenerationRef.current !== generation) return;
                // Reading the same session on focus is not a replacement login.
                // Keep an explicit logout's ownership while still revalidating eligibility.
                if ((currentSession?.user?.id ?? null) !== activeAuthUserIdRef.current
                    || (currentSession?.access_token ?? null) !== publishedAccessTokenRef.current) {
                    generation = ++authEventGenerationRef.current;
                }
                const previousOwner = activeAuthUserIdRef.current ?? pendingAuthUserIdRef.current;
                if (previousOwner && previousOwner !== currentSession?.user?.id) {
                    void clearPrivateDrafts(previousOwner);
                    clearPublishedAuthState('auth-resume-owner-changed', generation);
                }
                if (error || !currentSession?.user || isSessionExpired(currentSession)) {
                    clearPublishedAuthState('auth-resume-no-session', generation);
                    return;
                }
                await publishEligibleSession(currentSession, generation, false, false);
            }).catch(() => {
                clearPublishedAuthState('auth-resume-failed', generation);
            }).finally(() => {
                resumeInFlight = false;
                if (resumeAgain) { resumeAgain = false; resumeSession(); }
            });
        };
        const authorityChanged = (event: StorageEvent) => {
            if (event.key !== BROWSER_DRAFT_AUTHORITY_KEY && event.key !== null) return;
            // Immediately unmount any old composer, including same-account
            // logout/re-login. Resume independently checks the shared SDK session.
            authEventGenerationRef.current += 1;
            clearPublishedAuthState('auth-draft-authority-changed');
            resumeSession();
        };
        const privacySessionCleared = (event: Event) => {
            if ((event as CustomEvent<HomeAuthSessionUpdatedDetail>).detail?.source === 'auth-privacy-session-cleared') resumeSession();
        };
        window.addEventListener(HOME_AUTH_SESSION_UPDATED_EVENT, privacySessionCleared);
        window.addEventListener('storage', authorityChanged);
        // A full document navigation aborts transport before React unmounts.
        // Its late Auth result must not turn that navigation into draft deletion.
        // Keep explicit signOut ownership independent of this document liveness.
        let didPageHide = false;
        const suspendDocument = () => { documentLifecycle.active = false; documentLifecycle.revision += 1; };
        const pageHidden = () => { didPageHide = true; suspendDocument(); };
        const pageShown = () => { didPageHide = false; documentLifecycle.active = true; if (hasBootstrapped) resumeSession(); else startOnce(); };
        const navigation = (window as Window & { navigation?: EventTarget }).navigation;
        const navigating = (rawEvent: Event) => {
            const event = rawEvent as Event & { destination?: { sameDocument?: boolean }; signal?: AbortSignal; downloadRequest?: string | null };
            if (event.destination?.sameDocument !== false || !event.signal || event.signal.aborted || event.downloadRequest != null) return;
            // Navigation can abort fetches before pagehide. Observe its start,
            // while cancellation resumes fresh Auth work in the retained document.
            suspendDocument();
            const revision = documentLifecycle.revision;
            event.signal.addEventListener('abort', () => {
                if (!isCancelled && !didPageHide && documentLifecycle.revision === revision) pageShown();
            }, { once: true });
        };
        // Browser-initiated navigation can abort old requests before pagehide
        // without a NavigateEvent. Invalidate those requests, keeping explicit
        // logout and a canceled navigation's document usable.
        const beforeUnload = () => { documentLifecycle.revision += 1; };
        window.addEventListener('beforeunload', beforeUnload);
        navigation?.addEventListener('navigate', navigating);
        window.addEventListener('pagehide', pageHidden);
        window.addEventListener('pageshow', pageShown);
        window.addEventListener('focus', resumeSession);
        document.addEventListener('visibilitychange', resumeSession);

        const startAuthBootstrap = () => {
            const documentRevision = documentLifecycleRef.current.revision;
            void getSupabaseClient()
                .then((supabase) => {
                    if (isCancelled || !documentLifecycleRef.current.active || documentLifecycleRef.current.revision !== documentRevision) return;
                    hasBootstrapped = true;

                    const generation = ++authEventGenerationRef.current;
                    supabase.auth.getSession().then(async ({ data: { session: currentSession }, error }) => {
                        if (!documentLifecycleRef.current.active || documentLifecycleRef.current.revision !== documentRevision) return;
                        if (error && isAuthSessionInvalidError(error)) {
                            await clearStaleSession(undefined, generation);
                            if (authEventGenerationRef.current === generation) setIsLoading(false);
                            return;
                        }
                        if (error) {
                            debugLog(DEBUG_LOG_EVENT.AUTH_SESSION_LOAD_FAILED, {
                                reason: DEBUG_LOG_REASON_CODE.AUTH_SESSION_LOAD_FAILED,
                            });
                        }

                        let nextSession = currentSession;
                        if (isSessionExpired(nextSession)) {
                            const { data, error: refreshError } = await supabase.auth.refreshSession();
                            if (!documentLifecycleRef.current.active || documentLifecycleRef.current.revision !== documentRevision) return;
                            if (refreshError || !data.session) {
                                if (refreshError && !isAuthSessionInvalidError(refreshError)) {
                                    debugLog(DEBUG_LOG_EVENT.AUTH_SESSION_REFRESH_FAILED, {
                                        reason: DEBUG_LOG_REASON_CODE.AUTH_SESSION_REFRESH_FAILED,
                                    });
                                }
                                await clearStaleSession(undefined, generation);
                                if (authEventGenerationRef.current === generation) setIsLoading(false);
                                return;
                            }
                            nextSession = data.session;
                        }

                        if (nextSession?.user) {
                            await publishEligibleSession(
                                nextSession,
                                generation,
                                isLiteralPasswordRecoveryRoute(),
                            );
                        } else {
                            clearPublishedAuthState('auth-no-session', generation);
                        }
                        if (authEventGenerationRef.current === generation) setIsLoading(false);
                    }).catch(async (error) => {
                        if (!documentLifecycleRef.current.active || documentLifecycleRef.current.revision !== documentRevision) return;
                        if (isAuthSessionInvalidError(error)) {
                            await clearStaleSession(undefined, generation);
                        } else {
                            debugLog(DEBUG_LOG_EVENT.AUTH_SESSION_LOAD_FAILED, {
                                reason: DEBUG_LOG_REASON_CODE.AUTH_SESSION_LOAD_FAILED,
                            });
                        }
                        if (authEventGenerationRef.current === generation) setIsLoading(false);
                    });

                    const authSubscription = supabase.auth.onAuthStateChange((event, nextSession) => {
                        if (!documentLifecycleRef.current.active || isCancelled) return;
                        const generation = ++authEventGenerationRef.current;
                        const previousOwner = activeAuthUserIdRef.current ?? pendingAuthUserIdRef.current;
                        if (previousOwner && previousOwner !== nextSession?.user?.id) {
                            void clearPrivateDrafts(previousOwner);
                            clearPublishedAuthState(`auth-owner-changed:${event}`, generation);
                            if (nextSession?.user) setIsLoading(true);
                        }
                        if (isSessionExpired(nextSession)) {
                            void clearStaleSession(nextSession?.user?.id, generation);
                            return;
                        }
                        if (!nextSession?.user) {
                            clearPublishedAuthState(`auth-state:${event}`, generation);
                            return;
                        }
                        if (event === 'PASSWORD_RECOVERY') {
                            recordPasswordRecoveryProof(nextSession.user.id);
                        }
                        void publishEligibleSession(
                            nextSession,
                            generation,
                            event === 'PASSWORD_RECOVERY',
                        );
                    });
                    subscription = authSubscription.data.subscription;
                })
                .catch(() => {
                    if (!isCancelled) {
                        debugLog(DEBUG_LOG_EVENT.AUTH_CLIENT_LOAD_FAILED, {
                            reason: DEBUG_LOG_REASON_CODE.AUTH_CLIENT_LOAD_FAILED,
                        });
                        setIsLoading(false);
                    }
                });
        };

        let bootstrapTimer: number | undefined;
        const removeBootstrapListeners = () => {
            for (const eventName of HOME_AUTH_BOOTSTRAP_EVENTS) {
                window.removeEventListener(eventName, startOnce);
            }
        };
        const startOnce = () => {
            if (isCancelled) return;
            if (bootstrapTimer) {
                window.clearTimeout(bootstrapTimer);
                bootstrapTimer = undefined;
            }
            removeBootstrapListeners();
            startAuthBootstrap();
        };

        if (shouldDelayAuthBootstrap()) {
            if (shouldBootstrapAuthOnGeneralInteraction()) {
                for (const eventName of HOME_AUTH_BOOTSTRAP_EVENTS) {
                    window.addEventListener(eventName, startOnce, { once: true, passive: true });
                }
            }
            bootstrapTimer = window.setTimeout(startOnce, HOME_AUTH_BOOTSTRAP_DELAY_MS);
        } else {
            startAuthBootstrap();
        }

        return () => {
            documentLifecycle.active = false;
            documentLifecycle.revision += 1;
            isCancelled = true;
            authEventGenerationRef.current += 1;
            if (bootstrapTimer) {
                window.clearTimeout(bootstrapTimer);
            }
            removeBootstrapListeners();
            subscription?.unsubscribe();
            window.removeEventListener(HOME_AUTH_SESSION_UPDATED_EVENT, privacySessionCleared);
            window.removeEventListener('storage', authorityChanged);
            window.removeEventListener('beforeunload', beforeUnload);
            navigation?.removeEventListener('navigate', navigating);
            window.removeEventListener('pagehide', pageHidden);
            window.removeEventListener('pageshow', pageShown);
            window.removeEventListener('focus', resumeSession);
            document.removeEventListener('visibilitychange', resumeSession);
        };
    }, [clearPrivateDrafts, clearPublishedAuthState, clearStaleSession, publishEligibleSession]);

    const completeNicknameSetup = useCallback(() => {
        setNeedsNicknameSetup(false);
        if (user) {
            void refreshPublishedAuthUserState(user.id);
        }
    }, [user, refreshPublishedAuthUserState]);

    const signIn = useCallback(async (email: string, password: string) => {
        let signedInUserId: string | null = null;
        let signedInGeneration: number | null = null;
        try {
            const supabase = await getSupabaseClient();
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });
            signedInUserId = data.session?.user?.id ?? null;
            signedInGeneration = authEventGenerationRef.current;
            if (error || !signedInUserId) {
                throw new Error(PASSWORD_SIGN_IN_ERROR);
            }

            const eligibility = await getCurrentPrivacyEligibility(supabase);
            if (!hasLivePrivacyEligibilityReceipt(eligibility)) {
                throw new Error(PASSWORD_SIGN_IN_ERROR);
            }
        } catch {
            if (signedInUserId && signedInGeneration !== null) {
                await clearStaleSession(signedInUserId, signedInGeneration);
            }
            throw new Error(PASSWORD_SIGN_IN_ERROR);
        }
    }, [clearStaleSession]);

    const signOut = useCallback(async () => {
        const browserLogout = captureBrowserLogout();
        const signingOutUserId = activeAuthUserIdRef.current;
        const signingOutGeneration = publishedAuthGenerationRef.current;
        const signingOutEventGeneration = authEventGenerationRef.current;
        const signingOutAccessToken = publishedAccessTokenRef.current;
        const signingOutEpoch = signingOutUserId ? captureBrowserDraftEpoch(signingOutUserId) : null;
        const ownsAuthState = () => publishedAuthGenerationRef.current === signingOutGeneration
            && authEventGenerationRef.current === signingOutEventGeneration
            && activeAuthUserIdRef.current === signingOutUserId
            && (!pendingAuthUserIdRef.current || pendingAuthUserIdRef.current === signingOutUserId)
            && (!signingOutUserId || Boolean(signingOutEpoch && isBrowserDraftEpochCurrent(signingOutUserId, signingOutEpoch)));
        const ownsLogoutRequest = () => ownsAuthState() && browserLogout.isCurrent();

        const supabase = await getSupabaseClient();
        if (!ownsLogoutRequest()) throw new AuthLogoutSupersededError();
        const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
        if (!ownsLogoutRequest()
            || (currentSession?.user.id ?? null) !== signingOutUserId
            || (currentSession?.access_token ?? null) !== signingOutAccessToken) {
            throw new AuthLogoutSupersededError();
        }
        if (sessionError) throw new Error('logout_session_unavailable');

        const logoutResponse = await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'same-origin',
        });
        if (!ownsLogoutRequest()) throw new AuthLogoutSupersededError();
        if (!logoutResponse.ok) {
            throw new Error('server_logout_failed');
        }
        if (!await browserLogout.clearIfCurrent(ownsLogoutRequest)) throw new AuthLogoutSupersededError();
        if (!ownsAuthState() || !browserLogout.isCleared()) throw new AuthLogoutSupersededError();
        const cleanupEpoch = signingOutUserId ? beginBrowserDraftCleanup(signingOutUserId) : null;
        clearPublishedAuthState('auth-signout');
        const clearSigningOutDrafts = async () => {
            if (!signingOutUserId || !cleanupEpoch) return;
            const { clearBrowserDraftsForUser } = await import("@/lib/privacy/browser-draft-cleanup");
            await clearBrowserDraftsForUser(signingOutUserId, cleanupEpoch);
        };
        await clearSigningOutDrafts();
        if (publishedAuthGenerationRef.current !== signingOutGeneration
            || (signingOutUserId && cleanupEpoch && !isBrowserDraftEpochCurrent(signingOutUserId, cleanupEpoch))) {
            throw new AuthLogoutSupersededError();
        }
    }, [clearPublishedAuthState]);

    const resetPassword = useCallback(async (email: string) => {
        await requestBrowserPasswordRecovery(email);
    }, []);

    const updatePassword = useCallback(async (newPassword: string) => {
        const { error } = await updateCurrentBrowserAuthUser(activeAuthUserIdRef.current ?? '', {
            password: newPassword,
        });
        if (error) throw error;
    }, []);

    const value = useMemo<AuthContextType>(() => ({
        user,
        session,
        isLoading,
        isAdmin,
        needsNicknameSetup,
        profileNickname,
        signIn,
        signOut,
        completeNicknameSetup,
        resetPassword,
        updatePassword,
    }), [user, session, isLoading, isAdmin, needsNicknameSetup, profileNickname, signIn, signOut, completeNicknameSetup, resetPassword, updatePassword]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

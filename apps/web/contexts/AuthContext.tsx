'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { AuthContext, type AuthContextType } from "@/contexts/AuthContextBase";
import { dispatchHomeAuthSessionUpdated } from "@/lib/home-auth-events";
import { DEBUG_LOG_EVENT, DEBUG_LOG_REASON_CODE, debugLog } from "@/lib/debug-log";
import {
    getCurrentPrivacyEligibility,
    signOutRejectedPrivacySession,
} from "@/lib/privacy/eligibility";
import { hasSupabaseAuthSessionHint } from "@/lib/supabase-auth-session-hints";

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
    return isRefreshTokenNotFoundError(error) || isExpiredJwtError(error);
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
    if (!eligibility.eligible) {
        return INELIGIBLE_AUTH_USER_STATE;
    }

    const [roleResponse, profileResponse] = await Promise.all([
        supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", userId)
            .eq("role", "admin")
            .maybeSingle(),
        supabase
            .from("profiles")
            .select("nickname")
            .eq("user_id", userId)
            .maybeSingle(),
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

    const profileData = profileResponse.data as { nickname?: string } | null;
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
    const activeAuthUserIdRef = useRef<string | null>(null);
    const pendingAuthUserIdRef = useRef<string | null>(null);

    const clearPrivateDrafts = useCallback(async (userId: string | null) => {
        if (!userId) return;

        try {
            const { clearBrowserDraftsForUser } = await import("@/lib/privacy/browser-draft-cleanup");
            await clearBrowserDraftsForUser(userId);
        } catch {
            // Session and published state still need to be cleared when local draft cleanup is unavailable.
        }
    }, []);

    const clearPublishedAuthState = useCallback((source: string) => {
        activeAuthUserIdRef.current = null;
        pendingAuthUserIdRef.current = null;
        setSession(null);
        setUser(null);
        setIsAdmin(false);
        setNeedsNicknameSetup(false);
        setProfileNickname(null);
        dispatchHomeAuthSessionUpdated({ hasSession: false, source });
    }, []);

    const clearStaleSession = useCallback(async (userId?: string, revokeGlobally = false) => {
        const signedOutUserId = userId ?? pendingAuthUserIdRef.current ?? activeAuthUserIdRef.current;
        await clearPrivateDrafts(signedOutUserId);

        try {
            const supabase = await getSupabaseClient();
            if (revokeGlobally) {
                await signOutRejectedPrivacySession(supabase);
            } else {
                await supabase.auth.signOut({ scope: 'local' });
            }
        } catch {
            // The local React state below must be cleared even when the client cannot be loaded.
        }

        clearPublishedAuthState('auth-clear-stale-session');
    }, [clearPrivateDrafts, clearPublishedAuthState]);

    const publishEligibleSession = useCallback(async (nextSession: Session) => {
        const userId = nextSession.user?.id;
        if (!userId) {
            await clearStaleSession();
            return;
        }

        pendingAuthUserIdRef.current = userId;
        try {
            const state = await fetchAuthUserState(userId);
            if (pendingAuthUserIdRef.current !== userId) return;
            if (!state.isEligible) {
                await clearStaleSession(userId, true);
                return;
            }

            activeAuthUserIdRef.current = userId;
            pendingAuthUserIdRef.current = null;
            setSession(nextSession);
            setUser(nextSession.user);
            setIsAdmin(state.isAdmin);
            setNeedsNicknameSetup(state.needsNicknameSetup);
            setProfileNickname(state.profileNickname);
            dispatchHomeAuthSessionUpdated({ hasSession: true, source: 'auth-eligible-session' });
        } catch {
            if (pendingAuthUserIdRef.current !== userId) return;
            debugLog(DEBUG_LOG_EVENT.AUTH_USER_STATE_LOAD_FAILED, {
                reason: DEBUG_LOG_REASON_CODE.AUTH_USER_STATE_LOAD_FAILED,
            });
            await clearStaleSession(userId);
        }
    }, [clearStaleSession]);

    const refreshPublishedAuthUserState = useCallback(async (userId: string) => {
        try {
            const state = await fetchAuthUserState(userId);
            if (activeAuthUserIdRef.current !== userId) return;
            if (!state.isEligible) {
                await clearStaleSession(userId, true);
                return;
            }
            setIsAdmin(state.isAdmin);
            setNeedsNicknameSetup(state.needsNicknameSetup);
            setProfileNickname(state.profileNickname);
        } catch {
            if (activeAuthUserIdRef.current !== userId) return;
            debugLog(DEBUG_LOG_EVENT.AUTH_USER_STATE_LOAD_FAILED, {
                reason: DEBUG_LOG_REASON_CODE.AUTH_USER_STATE_LOAD_FAILED,
            });
            await clearStaleSession(userId);
        }
    }, [clearStaleSession]);

    useEffect(() => {
        let subscription: { unsubscribe: () => void } | undefined;
        let isCancelled = false;

        const startAuthBootstrap = () => {
            void getSupabaseClient()
                .then((supabase) => {
                    if (isCancelled) return;

                    supabase.auth.getSession().then(async ({ data: { session: currentSession }, error }) => {
                        if (error && isAuthSessionInvalidError(error)) {
                            await clearStaleSession();
                            setIsLoading(false);
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
                            if (refreshError || !data.session) {
                                if (refreshError && !isAuthSessionInvalidError(refreshError)) {
                                    debugLog(DEBUG_LOG_EVENT.AUTH_SESSION_REFRESH_FAILED, {
                                        reason: DEBUG_LOG_REASON_CODE.AUTH_SESSION_REFRESH_FAILED,
                                    });
                                }
                                await clearStaleSession();
                                setIsLoading(false);
                                return;
                            }
                            nextSession = data.session;
                        }

                        if (nextSession?.user) {
                            await publishEligibleSession(nextSession);
                        } else {
                            clearPublishedAuthState('auth-no-session');
                        }
                        setIsLoading(false);
                    }).catch(async (error) => {
                        if (isAuthSessionInvalidError(error)) {
                            await clearStaleSession();
                        } else {
                            debugLog(DEBUG_LOG_EVENT.AUTH_SESSION_LOAD_FAILED, {
                                reason: DEBUG_LOG_REASON_CODE.AUTH_SESSION_LOAD_FAILED,
                            });
                        }
                        setIsLoading(false);
                    });

                    const authSubscription = supabase.auth.onAuthStateChange((_event, nextSession) => {
                        if (isSessionExpired(nextSession)) {
                            void clearStaleSession(nextSession?.user?.id);
                            return;
                        }
                        if (!nextSession?.user) {
                            clearPublishedAuthState(`auth-state:${_event}`);
                            return;
                        }
                        void publishEligibleSession(nextSession);
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
            isCancelled = true;
            if (bootstrapTimer) {
                window.clearTimeout(bootstrapTimer);
            }
            removeBootstrapListeners();
            subscription?.unsubscribe();
        };
    }, [clearPublishedAuthState, clearStaleSession, publishEligibleSession]);

    const completeNicknameSetup = useCallback(() => {
        setNeedsNicknameSetup(false);
        if (user) {
            void refreshPublishedAuthUserState(user.id);
        }
    }, [user, refreshPublishedAuthUserState]);

    const signIn = useCallback(async (email: string, password: string) => {
        let signedInUserId: string | null = null;
        try {
            const supabase = await getSupabaseClient();
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });
            signedInUserId = data.session?.user?.id ?? null;
            if (error || !signedInUserId) {
                throw new Error(PASSWORD_SIGN_IN_ERROR);
            }

            const eligibility = await getCurrentPrivacyEligibility(supabase);
            if (!eligibility.eligible) {
                throw new Error(PASSWORD_SIGN_IN_ERROR);
            }
        } catch {
            if (signedInUserId) {
                await clearStaleSession(signedInUserId, true);
            }
            throw new Error(PASSWORD_SIGN_IN_ERROR);
        }
    }, [clearStaleSession]);

    const signOut = useCallback(async () => {
        const signingOutUserId = activeAuthUserIdRef.current;
        const clearPrivateDrafts = async () => {
            if (!signingOutUserId) return;
            const { clearBrowserDraftsForUser } = await import("@/lib/privacy/browser-draft-cleanup");
            await clearBrowserDraftsForUser(signingOutUserId);
        };

        const supabase = await getSupabaseClient();
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (!error) {
            await clearPrivateDrafts();
            clearPublishedAuthState('auth-signout');
            return;
        }

        if (isAuthSessionInvalidError(error)) {
            await clearPrivateDrafts();
            await clearStaleSession(signingOutUserId ?? undefined);
            return;
        }

        throw error;
    }, [clearPublishedAuthState, clearStaleSession]);

    const resetPassword = useCallback(async (email: string) => {
        const redirectUrl = `${window.location.origin}/auth/reset-password`;
        const supabase = await getSupabaseClient();
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: redirectUrl,
        });
        if (error) throw error;
    }, []);

    const updatePassword = useCallback(async (newPassword: string) => {
        const supabase = await getSupabaseClient();
        const { error } = await supabase.auth.updateUser({
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

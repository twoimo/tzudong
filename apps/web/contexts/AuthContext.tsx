'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { AuthContext, type AuthContextType } from "@/contexts/AuthContextBase";
import { dispatchHomeAuthSessionUpdated } from "@/lib/home-auth-events";
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
const PRIVACY_PROFILE_ALLOWED_STATUSES = ['eligible', 'guardian_verified'] as const;
const isPrivacyProfileStatusAllowed = (status: unknown) =>
    typeof status === 'string' &&
    PRIVACY_PROFILE_ALLOWED_STATUSES.includes(status as (typeof PRIVACY_PROFILE_ALLOWED_STATUSES)[number]);

type AuthUserState = {
    isAdmin: boolean;
    needsNicknameSetup: boolean;
    profileNickname: string | null;
    isPrivacyProfileEligible: boolean;
};

type AuthUserStateCacheEntry = {
    userId: string;
    state: AuthUserState;
    expiresAt: number;
};

const AUTH_USER_STATE_CACHE_TTL_MS = 5 * 60 * 1000;

let authUserStateCache: AuthUserStateCacheEntry | null = null;
const authUserStateRequests = new Map<string, Promise<AuthUserState>>();

function invalidateAuthUserStateCache(userId?: string) {
    if (!userId || authUserStateCache?.userId === userId) {
        authUserStateCache = null;
    }

    if (userId) {
        authUserStateRequests.delete(userId);
        return;
    }

    authUserStateRequests.clear();
}

function getCachedAuthUserState(userId: string) {
    if (authUserStateCache?.userId !== userId) return null;
    if (authUserStateCache.expiresAt <= Date.now()) {
        authUserStateCache = null;
        return null;
    }

    return authUserStateCache.state;
}

async function fetchAuthUserState(userId: string): Promise<AuthUserState> {
    const supabase = await getSupabaseClient();
    const [roleResponse, profileResponse, privacyProfileResponse] = await Promise.all([
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
        (supabase
            .from('privacy_age_profiles' as never)
            .select('status')
            .eq('owner', userId)
            .maybeSingle() as Promise<{ data: { status: string | null } | null; error: unknown }>),
    ]);

    if (roleResponse.error && isAuthSessionInvalidError(roleResponse.error)) {
        throw roleResponse.error;
    }
    if (profileResponse.error && isAuthSessionInvalidError(profileResponse.error)) {
        throw profileResponse.error;
    }

    const profileData = profileResponse.data as { nickname?: string } | null;
    const nickname = profileData?.nickname;
    const isPrivacyProfileEligible =
        !privacyProfileResponse.error &&
        privacyProfileResponse.data != null &&
        isPrivacyProfileStatusAllowed(privacyProfileResponse.data.status);

    const state: AuthUserState = {
        isAdmin: !roleResponse.error && Boolean(roleResponse.data),
        needsNicknameSetup: profileResponse.error ? false : !profileData || nickname === "탈퇴한 사용자",
        profileNickname: typeof nickname === "string" && nickname.trim().length > 0 ? nickname.trim() : null,
        isPrivacyProfileEligible,
    };

    authUserStateCache = {
        userId,
        state,
        expiresAt: Date.now() + AUTH_USER_STATE_CACHE_TTL_MS,
    };

    return state;
}

function loadAuthUserState(userId: string, options: { force?: boolean } = {}) {
    if (!options.force) {
        const cachedState = getCachedAuthUserState(userId);
        if (cachedState) return Promise.resolve(cachedState);

        const pendingRequest = authUserStateRequests.get(userId);
        if (pendingRequest) return pendingRequest;
    } else {
        invalidateAuthUserStateCache(userId);
    }

    const request = fetchAuthUserState(userId);
    authUserStateRequests.set(userId, request);
    const releaseRequest = () => {
        if (authUserStateRequests.get(userId) === request) {
            authUserStateRequests.delete(userId);
        }
    };
    void request.then(releaseRequest, releaseRequest);
    return request;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);
    const [needsNicknameSetup, setNeedsNicknameSetup] = useState(false);
    const [profileNickname, setProfileNickname] = useState<string | null>(null);
    const activeAuthUserIdRef = useRef<string | null>(null);

    const clearStaleSession = useCallback(async () => {
        invalidateAuthUserStateCache();
        try {
            const supabase = await getSupabaseClient();
            await supabase.auth.signOut({ scope: 'local' });
        } catch {
            // no-op
        }

        activeAuthUserIdRef.current = null;
        setSession(null);
        setUser(null);
        setIsAdmin(false);
        setNeedsNicknameSetup(false);
        setProfileNickname(null);
        dispatchHomeAuthSessionUpdated({ hasSession: false, source: 'auth-clear-stale-session' });
    }, []);

    const applyAuthUserState = useCallback(async (userId: string, options: { force?: boolean } = {}) => {
        try {
            const state = await loadAuthUserState(userId, options);
            if (activeAuthUserIdRef.current !== userId) return;
            setIsAdmin(state.isAdmin);
            setNeedsNicknameSetup(state.needsNicknameSetup);
            setProfileNickname(state.profileNickname);
        } catch (error) {
            if (isAuthSessionInvalidError(error)) {
                await clearStaleSession();
                return;
            }
            console.error("Error loading auth user state:", error);
            setIsAdmin(false);
            setNeedsNicknameSetup(false);
            setProfileNickname(null);
        }
    }, [clearStaleSession]);

    useEffect(() => {
        let subscription: { unsubscribe: () => void } | undefined;
        let isCancelled = false;

        const startAuthBootstrap = () => {
            void getSupabaseClient()
                .then((supabase) => {
                if (isCancelled) return;

                // 초기 세션 가져오기
                supabase.auth.getSession().then(async ({ data: { session }, error }) => {
                    if (error && isAuthSessionInvalidError(error)) {
                        await clearStaleSession();
                        setIsLoading(false);
                        return;
                    }

                    let nextSession = session;

                    if (isSessionExpired(nextSession)) {
                        const { data, error: refreshError } = await supabase.auth.refreshSession();
                        if (refreshError || !data.session) {
                            if (refreshError && !isAuthSessionInvalidError(refreshError)) {
                                console.error('Error refreshing session:', refreshError);
                            }
                            await clearStaleSession();
                            setIsLoading(false);
                            return;
                        }
                        nextSession = data.session;
                    }

                    setSession(nextSession);
                    setUser(nextSession?.user ?? null);
                    activeAuthUserIdRef.current = nextSession?.user?.id ?? null;
                    if (nextSession?.user) {
                        await applyAuthUserState(nextSession.user.id);
                    }
                    setIsLoading(false);
                }).catch(async (error) => {
                    if (isAuthSessionInvalidError(error)) {
                        await clearStaleSession();
                    } else {
                        console.error('Error loading session:', error);
                    }
                    setIsLoading(false);
                });

                // 인증 상태 변경 감지
                const authSubscription = supabase.auth.onAuthStateChange((_event, session) => {
                    if (isSessionExpired(session)) {
                        void clearStaleSession();
                        return;
                    }
                    dispatchHomeAuthSessionUpdated({
                        hasSession: Boolean(session),
                        source: `auth-state:${_event}`,
                    });
                    setSession(session);
                    setUser(session?.user ?? null);
                    activeAuthUserIdRef.current = session?.user?.id ?? null;
                    if (session?.user) {
                        const userId = session.user.id;
                        window.setTimeout(() => {
                            if (isCancelled) return;
                            void applyAuthUserState(userId, { force: _event === 'USER_UPDATED' });
                        }, 0);
                    } else {
                        invalidateAuthUserStateCache();
                        setIsAdmin(false);
                        setNeedsNicknameSetup(false);
                        setProfileNickname(null);
                    }
                });
                subscription = authSubscription.data.subscription;
            })
                .catch((error) => {
                    if (!isCancelled) {
                        console.error('Error loading auth client:', error);
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
    }, [applyAuthUserState, clearStaleSession]);

    const completeNicknameSetup = useCallback(() => {
        setNeedsNicknameSetup(false);
        if (user) {
            invalidateAuthUserStateCache(user.id);
            void applyAuthUserState(user.id, { force: true });
        }
    }, [user, applyAuthUserState]);

    const signIn = useCallback(async (email: string, password: string) => {
        const supabase = await getSupabaseClient();
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) throw error;
    }, []);

    const signInWithGoogle = useCallback(async () => {
        const redirectUrl = `${window.location.origin}/auth/callback`;
        const supabase = await getSupabaseClient();

        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectUrl,
            },
        });

        if (error) throw error;
    }, []);

    const signUp = useCallback(async (email: string, password: string, username: string) => {
        const supabase = await getSupabaseClient();
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    nickname: username,
                },
            },
        });
        if (error) throw error;
        return { session: data.session };
    }, []);

    const signOut = useCallback(async () => {
        const supabase = await getSupabaseClient();
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (!error) {
            invalidateAuthUserStateCache();
            activeAuthUserIdRef.current = null;
            setSession(null);
            setUser(null);
            setIsAdmin(false);
            setNeedsNicknameSetup(false);
            setProfileNickname(null);
            dispatchHomeAuthSessionUpdated({ hasSession: false, source: 'auth-signout' });
            return;
        }

        if (isAuthSessionInvalidError(error)) {
            await clearStaleSession();
            return;
        }

        throw error;
    }, [clearStaleSession]);

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

    const value = useMemo(() => ({
        user,
        session,
        isLoading,
        isAdmin,
        needsNicknameSetup,
        profileNickname,
        signIn,
        signInWithGoogle,
        signUp,
        signOut,
        completeNicknameSetup,
        resetPassword,
        updatePassword,
    }), [user, session, isLoading, isAdmin, needsNicknameSetup, profileNickname, signIn, signInWithGoogle, signUp, signOut, completeNicknameSetup, resetPassword, updatePassword]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

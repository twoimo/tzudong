'use client';

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
    user: User | null;
    session: Session | null;
    isLoading: boolean;
    isAdmin: boolean;
    needsNicknameSetup: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signInWithGoogle: () => Promise<void>;
    signUp: (email: string, password: string, username: string) => Promise<{ session: Session | null }>;
    signOut: () => Promise<void>;
    completeNicknameSetup: () => void;
    resetPassword: (email: string) => Promise<void>;
    updatePassword: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);
    const [needsNicknameSetup, setNeedsNicknameSetup] = useState(false);

    const clearStaleSession = useCallback(async () => {
        try {
            await supabase.auth.signOut({ scope: 'local' });
        } catch {
            // no-op
        }

        setSession(null);
        setUser(null);
        setIsAdmin(false);
        setNeedsNicknameSetup(false);
    }, []);

    const checkAdminRole = useCallback(async (userId: string) => {
        try {
            const { data, error } = await supabase
                .from("user_roles")
                .select("role")
                .eq("user_id", userId)
                .eq("role", "admin")
                .maybeSingle();

            if (error) {
                if (isAuthSessionInvalidError(error)) {
                    await clearStaleSession();
                    return;
                }
                setIsAdmin(false);
                return;
            }

            setIsAdmin(!!data);
        } catch (error) {
            if (isAuthSessionInvalidError(error)) {
                await clearStaleSession();
                return;
            }
            console.error("Error checking admin role:", error);
            setIsAdmin(false);
        }
    }, [clearStaleSession]);

    const checkProfileStatus = useCallback(async (userId: string) => {
        try {
            const { data, error } = await supabase
                .from("profiles")
                .select("nickname")
                .eq("user_id", userId)
                .maybeSingle();

            const profileData = data as { nickname?: string } | null;
            const nickname = profileData?.nickname;

            if (error) {
                if (isAuthSessionInvalidError(error)) {
                    await clearStaleSession();
                    return;
                }
                console.error("Profile check error:", error);
                setNeedsNicknameSetup(false);
                return;
            }

            if (!profileData || nickname === "탈퇴한 사용자") {
                setNeedsNicknameSetup(true);
            } else {
                setNeedsNicknameSetup(false);
            }
        } catch (error) {
            if (isAuthSessionInvalidError(error)) {
                await clearStaleSession();
                return;
            }
            console.error("Error checking profile status:", error);
            setNeedsNicknameSetup(false);
        }
    }, [clearStaleSession]);

    useEffect(() => {
        // 초기 세션 가져오기
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
            if (nextSession?.user) {
                await Promise.all([
                    checkAdminRole(nextSession.user.id),
                    checkProfileStatus(nextSession.user.id)
                ]);
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
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            if (isSessionExpired(session)) {
                clearStaleSession();
                return;
            }
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                checkAdminRole(session.user.id);
                checkProfileStatus(session.user.id);
            } else {
                setIsAdmin(false);
                setNeedsNicknameSetup(false);
            }
        });

        return () => subscription.unsubscribe();
    }, [checkAdminRole, checkProfileStatus, clearStaleSession]);

    const completeNicknameSetup = useCallback(() => {
        setNeedsNicknameSetup(false);
        if (user) {
            checkProfileStatus(user.id);
        }
    }, [user, checkProfileStatus]);

    const signIn = useCallback(async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) throw error;
    }, []);

    const signInWithGoogle = useCallback(async () => {
        const redirectUrl = `${window.location.origin}/auth/callback`;

        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectUrl,
            },
        });

        if (error) throw error;
    }, []);

    const signUp = useCallback(async (email: string, password: string, username: string) => {
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
        const { error } = await supabase.auth.signOut();
        if (!error) return;

        if (isAuthSessionInvalidError(error)) {
            await clearStaleSession();
            return;
        }

        throw error;
    }, [clearStaleSession]);

    const resetPassword = useCallback(async (email: string) => {
        const redirectUrl = `${window.location.origin}/auth/reset-password`;
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: redirectUrl,
        });
        if (error) throw error;
    }, []);

    const updatePassword = useCallback(async (newPassword: string) => {
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
        signIn,
        signInWithGoogle,
        signUp,
        signOut,
        completeNicknameSetup,
        resetPassword,
        updatePassword,
    }), [user, session, isLoading, isAdmin, needsNicknameSetup, signIn, signInWithGoogle, signUp, signOut, completeNicknameSetup, resetPassword, updatePassword]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}


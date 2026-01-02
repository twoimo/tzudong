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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);
    const [needsNicknameSetup, setNeedsNicknameSetup] = useState(false);

    const checkAdminRole = useCallback(async (userId: string) => {
        try {
            const { data, error } = await supabase
                .from("user_roles")
                .select("role")
                .eq("user_id", userId)
                .eq("role", "admin")
                .maybeSingle();

            setIsAdmin(!error && !!data);
        } catch (error) {
            console.error("Error checking admin role:", error);
            setIsAdmin(false);
        }
    }, []);

    const checkProfileStatus = useCallback(async (userId: string) => {
        try {
            const { data, error } = await supabase
                .from("profiles")
                .select("nickname")
                .eq("user_id", userId)
                .maybeSingle();

            if (error) {
                console.error("Profile check error:", error);
                setNeedsNicknameSetup(false);
            } else if (!data || (data as any).nickname === "탈퇴한 사용자") {
                setNeedsNicknameSetup(true);
            } else {
                setNeedsNicknameSetup(false);
            }
        } catch (error) {
            console.error("Error checking profile status:", error);
            setNeedsNicknameSetup(false);
        }
    }, []);

    useEffect(() => {
        // 초기 세션 가져오기
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                checkAdminRole(session.user.id);
                checkProfileStatus(session.user.id);
            }
            setIsLoading(false);
        });

        // 인증 상태 변경 감지
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
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
    }, [checkAdminRole, checkProfileStatus]);

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
    }), [user, session, isLoading, isAdmin, needsNicknameSetup, signIn, signInWithGoogle, signUp, signOut, completeNicknameSetup]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}


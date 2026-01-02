'use client';

import { createContext, useContext, useEffect, useState } from "react";
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
    }, []);

    const checkAdminRole = async (userId: string) => {
        try {
            const { data, error } = await supabase
                .from("user_roles")
                .select("role")
                .eq("user_id", userId)
                .eq("role", "admin")
                .single();

            if (!error && data) {
                setIsAdmin(true);
            } else {
                setIsAdmin(false);
            }
        } catch (error) {
            console.error("Error checking admin role:", error);
            setIsAdmin(false);
        }
    };

    const checkProfileStatus = async (userId: string) => {
        try {
            const { data, error } = await supabase
                .from("profiles")
                .select("nickname")
                .eq("user_id", userId)
                .maybeSingle();

            // 프로필이 없거나 닉네임이 "탈퇴한 사용자"인 경우
            if (error) {
                console.error("Profile check error:", error);
                setNeedsNicknameSetup(false);
            } else if (!data) {
                setNeedsNicknameSetup(true);
            } else if ((data as any).nickname === "탈퇴한 사용자") {
                setNeedsNicknameSetup(true);
            } else {
                setNeedsNicknameSetup(false);
            }
        } catch (error) {
            console.error("Error checking profile status:", error);
            setNeedsNicknameSetup(false);
        }
    };

    const completeNicknameSetup = () => {
        setNeedsNicknameSetup(false);
        // 프로필 상태를 다시 확인하여 닉네임이 제대로 설정되었는지 검증
        if (user) {
            checkProfileStatus(user.id);
        }
    };

    const signIn = async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) throw error;
    };

    const signInWithGoogle = async () => {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });

        if (error) throw error;
    };

    const signUp = async (email: string, password: string, username: string) => {
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
    };

    const signOut = async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
    };

    const value = {
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
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}


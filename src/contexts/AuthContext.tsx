import { createContext, useContext, useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface AuthContextType {
    user: User | null;
    session: Session | null;
    isLoading: boolean;
    isAdmin: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string, username: string) => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);
    const queryClient = useQueryClient();

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(async ({ data: { session } }) => {
            if (session?.user) {
                // 프로필 존재 여부 확인 (탈퇴한 사용자 체크)
                const { data: profile, error: profileError } = await supabase
                    .from('profiles')
                    .select('user_id')
                    .eq('user_id', session.user.id)
                    .maybeSingle();

                // 프로필이 없거나 에러가 발생한 경우 탈퇴한 사용자로 간주
                if (profileError || !profile) {
                    // 프로필이 없으면 탈퇴한 사용자로 간주하고 로그아웃
                    console.warn('탈퇴한 사용자의 세션 감지, 자동 로그아웃');
                    toast.error('탈퇴한 계정입니다. 다시 로그인하실 수 없습니다.');
                    await supabase.auth.signOut();
                    setSession(null);
                    setUser(null);
                    setIsLoading(false);
                    return;
                }
            }

            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                checkAdminRole(session.user.id);
            }
            setIsLoading(false);
        });

        // Listen for auth changes
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(async (event, session) => {
            console.log('Auth state changed:', event, session ? 'session exists' : 'no session');

            // 세션 만료 또는 인증 실패 감지
            if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || !session) {
                if (event === 'SIGNED_OUT') {
                    console.log('User signed out');
                    setSession(null);
                    setUser(null);
                    setIsAdmin(false);
                    // 캐시 초기화
                    queryClient.clear();
                } else if (event === 'TOKEN_REFRESHED') {
                    console.log('Token refreshed successfully');
                    setSession(session);
                    setUser(session?.user ?? null);
                    if (session?.user) {
                        checkAdminRole(session.user.id);
                    }
                } else {
                    // 세션 없음
                    setSession(null);
                    setUser(null);
                    setIsAdmin(false);
                }
                return;
            }

            // SIGNED_IN 이벤트에서만 프로필 체크 (최적화)
            if (event === 'SIGNED_IN' && session?.user) {
                // 프로필 존재 여부 확인 (탈퇴한 사용자 체크) - SIGNED_IN시에만
                const { data: profile, error: profileError } = await supabase
                    .from('profiles')
                    .select('user_id')
                    .eq('user_id', session.user.id)
                    .maybeSingle();

                // 프로필이 없거나 에러가 발생한 경우 탈퇴한 사용자로 간주
                if (profileError || !profile) {
                    // 프로필이 없으면 탈퇴한 사용자로 간주하고 로그아웃
                    console.warn('탈퇴한 사용자의 로그인 시도 감지, 자동 로그아웃');
                    toast.error('탈퇴한 계정입니다. 다시 로그인하실 수 없습니다.');
                    await supabase.auth.signOut();
                    setSession(null);
                    setUser(null);
                    return;
                }

                setSession(session);
                setUser(session?.user ?? null);
                checkAdminRole(session.user.id);
            } else {
                // 다른 이벤트에서는 세션 정보만 업데이트
                setSession(session);
                setUser(session?.user ?? null);
                setIsAdmin(false);
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

    const signIn = async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) throw error;
    };

    const signUp = async (email: string, password: string, username: string) => {
        const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    nickname: username,
                },
            },
        });

        if (error) throw error;
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
        signIn,
        signUp,
        signOut,
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


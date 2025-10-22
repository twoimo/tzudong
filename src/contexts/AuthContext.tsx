import { createContext, useContext, useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
        } = supabase.auth.onAuthStateChange(async (_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
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
                    console.warn('탈퇴한 사용자의 로그인 시도 감지, 자동 로그아웃');
                    toast.error('탈퇴한 계정입니다. 다시 로그인하실 수 없습니다.');
                    await supabase.auth.signOut();
                    setSession(null);
                    setUser(null);
                    return;
                }

                checkAdminRole(session.user.id);
            } else {
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


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
    signUp: (email: string, password: string, username: string) => Promise<void>;
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
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                checkAdminRole(session.user.id);
                checkProfileStatus(session.user.id);
            }
            setIsLoading(false);
        });

        // Listen for auth changes
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

            console.log("Profile check:", { data, error });

            // 프로필이 없거나 닉네임이 "탈퇴한 사용자"인 경우
            if (error) {
                console.error("Profile check error:", error);
                setNeedsNicknameSetup(false);
            } else if (!data) {
                console.log("No profile found, needs setup");
                setNeedsNicknameSetup(true);
            } else if (data.nickname === "탈퇴한 사용자") {
                console.log("Deactivated user, needs setup");
                setNeedsNicknameSetup(true);
            } else {
                console.log("Profile OK, nickname:", data.nickname);
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
        needsNicknameSetup,
        signIn,
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


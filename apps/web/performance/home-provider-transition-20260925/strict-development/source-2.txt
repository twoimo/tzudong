'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';

export interface AuthContextType {
    user: User | null;
    session: Session | null;
    isLoading: boolean;
    isAdmin: boolean;
    needsNicknameSetup: boolean;
    profileNickname: string | null;
    signIn: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
    completeNicknameSetup: () => void;
    resetPassword: (email: string) => Promise<void>;
    updatePassword: (newPassword: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

function createUnavailableAuthAction(action: string) {
    return async () => {
        throw new Error(`${action} requires the full auth UI module.`);
    };
}

export function AnonymousHomeAuthProvider({
    children,
    isLoading = false,
}: {
    children: ReactNode;
    isLoading?: boolean;
}) {
    const [needsNicknameSetup, setNeedsNicknameSetup] = useState(false);

    const unavailableSignIn = useMemo(() => createUnavailableAuthAction('signIn'), []);
    const unavailableSignOut = useMemo(() => createUnavailableAuthAction('signOut'), []);
    const unavailableResetPassword = useMemo(() => createUnavailableAuthAction('resetPassword'), []);
    const unavailableUpdatePassword = useMemo(() => createUnavailableAuthAction('updatePassword'), []);

    const value = useMemo<AuthContextType>(() => ({
        user: null,
        session: null,
        isLoading,
        isAdmin: false,
        needsNicknameSetup,
        profileNickname: null,
        signIn: unavailableSignIn,
        signOut: unavailableSignOut,
        completeNicknameSetup: () => setNeedsNicknameSetup(false),
        resetPassword: unavailableResetPassword,
        updatePassword: unavailableUpdatePassword,
    }), [isLoading, needsNicknameSetup, unavailableResetPassword, unavailableSignIn, unavailableSignOut, unavailableUpdatePassword]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}


export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

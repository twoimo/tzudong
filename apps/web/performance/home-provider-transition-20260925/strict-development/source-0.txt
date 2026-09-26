'use client';

import { memo, useLayoutEffect, useState, type ComponentType, type ReactNode } from 'react';
import { AuthContext, useAuth, type AuthContextType } from '@/contexts/AuthContextBase';
import { NotificationContext, useNotifications } from '@/contexts/NotificationContextBase';
import type { NotificationContextType } from '@/types/notification';

type ProviderComponent = ComponentType<{ children: ReactNode }>;
type SessionSnapshot = {
    auth: AuthContextType;
    notifications: NotificationContextType;
    authSource: ProviderComponent;
    notificationSource: ProviderComponent;
};
type RuntimeProps = {
    AuthProvider: ProviderComponent | null;
    NotificationProvider: ProviderComponent | null;
    publish: (snapshot: SessionSnapshot) => void;
};

function ReadSessionContexts({
    AuthProvider,
    NotificationProvider,
    publish,
}: Required<RuntimeProps> & { AuthProvider: ProviderComponent; NotificationProvider: ProviderComponent }) {
    const auth = useAuth();
    const notifications = useNotifications();
    useLayoutEffect(() => {
        publish({ auth, notifications, authSource: AuthProvider, notificationSource: NotificationProvider });
    }, [auth, notifications, AuthProvider, NotificationProvider, publish]);
    return null;
}

// Publishing a snapshot must not re-render the source providers: some source
// values are new objects on each render. The runtime also stays outside the
// forwarded contexts so it cannot subscribe to its own projected value.
const LoadedSessionRuntime = memo(function LoadedSessionRuntime({
    AuthProvider, NotificationProvider, publish,
}: RuntimeProps) {
    if (!AuthProvider || !NotificationProvider) return null;
    return (
        <AuthProvider>
            <NotificationProvider>
                <ReadSessionContexts AuthProvider={AuthProvider} NotificationProvider={NotificationProvider} publish={publish} />
            </NotificationProvider>
        </AuthProvider>
    );
});

/** Keep the application mounted while lazy providers become available. */
export function HomeSessionProviderBridge({
    children, AuthProvider, NotificationProvider,
}: Omit<RuntimeProps, 'publish'> & { children: ReactNode }) {
    const anonymousAuth = useAuth();
    const staticNotifications = useNotifications();
    const [snapshot, publish] = useState<SessionSnapshot | null>(null);
    const ready = Boolean(AuthProvider && NotificationProvider);
    const current = ready && snapshot?.authSource === AuthProvider
        && snapshot.notificationSource === NotificationProvider ? snapshot : null;

    useLayoutEffect(() => {
        if (!ready) publish(null);
    }, [ready]);

    return (
        <>
            <LoadedSessionRuntime AuthProvider={AuthProvider} NotificationProvider={NotificationProvider} publish={publish} />
            <AuthContext.Provider value={current?.auth ?? anonymousAuth}>
                <NotificationContext.Provider value={current?.notifications ?? staticNotifications}>
                    {children}
                </NotificationContext.Provider>
            </AuthContext.Provider>
        </>
    );
}

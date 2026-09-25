import React from 'react';
import { AnonymousHomeAuthProvider } from '../../contexts/AuthContextBase';
import { StaticNotificationProvider } from '../../contexts/NotificationContextBase';
const isPublicRestrictedMode = false;
export function BaselineBoundary({children, hasStoredSession, AuthProvider, NotificationProvider}) {
    if (hasStoredSession && AuthProvider && NotificationProvider) {
        return (
            <AuthProvider>
                <NotificationProvider>{children}</NotificationProvider>
            </AuthProvider>
        );
    }

    return (
        <AnonymousHomeAuthProvider isLoading={isPublicRestrictedMode ? false : hasStoredSession}>
            <StaticNotificationProvider>{children}</StaticNotificationProvider>
        </AnonymousHomeAuthProvider>
    );
}

import React from 'react';
import { AnonymousHomeAuthProvider } from '../../contexts/AuthContextBase';
import { StaticNotificationProvider } from '../../contexts/NotificationContextBase';
import { HomeSessionProviderBridge } from '../../components/home/home-session-provider-bridge';
const isPublicRestrictedMode = false;
export function CandidateBoundary({children, hasStoredSession, AuthProvider, NotificationProvider}) {
    return (
        <AnonymousHomeAuthProvider
            key={hasStoredSession ? 'session' : 'anonymous'}
            isLoading={isPublicRestrictedMode ? false : hasStoredSession}
        >
            <StaticNotificationProvider>
                <HomeSessionProviderBridge
                    AuthProvider={hasStoredSession ? AuthProvider : null}
                    NotificationProvider={hasStoredSession ? NotificationProvider : null}
                >
                    {children}
                </HomeSessionProviderBridge>
            </StaticNotificationProvider>
        </AnonymousHomeAuthProvider>
    );
}

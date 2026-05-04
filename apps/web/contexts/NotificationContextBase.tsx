'use client';

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { NotificationContextType } from '@/types/notification';

export const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

const noop = () => undefined;

export const EMPTY_NOTIFICATION_CONTEXT: NotificationContextType = {
    notifications: [],
    unreadCount: 0,
    markAsRead: noop,
    markAllAsRead: noop,
    addNotification: noop,
    removeNotification: noop,
};

export function StaticNotificationProvider({ children }: { children: ReactNode }) {
    return (
        <NotificationContext.Provider value={EMPTY_NOTIFICATION_CONTEXT}>
            {children}
        </NotificationContext.Provider>
    );
}

export const useNotifications = () => {
    const context = useContext(NotificationContext);
    if (context === undefined) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
};

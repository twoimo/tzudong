import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Notification, NotificationContextType, NotificationType } from '@/types/notification';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { user } = useAuth();

    // 알림 로드 함수
    const loadNotifications = useCallback(async () => {
        if (!user) {
            setNotifications([]);
            setIsLoading(false);
            return;
        }

        try {
            const { data, error } = await supabase
                .from('notifications')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(50); // 최근 50개만 로드

            if (error) {
                // 알림 테이블이 존재하지 않는 경우 조용히 무시
                if (error.code === 'PGRST205' || error.message?.includes('notifications')) {
                    console.warn('알림 시스템이 아직 설정되지 않았습니다. 관리자에게 문의하세요.');
                } else {
                    console.error('알림 로드 실패:', error);
                }
                setNotifications([]);
            } else {
                const formattedNotifications: Notification[] = (data || []).map(n => ({
                    id: n.id,
                    type: n.type as NotificationType,
                    title: n.title,
                    message: n.message,
                    createdAt: new Date(n.created_at),
                    isRead: n.is_read,
                    data: n.data || {}
                }));
                setNotifications(formattedNotifications);
            }
        } catch (error) {
            console.error('알림 로드 중 오류:', error);
            setNotifications([]);
        } finally {
            setIsLoading(false);
        }
    }, [user]);

    // 초기 알림 로드
    useEffect(() => {
        loadNotifications();
    }, [loadNotifications]);

    // 실시간 알림 구독
    useEffect(() => {
        if (!user) return;

        const channel = supabase
            .channel('notifications')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${user.id}`
                },
                (payload) => {
                    const newNotification: Notification = {
                        id: payload.new.id,
                        type: payload.new.type as NotificationType,
                        title: payload.new.title,
                        message: payload.new.message,
                        createdAt: new Date(payload.new.created_at),
                        isRead: payload.new.is_read,
                        data: payload.new.data || {}
                    };
                    setNotifications(prev => [newNotification, ...prev]);
                }
            )
            .subscribe((status) => {
                // 알림 테이블이 존재하지 않는 경우 경고 로그만 출력
                if (status === 'CHANNEL_ERROR') {
                    console.warn('알림 실시간 구독 실패 - 테이블이 존재하지 않을 수 있습니다.');
                }
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user]);

    const unreadCount = notifications.filter(n => !n.isRead).length;

    const markAsRead = async (id: string) => {
        try {
            const { error } = await supabase.rpc('mark_notification_read', { notification_uuid: id });
            if (error) throw error;

            setNotifications(prev =>
                prev.map(n => n.id === id ? { ...n, isRead: true } : n)
            );
        } catch (error) {
            console.error('알림 읽음 처리 실패:', error);
            // 로컬 상태에서만 업데이트 (서버 함수가 없는 경우)
            setNotifications(prev =>
                prev.map(n => n.id === id ? { ...n, isRead: true } : n)
            );
        }
    };

    const markAllAsRead = async () => {
        try {
            const { error } = await supabase.rpc('mark_all_notifications_read');
            if (error) throw error;

            setNotifications(prev =>
                prev.map(n => ({ ...n, isRead: true }))
            );
        } catch (error) {
            console.error('모든 알림 읽음 처리 실패:', error);
            // 로컬 상태에서만 업데이트 (서버 함수가 없는 경우)
            setNotifications(prev =>
                prev.map(n => ({ ...n, isRead: true }))
            );
        }
    };

    const addNotification = async (notification: Omit<Notification, 'id' | 'createdAt' | 'isRead'>) => {
        if (!user) return;

        try {
            const { data, error } = await supabase.rpc('create_user_notification', {
                p_user_id: user.id,
                p_type: notification.type,
                p_title: notification.title,
                p_message: notification.message,
                p_data: notification.data || {}
            });

            if (error) throw error;

            // 실시간 구독으로 인해 자동으로 추가될 것이므로 여기서는 추가하지 않음
        } catch (error) {
            console.error('알림 생성 실패:', error);
            // 서버 함수가 없는 경우 로컬에서만 처리
            console.warn('알림 서버 함수가 아직 설정되지 않았습니다.');
        }
    };

    const removeNotification = async (id: string) => {
        try {
            const { error } = await supabase.rpc('delete_notification', { notification_uuid: id });
            if (error) throw error;

            setNotifications(prev => prev.filter(n => n.id !== id));
        } catch (error) {
            console.error('알림 삭제 실패:', error);
            // 서버 함수가 없는 경우 로컬에서만 처리
            setNotifications(prev => prev.filter(n => n.id !== id));
        }
    };

    const value: NotificationContextType = {
        notifications,
        unreadCount,
        markAsRead,
        markAllAsRead,
        addNotification,
        removeNotification
    };

    return (
        <NotificationContext.Provider value={value}>
            {children}
        </NotificationContext.Provider>
    );
};

export const useNotifications = () => {
    const context = useContext(NotificationContext);
    if (context === undefined) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
};

// 관리자 공지사항 등록 알림 생성 함수 (모든 사용자에게)
export const createAdminAnnouncement = async (title: string, message: string, customData?: Record<string, unknown>) => {
    try {
        const { error } = await supabase.rpc('create_admin_announcement_notification', {
            p_title: title,
            p_message: message,
            p_data: customData || {}
        });
        if (error) throw error;
    } catch (error) {
        console.error('관리자 공지사항 알림 생성 실패:', error);
        console.warn('알림 시스템이 아직 설정되지 않았습니다.');
    }
};

// 신규 맛집 등록 알림 생성 함수 (모든 사용자에게)
export const createNewRestaurantNotification = async (restaurantName: string, address: string, customData?: Record<string, unknown>) => {
    const title = '새로운 맛집 등록';
    const message = `"${restaurantName}" 맛집이 쯔동여지도에 새로 등록되었습니다!`;

    try {
        const { error } = await supabase.rpc('create_new_restaurant_notification', {
            p_title: title,
            p_message: message,
            p_data: {
                restaurantName,
                address,
                ...customData
            }
        });
        if (error) throw error;
    } catch (error) {
        console.error('신규 맛집 알림 생성 실패:', error);
        console.warn('알림 시스템이 아직 설정되지 않았습니다.');
    }
};

// 사용자 랭킹 업데이트 알림 생성 함수
export const createUserRankingNotification = async (userId: string, ranking: number, period: string = 'monthly') => {
    try {
        const { error } = await supabase.rpc('create_ranking_notification', {
            p_user_id: userId,
            p_ranking: ranking,
            p_period: period
        });
        if (error) throw error;
    } catch (error) {
        console.error('사용자 랭킹 알림 생성 실패:', error);
        console.warn('알림 시스템이 아직 설정되지 않았습니다.');
    }
};

// 특정 사용자에게 알림 생성 함수
export const createUserNotification = async (
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    customData?: Record<string, unknown>
) => {
    try {
        const { error } = await supabase.rpc('create_user_notification', {
            p_user_id: userId,
            p_type: type,
            p_title: title,
            p_message: message,
            p_data: customData || {}
        });
        if (error) throw error;
    } catch (error) {
        console.error('사용자 알림 생성 실패:', error);
        console.warn('알림 시스템이 아직 설정되지 않았습니다.');
    }
};

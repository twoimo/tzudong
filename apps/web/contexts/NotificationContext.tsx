'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Notification, NotificationContextType, NotificationType } from '@/types/notification';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { user } = useAuth();
    const userId = user?.id; // [OPTIMIZATION] user 객체 대신 id만 추출

    // 알림 로드 함수 - [OPTIMIZATION] userId 의존성
    const loadNotifications = useCallback(async () => {
        if (!userId) {
            setNotifications([]);
            setIsLoading(false);
            return;
        }

        try {
            const { data, error } = await (supabase
                .from('notifications') as any)
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(50); // 최근 50개만 로드

            if (error) {
                // 테이블이 없는 경우 조용히 무시
                if (error.code === 'PGRST116' || error.code === 'PGRST204' || error.message?.includes('relation') || error.message?.includes('notifications')) {
                    // 개발 환경에서만 정보 표시
                    if (process.env.NODE_ENV === 'development') {
                        console.info('[NotificationContext] 알림 테이블이 존재하지 않음 (정상, 무시됨)');
                    }
                } else {
                    console.error('알림 로드 실패:', error);
                }
                setNotifications([]);
            } else {
                const formattedNotifications: Notification[] = (data || []).map((n: any) => ({
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
    }, [userId]); // [OPTIMIZATION] user → userId

    // 초기 알림 로드
    useEffect(() => {
        loadNotifications();
    }, [loadNotifications]);

    // 실시간 알림 구독 - [OPTIMIZATION] userId 의존성
    useEffect(() => {
        if (!userId) return;

        const channel = supabase
            .channel('notifications')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${userId}`
                },
                (payload) => {
                    const newNotification: Notification = {
                        id: (payload.new as any).id,
                        type: (payload.new as any).type as NotificationType,
                        title: (payload.new as any).title,
                        message: (payload.new as any).message,
                        createdAt: new Date((payload.new as any).created_at),
                        isRead: (payload.new as any).is_read,
                        data: (payload.new as any).data || {}
                    };
                    setNotifications(prev => [newNotification, ...prev]);
                }
            )
            .subscribe((status) => {
                // 개발 환경에서만 한 번만 경고 표시
                if (status === 'CHANNEL_ERROR' && process.env.NODE_ENV === 'development') {
                    console.info('[NotificationContext] 알림 실시간 구독 실패 (notifications 테이블이 없을 수 있음, 무시됨)');
                }
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, [userId]); // [OPTIMIZATION] user → userId

    const unreadCount = notifications.filter(n => !n.isRead).length;

    const markAsRead = async (id: string) => {
        try {
            const { error } = await (supabase as any).rpc('mark_notification_read', { notification_uuid: id });
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
            const { error } = await (supabase as any).rpc('mark_all_notifications_read');
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
            const { data, error } = await (supabase as any).rpc('create_user_notification', {
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
            const { error } = await (supabase as any).rpc('delete_notification', { notification_uuid: id });
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
        const { error } = await (supabase as any).rpc('create_admin_announcement_notification', {
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
        const { error } = await (supabase as any).rpc('create_new_restaurant_notification', {
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
        const { error } = await (supabase as any).rpc('create_ranking_notification', {
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
        const { error } = await (supabase as any).rpc('create_user_notification', {
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

// 제보 승인 알림 생성 함수
export const createSubmissionApprovedNotification = async (
    userId: string,
    restaurantName: string,
    submissionType: 'new' | 'edit',
    customData?: Record<string, unknown>
) => {
    const typeLabel = submissionType === 'new' ? '신규 맛집 제보' : '정보 수정 제보';
    const title = '제보가 승인되었습니다 ✅';
    const message = `"${restaurantName}" ${typeLabel}가 관리자에 의해 승인되어 지도에 반영되었습니다!`;

    try {
        const { error } = await (supabase as any).rpc('create_user_notification', {
            p_user_id: userId,
            p_type: 'submission_approved',
            p_title: title,
            p_message: message,
            p_data: { restaurantName, submissionType, ...customData }
        });
        if (error) throw error;
    } catch (error) {
        console.error('제보 승인 알림 생성 실패:', error);
    }
};

// 제보 거부 알림 생성 함수 (거부 사유 포함)
export const createSubmissionRejectedNotification = async (
    userId: string,
    restaurantName: string,
    rejectionReason: string,
    submissionType: 'new' | 'edit',
    customData?: Record<string, unknown>
) => {
    const typeLabel = submissionType === 'new' ? '신규 맛집 제보' : '정보 수정 제보';
    const title = '제보가 반려되었습니다';
    const message = `"${restaurantName}" ${typeLabel}가 다음 사유로 반려되었습니다: ${rejectionReason}`;

    try {
        const { error } = await (supabase as any).rpc('create_user_notification', {
            p_user_id: userId,
            p_type: 'submission_rejected',
            p_title: title,
            p_message: message,
            p_data: { restaurantName, rejectionReason, submissionType, ...customData }
        });
        if (error) throw error;
    } catch (error) {
        console.error('제보 거부 알림 생성 실패:', error);
    }
};

// 리뷰 승인 알림 생성 함수
export const createReviewApprovedNotification = async (
    userId: string,
    restaurantName: string,
    customData?: Record<string, unknown>
) => {
    const title = '리뷰 승인 완료';
    const message = `"${restaurantName}" 리뷰가 관리자에 의해 승인되었습니다!`;

    try {
        const { error } = await (supabase as any).rpc('create_user_notification', {
            p_user_id: userId,
            p_type: 'review_approved',
            p_title: title,
            p_message: message,
            p_data: { restaurantName, ...customData }
        });
        if (error) throw error;
    } catch (error) {
        console.error('리뷰 승인 알림 생성 실패:', error);
    }
};

// 리뷰 거부 알림 생성 함수 (거부 사유 포함)
export const createReviewRejectedNotification = async (
    userId: string,
    restaurantName: string,
    rejectionReason: string,
    customData?: Record<string, unknown>
) => {
    const title = '리뷰가 반려되었습니다';
    const message = `"${restaurantName}" 리뷰가 다음 사유로 반려되었습니다: ${rejectionReason}`;

    try {
        const { error } = await (supabase as any).rpc('create_user_notification', {
            p_user_id: userId,
            p_type: 'review_rejected',
            p_title: title,
            p_message: message,
            p_data: { restaurantName, rejectionReason, ...customData }
        });
        if (error) throw error;
    } catch (error) {
        console.error('리뷰 거부 알림 생성 실패:', error);
    }
};

// 여러 맛집 일괄 등록 알림 (배치 알림)
export const createBatchNewRestaurantsNotification = async (
    restaurantNames: string[],
    customData?: Record<string, unknown>
) => {
    const count = restaurantNames.length;
    if (count === 0) return;

    const title = count === 1 ? '새로운 맛집 등록' : `${count}개의 새로운 맛집 등록`;
    const message = count === 1
        ? `"${restaurantNames[0]}" 맛집이 쯔동여지도에 새로 등록되었습니다!`
        : `"${restaurantNames.slice(0, 3).join('", "')}"${count > 3 ? ` 외 ${count - 3}곳` : ''} 맛집이 쯔동여지도에 새로 등록되었습니다!`;

    try {
        const { error } = await (supabase as any).rpc('create_new_restaurant_notification', {
            p_title: title,
            p_message: message,
            p_data: { restaurantNames, count, ...customData }
        });
        if (error) throw error;
    } catch (error) {
        console.error('배치 맛집 알림 생성 실패:', error);
        console.warn('알림 시스템이 아직 설정되지 않았습니다.');
    }
};


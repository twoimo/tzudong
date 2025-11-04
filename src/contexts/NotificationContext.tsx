import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Notification, NotificationContextType, NotificationType } from '@/types/notification';

// 실제 구현에서는 Supabase나 다른 백엔드에서 데이터를 가져옵니다
const mockNotifications: Omit<Notification, 'id' | 'createdAt' | 'isRead'>[] = [
  {
    type: 'admin_announcement',
    title: '쯔동여지도 공지사항',
    message: '서비스 점검 안내: 2025년 11월 10일 02:00-04:00',
    data: { announcementId: 'ann-001' }
  },
  {
    type: 'new_restaurant',
    title: '새로운 맛집 등록',
    message: '강남역 근처에 새로운 초밥 맛집이 등록되었습니다!',
    data: { restaurantId: 'rest-001' }
  },
  {
    type: 'review_approved',
    title: '리뷰 승인됨',
    message: '귀하의 리뷰가 관리자 승인을 받았습니다.',
    data: { reviewId: 'review-001' }
  },
  {
    type: 'user_ranking',
    title: '랭킹 업데이트',
    message: '축하합니다! 이번 달 맛집 리뷰어 TOP 10에 선정되었습니다.',
    data: { ranking: 7, period: 'monthly' }
  }
];

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // 초기 알림 로드 (실제로는 API 호출)
  useEffect(() => {
    const loadNotifications = () => {
      const storedNotifications = localStorage.getItem('tzudong_notifications');
      if (storedNotifications) {
        const parsed = JSON.parse(storedNotifications);
        // Date 객체로 변환
        const notificationsWithDates = parsed.map((n: any) => ({
          ...n,
          createdAt: new Date(n.createdAt)
        }));
        setNotifications(notificationsWithDates);
      } else {
        // 초기 모의 데이터
        const initialNotifications = mockNotifications.map((notification, index) => ({
          ...notification,
          id: `notif-${index + 1}`,
          createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000), // 최근 7일 내 랜덤
          isRead: Math.random() > 0.5 // 절반은 읽음 상태로
        }));
        setNotifications(initialNotifications);
        localStorage.setItem('tzudong_notifications', JSON.stringify(initialNotifications));
      }
    };

    loadNotifications();
  }, []);

  // 알림 저장
  const saveNotifications = (newNotifications: Notification[]) => {
    localStorage.setItem('tzudong_notifications', JSON.stringify(newNotifications));
    setNotifications(newNotifications);
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const markAsRead = (id: string) => {
    const updated = notifications.map(n =>
      n.id === id ? { ...n, isRead: true } : n
    );
    saveNotifications(updated);
  };

  const markAllAsRead = () => {
    const updated = notifications.map(n => ({ ...n, isRead: true }));
    saveNotifications(updated);
  };

  const addNotification = (notification: Omit<Notification, 'id' | 'createdAt' | 'isRead'>) => {
    const newNotification: Notification = {
      ...notification,
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date(),
      isRead: false
    };
    const updated = [newNotification, ...notifications];
    saveNotifications(updated);
  };

  const removeNotification = (id: string) => {
    const updated = notifications.filter(n => n.id !== id);
    saveNotifications(updated);
  };

  // 새로운 알림 타입에 따른 자동 알림 생성 (실제로는 서버 이벤트나 API로 처리)
  const createNotification = (type: NotificationType, customData?: Record<string, any>) => {
    const notificationTemplates = {
      admin_announcement: {
        title: '쯔동여지도 공지사항',
        message: '새로운 공지사항이 등록되었습니다.',
      },
      new_restaurant: {
        title: '새로운 맛집 등록',
        message: '새로운 맛집이 쯔동여지도에 등록되었습니다!',
      },
      review_approved: {
        title: '리뷰 승인됨',
        message: '귀하의 리뷰가 관리자 승인을 받았습니다.',
      },
      review_rejected: {
        title: '리뷰 거부됨',
        message: '귀하의 리뷰가 관리자 검토 후 거부되었습니다.',
      },
      user_ranking: {
        title: '랭킹 업데이트',
        message: '사용자 랭킹이 업데이트되었습니다.',
      }
    };

    const template = notificationTemplates[type];
    if (template) {
      addNotification({
        type,
        title: template.title,
        message: customData?.message || template.message,
        data: customData
      });
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

// 알림 생성 헬퍼 함수 (외부에서 사용)
export const createNotification = (type: NotificationType, customData?: Record<string, any>) => {
  // 실제로는 이벤트 시스템이나 API를 통해 처리
  const event = new CustomEvent('createNotification', {
    detail: { type, customData }
  });
  window.dispatchEvent(event);
};

// 관리자 공지사항 등록 알림 생성 함수
export const createAdminAnnouncement = (title: string, message: string, customData?: Record<string, any>) => {
  // 모든 사용자에게 공지사항 알림 생성
  const event = new CustomEvent('createNotification', {
    detail: {
      type: 'admin_announcement',
      customData: { ...customData, message, title }
    }
  });
  window.dispatchEvent(event);
};

// 사용자 랭킹 업데이트 알림 생성 함수
export const createUserRankingNotification = (ranking: number, period: string = 'monthly') => {
  const event = new CustomEvent('createNotification', {
    detail: {
      type: 'user_ranking',
      customData: {
        ranking,
        period,
        message: `축하합니다! 이번 ${period === 'monthly' ? '달' : '주'} 맛집 리뷰어 TOP ${ranking}에 선정되었습니다.`
      }
    }
  });
  window.dispatchEvent(event);
};

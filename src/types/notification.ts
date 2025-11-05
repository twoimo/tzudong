export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: Date;
  isRead: boolean;
  data?: Record<string, any>; // 추가 데이터 (맛집 ID, 리뷰 ID 등)
}

export type NotificationType =
  | 'admin_announcement'    // 관리자 공지사항 등록
  | 'new_restaurant'        // 신규 맛집 등록
  | 'review_approved'       // 제보 & 리뷰 승인
  | 'review_rejected'       // 제보 & 리뷰 거부
  | 'user_ranking';         // 사용자 랭킹 업데이트

export interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  addNotification: (notification: Omit<Notification, 'id' | 'createdAt' | 'isRead'>) => void;
  removeNotification: (id: string) => void;
}

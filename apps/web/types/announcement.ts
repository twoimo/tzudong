import { z } from 'zod';

// 공지사항 Zod 스키마
export const AnnouncementSchema = z.object({
    id: z.string().uuid(),
    title: z.string().min(1, '제목을 입력해주세요').max(100, '제목은 100자 이내로 입력해주세요'),
    content: z.string().min(1, '내용을 입력해주세요'),
    isActive: z.boolean().default(true),
    showOnBanner: z.boolean().default(false), // 메인화면 배너에 노출
    priority: z.number().int().min(0).max(100).default(0),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

// TypeScript 타입
export type Announcement = z.infer<typeof AnnouncementSchema>;

// 공지사항 생성/수정용 스키마
export const AnnouncementFormSchema = AnnouncementSchema.omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export type AnnouncementFormData = z.infer<typeof AnnouncementFormSchema>;

// 더미 데이터
export const DUMMY_ANNOUNCEMENTS: Announcement[] = [
    {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        title: '🎉 쯔동여지도 v2.0 업데이트 안내',
        content: `안녕하세요, 쯔동여지도입니다!

오랫동안 준비해온 대규모 업데이트를 드디어 공개합니다. 이번 업데이트에서는 사용자분들의 피드백을 적극 반영하여 더욱 편리하고 다양한 기능을 제공합니다.

## 🌍 해외 맛집 지도 기능 추가
쯔양이 방문한 해외 맛집들도 이제 지도에서 확인할 수 있습니다! 일본, 태국, 베트남 등 다양한 국가의 맛집 정보를 제공하며, 구글 지도 기반으로 정확한 위치를 안내합니다.

## 📸 리뷰 인증샷 업로드
맛집 방문 후 인증샷을 업로드하면 특별한 뱃지를 획득할 수 있습니다. 영수증 사진이나 음식 사진을 함께 올려주세요!

## 🏆 맛집 도장깨기 시스템
전국의 쯔양 맛집을 도장깨기 형식으로 방문해보세요. 지역별, 카테고리별 도장을 모두 모으면 특별한 칭호가 부여됩니다.

## 🔔 실시간 알림 시스템
새로운 맛집이 등록되거나 관심 맛집에 리뷰가 달리면 실시간으로 알림을 받을 수 있습니다.

## 💡 기타 개선사항
- 지도 로딩 속도 50% 개선
- 다크 모드 지원
- 모바일 UI 최적화
- 검색 기능 강화

앞으로도 더 나은 서비스를 위해 노력하겠습니다. 많은 이용 부탁드립니다! 🍽️

문의사항이 있으시면 언제든 연락 주세요.
감사합니다.`,
        isActive: true,
        showOnBanner: true,
        priority: 100,
        createdAt: '2025-12-01T09:00:00.000Z',
        updatedAt: '2025-12-01T09:00:00.000Z',
    },
    {
        id: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
        title: '📢 서버 점검 안내 (12/10 02:00~06:00)',
        content: `서비스 안정화를 위한 정기 서버 점검이 예정되어 있습니다.

📅 점검 일시
2025년 12월 10일 (화) 02:00 ~ 06:00 (4시간)

■ 점검 내용
1. 데이터베이스 최적화 작업
   - 인덱스 재구성
   - 쿼리 성능 개선
   
2. 보안 업데이트
   - SSL 인증서 갱신
   - 보안 패치 적용

3. 서버 인프라 업그레이드
   - 서버 스펙 증설
   - CDN 캐시 정책 변경

■ 영향 범위
- 점검 시간 동안 모든 서비스 이용 불가
- 로그인, 지도 조회, 리뷰 작성 등 전체 기능 중단

■ 보상 안내
점검으로 인한 불편을 드려 죄송합니다.
점검 완료 후 모든 사용자에게 특별 뱃지를 지급해 드립니다.

이용에 불편을 드려 죄송하며, 더 나은 서비스로 보답하겠습니다.`,
        isActive: true,
        showOnBanner: false,
        priority: 90,
        createdAt: '2025-12-03T14:30:00.000Z',
        updatedAt: '2025-12-03T14:30:00.000Z',
    },
    {
        id: 'c3d4e5f6-a7b8-9012-cdef-345678901234',
        title: '🏆 12월 맛집 도장깨기 이벤트',
        content: `12월 한 달간 맛집 도장깨기 이벤트를 진행합니다!

🎯 이벤트 기간
2025년 12월 1일 ~ 31일

📋 참여 방법
1. 쯔동여지도에서 맛집 방문
2. 인증샷과 함께 리뷰 작성
3. 도장 자동 적립!

🎁 보상 안내
• 도장 5개 → 브론즈 뱃지 + 100포인트
• 도장 10개 → 실버 뱃지 + 300포인트
• 도장 20개 → 골드 뱃지 + 500포인트
• 도장 30개 → 다이아 뱃지 + 1000포인트

⭐ 추가 보너스
- 같은 지역 5곳 방문 시: 지역 마스터 칭호
- 같은 카테고리 5곳 방문 시: 카테고리 전문가 칭호

많은 참여 부탁드립니다!`,
        isActive: false,
        showOnBanner: false,
        priority: 50,
        createdAt: '2025-11-28T10:00:00.000Z',
        updatedAt: '2025-12-01T08:00:00.000Z',
    },
];

// 활성화된 공지사항만 필터링 (우선순위 순)
export const getActiveAnnouncements = (): Announcement[] => {
    return DUMMY_ANNOUNCEMENTS
        .filter(a => a.isActive)
        .sort((a, b) => b.priority - a.priority);
};

// 배너에 표시할 공지사항 가져오기 (isActive + showOnBanner인 것 중 가장 높은 우선순위)
export const getTopAnnouncement = (): Announcement | null => {
    const bannerAnnouncements = DUMMY_ANNOUNCEMENTS
        .filter(a => a.isActive && a.showOnBanner)
        .sort((a, b) => b.priority - a.priority);
    return bannerAnnouncements.length > 0 ? bannerAnnouncements[0] : null;
};

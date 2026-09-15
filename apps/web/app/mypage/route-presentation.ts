import { Bookmark, Edit3, Heart, MessageSquare, PlusCircle, UserRound, type LucideIcon } from "lucide-react";

export type MyPageMobileRouteHeader = {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
};

export const MOBILE_ROUTE_HEADERS: MyPageMobileRouteHeader[] = [
  {
    href: "/mypage/bookmarks",
    title: "나의 북마크 내역",
    description: "저장한 맛집을 확인하세요.",
    icon: Bookmark,
  },
  {
    href: "/mypage/reviews",
    title: "나의 리뷰 내역",
    description: "작성한 리뷰 상태를 확인하세요.",
    icon: MessageSquare,
  },
  {
    href: "/mypage/submissions/new",
    title: "신규 맛집 제보",
    description: "새 맛집 제보 상태를 확인하세요.",
    icon: PlusCircle,
  },
  {
    href: "/mypage/submissions/edit",
    title: "맛집 수정 요청",
    description: "수정 요청 처리 상태를 확인하세요.",
    icon: Edit3,
  },
  {
    href: "/mypage/submissions/recommend",
    title: "쯔양 맛집 제보",
    description: "추천한 맛집을 확인하세요.",
    icon: Heart,
  },
  {
    href: "/mypage/profile",
    title: "쯔동여지도 마이페이지",
    description: "내 활동과 계정 정보를 관리하세요.",
    icon: UserRound,
  },
];

export function resolveMobileRouteHeader(pathname: string | null) {
  return (
    MOBILE_ROUTE_HEADERS.find((item) => pathname?.startsWith(item.href)) ??
    MOBILE_ROUTE_HEADERS[MOBILE_ROUTE_HEADERS.length - 1]
  );
}


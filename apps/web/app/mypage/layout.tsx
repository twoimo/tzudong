"use client";

import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";

import { MyPageSidebar } from "@/components/mypage/MyPageSidebar";

export default function MyPageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading: userLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!userLoading && !user) {
      router.push("/");
    }
  }, [user, userLoading, router]);

  // 로그인 안한 상태로 접근 시 아무것도 안보여줌
  // (useEffect에서 홈으로 리다이렉트 처리)
  if (!user) return null;

  return (
    <div className="h-[calc(100vh-64px)] bg-background overflow-hidden">
      <div className="container mx-auto h-full max-w-6xl flex">
        {/* 사이드바는 자체 높이를 가지며 레이아웃 내에 고정됨 */}
        <MyPageSidebar />

        {/* 콘텐츠 영역만 스크롤 가능하도록 설정 */}
        <div className="flex-1 h-full overflow-y-auto min-w-0">
          <div className="p-4 md:p-8 md:pt-14 pb-20">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

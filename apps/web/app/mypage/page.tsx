"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MyPage() {
  const router = useRouter();

  useEffect(() => {
    // 기본적으로 신규 맛집 제보 페이지로 리다이렉트
    router.replace("/mypage/submissions/new");
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="animate-pulse text-muted-foreground">
        로딩 중...
      </div>
    </div>
  );
}

"use client";

import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";

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
    <div className="h-full overflow-y-auto bg-background">
      <div className="container mx-auto py-6 px-4 max-w-4xl">
        {children}
      </div>
    </div>
  );
}

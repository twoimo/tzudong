"use client";

import Link from "next/link";
import { Map } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHomeReturnHref } from "@/hooks/use-home-return-href";
import { isPublicRestrictedMode } from "@/lib/site-config";

const guidance = {
  new: "새 제보는 지도의 ‘맛집 제보하기’에서 시작할 수 있습니다.",
  edit: "수정할 맛집을 지도에서 열고 ‘수정 요청’을 선택하세요.",
  recommend: "새 추천은 지도의 ‘맛집 제보하기’에서 ‘쯔양에게 맛집 제보’를 선택하세요.",
} as const;

export function MyPageSubmissionGuide({
  kind,
  userId,
}: {
  kind: keyof typeof guidance;
  userId: string | null;
}) {
  const homeReturnHref = useHomeReturnHref(userId);
  return (
    <div className="flex flex-col items-start gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between" data-mypage-submission-guide={kind}>
      <p className="text-sm leading-6 text-muted-foreground">
        {isPublicRestrictedMode ? "제보 작성은 현재 이용할 수 없습니다." : guidance[kind]}
      </p>
      <Button asChild variant="outline" className="min-h-11 shrink-0 gap-2">
        <Link href={homeReturnHref}>
          <Map className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          지도로 돌아가기
        </Link>
      </Button>
    </div>
  );
}

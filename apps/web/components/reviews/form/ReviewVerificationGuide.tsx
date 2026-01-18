import { memo } from "react";
import { Card } from "@/components/ui/card";

export const ReviewVerificationGuide = memo(function ReviewVerificationGuide() {
    return (
        <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3">
            <div className="space-y-1 text-xs text-amber-900 dark:text-amber-100">
                <p className="font-semibold flex items-center gap-1">
                    📸 영수증 인증 가이드
                </p>
                <ul className="space-y-0.5 ml-4 list-disc text-amber-700 dark:text-amber-300">
                    <li><b>영수증 전체</b>가 잘리지 않도록 촬영해주세요</li>
                    <li><b>AI 자동 분석</b>으로 정보를 편리하게 채워보세요 ✨</li>
                    <li>방문일은 <span className="text-red-600 font-semibold">3개월 이내</span>여야 합니다</li>
                </ul>
            </div>
        </Card>
    );
});

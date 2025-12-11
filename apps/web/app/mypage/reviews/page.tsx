"use client";

import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare, Construction } from "lucide-react";

export default function ReviewsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageSquare className="h-6 w-6" />
            내 리뷰
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            내가 작성한 리뷰 목록입니다
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Construction className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">준비 중입니다</p>
          <p className="text-sm mt-2">
            맛집 리뷰 기능이 곧 추가될 예정입니다.
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            조금만 기다려주세요!
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

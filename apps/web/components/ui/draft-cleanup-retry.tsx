"use client";

import { Button } from "@/components/ui/button";

export function DraftCleanupRetry({ onRetry }: { onRetry: () => void }) {
    return <div role="alert" className="space-y-2 rounded-xl border border-border p-4 text-sm">
        <p>제출은 완료되었습니다. 기기의 임시 저장 내용만 정리하지 못했어요.</p>
        <Button type="button" variant="outline" onClick={onRetry}>제출한 초안 정리 다시 시도</Button>
    </div>;
}

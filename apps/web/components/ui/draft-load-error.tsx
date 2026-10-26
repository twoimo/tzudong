"use client";

import { useAuth } from "@/contexts/AuthContext";
import { captureBrowserDraftEpoch, isBrowserDraftEpochCurrent } from "@/lib/privacy/browser-draft-lifecycle";
import { Button } from "@/components/ui/button";

export function DraftLoadError({ onRetry }: { onRetry: () => void }) {
    const { user } = useAuth();
    const retry = () => {
        if (user && !isBrowserDraftEpochCurrent(user.id, captureBrowserDraftEpoch(user.id), true)) {
            // Rebootstrap through AuthProvider's session, eligibility and cleanup
            // checks. A storage retry alone cannot grant a blocked owner access.
            window.location.reload();
            return;
        }
        onRetry();
    };
    return <div role="alert" className="space-y-2 p-4 text-sm">
        <p>임시 저장 내용을 확인하지 못했어요. 내용을 보호하기 위해 작성을 잠시 멈췄습니다.</p>
        <Button type="button" variant="outline" onClick={retry}>임시 저장 다시 확인</Button>
    </div>;
}

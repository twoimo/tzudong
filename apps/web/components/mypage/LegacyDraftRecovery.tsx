'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { captureBrowserDraftEpoch, isBrowserDraftEpochCurrent } from '@/lib/privacy/browser-draft-lifecycle';

export function LegacyDraftRecovery({ userId }: { userId: string }) {
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const mounted = useRef(true);
    const inFlight = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

    const recover = async () => {
        if (inFlight.current) return;
        const epoch = captureBrowserDraftEpoch(userId);
        const current = () => mounted.current && isBrowserDraftEpochCurrent(userId, epoch, true);
        if (!current()) { setMessage('계정을 다시 확인한 뒤 시도해 주세요.'); return; }
        inFlight.current = true;
        setBusy(true);
        setMessage('');
        try {
            const modules = await Promise.all([
                import('@/lib/reviewDraftDB'), import('@/lib/submissionDraftDB'), import('@/lib/editRequestDraftDB'),
            ]);
            if (!current()) return;
            const results = await Promise.allSettled(modules.map(draftModule => draftModule.recoverLegacyDrafts(userId)));
            if (!current()) return;
            const count = results.reduce((sum, result) => sum + (result.status === 'fulfilled' ? result.value : 0), 0);
            setMessage(results.some(result => result.status === 'rejected')
                ? `${count}개를 가져왔습니다. 일부 초안은 가져오지 못했습니다. 다시 시도해 주세요.`
                : count ? `${count}개 초안을 가져왔습니다. 해당 작성 화면에서 확인해 주세요.`
                    : '새로 가져온 초안이 없습니다. 현재 초안은 그대로 유지됩니다.');
        } catch {
            if (current()) setMessage('초안을 가져오지 못했습니다. 다시 시도해 주세요.');
        } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
    };
    return (
        <Card data-legacy-draft-recovery="true" className="min-w-0 rounded-2xl border border-border bg-card shadow-none md:order-5 lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-base">이전 버전 초안</CardTitle></CardHeader>
            <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">이전 버전에서 작성한 초안이 있다면 가져올 수 있습니다. 현재 초안과 기존 보존 기한은 유지됩니다. 가져온 원본은 새 저장 영역으로 옮겨집니다.</p>
                <p className="text-sm text-muted-foreground">이전 버전 탭이 열려 있으면 초안이 다시 생길 수 있습니다. 작성 중인 탭에서 임시 저장 완료를 확인한 뒤 새로고침하세요. 저장되지 않은 입력은 가져올 수 없습니다.</p>
                <Button type="button" variant="outline" disabled={busy} onClick={() => { void recover(); }}>
                    {busy ? '초안 가져오는 중…' : '이전 버전 초안 가져오기'}
                </Button>
                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">{message}</p>
            </CardContent>
        </Card>
    );
}

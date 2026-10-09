import { formatTzuyangReviewForDisplay } from '@/lib/tzuyang-review-display';
import { useRecordAction } from '@/lib/admin/use-record-action';
import { isRecordActionCancelled, recordActionErrorMessage } from '@/lib/admin/record-action-client';
import { type RecordActionReceipt, type RestaurantRecordChanges } from '@/lib/admin/record-action-contract';
import { buildEvaluationConflictInfo, getEvaluationConflictTargetId, isEvaluationRecordStatus, normalizeEvaluationRecord, withAdminEvaluationDisplayName } from '@/lib/admin/normalize-evaluation-record';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { type DbConflictInfo, type EvaluationRecord } from '@/types/evaluation';
import { normalizeCanonicalYouTubeWatchUrl } from '@/lib/youtube-url';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ADMIN_MODAL_ACTION,
  ADMIN_MODAL_CONTENT_LG_FLEX,
  ADMIN_MODAL_FOOTER_DIVIDER,
} from './admin-modal-styles';

interface DbConflictResolutionPanelProps {
  record: EvaluationRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (recordId: string, updates: Partial<EvaluationRecord>) => void;
}

export function DbConflictResolutionPanel(props: DbConflictResolutionPanelProps) {
  return props.open ? <DbConflictEditor {...props} /> : null;
}
function DbConflictEditor({ record: incomingRecord, open, onOpenChange, onSuccess }: DbConflictResolutionPanelProps) {
  const [record] = useState(incomingRecord);
  const [conflictInfo, setConflictInfo] = useState<DbConflictInfo | null>(null);
  const [targetRead, setTargetRead] = useState<'loading' | 'failed' | 'ready'>('loading');
  const [readAttempt, setReadAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const targetId = record ? getEvaluationConflictTargetId(record) : null;
    setConflictInfo(null);
    if (!record || !targetId) { setTargetRead('failed'); return () => controller.abort(); }
    setTargetRead('loading');
    void (async () => {
      try {
        const response = await fetch(`/api/admin/evaluations/${encodeURIComponent(targetId)}`, { cache: 'no-store', signal: controller.signal });
        const value = response.ok ? await response.json() : null;
        const target = normalizeEvaluationRecord(value?.record);
        const info = target && typeof value?.record?.name === 'string' && isEvaluationRecordStatus(value?.record?.status)
          ? buildEvaluationConflictInfo(record, target) : null;
        if (!info) throw new Error('RECORD_CONFLICT_READ_FAILED');
        if (!controller.signal.aborted) { setConflictInfo(info); setTargetRead('ready'); }
      } catch {
        if (!controller.signal.aborted) setTargetRead('failed');
      }
    })();
    return () => controller.abort();
  }, [record, readAttempt]);
  const { toast } = useToast();
  const [working, setLoading] = useState(false);
  const [confirmedReceipt, setConfirmedReceipt] = useState<RecordActionReceipt | null>(null);
  const refreshAfterAction = async (receipt: RecordActionReceipt) => {
    if (!record) return;
    setConfirmedReceipt(receipt);
    try {
      const response = await fetch(`/api/admin/evaluations/${encodeURIComponent(record.id)}`, { cache: 'no-store' });
      const value = response.ok ? await response.json() : null;
      const current = normalizeEvaluationRecord(value?.record);
      if (!current || current.id !== record.id || current.read_summary || (value?.record?.name !== null && typeof value?.record?.name !== 'string') || !isEvaluationRecordStatus(value?.record?.status) || !Number.isFinite(Date.parse(value?.record?.updated_at))) throw new Error('RECORD_CURRENT_READ_FAILED');
      onSuccess(record.id, withAdminEvaluationDisplayName(current));
      toast({ title: '작업 결과 확인 완료' });
      onOpenChange(false);
    } catch {
      toast({ variant: 'destructive', title: '적용은 확인되었습니다', description: '현재 정보 조회에 실패했습니다. 저장을 반복하지 말고 다시 불러와 주세요.' });
    }
  };
  const recordActions = useRecordAction(receipt => {
    if (record && receipt.targetIds.includes(record.id)) void refreshAfterAction(receipt);
  });
  const loading = working || recordActions.busy || confirmedReceipt !== null;

  const [holdReason, setHoldReason] = useState('중복 후보 검토를 위해 보류');
  const [discardOpen, setDiscardOpen] = useState(false);
  const handleOpenChange = (next: boolean) => {
    if (loading) return;
    if (!next && holdReason !== '중복 후보 검토를 위해 보류') { setDiscardOpen(true); return; }
    onOpenChange(next);
  };

  const existing = conflictInfo?.existing_restaurant;
  const newInfo = conflictInfo?.new_restaurant;
  const canonicalYoutubeUrl = normalizeCanonicalYouTubeWatchUrl(record?.youtube_link);

  const handleUpdateExisting = async () => {
    if (loading || !record || !existing || !newInfo || targetRead !== 'ready') return;
    setLoading(true);
    try {
      const meta = record.youtube_meta;
      const incomingChanges: RestaurantRecordChanges = {
        ...(meta ? { youtube_meta: {
          title: meta.title, published_at: meta.publishedAt, duration: meta.duration, is_shorts: meta.is_shorts,
          is_ads: meta.ads_info.is_ads, what_ads: meta.ads_info.what_ads ? [meta.ads_info.what_ads] : null,
        } } : {}),
        youtube_link: canonicalYoutubeUrl, tzuyang_review: newInfo.tzuyang_review || null,
        ...(newInfo.category ? { categories: [newInfo.category] as RestaurantRecordChanges['categories'] } : {}),
      };
      const payload = { mergeTargetId: existing.id, incomingChanges };
      await refreshAfterAction(await recordActions.run({ action: 'restaurant.merge', targetIds: [existing.id, record.id], payload }));
    } catch (error) {
      if (!isRecordActionCancelled(error)) toast({ variant: 'destructive', title: '병합 실패', description: recordActionErrorMessage(error) });
    } finally { setLoading(false); }
  };

  const handleHoldNew = async () => {
    if (loading || !record || !holdReason.trim()) return;
    setLoading(true);
    try {
      await refreshAfterAction(await recordActions.run({ action: 'restaurant.hold', targetIds: [record.id], payload: { reason: holdReason.trim() } }));
    } catch (error) {
      if (!isRecordActionCancelled(error)) toast({ variant: 'destructive', title: '보류 실패', description: recordActionErrorMessage(error) });
    } finally { setLoading(false); }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={ADMIN_MODAL_CONTENT_LG_FLEX}>
        <DialogHeader className="border-b pb-3">
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-600" />
            데이터베이스 충돌 해결
          </DialogTitle>
          <DialogDescription>
            같은 주소의 레스토랑이 이미 존재합니다. 기존 데이터를 업데이트하거나 새 데이터를 보류하세요.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {targetRead !== 'ready' || !existing || !newInfo ? <div role="status" className="space-y-3 rounded-md border p-4 text-sm">
            <p>{targetRead === 'loading' ? '충돌 대상의 현재 정보를 확인하고 있습니다.' : '충돌 대상을 확인하지 못했습니다. 목록에서 후보를 다시 확인하거나 조회를 재시도하세요.'}</p>
            {targetRead === 'failed' && <Button variant="outline" disabled={loading} onClick={() => setReadAttempt(value => value + 1)}>충돌 정보 다시 불러오기</Button>}
          </div> : <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* 기존 레스토랑 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  기존 레스토랑
                  <Badge variant="default">DB에 저장됨</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">레스토랑 이름</p>
                  <p className="text-base font-semibold">{existing.name}</p>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">주소</p>
                  <p className="text-sm">{existing.jibun_address}</p>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">전화번호</p>
                  <p className="text-sm">{existing.phone || '정보 없음'}</p>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">카테고리</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {existing.category.map((cat, idx) => (
                      <Badge key={idx} variant="outline">{cat}</Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    YouTube 링크 ({existing.youtube_links.length}개)
                  </p>
                  <div className="text-xs text-muted-foreground mt-1 max-h-20 overflow-y-auto">
                    {existing.youtube_links.slice(0, 3).map((link, idx) => (
                      <div key={idx} className="truncate">{link}</div>
                    ))}
                    {existing.youtube_links.length > 3 && (
                      <div>... 외 {existing.youtube_links.length - 3}개</div>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">등록일</p>
                  <p className="text-sm">
                    {new Date(existing.created_at).toLocaleDateString('ko-KR')}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* 새 레스토랑 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  새 레스토랑 데이터
                  <Badge variant="secondary">AI 추출</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">레스토랑 이름</p>
                  <p className="text-base font-semibold">{newInfo.name}</p>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">주소</p>
                  <p className="text-sm">
                    {newInfo.naver_address_info?.jibun_address || newInfo.origin_address}
                  </p>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">전화번호</p>
                  <p className="text-sm">{newInfo.phone || '정보 없음'}</p>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">카테고리</p>
                  <Badge variant="outline">{newInfo.category}</Badge>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">YouTube 링크</p>
                  {canonicalYoutubeUrl && (
                    <a
                      href={canonicalYoutubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline block truncate"
                    >
                      {canonicalYoutubeUrl}
                    </a>
                  )}
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground">츄양 리뷰</p>
                  <p className="text-xs text-muted-foreground line-clamp-3 mt-1">
                    {formatTzuyangReviewForDisplay(newInfo.tzuyang_review || '')}
                  </p>
                </div>

                {record?.youtube_meta && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">YouTube 메타</p>
                    <p className="text-xs">
                      {record.youtube_meta.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(record.youtube_meta.publishedAt).toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg">
            <p className="text-sm font-medium mb-2">병합 결과 미리보기</p>
            <ul className="text-sm space-y-1 text-muted-foreground">
              <li>• 카테고리: {Array.from(new Set([...existing.category, newInfo.category])).join(', ')}</li>
              <li>• 기존 영상과 리뷰는 보존하며, 비어 있는 정보는 새 데이터로 보충합니다.</li>
              <li>• 서로 다른 영상은 각각의 레코드로 보존합니다.</li>
            </ul>
          </div>
          </>}
        </div>

        <label className="block space-y-1 text-sm">보류 사유<textarea className="min-h-16 w-full rounded-md border bg-background p-2" value={holdReason} maxLength={500} disabled={loading} onChange={event => setHoldReason(event.target.value)} /></label>
        {confirmedReceipt && <Button variant="outline" onClick={() => void refreshAfterAction(confirmedReceipt)}>현재 정보 다시 불러오기</Button>}
        <DialogFooter className={ADMIN_MODAL_FOOTER_DIVIDER}>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={loading}
            className={ADMIN_MODAL_ACTION}
          >
            취소
          </Button>

          <Button
            variant="secondary"
            onClick={handleHoldNew}
            disabled={loading || !record || !holdReason.trim()}
            className={ADMIN_MODAL_ACTION}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            새 데이터 보류
          </Button>

          <Button
            onClick={handleUpdateExisting}
            disabled={loading || targetRead !== 'ready' || !conflictInfo}
            className={ADMIN_MODAL_ACTION}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            기존 레스토랑에 병합
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {recordActions.dialog}
    <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>변경 내용을 버릴까요?</AlertDialogTitle><AlertDialogDescription>작성한 보류 사유가 저장되지 않았습니다.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>계속 편집</AlertDialogCancel><AlertDialogAction onClick={() => onOpenChange(false)}>변경 버리기</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
    </>
  );
}

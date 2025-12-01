import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { EvaluationRecord, DbConflictInfo } from '@/types/evaluation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface DbConflictResolutionPanelProps {
  record: EvaluationRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (recordId: string, updates: Partial<EvaluationRecord>) => void;
}

export function DbConflictResolutionPanel({
  record,
  open,
  onOpenChange,
  onSuccess,
}: DbConflictResolutionPanelProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  if (!record || !record.db_conflict_info) {
    return null;
  }

  const conflictInfo = record.db_conflict_info;
  const existing = conflictInfo.existing_restaurant;
  const newInfo = conflictInfo.new_restaurant;

  const handleUpdateExisting = async () => {
    try {
      setLoading(true);

      // 1. 기존 레스토랑 데이터 가져오기
      const { data: existingRestaurant, error: fetchError } = await supabase
        .from('restaurants')
        .select('*')
        .eq('id', existing.id)
        .single();

      if (fetchError) throw fetchError;

      // 2. 카테고리 병합 (중복 제거)
      const mergedCategories = Array.from(
        new Set([...existing.category, newInfo.category])
      );

      // 3. YouTube 링크 병합
      const existingYoutubeLinks = (existingRestaurant as any).youtube_links || [];
      const mergedYoutubeLinks = Array.from(
        new Set([...existingYoutubeLinks, record.youtube_link])
      );

      // 4. YouTube 메타 병합
      const existingYoutubeMetas = (existingRestaurant as any).youtube_metas || [];
      const newMetas = record.youtube_meta ? [record.youtube_meta] : [];
      const mergedYoutubeMetas = [...existingYoutubeMetas, ...newMetas];

      // 5. 츄양 리뷰 병합
      const existingReviews = (existingRestaurant as any).tzuyang_reviews || [];
      const newReviews = newInfo.tzuyang_review ? [newInfo.tzuyang_review] : [];
      const mergedReviews = [...existingReviews, ...newReviews];

      // 6. Optimistic Locking으로 업데이트
      const { error: updateError } = await supabase
        .from('restaurants')
        .update({
          category: mergedCategories,
          youtube_links: mergedYoutubeLinks,
          youtube_metas: mergedYoutubeMetas,
          tzuyang_reviews: mergedReviews,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', existing.id)
        .eq('updated_at', (existingRestaurant as any).updated_at); // Optimistic Locking

      if (updateError) {
        if (updateError.code === 'PGRST116') {
          toast({
            variant: 'destructive',
            title: '업데이트 충돌',
            description: '다른 사용자가 이미 데이터를 수정했습니다. 다시 시도해주세요.',
          });
          return;
        }
        throw updateError;
      }

      // 7. evaluation_record 상태 업데이트
      const { error: recordError } = await supabase
        .from('evaluation_records')
        .update({
          status: 'approved',
          processed_at: new Date().toISOString(),
        } as any)
        .eq('id', record.id);

      if (recordError) throw recordError;

      toast({
        title: '병합 완료',
        description: '기존 레스토랑 데이터가 성공적으로 업데이트되었습니다.',
      });

      onSuccess(record.id, {
        status: 'approved',
        processed_at: new Date().toISOString(),
      });
      onOpenChange(false);

    } catch (error) {
      console.error('병합 실패:', error);
      const errorMessage = error instanceof Error ? error.message : '병합에 실패했습니다';
      toast({
        variant: 'destructive',
        title: '병합 실패',
        description: errorMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleHoldNew = async () => {
    try {
      setLoading(true);

      const { error } = await supabase
        .from('evaluation_records')
        .update({
          status: 'hold',
          processed_at: new Date().toISOString(),
        } as any)
        .eq('id', record.id);

      if (error) throw error;

      toast({
        title: '보류 처리 완료',
        description: '새 데이터가 보류 상태로 변경되었습니다.',
      });

      onSuccess(record.id, {
        status: 'hold',
        processed_at: new Date().toISOString(),
      });
      onOpenChange(false);

    } catch (error) {
      console.error('보류 처리 실패:', error);
      const errorMessage = error instanceof Error ? error.message : '보류 처리에 실패했습니다';
      toast({
        variant: 'destructive',
        title: '보류 처리 실패',
        description: errorMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-600" />
            데이터베이스 충돌 해결
          </DialogTitle>
          <DialogDescription>
            같은 주소의 레스토랑이 이미 존재합니다. 기존 데이터를 업데이트하거나 새 데이터를 보류하세요.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-4">
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
                <a
                  href={record.youtube_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline block truncate"
                >
                  {record.youtube_link}
                </a>
              </div>

              <div>
                <p className="text-sm font-medium text-muted-foreground">츄양 리뷰</p>
                <p className="text-xs text-muted-foreground line-clamp-3 mt-1">
                  {newInfo.tzuyang_review}
                </p>
              </div>

              {record.youtube_meta && (
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
            <li>• YouTube 링크: {existing.youtube_links.length + 1}개 (기존 {existing.youtube_links.length} + 새로운 1)</li>
            <li>• 츄양 리뷰: 새 리뷰 1개 추가</li>
          </ul>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            취소
          </Button>

          <Button
            variant="secondary"
            onClick={handleHoldNew}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            새 데이터 보류
          </Button>

          <Button
            onClick={handleUpdateExisting}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            기존 레스토랑에 병합
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

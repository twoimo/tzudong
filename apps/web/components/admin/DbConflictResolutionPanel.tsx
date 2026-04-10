import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { EvaluationRecord } from '@/types/evaluation';
import { mergeRestaurantData } from '@/lib/db-conflict-checker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ADMIN_MODAL_ACTION,
  ADMIN_MODAL_CONTENT_LG_FLEX,
  ADMIN_MODAL_FOOTER_DIVIDER,
} from './admin-modal-styles';

type ConflictRestaurantDbRow = {
  updated_at?: string | null;
  youtube_link?: string | null;
  youtube_meta?: Record<string, unknown> | null;
  tzuyang_review?: string | null;
  categories?: string[] | string | null;
};

type SupabaseUpdateError = {
  code?: string;
  message?: string;
} | null;

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
  const { user } = useAuth();
  const requireAdminUserId = () => {
    if (!user?.id) {
      throw new Error('로그인이 필요합니다');
    }

    return user.id;
  };
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
      const adminUserId = requireAdminUserId();

      // 1. 기존 레스토랑 데이터 가져오기
      const { data: existingRestaurant, error: fetchError } = await supabase
        .from('restaurants')
        .select('*')
        .eq('id', existing.id)
        .single();

      if (fetchError) throw fetchError;
      const existingRestaurantData = existingRestaurant as ConflictRestaurantDbRow | null;
      if (!existingRestaurantData?.updated_at) {
        throw new Error('기존 레스토랑의 최신 수정 시각을 확인할 수 없습니다.');
      }

      const mergeResult = await mergeRestaurantData({
        existingRestaurant: {
          id: existing.id,
          youtube_link: existingRestaurantData?.youtube_link ?? null,
          youtube_meta: existingRestaurantData?.youtube_meta ?? null,
          tzuyang_review: existingRestaurantData?.tzuyang_review ?? null,
          categories: existingRestaurantData?.categories ?? [],
          updated_at: existingRestaurantData.updated_at,
        },
        newYoutubeLink: record.youtube_link || '',
        newYoutubeMeta:
          record.youtube_meta && typeof record.youtube_meta === 'object' && !Array.isArray(record.youtube_meta)
            ? (record.youtube_meta as Record<string, unknown>)
            : undefined,
        newTzuyangReview: newInfo.tzuyang_review || undefined,
        newCategory: newInfo.category,
      });

      if (!mergeResult.success) {
        throw new Error(mergeResult.error);
      }

      const { error: stampError } = await supabase
        .from('restaurants' as never)
        .update({
          updated_by_admin_id: adminUserId,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', existing.id);

      if (stampError) {
        if (stampError.code === 'PGRST116') {
          toast({
            variant: 'destructive',
            title: '업데이트 충돌',
            description: '다른 사용자가 이미 데이터를 수정했습니다. 다시 시도해주세요.',
          });
          return;
        }
        throw stampError;
      }

      const { error: sourceError } = await supabase
        .from('restaurants' as never)
        .update({
          status: 'deleted',
          updated_by_admin_id: adminUserId,
          updated_at: new Date().toISOString(),
          db_error_message: null,
          db_error_details: null,
        } as never)
        .eq('id', record.id);

      if (sourceError) throw sourceError;

      toast({
        title: '병합 완료',
        description: '기존 레스토랑 데이터가 성공적으로 업데이트되었습니다.',
      });

      onSuccess(record.id, {
        status: 'deleted',
        updated_by_admin_id: adminUserId,
        updated_at: new Date().toISOString(),
        db_error_message: null,
        db_error_details: null,
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
      const adminUserId = requireAdminUserId();

      const { error } = await supabase
        .from('restaurants' as never)
        .update({
          status: 'hold',
          updated_by_admin_id: adminUserId,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', record.id);

      if (error) throw error;

      toast({
        title: '보류 처리 완료',
        description: '새 데이터가 보류 상태로 변경되었습니다.',
      });

      onSuccess(record.id, {
        status: 'hold',
        updated_by_admin_id: adminUserId,
        updated_at: new Date().toISOString(),
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
        </div>

        <DialogFooter className={ADMIN_MODAL_FOOTER_DIVIDER}>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className={ADMIN_MODAL_ACTION}
          >
            취소
          </Button>

          <Button
            variant="secondary"
            onClick={handleHoldNew}
            disabled={loading}
            className={ADMIN_MODAL_ACTION}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            새 데이터 보류
          </Button>

          <Button
            onClick={handleUpdateExisting}
            disabled={loading}
            className={ADMIN_MODAL_ACTION}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            기존 레스토랑에 병합
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

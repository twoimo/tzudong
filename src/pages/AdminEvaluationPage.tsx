import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { EvaluationRecord, EvaluationRecordStatus, CategoryStats } from '@/types/evaluation';
import { CategorySidebar } from '@/components/admin/CategorySidebar';
import { EvaluationTable } from '@/components/admin/EvaluationTableNew';
import { MissingRestaurantForm } from '@/components/admin/MissingRestaurantForm';
import { DbConflictResolutionPanel } from '@/components/admin/DbConflictResolutionPanel';
import { EditRestaurantModal } from '@/components/admin/EditRestaurantModal';
import { ClipboardCheck, Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { checkDbConflict, mergeRestaurantData } from '@/lib/db-conflict-checker';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function AdminEvaluationPage() {
  const { toast } = useToast();
  const [records, setRecords] = useState<EvaluationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<CategoryStats>({
    total: 0,
    pending: 0,
    approved: 0,
    hold: 0,
    missing: 0,
    db_conflict: 0,
    geocoding_failed: 0,
    not_selected: 0,
    deleted: 0,
  });
  const [selectedStatuses, setSelectedStatuses] = useState<EvaluationRecordStatus[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>(''); // 검색어 상태
  const [evalFilters, setEvalFilters] = useState<{
    visit_authenticity?: string;
    rb_inference_score?: string;
    rb_grounding_TF?: string;
    review_faithfulness_score?: string;
    location_match_TF?: string;
    category_validity_TF?: string;
    category_TF?: string;
    status?: string;
  }>({});
  const [missingFormOpen, setMissingFormOpen] = useState(false);
  const [selectedMissingRecord, setSelectedMissingRecord] = useState<EvaluationRecord | null>(null);
  const [conflictPanelOpen, setConflictPanelOpen] = useState(false);
  const [selectedConflictRecord, setSelectedConflictRecord] = useState<EvaluationRecord | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedEditRecord, setSelectedEditRecord] = useState<EvaluationRecord | null>(null);
  
  // DB 충돌 경고 다이얼로그
  const [showConflictWarning, setShowConflictWarning] = useState(false);
  const [conflictWarningData, setConflictWarningData] = useState<{
    record: EvaluationRecord;
    conflicts: any[];
  } | null>(null);

  // 데이터 로드
  useEffect(() => {
    loadRecords();
  }, []);

  // 필터링된 레코드
  const filteredRecords = useMemo(() => {
    let filtered = selectedStatuses.length === 0 
      ? records.filter(r => r.status !== 'deleted') // 전체 탭일 때는 deleted 제외
      : records.filter(r => {
          // geocoding_failed 탭 클릭 시: status가 'geocoding_failed' 또는 (pending + 지오코딩 실패)
          if (selectedStatuses.includes('geocoding_failed' as EvaluationRecordStatus)) {
            return r.status === 'geocoding_failed' || 
                   (r.status === 'pending' && !r.geocoding_success);
          }
          return selectedStatuses.includes(r.status);
        });

    // 1. Visit Authenticity 필터 (0-3점)
    if (evalFilters.visit_authenticity) {
      const targetScore = parseInt(evalFilters.visit_authenticity);
      filtered = filtered.filter(r => 
        r.evaluation_results?.visit_authenticity?.eval_value === targetScore
      );
    }

    // 2. RB Inference Score 필터 (0-2점)
    if (evalFilters.rb_inference_score) {
      const targetScore = parseInt(evalFilters.rb_inference_score);
      filtered = filtered.filter(r => 
        r.evaluation_results?.rb_inference_score?.eval_value === targetScore
      );
    }

    // 3. RB Grounding TF 필터 (T/F)
    if (evalFilters.rb_grounding_TF) {
      const targetValue = evalFilters.rb_grounding_TF === 'True';
      filtered = filtered.filter(r => 
        r.evaluation_results?.rb_grounding_TF?.eval_value === targetValue
      );
    }

    // 4. Review Faithfulness Score 필터 (0-1점)
    if (evalFilters.review_faithfulness_score) {
      const targetScore = parseFloat(evalFilters.review_faithfulness_score);
      filtered = filtered.filter(r => 
        r.evaluation_results?.review_faithfulness_score?.eval_value === targetScore
      );
    }

    // 5. Location Match TF 필터 (T/F/geocoding_failed)
    if (evalFilters.location_match_TF) {
      if (evalFilters.location_match_TF === 'geocoding_failed') {
        filtered = filtered.filter(r => !r.geocoding_success);
      } else {
        const targetValue = evalFilters.location_match_TF === 'True';
        filtered = filtered.filter(r => 
          r.evaluation_results?.location_match_TF?.eval_value === targetValue
        );
      }
    }

    // 6. Category Validity TF 필터 (T/F)
    if (evalFilters.category_validity_TF) {
      const targetValue = evalFilters.category_validity_TF === 'True';
      filtered = filtered.filter(r => 
        r.evaluation_results?.category_validity_TF?.eval_value === targetValue
      );
    }

    // 7. Category TF 필터 (T/F)
    if (evalFilters.category_TF) {
      const targetValue = evalFilters.category_TF === 'True';
      filtered = filtered.filter(r => 
        r.evaluation_results?.category_TF?.eval_value === targetValue
      );
    }

    // 8. Status 필터
    if (evalFilters.status) {
      filtered = filtered.filter(r => r.status === evalFilters.status);
    }

    // 9. 영상 제목 검색 필터
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(r => 
        r.youtube_meta?.title?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [records, selectedStatuses, evalFilters, searchQuery]);

  const loadRecords = async () => {
    try {
      setLoading(true);
      
      // 모든 레코드 조회 (deleted 포함)
      const { data, error } = await supabase
        .from('evaluation_records')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      if (!data) {
        console.warn('No data returned from evaluation_records');
        setRecords([]);
        setStats({
          total: 0,
          pending: 0,
          approved: 0,
          hold: 0,
          missing: 0,
          db_conflict: 0,
          geocoding_failed: 0,
          not_selected: 0,
          deleted: 0,
        });
        return;
      }

      setRecords(data as EvaluationRecord[]);
      
      // 통계 계산 (deleted 포함)
      const deletedCount = data.filter(r => r.status === 'deleted').length;
      const activeData = data.filter(r => r.status !== 'deleted');
      
      const newStats: CategoryStats = {
        total: activeData.length, // deleted 제외한 전체
        pending: data.filter(r => r.status === 'pending').length,
        approved: data.filter(r => r.status === 'approved').length,
        hold: data.filter(r => r.status === 'hold').length,
        missing: data.filter(r => r.status === 'missing').length,
        db_conflict: data.filter(r => r.status === 'db_conflict').length,
        geocoding_failed: data.filter(r => r.status === 'geocoding_failed' || 
          (r.status === 'pending' && !r.geocoding_success)).length,
        not_selected: data.filter(r => r.status === 'not_selected').length,
        deleted: deletedCount,
      };
      setStats(newStats);

    } catch (error: any) {
      console.error('데이터 로드 실패:', error);
      toast({
        variant: 'destructive',
        title: '데이터 로드 실패',
        description: error.message || '알 수 없는 오류가 발생했습니다.',
      });
      // 에러 발생 시에도 빈 배열로 설정하여 UI가 렌더링되도록
      setRecords([]);
      setStats({
        total: 0,
        pending: 0,
        approved: 0,
        hold: 0,
        missing: 0,
        db_conflict: 0,
        geocoding_failed: 0,
        not_selected: 0,
        deleted: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  // 승인 핸들러 (DB 충돌 체크 포함)
  const handleApprove = async (record: EvaluationRecord) => {
    // 지오코딩 실패 체크
    if (!record.geocoding_success) {
      toast({
        variant: 'destructive',
        title: '승인 불가',
        description: '⚠️ Naver 지오코딩 실패 - 수정 후 승인하세요',
      });
      return;
    }

    // Missing 체크
    if (record.status === 'missing') {
      toast({
        variant: 'destructive',
        title: '승인 불가',
        description: '⚠️ Missing 음식점 - 먼저 수동 등록이 필요합니다',
      });
      return;
    }

    if (!record.restaurant_info?.naver_address_info?.jibun_address) {
      toast({
        variant: 'destructive',
        title: '승인 불가',
        description: '⚠️ 지번주소 정보가 없습니다',
      });
      return;
    }

    try {
      setLoading(true);

      const jibunAddress = record.restaurant_info.naver_address_info.jibun_address;
      
      // DB 충돌 체크 (새로운 로직)
      const conflictCheck = await checkDbConflict({
        jibunAddress,
        restaurantName: record.restaurant_name,
        youtubeLink: record.youtube_link,
      });

      if (conflictCheck.hasConflict) {
        if (conflictCheck.conflictType === 'name_mismatch') {
          // 충돌 타입 1: 같은 주소 + 같은 youtube_link + 다른 음식점명
          // → DB 충돌로 표시
          await markAsDbConflict(record, conflictCheck.conflictingRestaurants![0]);
          setLoading(false);
          return;
        } else if (conflictCheck.conflictType === 'merge_needed') {
          // 충돌 타입 2: 같은 주소 + 같은 음식점명 + 다른 youtube_link
          // → 자동 병합
          await mergeToExisting(conflictCheck.conflictingRestaurants![0], record);
          await loadRecords();
          setLoading(false);
          return;
        }
      }

      // 충돌 없음 → 새 음식점 등록
      await insertNewRestaurant(record);
      await loadRecords();

    } catch (error: any) {
      console.error('승인 처리 실패:', error);
      toast({
        variant: 'destructive',
        title: '승인 처리 실패',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  // 병합 함수 (새로운 로직 사용)
  const mergeToExisting = async (existing: any, newRecord: EvaluationRecord) => {
    const mergeResult = await mergeRestaurantData({
      existingRestaurant: existing,
      newYoutubeLink: newRecord.youtube_link,
      newYoutubeMeta: newRecord.youtube_meta,
      newTzuyangReview: newRecord.restaurant_info?.tzuyang_review,
      newCategory: newRecord.restaurant_info?.category,
    });

    if (!mergeResult.success) {
      throw new Error(mergeResult.error);
    }

    // evaluation_records 상태 업데이트
    const { error: statusError } = await supabase
      .from('evaluation_records')
      .update({
        status: 'approved',
        processed_at: new Date().toISOString(),
      })
      .eq('id', newRecord.id);

    if (statusError) throw statusError;

    toast({
      title: '병합 완료',
      description: `✅ "${newRecord.restaurant_name}"이(가) 기존 음식점에 병합되었습니다`,
    });
  };

  // DB 충돌 표시
  const markAsDbConflict = async (newRecord: EvaluationRecord, existing: any) => {
    const { error } = await supabase
      .from('evaluation_records')
      .update({
        status: 'db_conflict',
        db_conflict_info: {
          existing_restaurant: existing,
          new_restaurant: newRecord.restaurant_info,
        },
      })
      .eq('id', newRecord.id);

    if (error) throw error;

    toast({
      variant: 'destructive',
      title: 'DB 충돌 발생',
      description: `⚠️ 같은 주소에 다른 음식점명: ${existing.name} vs ${newRecord.restaurant_name}`,
    });
  };

  // 새 음식점 등록
  const insertNewRestaurant = async (record: EvaluationRecord) => {
    const naverInfo = record.restaurant_info!.naver_address_info!;

    const { error: insertError } = await supabase
      .from('restaurants')
      .insert({
        name: record.restaurant_name,
        phone: record.restaurant_info!.phone,
        road_address: naverInfo.road_address,
        jibun_address: naverInfo.jibun_address,
        english_address: naverInfo.english_address,
        address_elements: naverInfo.address_elements,
        lat: parseFloat(naverInfo.y), // Naver y → lat
        lng: parseFloat(naverInfo.x), // Naver x → lng
        category: [record.restaurant_info!.category],
        youtube_links: [record.youtube_link],
        tzuyang_reviews: [record.restaurant_info!.tzuyang_review],
        youtube_metas: [record.youtube_meta],
      });

    if (insertError) throw insertError;

    // evaluation_records 상태 업데이트
    const { error: statusError } = await supabase
      .from('evaluation_records')
      .update({
        status: 'approved',
        processed_at: new Date().toISOString(),
      })
      .eq('id', record.id);

    if (statusError) throw statusError;

    toast({
      title: '등록 완료',
      description: `✅ "${record.restaurant_name}" 새 음식점이 등록되었습니다`,
    });
  };

  // 삭제 핸들러 (Soft Delete)
  const handleDelete = async (record: EvaluationRecord) => {
    if (!confirm(`"${record.restaurant_name}"을(를) 정말 삭제하시겠습니까?\n\n⚠️ 삭제된 레코드는 화면에서 숨겨지며, 데이터 재로드 시에도 복구되지 않습니다.`)) {
      return;
    }

    try {
      // Soft Delete: status를 'deleted'로 변경
      const { error } = await supabase
        .from('evaluation_records')
        .update({
          status: 'deleted',
          deleted_at: new Date().toISOString(),
        })
        .eq('id', record.id);

      if (error) throw error;

      await loadRecords();
      toast({
        title: '삭제 완료',
        description: `"${record.restaurant_name}"이(가) 삭제되었습니다 (복구 불가)`,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: '삭제 실패',
        description: error.message,
      });
    }
  };

  const handleRegisterMissing = (record: EvaluationRecord) => {
    setSelectedMissingRecord(record);
    setMissingFormOpen(true);
  };

  const handleResolveConflict = (record: EvaluationRecord) => {
    setSelectedConflictRecord(record);
    setConflictPanelOpen(true);
  };

  const handleEdit = (record: EvaluationRecord) => {
    setSelectedEditRecord(record);
    setEditModalOpen(true);
  };

  if (loading && records.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="border-b border-border bg-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent flex items-center gap-2">
              <ClipboardCheck className="h-6 w-6 text-primary" />
              음식점 방문 데이터 평가 결과 검수
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              총 {stats.total}개 레코드 | 필터링: {filteredRecords.length}개
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 상단: 카테고리 탭 + 검색 */}
        <div className="p-4 border-b bg-background space-y-4">
          <CategorySidebar
            stats={stats}
            selectedStatuses={selectedStatuses}
            onSelectStatuses={setSelectedStatuses}
          />
          
          {/* 검색 입력 */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="영상 제목으로 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* 테이블 영역 (스크롤 가능) */}
        <div className="flex-1 p-4 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : (
            <EvaluationTable
              records={filteredRecords}
              onApprove={handleApprove}
              onDelete={handleDelete}
              onRegisterMissing={handleRegisterMissing}
              onResolveConflict={handleResolveConflict}
              onEdit={handleEdit}
              loading={loading}
              evalFilters={evalFilters}
              isDeletedFilterActive={selectedStatuses.includes('deleted' as EvaluationRecordStatus)}
              onFilterChange={(key, value) => {
                setEvalFilters(prev => ({
                  ...prev,
                  [key]: value === '' ? undefined : value
                }));
              }}
              onResetFilters={() => setEvalFilters({})}
            />
          )}
        </div>
      </div>

      {/* Missing 레스토랑 등록 폼 */}
      <MissingRestaurantForm
        record={selectedMissingRecord}
        open={missingFormOpen}
        onOpenChange={setMissingFormOpen}
        onSuccess={loadRecords}
      />

      {/* DB 충돌 해결 패널 */}
      <DbConflictResolutionPanel
        record={selectedConflictRecord}
        open={conflictPanelOpen}
        onOpenChange={setConflictPanelOpen}
        onSuccess={loadRecords}
      />

      {/* 보류 레스토랑 편집 모달 */}
      <EditRestaurantModal
        record={selectedEditRecord}
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        onSuccess={loadRecords}
      />
    </div>
  );
}

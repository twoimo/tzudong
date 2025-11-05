import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { EvaluationRecord, EvaluationRecordStatus, CategoryStats } from '@/types/evaluation';
import { CategorySidebar } from '@/components/admin/CategorySidebar';
import { EvaluationFilters } from '@/components/admin/EvaluationFilters';
import { EvaluationTable } from '@/components/admin/EvaluationTable';
import { MissingRestaurantForm } from '@/components/admin/MissingRestaurantForm';
import { DbConflictResolutionPanel } from '@/components/admin/DbConflictResolutionPanel';
import { EditRestaurantModal } from '@/components/admin/EditRestaurantModal';
import { Loader2 } from 'lucide-react';

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
  });
  const [selectedStatuses, setSelectedStatuses] = useState<EvaluationRecordStatus[]>(['pending']);
  const [evalFilters, setEvalFilters] = useState<{
    visit_authenticity?: string;
    rb_grounding_TF?: string;
    location_match_TF?: string;
    category?: string;
  }>({});
  const [missingFormOpen, setMissingFormOpen] = useState(false);
  const [selectedMissingRecord, setSelectedMissingRecord] = useState<EvaluationRecord | null>(null);
  const [conflictPanelOpen, setConflictPanelOpen] = useState(false);
  const [selectedConflictRecord, setSelectedConflictRecord] = useState<EvaluationRecord | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedEditRecord, setSelectedEditRecord] = useState<EvaluationRecord | null>(null);

  // 데이터 로드
  useEffect(() => {
    loadRecords();
  }, []);

  // 필터링된 레코드
  const filteredRecords = useMemo(() => {
    let filtered = records.filter(r => selectedStatuses.includes(r.status));

    // Visit Authenticity 필터
    if (evalFilters.visit_authenticity) {
      const targetScore = parseInt(evalFilters.visit_authenticity);
      filtered = filtered.filter(r => 
        r.evaluation_results?.visit_authenticity?.eval_value === targetScore
      );
    }

    // RB Grounding 필터
    if (evalFilters.rb_grounding_TF) {
      const targetValue = evalFilters.rb_grounding_TF === 'true';
      filtered = filtered.filter(r => 
        r.evaluation_results?.rb_grounding_TF?.eval_value === targetValue
      );
    }

    // Location Match 필터
    if (evalFilters.location_match_TF) {
      if (evalFilters.location_match_TF === 'geocoding_failed') {
        filtered = filtered.filter(r => !r.geocoding_success);
      } else {
        const targetValue = evalFilters.location_match_TF === 'true';
        filtered = filtered.filter(r => 
          r.evaluation_results?.location_match_TF?.eval_value === targetValue
        );
      }
    }

    // Category 필터
    if (evalFilters.category && evalFilters.category !== 'all') {
      filtered = filtered.filter(r => {
        const categories = r.restaurant_info?.category || '';
        return categories.includes(evalFilters.category!);
      });
    }

    return filtered;
  }, [records, selectedStatuses, evalFilters]);

  const loadRecords = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('evaluation_records')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setRecords(data as EvaluationRecord[]);
      
      // 통계 계산
      const newStats: CategoryStats = {
        total: data.length,
        pending: data.filter(r => r.status === 'pending').length,
        approved: data.filter(r => r.status === 'approved').length,
        hold: data.filter(r => r.status === 'hold').length,
        missing: data.filter(r => r.status === 'missing').length,
        db_conflict: data.filter(r => r.status === 'db_conflict').length,
        geocoding_failed: data.filter(r => r.status === 'geocoding_failed' || 
          (r.status === 'pending' && !r.geocoding_success)).length,
      };
      setStats(newStats);

    } catch (error: any) {
      console.error('데이터 로드 실패:', error);
      toast({
        variant: 'destructive',
        title: '데이터 로드 실패',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  // 승인 핸들러
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
      
      // 1. 기존 DB에서 지번주소로 검색
      const { data: existingRestaurants, error: queryError } = await supabase
        .from('restaurants')
        .select('*')
        .eq('jibun_address', jibunAddress);

      if (queryError) throw queryError;

      if (existingRestaurants && existingRestaurants.length > 0) {
        const existing = existingRestaurants[0];

        if (existing.name === record.restaurant_name) {
          // 2-1. 병합 처리
          await mergeToExisting(existing, record);
        } else {
          // 2-2. DB 충돌
          await markAsDbConflict(record, existing);
        }
      } else {
        // 3. 새 음식점 등록
        await insertNewRestaurant(record);
      }

      await loadRecords(); // 데이터 다시 로드

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

  // 병합 함수
  const mergeToExisting = async (existing: any, newRecord: EvaluationRecord) => {
    const updatedYoutubeLinks = [...existing.youtube_links, newRecord.youtube_link];
    const updatedTzuyangReviews = [
      ...existing.tzuyang_reviews,
      newRecord.restaurant_info!.tzuyang_review,
    ];
    const updatedYoutubeMetas = [
      ...existing.youtube_metas,
      newRecord.youtube_meta,
    ];

    // 카테고리 병합 (중복 제거)
    const newCategory = newRecord.restaurant_info!.category;
    const updatedCategories = existing.category.includes(newCategory)
      ? existing.category
      : [...existing.category, newCategory];

    // Optimistic Locking
    const { error: updateError } = await supabase
      .from('restaurants')
      .update({
        youtube_links: updatedYoutubeLinks,
        tzuyang_reviews: updatedTzuyangReviews,
        youtube_metas: updatedYoutubeMetas,
        category: updatedCategories,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .eq('updated_at', existing.updated_at); // Optimistic Lock

    if (updateError) {
      if (updateError.message.includes('updated_at')) {
        toast({
          variant: 'destructive',
          title: '충돌 발생',
          description: '다른 관리자가 수정했습니다. 새로고침 후 다시 시도하세요.',
        });
        throw updateError;
      }
      throw updateError;
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

  // 보류 핸들러
  const handleHold = async (record: EvaluationRecord) => {
    try {
      const { error } = await supabase
        .from('evaluation_records')
        .update({ status: 'hold' })
        .eq('id', record.id);

      if (error) throw error;

      await loadRecords();
      toast({
        title: '보류 완료',
        description: `"${record.restaurant_name}"이(가) 보류되었습니다`,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: '보류 실패',
        description: error.message,
      });
    }
  };

  // 삭제 핸들러
  const handleDelete = async (record: EvaluationRecord) => {
    if (!confirm(`"${record.restaurant_name}"을(를) 정말 삭제하시겠습니까?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('evaluation_records')
        .delete()
        .eq('id', record.id);

      if (error) throw error;

      await loadRecords();
      toast({
        title: '삭제 완료',
        description: `"${record.restaurant_name}"이(가) 삭제되었습니다`,
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">음식점 방문 데이터 평가 결과</h1>

      <div className="flex gap-6">
        {/* 카테고리 사이드바 */}
        <CategorySidebar
          stats={stats}
          selectedStatuses={selectedStatuses}
          onSelectStatuses={setSelectedStatuses}
        />

        {/* 메인 컨텐츠 */}
        <div className="flex-1">
          {/* 필터 바 */}
          <EvaluationFilters
            filters={evalFilters}
            onFilterChange={(key, value) => {
              setEvalFilters(prev => ({
                ...prev,
                [key]: value === '' ? undefined : value
              }));
            }}
          />

          {/* 테이블 */}
          <EvaluationTable
            records={filteredRecords}
            onApprove={handleApprove}
            onHold={handleHold}
            onDelete={handleDelete}
            onRegisterMissing={handleRegisterMissing}
            onResolveConflict={handleResolveConflict}
            onEdit={handleEdit}
            loading={loading}
          />
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

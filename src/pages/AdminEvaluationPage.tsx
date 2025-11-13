import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { EvaluationRecord, EvaluationRecordStatus, CategoryStats } from '@/types/evaluation';
import { CategorySidebar } from '@/components/admin/CategorySidebar';
import { EvaluationTable } from '@/components/admin/EvaluationTableNew';
import { MissingRestaurantForm } from '@/components/admin/MissingRestaurantForm';
import { DbConflictResolutionPanel } from '@/components/admin/DbConflictResolutionPanel';
import { EditRestaurantModal } from '@/components/admin/EditRestaurantModal';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
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

const PAGE_SIZE = 50; // 한 번에 로드할 레코드 수

export default function AdminEvaluationPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user, isAdmin, isLoading: authLoading } = useAuth();

  const [allRecords, setAllRecords] = useState<EvaluationRecord[]>([]); // 전체 데이터 (검색용)
  const [displayedRecords, setDisplayedRecords] = useState<EvaluationRecord[]>([]); // 화면에 표시될 데이터
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
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
  const [searchResults, setSearchResults] = useState<EvaluationRecord[] | null>(null); // 검색 결과
  const [isSearching, setIsSearching] = useState(false); // 검색 로딩 상태
  const [evalFilters, setEvalFilters] = useState<{
    visit_authenticity?: string;
    rb_inference_score?: string;
    rb_grounding_TF?: string;
    review_faithfulness_score?: string;
    geocoding_success?: string;
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

  // 테이블 뷰 토글 상태
  const [isAlternateView, setIsAlternateView] = useState(false);

  // DB 충돌 경고 다이얼로그
  const [showConflictWarning, setShowConflictWarning] = useState(false);
  const [conflictWarningData, setConflictWarningData] = useState<{
    record: EvaluationRecord;
    conflicts: Record<string, unknown>[];
  } | null>(null);

  // 무한 스크롤을 위한 scroll container ref
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 인증 체크 및 관리자 권한 확인
  useEffect(() => {
    if (authLoading) return; // 인증 로딩 중에는 대기

    if (!user || !isAdmin) {
      toast({
        title: "접근 권한이 없습니다",
        description: "관리자만 접근할 수 있는 페이지입니다.",
        variant: "destructive",
      });
      navigate('/login');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin, authLoading]);

  // 초기 데이터 로드
  useEffect(() => {
    if (user && isAdmin && !authLoading) {
      loadAllRecords();
    }
  }, [user, isAdmin, authLoading]);

  // YouTube 제목 퍼지 검색
  useEffect(() => {
    const performFuzzySearch = async () => {
      if (!searchQuery.trim()) {
        setSearchResults(null);
        return;
      }

      setIsSearching(true);
      try {
        console.log('검색 시작:', searchQuery.trim());
        const { data, error } = await supabase.rpc('search_restaurants_by_youtube_title', {
          search_query: searchQuery.trim(),
          similarity_threshold: 0.02,
          max_results: 100
        });

        if (error) {
          console.error('RPC 에러:', error);
          throw error;
        }
        
        console.log('검색 결과:', data?.length || 0, '개');
        console.log('검색 결과 샘플:', data?.slice(0, 3));
        setSearchResults(data || []);
      } catch (error) {
        console.error('YouTube 제목 검색 실패:', error);
        toast({
          variant: 'destructive',
          title: '검색 실패',
          description: '영상 제목 검색 중 오류가 발생했습니다.',
        });
        setSearchResults(null);
      } finally {
        setIsSearching(false);
      }
    };

    const debounceTimer = setTimeout(performFuzzySearch, 300);
    return () => clearTimeout(debounceTimer);
  }, [searchQuery, toast]);

  // 필터링 + 검색된 레코드
  const filteredRecords = useMemo(() => {
    // 검색 결과가 있으면 검색 결과를 기준으로, 없으면 전체 데이터 사용
    const baseRecords = searchResults || allRecords;

    let filtered = selectedStatuses.length === 0
      ? baseRecords.filter(r => r.status !== 'deleted') // 전체 탭일 때는 deleted 제외
      : baseRecords.filter(r => {
        // geocoding_failed 탭 클릭 시: geocoding_success가 false인 레코드
        if (selectedStatuses.includes('geocoding_failed' as EvaluationRecordStatus)) {
          return !r.geocoding_success;
        }
        // missing 탭: is_missing이 true인 레코드
        if (selectedStatuses.includes('missing' as EvaluationRecordStatus)) {
          return r.is_missing;
        }
        // not_selected 탭: is_not_selected가 true인 레코드
        if (selectedStatuses.includes('not_selected' as EvaluationRecordStatus)) {
          return r.is_not_selected;
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

    // 5. Geocoding Success 필터 (true/false_match/false_geocode)
    if (evalFilters.geocoding_success) {
      if (evalFilters.geocoding_success === 'true') {
        // 지오코딩 성공
        filtered = filtered.filter(r => r.geocoding_success === true);
      } else if (evalFilters.geocoding_success === 'false_match') {
        // 지오코딩 성공했으나 주소 매칭 실패
        filtered = filtered.filter(r => r.geocoding_success === false && r.geocoding_false_stage !== null);
      } else if (evalFilters.geocoding_success === 'false_geocode') {
        // 지오코딩 자체 실패
        filtered = filtered.filter(r => r.geocoding_success === false && r.geocoding_false_stage === null);
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

    return filtered;
  }, [allRecords, searchResults, selectedStatuses, evalFilters]);

  // 더 많은 레코드 로드
  const loadMoreRecords = useCallback(() => {
    if (loadingMore || !hasMore) return;

    setLoadingMore(true);
    setTimeout(() => {
      const currentLength = displayedRecords.length;
      const newRecords = filteredRecords.slice(currentLength, currentLength + PAGE_SIZE);

      setDisplayedRecords(prev => [...prev, ...newRecords]);
      setHasMore(currentLength + PAGE_SIZE < filteredRecords.length);
      setLoadingMore(false);
    }, 100);
  }, [displayedRecords.length, filteredRecords, loadingMore, hasMore]);

  // 필터링 결과가 변경될 때마다 표시할 레코드 초기화
  useEffect(() => {
    setDisplayedRecords(filteredRecords.slice(0, PAGE_SIZE));
    setHasMore(filteredRecords.length > PAGE_SIZE);
  }, [filteredRecords]);

  // 무한 스크롤 - Scroll Event 방식
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;

      // 80% 이상 스크롤 시 다음 데이터 로드
      if (scrollPercentage > 0.8 && hasMore && !loadingMore) {
        console.log('Loading more records...', {
          scrollPercentage,
          displayedLength: displayedRecords.length,
          filteredLength: filteredRecords.length
        });
        loadMoreRecords();
      }
    };

    scrollContainer.addEventListener('scroll', handleScroll);
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, [hasMore, loadingMore, loadMoreRecords, displayedRecords.length, filteredRecords.length]);

  // 전체 데이터 로드 (한 번만)
  const loadAllRecords = async () => {
    try {
      setLoading(true);

      // 모든 레코드 조회 (restaurants 테이블에서)
      const { data, error } = await supabase
        .from('restaurants')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      if (!data) {
        console.warn('No data returned from restaurants');
        setAllRecords([]);
        setDisplayedRecords([]);
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

      // restaurants 테이블 데이터를 EvaluationRecord 형식으로 변환
      const records = data.map((r: Record<string, unknown>) => ({
        ...r,
        // 호환성을 위한 별칭 추가
        restaurant_name: r.name,
        youtube_link: Array.isArray(r.youtube_links) ? r.youtube_links[0] : '',
        // restaurant_info 생성
        restaurant_info: r.origin_address ? {
          name: r.name as string,
          phone: r.phone as string | null,
          category: Array.isArray(r.categories) && r.categories.length > 0 ? r.categories[0] : '',
          origin_address: (r.origin_address as Record<string, unknown>)?.address as string || '',
          origin_lat: (r.origin_address as Record<string, unknown>)?.lat as number || r.lat as number,
          origin_lng: (r.origin_address as Record<string, unknown>)?.lng as number || r.lng as number,
          reasoning_basis: r.reasoning_basis as string || '',
          tzuyang_review: Array.isArray(r.tzuyang_reviews) && r.tzuyang_reviews.length > 0
            ? ((r.tzuyang_reviews[0] as Record<string, unknown>)?.review as string || '')
            : '',
          naver_address_info: r.road_address || r.jibun_address ? {
            road_address: r.road_address as string | null,
            jibun_address: r.jibun_address as string || '',
            english_address: r.english_address as string | null,
            address_elements: r.address_elements,
            x: r.lng?.toString() || '',
            y: r.lat?.toString() || '',
          } : null,
        } : null,
      }));

      setAllRecords(records as EvaluationRecord[]);

      // 통계 계산 (deleted 제외, rejected 포함)
      const typedRecords = records as EvaluationRecord[];
      const deletedCount = typedRecords.filter(r => r.status === 'deleted').length;
      const activeData = typedRecords.filter(r => r.status !== 'deleted');

      const newStats: CategoryStats = {
        total: activeData.length, // deleted 제외한 전체
        pending: typedRecords.filter(r => r.status === 'pending').length,
        approved: typedRecords.filter(r => r.status === 'approved').length,
        hold: typedRecords.filter(r => r.status === 'hold').length,
        missing: typedRecords.filter(r => r.is_missing).length,
        db_conflict: typedRecords.filter(r => r.status === 'db_conflict').length,
        geocoding_failed: typedRecords.filter(r =>
          r.status === 'geocoding_failed' ||
          (r.status === 'pending' && !r.geocoding_success) ||
          (r.status === 'not_selected' && !r.geocoding_success)
        ).length,
        not_selected: typedRecords.filter(r => r.is_not_selected).length,
        deleted: deletedCount,
      };
      setStats(newStats);

    } catch (error: unknown) {
      console.error('데이터 로드 실패:', error);
      toast({
        variant: 'destructive',
        title: '데이터 로드 실패',
        description: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
      });
      // 에러 발생 시에도 빈 배열로 설정하여 UI가 렌더링되도록
      setAllRecords([]);
      setDisplayedRecords([]);
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

  // 개별 레코드 업데이트 (새로고침 없이 상태 반영)
  const updateRecordInState = (recordId: string, updates: Partial<EvaluationRecord>) => {
    setAllRecords(prev =>
      prev.map(r => r.id === recordId ? { ...r, ...updates } : r)
    );
  };

  // 레코드 제거 (상태에서만)
  const removeRecordFromState = (recordId: string) => {
    setAllRecords(prev => prev.filter(r => r.id !== recordId));
  };

  // 통계 재계산 (현재 allRecords 기준)
  const recalculateStats = () => {
    const deletedCount = allRecords.filter(r => r.status === 'deleted').length;
    const activeData = allRecords.filter(r => r.status !== 'deleted');

    const newStats: CategoryStats = {
      total: activeData.length,
      pending: allRecords.filter(r => r.status === 'pending').length,
      approved: allRecords.filter(r => r.status === 'approved').length,
      hold: allRecords.filter(r => r.status === 'hold').length,
      missing: allRecords.filter(r => r.is_missing).length,
      db_conflict: allRecords.filter(r => r.status === 'db_conflict').length,
      geocoding_failed: allRecords.filter(r =>
        r.status === 'geocoding_failed' ||
        (r.status === 'pending' && !r.geocoding_success) ||
        (r.status === 'not_selected' && !r.geocoding_success)
      ).length,
      not_selected: allRecords.filter(r => r.is_not_selected).length,
      deleted: deletedCount,
    };

    setStats(newStats);
  };

  // allRecords가 변경될 때마다 통계 재계산
  useEffect(() => {
    if (allRecords.length > 0) {
      recalculateStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRecords]);

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
    if (record.is_missing) {
      toast({
        variant: 'destructive',
        title: '승인 불가',
        description: '⚠️ Missing 음식점 - 먼저 수동 등록이 필요합니다',
      });
      return;
    }

    if (!record.jibun_address) {
      toast({
        variant: 'destructive',
        title: '승인 불가',
        description: '⚠️ 지번주소 정보가 없습니다',
      });
      return;
    }

    try {
      setLoading(true);

      // status를 'approved'로 업데이트
      const { error } = await supabase
        .from('restaurants')
        .update({
          status: 'approved',
          updated_at: new Date().toISOString(),
        })
        .eq('id', record.id);

      if (error) throw error;

      // 상태 업데이트 (새로고침 없이)
      updateRecordInState(record.id, {
        status: 'approved',
        updated_at: new Date().toISOString(),
      });

      toast({
        title: '승인 완료',
        description: `✅ "${record.restaurant_name || record.name}" 맛집이 승인되었습니다`,
      });

    } catch (error: unknown) {
      console.error('승인 처리 실패:', error);
      toast({
        variant: 'destructive',
        title: '승인 처리 실패',
        description: error instanceof Error ? error.message : '알 수 없는 오류',
      });
    } finally {
      setLoading(false);
    }
  };

  // 병합 함수 (더 이상 필요 없음 - 단순화)
  const mergeToExisting = async (existing: Record<string, unknown>, newRecord: EvaluationRecord) => {
    toast({
      title: '병합 불필요',
      description: '새로운 스키마에서는 restaurants 테이블이 이미 통합되어 있습니다.',
    });
  };

  // DB 충돌 표시 (더 이상 필요 없음 - 단순화)
  const markAsDbConflict = async (newRecord: EvaluationRecord, existing: Record<string, unknown>) => {
    toast({
      variant: 'destructive',
      title: 'DB 충돌 처리 필요',
      description: '관리자가 직접 확인하고 처리해주세요.',
    });
  };

  // 새 음식점 등록 (더 이상 필요 없음 - 이미 restaurants 테이블에 있음)
  const insertNewRestaurant = async (record: EvaluationRecord) => {
    toast({
      title: '등록 불필요',
      description: '새로운 스키마에서는 이미 restaurants 테이블에 저장되어 있습니다.',
    });
  };

  // 삭제 핸들러 (Soft Delete)
  const handleDelete = async (record: EvaluationRecord) => {
    if (!confirm(`"${record.restaurant_name || record.name}"을(를) 정말 삭제하시겠습니까?\n\n⚠️ 삭제된 레코드는 화면에서 숨겨지며, 데이터 재로드 시에도 복구되지 않습니다.`)) {
      return;
    }

    try {
      // Soft Delete: status를 'deleted'로 변경
      const { error } = await supabase
        .from('restaurants')
        .update({
          status: 'deleted',
          updated_at: new Date().toISOString(),
        })
        .eq('id', record.id);

      if (error) throw error;

      // 상태 업데이트 (새로고침 없이)
      updateRecordInState(record.id, {
        status: 'deleted',
        updated_at: new Date().toISOString(),
      } as Partial<EvaluationRecord>);

      toast({
        title: '삭제 완료',
        description: `"${record.restaurant_name || record.name}"이(가) 삭제되었습니다 (복구 불가)`,
      });
    } catch (error: unknown) {
      toast({
        variant: 'destructive',
        title: '삭제 실패',
        description: error instanceof Error ? error.message : '알 수 없는 오류',
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

  // 인증 로딩 중이거나 권한 확인 중일 때
  if (authLoading || (loading && allRecords.length === 0)) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  // 로그인하지 않았거나 관리자가 아닌 경우 (리다이렉트 전 화면 방지)
  if (!user || !isAdmin) {
    return null;
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="border-b border-border bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-shrink-0">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent flex items-center gap-2">
                <ClipboardCheck className="h-6 w-6 text-primary" />
                관리자 데이터 검수
              </h1>
              <button
                onClick={() => setIsAlternateView(!isAlternateView)}
                className="p-2 rounded-md hover:bg-accent transition-colors"
                title={isAlternateView ? "기본 뷰로 전환" : "대체 뷰로 전환"}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={isAlternateView ? "text-primary" : "text-muted-foreground"}
                >
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              </button>
            </div>
            <p className="text-muted-foreground text-sm mt-1">
              총 {stats.total}개 레코드 | 필터링: {filteredRecords.length}개
            </p>
          </div>

          {/* 우측: 카테고리 필터 */}
          <div className="flex-1 flex justify-end">
            <CategorySidebar
              stats={stats}
              selectedStatuses={selectedStatuses}
              onSelectStatuses={setSelectedStatuses}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 테이블 영역 (무한 스크롤) */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div
            ref={scrollContainerRef}
            className="flex-1 p-4 overflow-auto"
            id="scroll-container"
          >
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
            ) : (
              <>
                <EvaluationTable
                  records={displayedRecords}
                  onApprove={handleApprove}
                  onDelete={handleDelete}
                  onRegisterMissing={handleRegisterMissing}
                  onResolveConflict={handleResolveConflict}
                  onEdit={handleEdit}
                  loading={loading || isSearching}
                  evalFilters={evalFilters}
                  isDeletedFilterActive={selectedStatuses.includes('deleted' as EvaluationRecordStatus)}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onFilterChange={(key, value) => {
                    setEvalFilters(prev => ({
                      ...prev,
                      [key]: value === '' ? undefined : value
                    }));
                  }}
                  onResetFilters={() => setEvalFilters({})}
                />

                {/* 로딩 인디케이터 */}
                {loadingMore && (
                  <div className="flex justify-center py-4">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                )}

                {/* 모든 데이터 로드 완료 메시지 */}
                {!hasMore && displayedRecords.length > 0 && (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    모든 레코드를 불러왔습니다 ({displayedRecords.length}개 / 전체 {filteredRecords.length}개)
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Missing 레스토랑 등록 폼 */}
      <MissingRestaurantForm
        record={selectedMissingRecord}
        open={missingFormOpen}
        onOpenChange={setMissingFormOpen}
        onSuccess={(recordId, updates) => {
          updateRecordInState(recordId, updates);
        }}
      />

      {/* DB 충돌 해결 패널 */}
      <DbConflictResolutionPanel
        record={selectedConflictRecord}
        open={conflictPanelOpen}
        onOpenChange={setConflictPanelOpen}
        onSuccess={(recordId, updates) => {
          updateRecordInState(recordId, updates);
        }}
      />

      {/* 보류 레스토랑 편집 모달 */}
      <EditRestaurantModal
        record={selectedEditRecord}
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        onSuccess={(recordId, updates) => {
          updateRecordInState(recordId, updates);
        }}
      />
    </div>
  );
}

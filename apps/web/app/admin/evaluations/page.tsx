"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { EvaluationRecord, EvaluationRecordStatus, CategoryStats } from '@/types/evaluation';
import { CategorySidebar } from '@/components/admin/CategorySidebar';
import { EvaluationTable } from '@/components/admin/EvaluationTableNew';
import { MissingRestaurantForm } from '@/components/admin/MissingRestaurantForm';
import { DbConflictResolutionPanel } from '@/components/admin/DbConflictResolutionPanel';
import { EditRestaurantModal } from '@/components/admin/EditRestaurantModal';
import { EvaluationSlideView } from '@/components/admin/EvaluationSlideView';
import { SubmissionSlideView } from '@/components/admin/SubmissionSlideView';
import { SubmissionRecord, ApprovalData } from '@/components/admin/SubmissionDetailView';
import { createNewRestaurantNotification } from '@/contexts/NotificationContext';
import { ClipboardCheck, Loader2, FileText, CheckCircle2, XCircle, AlertCircle, LayoutList, MonitorPlay, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GlobalLoader } from "@/components/ui/global-loader";
import { Input } from '@/components/ui/input';
import { checkRestaurantDuplicate } from '@/lib/db-conflict-checker';
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
const STORAGE_KEY = 'adminEvaluationPageState'; // localStorage 키

export default function AdminEvaluationPage() {
  const { toast } = useToast();
  const router = useRouter();
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
    ready_for_approval: 0,
    hold: 0,
    db_conflict: 0,
    missing: 0,
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

  // 승인 확인 모달 상태
  const [showApprovalConfirm, setShowApprovalConfirm] = useState(false);
  const [pendingApprovalRecord, setPendingApprovalRecord] = useState<EvaluationRecord | null>(null);
  const [conflictingRestaurantInfo, setConflictingRestaurantInfo] = useState<{
    name: string;
    address: string;
  } | null>(null);

  // 테이블 뷰 토글 상태
  const [isAlternateView, setIsAlternateView] = useState(false);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

  // 자막 수집 상태
  const [transcriptStatus, setTranscriptStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [transcriptMessage, setTranscriptMessage] = useState<string>('');

  // 사용자 제보 검수 상태
  const [showSubmissionView, setShowSubmissionView] = useState(false);
  const [currentSubmissionIndex, setCurrentSubmissionIndex] = useState(0);
  const [editingSubmission, setEditingSubmission] = useState<SubmissionRecord | null>(null);
  const queryClient = useQueryClient();

  // localStorage에서 상태 복원
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.selectedStatuses) setSelectedStatuses(parsed.selectedStatuses);
        if (parsed.searchQuery) setSearchQuery(parsed.searchQuery);
        if (parsed.evalFilters) setEvalFilters(parsed.evalFilters);
        if (parsed.isAlternateView) setIsAlternateView(parsed.isAlternateView);
      }
    } catch (error) {
      console.error('Failed to parse saved state:', error);
    }
  }, []);

  // 오류 경고 다이얼로그
  const [showConflictWarning, setShowConflictWarning] = useState(false);
  const [conflictWarningData, setConflictWarningData] = useState<{
    record: EvaluationRecord;
    conflicts: Record<string, unknown>[];
  } | null>(null);

  // 무한 스크롤을 위한 scroll container ref
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 첫 마운트 여부를 추적 (검색 자동 실행 방지)
  const isInitialMount = useRef(true);

  // 데이터 로드 여부 추적 (세션 동안 한 번만 로드)
  const hasLoadedData = useRef(false);

  // 권한 체크 완료 여부 추적 (초기 로드 시 한 번만 체크)
  const hasCheckedAuth = useRef(false);

  // 상태 변경 시 localStorage에 저장
  useEffect(() => {
    const stateToSave = {
      selectedStatuses,
      searchQuery,
      evalFilters,
      isAlternateView,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (error) {
      console.error('Failed to save state:', error);
    }
  }, [selectedStatuses, searchQuery, evalFilters, isAlternateView]);

  // 인증 체크 및 관리자 권한 확인
  useEffect(() => {
    // 인증 로딩 중에는 아무것도 하지 않음 (로딩 완료 후 권한 체크)
    if (authLoading) {
      return;
    }

    // 이미 권한 체크를 완료했으면 다시 체크하지 않음 (재마운트 시 중복 체크 방지)
    if (hasCheckedAuth.current) {
      return;
    }

    // 인증 로딩이 완료된 후 권한 체크
    if (!user) {
      hasCheckedAuth.current = true;
      toast({
        title: "접근 권한이 없습니다",
        description: "관리자만 접근할 수 있는 페이지입니다.",
        variant: "destructive",
      });
      router.push('/');
      return;
    }

    // user는 있지만 isAdmin이 false인 경우 - 비동기 체크가 완료될 때까지 대기
    if (!isAdmin) {
      return;
    }

    // user도 있고 isAdmin도 true인 경우
    hasCheckedAuth.current = true;

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin, authLoading]);

  // YouTube 제목 퍼지 검색
  useEffect(() => {
    // 첫 마운트 시에는 검색 실행하지 않음 (localStorage 복원으로 인한 자동 실행 방지)
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const performFuzzySearch = async () => {
      if (!searchQuery.trim()) {
        setSearchResults(null);
        return;
      }

      setIsSearching(true);
      try {
        // @ts-expect-error - Supabase RPC 타입 문제
        const { data, error } = await supabase.rpc('search_restaurants_by_youtube_title', {
          search_query: searchQuery.trim(),
          max_results: 100,
          include_all_status: true  // 관리자는 전체 상태 조회
        });

        if (error) {
          console.error('RPC 에러:', error);
          throw error;
        }

        // 검색 결과를 EvaluationRecord 형식으로 변환
        const convertedData = ((data as Record<string, unknown>[]) || []).map((r: Record<string, unknown>) => {
          // evaluation_results 변환
          const evaluationResults = r.evaluation_results as Record<string, unknown> | null;

          // restaurant_info 생성
          const restaurantInfo = {
            name: r.name as string,
            phone: r.phone as string | null,
            category: Array.isArray(r.categories) && r.categories.length > 0 ? r.categories[0] : '',
            origin_address: (r.origin_address as Record<string, unknown>)?.address as string || r.road_address as string || r.jibun_address as string || '',
            origin_lat: (r.origin_address as Record<string, unknown>)?.lat as number || r.lat as number || 0,
            origin_lng: (r.origin_address as Record<string, unknown>)?.lng as number || r.lng as number || 0,
            reasoning_basis: r.reasoning_basis as string || '',
            tzuyang_review: r.tzuyang_review as string || '',
            naver_address_info: r.road_address || r.jibun_address ? {
              road_address: r.road_address as string | null,
              jibun_address: r.jibun_address as string || '',
              english_address: r.english_address as string | null,
              address_elements: r.address_elements,
              x: r.lng?.toString() || '',
              y: r.lat?.toString() || '',
            } : null,
          };

          return {
            ...r,
            // 호환성을 위한 별칭 추가
            restaurant_name: r.name,
            youtube_link: r.youtube_link as string || '',
            // evaluation_results는 그대로 사용
            evaluation_results: evaluationResults,
            // restaurant_info 생성
            restaurant_info: restaurantInfo,
            // youtube_meta 처리 (JSON 직접 사용)
            youtube_meta: r.youtube_meta || null,
          };
        });

        setSearchResults(convertedData as unknown as EvaluationRecord[]);
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

    // 기본: 모든 레코드 포함 (Deleted 포함)
    let filtered = baseRecords;

    // 상태 필터링 (evalFilters.status)
    if (evalFilters.status) {
      // 'deleted' 필터 선택 시 특별 처리: baseRecords에서 deleted만 추출
      if (evalFilters.status === 'deleted') {
        filtered = baseRecords.filter(r => r.status === 'deleted');
      } else {
        filtered = filtered.filter(r => {
          let match = false;

          switch (evalFilters.status) {
            case 'geocoding_failed':
              // 지오코딩 실패: geocoding_success가 false인 모든 레코드
              match = !r.geocoding_success;
              break;
            case 'missing':
              // Missing: is_missing이 true인 레코드
              match = r.is_missing === true;
              break;
            case 'not_selected':
              // 평가 미대상: is_not_selected가 true인 레코드
              match = r.is_not_selected === true;
              break;
            case 'ready_for_approval':
              // 승인 대기: 모든 평가 항목이 최고 점수를 받은 레코드 + status가 pending이거나 hold인 경우만
              match = r.evaluation_results?.visit_authenticity?.eval_value === 1 &&
                r.evaluation_results?.rb_inference_score?.eval_value === 1 &&
                r.evaluation_results?.rb_grounding_TF?.eval_value === true &&
                r.evaluation_results?.review_faithfulness_score?.eval_value === 1 &&
                r.geocoding_success === true &&
                r.evaluation_results?.category_validity_TF?.eval_value === true &&
                r.evaluation_results?.category_TF?.eval_value === true &&
                (r.status === 'pending' || r.status === 'hold'); // 승인되지 않은 것만
              break;
            default:
              // 일반 상태: status 필드와 일치하는 레코드
              match = r.status === evalFilters.status;
              break;
          }

          return match;
        });
      }
    }

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

    // 8. Status 필터는 위에서 이미 처리됨

    return filtered;
  }, [allRecords, searchResults, selectedStatuses, evalFilters]);

  // filteredRecords가 정의된 후에 useEffect 위치
  useEffect(() => {
    // 필터링된 레코드 내에서 현재 인덱스가 유효한지 확인
    if (currentSlideIndex >= filteredRecords.length && filteredRecords.length > 0) {
      setCurrentSlideIndex(0);
    }
  }, [filteredRecords.length, currentSlideIndex]);

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
        loadMoreRecords();
      }
    };

    scrollContainer.addEventListener('scroll', handleScroll);
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, [hasMore, loadingMore, loadMoreRecords, displayedRecords.length, filteredRecords.length]);

  // 슬라이드 뷰에서 끝에 도달하면 추가 데이터 로드
  useEffect(() => {
    if (isAlternateView && hasMore && !loadingMore) {
      // 현재 인덱스가 표시된 레코드의 끝부분(마지막 5개)에 도달하면 추가 로드
      if (currentSlideIndex >= displayedRecords.length - 5) {
        loadMoreRecords();
      }
    }
  }, [isAlternateView, currentSlideIndex, displayedRecords.length, hasMore, loadingMore, loadMoreRecords]);

  // 전체 데이터 로드 (한 번만)
  const loadAllRecords = useCallback(async () => {
    try {
      setLoading(true);

      // 모든 레코드 조회 (restaurants 테이블에서)
      // Supabase API는 1000개 제한이 있으므로 페이지네이션으로 전체 로드
      const PAGE_LIMIT = 1000;
      let allData: Record<string, unknown>[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: pageData, error: pageError } = await supabase
          .from('restaurants')
          .select('*')
          .range(from, from + PAGE_LIMIT - 1)
          .order('created_at', { ascending: false });

        if (pageError) {
          console.error('Supabase error:', pageError);
          throw pageError;
        }

        if (pageData && pageData.length > 0) {
          allData = [...allData, ...pageData];
          from += PAGE_LIMIT;
          hasMore = pageData.length === PAGE_LIMIT;  // 1000개 미만이면 마지막 페이지
        } else {
          hasMore = false;
        }
      }

      const data = allData;
      const error = null;

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      // 디버그: 실제 로드된 레코드 수 확인
      console.log('📊 데이터 로드 완료:', data?.length, '개 로드됨');

      if (!data) {
        console.warn('No data returned from restaurants');
        setAllRecords([]);
        setDisplayedRecords([]);
        setStats({
          total: 0,
          pending: 0,
          approved: 0,
          ready_for_approval: 0,
          hold: 0,
          db_conflict: 0,
          missing: 0,
          geocoding_failed: 0,
          not_selected: 0,
          deleted: 0,
        });
        return;
      }

      // restaurants 테이블 데이터를 EvaluationRecord 형식으로 변환
      const records = data.map((r: Record<string, unknown>) => {
        // evaluation_results 변환
        const evaluationResults = r.evaluation_results as Record<string, unknown> | null;

        // restaurant_info 생성 (항상 생성)
        const restaurantInfo = {
          name: r.name as string,
          phone: r.phone as string | null,
          category: Array.isArray(r.categories) && r.categories.length > 0 ? r.categories[0] : '',
          origin_address: (r.origin_address as Record<string, unknown>)?.address as string || r.road_address as string || r.jibun_address as string || '',
          origin_lat: (r.origin_address as Record<string, unknown>)?.lat as number || r.lat as number || 0,
          origin_lng: (r.origin_address as Record<string, unknown>)?.lng as number || r.lng as number || 0,
          reasoning_basis: r.reasoning_basis as string || '',
          tzuyang_review: r.tzuyang_review as string || '',
          naver_address_info: r.road_address || r.jibun_address ? {
            road_address: r.road_address as string | null,
            jibun_address: r.jibun_address as string || '',
            english_address: r.english_address as string | null,
            address_elements: r.address_elements,
            x: r.lng?.toString() || '',
            y: r.lat?.toString() || '',
          } : null,
        };

        return {
          ...r,
          // 호환성을 위한 별칭 추가
          restaurant_name: r.name,
          youtube_link: r.youtube_link as string || '',
          // evaluation_results는 그대로 사용 (JSONB 데이터)
          evaluation_results: evaluationResults,
          // restaurant_info 생성
          restaurant_info: restaurantInfo,
          // youtube_meta 처리
          youtube_meta: r.youtube_meta || null,
        };
      });

      setAllRecords(records as unknown as EvaluationRecord[]);

      // 통계 계산 (전체 레코드 기준)
      const typedRecords = records as unknown as EvaluationRecord[];
      const deletedCount = typedRecords.filter(r => r.status === 'deleted').length;

      const newStats: CategoryStats = {
        total: typedRecords.length, // 삭제 포함 전체
        pending: typedRecords.filter(r => r.status === 'pending').length,
        approved: typedRecords.filter(r => r.status === 'approved').length,
        hold: typedRecords.filter(r => r.status === 'hold').length,
        missing: typedRecords.filter(r => r.is_missing).length,
        db_conflict: typedRecords.filter(r => r.status === 'db_conflict').length,
        ready_for_approval: typedRecords.filter(r =>
          r.evaluation_results?.visit_authenticity?.eval_value === 1 &&
          r.evaluation_results?.rb_inference_score?.eval_value === 1 &&
          r.evaluation_results?.rb_grounding_TF?.eval_value === true &&
          r.evaluation_results?.review_faithfulness_score?.eval_value === 1 &&
          r.geocoding_success === true &&
          r.evaluation_results?.category_validity_TF?.eval_value === true &&
          r.evaluation_results?.category_TF?.eval_value === true &&
          (r.status === 'pending' || r.status === 'hold') // 승인되지 않은 것만
        ).length,
        geocoding_failed: typedRecords.filter(r =>
          !r.geocoding_success  // 지오코딩이 실패한 모든 레코드 (deleted 제외)
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
        ready_for_approval: 0,
        geocoding_failed: 0,
        not_selected: 0,
        deleted: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // 초기 데이터 로드
  useEffect(() => {
    // 이미 데이터를 로드했으면 건너뛰기 (컴포넌트 재마운트 시 중복 로드 방지)
    if (hasLoadedData.current) {
      return;
    }

    if (user && isAdmin && !authLoading) {
      hasLoadedData.current = true;
      loadAllRecords();
    }
    // loadAllRecords는 의존성에서 제외 (무한 루프 방지)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin, authLoading]);

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

    const newStats: CategoryStats = {
      total: allRecords.length, // 삭제 포함 전체
      pending: allRecords.filter(r => r.status === 'pending').length,
      approved: allRecords.filter(r => r.status === 'approved').length,
      hold: allRecords.filter(r => r.status === 'hold').length,
      db_conflict: allRecords.filter(r => r.status === 'db_conflict').length,
      ready_for_approval: allRecords.filter(r =>
        r.evaluation_results?.visit_authenticity?.eval_value === 1 &&
        r.evaluation_results?.rb_inference_score?.eval_value === 1 &&
        r.evaluation_results?.rb_grounding_TF?.eval_value === true &&
        r.evaluation_results?.review_faithfulness_score?.eval_value === 1 &&
        r.geocoding_success === true &&
        r.evaluation_results?.category_validity_TF?.eval_value === true &&
        r.evaluation_results?.category_TF?.eval_value === true &&
        (r.status === 'pending' || r.status === 'hold') // 승인되지 않은 것만
      ).length,
      missing: allRecords.filter(r => r.is_missing).length,
      geocoding_failed: allRecords.filter(r =>
        !r.geocoding_success  // 지오코딩이 실패한 모든 레코드
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

  // 승인 핸들러 (오류 체크 포함)
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

      // YouTube 링크 추출 (단일 값)
      const youtubeLink = record.youtube_link || '';

      console.log('🔍 중복 검사 시작:', {
        name: record.restaurant_name || record.name,
        jibun_address: record.jibun_address,
        record_id: record.id,
        youtube_link: youtubeLink,
      });

      // 🔥 중복 검사 추가 (YouTube 링크 포함)
      const duplicateCheck = await checkRestaurantDuplicate(
        record.restaurant_name || record.name || '',
        record.jibun_address,
        record.id,
        youtubeLink // YouTube 링크 전달
      );

      console.log('📊 중복 검사 결과:', duplicateCheck);

      if (duplicateCheck.isDuplicate) {
        console.log('⚠️ 중복 감지!', {
          matchedRestaurant: duplicateCheck.matchedRestaurant,
          currentYoutubeLink: youtubeLink,
          matchedYoutubeLink: duplicateCheck.matchedRestaurant?.youtube_link,
        });

        // 🔥 수정: 유튜브 링크 비교 로직 개선
        const currentYoutubeLink = youtubeLink?.trim() || null;
        const matchedYoutubeLink = duplicateCheck.matchedRestaurant?.youtube_link?.trim() || null;

        console.log('🔗 유튜브 링크 비교:', {
          current: currentYoutubeLink,
          matched: matchedYoutubeLink,
          isDifferent: currentYoutubeLink !== matchedYoutubeLink,
        });

        // 유튜브 링크가 다른 경우: 확인 모달 표시
        if (currentYoutubeLink !== matchedYoutubeLink) {
          console.log('✅ 유튜브 링크가 다름 → 확인 모달 표시');

          // 모달 상태 설정
          setPendingApprovalRecord(record);
          setConflictingRestaurantInfo({
            name: duplicateCheck.matchedRestaurant!.name,
            address: duplicateCheck.matchedRestaurant!.jibun_address || duplicateCheck.matchedRestaurant!.road_address || '',
          });
          setShowApprovalConfirm(true);
          setLoading(false);
          return;
        }

        console.log('❌ 유튜브 링크가 같음 → 중복 오류 처리');

        // 유튜브 링크가 같은 경우: 중복 오류 처리 (기존 로직)
        // 중복 발견 시 에러 정보 저장
        const errorDetails = {
          error_type: 'duplicate' as const,
          conflicting_restaurant: {
            id: duplicateCheck.matchedRestaurant!.id,
            name: duplicateCheck.matchedRestaurant!.name,
            jibun_address: duplicateCheck.matchedRestaurant!.jibun_address,
            road_address: duplicateCheck.matchedRestaurant!.road_address || undefined,
          },
          similarity_score: duplicateCheck.similarityScore,
          detected_at: new Date().toISOString(),
        };

        // status는 유지하고 에러 메시지만 저장
        await supabase
          .from('restaurants')
          // @ts-expect-error - Supabase 자동 생성 타입 문제
          .update({
            db_error_message: duplicateCheck.reason,
            db_error_details: errorDetails,
          })
          .eq('id', record.id);

        // 상태 업데이트 (새로고침 없이)
        updateRecordInState(record.id, {
          db_error_message: duplicateCheck.reason,
          db_error_details: errorDetails,
        });

        toast({
          variant: 'destructive',
          title: '중복 오류',
          description: duplicateCheck.reason,
        });

        setLoading(false);
        return;
      }

      // 실제 승인 처리 실행
      await performApproval(record);

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

  // 실제 승인 처리 실행 (중복 확인 후 재사용)
  const performApproval = async (record: EvaluationRecord) => {
    // status를  'approved'로 업데이트
    const { error } = await supabase
      .from('restaurants')
      // @ts-expect-error - Supabase 자동 생성 타입 문제
      .update({
        status: 'approved',
        db_error_message: null, // 에러 메시지 초기화
        db_error_details: null, // 에러 상세 초기화
        updated_at: new Date().toISOString(),
      })
      .eq('id', record.id);

    if (error) throw error;

    // 상태 업데이트 (새로고침 없이)
    updateRecordInState(record.id, {
      status: 'approved',
      db_error_message: null,
      db_error_details: null,
      updated_at: new Date().toISOString(),
    });

    toast({
      title: '승인 완료',
      description: `✅ "${record.restaurant_name || record.name}" 맛집이 승인되었습니다`,
    });
  };

  // 병합 함수 (더 이상 필요 없음 - 단순화)
  const mergeToExisting = async (existing: Record<string, unknown>, newRecord: EvaluationRecord) => {
    toast({
      title: '병합 불필요',
      description: '새로운 스키마에서는 restaurants 테이블이 이미 통합되어 있습니다.',
    });
  };

  // 오류 표시 (더 이상 필요 없음 - 단순화)
  const markAsError = async (newRecord: EvaluationRecord, existing: Record<string, unknown>) => {
    toast({
      variant: 'destructive',
      title: '오류 처리 필요',
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
        // @ts-expect-error - Supabase 자동 생성 타입 문제
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
        description: `"${record.restaurant_name || record.name}"이(가) 삭제되었습니다`,
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

  // 삭제된 레코드 복원 (pending 상태로 되돌리기)
  const handleRestore = async (record: EvaluationRecord) => {
    if (!confirm(`"${record.restaurant_name || record.name}"을(를) 복원하시겠습니까?\n\n복원하면 미처리(pending) 상태로 돌아갑니다.`)) {
      return;
    }

    try {
      setLoading(true);

      // status를 'pending'으로 업데이트
      const { error } = await supabase
        .from('restaurants')
        // @ts-expect-error - Supabase 자동 생성 타입 문제
        .update({
          status: 'pending',
          updated_at: new Date().toISOString(),
        })
        .eq('id', record.id);

      if (error) throw error;

      // 상태 업데이트 (새로고침 없이)
      updateRecordInState(record.id, {
        status: 'pending',
        updated_at: new Date().toISOString(),
      } as Partial<EvaluationRecord>);

      toast({
        title: '복원 완료',
        description: `"${record.restaurant_name || record.name}"이(가) 미처리 상태로 복원되었습니다`,
      });
    } catch (error: unknown) {
      console.error('복원 실패:', error);
      toast({
        variant: 'destructive',
        title: '복원 실패',
        description: error instanceof Error ? error.message : '알 수 없는 오류',
      });
    } finally {
      setLoading(false);
    }
  };

  // 자막 수집 핸들러 (로컬 FastAPI 서버 호출)
  const handleCollectTranscripts = async () => {
    setTranscriptStatus('loading');
    setTranscriptMessage('자막 수집 중...');

    try {
      // 1. 먼저 상태 확인
      const statusResponse = await fetch('http://localhost:8000/status');
      if (!statusResponse.ok) {
        throw new Error('FastAPI 서버에 연결할 수 없습니다. uvicorn main:app --reload 명령으로 서버를 시작하세요.');
      }

      const statusData = await statusResponse.json();

      if (statusData.pending_urls === 0) {
        setTranscriptStatus('success');
        setTranscriptMessage(`수집할 새로운 URL이 없습니다. (기존 ${statusData.existing_transcripts}개)`);
        toast({
          title: '수집 완료',
          description: `수집할 새로운 URL이 없습니다. 기존 ${statusData.existing_transcripts}개의 자막이 있습니다.`,
        });
        return;
      }

      setTranscriptMessage(`${statusData.pending_urls}개 URL 자막 수집 중...`);

      // 2. 자막 수집 및 GitHub 커밋 실행
      const collectResponse = await fetch('http://localhost:8000/collect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          auto_commit: true,  // 수집 후 자동 커밋
        }),
      });

      if (!collectResponse.ok) {
        const errorData = await collectResponse.json();
        throw new Error(errorData.detail || '자막 수집 실패');
      }

      const result = await collectResponse.json();

      if (result.success) {
        setTranscriptStatus('success');
        const commitInfo = result.committed ? ' → GitHub 커밋 완료!' : '';
        setTranscriptMessage(`✅ ${result.success_count}개 수집 성공${commitInfo}`);

        toast({
          title: '🎬 자막 수집 완료',
          description: (
            <div className="space-y-1">
              <p>성공: {result.success_count}개, 실패: {result.failed_count}개</p>
              {result.committed && (
                <p className="text-green-600 font-medium">
                  ✅ GitHub 커밋 완료! 파이프라인이 자동 실행됩니다.
                </p>
              )}
            </div>
          ),
        });
      } else {
        throw new Error(result.message || '수집 실패');
      }
    } catch (error: unknown) {
      console.error('자막 수집 실패:', error);
      setTranscriptStatus('error');

      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
      setTranscriptMessage(`❌ ${errorMessage}`);

      // 연결 오류인 경우 상세 안내
      if (errorMessage.includes('연결할 수 없습니다') || errorMessage.includes('Failed to fetch')) {
        toast({
          variant: 'destructive',
          title: '서버 연결 실패',
          description: (
            <div className="space-y-2">
              <p>로컬 FastAPI 서버가 실행 중이 아닙니다.</p>
              <code className="block text-xs bg-muted p-2 rounded">
                cd backend/transcript-api<br />
                uvicorn main:app --reload
              </code>
            </div>
          ),
        });
      } else {
        toast({
          variant: 'destructive',
          title: '자막 수집 실패',
          description: errorMessage,
        });
      }
    }
  };

  // 사용자 제보 데이터 쿼리
  const { data: submissionsData = [], isLoading: submissionsLoading } = useQuery({
    queryKey: ['admin-submissions-inline', user?.id, isAdmin],
    queryFn: async () => {
      if (!user || !isAdmin) return [];

      const { data: submissionsData, error: submissionsError } = await supabase
        .from('restaurant_submissions')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      console.log('[Submissions Query] user:', user?.id, 'isAdmin:', isAdmin);
      console.log('[Submissions Query] data:', submissionsData, 'error:', submissionsError);

      if (submissionsError) throw submissionsError;
      if (!submissionsData?.length) return [];

      const userIds = [...new Set(submissionsData.map((s: any) => s.user_id))];
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('user_id, nickname')
        .in('user_id', userIds);

      const profilesMap = new Map((profilesData || []).map((p: any) => [p.user_id, p.nickname]));

      // 수정 요청(edit)인 제보들의 unique_id 수집
      const editSubmissions = submissionsData.filter((s: any) => s.submission_type === 'edit');
      const uniqueIds: string[] = [];
      editSubmissions.forEach((s: any) => {
        const restaurants = s.user_restaurants_submission || [];
        restaurants.forEach((r: any) => {
          if (r.unique_id) {
            uniqueIds.push(r.unique_id);
          }
        });
      });

      // unique_id로 기존 맛집 정보 조회
      let originalRestaurantsMap = new Map<string, any>();
      if (uniqueIds.length > 0) {
        const { data: originalData } = await supabase
          .from('restaurants')
          .select('id, unique_id, name, road_address, jibun_address, phone, categories, youtube_link, tzuyang_review')
          .in('unique_id', uniqueIds);

        if (originalData) {
          originalData.forEach((r: any) => {
            originalRestaurantsMap.set(r.unique_id, {
              id: r.id,
              unique_id: r.unique_id,
              name: r.name,
              address: r.road_address || r.jibun_address || '',
              phone: r.phone,
              categories: r.categories || [],
              youtube_link: r.youtube_link,
              tzuyang_review: r.tzuyang_review,
            });
          });
        }
      }

      // JSONB 배열에서 첫 번째 맛집 정보를 추출하여 기존 필드로 매핑
      return submissionsData.map((s: any) => {
        const restaurants = s.user_restaurants_submission || [];
        const firstRestaurant = restaurants[0] || {};

        // 수정 요청인 경우 기존 맛집 정보 추가
        let originalRestaurantData = null;
        if (s.submission_type === 'edit' && firstRestaurant.unique_id) {
          originalRestaurantData = originalRestaurantsMap.get(firstRestaurant.unique_id) || null;
        }

        return {
          id: s.id,
          user_id: s.user_id,
          restaurant_name: firstRestaurant.name || '',
          address: firstRestaurant.address || '',
          phone: firstRestaurant.phone || null,
          category: firstRestaurant.categories || [],
          youtube_link: firstRestaurant.youtube_link || '',
          description: firstRestaurant.tzuyang_review || null,
          status: s.status === 'all_approved' ? 'approved' : s.status === 'all_deleted' ? 'rejected' : 'pending',
          rejection_reason: s.rejection_reason,
          created_at: s.created_at,
          reviewed_at: s.reviewed_at,
          reviewed_by_admin_id: s.resolved_by_admin_id,
          approved_restaurant_id: null,
          submission_type: s.submission_type,
          // 수정 요청 시 unique_id 보존 (비교 뷰 및 업데이트 시 필요)
          unique_id: firstRestaurant.unique_id || null,
          original_restaurant_data: originalRestaurantData,
          profiles: { nickname: profilesMap.get(s.user_id) || '알 수 없음' }
        };
      }) as SubmissionRecord[];

    },
    enabled: !!user && isAdmin,
    refetchInterval: 30000, // 30초마다 자동 새로고침
    refetchOnWindowFocus: true, // 윈도우 포커스 시 자동 새로고침
  });

  // 제보 승인 mutation
  const approveSubmissionMutation = useMutation({
    mutationFn: async ({ submission, approvalData }: { submission: SubmissionRecord; approvalData: ApprovalData }) => {
      if (!user) throw new Error('로그인이 필요합니다');
      const lat = parseFloat(approvalData.lat);
      const lng = parseFloat(approvalData.lng);
      if (isNaN(lat) || isNaN(lng)) throw new Error('올바른 좌표가 필요합니다');

      const { data: restaurant, error: restaurantError } = await (supabase
        .from('restaurants') as any)
        .insert({
          name: submission.restaurant_name,
          road_address: approvalData.road_address,
          jibun_address: approvalData.jibun_address,
          english_address: approvalData.english_address,
          address_elements: approvalData.address_elements,
          phone: submission.phone,
          categories: Array.isArray(submission.category) ? submission.category : [submission.category],
          youtube_link: submission.youtube_link,
          description: submission.description,
          lat, lng,
          geocoding_success: true,
          status: 'approved',
        })
        .select()
        .single();

      if (restaurantError) throw restaurantError;

      const { error: updateError } = await (supabase
        .from('restaurant_submissions') as any)
        .update({
          status: 'all_approved',
          resolved_by_admin_id: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', submission.id);

      if (updateError) throw updateError;
      return { submission, restaurant };
    },
    onSuccess: ({ submission }) => {
      toast({ title: '제보 승인 완료', description: `"${submission.restaurant_name}" 맛집이 등록되었습니다` });
      createNewRestaurantNotification(submission.restaurant_name, submission.address, {
        category: submission.category,
        submissionId: submission.id
      });
      queryClient.invalidateQueries({ queryKey: ['admin-submissions-inline'] });
      queryClient.invalidateQueries({ queryKey: ['restaurants'] });
      if (currentSubmissionIndex >= submissionsData.length - 1 && currentSubmissionIndex > 0) {
        setCurrentSubmissionIndex(currentSubmissionIndex - 1);
      }
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: '승인 실패', description: error.message });
    },
  });

  // 제보 거부 mutation
  const rejectSubmissionMutation = useMutation({
    mutationFn: async ({ submission, reason }: { submission: SubmissionRecord; reason: string }) => {
      if (!user) throw new Error('로그인이 필요합니다');
      const { error } = await (supabase
        .from('restaurant_submissions') as any)
        .update({
          status: 'all_deleted',
          rejection_reason: reason,
          resolved_by_admin_id: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', submission.id);
      if (error) throw error;
      return submission;
    },
    onSuccess: ({ restaurant_name }) => {
      toast({ title: '제보 거부됨', description: `"${restaurant_name}" 제보가 거부되었습니다` });
      queryClient.invalidateQueries({ queryKey: ['admin-submissions-inline'] });
      if (currentSubmissionIndex >= submissionsData.length - 1 && currentSubmissionIndex > 0) {
        setCurrentSubmissionIndex(currentSubmissionIndex - 1);
      }
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: '거부 실패', description: error.message });
    },
  });

  // 제보 삭제 mutation (소프트 삭제 - status를 all_deleted로 변경)
  const deleteSubmissionMutation = useMutation({
    mutationFn: async (submission: SubmissionRecord) => {
      if (!user) throw new Error('로그인이 필요합니다');
      const { error } = await (supabase
        .from('restaurant_submissions') as any)
        .update({
          status: 'all_deleted',
          rejection_reason: '관리자에 의해 삭제됨',
          resolved_by_admin_id: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', submission.id);
      if (error) throw error;
      return submission;
    },
    onSuccess: ({ restaurant_name }) => {
      toast({ title: '제보 삭제됨', description: `"${restaurant_name}" 제보가 삭제되었습니다` });
      queryClient.invalidateQueries({ queryKey: ['admin-submissions-inline'] });
      if (currentSubmissionIndex >= submissionsData.length - 1 && currentSubmissionIndex > 0) {
        setCurrentSubmissionIndex(currentSubmissionIndex - 1);
      }
    },
    onError: (error: any) => {
      console.error('[Delete Submission Error]', error);
      toast({ variant: 'destructive', title: '삭제 실패', description: error.message });
    },
  });

  const handleApproveSubmission = (submission: SubmissionRecord, approvalData: ApprovalData) => {
    approveSubmissionMutation.mutate({ submission, approvalData });
  };

  const handleRejectSubmission = (submission: SubmissionRecord, reason: string) => {
    rejectSubmissionMutation.mutate({ submission, reason });
  };

  const handleDeleteSubmission = (submission: SubmissionRecord) => {
    deleteSubmissionMutation.mutate(submission);
  };

  // 제보 수정 핸들러 - 제보를 EvaluationRecord 형태로 변환하여 EditRestaurantModal에서 사용
  const handleEditSubmission = (submission: SubmissionRecord) => {
    setEditingSubmission(submission);
    // 제보를 EvaluationRecord 형태로 변환 (타입 호환성을 위해 as unknown as EvaluationRecord 사용)
    const evaluationRecord = {
      id: submission.id,
      unique_id: `submission_${submission.id}`,
      name: submission.restaurant_name,
      restaurant_name: submission.restaurant_name,
      restaurant_info: {
        name: submission.restaurant_name,
        phone: submission.phone || '',
        category: Array.isArray(submission.category)
          ? (submission.category[0] || '')
          : (submission.category || ''),
        origin_address: submission.address,
        tzuyang_review: submission.description || '',
        naver_address_info: null,
      },
      categories: Array.isArray(submission.category) ? submission.category : [submission.category],
      phone: submission.phone || '',
      road_address: submission.address,
      jibun_address: '',
      english_address: '',
      address_elements: null,
      origin_address: submission.address,
      lat: 0,
      lng: 0,
      youtube_link: submission.youtube_link,
      youtube_links: submission.youtube_link ? [submission.youtube_link] : [],
      youtube_meta: null,
      tzuyang_reviews: submission.description || '',
      reasoning_basis: null,
      evaluation_results: null,
      status: 'pending',
      source_type: 'user_submission_new',
      geocoding_success: false,
      created_at: submission.created_at,
      updated_at: submission.created_at,
    } as unknown as EvaluationRecord;
    setSelectedEditRecord(evaluationRecord);
    setEditModalOpen(true);
  };

  // 제보 수정 저장 mutation
  const updateSubmissionMutation = useMutation({
    mutationFn: async (data: {
      submission: SubmissionRecord;
      updatedData: {
        restaurant_name: string;
        address: string;
        phone: string;
        categories: string[];
        youtube_link: string;
        description: string;
      };
    }) => {
      const { submission, updatedData } = data;

      // user_restaurants_submission JSONB 업데이트 (unique_id 보존)
      const restaurantInfo = {
        unique_id: submission.unique_id || null, // 수정 요청 시 기존 맛집 연결 유지
        name: updatedData.restaurant_name,
        categories: updatedData.categories,
        phone: updatedData.phone || null,
        address: updatedData.address,
        youtube_link: updatedData.youtube_link || null,
        tzuyang_review: updatedData.description || null,
      };

      const { error } = await (supabase
        .from('restaurant_submissions') as any)
        .update({
          user_restaurants_submission: [restaurantInfo],
        })
        .eq('id', submission.id);

      if (error) throw error;
      return submission;
    },
    onSuccess: (submission) => {
      toast({ title: '제보 수정 완료', description: '제보 정보가 수정되었습니다' });
      // 사용자 제보 목록 즉시 갱신 (refetchType: 'all'로 강제 새로고침)
      queryClient.invalidateQueries({
        queryKey: ['admin-submissions-inline'],
        refetchType: 'all',
      });
      queryClient.invalidateQueries({ queryKey: ['restaurants'] });
      setEditingSubmission(null);
      setEditModalOpen(false);
      // 현재 인덱스의 submission 데이터도 강제 갱신
      console.log('[Update Submission Success]', submission.id);
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: '수정 실패', description: error.message });
    },
  });

  // 인증 로딩 중이거나 권한 확인 중일 때

  if (authLoading || (loading && allRecords.length === 0)) {
    return (
      <GlobalLoader
        message="관리자 데이터 검수 로딩 중..."
        subMessage="데이터를 불러오고 있습니다"
      />
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


            </div>
            <p className="text-muted-foreground text-sm mt-1">
              필터링: {filteredRecords.length}개 | 현 {stats.total}개 레코드 | 삭제한 레코드 {stats.deleted}개
            </p>
          </div>

          {/* 우측: 카테고리 필터 */}
          <div className="flex-1 flex justify-end">
            <CategorySidebar
              stats={stats}
              selectedStatuses={selectedStatuses}
              onSelectStatuses={setSelectedStatuses}
            >
              <div className="flex items-center gap-1">
                <Button
                  variant={!isAlternateView && !showSubmissionView ? "secondary" : "ghost"}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => { setIsAlternateView(false); setShowSubmissionView(false); }}
                  title="리스트 뷰"
                >
                  <LayoutList className="h-4 w-4" />
                </Button>
                <Button
                  variant={isAlternateView && !showSubmissionView ? "secondary" : "ghost"}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => { setIsAlternateView(true); setShowSubmissionView(false); }}
                  title="슬라이드 뷰"
                >
                  <MonitorPlay className="h-4 w-4" />
                </Button>
                {/* 자막 수집 버튼 (아이콘 only) */}
                <Button
                  onClick={handleCollectTranscripts}
                  disabled={transcriptStatus === 'loading'}
                  variant={transcriptStatus === 'success' ? 'default' : transcriptStatus === 'error' ? 'destructive' : 'ghost'}
                  size="icon"
                  className="h-8 w-8"
                  title={transcriptStatus === 'loading' ? '자막 수집 중...' : 'YouTube 자막 수집 실행'}
                >
                  {transcriptStatus === 'loading' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : transcriptStatus === 'success' ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : transcriptStatus === 'error' ? (
                    <XCircle className="h-4 w-4" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                </Button>
                {/* 사용자 제보 검수 버튼 */}
                <Button
                  onClick={() => {
                    const newShowSubmission = !showSubmissionView;
                    setShowSubmissionView(newShowSubmission);
                    if (newShowSubmission) {
                      setCurrentSubmissionIndex(0);
                      setIsAlternateView(false); // 슬라이드 뷰 비활성화
                    }
                  }}
                  variant={showSubmissionView ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-8 w-8 relative"
                  title={`사용자 제보 검수 (${submissionsData.length}건)`}
                >
                  <Send className="h-4 w-4" />
                  {submissionsData.length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                      {submissionsData.length > 9 ? '9+' : submissionsData.length}
                    </span>
                  )}
                </Button>
              </div>

              {/* 구분선 */}
              <div className="h-6 w-px bg-border" />
            </CategorySidebar>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {showSubmissionView ? (
          /* 사용자 제보 슬라이드 검수 뷰 */
          <SubmissionSlideView
            submissions={submissionsData}
            currentIndex={currentSubmissionIndex}
            onNavigate={setCurrentSubmissionIndex}
            onApprove={handleApproveSubmission}
            onReject={handleRejectSubmission}
            onDelete={handleDeleteSubmission}
            onEdit={handleEditSubmission}
            loading={approveSubmissionMutation.isPending || rejectSubmissionMutation.isPending || deleteSubmissionMutation.isPending}
          />
        ) : isAlternateView ? (
          <EvaluationSlideView
            records={displayedRecords}
            currentIndex={currentSlideIndex}
            onNavigate={setCurrentSlideIndex}
            onApprove={handleApprove}
            onDelete={handleDelete}
            onRestore={handleRestore}
            onRegisterMissing={handleRegisterMissing}
            onResolveConflict={handleResolveConflict}
            onEdit={handleEdit}
            loading={loading}
          />
        ) : (
          /* 테이블 영역 (무한 스크롤) */
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
                    onRestore={handleRestore}
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
        )}
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

      {/* 오류 해결 패널 */}
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

          // 사용자 제보 수정 시 restaurant_submissions 테이블도 업데이트
          if (editingSubmission) {
            updateSubmissionMutation.mutate({
              submission: editingSubmission,
              updatedData: {
                restaurant_name: updates.name || editingSubmission.restaurant_name,
                address: updates.road_address || updates.jibun_address || editingSubmission.address,
                phone: updates.phone || '',
                categories: updates.categories || (Array.isArray(editingSubmission.category) ? editingSubmission.category : [editingSubmission.category]),
                youtube_link: updates.youtube_link || editingSubmission.youtube_link, // 수정된 유튜브 링크 우선 사용
                description: (typeof updates.tzuyang_reviews === 'string' ? updates.tzuyang_reviews : null) || updates.restaurant_info?.tzuyang_review || editingSubmission.description || '',
              },
            });
          } else {
            // 사용자 제보가 아닌 경우 쿼리만 무효화
            queryClient.invalidateQueries({ queryKey: ['admin-submissions-inline'] });
            queryClient.invalidateQueries({ queryKey: ['restaurants'] });
          }
        }}
      />

      {/* 승인 확인 모달 */}
      <AlertDialog open={showApprovalConfirm} onOpenChange={setShowApprovalConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>승인 확인</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>이름이 유사한 레스토랑이 존재하지만 유튜브 링크가 다릅니다.</p>
                {conflictingRestaurantInfo && (
                  <div className="mt-3 p-3 bg-muted rounded-md">
                    <p className="font-medium">기존 레스토랑:</p>
                    <p className="text-sm mt-1">이름: {conflictingRestaurantInfo.name}</p>
                    <p className="text-sm">주소: {conflictingRestaurantInfo.address}</p>
                  </div>
                )}
                <p className="mt-3 font-medium">승인하시겠습니까?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!pendingApprovalRecord) return;

                setShowApprovalConfirm(false);
                setLoading(true);
                try {
                  await performApproval(pendingApprovalRecord);
                } catch (error) {
                  console.error('승인 실패:', error);
                  toast({
                    variant: 'destructive',
                    title: '승인 실패',
                    description: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
                  });
                } finally {
                  setLoading(false);
                  setPendingApprovalRecord(null);
                  setConflictingRestaurantInfo(null);
                }
              }}
              disabled={loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              승인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

"use client";

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { EvaluationRecord, EvaluationRecordStatus, CategoryStats } from '@/types/evaluation';
import { extractVideoIdFromYoutubeLink } from '@/lib/dashboard/helpers';
import { getLocationMatchFalseMessage, hasLaajMetrics, hasRuleMetrics, toNotSelectionReason } from '@/lib/dashboard/classifiers';
import { CategorySidebar } from '@/components/admin/CategorySidebar';
import { EvaluationTable } from '@/components/admin/EvaluationTableNew';
import { MissingRestaurantForm } from '@/components/admin/MissingRestaurantForm';
import { DbConflictResolutionPanel } from '@/components/admin/DbConflictResolutionPanel';
import { EditRestaurantModal } from '@/components/admin/EditRestaurantModal';
import { EvaluationSlideView } from '@/components/admin/EvaluationSlideView';
import { SubmissionListView, Review } from '@/components/admin/SubmissionListView';
import { SubmissionRecord, ApprovalData, SubmissionItem, ItemDecision } from '@/components/admin/SubmissionDetailView';
import {
  createNewRestaurantNotification,
  createSubmissionApprovedNotification,
  createSubmissionRejectedNotification,
  createReviewApprovedNotification,
  createReviewRejectedNotification
} from '@/contexts/NotificationContext';
import { ClipboardCheck, Loader2, FileText, CheckCircle2, XCircle, AlertCircle, LayoutList, MonitorPlay, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GlobalLoader } from "@/components/ui/global-loader";
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import {
  ADMIN_MODAL_ACTION,
  ADMIN_MODAL_CONTENT_SM,
  ADMIN_MODAL_FOOTER,
  ADMIN_MODAL_SCROLL_BODY,
} from '@/components/admin/admin-modal-styles';

const PAGE_SIZE = 10; // 한 번에 로드할 레코드 수
const STORAGE_KEY = 'adminEvaluationPageState'; // localStorage 키

// Suspense 래퍼 컴포넌트
export default function AdminEvaluationPageWrapper() {
  return (
    <Suspense fallback={<GlobalLoader />}>
      <AdminEvaluationPage />
    </Suspense>
  );
}

function AdminEvaluationPage() {
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
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

  // 사용자 제보 검수 상태 (URL 쿼리 파라미터로 초기화)
  const [showSubmissionView, setShowSubmissionView] = useState(false);
  const [submissionInitialTab, setSubmissionInitialTab] = useState<'new' | 'edit' | 'reviews'>('new');

  // Deep-link 필터 (운영지표/이슈보드 -> 검수 화면 이동)
  const deepLinkInitializedRef = useRef(false);
  const [deepLinkFilter, setDeepLinkFilter] = useState<{
    videoId?: string;
    issue?: string;
    reason?: string;
  } | null>(null);

  const clearDeepLinkFilter = useCallback(() => {
    setDeepLinkFilter(null);
    deepLinkInitializedRef.current = true;

    const params = new URLSearchParams(searchParams.toString());
    params.delete('video_id');
    params.delete('issue');
    params.delete('reason');

    const query = params.toString();
    router.replace(query ? `/admin/evaluations?${query}` : '/admin/evaluations', { scroll: false });
  }, [router, searchParams]);

  // URL 파라미터에 따라 초기 뷰 설정
  useEffect(() => {
    if (searchParams.get('view') === 'submissions') {
      setShowSubmissionView(true);
      // tab 파라미터가 reviews면 리뷰 탭으로 초기화
      const tab = searchParams.get('tab');
      if (tab === 'reviews') {
        setSubmissionInitialTab('reviews');
      } else if (tab === 'edit') {
        setSubmissionInitialTab('edit');
      } else {
        setSubmissionInitialTab('new');
      }
    }
  }, [searchParams]);

  // URL 파라미터에 따라 Deep-link 필터 초기화
  useEffect(() => {
    if (deepLinkInitializedRef.current) return;

    const videoId = searchParams.get('video_id')?.trim() || '';
    const issue = searchParams.get('issue')?.trim() || '';
    const reason = searchParams.get('reason')?.trim() || '';

    if (!videoId && !issue && !reason) return;

    deepLinkInitializedRef.current = true;
    setDeepLinkFilter({
      ...(videoId ? { videoId } : {}),
      ...(issue ? { issue } : {}),
      ...(reason ? { reason } : {}),
    });
  }, [searchParams]);
  const [currentSubmissionIndex, setCurrentSubmissionIndex] = useState(0);
  const [editingSubmission, setEditingSubmission] = useState<SubmissionRecord | null>(null);
  const [submissionApprovalData, setSubmissionApprovalData] = useState<{
    lat: string;
    lng: string;
    road_address: string;
    jibun_address: string;
    english_address: string;
    address_elements: Record<string, unknown> | null;
  } | null>(null);
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

    // Deep-link 필터 (video_id/issue/reason)
    if (deepLinkFilter?.videoId) {
      filtered = filtered.filter((record) => (
        extractVideoIdFromYoutubeLink(record.youtube_link) === deepLinkFilter.videoId
      ));
    }

    if (deepLinkFilter?.issue === 'notSelection') {
      filtered = filtered.filter((record) => record.is_not_selected === true);

      if (deepLinkFilter.reason) {
        filtered = filtered.filter((record) => (
          toNotSelectionReason({
            is_not_selected: record.is_not_selected,
            is_missing: record.is_missing,
            geocoding_false_stage: record.geocoding_false_stage,
            geocoding_success: record.geocoding_success,
          }) === deepLinkFilter.reason
        ));
      }
    } else if (deepLinkFilter?.issue === 'ruleFalse') {
      filtered = filtered.filter((record) => {
        const message = getLocationMatchFalseMessage(record.evaluation_results);
        if (!message) return false;
        return deepLinkFilter.reason ? message === deepLinkFilter.reason : true;
      });
    } else if (deepLinkFilter?.issue === 'laajGap') {
      filtered = filtered.filter((record) => (
        hasRuleMetrics(record.evaluation_results) && !hasLaajMetrics(record.evaluation_results)
      ));
    }

    return filtered;
  }, [allRecords, searchResults, evalFilters, deepLinkFilter]);

  // filteredRecords가 정의된 후에 useEffect 위치
  useEffect(() => {
    // 필터링된 레코드 내에서 현재 인덱스가 유효한지 확인
    if (currentSlideIndex >= filteredRecords.length && filteredRecords.length > 0) {
      setCurrentSlideIndex(0);
    }
  }, [filteredRecords.length, currentSlideIndex]);

  const hasMoreRef = useRef(hasMore);
  const loadingMoreRef = useRef(loadingMore);
  const filteredRecordsRef = useRef(filteredRecords);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  useEffect(() => {
    filteredRecordsRef.current = filteredRecords;
  }, [filteredRecords]);

  // 더 많은 레코드 로드
  const loadMoreRecords = useCallback(() => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);

    setTimeout(() => {
      setDisplayedRecords(prev => {
        const currentLength = prev.length;
        const source = filteredRecordsRef.current;
        const newRecords = source.slice(currentLength, currentLength + PAGE_SIZE);
        const nextHasMore = currentLength + newRecords.length < source.length;

        hasMoreRef.current = nextHasMore;
        loadingMoreRef.current = false;
        setHasMore(nextHasMore);
        setLoadingMore(false);

        return [...prev, ...newRecords];
      });
    }, 100);
  }, []);

  // 필터링 결과가 변경될 때마다 표시할 레코드 초기화
  useEffect(() => {
    const nextHasMore = filteredRecords.length > PAGE_SIZE;

    setDisplayedRecords(filteredRecords.slice(0, PAGE_SIZE));
    setHasMore(nextHasMore);
    hasMoreRef.current = nextHasMore;
    loadingMoreRef.current = false;
    setLoadingMore(false);
  }, [filteredRecords]);

  const isListView = !showSubmissionView && !isAlternateView;

  // 무한 스크롤 - Scroll Event 방식
  useEffect(() => {
    if (!isListView) return;

    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;

      // 80% 이상 스크롤 시 다음 데이터 로드
      if (scrollPercentage > 0.8) {
        loadMoreRecords();
      }
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener('scroll', handleScroll, { passive: true } as any);
  }, [isListView, loadMoreRecords]);

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
          name: (r.origin_name as string) || (r.name as string) || (r.approved_name as string) || '이름 없음',
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
          // 호환성을 위한 별칭 추가 - name 컬럼이 없으므로 origin_name 사용
          name: (r.origin_name as string) || (r.name as string) || '이름 없음',
          restaurant_name: (r.origin_name as string) || (r.name as string) || '이름 없음',
          origin_name: r.origin_name,
          naver_name: r.naver_name,
          approved_name: r.approved_name,

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
    // Naver Name 추출 로직
    // 1. DB 컬럼(naver_name)을 최우선으로 사용
    let naverName: string | null = record.naver_name || null;

    // 2. naver_name이 없는 경우 evaluation_results에서 추출 시도 (Fallback)
    if (!naverName) {
      const locationMatch = (record.evaluation_results?.location_match_TF as any);
      if (locationMatch) {
        if (locationMatch.matched_name) {
          naverName = locationMatch.matched_name;
        } else if (locationMatch.name && !['Location Match', '주소 정합성', 'location_match_TF'].includes(locationMatch.name)) {
          naverName = locationMatch.name;
        }
      }
    }

    // 3. 그래도 없으면 기존 이름 사용 (매우 드문 케이스)
    if (!naverName) {
      naverName = record.restaurant_name || record.name || '이름 없음';
    }

    console.log('🚀 승인 요청 시작:', {
      id: record.id,
      naverName,
      original_status: record.status
    });

    // status를 'approved'로 업데이트 및 approved_name 저장
    const { data: updatedData, error } = await supabase
      .from('restaurants')
      // @ts-expect-error - Supabase 자동 생성 타입 문제
      .update({
        status: 'approved',
        approved_name: naverName,
        db_error_message: null, // 에러 메시지 초기화
        db_error_details: null, // 에러 상세 초기화
        updated_at: new Date().toISOString(),
      })
      .eq('id', record.id)
      .select()
      .single();

    if (error) {
      console.error('❌ DB 업데이트 에러:', error);
      throw error;
    }

    console.log('✅ DB 업데이트 성공:', updatedData);

    if ((updatedData as any)?.status !== 'approved') {
      console.warn('⚠️ 업데이트 후 status가 approved가 아님:', (updatedData as any)?.status);
    }

    // 상태 업데이트 (새로고침 없이 UI 반영)
    updateRecordInState(record.id, {
      status: 'approved',
      approved_name: naverName,
      db_error_message: null,
      db_error_details: null,
      updated_at: new Date().toISOString(),
    });

    toast({
      title: '승인 완료',
      description: `✅ "${naverName}" 맛집이 승인되었습니다`,
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

  // 사용자 제보 데이터 쿼리 (새 테이블 구조)
  const { data: submissionsData = [], isLoading: submissionsLoading } = useQuery({
    queryKey: ['admin-submissions-inline', user?.id, isAdmin],
    queryFn: async () => {
      if (!user || !isAdmin) return [];

      // 1. submissions 조회 (pending 및 partially_approved)
      const { data: submissionsData, error: submissionsError } = await supabase
        .from('restaurant_submissions')
        .select('*')
        .in('status', ['pending', 'partially_approved'])
        .order('created_at', { ascending: false });

      console.log('[Submissions Query] user:', user?.id, 'isAdmin:', isAdmin);
      console.log('[Submissions Query] data:', submissionsData, 'error:', submissionsError);

      if (submissionsError) throw submissionsError;
      if (!submissionsData?.length) return [];

      const typedSubmissions = submissionsData as any[];
      const submissionIds = typedSubmissions.map(s => s.id);
      const userIds = [...new Set(typedSubmissions.map(s => s.user_id))];

      // 2. items 조회
      const { data: itemsData } = await supabase
        .from('restaurant_submission_items')
        .select('*')
        .in('submission_id', submissionIds)
        .order('created_at', { ascending: true });

      // 3. profiles 조회
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('user_id, nickname')
        .in('user_id', userIds);

      const profilesMap = new Map((profilesData || []).map((p: any) => [p.user_id, p.nickname]));
      const itemsMap = new Map<string, any[]>();
      (itemsData || []).forEach((item: any) => {
        if (!itemsMap.has(item.submission_id)) {
          itemsMap.set(item.submission_id, []);
        }
        itemsMap.get(item.submission_id)!.push(item);
      });

      // 4. 아이템별 target_restaurant_id로 기존 맛집 정보 조회
      const allItems = itemsData || [];
      const itemTargetRestaurantIds = [...new Set(
        allItems
          .filter((item: any) => item.target_restaurant_id)
          .map((item: any) => item.target_restaurant_id)
      )];

      console.log('[EDIT 제보 디버깅] item target_restaurant_ids:', itemTargetRestaurantIds);

        let originalRestaurantsMap = new Map<string, any>();
        if (itemTargetRestaurantIds.length > 0) {
          const { data: originalData, error: originalError } = await supabase
            .from('restaurants')
            // restaurants 테이블은 trace_id / approved_name 이므로 alias로 호환 유지
            .select('id, unique_id:trace_id, name:approved_name, road_address, jibun_address, phone, categories, youtube_link, tzuyang_review, youtube_meta')
            .in('id', itemTargetRestaurantIds);

        console.log('[EDIT 제보 디버깅] originalData:', originalData, 'error:', originalError);

        if (originalData) {
          originalData.forEach((r: any) => {
            originalRestaurantsMap.set(r.id, {
              id: r.id,
              unique_id: r.unique_id,
              name: r.name,
              road_address: r.road_address,
              jibun_address: r.jibun_address,
              phone: r.phone,
              categories: r.categories || [],
              youtube_link: r.youtube_link,
              tzuyang_review: r.tzuyang_review,
              youtube_meta: r.youtube_meta || null,
            });
          });
        }
      }

      // 새 테이블 구조에 맞게 변환
      return typedSubmissions.map((s: any) => {
        const rawItems = itemsMap.get(s.id) || [];

        // 아이템별로 original_restaurant 추가 (target_restaurant_id로 매칭)
        const items = rawItems.map((item: any) => {
          const originalRestaurant = item.target_restaurant_id
            ? originalRestaurantsMap.get(item.target_restaurant_id) || null
            : null;

          if (originalRestaurant) {
            console.log('[EDIT 제보 디버깅] item:', item.id, 'target_restaurant_id:', item.target_restaurant_id, 'matched:', originalRestaurant.name);
          }

          return {
            ...item,
            original_restaurant: originalRestaurant,
          };
        });

        // submission 수준의 original_restaurant_data는 첫 번째 아이템 기준으로 설정 (상단 비교용)
        // submissions.target_restaurant_id는 더 이상 사용 안함 (items 레벨에서 관리)
        let originalRestaurantData = null;
        if (s.submission_type === 'edit' && items.length > 0 && items[0].original_restaurant) {
          originalRestaurantData = items[0].original_restaurant;
        }

        return {
          id: s.id,
          user_id: s.user_id,
          submission_type: s.submission_type || 'new',
          status: s.status,
          restaurant_name: s.restaurant_name,
          restaurant_address: s.restaurant_address,
          restaurant_phone: s.restaurant_phone,
          restaurant_categories: s.restaurant_categories,
          // target_restaurant_id는 submission 레벨이 아닌 items 레벨에서 관리
          admin_notes: s.admin_notes,
          rejection_reason: s.rejection_reason,
          resolved_by_admin_id: s.resolved_by_admin_id,
          reviewed_at: s.reviewed_at,
          created_at: s.created_at,
          updated_at: s.updated_at,
          items: items,
          profiles: { nickname: profilesMap.get(s.user_id) || '알 수 없음' },
          original_restaurant_data: originalRestaurantData,
        };
      }) as SubmissionRecord[];

    },
    enabled: !!user && isAdmin,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  // 리뷰 데이터 쿼리
  const { data: reviewsData = [], isLoading: reviewsLoading } = useQuery({
    queryKey: ['admin-reviews-inline', user?.id, isAdmin],
    queryFn: async () => {
      if (!user || !isAdmin) return [];

      const { data: reviewsData, error: reviewsError } = await supabase
        .from('reviews')
        .select('*')
        .order('created_at', { ascending: false });

      if (reviewsError) throw reviewsError;
      if (!reviewsData?.length) return [];

      const typedReviewsData = reviewsData as any[];
      const userIds = [...new Set(typedReviewsData.map(r => r.user_id))];
      const restaurantIds = [...new Set(typedReviewsData.map(r => r.restaurant_id))];

      const { data: profilesData } = await supabase
        .from('profiles')
        .select('user_id, nickname')
        .in('user_id', userIds);

      const { data: restaurantsData } = await supabase
        .from('restaurants')
        .select('id, approved_name, road_address, jibun_address')
        .in('id', restaurantIds);

      const typedProfilesData = (profilesData || []) as any[];
      const typedRestaurantsData = (restaurantsData || []) as any[];

      const profilesMap = new Map(typedProfilesData.map(p => [p.user_id, p.nickname]));
      const restaurantsMap = new Map(typedRestaurantsData.map(r => [r.id, { name: r.approved_name || '이름 없음', address: r.road_address || r.jibun_address || '' }]));

      return typedReviewsData.map(review => ({
        ...review,
        profiles: { nickname: profilesMap.get(review.user_id) || '탈퇴한 사용자' },
        restaurants: restaurantsMap.get(review.restaurant_id) || { name: '삭제된 맛집', address: '' }
      }));
    },
    enabled: !!user && isAdmin,
    refetchInterval: 30000,
  });

  // pending 리뷰(미승인, 거부 아닌) 건수 계산
  const pendingReviewsCount = useMemo(() => {
    return reviewsData.filter((r: Review) =>
      !r.is_verified && (!r.admin_note || !r.admin_note.includes('거부'))
    ).length;
  }, [reviewsData]);

  // 전체 대기 건수 (제보 + 리뷰)
  const totalPendingCount = submissionsData.length + pendingReviewsCount;

  // 리뷰 승인 mutation
  const approveReviewMutation = useMutation({
    mutationFn: async ({ reviewId, adminNote }: { reviewId: string; adminNote: string }) => {
      const { data: review, error: reviewError } = await supabase
        .from('reviews')
        .select('user_id, restaurant_id, is_verified')
        .eq('id', reviewId)
        .single();

      if (reviewError) throw reviewError;
      const typedReview = review as any;
      const wasAlreadyVerified = typedReview.is_verified;

      // 레스토랑 이름 조회
      const { data: restaurant } = await supabase
        .from('restaurants')
        .select('name:approved_name, review_count')
        .eq('id', typedReview.restaurant_id)
        .single();

      const { error: approveError } = await (supabase.from('reviews') as any)
        .update({
          is_verified: true,
          admin_note: adminNote || null,
          is_edited_by_admin: !!adminNote,
          updated_at: new Date().toISOString(),
        })
        .eq('id', reviewId);

      if (approveError) throw approveError;

      if (!wasAlreadyVerified) {
        const typedRestaurant = restaurant as any;
        await (supabase.from('restaurants') as any)
          .update({
            review_count: (typedRestaurant?.review_count ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', typedReview.restaurant_id);
      }

      return {
        reviewId,
        userId: typedReview.user_id,
        restaurantName: (restaurant as any)?.name || '맛집'
      };
    },
    onSuccess: ({ userId, restaurantName }) => {
      toast({ title: '리뷰 승인됨', description: '리뷰가 승인되었습니다.' });
      // 리뷰 작성자에게 승인 알림 전송
      if (userId) {
        createReviewApprovedNotification(userId, restaurantName);
      }
      queryClient.invalidateQueries({ queryKey: ['admin-reviews-inline'] });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: '승인 실패', description: error.message });
    },
  });

  // 리뷰 거부 mutation
  const rejectReviewMutation = useMutation({
    mutationFn: async ({ reviewId, adminNote }: { reviewId: string; adminNote: string }) => {
      const { data: review, error: reviewError } = await supabase
        .from('reviews')
        .select('user_id, restaurant_id, is_verified')
        .eq('id', reviewId)
        .single();

      if (reviewError) throw reviewError;
      const typedReview = review as any;

      // 레스토랑 이름 조회
      const { data: restaurant } = await supabase
        .from('restaurants')
        .select('name:approved_name, review_count')
        .eq('id', typedReview.restaurant_id)
        .single();

      const rejectionReason = adminNote || '관리자에 의해 거부됨';
      const { error: rejectError } = await (supabase.from('reviews') as any)
        .update({
          is_verified: false,
          admin_note: `거부: ${rejectionReason}`,
          is_edited_by_admin: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', reviewId);

      if (rejectError) throw rejectError;

      if (typedReview.is_verified) {
        const typedRestaurant = restaurant as any;
        await (supabase.from('restaurants') as any)
          .update({
            review_count: Math.max((typedRestaurant?.review_count ?? 0) - 1, 0),
            updated_at: new Date().toISOString(),
          })
          .eq('id', typedReview.restaurant_id);
      }

      return {
        reviewId,
        userId: typedReview.user_id,
        restaurantName: (restaurant as any)?.name || '맛집',
        rejectionReason
      };
    },
    onSuccess: ({ userId, restaurantName, rejectionReason }) => {
      toast({ title: '리뷰 거부됨', description: '리뷰가 거부되었습니다.' });
      // 리뷰 작성자에게 거부 알림 전송 (거부 사유 포함)
      if (userId) {
        createReviewRejectedNotification(userId, restaurantName, rejectionReason);
      }
      queryClient.invalidateQueries({ queryKey: ['admin-reviews-inline'] });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: '거부 실패', description: error.message });
    },
  });

  // 리뷰 삭제 mutation (이미지도 함께 삭제)
  const deleteReviewMutation = useMutation({
    mutationFn: async (reviewId: string) => {
      // 1. 리뷰 정보 조회 (이미지 경로 확인)
      const { data: reviewData, error: fetchError } = await supabase
        .from('reviews')
        .select('verification_photo, food_photos')
        .eq('id', reviewId)
        .single();

      if (fetchError) throw fetchError;

      const review = reviewData as { verification_photo: string | null; food_photos: string[] | null } | null;

      // 2. Storage에서 이미지 삭제
      const photosToDelete: string[] = [];

      if (review?.verification_photo) {
        photosToDelete.push(review.verification_photo);
      }

      if (review?.food_photos && Array.isArray(review.food_photos)) {
        photosToDelete.push(...review.food_photos);
      }

      if (photosToDelete.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('review-photos')
          .remove(photosToDelete);

        if (storageError) {
          console.warn('이미지 삭제 실패 (리뷰는 삭제됨):', storageError.message);
        }
      }

      // 3. DB에서 리뷰 삭제
      const { error } = await supabase.from('reviews').delete().eq('id', reviewId);
      if (error) throw error;

      return { deletedPhotos: photosToDelete.length };
    },
    onSuccess: ({ deletedPhotos }) => {
      toast({
        title: '리뷰 삭제됨',
        description: `리뷰가 삭제되었습니다. (이미지 ${deletedPhotos}개 삭제)`
      });
      queryClient.invalidateQueries({ queryKey: ['admin-reviews-inline'] });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: '삭제 실패', description: error.message });
    },
  });

  // 제보 승인 mutation (새 테이블 구조 - 아이템별 처리)
  const approveSubmissionMutation = useMutation({
    mutationFn: async ({
      submission,
      approvalData,
      itemDecisions,
      forceApprove,
      editableData
    }: {
      submission: SubmissionRecord;
      approvalData: ApprovalData;
      itemDecisions: Record<string, ItemDecision>;
      forceApprove: boolean;
      editableData: { name: string; address: string; phone: string; categories: string[] };
    }) => {
      if (!user) throw new Error('로그인이 필요합니다');
      const lat = parseFloat(approvalData.lat);
      const lng = parseFloat(approvalData.lng);
      if (isNaN(lat) || isNaN(lng)) throw new Error('올바른 좌표가 필요합니다');

      // 승인할 아이템들 수집
      const approvedItems = submission.items.filter((item: SubmissionItem) =>
        item.item_status === 'pending' && itemDecisions[item.id]?.approved
      );

      if (approvedItems.length === 0) {
        throw new Error('승인할 항목이 없습니다');
      }

      // 검증: 승인된 모든 아이템에 tzuyang_review와 metaData가 있어야 함
      for (const item of approvedItems) {
        const decision = itemDecisions[item.id];
        if (!decision.tzuyang_review?.trim()) {
          throw new Error('쯔양 리뷰를 입력해주세요');
        }
        if (!decision.metaData) {
          throw new Error('YouTube 메타데이터가 없습니다. 메타데이터를 불러온 뒤 승인해주세요.');
        }
      }

      let restaurant = null;

      // 각 아이템별로 RPC 호출 (unique_id 생성, 중복 검사 등은 RPC에서 처리)
      for (const item of submission.items) {
        if (item.item_status !== 'pending') continue;

        const decision = itemDecisions[item.id];
        if (decision?.approved) {
          // 관리자가 수정한 데이터로 restaurantData 구성
          const restaurantData = {
            name: editableData.name,
            phone: editableData.phone || null,
            categories: editableData.categories || [],
            tzuyang_review: decision.tzuyang_review || null,  // 관리자가 수정한 리뷰
            youtube_link: decision.youtube_link || item.youtube_link || null,  // 관리자가 수정한 링크
            jibun_address: approvalData.jibun_address,
            road_address: approvalData.road_address,
            english_address: approvalData.english_address || null,
            address_elements: approvalData.address_elements || {},
            lat,
            lng,
            // YouTube 메타데이터 (모달에서 가져온 값)
            youtube_meta: decision.metaData ? {
              title: decision.metaData.title,
              published_at: decision.metaData.publishedAt,
              duration: decision.metaData.duration,
              is_shorts: decision.metaData.is_shorts,
              is_ads: decision.metaData.ads_info?.is_ads ?? false,
              what_ads: decision.metaData.ads_info?.what_ads ?? null,
            } : null,
          };

          console.log('🔍 [DEBUG] RPC에 전달할 restaurantData:', restaurantData);

          if (submission.submission_type === 'edit' && item.target_restaurant_id) {
            // 수정 제보: approve_edit_submission_item RPC 호출
            const { data: result, error } = await (supabase.rpc as any)(
              'approve_edit_submission_item',
              {
                p_item_id: item.id,
                p_admin_user_id: user.id,
                p_updated_data: restaurantData,
              }
            );
            if (error) throw error;
            const rpcResult = Array.isArray(result) ? result[0] : result;
            if (rpcResult && !rpcResult.success) {
              throw new Error(rpcResult.message || '수정 승인에 실패했습니다');
            }
            restaurant = { id: rpcResult?.restaurant_id || item.target_restaurant_id };
          } else {
            // 신규 제보: approve_submission_item RPC 호출
            const { data: result, error } = await (supabase.rpc as any)(
              'approve_submission_item',
              {
                p_item_id: item.id,
                p_admin_user_id: user.id,
                p_restaurant_data: restaurantData,
              }
            );
            if (error) throw error;
            const rpcResult = Array.isArray(result) ? result[0] : result;
            if (rpcResult && !rpcResult.success) {
              throw new Error(rpcResult.message || '승인에 실패했습니다');
            }
            restaurant = { id: rpcResult?.created_restaurant_id };
          }
        } else {
          // 거부
          await (supabase.from('restaurant_submission_items') as any)
            .update({
              item_status: 'rejected',
              rejection_reason: decision?.rejectionReason || '관리자에 의해 반려됨',
            })
            .eq('id', item.id);
        }
      }

      // 관리자 메모 업데이트
      await (supabase.from('restaurant_submissions') as any)
        .update({
          resolved_by_admin_id: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', submission.id);

      return { submission, restaurant };
    },
    onSuccess: ({ submission }) => {
      toast({ title: '제보 승인 완료', description: `"${submission.restaurant_name}" 맛집이 등록되었습니다` });
      createNewRestaurantNotification(submission.restaurant_name, submission.restaurant_address || '', {
        category: submission.restaurant_categories,
        submissionId: submission.id
      });
      // 제보자에게 승인 알림 전송
      if (submission.user_id) {
        createSubmissionApprovedNotification(
          submission.user_id,
          submission.restaurant_name,
          submission.submission_type,
          { submissionId: submission.id }
        );
      }
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

  // 제보 거부 mutation (모든 아이템 거부)
  const rejectSubmissionMutation = useMutation({
    mutationFn: async ({ submission, reason }: { submission: SubmissionRecord; reason: string }) => {
      if (!user) throw new Error('로그인이 필요합니다');

      // 모든 pending 아이템 거부
      for (const item of submission.items) {
        if (item.item_status === 'pending') {
          await (supabase.from('restaurant_submission_items') as any)
            .update({
              item_status: 'rejected',
              rejection_reason: reason,
            })
            .eq('id', item.id);
        }
      }

      // 제보 상태 업데이트
      const { error } = await (supabase
        .from('restaurant_submissions') as any)
        .update({
          rejection_reason: reason,
          resolved_by_admin_id: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', submission.id);
      if (error) throw error;
      return { submission, reason };
    },
    onSuccess: ({ submission, reason }) => {
      toast({ title: '제보 거부됨', description: `"${submission.restaurant_name}" 제보가 거부되었습니다` });
      // 제보자에게 거부 알림 전송 (거부 사유 포함)
      if (submission.user_id) {
        createSubmissionRejectedNotification(
          submission.user_id,
          submission.restaurant_name,
          reason || '관리자에 의해 반려됨',
          submission.submission_type,
          { submissionId: submission.id }
        );
      }
      queryClient.invalidateQueries({ queryKey: ['admin-submissions-inline'] });
      if (currentSubmissionIndex >= submissionsData.length - 1 && currentSubmissionIndex > 0) {
        setCurrentSubmissionIndex(currentSubmissionIndex - 1);
      }
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: '거부 실패', description: error.message });
    },
  });

  // 제보 삭제 mutation (모든 아이템 거부로 변경)
  const deleteSubmissionMutation = useMutation({
    mutationFn: async (submission: SubmissionRecord) => {
      if (!user) throw new Error('로그인이 필요합니다');

      // 모든 pending 아이템 거부
      for (const item of submission.items) {
        if (item.item_status === 'pending') {
          await (supabase.from('restaurant_submission_items') as any)
            .update({
              item_status: 'rejected',
              rejection_reason: '관리자에 의해 삭제됨',
            })
            .eq('id', item.id);
        }
      }

      // 제보 상태 업데이트
      const { error } = await (supabase
        .from('restaurant_submissions') as any)
        .update({
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

  // 핸들러 함수 (새 테이블 구조에 맞게 수정)
  const handleApproveSubmission = (
    submission: SubmissionRecord,
    approvalData: ApprovalData,
    itemDecisions: Record<string, ItemDecision>,
    forceApprove: boolean,
    editableData: { name: string; address: string; phone: string; categories: string[] }
  ) => {
    approveSubmissionMutation.mutate({ submission, approvalData, itemDecisions, forceApprove, editableData });
  };

  const handleRejectSubmission = (submission: SubmissionRecord, reason: string) => {
    rejectSubmissionMutation.mutate({ submission, reason });
  };

  const handleDeleteSubmission = (submission: SubmissionRecord) => {
    deleteSubmissionMutation.mutate(submission);
  };

  // 리뷰 핸들러
  const handleApproveReview = (review: Review, adminNote: string) => {
    approveReviewMutation.mutate({ reviewId: review.id, adminNote });
  };

  const handleRejectReview = (review: Review, adminNote: string) => {
    rejectReviewMutation.mutate({ reviewId: review.id, adminNote });
  };

  const handleDeleteReview = (review: Review) => {
    deleteReviewMutation.mutate(review.id);
  };

  // 제보 수정 핸들러 (새 테이블 구조에 맞게 수정)
  const handleEditSubmission = (submission: SubmissionRecord) => {
    setEditingSubmission(submission);
    // 첫 번째 아이템 정보 가져오기
    const firstItem = submission.items[0];

    // 제보를 EvaluationRecord 형태로 변환 (타입 호환성을 위해 as unknown as EvaluationRecord 사용)
    const evaluationRecord = {
      id: submission.id,
      unique_id: `submission_${submission.id}`,
      name: submission.restaurant_name,
      restaurant_name: submission.restaurant_name,
      restaurant_info: {
        name: submission.restaurant_name,
        phone: submission.restaurant_phone || '',
        category: submission.restaurant_categories?.[0] || '',
        origin_address: submission.restaurant_address || '',
        tzuyang_review: firstItem?.tzuyang_review || '',
        naver_address_info: null,
      },
      categories: submission.restaurant_categories || [],
      phone: submission.restaurant_phone || '',
      road_address: submission.restaurant_address || '',
      jibun_address: '',
      english_address: '',
      address_elements: null,
      origin_address: submission.restaurant_address || '',
      lat: 0,
      lng: 0,
      youtube_link: firstItem?.youtube_link || '',
      youtube_links: submission.items.map((item: SubmissionItem) => item.youtube_link),
      youtube_meta: null,
      tzuyang_reviews: submission.items.map((item: SubmissionItem) => item.tzuyang_review).filter(Boolean).join('\n'),
      reasoning_basis: null,
      evaluation_results: null,
      status: 'pending',
      source_type: 'user_submission_new',
      geocoding_success: false,
      created_at: submission.created_at,
      updated_at: submission.updated_at,
    } as unknown as EvaluationRecord;
    setSelectedEditRecord(evaluationRecord);
    setEditModalOpen(true);
  };

  // 제보 수정 저장 mutation (새 테이블 구조)
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

      // 제보 기본 정보 업데이트
      const { error } = await (supabase
        .from('restaurant_submissions') as any)
        .update({
          restaurant_name: updatedData.restaurant_name,
          restaurant_address: updatedData.address,
          restaurant_phone: updatedData.phone || null,
          restaurant_categories: updatedData.categories,
        })
        .eq('id', submission.id);

      if (error) throw error;

      // 첫 번째 아이템의 youtube_link와 tzuyang_review 업데이트
      if (submission.items.length > 0) {
        const firstItem = submission.items[0];
        await (supabase.from('restaurant_submission_items') as any)
          .update({
            youtube_link: updatedData.youtube_link,
            tzuyang_review: updatedData.description || null,
          })
          .eq('id', firstItem.id);
      }

      return submission;
    },
    onSuccess: (submission) => {
      toast({ title: '제보 수정 완료', description: '제보 정보가 수정되었습니다' });
      queryClient.invalidateQueries({
        queryKey: ['admin-submissions-inline'],
        refetchType: 'all',
      });
      queryClient.invalidateQueries({ queryKey: ['restaurants'] });
      setEditingSubmission(null);
      setEditModalOpen(false);
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
    <div
      ref={scrollContainerRef}
      className="flex h-full flex-col overflow-auto"
      id="scroll-container"
    >
      {/* Header */}
      <div className="border-b border-border bg-card px-3 py-3 sm:px-5 sm:py-4">
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="flex items-center gap-2 bg-gradient-primary bg-clip-text text-lg font-bold text-transparent sm:text-2xl">
                <ClipboardCheck className="h-6 w-6 text-primary" />
                관리자 데이터 검수
              </h1>
            </div>
            {deepLinkFilter && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">딥링크 필터:</span>
                {deepLinkFilter.videoId && (
                  <Badge variant="secondary" className="max-w-full truncate">
                    video_id: {deepLinkFilter.videoId}
                  </Badge>
                )}
                {deepLinkFilter.issue && (
                  <Badge variant="outline" className="max-w-full truncate">
                    issue: {deepLinkFilter.issue}
                  </Badge>
                )}
                {deepLinkFilter.reason && (
                  <Badge variant="outline" className="max-w-full truncate">
                    reason: {deepLinkFilter.reason}
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={clearDeepLinkFilter}
                >
                  필터 해제
                </Button>
              </div>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
              필터링: {filteredRecords.length}개 | 현 {stats.total}개 레코드 | 삭제한 레코드 {stats.deleted}개
            </p>
          </div>

          {/* 우측: 카테고리 필터 */}
          <div className="w-full xl:flex xl:flex-1 xl:justify-end">
            <CategorySidebar
              stats={stats}
              selectedStatuses={selectedStatuses}
              onSelectStatuses={setSelectedStatuses}
            >
              <div className="flex items-center gap-1.5 xl:gap-1">
                <Button
                  variant={!isAlternateView && !showSubmissionView ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs xl:h-8 xl:w-8 xl:px-0"
                  onClick={() => {
                    setIsAlternateView(false);
                    setShowSubmissionView(false);
                    // URL에서 view 파라미터 제거
                    router.replace('/admin/evaluations', { scroll: false });
                  }}
                  title="리스트 뷰"
                >
                  <LayoutList className="h-4 w-4" />
                  <span className="xl:hidden">리스트</span>
                </Button>
                <Button
                  variant={isAlternateView && !showSubmissionView ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs xl:h-8 xl:w-8 xl:px-0"
                  onClick={() => {
                    setIsAlternateView(true);
                    setShowSubmissionView(false);
                    // URL에서 view 파라미터 제거
                    router.replace('/admin/evaluations', { scroll: false });
                  }}
                  title="슬라이드 뷰"
                >
                  <MonitorPlay className="h-4 w-4" />
                  <span className="xl:hidden">슬라이드</span>
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
                  size="sm"
                  className="relative h-8 gap-1 px-2 text-xs xl:h-8 xl:w-8 xl:gap-1 xl:px-0"
                  title={`사용자 제보/리뷰 검수 (제보 ${submissionsData.length}건, 리뷰 ${pendingReviewsCount}건)`}
                  aria-label={`사용자 제보/리뷰 검수, 대기 ${totalPendingCount}건`}
                >
                  <Send className="h-4 w-4 shrink-0" />
                  <span className="xl:hidden">제보</span>
                  {totalPendingCount > 0 && (
                    <>
                      <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white xl:hidden">
                        {totalPendingCount > 99 ? '99+' : totalPendingCount}
                      </span>
                      <span className="absolute -right-1 top-0 hidden h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs text-white xl:flex">
                        {totalPendingCount > 9 ? '9+' : totalPendingCount}
                      </span>
                    </>
                  )}
                </Button>
                {/* 자막 수집 버튼 (아이콘 only) */}
                <Button
                  onClick={handleCollectTranscripts}
                  disabled={transcriptStatus === 'loading'}
                  variant={transcriptStatus === 'success' ? 'default' : transcriptStatus === 'error' ? 'destructive' : 'ghost'}
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs xl:h-8 xl:w-8 xl:px-0"
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
                  <span className="xl:hidden">자막</span>
                </Button>
              </div>

              {/* 구분선 */}
              <div className="hidden h-6 w-px bg-border sm:block" />
            </CategorySidebar>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {showSubmissionView ? (
          /* 사용자 제보 목록 검수 뷰 */
          <SubmissionListView
            submissions={submissionsData}
            onApprove={handleApproveSubmission}
            onReject={handleRejectSubmission}
            onDelete={handleDeleteSubmission}
            onRefresh={() => queryClient.invalidateQueries({ queryKey: ['admin-submissions'] })}
            loading={approveSubmissionMutation.isPending || rejectSubmissionMutation.isPending || deleteSubmissionMutation.isPending}
            reviews={reviewsData as Review[]}
            onApproveReview={handleApproveReview}
            onRejectReview={handleRejectReview}
            onDeleteReview={handleDeleteReview}
            reviewsLoading={reviewsLoading}
            initialTab={submissionInitialTab}
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
          <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-4">
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
            // 지오코딩 결과가 있으면 submissionApprovalData에 저장 (실시간 UI 반영)
            if (updates.lat !== undefined && updates.lng !== undefined && updates.road_address) {
              setSubmissionApprovalData({
                lat: String(updates.lat),
                lng: String(updates.lng),
                road_address: updates.road_address || '',
                jibun_address: updates.jibun_address || '',
                english_address: updates.english_address || '',
                address_elements: updates.address_elements || null,
              });
            }

            updateSubmissionMutation.mutate({
              submission: editingSubmission,
              updatedData: {
                restaurant_name: updates.name || editingSubmission.restaurant_name,
                address: updates.road_address || updates.jibun_address || editingSubmission.restaurant_address || '',
                phone: updates.phone || '',
                categories: updates.categories || [],
                youtube_link: updates.youtube_link || editingSubmission.items?.[0]?.youtube_link || '',
                description: (typeof updates.tzuyang_reviews === 'string' ? updates.tzuyang_reviews : null) || updates.restaurant_info?.tzuyang_review || editingSubmission.items?.[0]?.tzuyang_review || '',
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
        <AlertDialogContent className={ADMIN_MODAL_CONTENT_SM}>
          <AlertDialogHeader>
            <AlertDialogTitle>승인 확인</AlertDialogTitle>
            <AlertDialogDescription className={`text-sm text-muted-foreground space-y-2 ${ADMIN_MODAL_SCROLL_BODY}`}>
              <span className="block">이름이 유사한 레스토랑이 존재하지만 유튜브 링크가 다릅니다.</span>
              {conflictingRestaurantInfo && (
                <span className="block mt-3 p-3 bg-muted rounded-md">
                  <span className="block font-medium">기존 레스토랑:</span>
                  <span className="block text-sm mt-1">이름: {conflictingRestaurantInfo.name}</span>
                  <span className="block text-sm">주소: {conflictingRestaurantInfo.address}</span>
                </span>
              )}
              <span className="block mt-3 font-medium">승인하시겠습니까?</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className={ADMIN_MODAL_FOOTER}>
            <AlertDialogCancel disabled={loading} className={ADMIN_MODAL_ACTION}>취소</AlertDialogCancel>
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
              className={ADMIN_MODAL_ACTION}
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

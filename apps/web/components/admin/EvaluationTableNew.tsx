import React, { useState, useEffect, useCallback, useRef, useMemo, memo, forwardRef } from 'react';
import { EvaluationRecord } from '@/types/evaluation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ChevronDown, ChevronUp, Check, Trash2, AlertCircle, Edit, Menu, HelpCircle, RotateCcw, Search, X, Undo2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCategoryText } from '@/lib/category-utils';
import { EvaluationRowDetails } from './EvaluationRowDetails';

interface EvaluationTableProps {
  records: EvaluationRecord[];
  onApprove: (record: EvaluationRecord) => void;
  onDelete: (record: EvaluationRecord) => void;
  onRestore?: (record: EvaluationRecord) => void; // 삭제된 레코드 복원 함수
  onRegisterMissing?: (record: EvaluationRecord) => void;
  onResolveConflict?: (record: EvaluationRecord) => void;
  onEdit?: (record: EvaluationRecord) => void;
  loading?: boolean;
  isDeletedFilterActive?: boolean; // 삭제 필터 활성화 여부
  searchQuery?: string; // 검색어
  onSearchChange?: (query: string) => void; // 검색어 변경 핸들러
  evalFilters: {
    visit_authenticity?: string;
    rb_inference_score?: string;
    rb_grounding_TF?: string;
    review_faithfulness_score?: string;
    geocoding_success?: string;
    category_validity_TF?: string;
    category_TF?: string;
    status?: string;
  };
  onFilterChange: (key: string, value: string) => void;
  onResetFilters: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
}

const FILTER_TOOLTIPS = {
  visit_authenticity: `0점: 영상과 무관함 (허구 데이터)
1점: 매장 직접 방문 (지점 명확)
2점: 매장 직접 방문 (지점 불명확)
3점: 포장/배달 (매장 미방문)
4점: 단순 언급 또는 음식점 아님`,

  rb_inference_score: `0점: 근거 부족 (단순 추측 및 비약)
1점: 명확한 단서 (간판, 자막 등으로 자연스럽게 특정)
2점: 복합적 단서 (여러 정보를 논리적으로 조합하여 특정)`,

  rb_grounding_TF: `True: 제시된 근거(Reasoning Basis)가 영상에서 실제로 확인됨
False: 제시된 근거(Reasoning Basis)를 영상에서 찾을 수 없음`,

  review_faithfulness_score: `0점: 내용 왜곡, 과장, 또는 틀린 정보 포함
1점: 실제 영상 내용을 충실하고 정확하게 요약함`,

  geocoding_success: `True: 지오코딩 성공
False: 주소 매칭 실패 (검색은 수행됨)
Failed: 지오코딩 오류 (시스템 에러 등)`,

  category_validity_TF: `True: 유효한 카테고리임
False: 목록에 없는 유효하지 않은 카테고리`,

  category_TF: `True: 현재 카테고리가 영상 내용과 일치함
False: 현재 카테고리가 영상 내용과 맞지 않음`
};

// 유틸리티 함수: YouTube 비디오 ID 추출 (컴포넌트 외부)
const getYoutubeVideoId = (url: string | undefined): string | null => {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?&].*)?/,
    /(?:youtube\.com\/(?:embed|v)\/)([a-zA-Z0-9_-]{11})/,
    /(?:m\.youtube\.com\/watch\?v=|youtube\.com\/.*[?&]v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1] && match[1].length === 11) {
      return match[1];
    }
  }
  return null;
};

// 유틸리티 함수: 상태 뱃지 반환 (컴포넌트 외부)
const STATUS_VARIANTS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: '미처리', variant: 'secondary' },
  approved: { label: '승인됨', variant: 'default' },
  hold: { label: '보류', variant: 'outline' },
  missing: { label: 'Missing', variant: 'destructive' },
  geocoding_failed: { label: '지오코딩 실패', variant: 'destructive' },
  not_selected: { label: '평가 미대상', variant: 'outline' },
  db_conflict: { label: 'DB 충돌', variant: 'destructive' },
  deleted: { label: '삭제됨', variant: 'destructive' },
};

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'pending', label: '미처리' },
  { value: 'approved', label: '승인됨' },
  { value: 'hold', label: '보류' },
  { value: 'db_conflict', label: 'DB 충돌' },
  { value: 'deleted', label: '삭제됨' },
  { value: 'ready_for_approval', label: '승인 대기' },
  { value: 'missing', label: 'Missing' },
  { value: 'not_selected', label: '평가 미대상' },
  { value: 'geocoding_failed', label: '지오코딩 실패' },
];

const MOBILE_STATUS_QUICK_FILTERS: { value: string; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'pending', label: '미처리' },
  { value: 'ready_for_approval', label: '승인대기' },
  { value: 'approved', label: '승인됨' },
  { value: 'geocoding_failed', label: '지오코딩실패' },
  { value: 'missing', label: 'Missing' },
  { value: 'deleted', label: '삭제됨' },
];

const getStatusBadge = (status: string) => {
  const config = STATUS_VARIANTS[status] || { label: status, variant: 'default' as const };
  return <Badge variant={config.variant} className="whitespace-nowrap">{config.label}</Badge>;
};

const getMobileCardTone = (status: string): string => {
  switch (status) {
    case 'approved':
      return 'border-l-4 border-l-emerald-500';
    case 'pending':
      return 'border-l-4 border-l-amber-500';
    case 'deleted':
      return 'border-l-4 border-l-rose-500';
    case 'missing':
    case 'geocoding_failed':
    case 'db_conflict':
      return 'border-l-4 border-l-red-500';
    case 'not_selected':
      return 'border-l-4 border-l-slate-400';
    default:
      return 'border-l-4 border-l-primary/60';
  }
};

const getBooleanLabel = (value: boolean | null | undefined): string => {
  if (value === true) return 'True';
  if (value === false) return 'False';
  return '-';
};

const getGeocodingLabel = (record: EvaluationRecord): string => {
  if (record.status === 'not_selected') return '-';
  if (record.geocoding_success === true) return 'True';
  if (record.geocoding_success === false && record.geocoding_false_stage === null) return 'Failed';
  if (record.geocoding_success === false) return 'False';
  return '-';
};

const getDisplayValue = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
};

const getOriginAddress = (record: EvaluationRecord): string => {
  if (record.restaurant_info?.origin_address) {
    return record.restaurant_info.origin_address;
  }

  const jsonAddress = record.origin_address && typeof record.origin_address === 'object'
    ? (record.origin_address as Record<string, unknown>).address
    : null;

  return typeof jsonAddress === 'string' && jsonAddress.trim().length > 0 ? jsonAddress : '-';
};

// 승인 가능 여부 판단 함수 (컴포넌트 외부)
const canApprove = (record: EvaluationRecord): boolean => {
  return record.geocoding_success &&
    record.status !== 'missing' &&
    record.status !== 'approved';
};

// FilterDropdown Props 타입
interface FilterDropdownProps {
  filterKey: string;
  label: string;
  options: { value: string; label: string }[];
  tooltip: string;
  currentValue: string | undefined;
  onFilterChange: (key: string, value: string) => void;
}

// 메모이제이션된 FilterDropdown 컴포넌트
const FilterDropdown = memo(function FilterDropdown({
  filterKey,
  label,
  options,
  tooltip,
  currentValue,
  onFilterChange,
}: FilterDropdownProps) {
  const isActive = currentValue !== undefined && currentValue !== '';

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs font-medium truncate">{label}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="w-3 h-3 text-muted-foreground flex-shrink-0" />
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">
          <p className="whitespace-pre-line text-xs">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-5 w-5 p-0",
              isActive && "bg-green-100 hover:bg-green-200"
            )}
          >
            <Menu className={cn("h-3 w-3", isActive && "text-green-700")} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {options.map(option => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => onFilterChange(filterKey, option.value === 'all' ? '' : option.value)}
              className={cn(
                currentValue === option.value || (!currentValue && option.value === 'all')
                  ? 'bg-accent'
                  : ''
              )}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

// 테이블 행 Props 타입
interface EvaluationTableRowProps {
  record: EvaluationRecord;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onApprove: (record: EvaluationRecord) => void;
  onDelete: (record: EvaluationRecord) => void;
  onRestore?: (record: EvaluationRecord) => void;
  onEdit?: (record: EvaluationRecord) => void;
  loading?: boolean;
  thumbnailState?: 'loading' | 'loaded' | 'error';
  thumbnailUrl?: string;
  onLoadThumbnail: (videoId: string) => void;
}

// 메모이제이션된 테이블 행 컴포넌트
const EvaluationTableRow = memo(forwardRef<HTMLTableRowElement, EvaluationTableRowProps>(
  function EvaluationTableRow(
    {
      record,
      isExpanded,
      onToggleExpand,
      onApprove,
      onDelete,
      onRestore,
      onEdit,
      loading,
      thumbnailState,
      thumbnailUrl,
      onLoadThumbnail,
    },
    ref
  ) {
    const videoId = getYoutubeVideoId(record.youtube_link);

    // 썸네일 로딩 트리거
    useEffect(() => {
      if (videoId && !thumbnailState) {
        onLoadThumbnail(videoId);
      }
    }, [videoId, thumbnailState, onLoadThumbnail]);

    return (
      <TableRow
        ref={ref}
        className={cn("group hover:bg-muted transition-colors cursor-pointer", isExpanded && "bg-muted border-l-4 border-l-primary")}
        onClick={onToggleExpand}
      >
        <TableCell
          className={cn(
            "sticky left-0 z-10 px-2 sm:px-4 transition-colors",
            isExpanded ? "bg-muted" : "bg-background group-hover:bg-muted"
          )}
        >
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
          >
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </Button>
        </TableCell>

        <TableCell
          className={cn(
            "min-w-[220px] sm:min-w-[280px] lg:sticky lg:left-12 lg:z-10 transition-colors",
            isExpanded ? "lg:bg-muted" : "lg:bg-background lg:group-hover:bg-muted"
          )}
        >
          <div className="flex items-center gap-3">
            {videoId && (
              <a
                href={record.youtube_link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="h-14 w-20 rounded bg-muted relative flex items-center justify-center overflow-hidden transition-opacity hover:opacity-80 sm:h-16 sm:w-24">
                  {/* 로딩 상태 */}
                  {thumbnailState === 'loading' && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  )}

                  {/* 성공 상태 - 썸네일 표시 */}
                  {thumbnailState === 'loaded' && thumbnailUrl && (
                    <img
                      src={thumbnailUrl}
                      alt="유튜브 썸네일"
                      className="w-full h-full object-cover"
                    />
                  )}

                  {/* 에러 상태 또는 기본 상태 - YouTube 아이콘 표시 */}
                  {(thumbnailState === 'error' || !thumbnailState) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-muted">
                      <svg
                        className="w-6 h-6 text-muted-foreground"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
                      </svg>
                    </div>
                  )}
                </div>
              </a>
            )}
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-xs font-medium sm:text-sm">
                {record.youtube_meta?.title || record.youtube_link}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground sm:text-xs">
                {new Date(record.youtube_meta?.publishedAt || record.created_at).toLocaleDateString('ko-KR')}
              </div>
            </div>
          </div>
        </TableCell>

        {/* 평가 컬럼 값들 */}
        <TableCell className="text-center text-sm">
          {record.status === 'not_selected' ? '-' : (record.evaluation_results?.visit_authenticity?.eval_value ?? '-')}
        </TableCell>

        <TableCell className="hidden text-center text-sm lg:table-cell">
          {record.status === 'not_selected' ? '-' : (record.evaluation_results?.rb_inference_score?.eval_value ?? '-')}
        </TableCell>

        <TableCell className="hidden text-center text-sm lg:table-cell">
          {record.status === 'not_selected' ? '-' : (record.evaluation_results?.rb_grounding_TF?.eval_value !== undefined
            ? (record.evaluation_results.rb_grounding_TF.eval_value
              ? <Badge variant="default" className="bg-green-600">True</Badge>
              : <Badge variant="destructive">False</Badge>)
            : '-')}
        </TableCell>

        <TableCell className="hidden text-center text-sm lg:table-cell">
          {record.status === 'not_selected' ? '-' : (record.evaluation_results?.review_faithfulness_score?.eval_value ?? '-')}
        </TableCell>

        <TableCell className="text-center text-sm">
          {record.status === 'not_selected' ? '-' : (
            record.geocoding_success === true
              ? <Badge variant="default" className="bg-green-600">True</Badge>
              : record.geocoding_success === false && record.geocoding_false_stage === null
                ? <Badge variant="outline" className="bg-yellow-100">Failed</Badge>
                : record.geocoding_success === false && record.geocoding_false_stage !== null
                  ? <Badge variant="destructive">False</Badge>
                  : '-'
          )}
        </TableCell>

        <TableCell className="hidden text-center text-sm lg:table-cell">
          {record.status === 'not_selected' ? '-' : (record.evaluation_results?.category_validity_TF?.eval_value !== undefined
            ? (record.evaluation_results.category_validity_TF.eval_value
              ? <Badge variant="default" className="bg-green-600">True</Badge>
              : <Badge variant="destructive">False</Badge>)
            : '-')}
        </TableCell>

        <TableCell className="hidden text-center text-sm lg:table-cell">
          {record.status === 'not_selected' ? '-' : (record.evaluation_results?.category_TF?.eval_value !== undefined
            ? (record.evaluation_results.category_TF.eval_value
              ? <Badge variant="default" className="bg-green-600">True</Badge>
              : <Badge variant="destructive">False</Badge>)
            : '-')}
        </TableCell>

        {/* 고정 컬럼: 상태 */}
        <TableCell
          className={cn(
            "sticky right-[120px] z-10 min-w-[84px] text-center lg:right-[160px] lg:min-w-[96px] transition-colors",
            isExpanded ? "bg-muted" : "bg-background group-hover:bg-muted"
          )}
        >
          {getStatusBadge(record.status)}
        </TableCell>

        {/* 고정 컬럼: 액션 */}
        <TableCell
          className={cn(
            "sticky right-0 z-10 min-w-[120px] lg:min-w-[160px] transition-colors",
            isExpanded ? "bg-muted" : "bg-background group-hover:bg-muted"
          )}
        >
          <div className="flex justify-center gap-1 lg:gap-2">
            {record.status === 'deleted' ? (
              // 삭제된 레코드 - 되돌리기 버튼만 표시
              <>
                <Button
                  size="sm"
                  className="h-8 px-2 lg:px-3"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestore?.(record);
                  }}
                  disabled={loading}
                  variant="outline"
                >
                  <Undo2 className="h-4 w-4 lg:mr-1" />
                  <span className="hidden lg:inline">되돌리기</span>
                </Button>
              </>
            ) : record.is_missing || record.is_not_selected || !record.geocoding_success ? (
              // 지오코딩 실패한 케이스 (Missing, 평가 미대상, 지오코딩 실패)
              <>
                <Button
                  size="sm"
                  className="h-8 px-2 lg:px-3"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit?.(record);
                  }}
                  disabled={loading}
                  variant="outline"
                >
                  <Edit className="h-4 w-4 lg:mr-1" />
                  <span className="hidden lg:inline">수정</span>
                </Button>

                <Button
                  size="sm"
                  className="h-8 w-8 p-0 lg:h-9 lg:w-9"
                  variant="destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(record);
                  }}
                  disabled={loading}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  className="h-8 px-2 lg:px-3"
                  onClick={(e) => {
                    e.stopPropagation();
                    onApprove(record);
                  }}
                  disabled={loading || !canApprove(record)}
                >
                  <Check className="h-4 w-4 lg:mr-1" />
                  <span className="hidden lg:inline">승인</span>
                </Button>

                {onEdit && (
                  <Button
                    size="sm"
                    className="h-8 px-2 lg:px-3"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(record);
                    }}
                    disabled={loading}
                  >
                    <Edit className="h-4 w-4 lg:mr-1" />
                    <span className="hidden lg:inline">수정</span>
                  </Button>
                )}

                <Button
                  size="sm"
                  className="h-8 w-8 p-0 lg:h-9 lg:w-9"
                  variant="destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(record);
                  }}
                  disabled={loading}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>

          {!record.geocoding_success && record.status !== 'missing' && (
            <div className="mt-1 hidden items-center justify-center gap-1 text-center text-xs text-destructive lg:flex">
              <AlertCircle className="w-3 h-3" />
              지오코딩 실패
            </div>
          )}
        </TableCell>
      </TableRow>
    );
  }
), (prevProps, nextProps) => {
  // 최적화된 비교 함수 - 중요한 props만 비교
  return (
    prevProps.record.id === nextProps.record.id &&
    prevProps.record.status === nextProps.record.status &&
    prevProps.record.geocoding_success === nextProps.record.geocoding_success &&
    prevProps.isExpanded === nextProps.isExpanded &&
    prevProps.loading === nextProps.loading &&
    prevProps.thumbnailState === nextProps.thumbnailState &&
    prevProps.thumbnailUrl === nextProps.thumbnailUrl
  );
});

export function EvaluationTable({
  records,
  onApprove,
  onDelete,
  onRestore,
  onRegisterMissing,
  onResolveConflict,
  onEdit,
  loading,
  isDeletedFilterActive = false,
  searchQuery = '',
  onSearchChange,
  evalFilters,
  onFilterChange,
  onResetFilters,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
}: EvaluationTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showMobileAdvancedFilters, setShowMobileAdvancedFilters] = useState(false);
  const [isDesktopLayout, setIsDesktopLayout] = useState<boolean | null>(null);
  const rowRefs = useRef<{ [key: string]: HTMLTableRowElement | null }>({});
  const tableScrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreObserverRef = useRef<IntersectionObserver | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  // 키보드 네비게이션 핸들러
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 입력 필드나 모달이 포커스된 경우 무시
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();

        const currentIndex = records.findIndex(r => r.id === expandedId);
        let nextIndex = -1;

        if (e.key === 'ArrowDown') {
          nextIndex = currentIndex < records.length - 1 ? currentIndex + 1 : 0;
          if (currentIndex === -1 && records.length > 0) nextIndex = 0;
        } else if (e.key === 'ArrowUp') {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : records.length - 1;
          if (currentIndex === -1 && records.length > 0) nextIndex = records.length - 1;
        }

        if (nextIndex !== -1) {
          const nextRecord = records[nextIndex];
          setExpandedId(nextRecord.id);

          // 스크롤 이동
          const rowElement = rowRefs.current[nextRecord.id];
          if (rowElement) {
            // scrollIntoView가 전체 페이지를 스크롤하여 헤더가 사라지는 문제를 방지하기 위해
            // 가장 가까운 스크롤 컨테이너를 찾아 직접 스크롤합니다.
            let parent = rowElement.parentElement;
            let scrollableParent: HTMLElement | null = null;

            while (parent) {
              const style = window.getComputedStyle(parent);
              if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                scrollableParent = parent;
                break;
              }
              parent = parent.parentElement;
            }

            if (scrollableParent) {
              const parentRect = scrollableParent.getBoundingClientRect();
              const rowRect = rowElement.getBoundingClientRect();

              // 현재 스크롤 위치에서 행이 화면 중앙에 오도록 오프셋 계산
              const relativeTop = rowRect.top - parentRect.top;
              const targetTop = scrollableParent.scrollTop + relativeTop - (scrollableParent.clientHeight / 2) + (rowElement.clientHeight / 2);

              scrollableParent.scrollTo({
                top: targetTop,
                behavior: 'smooth'
              });
            } else {
              // fallback
              rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [records, expandedId]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const updateLayout = () => setIsDesktopLayout(mediaQuery.matches);

    updateLayout();
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

  // FilterDropdown 렌더링 헬퍼 (evalFilters, onFilterChange 자동 바인딩)
  const renderFilterDropdown = useCallback((
    filterKey: string,
    label: string,
    tooltip: string,
    options: { value: string; label: string }[]
  ) => (
    <FilterDropdown
      filterKey={filterKey}
      label={label}
      tooltip={tooltip}
      options={options}
      currentValue={evalFilters[filterKey as keyof typeof evalFilters]}
      onFilterChange={onFilterChange}
    />
  ), [evalFilters, onFilterChange]);

  // 필터가 적용되어 있는지 확인
  const hasActiveFilters = useMemo(() =>
    Object.values(evalFilters).some(value => value !== undefined && value !== ''),
    [evalFilters]
  );
  const activeFilterCount = useMemo(() =>
    Object.values(evalFilters).filter(value => value !== undefined && value !== '').length,
    [evalFilters]
  );
  const currentStatusFilter = evalFilters.status ?? '';
  const shouldRenderMobile = isDesktopLayout === null ? true : !isDesktopLayout;
  const shouldRenderDesktop = isDesktopLayout === null ? true : isDesktopLayout;
  const handleLoadMore = useCallback(() => {
    if (!onLoadMore || !hasMore || isLoadingMore) return;
    onLoadMore();
  }, [hasMore, isLoadingMore, onLoadMore]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;

    if (!onLoadMore || !hasMore || isLoadingMore || !sentinel) {
      if (loadMoreObserverRef.current) {
        loadMoreObserverRef.current.disconnect();
        loadMoreObserverRef.current = null;
      }
      return;
    }

    if (loadMoreObserverRef.current) {
      loadMoreObserverRef.current.disconnect();
      loadMoreObserverRef.current = null;
    }

    const containerRoot = (() => {
      let current: HTMLElement | null = sentinel.parentElement;

      while (current) {
        const style = window.getComputedStyle(current);
        const isOverflowing = style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay'
          || style.overflow === 'auto' || style.overflow === 'scroll' || style.overflow === 'overlay';

        if (isOverflowing && current.scrollHeight > current.clientHeight) {
          return current;
        }

        current = current.parentElement;
      }

      return null;
    })();

    loadMoreObserverRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          handleLoadMore();
        }
      },
      { root: containerRoot, rootMargin: '200px 0px 0px 0px', threshold: 0.01 }
    );

    loadMoreObserverRef.current.observe(sentinel);

    return () => {
      if (loadMoreObserverRef.current) {
        loadMoreObserverRef.current.disconnect();
        loadMoreObserverRef.current = null;
      }
    };
  }, [handleLoadMore, hasMore, isLoadingMore, shouldRenderMobile, onLoadMore]);
  const quickFilterSwipeStartXRef = useRef<number | null>(null);
  const quickFilterSwipeEndXRef = useRef<number | null>(null);
  const quickFilterSwipeStartYRef = useRef<number | null>(null);
  const quickFilterSwipeEndYRef = useRef<number | null>(null);
  const quickFilterSwipeLastHandledAtRef = useRef(0);
  const quickFilterSwipeActiveRef = useRef(false);
  const quickFilterSwipeInputRef = useRef<'pointer' | 'touch' | null>(null);
  const quickFilterSwipePointerIdRef = useRef<number | null>(null);
  const quickFilterSwipeDistance = 24;
  const quickFilterCurrentIndex = useMemo(
    () => MOBILE_STATUS_QUICK_FILTERS.findIndex((filter) => filter.value === currentStatusFilter),
    [currentStatusFilter]
  );

  const handleMobileFilterTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (quickFilterSwipeActiveRef.current || quickFilterSwipeInputRef.current === 'pointer') return;
    quickFilterSwipeInputRef.current = 'touch';
    quickFilterSwipeActiveRef.current = true;
    quickFilterSwipePointerIdRef.current = null;
    quickFilterSwipeStartXRef.current = e.touches[0].clientX;
    quickFilterSwipeStartYRef.current = e.touches[0].clientY;
    quickFilterSwipeEndXRef.current = null;
    quickFilterSwipeEndYRef.current = null;
  }, []);

  const handleMobileFilterTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!quickFilterSwipeActiveRef.current || quickFilterSwipeInputRef.current !== 'touch') return;
    quickFilterSwipeEndXRef.current = e.touches[0].clientX;
    quickFilterSwipeEndYRef.current = e.touches[0].clientY;
  }, []);

  const handleMobileFilterSwipeEndInternal = useCallback((): boolean => {
    const startX = quickFilterSwipeStartXRef.current;
    const endX = quickFilterSwipeEndXRef.current;
    const startY = quickFilterSwipeStartYRef.current;
    const endY = quickFilterSwipeEndYRef.current;

    if (startX === null || endX === null || startY === null || endY === null) return false;

    const distanceX = startX - endX;
    const distanceY = startY - endY;
    if (Math.abs(distanceX) < quickFilterSwipeDistance || Math.abs(distanceX) <= Math.abs(distanceY)) {
      return false;
    }

    let nextIndex = quickFilterCurrentIndex;
    if (distanceX > 0) {
      nextIndex = Math.min(quickFilterCurrentIndex + 1, MOBILE_STATUS_QUICK_FILTERS.length - 1);
    } else {
      nextIndex = Math.max(quickFilterCurrentIndex - 1, 0);
    }

    if (nextIndex === -1) {
      nextIndex = 0;
    }

    onFilterChange('status', MOBILE_STATUS_QUICK_FILTERS[nextIndex].value);
    return true;
  }, [quickFilterCurrentIndex, onFilterChange]);

  const handleMobileFilterSwipeEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!quickFilterSwipeActiveRef.current || quickFilterSwipeInputRef.current !== 'touch') return;
    if (Date.now() - quickFilterSwipeLastHandledAtRef.current < 250) {
      quickFilterSwipeActiveRef.current = false;
      quickFilterSwipeInputRef.current = null;
      return;
    }

    const didSwipe = handleMobileFilterSwipeEndInternal();
    if (didSwipe) {
      quickFilterSwipeLastHandledAtRef.current = Date.now();
      e.preventDefault();
    }
    quickFilterSwipeActiveRef.current = false;
    quickFilterSwipeInputRef.current = null;
  }, [handleMobileFilterSwipeEndInternal]);

  const handleMobileFilterTouchCancel = useCallback(() => {
    if (!quickFilterSwipeActiveRef.current || quickFilterSwipeInputRef.current !== 'touch') return;
    quickFilterSwipeActiveRef.current = false;
    quickFilterSwipeInputRef.current = null;
  }, []);

  const handleMobileFilterPointerStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (quickFilterSwipeActiveRef.current || quickFilterSwipeInputRef.current === 'touch') return;
    quickFilterSwipeInputRef.current = 'pointer';
    quickFilterSwipeActiveRef.current = true;
    quickFilterSwipePointerIdRef.current = e.pointerId;
    quickFilterSwipeStartXRef.current = e.clientX;
    quickFilterSwipeStartYRef.current = e.clientY;
    quickFilterSwipeEndXRef.current = null;
    quickFilterSwipeEndYRef.current = null;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // no-op
    }
  }, []);

  const handleMobileFilterPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!quickFilterSwipeActiveRef.current || quickFilterSwipeInputRef.current !== 'pointer' || quickFilterSwipePointerIdRef.current !== e.pointerId) return;
    quickFilterSwipeEndXRef.current = e.clientX;
    quickFilterSwipeEndYRef.current = e.clientY;
  }, []);

  const handleMobileFilterPointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!quickFilterSwipeActiveRef.current || quickFilterSwipeInputRef.current !== 'pointer' || quickFilterSwipePointerIdRef.current !== e.pointerId) return;
    if (Date.now() - quickFilterSwipeLastHandledAtRef.current < 250) {
      quickFilterSwipeActiveRef.current = false;
      quickFilterSwipeInputRef.current = null;
      quickFilterSwipePointerIdRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // no-op
      }
      return;
    }

    const didSwipe = handleMobileFilterSwipeEndInternal();
    if (didSwipe) {
      quickFilterSwipeLastHandledAtRef.current = Date.now();
      e.preventDefault();
    }
    quickFilterSwipeActiveRef.current = false;
    quickFilterSwipeInputRef.current = null;
    quickFilterSwipePointerIdRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // no-op
    }
  }, [handleMobileFilterSwipeEndInternal]);

  const handleMobileFilterPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!quickFilterSwipeActiveRef.current || quickFilterSwipeInputRef.current !== 'pointer' || quickFilterSwipePointerIdRef.current !== e.pointerId) return;
    quickFilterSwipeActiveRef.current = false;
    quickFilterSwipeInputRef.current = null;
    quickFilterSwipePointerIdRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // no-op
    }
  }, []);

  // 썸네일 로딩 상태와 URL을 통합 관리
  const [thumbnailData, setThumbnailData] = useState<Record<string, { state: 'loading' | 'loaded' | 'error'; url?: string }>>({});
  const thumbnailDataRef = useRef<Record<string, { state: 'loading' | 'loaded' | 'error'; url?: string }>>({});

  // 로딩 중인 썸네일 추적 (리렌더링 방지를 위해 useRef 사용)
  const loadingThumbnailsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    thumbnailDataRef.current = thumbnailData;
  }, [thumbnailData]);

  const loadThumbnail = useCallback((videoId: string) => {
    // 이미 로딩 중이거나 완료된 경우 스킵
    if (loadingThumbnailsRef.current.has(videoId)) {
      return;
    }

    // 함수형 업데이트로 현재 상태 확인
    setThumbnailData(prev => {
      if (prev[videoId]?.state === 'loaded' || prev[videoId]?.state === 'error') {
        return prev;
      }

      // 로딩 시작
      loadingThumbnailsRef.current.add(videoId);

      // 가장 확실한 썸네일부터 시도: default -> hqdefault -> mqdefault -> maxresdefault
      const tryThumbnail = (quality: string) => {
        const img = new Image();
        const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;

        img.onload = () => {
          loadingThumbnailsRef.current.delete(videoId);
          setThumbnailData(p => ({ ...p, [videoId]: { state: 'loaded', url: thumbnailUrl } }));
        };

        img.onerror = () => {
          // 다음 품질 시도
          if (quality === 'default') {
            tryThumbnail('hqdefault');
          } else if (quality === 'hqdefault') {
            tryThumbnail('mqdefault');
          } else if (quality === 'mqdefault') {
            tryThumbnail('maxresdefault');
          } else {
            // 모든 시도 실패
            loadingThumbnailsRef.current.delete(videoId);
            setThumbnailData(p => ({ ...p, [videoId]: { state: 'error' } }));
          }
        };

        img.src = thumbnailUrl;
      };

      // default부터 시작 (모든 영상에 존재)
      tryThumbnail('default');

      return { ...prev, [videoId]: { state: 'loading' } };
    });
  }, []); // 의존성 배열 비움 - 함수형 업데이트 사용으로 상태 의존성 제거

  // 레코드가 변경될 때 더 이상 표시되지 않는 썸네일 데이터 정리
  useEffect(() => {
    if (records && records.length > 0) {
      const currentVideoIds = new Set<string>();
      records.forEach(record => {
        const videoId = getYoutubeVideoId(record.youtube_link);
        if (videoId) {
          currentVideoIds.add(videoId);
        }
      });

      // 기존 상태에서 현재 표시되지 않는 썸네일 데이터 제거
      setThumbnailData(prev => {
        const newData: Record<string, { state: 'loading' | 'loaded' | 'error'; url?: string }> = {};
        Object.keys(prev).forEach(videoId => {
          if (currentVideoIds.has(videoId)) {
            newData[videoId] = prev[videoId];
          }
        });
        return newData;
      });
    }
  }, [records]);

  // 모바일 카드 뷰에서도 썸네일이 보이도록 선로딩
  useEffect(() => {
    records.forEach((record) => {
      const videoId = getYoutubeVideoId(record.youtube_link);
      if (videoId && !thumbnailDataRef.current[videoId] && !loadingThumbnailsRef.current.has(videoId)) {
        loadThumbnail(videoId);
      }
    });
  }, [records, loadThumbnail]);

  const mobileControls = (
    <div className="z-30 bg-background pb-2 pt-1 lg:hidden">
      <div className="space-y-2 rounded-lg border bg-card p-3 shadow-sm">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="영상 제목 검색..."
            value={searchQuery}
            onChange={(e) => onSearchChange?.(e.target.value)}
            className="h-9 pl-8 pr-8 text-sm"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-0 top-1/2 h-8 w-8 -translate-y-1/2 p-0"
              onClick={() => onSearchChange?.('')}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>

        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-max items-center gap-2">
            {MOBILE_STATUS_QUICK_FILTERS.map((filter) => {
              const isActive = currentStatusFilter === filter.value;
              return (
                <Button
                  key={filter.label}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => onFilterChange('status', filter.value)}
                >
                  {filter.label}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">레코드 {records.length}개</span>
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                필터 {activeFilterCount}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant={showMobileAdvancedFilters ? "secondary" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowMobileAdvancedFilters(prev => !prev)}
            >
              {showMobileAdvancedFilters ? '필터 닫기' : '상세 필터'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onResetFilters}
              disabled={!hasActiveFilters}
              className="h-7 text-xs"
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              초기화
            </Button>
          </div>
        </div>

        {showMobileAdvancedFilters && (
          <div className="grid grid-cols-2 gap-2 border-t pt-2">
            {renderFilterDropdown(
              "status",
              "상태",
              "레코드 상태별로 필터링",
              STATUS_FILTER_OPTIONS
            )}
            {renderFilterDropdown(
              "visit_authenticity",
              "방문여부",
              FILTER_TOOLTIPS.visit_authenticity,
              [
                { value: 'all', label: '전체' },
                { value: '0', label: '0점' },
                { value: '1', label: '1점' },
                { value: '2', label: '2점' },
                { value: '3', label: '3점' },
                { value: '4', label: '4점' },
              ]
            )}
            {renderFilterDropdown(
              "rb_inference_score",
              "추론합리",
              FILTER_TOOLTIPS.rb_inference_score,
              [
                { value: 'all', label: '전체' },
                { value: '0', label: '0점' },
                { value: '1', label: '1점' },
                { value: '2', label: '2점' },
              ]
            )}
            {renderFilterDropdown(
              "rb_grounding_TF",
              "근거일치",
              FILTER_TOOLTIPS.rb_grounding_TF,
              [
                { value: 'all', label: '전체' },
                { value: 'True', label: 'True' },
                { value: 'False', label: 'False' },
              ]
            )}
            {renderFilterDropdown(
              "review_faithfulness_score",
              "리뷰충실",
              FILTER_TOOLTIPS.review_faithfulness_score,
              [
                { value: 'all', label: '전체' },
                { value: '0', label: '0점' },
                { value: '1', label: '1점' },
              ]
            )}
            {renderFilterDropdown(
              "geocoding_success",
              "주소정합",
              `True = 지오코딩 성공 (geocoding_success = true)
False = 지오코딩 성공했으나 주소 매칭 실패 (geocoding_success = false, geocoding_false_stage 값 있음)
Failed = 지오코딩 자체 실패 (geocoding_success = false, geocoding_false_stage = null)`,
              [
                { value: 'all', label: '전체' },
                { value: 'true', label: 'True' },
                { value: 'false_match', label: 'False' },
                { value: 'false_geocode', label: 'Failed' },
              ]
            )}
            {renderFilterDropdown(
              "category_validity_TF",
              "카테고리 유효",
              FILTER_TOOLTIPS.category_validity_TF,
              [
                { value: 'all', label: '전체' },
                { value: 'True', label: 'True' },
                { value: 'False', label: 'False' },
              ]
            )}
            {renderFilterDropdown(
              "category_TF",
              "카테고리 정합",
              FILTER_TOOLTIPS.category_TF,
              [
                { value: 'all', label: '전체' },
                { value: 'True', label: 'True' },
                { value: 'False', label: 'False' },
              ]
            )}
          </div>
        )}
      </div>
    </div>
  );

  const loadMoreSentinel = hasMore && onLoadMore ? <div ref={loadMoreSentinelRef} className="h-8" /> : null;

  const mobileCards = (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden">
        {records.map((record) => {
        const videoId = getYoutubeVideoId(record.youtube_link);
        const thumbnailInfo = videoId ? thumbnailData[videoId] : null;
        const isExpanded = expandedId === record.id;
        const visitValue = record.status === 'not_selected'
          ? '-'
          : getDisplayValue(record.evaluation_results?.visit_authenticity?.eval_value);
        const inferenceValue = record.status === 'not_selected'
          ? '-'
          : getDisplayValue(record.evaluation_results?.rb_inference_score?.eval_value);
        const groundingValue = record.status === 'not_selected'
          ? '-'
          : getBooleanLabel(record.evaluation_results?.rb_grounding_TF?.eval_value);
        const reviewValue = record.status === 'not_selected'
          ? '-'
          : getDisplayValue(record.evaluation_results?.review_faithfulness_score?.eval_value);
        const geocodingText = getGeocodingLabel(record);
        const categoryValidity = record.status === 'not_selected'
          ? '-'
          : getBooleanLabel(record.evaluation_results?.category_validity_TF?.eval_value);
        const categoryMatch = record.status === 'not_selected'
          ? '-'
          : getBooleanLabel(record.evaluation_results?.category_TF?.eval_value);

        const categoryText = formatCategoryText(record.categories, '') || formatCategoryText(record.restaurant_info?.category, '-');
        const originAddress = getOriginAddress(record);
        const roadAddress = record.restaurant_info?.naver_address_info?.road_address || record.road_address || '-';
        const jibunAddress = record.restaurant_info?.naver_address_info?.jibun_address || record.jibun_address || '-';
        const coordinates = record.lat !== null && record.lat !== undefined && record.lng !== null && record.lng !== undefined
          ? `${record.lat}, ${record.lng}`
          : '-';
        const reasoningBasis = record.reasoning_basis || record.restaurant_info?.reasoning_basis || '-';
        const tzuyangReview = record.restaurant_info?.tzuyang_review || '-';
        const publishedAt = new Date(record.youtube_meta?.publishedAt || record.created_at).toLocaleDateString('ko-KR');

        const metricItems = [
          { label: '방문여부', value: visitValue },
          { label: '추론합리', value: inferenceValue },
          { label: '근거일치', value: groundingValue },
          { label: '리뷰충실', value: reviewValue },
          { label: '주소정합', value: geocodingText },
          { label: '카테고리 유효', value: categoryValidity },
          { label: '카테고리 정합', value: categoryMatch },
        ];

          return (
            <div
              key={record.id}
              className={cn(
                "rounded-lg border bg-card p-3",
                getMobileCardTone(record.status),
                isExpanded && "shadow-sm"
              )}
            >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold">
                  {record.restaurant_name || record.name || '이름 없음'}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {publishedAt} | ID {record.id.slice(0, 8)}
                </p>
              </div>
              <div className="shrink-0">{getStatusBadge(record.status)}</div>
            </div>

            <div className="mt-2 flex items-start gap-2">
              {videoId && (
                <a
                  href={record.youtube_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="relative h-16 w-24 overflow-hidden rounded bg-muted">
                    {thumbnailInfo?.state === 'loaded' && thumbnailInfo.url ? (
                      <img src={thumbnailInfo.url} alt="유튜브 썸네일" className="h-full w-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      </div>
                    )}
                  </div>
                </a>
              )}

              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {record.youtube_meta?.title || record.youtube_link}
                </p>
                {record.youtube_link && (
                  <a
                    href={record.youtube_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 truncate text-[11px] text-blue-600 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    영상 열기
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge variant="outline" className="text-[11px]">방문 {visitValue}</Badge>
              <Badge variant="outline" className="text-[11px]">추론 {inferenceValue}</Badge>
              <Badge variant="outline" className="text-[11px]">근거 {groundingValue}</Badge>
              <Badge variant="outline" className="text-[11px]">주소 {geocodingText}</Badge>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {record.status === 'deleted' ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestore?.(record);
                  }}
                  disabled={loading}
                >
                  <Undo2 className="mr-1 h-3.5 w-3.5" />
                  되돌리기
                </Button>
              ) : record.is_missing || record.is_not_selected || !record.geocoding_success ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 flex-1 min-w-[96px]"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit?.(record);
                    }}
                    disabled={loading}
                  >
                    <Edit className="mr-1 h-3.5 w-3.5" />
                    수정
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-8 w-9 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(record);
                    }}
                    disabled={loading}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    className="h-8 flex-1 min-w-[96px]"
                    onClick={(e) => {
                      e.stopPropagation();
                      onApprove(record);
                    }}
                    disabled={loading || !canApprove(record)}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    승인
                  </Button>
                  {onEdit && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 flex-1 min-w-[96px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(record);
                      }}
                      disabled={loading}
                    >
                      <Edit className="mr-1 h-3.5 w-3.5" />
                      수정
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-8 w-9 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(record);
                    }}
                    disabled={loading}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="mt-2 h-8 w-full justify-between text-xs"
              onClick={() => toggleExpand(record.id)}
            >
              전체 검수 정보
              {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>

            {isExpanded && (
              <div className="mt-2 space-y-2 rounded-md border bg-muted/20 p-2.5 text-[11px]">
                <div>
                  <p className="font-semibold text-foreground">평가 항목</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {metricItems.map((metric) => (
                      <div key={metric.label} className="flex items-center justify-between gap-2">
                        <dt className="text-muted-foreground">{metric.label}</dt>
                        <dd className="font-semibold">{metric.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {record.evaluation_results?.category_TF?.category_revision && (
                    <p className="mt-2 text-amber-700">
                      카테고리 수정안: {formatCategoryText(record.evaluation_results?.category_TF.category_revision, '-')}
                    </p>
                  )}
                </div>

                <div className="rounded-md border bg-background p-2">
                  <p className="font-semibold text-foreground">검수 정보</p>
                  <dl className="mt-1.5 space-y-1.5">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">카테고리</dt>
                      <dd className="max-w-[72%] break-all text-right">{categoryText}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">전화번호</dt>
                      <dd>{record.phone || record.restaurant_info?.phone || '-'}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">좌표</dt>
                      <dd className="font-mono">{coordinates}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">리뷰 수</dt>
                      <dd>{record.review_count ?? 0}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">소스</dt>
                      <dd className="max-w-[72%] break-all text-right">{record.source_type || '-'}</dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-md border bg-background p-2">
                  <p className="font-semibold text-foreground">주소</p>
                  <p className="mt-1 break-all"><span className="text-muted-foreground">원본:</span> {originAddress}</p>
                  <p className="mt-1 break-all"><span className="text-muted-foreground">도로명:</span> {roadAddress}</p>
                  <p className="mt-1 break-all"><span className="text-muted-foreground">지번:</span> {jibunAddress}</p>
                </div>

                {(record.is_missing || record.status === 'not_selected' || record.db_error_message) && (
                  <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                    {record.is_missing && (
                      <p className="text-destructive">
                        Missing 사유: {record.missing_message || 'restaurants 배열 누락'}
                      </p>
                    )}
                    {record.status === 'not_selected' && (
                      <p className="text-destructive">
                        미대상 사유: {record.geocoding_fail_reason || '주소 정보 부족'}
                      </p>
                    )}
                    {record.db_error_message && (
                      <p className="text-destructive">
                        DB 오류: {record.db_error_message}
                      </p>
                    )}
                  </div>
                )}

                <div className="rounded-md border bg-background p-2">
                  <p className="font-semibold text-foreground">Reasoning Basis</p>
                  <p className="mt-1 whitespace-pre-wrap break-all text-muted-foreground">{reasoningBasis}</p>
                </div>

                <div className="rounded-md border bg-background p-2">
                  <p className="font-semibold text-foreground">Tzuyang Review</p>
                  <p className="mt-1 whitespace-pre-wrap break-all text-muted-foreground">{tzuyangReview}</p>
                </div>

                <div className="overflow-hidden rounded-md border bg-background">
                  <EvaluationRowDetails
                    record={record}
                    onEdit={() => onEdit?.(record)}
                  />
                </div>
              </div>
            )}
          </div>
          );
        })}
      </div>
    </>
  );

  return (
    <TooltipProvider>
      <div
        ref={tableScrollContainerRef}
        className={cn(
          shouldRenderMobile
            ? "flex h-full min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain space-y-3 pb-[calc(var(--mobile-bottom-nav-height,60px)+env(safe-area-inset-bottom)+12px)]"
            : "space-y-3"
        )}
        style={shouldRenderMobile ? { touchAction: 'pan-y' } : undefined}
        onTouchStart={shouldRenderMobile ? handleMobileFilterTouchStart : undefined}
        onTouchMove={shouldRenderMobile ? handleMobileFilterTouchMove : undefined}
        onTouchEnd={shouldRenderMobile ? handleMobileFilterSwipeEnd : undefined}
        onPointerDown={shouldRenderMobile ? handleMobileFilterPointerStart : undefined}
        onPointerMove={shouldRenderMobile ? handleMobileFilterPointerMove : undefined}
        onPointerUp={shouldRenderMobile ? handleMobileFilterPointerEnd : undefined}
        onPointerCancel={shouldRenderMobile ? handleMobileFilterPointerCancel : undefined}
        onTouchCancel={shouldRenderMobile ? handleMobileFilterTouchCancel : undefined}
      >
        {shouldRenderMobile && (
          <>
            {mobileControls}
            {records.length > 0 ? (
              mobileCards
            ) : (
              <div className="rounded-lg border bg-card text-center text-sm text-muted-foreground lg:hidden flex min-h-0 flex-1 items-center justify-center p-6">
                표시할 데이터가 없습니다
              </div>
            )}
          </>
        )}

        {shouldRenderDesktop && (
          <div className="hidden rounded-lg border lg:block">
          <Table allowHorizontalScroll>
          <TableHeader className="sticky top-0 bg-background z-20">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 sticky left-0 z-10 bg-background/95 px-2 sm:w-12 sm:px-4">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onResetFilters}
                      disabled={!hasActiveFilters}
                      className={cn(
                        "h-7 w-7 p-0",
                        hasActiveFilters && "text-green-600 hover:text-green-700 hover:bg-green-50"
                      )}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">필터 초기화</p>
                  </TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead className="min-w-[220px] sm:min-w-[280px] lg:sticky lg:left-12 lg:z-10 lg:bg-background">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="영상 제목 검색..."
                      value={searchQuery}
                      onChange={(e) => onSearchChange?.(e.target.value)}
                      className="pl-8 pr-8 h-8 text-sm"
                    />
                    {searchQuery && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
                        onClick={() => onSearchChange?.('')}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </TableHead>

              {/* 평가 컬럼들 */}
              <TableHead className="min-w-[90px]">
                {renderFilterDropdown(
                  "visit_authenticity",
                  "방문여부",
                  FILTER_TOOLTIPS.visit_authenticity,
                  [
                    { value: 'all', label: '전체' },
                    { value: '0', label: '0점' },
                    { value: '1', label: '1점' },
                    { value: '2', label: '2점' },
                    { value: '3', label: '3점' },
                    { value: '4', label: '4점' },
                  ]
                )}
              </TableHead>

              <TableHead className="hidden min-w-[80px] lg:table-cell">
                {renderFilterDropdown(
                  "rb_inference_score",
                  "추론합리",
                  FILTER_TOOLTIPS.rb_inference_score,
                  [
                    { value: 'all', label: '전체' },
                    { value: '0', label: '0점' },
                    { value: '1', label: '1점' },
                    { value: '2', label: '2점' },
                  ]
                )}
              </TableHead>

              <TableHead className="hidden min-w-[90px] lg:table-cell">
                {renderFilterDropdown(
                  "rb_grounding_TF",
                  "근거일치",
                  FILTER_TOOLTIPS.rb_grounding_TF,
                  [
                    { value: 'all', label: '전체' },
                    { value: 'True', label: 'True' },
                    { value: 'False', label: 'False' },
                  ]
                )}
              </TableHead>

              <TableHead className="hidden min-w-[80px] lg:table-cell">
                {renderFilterDropdown(
                  "review_faithfulness_score",
                  "리뷰충실",
                  FILTER_TOOLTIPS.review_faithfulness_score,
                  [
                    { value: 'all', label: '전체' },
                    { value: '0', label: '0점' },
                    { value: '1', label: '1점' },
                  ]
                )}
              </TableHead>

              <TableHead className="min-w-[80px]">
                {renderFilterDropdown(
                  "geocoding_success",
                  "주소정합",
                  `True = 지오코딩 성공 (geocoding_success = true)
False = 지오코딩 성공했으나 주소 매칭 실패 (geocoding_success = false, geocoding_false_stage 값 있음)
Failed = 지오코딩 자체 실패 (geocoding_success = false, geocoding_false_stage = null)`,
                  [
                    { value: 'all', label: '전체' },
                    { value: 'true', label: 'True' },
                    { value: 'false_match', label: 'False' },
                    { value: 'false_geocode', label: 'Failed' },
                  ]
                )}
              </TableHead>

              <TableHead className="hidden min-w-[90px] lg:table-cell">
                {renderFilterDropdown(
                  "category_validity_TF",
                  "카테고리 유효",
                  FILTER_TOOLTIPS.category_validity_TF,
                  [
                    { value: 'all', label: '전체' },
                    { value: 'True', label: 'True' },
                    { value: 'False', label: 'False' },
                  ]
                )}
              </TableHead>

              <TableHead className="hidden min-w-[90px] lg:table-cell">
                {renderFilterDropdown(
                  "category_TF",
                  "카테고리 정합",
                  FILTER_TOOLTIPS.category_TF,
                  [
                    { value: 'all', label: '전체' },
                    { value: 'True', label: 'True' },
                    { value: 'False', label: 'False' },
                  ]
                )}
              </TableHead>

              {/* 고정 컬럼 */}
              <TableHead className="sticky right-[120px] z-10 min-w-[84px] bg-background text-center lg:right-[160px] lg:min-w-[96px]">
                {/* 삭제 필터 활성화 시 드롭다운 숨김 */}
                {isDeletedFilterActive ? (
                  <div className="text-sm font-medium">상태</div>
                ) : (
                  renderFilterDropdown(
                    "status",
                    "상태",
                    "레코드 상태별로 필터링",
                    STATUS_FILTER_OPTIONS
                  )
                )}
              </TableHead>
              <TableHead className="sticky right-0 z-10 min-w-[120px] bg-background text-center lg:min-w-[160px]">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="h-32 text-center text-muted-foreground">
                  표시할 데이터가 없습니다
                </TableCell>
              </TableRow>
            ) : (
              records.flatMap((record) => {
                const videoId = getYoutubeVideoId(record.youtube_link);

                // 썸네일 정보 조회
                const thumbnailInfo = videoId ? thumbnailData[videoId] : null;

                const mainRow = (
                  <EvaluationTableRow
                    key={record.id}
                    ref={(el) => {
                      if (el) rowRefs.current[record.id] = el;
                    }}
                    record={record}
                    isExpanded={expandedId === record.id}
                    onToggleExpand={() => toggleExpand(record.id)}
                    onApprove={onApprove}
                    onDelete={onDelete}
                    onRestore={onRestore}
                    onEdit={onEdit}
                    loading={loading}
                    thumbnailState={thumbnailInfo?.state}
                    thumbnailUrl={thumbnailInfo?.url}
                    onLoadThumbnail={loadThumbnail}
                  />
                );

                const detailRow = expandedId === record.id ? (
                  <TableRow key={`${record.id}-details`}>
                    <TableCell colSpan={11} className="p-0 border-0 bg-muted/30">
                      <div className="w-full lg:sticky lg:left-0 lg:z-10">
                        <EvaluationRowDetails
                          record={record}
                          onEdit={() => onEdit?.(record)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null;

                return detailRow ? [mainRow, detailRow] : [mainRow];
              })
            )}
          </TableBody>
        </Table>
        <div className="h-8" /> {/* 마지막 레코드가 잘리지 않도록 충분한 하단 여백 */}
          </div>
        )}
        {loadMoreSentinel}
      </div>
    </TooltipProvider>
  );
}

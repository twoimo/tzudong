import React, { useState, useEffect, useCallback, useRef, useMemo, memo, forwardRef } from 'react';
import NextImage from 'next/image';
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
import { Skeleton } from '@/components/ui/skeleton';
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
import { PRIMARY_STATUS_FILTER_OPTIONS } from './evaluation-status-filter-options';
import {
  canApproveAddressConsistencyRecord,
  getAddressConsistencyBadgeClass,
  getAddressConsistencyDisplayLabel,
} from '@/lib/admin-address-consistency';
import {
  needsEvaluationRerun,
} from '@/lib/admin-evaluation-completeness';
import { getAdminEvaluationVideoLabel, hasAdminEvaluationYoutubeTitle } from '@/lib/admin-evaluation-name';
import {
  extractCanonicalYouTubeVideoId,
  normalizeCanonicalYouTubeWatchUrl,
} from '@/lib/youtube-url';
import { getYoutubeThumbnailCandidates, shouldTryNextYoutubeThumbnailCandidate } from '@/lib/youtube-thumbnail';

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

  rb_grounding_TF: `확인됨: 제시된 판정 근거가 영상에서 실제로 확인됨
불일치: 제시된 판정 근거를 영상에서 찾을 수 없음`,

  review_faithfulness_score: `0점: 내용 왜곡, 과장, 또는 틀린 정보 포함
1점: 실제 영상 내용을 충실하고 정확하게 요약함`,

  geocoding_success: `정합: 주소 후보와 좌표가 맞는 것으로 판정됨
불일치: 주소 변환은 됐지만 단계별 주소 매칭에 실패함
실패: 주소 후보나 좌표를 만들기 전 주소 변환 자체가 실패함`,

  category_validity_TF: `유효: 사용할 수 있는 카테고리임
무효: 목록에 없는 카테고리임`,

  category_TF: `일치: 현재 카테고리가 영상 내용과 일치함
불일치: 현재 카테고리가 영상 내용과 맞지 않음`
};

// 유틸리티 함수: 상태 뱃지 반환 (컴포넌트 외부)
const STATUS_VARIANTS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: '미처리', variant: 'secondary' },
  approved: { label: '승인됨', variant: 'default' },
  hold: { label: '보류', variant: 'outline' },
  missing: { label: '누락', variant: 'destructive' },
  geocoding_failed: { label: '지오코딩 실패', variant: 'destructive' },
  address_review_geocode_recovered: { label: '미처리', variant: 'secondary' },
  not_selected: { label: '평가 미대상', variant: 'outline' },
  db_conflict: { label: 'DB 충돌', variant: 'destructive' },
  deleted: { label: '삭제됨', variant: 'destructive' },
};

const MOBILE_STATUS_QUICK_FILTERS: { value: string; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'pending', label: '미처리' },
  { value: 'ready_for_approval', label: '승인대기' },
  { value: 'approved', label: '승인됨' },
  { value: 'missing', label: '누락' },
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
    case 'address_review_geocode_recovered':
      return 'border-l-4 border-l-sky-500';
    case 'not_selected':
      return 'border-l-4 border-l-slate-400';
    default:
      return 'border-l-4 border-l-primary/60';
  }
};

const getBooleanLabel = (value: boolean | null | undefined): string => {
  if (value === true) return '일치';
  if (value === false) return '불일치';
  return '-';
};

const getDisplayValue = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
};

const shouldShowMetricFallback = (record: EvaluationRecord) => (
  record.status === 'not_selected' || record.is_not_selected === true
);

const renderMetricScore = (record: EvaluationRecord, value: string | number | null | undefined) => {
  if (shouldShowMetricFallback(record)) return '-';
  return value === null || value === undefined || value === '' ? '-' : value;
};

const renderMetricBoolean = (record: EvaluationRecord, value: boolean | null | undefined) => {
  if (shouldShowMetricFallback(record)) return '-';
  if (value === undefined || value === null) return '-';

  return value
    ? <Badge variant="default" className="bg-green-600">일치</Badge>
    : <Badge variant="destructive">불일치</Badge>;
};

const getMobileMetricDisplayValue = (record: EvaluationRecord, value: string | number | boolean | null | undefined): string => {
  if (shouldShowMetricFallback(record)) return '-';
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return getBooleanLabel(value);
  return getDisplayValue(value);
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

// FilterDropdown Props 타입
interface FilterDropdownProps {
  filterKey: string;
  label: string;
  options: readonly { value: string; label: string }[];
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
            aria-label={`${label} 필터 열기`}
            title={`${label} 필터 열기`}
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
    const canonicalYoutubeUrl = normalizeCanonicalYouTubeWatchUrl(record.youtube_link);
    const videoId = extractCanonicalYouTubeVideoId(canonicalYoutubeUrl);
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
            aria-label={isExpanded ? "행 접기" : "행 펼치기"}
            title={isExpanded ? "행 접기" : "행 펼치기"}
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
            {canonicalYoutubeUrl && videoId && (
              <a
                href={canonicalYoutubeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="h-14 w-20 rounded bg-muted relative flex items-center justify-center overflow-hidden transition-opacity hover:opacity-80 sm:h-16 sm:w-24">
                  {/* 로딩 상태 */}
                  {thumbnailState === 'loading' && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent motion-reduce:animate-none"></div>
                    </div>
                  )}

                  {/* 성공 상태 - 썸네일 표시 */}
                  {thumbnailState === 'loaded' && thumbnailUrl && (
                    <NextImage
                      src={thumbnailUrl}
                      alt="유튜브 썸네일"
                      fill
                      unoptimized
                      sizes="(max-width: 640px) 80px, 96px"
                      className="object-cover"
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
                {getAdminEvaluationVideoLabel(record)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground sm:text-xs">
                {hasAdminEvaluationYoutubeTitle(record) ? null : '제목 없음 · '}
                {new Date(record.youtube_meta?.publishedAt || record.created_at).toLocaleDateString('ko-KR')}
              </div>
            </div>
          </div>
        </TableCell>

        {/* 평가 컬럼 값들 */}
        <TableCell className="text-center text-sm">
          {renderMetricScore(record, record.evaluation_results?.visit_authenticity?.eval_value)}
        </TableCell>

        <TableCell className="hidden text-center text-sm lg:table-cell">
          {renderMetricScore(record, record.evaluation_results?.rb_inference_score?.eval_value)}
        </TableCell>

        <TableCell className="hidden text-center text-sm lg:table-cell">
          {renderMetricBoolean(record, record.evaluation_results?.rb_grounding_TF?.eval_value)}
        </TableCell>

        <TableCell className="hidden text-center text-sm lg:table-cell">
          {renderMetricScore(record, record.evaluation_results?.review_faithfulness_score?.eval_value)}
        </TableCell>

        <TableCell className="text-center text-sm">
          {record.status === 'not_selected' ? '-' : (
            getAddressConsistencyDisplayLabel(record) === '-'
              ? '-'
              : (
                <Badge className={getAddressConsistencyBadgeClass(record)}>{getAddressConsistencyDisplayLabel(record)}</Badge>
              )
          )}
        </TableCell>

        <TableCell className="hidden text-center text-sm lg:table-cell">
          {renderMetricBoolean(record, record.evaluation_results?.category_validity_TF?.eval_value)}
        </TableCell>

        <TableCell className="hidden text-center text-sm lg:table-cell">
          {renderMetricBoolean(record, record.evaluation_results?.category_TF?.eval_value)}
        </TableCell>

        {/* 고정 컬럼: 상태 */}
        <TableCell
          className={cn(
            "sticky right-[120px] z-10 min-w-[84px] text-center lg:right-[160px] lg:min-w-[96px] transition-colors",
            isExpanded ? "bg-muted" : "bg-background group-hover:bg-muted"
          )}
        >
          <div className="flex flex-col items-center gap-1">
            {getStatusBadge(record.status)}
          </div>
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
            ) : record.is_missing || record.status === 'missing' || record.is_not_selected || record.status === 'not_selected' || !record.geocoding_success ? (
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
                  aria-label="검수 항목 삭제"
                  title="검수 항목 삭제"
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
                  disabled={loading || needsEvaluationRerun(record) || !canApproveAddressConsistencyRecord(record)}
                  title={needsEvaluationRerun(record) ? '평가값/근거 확인 후 승인하세요' : undefined}
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
                  aria-label="검수 항목 삭제"
                  title="검수 항목 삭제"
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
              주소 확인 {getAddressConsistencyDisplayLabel(record)}
            </div>
          )}
        </TableCell>
      </TableRow>
    );
  }
));

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
  void onRegisterMissing;
  void onResolveConflict;
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
              // Use native centering when scrollIntoView cannot honor the sticky header offset.
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
    options: readonly { value: string; label: string }[]
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
  const handleMobileStatusQuickFilterChange = useCallback((status: string) => {
    onFilterChange('status', status);
  }, [onFilterChange]);
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
    if (
      loadingThumbnailsRef.current.has(videoId) ||
      thumbnailDataRef.current[videoId]?.state === 'loaded' ||
      thumbnailDataRef.current[videoId]?.state === 'error'
    ) {
      return;
    }

    loadingThumbnailsRef.current.add(videoId);
    setThumbnailData(prev => ({ ...prev, [videoId]: { state: 'loading' } }));

    const candidates = getYoutubeThumbnailCandidates(videoId);
    let candidateIndex = 0;

    const tryNextThumbnail = () => {
      const thumbnailUrl = candidates[candidateIndex];
      if (!thumbnailUrl) {
        loadingThumbnailsRef.current.delete(videoId);
        setThumbnailData(p => ({ ...p, [videoId]: { state: 'error' } }));
        return;
      }

      const img = new Image();
      img.onload = () => {
        if (
          shouldTryNextYoutubeThumbnailCandidate({
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            candidateIndex,
            totalCandidates: candidates.length,
          })
        ) {
          candidateIndex += 1;
          tryNextThumbnail();
          return;
        }

        loadingThumbnailsRef.current.delete(videoId);
        setThumbnailData(p => ({ ...p, [videoId]: { state: 'loaded', url: thumbnailUrl } }));
      };
      img.onerror = () => {
        candidateIndex += 1;
        tryNextThumbnail();
      };
      img.src = thumbnailUrl;
    };

    tryNextThumbnail();
  }, []); // 의존성 배열 비움 - 함수형 업데이트 사용으로 상태 의존성 제거

  // 레코드가 변경될 때 더 이상 표시되지 않는 썸네일 데이터 정리
  useEffect(() => {
    if (records && records.length > 0) {
      const currentVideoIds = new Set<string>();
      records.forEach(record => {
        const canonicalYoutubeUrl = normalizeCanonicalYouTubeWatchUrl(record.youtube_link);
        const videoId = extractCanonicalYouTubeVideoId(canonicalYoutubeUrl);
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
      const canonicalYoutubeUrl = normalizeCanonicalYouTubeWatchUrl(record.youtube_link);
      const videoId = extractCanonicalYouTubeVideoId(canonicalYoutubeUrl);
      if (videoId && !thumbnailDataRef.current[videoId] && !loadingThumbnailsRef.current.has(videoId)) {
        loadThumbnail(videoId);
      }
    });
  }, [records, loadThumbnail]);

  const mobileControls = (
    <div className="sticky top-0 z-30 -mx-2 bg-background/95 px-2 pb-2 pt-1 backdrop-blur lg:hidden">
      <div className="space-y-2 bg-transparent p-0 shadow-none" data-admin-evaluation-mobile-controls="borderless" data-layout-primitives="stack wrap-row">
        <div
          className="grid grid-cols-3 gap-1.5"
          data-admin-evaluation-mobile-status-filter="true"
          data-admin-evaluation-mobile-toolbar="two-row"
        >
          {MOBILE_STATUS_QUICK_FILTERS.map((filter) => {
            const isActive = currentStatusFilter === filter.value;
            return (
              <Button
                key={filter.label}
                type="button"
                variant={isActive ? "default" : "outline"}
                size="sm"
                aria-label={`상태 필터: ${filter.label}`}
                aria-pressed={isActive}
                data-admin-evaluation-mobile-status-filter-option={filter.value || 'all'}
                className="h-8 min-w-0 rounded-full px-2 text-xs font-medium"
                onClick={(event) => {
                  event.stopPropagation();
                  handleMobileStatusQuickFilterChange(filter.value);
                }}
              >
                {filter.label}
              </Button>
            );
          })}
        </div>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            aria-label="상호·영상 ID 검색"
            placeholder="상호·영상 ID 검색..."
            value={searchQuery}
            onChange={(e) => onSearchChange?.(e.target.value)}
            className="h-9 pl-8 pr-8 text-sm"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="검색어 지우기"
              title="검색어 지우기"
              className="absolute right-0 top-1/2 h-8 w-8 -translate-y-1/2 p-0"
              onClick={() => onSearchChange?.('')}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>

        <div
          className="flex min-w-0 items-center justify-between gap-2 py-0.5"
          data-admin-evaluation-mobile-filter-actions="true"
          data-layout-primitives="cluster"
        >
          <div className="min-w-0 truncate px-0.5 text-xs text-muted-foreground">
            <span>검수 항목</span>
            {loading && records.length === 0 ? (
              <span className="ml-1 font-medium">집계 중</span>
            ) : (
              <strong className="ml-1 text-sm font-bold text-foreground">{records.length}개</strong>
            )}
            {activeFilterCount > 0 && (
              <>
                <span className="mx-1 text-muted-foreground/60">·</span>
                <span className="font-medium">필터 {activeFilterCount}개</span>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant={showMobileAdvancedFilters ? "secondary" : "outline"}
              size="sm"
              className="h-8 rounded-full px-2.5 text-xs font-semibold"
              onClick={() => setShowMobileAdvancedFilters(prev => !prev)}
            >
              {showMobileAdvancedFilters ? '닫기' : '상세 필터'}
            </Button>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onResetFilters}
                aria-label="필터 초기화"
                title="필터 초기화"
                className="h-8 w-8 rounded-full p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="sr-only">초기화</span>
              </Button>
            )}
          </div>
        </div>

        {showMobileAdvancedFilters && (
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/35 p-2">
            {renderFilterDropdown(
              "status",
              "상태",
              "검수 항목 상태별로 필터링",
              PRIMARY_STATUS_FILTER_OPTIONS
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
                { value: 'True', label: '일치' },
                { value: 'False', label: '불일치' },
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
              "주소 확인",
              `일치 = 주소 근거와 좌표가 승인 가능한 수준으로 맞음
불일치 = 후보는 찾았지만 원본 주소·좌표 조건을 통과하지 못함
검토 = 복수 근거가 강하거나 주소는 회복됐지만 사람 확인이 필요함
실패 = 주소 후보나 좌표를 만들지 못해 원본 주소 확인이 필요함
삭제/Missing/미선택은 주소 불일치 집계에서 제외됨`,
              [
                { value: 'all', label: '전체' },
                { value: 'true', label: '일치' },
                { value: 'false_match', label: '불일치' },
                { value: 'review', label: '검토' },
                { value: 'false_geocode', label: '실패' },
              ]
            )}
            {renderFilterDropdown(
              "category_validity_TF",
              "카테고리 유효",
              FILTER_TOOLTIPS.category_validity_TF,
              [
                { value: 'all', label: '전체' },
                { value: 'True', label: '일치' },
                { value: 'False', label: '불일치' },
              ]
            )}
            {renderFilterDropdown(
              "category_TF",
              "카테고리 정합",
              FILTER_TOOLTIPS.category_TF,
              [
                { value: 'all', label: '전체' },
                { value: 'True', label: '일치' },
                { value: 'False', label: '불일치' },
              ]
            )}
          </div>
        )}
      </div>
    </div>
  );

  const loadMoreSentinel = hasMore && onLoadMore ? <div ref={loadMoreSentinelRef} className="h-8" /> : null;
  const mobileLoadingCards = (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:hidden" role="status" aria-busy="true" aria-label="맛집 검수 카드 로딩 중">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-lg border bg-card p-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-12 w-16 shrink-0 rounded-md motion-reduce:animate-none" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-4/5 rounded-full motion-reduce:animate-none" aria-hidden="true" />
              <Skeleton className="h-2.5 w-3/5 rounded-full motion-reduce:animate-none" aria-hidden="true" />
              <div className="grid grid-cols-3 gap-1.5">
                <Skeleton className="h-5 rounded-full motion-reduce:animate-none" aria-hidden="true" />
                <Skeleton className="h-5 rounded-full motion-reduce:animate-none" aria-hidden="true" />
                <Skeleton className="h-5 rounded-full motion-reduce:animate-none" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
  const desktopLoadingRows = Array.from({ length: 6 }).map((_, index) => (
    <TableRow key={`evaluation-loading-${index}`} aria-hidden="true">
      <TableCell className="sticky left-0 z-10 bg-background/95 px-2 sm:px-4">
        <Skeleton className="h-6 w-6 rounded-md motion-reduce:animate-none" aria-hidden="true" />
      </TableCell>
      <TableCell className="lg:sticky lg:left-12 lg:z-10 lg:bg-background">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-14 shrink-0 rounded-md motion-reduce:animate-none" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-4/5 rounded-full motion-reduce:animate-none" aria-hidden="true" />
            <Skeleton className="h-2.5 w-3/5 rounded-full motion-reduce:animate-none" aria-hidden="true" />
          </div>
        </div>
      </TableCell>
      {Array.from({ length: 7 }).map((__, cellIndex) => (
        <TableCell key={cellIndex} className={cn("text-center", cellIndex === 1 || cellIndex === 2 || cellIndex === 4 || cellIndex === 5 ? "hidden lg:table-cell" : undefined)}>
          <Skeleton className="mx-auto h-6 w-14 rounded-full motion-reduce:animate-none" aria-hidden="true" />
        </TableCell>
      ))}
      <TableCell className="sticky right-[120px] z-10 bg-background text-center lg:right-[160px]">
        <Skeleton className="mx-auto h-6 w-14 rounded-full motion-reduce:animate-none" aria-hidden="true" />
      </TableCell>
      <TableCell className="sticky right-0 z-10 bg-background text-center">
        <Skeleton className="mx-auto h-7 w-20 rounded-md motion-reduce:animate-none" aria-hidden="true" />
      </TableCell>
    </TableRow>
  ));

  const mobileCards = (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden">
        {records.map((record) => {
        const canonicalYoutubeUrl = normalizeCanonicalYouTubeWatchUrl(record.youtube_link);
        const videoId = extractCanonicalYouTubeVideoId(canonicalYoutubeUrl);
        const thumbnailInfo = videoId ? thumbnailData[videoId] : null;
        const isExpanded = expandedId === record.id;
        const visitValue = getMobileMetricDisplayValue(record, record.evaluation_results?.visit_authenticity?.eval_value);
        const inferenceValue = getMobileMetricDisplayValue(record, record.evaluation_results?.rb_inference_score?.eval_value);
        const groundingValue = getMobileMetricDisplayValue(record, record.evaluation_results?.rb_grounding_TF?.eval_value);
        const reviewValue = getMobileMetricDisplayValue(record, record.evaluation_results?.review_faithfulness_score?.eval_value);
        const geocodingText = getAddressConsistencyDisplayLabel(record);
        const categoryValidity = getMobileMetricDisplayValue(record, record.evaluation_results?.category_validity_TF?.eval_value);
        const categoryMatch = getMobileMetricDisplayValue(record, record.evaluation_results?.category_TF?.eval_value);

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
          { label: '주소 확인', value: geocodingText },
          { label: '카테고리 유효', value: categoryValidity },
          { label: '카테고리 정합', value: categoryMatch },
        ];
        const titleId = `admin-evaluation-mobile-title-${record.id}`;

          return (
            <article
              key={record.id}
              aria-labelledby={titleId}
              data-layout-primitives="stack frame"
              data-admin-evaluation-mobile-card="true"
              className={cn(
                "rounded-2xl border border-border/70 bg-card/95 p-3 shadow-sm",
                getMobileCardTone(record.status),
                isExpanded && "shadow-sm"
              )}
            >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="line-clamp-2 text-sm font-semibold">
                  {record.restaurant_name || record.name || '이름 없음'}
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {publishedAt} | ID {record.id.slice(0, 8)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {getStatusBadge(record.status)}
              </div>
            </div>

            <div className="mt-2 flex items-start gap-2">
              {canonicalYoutubeUrl && videoId && (
                <a
                  href={canonicalYoutubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="relative h-16 w-24 overflow-hidden rounded bg-muted">
                    {thumbnailInfo?.state === 'loaded' && thumbnailInfo.url ? (
                      <NextImage
                        src={thumbnailInfo.url}
                        alt="유튜브 썸네일"
                        fill
                        unoptimized
                        sizes="96px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-muted">
                        {thumbnailInfo?.state === 'error' ? (
                          <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        ) : (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent motion-reduce:animate-none" />
                        )}
                      </div>
                    )}
                  </div>
                </a>
              )}

              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {getAdminEvaluationVideoLabel(record)}
                </p>
                {!hasAdminEvaluationYoutubeTitle(record) && (
                  <p className="mt-1 text-[11px] text-amber-700">제목 없음 · 메타 백필 필요</p>
                )}
                {canonicalYoutubeUrl && (
                  <a
                    href={canonicalYoutubeUrl}
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

            <div className="-mx-1 mt-3 overflow-x-auto px-1 scrollbar-hide [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex min-w-max flex-nowrap gap-1.5">
                <Badge variant="outline" className="shrink-0 rounded-full text-[11px]">방문 {visitValue}</Badge>
                <Badge variant="outline" className="shrink-0 rounded-full text-[11px]">추론 {inferenceValue}</Badge>
                <Badge variant="outline" className="shrink-0 rounded-full text-[11px]">근거 {groundingValue}</Badge>
                <Badge variant="outline" className="shrink-0 rounded-full text-[11px]">주소 {geocodingText}</Badge>
              </div>
            </div>

            <div className="mt-3 flex flex-nowrap gap-2">
              {record.status === 'deleted' ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 w-full rounded-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestore?.(record);
                  }}
                  disabled={loading}
                >
                  <Undo2 className="mr-1 h-3.5 w-3.5" />
                  되돌리기
                </Button>
              ) : record.is_missing || record.status === 'missing' || record.is_not_selected || record.status === 'not_selected' || !record.geocoding_success ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 min-w-0 flex-1 rounded-full"
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
                    aria-label="검수 항목 삭제"
                    title="검수 항목 삭제"
                    className="h-9 w-10 rounded-full p-0"
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
                    className="h-9 min-w-0 flex-1 rounded-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      onApprove(record);
                    }}
                    disabled={loading || needsEvaluationRerun(record) || !canApproveAddressConsistencyRecord(record)}
                    title={needsEvaluationRerun(record) ? '평가값/근거 확인 후 승인하세요' : undefined}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    승인
                  </Button>
                  {onEdit && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 min-w-0 flex-1 rounded-full"
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
                    aria-label="검수 항목 삭제"
                    title="검수 항목 삭제"
                    className="h-9 w-10 rounded-full p-0"
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
              className="mt-2 h-8 w-full justify-between rounded-full bg-muted/40 px-3 text-xs"
              onClick={() => toggleExpand(record.id)}
            >
              전체 검수 정보
              {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>

            {isExpanded && (
              <div className="mt-2 space-y-2 rounded-xl bg-muted/35 p-2.5 text-[11px]">
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

                <div className="rounded-lg bg-background/70 p-2">
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

                <div className="rounded-lg bg-background/70 p-2">
                  <p className="font-semibold text-foreground">주소</p>
                  <p className="mt-1 break-all"><span className="text-muted-foreground">원본:</span> {originAddress}</p>
                  <p className="mt-1 break-all"><span className="text-muted-foreground">도로명:</span> {roadAddress}</p>
                  <p className="mt-1 break-all"><span className="text-muted-foreground">지번:</span> {jibunAddress}</p>
                </div>

                {(record.is_missing || record.status === 'not_selected' || record.db_error_message) && (
                  <div className="space-y-1 rounded-lg bg-destructive/5 p-2">
                    {record.is_missing && (
                      <p className="text-destructive">
                        누락 사유: {record.missing_message || 'restaurants 배열 누락'}
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

                <div className="rounded-lg bg-background/70 p-2">
                  <p className="font-semibold text-foreground">판정 근거</p>
                  <p className="mt-1 whitespace-pre-wrap break-all text-muted-foreground">{reasoningBasis}</p>
                </div>

                <div className="rounded-lg bg-background/70 p-2">
                  <p className="font-semibold text-foreground">쯔양 리뷰 요약</p>
                  <p className="mt-1 whitespace-pre-wrap break-all text-muted-foreground">{tzuyangReview}</p>
                </div>

                <div className="overflow-hidden rounded-lg bg-background/70">
                  <EvaluationRowDetails
                    record={record}
                    onEdit={() => onEdit?.(record)}
                  />
                </div>
              </div>
            )}
          </article>
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
      >
        {shouldRenderMobile && (
          <>
            {mobileControls}
            {loading && records.length === 0 ? (
              mobileLoadingCards
            ) : records.length > 0 ? (
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
          <Table allowHorizontalScroll horizontalScrollOwner="admin-evaluation-table">
          <TableHeader className="sticky top-0 bg-background z-20">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 sticky left-0 z-10 bg-background/95 px-2 sm:w-12 sm:px-4">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="필터 초기화"
                      title="필터 초기화"
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
                      aria-label="상호·영상 ID 검색"
                      placeholder="상호·영상 ID 검색..."
                      value={searchQuery}
                      onChange={(e) => onSearchChange?.(e.target.value)}
                      className="pl-8 pr-8 h-8 text-sm"
                    />
                    {searchQuery && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="검색어 지우기"
                        title="검색어 지우기"
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
                    { value: 'True', label: '일치' },
                    { value: 'False', label: '불일치' },
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
                  "주소 확인",
                  `일치 = 주소 근거와 좌표가 승인 가능한 수준으로 맞음
불일치 = 후보는 찾았지만 원본 주소·좌표 조건을 통과하지 못함
검토 = 복수 근거가 강하거나 주소는 회복됐지만 사람 확인이 필요함
실패 = 주소 후보나 좌표를 만들지 못해 원본 주소 확인이 필요함
삭제/Missing/미선택은 주소 불일치 집계에서 제외됨`,
                  [
                    { value: 'all', label: '전체' },
                    { value: 'true', label: '일치' },
                    { value: 'false_match', label: '불일치' },
                    { value: 'review', label: '검토' },
                    { value: 'false_geocode', label: '실패' },
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
                    { value: 'True', label: '일치' },
                    { value: 'False', label: '불일치' },
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
                    { value: 'True', label: '일치' },
                    { value: 'False', label: '불일치' },
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
                    "검수 항목 상태별로 필터링",
                    PRIMARY_STATUS_FILTER_OPTIONS
                  )
                )}
              </TableHead>
              <TableHead className="sticky right-0 z-10 min-w-[120px] bg-background text-center lg:min-w-[160px]">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && records.length === 0 ? (
              desktopLoadingRows
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="h-32 text-center text-muted-foreground">
                  표시할 데이터가 없습니다
                </TableCell>
              </TableRow>
            ) : (
              records.flatMap((record) => {
                const canonicalYoutubeUrl = normalizeCanonicalYouTubeWatchUrl(record.youtube_link);
                const videoId = extractCanonicalYouTubeVideoId(canonicalYoutubeUrl);

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

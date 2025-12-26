import React, { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
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
import { ChevronDown, ChevronUp, Check, Pause, Trash2, AlertCircle, Edit, Menu, HelpCircle, RotateCcw, Search, X, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLayout } from '@/contexts/LayoutContext';
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
  };
  onFilterChange: (key: string, value: string) => void;
  onResetFilters: () => void;
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
  deleted: { label: '삭제됨', variant: 'destructive' },
};

const getStatusBadge = (status: string) => {
  const config = STATUS_VARIANTS[status] || { label: status, variant: 'default' as const };
  return <Badge variant={config.variant} className="whitespace-nowrap">{config.label}</Badge>;
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
}: EvaluationTableProps) {
  const { isSidebarOpen } = useLayout();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const rowRefs = useRef<{ [key: string]: HTMLTableRowElement | null }>({});

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

  // 썸네일 로딩 상태와 URL을 통합 관리
  const [thumbnailData, setThumbnailData] = useState<Record<string, { state: 'loading' | 'loaded' | 'error'; url?: string }>>({});

  const loadThumbnail = useCallback((videoId: string) => {
    if (thumbnailData[videoId]?.state === 'loaded' || thumbnailData[videoId]?.state === 'error') {
      return;
    }

    setThumbnailData(prev => ({ ...prev, [videoId]: { state: 'loading' } }));

    // 가장 확실한 썸네일부터 시도: default -> hqdefault -> mqdefault -> maxresdefault
    const tryThumbnail = (quality: string) => {
      const img = new Image();
      const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;

      img.onload = () => {
        setThumbnailData(prev => ({ ...prev, [videoId]: { state: 'loaded', url: thumbnailUrl } }));
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
          setThumbnailData(prev => ({ ...prev, [videoId]: { state: 'error' } }));
        }
      };

      img.src = thumbnailUrl;
    };

    // default부터 시작 (모든 영상에 존재)
    tryThumbnail('default');
  }, [thumbnailData]);

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

  if (records.length === 0) {
    return (
      <TooltipProvider>
        <div className="border rounded-lg">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-20">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12 sticky left-0 bg-background z-10">
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
                <TableHead className="min-w-[300px] sticky left-12 bg-background z-10">
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

                <TableHead className="min-w-[80px]">
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

                <TableHead className="min-w-[90px]">
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

                <TableHead className="min-w-[80px]">
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

                <TableHead className="min-w-[90px]">
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

                <TableHead className="min-w-[90px]">
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
                <TableHead className="text-center min-w-[80px] sticky right-[180px] bg-background z-10">
                  {/* 삭제 필터 활성화 시 드롭다운 숨김 */}
                  {isDeletedFilterActive ? (
                    <div className="text-sm font-medium">상태</div>
                  ) : (
                    renderFilterDropdown(
                      "status",
                      "상태",
                      "레코드 상태별로 필터링",
                      [
                        { value: 'all', label: '전체' },
                        { value: 'pending', label: '미처리' },
                        { value: 'approved', label: '승인됨' },
                        { value: 'deleted', label: '삭제됨' },
                        { value: 'ready_for_approval', label: '승인 대기' },
                        { value: 'missing', label: 'Missing' },
                        { value: 'not_selected', label: '평가 미대상' },
                        { value: 'geocoding_failed', label: '지오코딩 실패' },
                      ]
                    )
                  )}
                </TableHead>
                <TableHead className="text-center min-w-[180px] sticky right-0 bg-background z-10">액션</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={11} className="h-32 text-center text-muted-foreground">
                  표시할 데이터가 없습니다
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <div className="h-8" />
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="border rounded-lg">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-20">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12 sticky left-0 bg-background z-10">
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
              <TableHead className="min-w-[300px] sticky left-12 bg-background z-10">
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

              <TableHead className="min-w-[80px]">
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

              <TableHead className="min-w-[90px]">
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

              <TableHead className="min-w-[80px]">
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

              <TableHead className="min-w-[90px]">
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

              <TableHead className="min-w-[90px]">
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
              <TableHead className="text-center min-w-[80px] sticky right-[180px] bg-background z-10">
                {/* 삭제 필터 활성화 시 드롭다운 숨김 */}
                {isDeletedFilterActive ? (
                  <div className="text-sm font-medium">상태</div>
                ) : (
                  renderFilterDropdown(
                    "status",
                    "상태",
                    "레코드 상태별로 필터링",
                    [
                      { value: 'all', label: '전체' },
                      { value: 'pending', label: '미처리' },
                      { value: 'approved', label: '승인됨' },
                      { value: 'deleted', label: '삭제됨' },
                      { value: 'ready_for_approval', label: '승인 대기' },
                      { value: 'missing', label: 'Missing' },
                      { value: 'not_selected', label: '평가 미대상' },
                      { value: 'geocoding_failed', label: '지오코딩 실패' },
                    ]
                  )
                )}
              </TableHead>
              <TableHead className="text-center min-w-[180px] sticky right-0 bg-background z-10">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.flatMap((record) => {
              const videoId = getYoutubeVideoId(record.youtube_link);

              // 썸네일 로딩 상태 확인 및 로드
              const thumbnailInfo = videoId ? thumbnailData[videoId] : null;
              const thumbnailState = thumbnailInfo?.state;
              const thumbnailUrl = thumbnailInfo?.url;
              if (videoId && !thumbnailState) {
                loadThumbnail(videoId);
              }

              const mainRow = (
                <TableRow
                  key={record.id}
                  className={cn("group hover:bg-muted/50 transition-colors cursor-pointer", expandedId === record.id && "bg-muted/30 border-l-4 border-l-primary")}
                  ref={(el) => {
                    if (el) rowRefs.current[record.id] = el;
                  }}
                  onClick={() => toggleExpand(record.id)}
                >
                  <TableCell className="sticky left-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(record.id);
                      }}
                    >
                      {expandedId === record.id ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </Button>
                  </TableCell>

                  <TableCell className="sticky left-12">
                    <div className="flex items-center gap-3">
                      {videoId && (
                        <a
                          href={record.youtube_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-shrink-0"
                        >
                          <div className="w-24 h-16 bg-muted rounded flex items-center justify-center hover:opacity-80 transition-opacity relative overflow-hidden">
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
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium line-clamp-2">
                          {record.youtube_meta?.title || record.youtube_link}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {new Date(record.youtube_meta?.publishedAt || record.created_at).toLocaleDateString('ko-KR')}
                        </div>
                      </div>
                    </div>
                  </TableCell>

                  {/* 평가 컬럼 값들 */}
                  <TableCell className="text-center text-sm">
                    {record.status === 'not_selected' ? '-' : (record.evaluation_results?.visit_authenticity?.eval_value ?? '-')}
                  </TableCell>

                  <TableCell className="text-center text-sm">
                    {record.status === 'not_selected' ? '-' : (record.evaluation_results?.rb_inference_score?.eval_value ?? '-')}
                  </TableCell>

                  <TableCell className="text-center text-sm">
                    {record.status === 'not_selected' ? '-' : (record.evaluation_results?.rb_grounding_TF?.eval_value !== undefined
                      ? (record.evaluation_results.rb_grounding_TF.eval_value
                        ? <Badge variant="default" className="bg-green-600">True</Badge>
                        : <Badge variant="destructive">False</Badge>)
                      : '-')}
                  </TableCell>

                  <TableCell className="text-center text-sm">
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

                  <TableCell className="text-center text-sm">
                    {record.status === 'not_selected' ? '-' : (record.evaluation_results?.category_validity_TF?.eval_value !== undefined
                      ? (record.evaluation_results.category_validity_TF.eval_value
                        ? <Badge variant="default" className="bg-green-600">True</Badge>
                        : <Badge variant="destructive">False</Badge>)
                      : '-')}
                  </TableCell>

                  <TableCell className="text-center text-sm">
                    {record.status === 'not_selected' ? '-' : (record.evaluation_results?.category_TF?.eval_value !== undefined
                      ? (record.evaluation_results.category_TF.eval_value
                        ? <Badge variant="default" className="bg-green-600">True</Badge>
                        : <Badge variant="destructive">False</Badge>)
                      : '-')}
                  </TableCell>

                  {/* 고정 컬럼: 상태 */}
                  <TableCell className="text-center sticky right-[180px]">
                    {getStatusBadge(record.status)}
                  </TableCell>

                  {/* 고정 컬럼: 액션 */}
                  <TableCell className="sticky right-0">
                    <div className="flex gap-2 justify-center">
                      {record.status === 'deleted' ? (
                        // 삭제된 레코드 - 되돌리기 버튼만 표시
                        <>
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRestore?.(record);
                            }}
                            disabled={loading}
                            className="bg-blue-600 hover:bg-blue-700"
                          >
                            <Undo2 className="w-4 h-4 mr-1" />
                            되돌리기
                          </Button>
                        </>
                      ) : record.is_missing || record.is_not_selected || !record.geocoding_success ? (
                        // 지오코딩 실패한 케이스 (Missing, 평가 미대상, 지오코딩 실패)
                        <>
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEdit?.(record);
                            }}
                            disabled={loading}
                            variant="outline"
                          >
                            <Edit className="w-4 h-4 mr-1" />
                            수정
                          </Button>

                          <Button
                            size="sm"
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
                            onClick={(e) => {
                              e.stopPropagation();
                              onApprove(record);
                            }}
                            disabled={loading || !canApprove(record)}
                          >
                            <Check className="w-4 h-4 mr-1" />
                            승인
                          </Button>

                          {onEdit && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                onEdit(record);
                              }}
                              disabled={loading}
                            >
                              <Edit className="w-4 h-4 mr-1" />
                              수정
                            </Button>
                          )}

                          <Button
                            size="sm"
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
                      <div className="text-xs text-destructive mt-1 text-center flex items-center justify-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        지오코딩 실패
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );

              const detailRow = expandedId === record.id ? (
                <TableRow key={`${record.id}-details`}>
                  <TableCell colSpan={11} className="p-0 border-0 bg-muted/30">
                    <div
                      className="sticky left-0 z-10"
                      style={{
                        width: `calc(100vw - ${isSidebarOpen ? '16rem' : '4rem'} - 3rem)`, // 사이드바 너비(16rem/4rem) + 여백(3rem) 제외
                      }}
                    >
                      <EvaluationRowDetails
                        record={record}
                        onEdit={() => onEdit?.(record)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ) : null;

              return detailRow ? [mainRow, detailRow] : [mainRow];
            })}
          </TableBody>
        </Table>
        <div className="h-8" /> {/* 마지막 레코드가 잘리지 않도록 충분한 하단 여백 */}
      </div>
    </TooltipProvider>
  );
}


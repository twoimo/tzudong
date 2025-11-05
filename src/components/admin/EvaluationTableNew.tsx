import { useState } from 'react';
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
import { ChevronDown, ChevronUp, Check, Pause, Trash2, AlertCircle, Edit, Menu, HelpCircle, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EvaluationRowDetails } from './EvaluationRowDetails';

interface EvaluationTableProps {
  records: EvaluationRecord[];
  onApprove: (record: EvaluationRecord) => void;
  onHold: (record: EvaluationRecord) => void;
  onDelete: (record: EvaluationRecord) => void;
  onRegisterMissing?: (record: EvaluationRecord) => void;
  onResolveConflict?: (record: EvaluationRecord) => void;
  onEdit?: (record: EvaluationRecord) => void;
  loading?: boolean;
  evalFilters: {
    visit_authenticity?: string;
    rb_inference_score?: string;
    rb_grounding_TF?: string;
    review_faithfulness_score?: string;
    location_match_TF?: string;
    category_validity_TF?: string;
    category_TF?: string;
  };
  onFilterChange: (key: string, value: string) => void;
  onResetFilters: () => void;
}

const FILTER_TOOLTIPS = {
  visit_authenticity: `0점 = 영상과 무관 (데이터가 허구)
1점 = 음식점(매장)이 맞으며, 직접 방문했고 지점명까지 명확
2점 = 음식점(매장)이 맞으며, 직접 방문은 맞지만 지점명 특정 불명확
3점 = 음식점을 방문하지 않고, 해당 음식점의 음식 포장/배달
4점 = 언급만 하거나(매장 안 감), 음식점(매장)이 아님`,
  
  rb_inference_score: `0점 = 논리적 비약 있음 / 현장 증거 없이 단순 검색·추측으로 특정
1점 = '방문 지역 언급 → 간판/편집자막 확인 → 음식점 특정' 순서로 자연스럽게 이어짐
2점 = 영상 내 여러 시각정보와 음성정보, 검색정보를 조합하여 논리적으로 특정`,
  
  rb_grounding_TF: `True = reasoning_basis에 나온 근거 요소가 실제 영상에서 확인 가능
False = 핵심 근거(매장 위치나 간판 확인 등)가 영상에서 전혀 확인 안 됨`,
  
  review_faithfulness_score: `0점 = 과장/없는 말 지어냄, 위험하게 틀림
1점 = 실제 멘트 기반으로 충실하게 요약됨, 큰 누락 없음`,
  
  location_match_TF: `True = 지번주소 일치 또는 거리 30m 이내로 매칭 성공
False = 네이버 지도 API와 지오코딩으로 위치 매칭 실패
geocoding_failed = 지오코딩 자체가 실패`,
  
  category_validity_TF: `True = category가 유효 카테고리 목록에 포함되고 null이 아님
False = category가 목록에 없거나 null`,
  
  category_TF: `True = 영상에서 음식들, 메뉴판 등을 확인했을 때 기존 category값이 적절함
False = 영상에서 음식들, 메뉴판 등을 확인했을 때 기존 category값을 수용할 수 없음`
};

export function EvaluationTable({
  records,
  onApprove,
  onHold,
  onDelete,
  onRegisterMissing,
  onResolveConflict,
  onEdit,
  loading,
  evalFilters,
  onFilterChange,
  onResetFilters,
}: EvaluationTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  // 필터가 적용되어 있는지 확인
  const hasActiveFilters = Object.values(evalFilters).some(value => value !== undefined && value !== '');

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; variant: any }> = {
      pending: { label: '미처리', variant: 'secondary' },
      approved: { label: '승인됨', variant: 'default' },
      hold: { label: '보류', variant: 'outline' },
      missing: { label: 'Missing', variant: 'destructive' },
      db_conflict: { label: 'DB 충돌', variant: 'destructive' },
      geocoding_failed: { label: '지오코딩 실패', variant: 'destructive' },
    };

    const config = variants[status] || { label: status, variant: 'default' };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getYoutubeVideoId = (url: string) => {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  };

  const getThumbnailUrl = (youtubeLink: string) => {
    const videoId = getYoutubeVideoId(youtubeLink);
    return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
  };

  const canApprove = (record: EvaluationRecord) => {
    return record.geocoding_success && 
           record.status !== 'missing' && 
           record.status !== 'approved';
  };

  const FilterDropdown = ({ 
    filterKey, 
    label, 
    options, 
    tooltip 
  }: { 
    filterKey: string; 
    label: string; 
    options: { value: string; label: string }[];
    tooltip: string;
  }) => {
    const isActive = evalFilters[filterKey as keyof typeof evalFilters] !== undefined && 
                     evalFilters[filterKey as keyof typeof evalFilters] !== '';
    
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
                  evalFilters[filterKey as keyof typeof evalFilters] === option.value ||
                  (!evalFilters[filterKey as keyof typeof evalFilters] && option.value === 'all')
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
  };

  if (records.length === 0) {
    return (
      <TooltipProvider>
        <div className="border rounded-lg overflow-auto h-full">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-20">
              <TableRow>
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
                <TableHead className="min-w-[350px] sticky left-12 bg-background z-10">영상 정보</TableHead>
                
                {/* 평가 컬럼들 */}
                <TableHead className="min-w-[120px]">
                  <FilterDropdown
                    filterKey="visit_authenticity"
                    label="방문 여부 정확성"
                    tooltip={FILTER_TOOLTIPS.visit_authenticity}
                    options={[
                      { value: 'all', label: '모두' },
                      { value: '0', label: '0점' },
                      { value: '1', label: '1점' },
                      { value: '2', label: '2점' },
                      { value: '3', label: '3점' },
                      { value: '4', label: '4점' },
                    ]}
                  />
                </TableHead>
                
                <TableHead className="min-w-[100px]">
                  <FilterDropdown
                    filterKey="rb_inference_score"
                    label="추론 합리성"
                    tooltip={FILTER_TOOLTIPS.rb_inference_score}
                    options={[
                      { value: 'all', label: '모두' },
                      { value: '0', label: '0점' },
                      { value: '1', label: '1점' },
                      { value: '2', label: '2점' },
                    ]}
                  />
                </TableHead>
                
                <TableHead className="min-w-[120px]">
                  <FilterDropdown
                    filterKey="rb_grounding_TF"
                    label="실제 근거 일치도"
                    tooltip={FILTER_TOOLTIPS.rb_grounding_TF}
                    options={[
                      { value: 'all', label: '모두' },
                      { value: 'True', label: 'True' },
                      { value: 'False', label: 'False' },
                    ]}
                  />
                </TableHead>
                
                <TableHead className="min-w-[100px]">
                  <FilterDropdown
                    filterKey="review_faithfulness_score"
                    label="리뷰 충실도"
                    tooltip={FILTER_TOOLTIPS.review_faithfulness_score}
                    options={[
                      { value: 'all', label: '모두' },
                      { value: '0', label: '0점' },
                      { value: '1', label: '1점' },
                    ]}
                  />
                </TableHead>
                
                <TableHead className="min-w-[100px]">
                  <FilterDropdown
                    filterKey="location_match_TF"
                    label="주소 정합성"
                    tooltip={FILTER_TOOLTIPS.location_match_TF}
                    options={[
                      { value: 'all', label: '모두' },
                      { value: 'True', label: 'True' },
                      { value: 'False', label: 'False' },
                      { value: 'geocoding_failed', label: 'Failed' },
                    ]}
                  />
                </TableHead>
                
                <TableHead className="min-w-[120px]">
                  <FilterDropdown
                    filterKey="category_validity_TF"
                    label="카테고리 유효성"
                    tooltip={FILTER_TOOLTIPS.category_validity_TF}
                    options={[
                      { value: 'all', label: '모두' },
                      { value: 'True', label: 'True' },
                      { value: 'False', label: 'False' },
                    ]}
                  />
                </TableHead>
                
                <TableHead className="min-w-[120px]">
                  <FilterDropdown
                    filterKey="category_TF"
                    label="카테고리 정합성"
                    tooltip={FILTER_TOOLTIPS.category_TF}
                    options={[
                      { value: 'all', label: '모두' },
                      { value: 'True', label: 'True' },
                      { value: 'False', label: 'False' },
                    ]}
                  />
                </TableHead>
                
                {/* 고정 컬럼 */}
                <TableHead className="text-center min-w-[100px] sticky right-[250px] bg-background z-10">상태</TableHead>
                <TableHead className="text-center min-w-[250px] sticky right-0 bg-background z-10">액션</TableHead>
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
      <div className="border rounded-lg overflow-auto h-full">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-20">
            <TableRow>
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
              <TableHead className="min-w-[350px] sticky left-12 bg-background z-10">영상 정보</TableHead>
              
              {/* 평가 컬럼들 */}
              <TableHead className="min-w-[120px]">
                <FilterDropdown
                  filterKey="visit_authenticity"
                  label="방문 여부 정확성"
                  tooltip={FILTER_TOOLTIPS.visit_authenticity}
                  options={[
                    { value: 'all', label: '모두' },
                    { value: '0', label: '0점' },
                    { value: '1', label: '1점' },
                    { value: '2', label: '2점' },
                    { value: '3', label: '3점' },
                    { value: '4', label: '4점' },
                  ]}
                />
              </TableHead>
              
              <TableHead className="min-w-[100px]">
                <FilterDropdown
                  filterKey="rb_inference_score"
                  label="추론 합리성"
                  tooltip={FILTER_TOOLTIPS.rb_inference_score}
                  options={[
                    { value: 'all', label: '모두' },
                    { value: '0', label: '0점' },
                    { value: '1', label: '1점' },
                    { value: '2', label: '2점' },
                  ]}
                />
              </TableHead>
              
              <TableHead className="min-w-[120px]">
                <FilterDropdown
                  filterKey="rb_grounding_TF"
                  label="실제 근거 일치도"
                  tooltip={FILTER_TOOLTIPS.rb_grounding_TF}
                  options={[
                    { value: 'all', label: '모두' },
                    { value: 'True', label: 'True' },
                    { value: 'False', label: 'False' },
                  ]}
                />
              </TableHead>
              
              <TableHead className="min-w-[100px]">
                <FilterDropdown
                  filterKey="review_faithfulness_score"
                  label="리뷰 충실도"
                  tooltip={FILTER_TOOLTIPS.review_faithfulness_score}
                  options={[
                    { value: 'all', label: '모두' },
                    { value: '0', label: '0점' },
                    { value: '1', label: '1점' },
                  ]}
                />
              </TableHead>
              
              <TableHead className="min-w-[100px]">
                <FilterDropdown
                  filterKey="location_match_TF"
                  label="주소 정합성"
                  tooltip={FILTER_TOOLTIPS.location_match_TF}
                  options={[
                    { value: 'all', label: '모두' },
                    { value: 'True', label: 'True' },
                    { value: 'False', label: 'False' },
                    { value: 'geocoding_failed', label: 'Failed' },
                  ]}
                />
              </TableHead>
              
              <TableHead className="min-w-[120px]">
                <FilterDropdown
                  filterKey="category_validity_TF"
                  label="카테고리 유효성"
                  tooltip={FILTER_TOOLTIPS.category_validity_TF}
                  options={[
                    { value: 'all', label: '모두' },
                    { value: 'True', label: 'True' },
                    { value: 'False', label: 'False' },
                  ]}
                />
              </TableHead>
              
              <TableHead className="min-w-[120px]">
                <FilterDropdown
                  filterKey="category_TF"
                  label="카테고리 정합성"
                  tooltip={FILTER_TOOLTIPS.category_TF}
                  options={[
                    { value: 'all', label: '모두' },
                    { value: 'True', label: 'True' },
                    { value: 'False', label: 'False' },
                  ]}
                />
              </TableHead>
              
              {/* 고정 컬럼 */}
              <TableHead className="text-center min-w-[100px] sticky right-[250px] bg-background z-10">상태</TableHead>
              <TableHead className="text-center min-w-[250px] sticky right-0 bg-background z-10">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => {
              const thumbnailUrl = getThumbnailUrl(record.youtube_link);
              
              return (
                <>
                  {/* 메인 행 */}
                  <TableRow key={record.id} className="hover:bg-muted/50">
                    <TableCell className="sticky left-0 bg-background">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleExpand(record.id)}
                      >
                        {expandedId === record.id ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </Button>
                    </TableCell>
                    
                    <TableCell className="sticky left-12 bg-background">
                      <div className="flex items-center gap-3">
                        {thumbnailUrl && (
                          <a 
                            href={record.youtube_link} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex-shrink-0"
                          >
                            <img 
                              src={thumbnailUrl} 
                              alt="유튜브 썸네일"
                              className="w-24 h-16 object-cover rounded hover:opacity-80 transition-opacity"
                            />
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
                      {record.evaluation_results?.visit_authenticity?.eval_value ?? '-'}
                    </TableCell>
                    
                    <TableCell className="text-center text-sm">
                      {record.evaluation_results?.rb_inference_score?.eval_value ?? '-'}
                    </TableCell>
                    
                    <TableCell className="text-center text-sm">
                      {record.evaluation_results?.rb_grounding_TF?.eval_value !== undefined 
                        ? (record.evaluation_results.rb_grounding_TF.eval_value 
                          ? <Badge variant="default" className="bg-green-600">True</Badge>
                          : <Badge variant="destructive">False</Badge>)
                        : '-'}
                    </TableCell>
                    
                    <TableCell className="text-center text-sm">
                      {record.evaluation_results?.review_faithfulness_score?.eval_value ?? '-'}
                    </TableCell>
                    
                    <TableCell className="text-center text-sm">
                      {record.evaluation_results?.location_match_TF?.eval_value !== undefined
                        ? (typeof record.evaluation_results.location_match_TF.eval_value === 'string'
                          ? <Badge variant="outline" className="bg-yellow-100">Failed</Badge>
                          : (record.evaluation_results.location_match_TF.eval_value 
                            ? <Badge variant="default" className="bg-green-600">True</Badge>
                            : <Badge variant="destructive">False</Badge>))
                        : '-'}
                    </TableCell>
                    
                    <TableCell className="text-center text-sm">
                      {record.evaluation_results?.category_validity_TF?.eval_value !== undefined
                        ? (record.evaluation_results.category_validity_TF.eval_value 
                          ? <Badge variant="default" className="bg-green-600">True</Badge>
                          : <Badge variant="destructive">False</Badge>)
                        : '-'}
                    </TableCell>
                    
                    <TableCell className="text-center text-sm">
                      {record.evaluation_results?.category_TF?.eval_value !== undefined
                        ? (record.evaluation_results.category_TF.eval_value 
                          ? <Badge variant="default" className="bg-green-600">True</Badge>
                          : <Badge variant="destructive">False</Badge>)
                        : '-'}
                    </TableCell>
                    
                    {/* 고정 컬럼: 상태 */}
                    <TableCell className="text-center sticky right-[250px] bg-background">
                      {getStatusBadge(record.status)}
                    </TableCell>
                    
                    {/* 고정 컬럼: 액션 */}
                    <TableCell className="sticky right-0 bg-background">
                      <div className="flex gap-2 justify-center">
                        {record.status === 'missing' ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => onRegisterMissing?.(record)}
                              disabled={loading}
                              className="bg-blue-600 hover:bg-blue-700"
                            >
                              수동 등록
                            </Button>
                            
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => onDelete(record)}
                              disabled={loading}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        ) : record.status === 'db_conflict' ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => onResolveConflict?.(record)}
                              disabled={loading}
                              className="bg-yellow-600 hover:bg-yellow-700"
                            >
                              충돌 해결
                            </Button>
                            
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => onDelete(record)}
                              disabled={loading}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        ) : record.status === 'hold' ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => onEdit?.(record)}
                              disabled={loading}
                              variant="outline"
                            >
                              <Edit className="w-4 h-4 mr-1" />
                              편집
                            </Button>
                            
                            <Button
                              size="sm"
                              onClick={() => onApprove(record)}
                              disabled={loading || !canApprove(record)}
                            >
                              <Check className="w-4 h-4 mr-1" />
                              승인
                            </Button>
                            
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => onDelete(record)}
                              disabled={loading}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              onClick={() => onApprove(record)}
                              disabled={loading || !canApprove(record)}
                            >
                              <Check className="w-4 h-4 mr-1" />
                              승인
                            </Button>
                            
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onHold(record)}
                              disabled={loading}
                            >
                              <Pause className="w-4 h-4 mr-1" />
                              보류
                            </Button>
                            
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => onDelete(record)}
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

                  {/* 확장된 상세 정보 */}
                  {expandedId === record.id && (
                    <TableRow>
                      <TableCell colSpan={11} className="bg-muted/30">
                        <EvaluationRowDetails record={record} />
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })}
          </TableBody>
        </Table>
        <div className="h-8" /> {/* 마지막 레코드가 잘리지 않도록 충분한 하단 여백 */}
      </div>
    </TooltipProvider>
  );
}

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';

interface EvaluationFiltersProps {
  filters: {
    visit_authenticity?: string;
    rb_inference_score?: string;
    rb_grounding_TF?: string;
    review_faithfulness_score?: string;
    location_match_TF?: string;
    category_validity_TF?: string;
    category_TF?: string;
    category?: string;
  };
  onFilterChange: (key: string, value: string) => void;
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
False = 영상에서 음식들, 메뉴판 등을 확인했을 때 기존 category값을 수용할 수 없음`,
  
  category: '음식점의 카테고리별 필터링'
};

export function EvaluationFilters({ filters, onFilterChange }: EvaluationFiltersProps) {
  return (
    <TooltipProvider>
      <div className="bg-card p-4 rounded-lg border">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
          {/* 1. 방문 여부 정확성 (0-4점) */}
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label className="text-xs font-medium">카테고리</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">
                  <p className="whitespace-pre-line text-xs">{FILTER_TOOLTIPS.category}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          <Select
            value={filters.visit_authenticity || 'all'}
            onValueChange={(value) => onFilterChange('visit_authenticity', value === 'all' ? '' : value)}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="모두" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모두</SelectItem>
              <SelectItem value="0">0점</SelectItem>
              <SelectItem value="1">1점</SelectItem>
              <SelectItem value="2">2점</SelectItem>
              <SelectItem value="3">3점</SelectItem>
              <SelectItem value="4">4점</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 2. reasoning_basis 추론 합리성 (0-2점) */}
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Label className="text-xs font-medium">추론 합리성</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="w-3.5 h-3.5 text-muted-foreground " />
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <p className="whitespace-pre-line text-xs">{FILTER_TOOLTIPS.rb_inference_score}</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <Select
            value={filters.rb_inference_score || 'all'}
            onValueChange={(value) => onFilterChange('rb_inference_score', value === 'all' ? '' : value)}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="모두" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모두</SelectItem>
              <SelectItem value="0">0점</SelectItem>
              <SelectItem value="1">1점</SelectItem>
              <SelectItem value="2">2점</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 3. reasoning_basis 실제 근거 일치도 (True/False) */}
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Label className="text-xs font-medium">실제 근거 일치도</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="w-3.5 h-3.5 text-muted-foreground " />
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <p className="whitespace-pre-line text-xs">{FILTER_TOOLTIPS.rb_grounding_TF}</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <Select
            value={filters.rb_grounding_TF || 'all'}
            onValueChange={(value) => onFilterChange('rb_grounding_TF', value === 'all' ? '' : value)}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="모두" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모두</SelectItem>
              <SelectItem value="True">True</SelectItem>
              <SelectItem value="False">False</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 4. 음식 리뷰 충실도 (0-1점) */}
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Label className="text-xs font-medium">리뷰 충실도</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="w-3.5 h-3.5 text-muted-foreground " />
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <p className="whitespace-pre-line text-xs">{FILTER_TOOLTIPS.review_faithfulness_score}</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <Select
            value={filters.review_faithfulness_score || 'all'}
            onValueChange={(value) => onFilterChange('review_faithfulness_score', value === 'all' ? '' : value)}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="모두" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모두</SelectItem>
              <SelectItem value="0">0점</SelectItem>
              <SelectItem value="1">1점</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 5. 주소 정합성 (True/False/geocoding_failed) */}
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Label className="text-xs font-medium">주소 정합성</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="w-3.5 h-3.5 text-muted-foreground " />
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <p className="whitespace-pre-line text-xs">{FILTER_TOOLTIPS.location_match_TF}</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <Select
            value={filters.location_match_TF || 'all'}
            onValueChange={(value) => onFilterChange('location_match_TF', value === 'all' ? '' : value)}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="모두" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모두</SelectItem>
              <SelectItem value="True">True</SelectItem>
              <SelectItem value="False">False</SelectItem>
              <SelectItem value="geocoding_failed">Geocoding Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 6. 카테고리 파싱 문제 (True/False) */}
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Label className="text-xs font-medium">카테고리 유효성</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="w-3.5 h-3.5 text-muted-foreground " />
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <p className="whitespace-pre-line text-xs">{FILTER_TOOLTIPS.category_validity_TF}</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <Select
            value={filters.category_validity_TF || 'all'}
            onValueChange={(value) => onFilterChange('category_validity_TF', value === 'all' ? '' : value)}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="모두" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모두</SelectItem>
              <SelectItem value="True">True</SelectItem>
              <SelectItem value="False">False</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 7. 카테고리 정합성 (True/False) */}
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Label className="text-xs font-medium">카테고리 정합성</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="w-3.5 h-3.5 text-muted-foreground " />
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <p className="whitespace-pre-line text-xs">{FILTER_TOOLTIPS.category_TF}</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <Select
            value={filters.category_TF || 'all'}
            onValueChange={(value) => onFilterChange('category_TF', value === 'all' ? '' : value)}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="모두" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모두</SelectItem>
              <SelectItem value="True">True</SelectItem>
              <SelectItem value="False">False</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}

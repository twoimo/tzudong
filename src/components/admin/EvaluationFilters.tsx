import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface EvaluationFiltersProps {
  filters: {
    visit_authenticity?: string;
    rb_grounding_TF?: string;
    location_match_TF?: string;
    category?: string;
  };
  onFilterChange: (key: string, value: string) => void;
}

export function EvaluationFilters({ filters, onFilterChange }: EvaluationFiltersProps) {
  return (
    <Card className="p-4 mb-4">
      <div className="grid grid-cols-4 gap-4">
        <div>
          <label className="text-sm font-medium mb-2 block">방문 여부 정확성</label>
          <Select
            value={filters.visit_authenticity || 'all'}
            onValueChange={(value) => onFilterChange('visit_authenticity', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="모두" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모두</SelectItem>
              <SelectItem value="0">0점 (의심)</SelectItem>
              <SelectItem value="1">1점 (불확실)</SelectItem>
              <SelectItem value="2">2점 (명확)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-sm font-medium mb-2 block">rb 근거 일치도</label>
          <Select
            value={filters.rb_grounding_TF || 'all'}
            onValueChange={(value) => onFilterChange('rb_grounding_TF', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="모두" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모두</SelectItem>
              <SelectItem value="true">✅ True</SelectItem>
              <SelectItem value="false">❌ False</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-sm font-medium mb-2 block">주소 정합성</label>
          <Select
            value={filters.location_match_TF || 'all'}
            onValueChange={(value) => onFilterChange('location_match_TF', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="모두" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모두</SelectItem>
              <SelectItem value="true">✅ True</SelectItem>
              <SelectItem value="false">❌ False</SelectItem>
              <SelectItem value="geocoding_failed">⚠️ 지오코딩 실패</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-sm font-medium mb-2 block">카테고리</label>
          <Select
            value={filters.category || 'all'}
            onValueChange={(value) => onFilterChange('category', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="모두" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모두</SelectItem>
              <SelectItem value="치킨">치킨</SelectItem>
              <SelectItem value="중식">중식</SelectItem>
              <SelectItem value="돈까스·회">돈까스·회</SelectItem>
              <SelectItem value="피자">피자</SelectItem>
              <SelectItem value="패스트푸드">패스트푸드</SelectItem>
              <SelectItem value="찜·탕">찜·탕</SelectItem>
              <SelectItem value="족발·보쌈">족발·보쌈</SelectItem>
              <SelectItem value="분식">분식</SelectItem>
              <SelectItem value="카페·디저트">카페·디저트</SelectItem>
              <SelectItem value="한식">한식</SelectItem>
              <SelectItem value="고기">고기</SelectItem>
              <SelectItem value="양식">양식</SelectItem>
              <SelectItem value="아시안">아시안</SelectItem>
              <SelectItem value="야식">야식</SelectItem>
              <SelectItem value="도시락">도시락</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </Card>
  );
}

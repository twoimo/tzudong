import { useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { REGIONS, Region, Restaurant } from "@/types/restaurant";
import { MapPin } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { mergeRestaurants } from "@/hooks/use-restaurants";
import { fetchSupabaseRows } from "@/lib/supabase-rest-client";

interface RegionSelectorProps {
  selectedRegion: Region | null;
  onRegionChange: (region: Region | null) => void;
  onRegionSelect?: (region: Region | null) => void; // 그리드 모드에서 지역 선택 시 호출
  className?: string;
  contentSide?: "top" | "right" | "bottom" | "left";
  contentAlign?: "start" | "center" | "end";
  contentClassName?: string;
}

const RegionSelector = ({
  selectedRegion,
  onRegionChange,
  onRegionSelect,
  className,
  contentSide = "bottom",
  contentAlign = "start",
  contentClassName
}: RegionSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);

  // 모든 맛집 데이터 가져오기 (병합 로직 적용을 위해 전체 데이터 필요)
  const { data: restaurants = [] } = useQuery({
    queryKey: ['restaurants-count'],
    queryFn: async () => {
      try {
        const data = await fetchSupabaseRows<Restaurant>('restaurants', [
          ['select', 'id, name:approved_name, approved_name, road_address, jibun_address, english_address, categories, status, review_count'],
          ['status', 'eq.approved'],
        ]);

        // 병합 로직 적용하여 중복 제거
        return mergeRestaurants(data || []);
      } catch (error) {
        console.error('맛집 데이터 조회 실패:', error);
        return [];
      }
    },
    enabled: true,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // 지역별 맛집 수 계산 (병합된 데이터 기준)
  const regionCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    // 특수 지역 키워드 매핑 (욕지도/울릉도는 상위 지역보다 먼저 체크해야 함)
    const specialRegions: Record<string, string> = {
      '울릉도': '울릉',
      '욕지도': '욕지'
    };

    restaurants.forEach((restaurant) => {
      const address = restaurant.road_address || restaurant.jibun_address || '';

      // 1. 특수 지역 먼저 체크 (욕지도, 울릉도)
      let matched = false;
      for (const [region, keyword] of Object.entries(specialRegions)) {
        if (address.includes(keyword)) {
          counts[region] = (counts[region] || 0) + 1;
          matched = true;
          break;
        }
      }

      // 2. 특수 지역에 매칭되지 않았으면 일반 지역 체크
      if (!matched) {
        for (const region of REGIONS) {
          // 특수 지역은 이미 위에서 처리했으니 스킵
          if (region in specialRegions) continue;

          if (address.includes(region)) {
            counts[region] = (counts[region] || 0) + 1;
            break;
          }
        }
      }
    });

    return counts;
  }, [restaurants]);

  // 전체 맛집 수 (병합된 데이터 기준)
  const totalCount = restaurants.length;

  const handleRegionChange = (value: string) => {
    const newRegion = value === "all" ? null : (value as Region);

    // 그리드 모드에서 지역 선택 시 단일 지도로 전환하고 지역 변경
    if (onRegionSelect) {
      onRegionSelect(newRegion);
    } else {
      onRegionChange(newRegion);
    }
  };

  return (
    <Select value={selectedRegion || "all"} onValueChange={handleRegionChange} open={isOpen} onOpenChange={setIsOpen}>
      <SelectTrigger
        aria-label="지역 필터"
        className={`w-full min-w-0 sm:w-[200px] ${className}`}
      >
        <div className="flex min-w-max items-center gap-2 whitespace-nowrap">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <SelectValue placeholder="지역을 선택하세요" />
        </div>
      </SelectTrigger>
      <SelectContent
        side={contentSide}
        align={contentAlign}
        className={`z-[180] max-h-[min(24rem,calc(100dvh-8rem))] rounded-2xl border-border shadow-2xl ${contentClassName ?? ""}`}
      >
        <SelectItem value="all">
          <div className="flex w-full items-center justify-between whitespace-nowrap">
            <span className="whitespace-nowrap">대한민국</span>
            <span className="ml-2 text-xs text-muted-foreground whitespace-nowrap">({totalCount}개)</span>
          </div>
        </SelectItem>
        {REGIONS.map((region) => {
          const count = regionCounts[region] || 0;
          return (
            <SelectItem key={region} value={region}>
              <div className="flex w-full items-center justify-between whitespace-nowrap">
                <span className="whitespace-nowrap">{region}</span>
                <span className="ml-2 text-xs text-muted-foreground whitespace-nowrap">({count}개)</span>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};

export default RegionSelector;

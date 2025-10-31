import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { REGIONS, Region } from "@/types/restaurant";
import { MapPin } from "lucide-react";

interface RegionSelectorProps {
  selectedRegion: Region | null;
  onRegionChange: (region: Region | null) => void;
  onRegionSelect?: (region: Region | null) => void; // 그리드 모드에서 지역 선택 시 호출
  className?: string;
}

const RegionSelector = ({ selectedRegion, onRegionChange, onRegionSelect, className }: RegionSelectorProps) => {
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
    <Select value={selectedRegion || "all"} onValueChange={handleRegionChange}>
      <SelectTrigger className={`w-[200px] ${className}`}>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <SelectValue placeholder="지역을 선택하세요" />
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">전국</SelectItem>
        {REGIONS.map((region) => (
          <SelectItem key={region} value={region}>
            {region}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export default RegionSelector;

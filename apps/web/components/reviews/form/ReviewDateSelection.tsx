import { memo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar, Clock } from "lucide-react";

interface ReviewDateSelectionProps {
    visitedDate: string;
    setVisitedDate: (date: string) => void;
    visitedTime: string;
    setVisitedTime: (time: string) => void;
    idPrefix?: string; // 인라인/다이얼로그 간 ID 충돌 방지용
}

export const ReviewDateSelection = memo(function ReviewDateSelection({
    visitedDate,
    setVisitedDate,
    visitedTime,
    setVisitedTime,
    idPrefix = "review"
}: ReviewDateSelectionProps) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-visitDate`} className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    방문 날짜 <span className="text-red-500">*</span>
                </Label>
                <Input
                    id={`${idPrefix}-visitDate`}
                    type="date"
                    value={visitedDate}
                    onChange={(e) => setVisitedDate(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                    min={new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                    enterKeyHint="next"
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-visitTime`} className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    방문 시간 <span className="text-red-500">*</span>
                </Label>
                <Input
                    id={`${idPrefix}-visitTime`}
                    type="time"
                    step="60"
                    value={visitedTime}
                    onChange={(e) => setVisitedTime(e.target.value)}
                    enterKeyHint="next"
                />
            </div>
        </div>
    );
});

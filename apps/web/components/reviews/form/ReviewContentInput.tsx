import { memo } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";

interface ReviewContentInputProps {
    content: string;
    setContent: (content: string) => void;
    idPrefix?: string;
}

export const ReviewContentInput = memo(function ReviewContentInput({
    content,
    setContent,
    idPrefix = "review"
}: ReviewContentInputProps) {
    return (
        <div className="space-y-3">
            <Label htmlFor={`${idPrefix}-content`}>
                리뷰 내용 <span className="text-red-500">*</span>
            </Label>

            <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 p-3">
                <div className="space-y-1 text-xs text-blue-900 dark:text-blue-100">
                    <p className="font-semibold flex items-center gap-1">
                        💡 작성 가이드
                    </p>
                    <ul className="space-y-0.5 ml-4 list-disc text-blue-700 dark:text-blue-300">
                        <li>어떤 메뉴를 드셨나요?</li>
                        <li>맛은 어떠셨나요?</li>
                        <li>분위기나 서비스는 어땠나요?</li>
                        <li>추천하고 싶은 메뉴가 있나요?</li>
                    </ul>
                </div>
            </Card>

            <Textarea
                id={`${idPrefix}-content`}
                placeholder="맛집에 대한 솔직한 후기를 작성해주세요..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
                className="resize-none"
            />
            <div className="text-right text-xs text-muted-foreground">
                {content.length} / 최소 20자
            </div>
        </div>
    );
});

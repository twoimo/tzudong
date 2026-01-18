import { useState, useRef, useEffect, memo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Trash2, Image, Plus, Check } from "lucide-react";

interface ReviewVerificationUploadProps {
    photo: File | null;
    onPhotoSelect: (file: File) => void;
    onPhotoRemove: () => void;
    isAnalyzing: boolean;
}

export const ReviewVerificationUpload = memo(function ReviewVerificationUpload({
    photo,
    onPhotoSelect,
    onPhotoRemove,
    isAnalyzing
}: ReviewVerificationUploadProps) {
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    // 미리보기 URL 생성 및 정리
    useEffect(() => {
        if (!photo) {
            setPreviewUrl(null);
            return;
        }

        const url = URL.createObjectURL(photo);
        setPreviewUrl(url);

        return () => {
            URL.revokeObjectURL(url);
        };
    }, [photo]);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files);
        const imageFiles = files.filter(file => file.type.startsWith('image/'));

        if (imageFiles.length > 0) {
            onPhotoSelect(imageFiles[0]);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onPhotoSelect(file);
        }
    };

    return (
        <div className="space-y-2">
            <Label className="flex items-center gap-2">
                인증 사진 <span className="text-red-500">*</span>
            </Label>
            <Card
                className={`relative p-6 border-dashed transition-colors cursor-pointer ${isDragging
                    ? 'border-primary bg-primary/5'
                    : photo
                        ? 'border-green-300 bg-green-50/50'
                        : 'border-border hover:border-primary/50'
                    }`}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
            >
                <div className="flex flex-col items-center gap-4">
                    {photo ? (
                        <div className="w-full space-y-3">
                            <div className="flex items-center justify-center relative">
                                <div className="relative">
                                    <div className="w-20 h-20 rounded-lg overflow-hidden border-2 border-green-200">
                                        <img
                                            src={previewUrl ?? undefined}
                                            alt="인증 사진 미리보기"
                                            className="w-full h-full object-cover"
                                        />
                                    </div>
                                    <div className="absolute -top-2 -right-2 bg-green-500 text-white rounded-full p-1">
                                        <CheckCircle2 className="h-4 w-4" />
                                    </div>
                                </div>
                            </div>
                            <div className="text-center">
                                <Badge variant="default" className="gap-1 mb-2 bg-green-500">
                                    <CheckCircle2 className="h-3 w-3" />
                                    인증 사진 업로드 완료
                                </Badge>
                                <p className="text-sm font-medium">{photo.name}</p>
                                <p className="text-xs text-muted-foreground">
                                    {(photo.size / 1024 / 1024).toFixed(1)}MB
                                </p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full gap-2"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onPhotoRemove();
                                }}
                            >
                                <Trash2 className="h-4 w-4" />
                                사진 제거
                            </Button>
                        </div>
                    ) : (
                        <div className="w-full text-center space-y-3">
                            <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center transition-colors ${isDragging ? 'bg-primary/10' : 'bg-muted'
                                }`}>
                                <Image className={`h-8 w-8 transition-colors ${isDragging ? 'text-primary' : 'text-muted-foreground'
                                    }`} />
                            </div>
                            <div>
                                <p className="font-medium mb-1">
                                    {isDragging ? '여기에 사진을 놓아주세요' : '영수증 인증 사진을 업로드해주세요'}
                                </p>
                                <p className="text-sm text-muted-foreground mb-3">
                                    <span className="text-primary font-medium">AI가 가게명, 날짜, 메뉴를 자동으로 입력해드려요!</span>
                                </p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-2"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        fileInputRef.current?.click();
                                    }}
                                >
                                    <Plus className="h-4 w-4" />
                                    사진 선택
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />

                {/* AI 분석 로딩 오버레이 (카드 전체 덮음) */}
                {isAnalyzing && (
                    <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 rounded-xl border border-primary/20">
                        <div className="relative mb-4">
                            <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
                            <div className="relative bg-background rounded-full p-3 border-2 border-primary shadow-lg">
                                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
                            </div>
                        </div>
                        <h3 className="text-lg font-bold text-primary mb-2">AI가 영수증을 분석하고 있어요</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                            가게명, 방문일시, 메뉴 정보를<br />자동으로 입력합니다 ✨
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3 text-green-600" />
                            <span>분석된 데이터는 AI 학습에 사용되지 않습니다</span>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
});

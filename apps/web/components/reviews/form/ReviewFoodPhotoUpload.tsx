import { useState, useRef, useEffect, memo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Upload, X as XIcon, Plus } from "lucide-react";

interface ReviewFoodPhotoUploadProps {
    photos: File[];
    onPhotosSelected: (files: File[]) => void;
    onPhotoRemove: (index: number) => void;
}

export const ReviewFoodPhotoUpload = memo(function ReviewFoodPhotoUpload({
    photos,
    onPhotosSelected,
    onPhotoRemove
}: ReviewFoodPhotoUploadProps) {
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [previewUrls, setPreviewUrls] = useState<string[]>([]);

    // 미리보기 URL 생성 및 정리
    useEffect(() => {
        const urls = photos.map(photo => URL.createObjectURL(photo));
        setPreviewUrls(urls);

        // 정리 (Cleanup)
        return () => {
            urls.forEach(url => URL.revokeObjectURL(url));
        };
    }, [photos]);

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
            onPhotosSelected(imageFiles);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            onPhotosSelected(files);
        }
        e.target.value = ''; // 재선택 가능하도록 입력 초기화
    };

    return (
        <div className="space-y-2">
            <Label className="flex items-center gap-2">
                음식 사진 (다양한 각도) <span className="text-red-500">*</span>
            </Label>

            {photos.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                    {photos.map((photo, index) => (
                        <div key={index} className="relative group">
                            <Card className="p-2 hover:shadow-md transition-shadow">
                                <div className="aspect-square rounded-lg overflow-hidden bg-muted">
                                    <img src={previewUrls[index] ?? undefined} alt={`음식 사진 ${index + 1}`} className="w-full h-full object-cover" />
                                </div>
                                <div className="mt-2 space-y-1">
                                    <p className="text-xs font-medium truncate" title={photo.name}>{photo.name}</p>
                                    <p className="text-xs text-muted-foreground">{(photo.size / 1024 / 1024).toFixed(1)}MB</p>
                                </div>
                            </Card>
                            <Button
                                variant="destructive"
                                size="icon"
                                className="absolute -top-2 -right-2 h-6 w-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                                onClick={() => onPhotoRemove(index)}
                            >
                                <XIcon className="h-3 w-3" />
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            <Card
                className={`p-6 border-dashed transition-colors cursor-pointer ${isDragging
                    ? 'border-primary bg-primary/5'
                    : photos.length > 0
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
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${isDragging ? 'bg-primary/10' : 'bg-muted'}`}>
                        <Upload className={`h-8 w-8 transition-colors ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="text-center space-y-2">
                        <p className="font-medium">
                            {isDragging ? '여기에 사진들을 놓아주세요' : '음식 사진을 업로드해주세요'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            다양한 각도에서 촬영한 사진을 드래그하거나 클릭해서 선택해주세요
                        </p>
                        <div className="flex gap-2 justify-center">
                            <Button variant="outline" size="sm" className="gap-2" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                                <Plus className="h-4 w-4" />
                                사진 추가
                            </Button>
                            {photos.length > 0 && (
                                <Badge variant="secondary" className="px-3 py-1">
                                    📷 {photos.length}장 업로드됨
                                </Badge>
                            )}
                        </div>
                    </div>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
            </Card>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs text-muted-foreground">
                <span>💡 다양한 각도의 사진을 업로드하면 더 풍부한 리뷰가 됩니다</span>
            </div>
        </div>
    );
});

import imageCompression from "browser-image-compression";

// 음식 사진용 압축 옵션 (스토리지 최적화)
const FOOD_PHOTO_OPTIONS = {
    maxSizeMB: 0.3,           // 최대 300KB
    maxWidthOrHeight: 1200,   // 최대 1200px
    fileType: "image/webp" as const,
    useWebWorker: true,
};

// 안전한 랜덤 파일명 생성 유틸리티 (한글 파일명 문제 해결)
export const generateSafeFilename = (extension: string = ".webp"): string => {
    const randomString = Math.random().toString(36).substring(2, 15);
    const timestamp = Date.now();
    return `${timestamp}_${randomString}${extension}`;
};

// 음식 사진 압축 (WebP - 스토리지 최적화)
export const compressFoodImage = async (file: File): Promise<File> => {
    try {
        const compressedBlob = await imageCompression(file, FOOD_PHOTO_OPTIONS);
        const safeFileName = generateSafeFilename(".webp");
        return new File([compressedBlob], safeFileName, { type: "image/webp" });
    } catch (error) {
        console.warn("음식 사진 압축 실패, 원본 사용:");
        return file;
    }
};

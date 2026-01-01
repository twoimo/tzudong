import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;
let isLoaded = false;

/**
 * FFmpeg 인스턴스 초기화
 */
export const loadFFmpeg = async (onProgress?: (progress: number) => void): Promise<FFmpeg> => {
    if (ffmpeg && isLoaded) {
        return ffmpeg;
    }

    ffmpeg = new FFmpeg();

    // 진행률 콜백
    if (onProgress) {
        ffmpeg.on('progress', ({ progress }) => {
            onProgress(Math.round(progress * 100));
        });
    }

    // FFmpeg.wasm 로드
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    isLoaded = true;
    return ffmpeg;
};

/**
 * 영상 압축
 * @param file 원본 영상 파일
 * @param onProgress 압축 진행률 콜백 (0-100)
 * @returns 압축된 영상 파일 (MP4)
 */
export const compressVideo = async (
    file: File,
    onProgress?: (progress: number) => void
): Promise<File> => {
    try {
        // 파일 크기 체크 (100MB 제한)
        const maxSize = 100 * 1024 * 1024;
        if (file.size > maxSize) {
            throw new Error('파일 크기가 너무 큽니다. 100MB 이하의 파일을 선택해주세요.');
        }

        // FFmpeg 로드
        const ffmpegInstance = await loadFFmpeg(onProgress);

        // 파일을 FFmpeg 파일시스템에 쓰기
        const inputName = 'input' + getExtension(file.name);
        const outputName = 'output.mp4';

        await ffmpegInstance.writeFile(inputName, await fetchFile(file));

        // 압축 실행 (더 간단한 설정)
        // -c:v libx264: H.264 코덱 사용 (더 안정적)
        // -preset fast: 빠른 인코딩
        // -crf 28: 품질 설정 (18-28 권장)
        // -vf scale=1280:-2: 최대 너비 1280px, 높이는 짝수로 자동 조정
        // -c:a aac: AAC 오디오 코덱
        await ffmpegInstance.exec([
            '-i', inputName,
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '28',
            '-vf', 'scale=1280:-2',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            outputName
        ]);

        // 압축된 파일 읽기
        const data = await ffmpegInstance.readFile(outputName);
        const blob = new Blob([data as any], { type: 'video/mp4' });
        const compressedFile = new File([blob], `${Date.now()}.mp4`, { type: 'video/mp4' });

        // 임시 파일 삭제
        try {
            await ffmpegInstance.deleteFile(inputName);
            await ffmpegInstance.deleteFile(outputName);
        } catch (cleanupError) {
            console.warn('임시 파일 삭제 실패:', cleanupError);
        }

        return compressedFile;
    } catch (error) {
        console.error('영상 압축 실패:', error);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error('영상 압축에 실패했습니다. 다른 파일을 시도해주세요.');
    }
};

/**
 * 파일 확장자 추출
 */
function getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.slice(lastDot) : '';
}

/**
 * FFmpeg 정리
 */
export const cleanupFFmpeg = () => {
    if (ffmpeg) {
        ffmpeg.terminate();
        ffmpeg = null;
        isLoaded = false;
    }
};

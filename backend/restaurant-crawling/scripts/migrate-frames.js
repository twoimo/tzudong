/**
 * 프레임 데이터 구조 마이그레이션 스크립트
 *
 * 목적:
 * 기존 `frames/{videoId}/{recollectId}/{segment}` 폴더에 직접 저장된 이미지 파일들을
 * `frames/{videoId}/{recollectId}/{segment}/{ext}/180p_legacy/` 구조로 이동하여 격리합니다.
 *
 * 이렇게 함으로써 신규 수집 로직(360p, 1.0fps 등)이 기존 파일과 충돌하지 않고
 * 새로운 폴더(`360p_1.0fps`)에 데이터를 수집할 수 있도록 합니다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 데이터 루트 디렉토리 설정 (scripts 폴더 상위의 data 폴더)
const BASE_DATA_DIR = path.resolve(__dirname, '../data');
const TARGET_CHANNEL = 'tzuyang'; // 대상 채널
const FRAMES_ROOT = path.join(BASE_DATA_DIR, TARGET_CHANNEL, 'frames');

function log(message) {
    console.log(`[Migration] ${message}`);
}

async function migrate() {
    if (!fs.existsSync(FRAMES_ROOT)) {
        log(`❌ 프레임 루트 폴더를 찾을 수 없습니다: ${FRAMES_ROOT}`);
        return;
    }

    log(`🚀 마이그레이션 시작: ${FRAMES_ROOT}`);

    const videoDirs = fs.readdirSync(FRAMES_ROOT);
    let totalMovedFiles = 0;
    let processedSegments = 0;

    for (const videoId of videoDirs) {
        const videoPath = path.join(FRAMES_ROOT, videoId);
        // .DS_Store 등 시스템 파일 무시
        if (!fs.statSync(videoPath).isDirectory()) continue;

        const recollectDirs = fs.readdirSync(videoPath);
        for (const rId of recollectDirs) {
            const recollectPath = path.join(videoPath, rId);
            if (!fs.statSync(recollectPath).isDirectory()) continue;

            const segmentDirs = fs.readdirSync(recollectPath);
            for (const segName of segmentDirs) {
                const segPath = path.join(recollectPath, segName);
                if (!fs.statSync(segPath).isDirectory()) continue;

                // 세그먼트 폴더 내의 파일 확인
                const children = fs.readdirSync(segPath);
                // 이미지 파일만 필터링 (폴더 제외)
                const imageFiles = children.filter(f => {
                    const fullPath = path.join(segPath, f);
                    return fs.statSync(fullPath).isFile() && /\.(webp|jpg|jpeg|png|bmp)$/i.test(f);
                });

                if (imageFiles.length === 0) continue;

                // 이미 구조가 변경된 경우(폴더만 있는 경우) 스킵되지만
                // 여기서는 파일이 존재하므로 레거시 데이터로 판단하고 이동 처리

                // 너무 많은 로그 방지를 위해 100개마다 로그 또는 첫 번째만 로그
                if (processedSegments % 100 === 0) {
                    log(`   📂 처리 중 (${processedSegments}+): ${videoId}/${rId}/${segName} (파일 ${imageFiles.length}개)`);
                }

                for (const file of imageFiles) {
                    const srcPath = path.join(segPath, file);
                    // 확장자 추출 (점 제외)
                    const ext = path.extname(file).substring(1).toLowerCase();

                    // 목표 폴더: segment/ext/180p_legacy
                    const targetDir = path.join(segPath, ext, '180p_legacy');

                    if (!fs.existsSync(targetDir)) {
                        fs.mkdirSync(targetDir, { recursive: true });
                    }

                    const destPath = path.join(targetDir, file);

                    try {
                        fs.renameSync(srcPath, destPath);
                        totalMovedFiles++;
                    } catch (e) {
                        console.error(`❌ 파일 이동 실패: ${srcPath} -> ${destPath}`, e);
                    }
                }
                processedSegments++;
            }
        }
    }

    log(`✅ 마이그레이션 완료!`);
    log(`   - 처리된 구간(Segment): ${processedSegments}개`);
    log(`   - 이동된 파일: ${totalMovedFiles}개`);
}

migrate().catch(e => console.error(e));

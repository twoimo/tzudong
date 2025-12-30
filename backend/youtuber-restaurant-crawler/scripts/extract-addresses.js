/**
 * 영상 description에서 주소 추출 및 Gemini AI로 맛집 정보 분석
 * 지도 URL에서 주소 추출 + 자막 기반 교차 검증
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { execSync, spawn, spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env 로드
const envPaths = [
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../.env'),
];
for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        config({ path: envPath });
        break;
    }
}

// 설정
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_BYEON || process.env.GOOGLE_API_KEY;
const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;

// 한국 시간 (KST)
function getKSTDate() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (9 * 60 * 60 * 1000));
}

function getTodayFolder() {
    const pipelineDate = process.env.PIPELINE_DATE;
    if (pipelineDate) return pipelineDate;

    const now = getKSTDate();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

// 데이터 디렉토리
const DATA_DIR = path.resolve(__dirname, '../data');
const TODAY_FOLDER = getTodayFolder();
const TODAY_PATH = path.join(DATA_DIR, TODAY_FOLDER);
const PROMPT_FILE = path.resolve(__dirname, '../prompts/extract_restaurant.txt');

// 로그 함수
function log(level, msg) {
    const time = getKSTDate().toTimeString().slice(0, 8);
    const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌', debug: '🔍' };
    console.log(`[${time}] ${icons[level] || ''} ${msg}`);
}

/**
 * 네이버 지도 URL에서 장소 정보 추출
 */
async function extractFromNaverMap(url) {
    try {
        // naver.me 단축 URL 확인
        if (url.includes('naver.me') || url.includes('kko.to')) {
            // 리다이렉트 따라가기
            const response = await fetch(url, { redirect: 'follow' });
            url = response.url;
        }

        // place.naver.com/place/{id} 형식에서 ID 추출
        const placeMatch = url.match(/place\.naver\.com\/(?:restaurant|place)\/(\d+)/);
        if (placeMatch) {
            const placeId = placeMatch[1];
            // 네이버 Place API는 공개 API가 없으므로 URL만 반환
            return { type: 'naver', placeId, url };
        }

        // map.naver.com 형식
        const mapMatch = url.match(/map\.naver\.com.*[?&](?:id|place)=(\d+)/);
        if (mapMatch) {
            return { type: 'naver', placeId: mapMatch[1], url };
        }

        return { type: 'naver', url };
    } catch (error) {
        log('warning', `네이버 지도 URL 파싱 실패: ${error.message}`);
        return { type: 'naver', url, error: error.message };
    }
}

/**
 * 구글 지도 URL에서 장소 정보 추출
 */
async function extractFromGoogleMap(url) {
    try {
        // 단축 URL 리다이렉트
        if (url.includes('goo.gl') || url.includes('maps.app.goo.gl')) {
            const response = await fetch(url, { redirect: 'follow' });
            url = response.url;
        }

        // 좌표 추출 (@lat,lng,zoom)
        const coordMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (coordMatch) {
            return {
                type: 'google',
                lat: parseFloat(coordMatch[1]),
                lng: parseFloat(coordMatch[2]),
                url
            };
        }

        // place 추출 (/place/name/)
        const placeMatch = url.match(/\/place\/([^/]+)/);
        if (placeMatch) {
            return {
                type: 'google',
                placeName: decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')),
                url
            };
        }

        return { type: 'google', url };
    } catch (error) {
        log('warning', `구글 지도 URL 파싱 실패: ${error.message}`);
        return { type: 'google', url, error: error.message };
    }
}

/**
 * 카카오 지도 URL에서 장소 정보 추출
 */
async function extractFromKakaoMap(url) {
    try {
        // 단축 URL 리다이렉트
        if (url.includes('kko.to')) {
            const response = await fetch(url, { redirect: 'follow' });
            url = response.url;
        }

        // place/{id} 형식
        const placeMatch = url.match(/map\.kakao\.com.*place\/(\d+)/);
        if (placeMatch) {
            return { type: 'kakao', placeId: placeMatch[1], url };
        }

        return { type: 'kakao', url };
    } catch (error) {
        log('warning', `카카오 지도 URL 파싱 실패: ${error.message}`);
        return { type: 'kakao', url, error: error.message };
    }
}

/**
 * 카카오 API로 주소를 좌표로 변환
 */
async function geocodeWithKakao(address) {
    if (!KAKAO_REST_API_KEY) {
        return null;
    }

    try {
        const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `KakaoAK ${KAKAO_REST_API_KEY}`
            }
        });

        const data = await response.json();

        if (data.documents && data.documents.length > 0) {
            const doc = data.documents[0];
            return {
                lat: parseFloat(doc.y),
                lng: parseFloat(doc.x),
                address: doc.address_name,
                roadAddress: doc.road_address?.address_name || null
            };
        }

        return null;
    } catch (error) {
        log('warning', `카카오 지오코딩 실패: ${error.message}`);
        return null;
    }
}

/**
 * 카카오 API로 키워드 검색
 */
async function searchPlaceWithKakao(keyword, category = null) {
    if (!KAKAO_REST_API_KEY) {
        return null;
    }

    try {
        let url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}`;
        if (category) {
            url += `&category_group_code=${category}`;
        }

        const response = await fetch(url, {
            headers: {
                'Authorization': `KakaoAK ${KAKAO_REST_API_KEY}`
            }
        });

        const data = await response.json();

        if (data.documents && data.documents.length > 0) {
            const doc = data.documents[0];
            return {
                name: doc.place_name,
                lat: parseFloat(doc.y),
                lng: parseFloat(doc.x),
                address: doc.address_name,
                roadAddress: doc.road_address_name || null,
                phone: doc.phone || null,
                category: doc.category_name
            };
        }

        return null;
    } catch (error) {
        log('warning', `카카오 장소 검색 실패: ${error.message}`);
        return null;
    }
}

/**
 * YouTube 자막 가져오기 (여러 방법 시도)
 * 1차: youtube-transcript 패키지
 * 2차: fetch로 직접 YouTube 자막 API 호출
 */
async function getTranscript(videoId) {
    // 1차: youtube-transcript 패키지 사용
    try {
        const { YoutubeTranscript } = await import('youtube-transcript');
        const transcript = await YoutubeTranscript.fetchTranscript(videoId);

        // 자막을 텍스트로 변환
        const text = transcript.map(item => {
            const minutes = Math.floor(item.offset / 60000);
            const seconds = Math.floor((item.offset % 60000) / 1000);
            return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}] ${item.text}`;
        }).join('\n');

        log('debug', `자막 수집 성공 (youtube-transcript): ${transcript.length}개 세그먼트`);
        return text;
    } catch (error) {
        log('debug', `자막 가져오기 실패: ${error.message}`);
    }

    // 2차: 다른 방법들은 추후 추가 (Puppeteer 필요)
    // 현재는 자막 없이도 description 기반으로 분석 진행
    return null;
}

/**
 * 임시 파일 정리 헬퍼
 */
function cleanupTempFiles(...files) {
    for (const file of files) {
        try {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        } catch (e) {
            // 무시
        }
    }
}

/**
 * Gemini CLI로 맛집 정보 추출
 * 여러 모델을 순차적으로 시도 (fallback 지원)
 */
async function extractWithGemini(video, transcript) {
    // 프롬프트 템플릿 로드
    let promptTemplate = fs.readFileSync(PROMPT_FILE, 'utf-8');

    // 플레이스홀더 치환
    promptTemplate = promptTemplate
        .replace('<유튜브_링크>', video.youtube_link)
        .replace('<영상_제목>', video.title)
        .replace('<영상_설명>', video.description)
        .replace('<자막>', transcript || '(자막 없음)');

    // 임시 파일에 프롬프트 저장
    const tempPromptFile = path.join(TODAY_PATH, `temp_prompt_${video.videoId}.txt`);
    const tempOutputFile = path.join(TODAY_PATH, `temp_output_${video.videoId}.json`);

    fs.writeFileSync(tempPromptFile, promptTemplate, 'utf-8');

    // 시도할 모델 목록 (우선순위 순)
    const modelsToTry = [
        process.env.GEMINI_MODEL || 'gemini-3.0-pro',
        'gemini-3.0-flash',
        'gemini-3.0-pro-preview',
        'gemini-3.0-flash-preview'
    ];

    let lastError = null;
    let result = null;

    try {
        for (let i = 0; i < modelsToTry.length; i++) {
            const model = modelsToTry[i];
            try {
                log('debug', `Gemini 모델 시도 [${i + 1}/${modelsToTry.length}]: ${model}`);

                // Gemini CLI 호출 - bash를 통해 프롬프트 파일 전달
                // 방법 1: -p 플래그로 직접 전달 (shell=true로 확장)
                const geminiResult = spawnSync('bash', [
                    '-c',
                    `gemini -p "$(cat '${tempPromptFile}')" --output-format json --model ${model} 2>&1`
                ], {
                    encoding: 'utf-8',
                    maxBuffer: 50 * 1024 * 1024, // 50MB로 증가
                    timeout: 180000, // 3분 타임아웃
                    env: {
                        ...process.env,
                        GEMINI_API_KEY: GEMINI_API_KEY
                    }
                });

                // 에러 확인
                if (geminiResult.error) {
                    log('debug', `모델 ${model} 실행 에러: ${geminiResult.error.message}`);
                    lastError = geminiResult.error;
                    // 다음 모델 시도 전 3초 대기
                    await sleep(3000);
                    continue;
                }

                const output = geminiResult.stdout || '';
                const stderr = geminiResult.stderr || '';
                const combinedOutput = output + stderr;

                // API 오류 확인
                if (combinedOutput.includes('Error when talking to Gemini API')) {
                    // 오류 상세 내용 추출
                    const errorMatch = combinedOutput.match(/error.*?(\{[\s\S]*?\})/i);
                    log('debug', `모델 ${model} API 오류, 다음 모델 시도...`);
                    if (errorMatch) {
                        log('debug', `상세 오류: ${errorMatch[1].slice(0, 300)}`);
                    }
                    lastError = new Error(`API error with ${model}`);
                    // Rate limit 방지를 위해 5초 대기
                    await sleep(5000);
                    continue;
                }

                // exit code 확인 (0이 아니면 실패)
                if (geminiResult.status !== 0 && !output.includes('restaurants')) {
                    log('debug', `모델 ${model} 종료 코드: ${geminiResult.status}`);
                    lastError = new Error(`Exit code ${geminiResult.status} with ${model}`);
                    await sleep(3000);
                    continue;
                }

                // 결과에 에러 JSON이 포함되어 있는지 확인
                if (output.includes('"error"') && output.includes('"code"') && !output.includes('restaurants')) {
                    log('debug', `모델 ${model} 응답에 에러 포함, 다음 모델 시도...`);
                    lastError = new Error(`Response error with ${model}`);
                    await sleep(3000);
                    continue;
                }

                // JSON 파싱
                const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
                if (jsonMatch) {
                    result = JSON.parse(jsonMatch[1]);
                    log('success', `Gemini 분석 성공 (모델: ${model})`);
                    break;
                }

                // JSON 블록이 없으면 전체를 파싱 시도
                try {
                    const parsed = JSON.parse(output);
                    if (parsed && !parsed.error) {
                        result = parsed;
                        log('success', `Gemini 분석 성공 (모델: ${model})`);
                        break;
                    }
                } catch {
                    // 응답에서 JSON 부분만 추출
                    const jsonStart = output.indexOf('{');
                    const jsonEnd = output.lastIndexOf('}');
                    if (jsonStart !== -1 && jsonEnd !== -1) {
                        const extracted = output.slice(jsonStart, jsonEnd + 1);
                        try {
                            const parsed = JSON.parse(extracted);
                            if (parsed && !parsed.error) {
                                result = parsed;
                                log('success', `Gemini 분석 성공 (모델: ${model})`);
                                break;
                            }
                        } catch { }
                    }
                }

                // JSON 파싱 실패시 다음 모델 시도
                log('debug', `모델 ${model} 응답 파싱 실패, 다음 모델 시도...`);
                lastError = new Error(`Parse error with ${model}`);

            } catch (error) {
                log('debug', `모델 ${model} 실패: ${error.message}`);
                lastError = error;
                // 다음 모델 시도
                continue;
            }
        }

        // 모든 모델 실패
        if (!result) {
            log('warning', `Gemini 분석 실패 (${video.videoId}): 모든 모델 시도 실패`);
            if (lastError) {
                log('debug', `마지막 오류: ${lastError.message}`);
            }
        }

        return result;
    } finally {
        // 임시 파일 정리 (성공/실패 모두)
        cleanupTempFiles(tempPromptFile, tempOutputFile);
    }
}

/**
 * 지연 실행 (Rate Limit 방지)
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 지도 URL 정보와 Gemini 분석 결과 병합
 */
async function processVideo(video) {
    const result = {
        videoId: video.videoId,
        youtube_link: video.youtube_link,
        title: video.title,
        publishedAt: video.publishedAt,
        duration: video.duration,
        mapUrls: video.mapUrls,
        restaurants: [],
        processedAt: getKSTDate().toISOString()
    };

    // 1. 지도 URL에서 정보 추출
    for (const mapUrl of video.mapUrls) {
        let mapInfo;
        switch (mapUrl.type) {
            case 'naver':
                mapInfo = await extractFromNaverMap(mapUrl.url);
                break;
            case 'google':
                mapInfo = await extractFromGoogleMap(mapUrl.url);
                break;
            case 'kakao':
                mapInfo = await extractFromKakaoMap(mapUrl.url);
                break;
        }
        mapUrl.extractedInfo = mapInfo;
    }

    // 2. 자막 가져오기
    const transcript = await getTranscript(video.videoId);
    result.hasTranscript = !!transcript;

    // 3. Gemini로 맛집 정보 분석
    const geminiResult = await extractWithGemini(video, transcript);

    if (geminiResult && geminiResult.restaurants) {
        for (const restaurant of geminiResult.restaurants) {
            // 4. 카카오 API로 좌표 보완
            let geoInfo = null;

            if (restaurant.address) {
                geoInfo = await geocodeWithKakao(restaurant.address);
            }

            if (!geoInfo && restaurant.name) {
                // 주소로 찾지 못하면 장소명으로 검색
                geoInfo = await searchPlaceWithKakao(restaurant.name, 'FD6'); // FD6: 음식점
            }

            result.restaurants.push({
                ...restaurant,
                youtuber_name: '정육왕',
                youtuber_channel: '@meatcreator',
                youtube_link: video.youtube_link,
                video_title: video.title,
                lat: geoInfo?.lat || null,
                lng: geoInfo?.lng || null,
                geocoded_address: geoInfo?.roadAddress || geoInfo?.address || null,
                phone: geoInfo?.phone || null,
                geocoding_source: geoInfo ? 'kakao' : null
            });
        }
    }

    result.is_restaurant_video = geminiResult?.is_restaurant_video || false;
    result.video_type = geminiResult?.video_type || 'unknown';

    return result;
}

/**
 * 메인 실행
 */
async function main() {
    log('info', '='.repeat(60));
    log('info', '  맛집 정보 추출 시작');
    log('info', '='.repeat(60));

    const startTime = Date.now();

    // 입력 파일 확인
    const inputFile = path.join(TODAY_PATH, 'meatcreator_videos_with_map.jsonl');
    if (!fs.existsSync(inputFile)) {
        // 전체 영상 목록에서 지도 URL 있는 것만 필터링
        const allVideosFile = path.join(TODAY_PATH, 'meatcreator_videos.json');
        if (!fs.existsSync(allVideosFile)) {
            log('error', '영상 목록 파일이 없습니다. 먼저 crawl-channel.js를 실행하세요.');
            process.exit(1);
        }

        const allVideos = JSON.parse(fs.readFileSync(allVideosFile, 'utf-8'));
        const videosWithMap = allVideos.videos.filter(v => v.hasMapUrl);

        const content = videosWithMap.map(v => JSON.stringify(v)).join('\n');
        fs.writeFileSync(inputFile, content, 'utf-8');
        log('info', `지도 URL 포함 영상 ${videosWithMap.length}개 필터링`);
    }

    // 영상 목록 로드
    const content = fs.readFileSync(inputFile, 'utf-8');
    const videos = content.trim().split('\n').map(line => JSON.parse(line));

    log('info', `처리할 영상: ${videos.length}개`);

    // 이미 처리된 영상 체크
    const outputFile = path.join(TODAY_PATH, 'meatcreator_restaurants.jsonl');
    const processedIds = new Set();

    if (fs.existsSync(outputFile)) {
        const existingContent = fs.readFileSync(outputFile, 'utf-8');
        for (const line of existingContent.trim().split('\n')) {
            if (line) {
                try {
                    const data = JSON.parse(line);
                    processedIds.add(data.videoId);
                } catch { }
            }
        }
        log('info', `이미 처리된 영상: ${processedIds.size}개`);
    }

    // 통계
    const stats = {
        total: videos.length,
        processed: 0,
        skipped: 0,
        success: 0,
        failed: 0,
        restaurantsFound: 0
    };

    // 영상별 처리
    for (let i = 0; i < videos.length; i++) {
        const video = videos[i];

        // 이미 처리된 영상 스킵
        if (processedIds.has(video.videoId)) {
            stats.skipped++;
            continue;
        }

        log('info', `[${i + 1}/${videos.length}] 처리 중: ${video.title.slice(0, 40)}...`);

        try {
            const result = await processVideo(video);

            // 결과 저장 (append)
            fs.appendFileSync(outputFile, JSON.stringify(result) + '\n', 'utf-8');

            stats.processed++;
            stats.success++;
            stats.restaurantsFound += result.restaurants.length;

            log('success', `  → ${result.restaurants.length}개 맛집 발견`);

        } catch (error) {
            stats.failed++;
            log('error', `  → 처리 실패: ${error.message}`);
        }

        // Rate limit 대응 (Gemini: 60 RPM)
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // 결과 출력
    const duration = Date.now() - startTime;

    log('info', '');
    log('info', '='.repeat(60));
    log('success', '처리 완료');
    log('info', '='.repeat(60));
    log('info', `총 영상: ${stats.total}개`);
    log('info', `처리됨: ${stats.processed}개`);
    log('info', `스킵됨: ${stats.skipped}개 (이미 처리)`);
    log('success', `성공: ${stats.success}개`);
    log('error', `실패: ${stats.failed}개`);
    log('info', `발견된 맛집: ${stats.restaurantsFound}개`);
    log('info', `소요 시간: ${Math.round(duration / 1000)}초`);
    log('info', '='.repeat(60));
}

main();

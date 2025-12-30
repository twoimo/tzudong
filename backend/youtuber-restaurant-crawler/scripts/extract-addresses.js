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
// OAuth 인증을 사용하므로 GEMINI_API_KEY는 사용하지 않음
// GEMINI_API_KEY가 설정되어 있으면 OAuth 대신 API 키 모드를 사용하려고 해서 오류 발생
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
 * 2차: Puppeteer로 maestra.ai에서 수집
 * 3차: Puppeteer로 tubetranscript.com에서 수집
 */
async function getTranscript(videoId) {
    // 1차: youtube-transcript 패키지 사용 (가장 빠름)
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
        log('debug', `youtube-transcript 실패: ${error.message.slice(0, 50)}...`);
    }

    // 2차: Puppeteer로 maestra.ai에서 수집
    try {
        const result = await getTranscriptWithPuppeteer(videoId);
        if (result) {
            log('debug', `자막 수집 성공 (Puppeteer): ${result.segments}개 세그먼트`);
            return result.text;
        }
    } catch (error) {
        log('debug', `Puppeteer 자막 수집 실패: ${error.message}`);
    }

    // 자막 없이 description 기반으로 분석 진행
    return null;
}

// Puppeteer 인스턴스 (재사용)
let puppeteerBrowser = null;

/**
 * Puppeteer로 자막 수집 (maestra.ai → tubetranscript.com fallback)
 */
async function getTranscriptWithPuppeteer(videoId) {
    // GitHub Actions에서는 Puppeteer 사용 가능 여부 확인
    let puppeteer;
    try {
        puppeteer = await import('puppeteer');
    } catch {
        log('debug', 'Puppeteer 모듈 없음 - 스킵');
        return null;
    }

    try {
        // 브라우저 재사용
        if (!puppeteerBrowser) {
            puppeteerBrowser = await puppeteer.default.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
        }

        const page = await puppeteerBrowser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        let result = null;

        // 1차: maestra.ai 시도
        result = await collectFromMaestra(page, videoId);

        // 2차: tubetranscript.com fallback
        if (!result) {
            result = await collectFromTubeTranscript(page, videoId);
        }

        await page.close();

        if (result) {
            // 텍스트로 변환
            const text = result.transcript.map(seg => {
                const minutes = Math.floor(seg.start / 60);
                const seconds = Math.floor(seg.start % 60);
                return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}] ${seg.text}`;
            }).join('\n');

            return { text, segments: result.transcript.length, language: result.language };
        }

        return null;
    } catch (error) {
        log('debug', `Puppeteer 오류: ${error.message}`);
        return null;
    }
}

/**
 * maestra.ai에서 자막 수집
 */
async function collectFromMaestra(page, videoId) {
    const url = `https://maestra.ai/tools/video-to-text/youtube-transcript-generator?v=${videoId}`;
    const PAGE_TIMEOUT = 60000;

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

        // mode-toggle 버튼 또는 "Get Transcript" 버튼 대기 (최대 30초)
        const startTime = Date.now();
        const maxWait = 30000;

        while (Date.now() - startTime < maxWait) {
            const hasModeToggle = await page.evaluate(() => {
                return document.querySelector('button.mode-toggle') !== null;
            });

            if (hasModeToggle) break;

            // "Get Transcript" 버튼 클릭 시도
            const submitButton = await page.evaluate(() => {
                const btn = document.querySelector('input.search-button[type="submit"]');
                return btn !== null;
            });

            if (submitButton) {
                await page.click('input.search-button[type="submit"]');
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // caption 모드로 전환
        const currentMode = await page.evaluate(() => {
            const btn = document.querySelector('button.mode-toggle');
            return btn?.getAttribute('data-mode') || '';
        });

        if (currentMode !== 'caption') {
            try {
                await page.click('button.mode-toggle svg[data-icon="caption"]');
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch {
                // 무시
            }
        }

        // 자막 라인 대기 (최대 20초)
        const captionStartTime = Date.now();
        while (Date.now() - captionStartTime < 20000) {
            const count = await page.evaluate(() => {
                return document.querySelectorAll('.transcript-content samp.caption-line').length;
            });
            if (count > 0) break;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // 자막 파싱
        const transcript = await page.evaluate(() => {
            const segments = [];
            const captionLines = document.querySelectorAll('.transcript-content samp.caption-line');

            captionLines.forEach(line => {
                const textEl = line.querySelector('.caption-text');
                const dataStart = line.getAttribute('data-start');

                if (textEl) {
                    segments.push({
                        start: dataStart ? parseFloat(dataStart) : 0,
                        text: textEl.textContent?.trim() || ''
                    });
                }
            });

            return segments;
        });

        if (transcript.length === 0) return null;

        return { transcript, language: 'korean' };

    } catch (error) {
        return null;
    }
}

/**
 * tubetranscript.com에서 자막 수집 (fallback)
 */
async function collectFromTubeTranscript(page, videoId) {
    const url = `https://www.tubetranscript.com/ko/watch?v=${videoId}`;
    const PAGE_TIMEOUT = 60000;

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

        // 자막 컨테이너 대기 (최대 30초)
        const startTime = Date.now();
        while (Date.now() - startTime < 30000) {
            const hasContent = await page.evaluate(() => {
                return document.querySelector('#main-transcript-content .transcript-group-box') !== null;
            });
            if (hasContent) break;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // 자막 파싱
        const transcript = await page.evaluate(() => {
            const segments = [];
            const groups = document.querySelectorAll('#main-transcript-content .transcript-group-box');

            groups.forEach(group => {
                const timeEl = group.querySelector('.transcript-time a[target="_blank"]');
                const textEl = group.querySelector('.transcript-text');

                if (timeEl && textEl) {
                    const timeStr = timeEl.textContent?.trim() || '';
                    const parts = timeStr.split(':').map(Number);

                    let startSeconds = 0;
                    if (parts.length === 2) {
                        startSeconds = parts[0] * 60 + parts[1];
                    } else if (parts.length === 3) {
                        startSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
                    }

                    segments.push({
                        start: startSeconds,
                        text: textEl.textContent?.trim() || ''
                    });
                }
            });

            return segments;
        });

        if (transcript.length === 0) return null;

        return { transcript, language: 'korean' };

    } catch (error) {
        return null;
    }
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
        process.env.GEMINI_MODEL ||
        'gemini-3.0-pro',
        'gemini-3.0-flash',
        'gemini-3.0-pro-preview',
        'gemini-3.0-flash-preview',
        'gemini-2.5-pro',
        'gemini-2.5-flash'
    ];

    let lastError = null;
    let result = null;

    try {
        for (let i = 0; i < modelsToTry.length; i++) {
            const model = modelsToTry[i];
            try {
                log('debug', `Gemini 모델 시도 [${i + 1}/${modelsToTry.length}]: ${model}`);

                // Gemini CLI 호출 - OAuth 인증 사용
                // 중요: GEMINI_API_KEY 환경변수를 제거해야 OAuth가 작동함
                const envWithoutApiKey = { ...process.env };
                delete envWithoutApiKey.GEMINI_API_KEY;
                delete envWithoutApiKey.GEMINI_API_KEY_BYEON;
                delete envWithoutApiKey.GOOGLE_API_KEY;

                const geminiResult = spawnSync('bash', [
                    '-c',
                    `gemini -p "$(cat '${tempPromptFile}')" --output-format json --model ${model} 2>&1`
                ], {
                    encoding: 'utf-8',
                    maxBuffer: 50 * 1024 * 1024, // 50MB로 증가
                    timeout: 180000, // 3분 타임아웃
                    env: envWithoutApiKey  // API 키 없이 OAuth만 사용
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

                // JSON 파싱 (여러 방법 시도)
                let parsedResult = null;

                // 먼저 이스케이프된 문자 정리 (모든 방법에 적용)
                // 순서 중요: \\\\ → \\ 먼저, 그 다음 \\n → \n, \\" → "
                let cleanedOutput = output
                    .replace(/\\\\/g, '\\')      // \\\\ → \\
                    .replace(/\\n/g, '\n')       // \\n → 줄바꿈
                    .replace(/\\r/g, '\r')       // \\r → 캐리지리턴
                    .replace(/\\t/g, '\t')       // \\t → 탭
                    .replace(/\\"/g, '"');       // \\" → "

                // 방법 1: ```json``` 블록에서 추출
                const jsonMatch = cleanedOutput.match(/```json\s*([\s\S]*?)\s*```/);
                if (jsonMatch) {
                    try {
                        parsedResult = JSON.parse(jsonMatch[1].trim());
                        log('debug', `방법 1 성공: JSON 블록에서 추출`);
                    } catch (e) {
                        log('debug', `JSON 블록 파싱 실패: ${e.message}`);
                    }
                }

                // 방법 2: 전체 출력을 JSON으로 파싱
                if (!parsedResult) {
                    try {
                        const trimmed = cleanedOutput.trim().replace(/^\uFEFF/, '');
                        parsedResult = JSON.parse(trimmed);
                        log('debug', `방법 2 성공: 전체 출력 파싱`);
                    } catch (e) {
                        // 무시
                    }
                }

                // 방법 3: { 와 } 사이의 JSON 추출
                if (!parsedResult) {
                    const jsonStart = cleanedOutput.indexOf('{');
                    const jsonEnd = cleanedOutput.lastIndexOf('}');
                    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                        try {
                            const extracted = cleanedOutput.slice(jsonStart, jsonEnd + 1);
                            parsedResult = JSON.parse(extracted);
                            log('debug', `방법 3 성공: {와 } 사이 추출`);
                        } catch (e) {
                            // 무시
                        }
                    }
                }

                // 방법 4: 원본 output에서 { } 추출 (이스케이프 처리 없이)
                if (!parsedResult) {
                    const jsonStart = output.indexOf('{');
                    const jsonEnd = output.lastIndexOf('}');
                    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                        try {
                            const extracted = output.slice(jsonStart, jsonEnd + 1);
                            parsedResult = JSON.parse(extracted);
                            log('debug', `방법 4 성공: 원본에서 추출`);
                        } catch (e) {
                            // 무시
                        }
                    }
                }

                // 파싱 성공 확인
                if (parsedResult && !parsedResult.error) {
                    result = parsedResult;
                    // 결과 상세 로그
                    const restaurantCount = parsedResult.restaurants?.length || 0;
                    log('success', `Gemini 분석 성공 (모델: ${model})`);
                    if (restaurantCount === 0) {
                        log('debug', `파싱 결과: is_restaurant_video=${parsedResult.is_restaurant_video}, video_type=${parsedResult.video_type}`);
                        // 원본 응답 일부 출력 (디버깅용)
                        log('debug', `응답 미리보기: ${output.slice(0, 300)}...`);
                    }
                    break;
                }

                // JSON 파싱 실패시 다음 모델 시도
                log('debug', `모델 ${model} 응답 파싱 실패, 다음 모델 시도...`);
                log('debug', `응답 미리보기: ${output.slice(0, 200)}...`);
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

    // Puppeteer 브라우저 정리
    if (puppeteerBrowser) {
        try {
            await puppeteerBrowser.close();
            log('debug', 'Puppeteer 브라우저 종료');
        } catch (e) {
            // 무시
        }
    }
}

// 프로세스 종료 시 Puppeteer 정리
process.on('exit', () => {
    if (puppeteerBrowser) {
        puppeteerBrowser.close().catch(() => { });
    }
});

process.on('SIGINT', async () => {
    if (puppeteerBrowser) {
        await puppeteerBrowser.close();
    }
    process.exit(0);
});

main();

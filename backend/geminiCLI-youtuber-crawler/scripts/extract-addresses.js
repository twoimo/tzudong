/**
 * 영상 description에서 주소 추출 및 Gemini AI로 맛집 정보 분석
 * 지도 URL에서 주소 추출 + 자막 기반 교차 검증
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { execSync, spawn, spawnSync } from 'child_process';
import { recordPipelineStart } from './gemini-oauth-manager.js';

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
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

// ============================================
// Rule-Based 검증을 위한 상수 및 유틸리티
// ============================================

// 유효한 카테고리 목록 (evaluation-rule.py 참조)
const VALID_CATEGORIES = [
    "치킨", "중식", "돈까스·회", "피자", "패스트푸드", "찜·탕",
    "족발·보쌈", "분식", "카페·디저트", "한식", "고기", "양식",
    "아시안", "야식", "도시락", "일식", "해물", "베이커리"
];

// 층 정보 제거 (예: 3층, 지하1층, 지하 2층) - precompiled regex 사용
function removeFloorInfo(addr) {
    if (!addr) return addr;
    return addr
        .replace(PRECOMPILED_REGEX.floorInfo, '')
        .replace(PRECOMPILED_REGEX.floorInfoEn, '')
        .trim();
}

// 주소에서 지역명 추출 (시/구/동)
function extractRegion(addr) {
    if (!addr) return null;
    // 서울시 강남구, 경기도 성남시, 부산 해운대구 등
    const patterns = [
        /서울(?:시|특별시)?\s*(\S+구)/,
        /부산(?:시|광역시)?\s*(\S+구)/,
        /대구(?:시|광역시)?\s*(\S+구)/,
        /인천(?:시|광역시)?\s*(\S+구)/,
        /광주(?:시|광역시)?\s*(\S+구)/,
        /대전(?:시|광역시)?\s*(\S+구)/,
        /울산(?:시|광역시)?\s*(\S+구)/,
        /경기(?:도)?\s*(\S+시)/,
        /(\S+시)\s*(\S+구)/,
        /(\S+구)/
    ];

    for (const pattern of patterns) {
        const match = addr.match(pattern);
        if (match) {
            return match[1] || match[0];
        }
    }
    return null;
}

// Haversine 거리 계산 (미터 단위)
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // 지구 반지름 (m)
    const toRad = (deg) => deg * Math.PI / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// 카테고리 유효성 검증
function isValidCategory(category) {
    if (!category) return false;
    // 정확히 일치하거나 부분 포함 확인
    return VALID_CATEGORIES.some(valid =>
        category.includes(valid) || valid.includes(category)
    );
}

// 주소 핵심 추출 (건물명/상호명 제거) - precompiled regex 사용
function addressCore(addr) {
    if (!addr) return '';
    return addr
        .replace(PRECOMPILED_REGEX.parentheses, '')
        .replace(PRECOMPILED_REGEX.multiSpace, ' ')
        .replace(PRECOMPILED_REGEX.lotNumber, '')
        .trim();
}

// ============================================
// 성능 최적화: 캐싱 및 사전 컴파일
// ============================================

// API 결과 캐시 (세션 동안 유지, 메모리 효율을 위해 LRU 방식 적용)
const apiCache = {
    kakao: new Map(),
    naver: new Map(),
    maxSize: 500,  // 최대 캐시 크기

    get(type, key) {
        const cache = this[type];
        if (cache.has(key)) {
            const value = cache.get(key);
            // LRU: 최근 접근한 항목을 맨 뒤로 이동
            cache.delete(key);
            cache.set(key, value);
            return value;
        }
        return null;
    },

    set(type, key, value) {
        const cache = this[type];
        if (cache.size >= this.maxSize) {
            // 가장 오래된 항목 삭제 (첫 번째 항목)
            const firstKey = cache.keys().next().value;
            cache.delete(firstKey);
        }
        cache.set(key, value);
    }
};

// 사전 컴파일된 정규식 (반복 컴파일 방지)
const PRECOMPILED_REGEX = {
    floorInfo: /\s*(지하\s*)?(\d+)\s*층/g,
    floorInfoEn: /\s*(B?\d+F)/gi,
    parentheses: /\([^)]*\)/g,
    multiSpace: /\s+/g,
    lotNumber: /\d+-\d+번지?/g,
    phone: /[^0-9]/g,
    htmlTags: /<[^>]*>/g,
    naverPlace: /place\.naver\.com\/restaurant\/(\d+)/,
    naverMap: /map\.naver\.com.*place\/(\d+)/,
    googleCoords: /@(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    googleQuery: /[?&]q=([^&]+)/,
    quotaReset: /reset after (\d+)h(\d+)m(\d+)s/
};

// Set 기반 카테고리 조회 (O(1) 성능)
const VALID_CATEGORIES_SET = new Set(VALID_CATEGORIES);

// 빠른 카테고리 검증 (Set 사용)
function isValidCategoryFast(category) {
    if (!category) return false;
    if (VALID_CATEGORIES_SET.has(category)) return true;
    // 부분 매칭도 지원
    for (const valid of VALID_CATEGORIES_SET) {
        if (category.includes(valid) || valid.includes(category)) return true;
    }
    return false;
}

// ============================================

// 실패한 모델 블랙리스트 (세션 동안 유지)
// Map: model -> { resetTime: Date timestamp, reason: string }
const blacklistedModels = new Map();

// 블랙리스트 헬퍼 함수
function isModelBlacklisted(model) {
    if (!blacklistedModels.has(model)) return false;
    const info = blacklistedModels.get(model);
    // 리셋 시간이 지났으면 블랙리스트에서 제거
    if (info.resetTime && Date.now() >= info.resetTime) {
        blacklistedModels.delete(model);
        return false;
    }
    return true;
}

function getEarliestResetTime() {
    let earliest = null;
    for (const [model, info] of blacklistedModels) {
        if (info.resetTime) {
            if (!earliest || info.resetTime < earliest) {
                earliest = info.resetTime;
            }
        }
    }
    return earliest;
}

/**
 * 스크립트 시작 시 각 모델의 쿼타 상태를 사전 확인
 * "gemini -p 1+1 --model X" 명령어로 테스트
 */
async function checkModelQuotas() {
    // GitHub Actions에서는 pro만, 로컬에서는 flash만 사용
    const isGitHubActions = !!process.env.GITHUB_ACTIONS;
    const models = isGitHubActions
        ? ['gemini-3-pro-preview']      // GitHub Actions: pro만
        : ['gemini-3-flash-preview'];   // 로컬: flash만
    log('info', `모델 쿼타 상태 확인 중... (${isGitHubActions ? 'GitHub Actions' : '로컬'} 환경)`);

    for (const model of models) {
        try {
            const envWithoutApiKey = { ...process.env };
            delete envWithoutApiKey.GEMINI_API_KEY;
            delete envWithoutApiKey.GEMINI_API_KEY_BYEON;
            delete envWithoutApiKey.GOOGLE_API_KEY;

            const result = spawnSync('bash', [
                '-c',
                `gemini -p "1+1" --model ${model} 2>&1`
            ], {
                encoding: 'utf-8',
                timeout: 120000,
                env: envWithoutApiKey
            });

            const output = result.stdout || '';

            if (output.includes('exhausted your daily quota') ||
                output.includes('exhausted your capacity') ||
                output.includes('quota')) {

                // 리셋 시간 파싱 (reset after 1h20m30s)
                const resetMatch = output.match(/reset after (\d+)h(\d+)m(\d+)s/);
                let waitMs = 10 * 60 * 1000; // 기본 10분 후 재확인 (파싱 실패 시)

                if (resetMatch) {
                    const h = parseInt(resetMatch[1]);
                    const m = parseInt(resetMatch[2]);
                    const s = parseInt(resetMatch[3]);
                    waitMs = (h * 3600 + m * 60 + s) * 1000;
                    log('warning', `  ${model}: 쿼타 소진 - ${h}시간 ${m}분 ${s}초 후 리셋`);
                } else {
                    log('warning', `  ${model}: 쿼타 소진 - 10분 후 재확인`);
                }

                const resetTime = Date.now() + waitMs;

                const waitHours = Math.floor(waitMs / 3600000);
                const waitMins = Math.ceil((waitMs % 3600000) / 60000);

                blacklistedModels.set(model, {
                    resetTime,
                    reason: 'daily_quota'
                });

                log('warning', `  ${model}: 일일 쿼타 소진 (리셋까지 ${waitHours}시간 ${waitMins}분)`);
            } else if (output.includes('2') || !result.error) {
                log('success', `  ${model}: 사용 가능`);
            } else {
                log('warning', `  ${model}: 알 수 없는 상태`);
            }
        } catch (error) {
            log('warning', `  ${model}: 확인 실패 - ${error.message}`);
        }
    }

    // 사용 가능한 모델 수 확인
    let availableCount = models.filter(m => !isModelBlacklisted(m)).length;
    log('info', `사용 가능한 모델: ${availableCount}/${models.length}개`);

    if (availableCount === 0) {
        // 쿼타 소진으로 모든 모델이 블랙리스트일 때, 실제 쿼타 상태 재확인
        log('info', '블랙리스트 초기화 후 실제 쿼타 상태 재확인 중...');

        // 블랙리스트 초기화
        blacklistedModels.clear();

        // 실제 Gemini CLI로 테스트
        for (const model of models) {
            try {
                const envWithoutApiKey = { ...process.env };
                delete envWithoutApiKey.GEMINI_API_KEY;
                delete envWithoutApiKey.GEMINI_API_KEY_BYEON;
                delete envWithoutApiKey.GOOGLE_API_KEY;

                const result = spawnSync('bash', [
                    '-c',
                    `gemini -p "1+1" --model ${model} 2>&1`
                ], {
                    encoding: 'utf-8',
                    timeout: 60000,
                    env: envWithoutApiKey
                });

                const output = result.stdout || '';

                if (output.includes('exhausted your daily quota') ||
                    output.includes('exhausted your capacity') ||
                    output.includes('RESOURCE_EXHAUSTED')) {
                    log('warning', `  ${model}: 실제 쿼타 소진 확인됨`);

                    // 리셋 시간 파싱 또는 기본 10분
                    const resetMatch = output.match(/reset after (\d+)h(\d+)m(\d+)s/);
                    let waitMs = 10 * 60 * 1000;

                    if (resetMatch) {
                        const h = parseInt(resetMatch[1]);
                        const m = parseInt(resetMatch[2]);
                        const s = parseInt(resetMatch[3]);
                        waitMs = (h * 3600 + m * 60 + s) * 1000;
                        log('warning', `  ${model}: 쿼타 소진 - ${h}시간 ${m}분 ${s}초 후 리셋`);
                    } else {
                        log('warning', `  ${model}: 쿼타 소진 - 10분 후 재확인`);
                    }
                    const resetTime = Date.now() + waitMs;

                    blacklistedModels.set(model, { resetTime, reason: 'daily_quota_verified' });
                } else {
                    log('success', `  ${model}: 실제 사용 가능 확인!`);
                }
            } catch (error) {
                log('warning', `  ${model}: 재확인 실패 - ${error.message}`);
            }
        }

        // 재확인 후 사용 가능한 모델 수 체크
        availableCount = models.filter(m => !isModelBlacklisted(m)).length;
        log('info', `재확인 후 사용 가능한 모델: ${availableCount}/${models.length}개`);

        if (availableCount === 0) {
            const earliest = getEarliestResetTime();
            let waitMs = 60 * 60 * 1000; // 기본 1시간

            if (earliest) {
                waitMs = earliest - Date.now();
            }

            if (waitMs <= 0) waitMs = 60000; // 최소 1분

            const waitHours = Math.floor(waitMs / 3600000);
            const waitMins = Math.ceil((waitMs % 3600000) / 60000);
            log('warning', `모든 모델 쿼타 소진. ${waitHours}시간 ${waitMins}분 대기 후 재확인...`);

            // 블랙리스트 초기화 후 대기
            blacklistedModels.clear();

            // 대기 (child_process.spawnSync는 이벤트 루프를 차단하지 않지만, 여기선 sleep으로 대기)
            // 비동기 함수 안이므로 Promise 기반 sleep 사용 필요하지만, 
            // checkModelQuotas가 async 함수이므로 await 가능
            await new Promise(resolve => setTimeout(resolve, waitMs + 10000));

            // 재귀 호출로 다시 확인
            return checkModelQuotas();
        }
    }

    return true;
}

// ============================================
// Rate Limiter (Google AI Pro: 120 RPM, 1500 RPD)
// ============================================
class RateLimiter {
    constructor() {
        // Google AI Pro 구독자 기준
        this.RPM_LIMIT = 60;      // 안전 마진 적용 (실제 120)
        this.RPD_LIMIT = 10000;   // API 오류로 제어하므로 클라이언트 제한은 느슨하게 설정
        this.CONCURRENCY = 3;    // 동시 3개 + 1초 딜레이

        this.requestsThisMinute = 0;
        this.requestsToday = 0;
        this.minuteStart = Date.now();
        this.activeRequests = 0;
        this.lastSaveCount = 0;   // 마지막 저장 시점
        this.SAVE_INTERVAL = 20;  // 20개마다 저장 (I/O 최적화)

        // 통계 파일에서 오늘 요청 수 로드
        this.loadDailyStats();
    }

    loadDailyStats() {
        try {
            const statsFile = path.join(DATA_DIR, '.rate_limit_stats.json');
            if (fs.existsSync(statsFile)) {
                const stats = JSON.parse(fs.readFileSync(statsFile, 'utf-8'));
                const today = new Date().toISOString().split('T')[0];
                if (stats.date === today) {
                    this.requestsToday = stats.requestsToday || 0;
                    log('info', `오늘 사용량: ${this.requestsToday}/${this.RPD_LIMIT} RPD`);
                }
            }
        } catch (e) {
            // 무시
        }
    }

    saveDailyStats() {
        try {
            const statsFile = path.join(DATA_DIR, '.rate_limit_stats.json');
            const today = new Date().toISOString().split('T')[0];
            fs.writeFileSync(statsFile, JSON.stringify({
                date: today,
                requestsToday: this.requestsToday,
                lastUpdate: new Date().toISOString()
            }, null, 2), 'utf-8');
        } catch (e) {
            // 무시
        }
    }

    async waitForSlot() {
        // RPD 체크
        if (this.requestsToday >= this.RPD_LIMIT) {
            log('warning', `일일 쿼타 초과 (${this.requestsToday}/${this.RPD_LIMIT} RPD)`);
            log('info', `쿼타 리셋까지 10분 대기 중... (RPD ${this.RPD_LIMIT} 초과)`);
            await new Promise(resolve => setTimeout(resolve, 10 * 60 * 1000)); // 10분 대기

            // 리셋 (계속 시도)
            // this.requestsToday = 0; // 누적 카운트는 유지하되, 대기 후 재시도 허용
            log('info', '대기 완료. 작업 재개.');
        }

        // RPM 체크 및 대기
        const now = Date.now();
        if (now - this.minuteStart >= 60000) {
            this.requestsThisMinute = 0;
            this.minuteStart = now;
        }

        if (this.requestsThisMinute >= this.RPM_LIMIT) {
            const waitTime = 60000 - (now - this.minuteStart) + 1000;
            log('info', `RPM 제한 도달 - ${Math.ceil(waitTime / 1000)}초 대기...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            this.requestsThisMinute = 0;
            this.minuteStart = Date.now();
        }

        // 동시 요청 제한
        while (this.activeRequests >= this.CONCURRENCY) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // 요청 간 1초 딜레이 (Rate Limit 안정적 준수)
        if (this.requestsThisMinute > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        this.activeRequests++;
        this.requestsThisMinute++;
        this.requestsToday++;

        return true;
    }

    release() {
        this.activeRequests--;
        // I/O 최적화: 10개마다만 저장
        if (this.requestsToday - this.lastSaveCount >= this.SAVE_INTERVAL) {
            this.saveDailyStats();
            this.lastSaveCount = this.requestsToday;
        }
    }

    // 종료 시 강제 저장
    forceFlush() {
        this.saveDailyStats();
    }

    async handleRateLimitError() {
        // 429 에러 시 1분 대기
        log('warning', '429 Rate Limit 에러 - 60초 대기 후 재시도...');
        await new Promise(resolve => setTimeout(resolve, 60000));
        this.requestsThisMinute = 0;
        this.minuteStart = Date.now();
    }

    getStats() {
        return {
            rpm: `${this.requestsThisMinute}/${this.RPM_LIMIT}`,
            rpd: `${this.requestsToday}/${this.RPD_LIMIT}`,
            active: this.activeRequests
        };
    }
}

// 전역 Rate Limiter
const rateLimiter = new RateLimiter();

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

// 로그 함수 (개선됨)
const DEBUG_MODE = process.env.DEBUG === 'true';
const loggedMessages = new Set(); // 중복 로그 방지

function log(level, msg, videoId = null) {
    // debug 레벨은 DEBUG_MODE일 때만 출력
    if (level === 'debug' && !DEBUG_MODE) return;

    const time = getKSTDate().toTimeString().slice(0, 8);
    const tags = {
        info: '[INFO]',
        success: '[OK]',
        warning: '[WARN]',
        error: '[ERR]',
        debug: '[DBG]',
        progress: '[PROG]'
    };

    // 병렬 처리 시 videoId 포함 (첫 8자)
    const prefix = videoId ? `[${videoId.slice(0, 8)}] ` : '';
    const logLine = `[${time}] ${tags[level] || '[LOG]'} ${prefix}${msg}`;

    // 중복 메시지 필터링 (1초 내 동일 메시지)
    const msgKey = `${level}:${msg}`;
    if (loggedMessages.has(msgKey)) return;
    loggedMessages.add(msgKey);
    setTimeout(() => loggedMessages.delete(msgKey), 1000);

    console.log(logLine);
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
 * 카카오 API로 키워드 검색 (캐시 적용)
 */
async function searchPlaceWithKakao(keyword, category = null) {
    if (!KAKAO_REST_API_KEY) {
        return null;
    }

    // 캐시 확인
    const cacheKey = `${keyword}|${category || ''}`;
    const cached = apiCache.get('kakao', cacheKey);
    if (cached !== null) {
        return cached;
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
            apiCache.set('kakao', cacheKey, result);
            return result;
        }

        apiCache.set('kakao', cacheKey, null);
        return null;
    } catch (error) {
        log('warning', `카카오 장소 검색 실패: ${error.message}`);
        return null;
    }
}

/**
 * 네이버 지역 검색 API로 장소 검색 (캐시 적용)
 */
async function searchPlaceWithNaver(keyword) {
    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
        return null;
    }

    // 캐시 확인
    const cacheKey = keyword;
    const cached = apiCache.get('naver', cacheKey);
    if (cached !== null) {
        return cached;
    }

    try {
        const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(keyword)}&display=1&sort=random`;

        const response = await fetch(url, {
            headers: {
                'X-Naver-Client-Id': NAVER_CLIENT_ID,
                'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
            }
        });

        const data = await response.json();

        if (data.items && data.items.length > 0) {
            const item = data.items[0];
            // HTML 태그 제거 (precompiled regex 사용)
            const cleanName = item.title.replace(PRECOMPILED_REGEX.htmlTags, '');

            const result = {
                name: cleanName,
                address: item.address || null,
                roadAddress: item.roadAddress || null,
                phone: item.telephone || null,
                category: item.category || null,
                mapx: item.mapx || null,
                mapy: item.mapy || null,
                link: item.link || null
            };
            apiCache.set('naver', cacheKey, result);
            return result;
        }

        apiCache.set('naver', cacheKey, null);
        return null;
    } catch (error) {
        log('warning', `네이버 장소 검색 실패: ${error.message}`);
        return null;
    }
}

// ============================================
// 자막 로드 (transcripts.jsonl에서 미리 수집된 자막 로드)
// Phase 1에서 collect-transcripts.js로 수집된 자막 사용
// [개선] 날짜별 폴더가 아닌 data/ 루트의 공유 파일 사용
// ============================================
const TRANSCRIPT_FILE = path.join(DATA_DIR, 'transcripts.jsonl');
let transcriptsCache = null; // videoId -> transcript

/**
 * transcripts.jsonl 파일을 메모리에 로드
 */
function loadTranscriptsCache() {
    if (transcriptsCache !== null) return transcriptsCache;

    transcriptsCache = new Map();

    if (!fs.existsSync(TRANSCRIPT_FILE)) {
        log('warning', '자막 파일이 없습니다. collect-transcripts.js를 먼저 실행하세요.');
        log('info', '자막 없이 Gemini 분석을 진행합니다.');
        return transcriptsCache;
    }

    try {
        const content = fs.readFileSync(TRANSCRIPT_FILE, 'utf-8');
        const lines = content.trim().split('\n');

        for (const line of lines) {
            if (line) {
                try {
                    const data = JSON.parse(line);
                    if (data.videoId && data.transcript) {
                        transcriptsCache.set(data.videoId, data.transcript);
                    }
                } catch { }
            }
        }

        log('info', `자막 캐시 로드: ${transcriptsCache.size}개`);
    } catch (error) {
        log('warning', `자막 파일 로드 실패: ${error.message}`);
    }

    return transcriptsCache;
}

/**
 * 자막 가져오기 (캐시에서 로드)
 * Phase 1에서 수집된 자막을 사용
 */
function getTranscript(videoId) {
    const cache = loadTranscriptsCache();
    const transcript = cache.get(videoId);

    if (transcript) {
        log('debug', `자막 캐시 히트: ${videoId}`);
        return transcript;
    }

    log('debug', `자막 없음: ${videoId}`);
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
// getValidAccessToken 임포트
import { getValidAccessToken } from './gemini-oauth-manager.js';

/**
 * Gemini API 직접 호출 (Direct API Call)
 * - CLI spawn 오버헤드 제거
 * - fetch 사용
 */
async function callGeminiApi(model, promptText) {
    try {
        const accessToken = await getValidAccessToken();

        // 모델명 정리 (gemini-3-flash-preview -> models/gemini-2.0-flash-exp 등)
        // 사용자가 지정한 모델명이 실제 API 모델명과 다를 수 있으므로 매핑 필요할 수 있음
        // 여기서는 그대로 사용하되, 필요시 매핑 로직 추가
        // Note: Gemini CLI 모델명과 API 모델명이 다를 수 있음.
        // gemini-3-flash-preview -> models/gemini-2.0-flash-exp (추정)
        // 하지만 일단 사용자 설정 그대로 시도

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: promptText }]
                }],
                generationConfig: {
                    responseMimeType: "application/json"
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
            throw new Error('No content in response');
        }

        return text;

    } catch (error) {
        throw error;
    }
}

/**
 * Gemini로 맛집 정보 추출 (Direct API 버전)
 */
async function extractWithGemini(video, transcript, retryAttempt = 0) {
    // 프롬프트 템플릿 로드
    log('debug', `Gemini 분석 시작: ${video.title.slice(0, 50)}...`, video.videoId);

    // 1. 지도 URL 우선 확인
    if (video.mapUrls && video.mapUrls.length > 0) {
        const mapTypes = video.mapUrls.reduce((acc, u) => {
            acc[u.type] = (acc[u.type] || 0) + 1;
            return acc;
        }, {});
        const typeStr = Object.entries(mapTypes).map(([t, c]) => `${t}:${c}`).join(', ');
        log('debug', `지도 URL 발견 (${typeStr}): ${video.mapUrls[0].url.slice(0, 50)}...`, video.videoId);
    } else {
        log('info', '지도 URL 없음 - 자막/제목/설명에서 맛집 추출 시도', video.videoId);
    }
    let promptTemplate = fs.readFileSync(PROMPT_FILE, 'utf-8');

    // 지도 URL 목록 생성
    let mapUrlsText = '(없음)';
    if (video.mapUrls && video.mapUrls.length > 0) {
        mapUrlsText = video.mapUrls.map(m => {
            let info = `- ${m.type}: ${m.url}`;
            // 추출된 정보가 있으면 추가
            if (m.extractedInfo) {
                if (m.extractedInfo.lat && m.extractedInfo.lng) {
                    info += ` → 좌표: (${m.extractedInfo.lat}, ${m.extractedInfo.lng})`;
                }
                if (m.extractedInfo.placeName) {
                    info += ` → 장소명: ${m.extractedInfo.placeName}`;
                }
                if (m.extractedInfo.placeId) {
                    info += ` → placeId: ${m.extractedInfo.placeId}`;
                }
            }
            return info;
        }).join('\n');
    }

    // 플레이스홀더 치환
    promptTemplate = promptTemplate
        .replace('<유튜브_링크>', video.youtube_link)
        .replace('<영상_제목>', video.title)
        .replace('<영상_설명>', video.description)
        .replace('<지도_URL_목록>', mapUrlsText)
        .replace('<자막>', transcript || '(자막 없음)');

    // 로깅용 임시 파일 (디버깅)
    const tempPromptFile = path.join(TODAY_PATH, `temp_prompt_${video.videoId}.txt`);
    fs.writeFileSync(tempPromptFile, promptTemplate, 'utf-8');

    // 모델 리스트 (API 이름으로 매핑 권장)
    // gemini-3-* 모델명은 CLI용 별칭일 수 있음. API용 실제 모델명으로 시도
    let allModels;
    if (retryAttempt % 2 === 0) {
        // API용 모델명 (2.0-flash-exp 등)으로 변경 필요할 수 있으나,
        // 현재 환경변수에 설정된 모델명을 우선 따름.
        // 만약 CLI 모델명이 API에서 동작 안 하면 수정 필요.
        // 여기선 일단 기존 로직따라 모델명 유지하되, 실패시 API 모델명으로 매핑 고려
        allModels = ['gemini-2.0-flash-exp', 'gemini-1.5-pro-latest'];
    } else {
        allModels = ['gemini-1.5-pro-latest', 'gemini-2.0-flash-exp'];
    }

    // 이전 모델명 호환성 (사용자가 설정한 모델명이 gemini-3-* 인 경우)
    // 여기서는 확실한 API 모델명 사용: gemini-2.0-flash-exp (빠름), gemini-1.5-pro-latest (정확)

    const strategyLabel = retryAttempt % 2 === 0 ? 'Flash 우선' : 'Pro 우선';
    log('debug', `[${strategyLabel}] 전략 (재시도 ${retryAttempt}): ${allModels.join(' → ')}`);

    let lastError = null;
    let result = null;

    // 모델 순회
    for (const model of allModels) {
        if (isModelBlacklisted(model)) continue;

        try {
            log('debug', `API 모델 실행: ${model}`, video.videoId);
            const responseText = await callGeminiApi(model, promptTemplate);

            // JSON 파싱
            let cleanedOutput = responseText
                .replace(/```json\s*/, '')
                .replace(/```/, '')
                .trim();

            try {
                result = JSON.parse(cleanedOutput);
            } catch (e) {
                // 부분 파싱 시도
                const jsonStart = cleanedOutput.indexOf('{');
                const jsonEnd = cleanedOutput.lastIndexOf('}');
                if (jsonStart !== -1 && jsonEnd !== -1) {
                    try {
                        result = JSON.parse(cleanedOutput.slice(jsonStart, jsonEnd + 1));
                    } catch (e2) {
                        throw new Error('JSON Parsing Failed');
                    }
                } else {
                    throw new Error('No JSON found');
                }
            }

            if (result) {
                log('success', `Gemini API 분석 성공 (모델: ${model})`, video.videoId);
                break;
            }

        } catch (error) {
            log('debug', `모델 ${model} 실패: ${error.message}`, video.videoId);
            lastError = error;

            // 429 감지
            if (error.message.includes('429') || error.message.includes('Quota')) {
                log('warning', `모델 ${model} 쿼타 제한 감지`, video.videoId);
                // 블랙리스트 로직 등 추가 가능
            }

            await sleep(2000);
        }
    }

    if (!result) {
        // 재시도 로직 (기존 유지)
        if (retryAttempt < 3) {
            log('warning', `분석 실패 - 재시도 (${retryAttempt + 1}/3)...`, video.videoId);
            await sleep(5000);
            return await extractWithGemini(video, transcript, retryAttempt + 1);
        }
    }

    // 임시 파일 정리
    try { fs.unlinkSync(tempPromptFile); } catch { }

    return result;
}

/**
 * 지연 실행 (Rate Limit 방지)
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 카카오 placeId로 장소 상세 정보 조회
 */
async function getKakaoPlaceById(placeId) {
    if (!KAKAO_REST_API_KEY || !placeId) {
        return null;
    }

    try {
        // 카카오는 placeId로 직접 조회하는 공개 API가 없음
        // 대신 place URL에서 placeId를 사용해 검색 시도
        const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(placeId)}&category_group_code=FD6`;
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
            };
        }
        return null;
    } catch (error) {
        return null;
    }
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

    // 지도 URL 형태별 통계
    const mapUrlStats = { google: 0, naver: 0, kakao: 0 };
    let coordsFromMapUrl = null; // 지도 URL에서 직접 추출한 좌표

    // 1. 지도 URL에서 정보 추출 (없으면 스킵)
    const mapUrls = video.mapUrls || [];

    if (mapUrls.length === 0) {
        log('debug', `지도 URL 없음 - Gemini 분석으로 맛집 추출`, video.videoId);
    }

    for (const mapUrl of mapUrls) {
        let mapInfo;
        mapUrlStats[mapUrl.type]++;

        switch (mapUrl.type) {
            case 'naver':
                mapInfo = await extractFromNaverMap(mapUrl.url);
                log('debug', `네이버 지도 URL 발견: ${mapUrl.url.slice(0, 50)}...`, video.videoId);
                break;
            case 'google':
                mapInfo = await extractFromGoogleMap(mapUrl.url);
                // 구글 지도 URL에서 좌표가 직접 추출된 경우
                if (mapInfo.lat && mapInfo.lng) {
                    coordsFromMapUrl = { lat: mapInfo.lat, lng: mapInfo.lng, source: 'google_url' };
                    log('debug', `구글 지도 URL에서 좌표 추출: (${mapInfo.lat}, ${mapInfo.lng})`, video.videoId);
                } else {
                    log('debug', `구글 지도 URL 발견: ${mapUrl.url.slice(0, 50)}...`, video.videoId);
                }
                break;
            case 'kakao':
                mapInfo = await extractFromKakaoMap(mapUrl.url);
                // 카카오 placeId가 있으면 API로 좌표 조회
                if (mapInfo.placeId) {
                    const kakaoPlace = await getKakaoPlaceById(mapInfo.placeId);
                    if (kakaoPlace?.lat && kakaoPlace?.lng) {
                        coordsFromMapUrl = {
                            lat: kakaoPlace.lat,
                            lng: kakaoPlace.lng,
                            source: 'kakao_place',
                            name: kakaoPlace.name,
                            address: kakaoPlace.address
                        };
                        log('debug', `카카오 지도 placeId로 좌표 조회: (${kakaoPlace.lat}, ${kakaoPlace.lng})`);
                    }
                } else {
                    log('debug', `카카오 지도 URL 발견: ${mapUrl.url.slice(0, 50)}...`);
                }
                break;
        }
        mapUrl.extractedInfo = mapInfo;
    }

    // 지도 URL 형태별 통계 출력
    const urlTypes = [];
    if (mapUrlStats.google > 0) urlTypes.push(`구글 ${mapUrlStats.google}개`);
    if (mapUrlStats.naver > 0) urlTypes.push(`네이버 ${mapUrlStats.naver}개`);
    if (mapUrlStats.kakao > 0) urlTypes.push(`카카오 ${mapUrlStats.kakao}개`);
    if (urlTypes.length > 0) {
        log('info', `  지도 URL: ${urlTypes.join(', ')}`);
    }

    // 2. 자막 가져오기
    const transcript = await getTranscript(video.videoId);
    result.hasTranscript = !!transcript;

    // 3. Gemini로 맛집 정보 분석
    const geminiResult = await extractWithGemini(video, transcript);

    if (geminiResult && geminiResult.restaurants) {
        for (const restaurant of geminiResult.restaurants) {
            // 4. 좌표 보완 (우선순위: 지도URL → 카카오주소검색 → 카카오장소검색)
            let geoInfo = null;
            let geocodingSource = null;

            // 4-1. 지도 URL에서 추출한 좌표가 있으면 우선 사용
            if (coordsFromMapUrl) {
                geoInfo = coordsFromMapUrl;
                geocodingSource = coordsFromMapUrl.source;
            }

            // 4-2. 없으면 카카오 API로 주소 검색
            if (!geoInfo && restaurant.address) {
                const kakaoGeo = await geocodeWithKakao(restaurant.address);
                if (kakaoGeo) {
                    geoInfo = kakaoGeo;
                    geocodingSource = 'kakao_address';
                }
            }

            // 4-3. 그래도 없으면 장소명으로 검색
            if (!geoInfo && restaurant.name) {
                const kakaoPlace = await searchPlaceWithKakao(restaurant.name, 'FD6'); // FD6: 음식점
                if (kakaoPlace) {
                    geoInfo = kakaoPlace;
                    geocodingSource = 'kakao_keyword';
                }
            }

            // 5. 데이터 보완 및 누락 사유 기록
            const augmentationNotes = [];

            // 5-1. 네이버 API로 추가 검증 데이터 가져오기 (다중 쿼리 전략)
            let naverInfo = null;
            const cleanAddress = removeFloorInfo(restaurant.address || '');
            const region = extractRegion(cleanAddress);

            if (restaurant.name) {
                // 전략 1: 이름만으로 검색
                naverInfo = await searchPlaceWithNaver(restaurant.name);

                // 전략 2: 이름 + 지역으로 검색 (결과 없거나 주소 불일치 시)
                if (!naverInfo && region) {
                    const nameRegionQuery = `${restaurant.name} ${region}`;
                    naverInfo = await searchPlaceWithNaver(nameRegionQuery);
                    if (naverInfo) {
                        augmentationNotes.push(`[다중쿼리] name+region 검색으로 매칭`);
                    }
                }

                // 전략 3: 이름 + 주소로 검색
                if (!naverInfo && cleanAddress) {
                    const nameAddrQuery = `${restaurant.name} ${addressCore(cleanAddress)}`;
                    naverInfo = await searchPlaceWithNaver(nameAddrQuery);
                    if (naverInfo) {
                        augmentationNotes.push(`[다중쿼리] name+address 검색으로 매칭`);
                    }
                }
            }

            // 5-2. 카테고리 유효성 검증
            const categoryForValidation = restaurant.category || null;
            if (categoryForValidation && !isValidCategory(categoryForValidation)) {
                augmentationNotes.push(`[경고] 비표준 카테고리: ${categoryForValidation}`);
            }

            // 5-3. 좌표 거리 기반 검증 (geoInfo vs naverInfo)
            if (geoInfo?.lat && geoInfo?.lng && naverInfo?.mapx && naverInfo?.mapy) {
                // 네이버 TM128 → WGS84 변환
                const naverLng = (parseInt(naverInfo.mapx) / 10000000) * 0.8 + 124.5;
                const naverLat = (parseInt(naverInfo.mapy) / 10000000) * 0.8 + 30.5;

                const distance = haversineDistance(geoInfo.lat, geoInfo.lng, naverLat, naverLng);

                if (distance <= 50) {
                    augmentationNotes.push(`[좌표검증] 카카오/네이버 일치 (${Math.round(distance)}m)`);
                } else if (distance <= 500) {
                    augmentationNotes.push(`[좌표검증] 카카오/네이버 유사 (${Math.round(distance)}m)`);
                } else {
                    augmentationNotes.push(`[좌표경고] 카카오/네이버 불일치 (${Math.round(distance)}m) - 확인 필요`);
                }
            }

            // 전화번호 3중 교차 검증 (Gemini vs 카카오 vs 네이버)
            const geminiPhone = restaurant.phone || null;
            const kakaoPhone = geoInfo?.phone || null;
            const naverPhone = naverInfo?.phone || null;
            let finalPhone = null;

            // 전화번호 정규화 함수 (비교용)
            const normalizePhone = (phone) => {
                if (!phone) return null;
                return phone.replace(/[^0-9]/g, ''); // 숫자만 추출
            };

            const normalizedGemini = normalizePhone(geminiPhone);
            const normalizedKakao = normalizePhone(kakaoPhone);
            const normalizedNaver = normalizePhone(naverPhone);

            // 3중 교차 검증 (다수결)
            const phoneVotes = {};
            if (normalizedGemini) phoneVotes[normalizedGemini] = (phoneVotes[normalizedGemini] || 0) + 1;
            if (normalizedKakao) phoneVotes[normalizedKakao] = (phoneVotes[normalizedKakao] || 0) + 1;
            if (normalizedNaver) phoneVotes[normalizedNaver] = (phoneVotes[normalizedNaver] || 0) + 1;

            const voteCounts = Object.entries(phoneVotes);

            if (voteCounts.length === 0) {
                // 아무 소스도 전화번호 없음
                augmentationNotes.push('[누락] 전화번호: Gemini/카카오/네이버 모두 없음');
            } else if (voteCounts.length === 1) {
                // 하나의 전화번호만 있음
                const [normalized, count] = voteCounts[0];
                const sources = [];
                if (normalizedGemini === normalized) sources.push('Gemini');
                if (normalizedKakao === normalized) sources.push('카카오');
                if (normalizedNaver === normalized) sources.push('네이버');

                // 원본 형식 선택 (카카오 > 네이버 > Gemini)
                if (normalizedKakao === normalized) finalPhone = kakaoPhone;
                else if (normalizedNaver === normalized) finalPhone = naverPhone;
                else finalPhone = geminiPhone;

                if (count >= 2) {
                    augmentationNotes.push(`[검증완료] 전화번호: ${finalPhone} (${sources.join('+')} 일치)`);
                } else {
                    augmentationNotes.push(`[단일소스] 전화번호: ${finalPhone} (${sources[0]}에서만 확인)`);
                }
            } else {
                // 여러 다른 전화번호 존재 - 다수결 또는 API 우선
                voteCounts.sort((a, b) => b[1] - a[1]); // 투표 수 기준 정렬
                const [winningNormalized, winningCount] = voteCounts[0];

                if (winningCount >= 2) {
                    // 다수결 승리
                    if (normalizedKakao === winningNormalized) finalPhone = kakaoPhone;
                    else if (normalizedNaver === winningNormalized) finalPhone = naverPhone;
                    else finalPhone = geminiPhone;
                    augmentationNotes.push(`[다수결] 전화번호: ${finalPhone} (${winningCount}/3 일치)`);
                } else {
                    // 모두 다름 - 카카오 > 네이버 > Gemini 우선순위
                    if (kakaoPhone) {
                        finalPhone = kakaoPhone;
                        augmentationNotes.push(`[불일치] 전화번호 - Gemini: ${geminiPhone || 'N/A'}, 카카오: ${kakaoPhone}, 네이버: ${naverPhone || 'N/A'} → 카카오 채택`);
                    } else if (naverPhone) {
                        finalPhone = naverPhone;
                        augmentationNotes.push(`[불일치] 전화번호 - Gemini: ${geminiPhone || 'N/A'}, 네이버: ${naverPhone} → 네이버 채택`);
                    } else {
                        finalPhone = geminiPhone;
                        augmentationNotes.push(`[Gemini] 전화번호: ${finalPhone} (API 미확인)`);
                    }
                }
            }

            // 상호명 유사도 검증 (Gemini vs 카카오 vs 네이버)
            const geminiName = restaurant.name || '';
            const kakaoName = geoInfo?.name || '';
            const naverName = naverInfo?.name || '';
            let finalName = geminiName; // 기본값은 Gemini

            // 간단한 유사도 함수 (포함관계 체크)
            const isSimilar = (a, b) => {
                if (!a || !b) return false;
                const cleanA = a.replace(/\s+/g, '').toLowerCase();
                const cleanB = b.replace(/\s+/g, '').toLowerCase();
                return cleanA.includes(cleanB) || cleanB.includes(cleanA) || cleanA === cleanB;
            };

            if (naverName && isSimilar(geminiName, naverName)) {
                finalName = naverName; // 네이버 우선
                augmentationNotes.push(`[검증완료] 상호명 일치: ${finalName} (Gemini/네이버)`);
            } else if (kakaoName && isSimilar(geminiName, kakaoName)) {
                finalName = kakaoName;
                augmentationNotes.push(`[검증완료] 상호명 일치: ${finalName} (Gemini/카카오)`);
            } else if (naverName && kakaoName && isSimilar(naverName, kakaoName)) {
                finalName = naverName; // 네이버 우선
                augmentationNotes.push(`[API일치] 상호명: ${finalName} (네이버/카카오)`);
            } else if (geminiName) {
                augmentationNotes.push(`[Gemini] 상호명: ${geminiName} (API 미확인)`);
            }

            // 주소 3중 교차검증 (우선순위: 네이버 > 카카오 > Gemini)
            const geminiAddress = restaurant.address || null;
            const kakaoRoadAddr = geoInfo?.roadAddress || null;
            const kakaoJibunAddr = geoInfo?.address || null;
            const naverRoadAddr = naverInfo?.roadAddress || null;
            const naverJibunAddr = naverInfo?.address || null;

            let finalAddress = null;
            let finalRoadAddress = null;
            let finalJibunAddress = null;

            // 네이버 우선
            if (naverRoadAddr) {
                finalAddress = naverRoadAddr;
                finalRoadAddress = naverRoadAddr;
                finalJibunAddress = naverJibunAddr;
                if (kakaoRoadAddr && naverRoadAddr.includes(kakaoRoadAddr.split(' ')[0])) {
                    augmentationNotes.push(`[검증완료] 주소: ${finalAddress} (네이버/카카오 일치)`);
                } else {
                    augmentationNotes.push(`[네이버] 주소: ${finalAddress}`);
                }
            } else if (kakaoRoadAddr) {
                finalAddress = kakaoRoadAddr;
                finalRoadAddress = kakaoRoadAddr;
                finalJibunAddress = kakaoJibunAddr;
                augmentationNotes.push(`[카카오] 주소: ${finalAddress}`);
            } else if (geminiAddress) {
                finalAddress = geminiAddress;
                augmentationNotes.push(`[Gemini] 주소: ${finalAddress} (API 미확인)`);
            } else if (naverJibunAddr) {
                finalAddress = naverJibunAddr;
                finalJibunAddress = naverJibunAddr;
                augmentationNotes.push(`[네이버] 지번주소: ${finalAddress}`);
            } else if (kakaoJibunAddr) {
                finalAddress = kakaoJibunAddr;
                finalJibunAddress = kakaoJibunAddr;
                augmentationNotes.push(`[카카오] 지번주소: ${finalAddress}`);
            } else {
                augmentationNotes.push('[누락] 주소: 모든 소스에서 없음');
            }

            // 카테고리 3중 교차검증 (우선순위: 네이버 > 카카오 > Gemini)
            const geminiCategory = restaurant.category || null;
            const kakaoCategory = geoInfo?.category || null;
            const naverCategory = naverInfo?.category || null;
            let finalCategory = null;

            if (naverCategory) {
                finalCategory = naverCategory;
                augmentationNotes.push(`[네이버] 카테고리: ${finalCategory}`);
            } else if (kakaoCategory) {
                finalCategory = kakaoCategory;
                augmentationNotes.push(`[카카오] 카테고리: ${finalCategory}`);
            } else if (geminiCategory) {
                finalCategory = geminiCategory;
                augmentationNotes.push(`[Gemini] 카테고리: ${finalCategory}`);
            }

            // 좌표 교차검증 (네이버 TM128 → WGS84 변환 + 카카오)
            let finalLat = geoInfo?.lat || null;
            let finalLng = geoInfo?.lng || null;
            let coordSource = geocodingSource;

            // 네이버 TM128 좌표를 WGS84로 변환
            if (naverInfo?.mapx && naverInfo?.mapy && !finalLat) {
                // TM128 → WGS84 변환 (근사 공식)
                const tm128ToWgs84 = (x, y) => {
                    // 네이버 mapx, mapy는 카텍(KATEC) 좌표계
                    // 간단한 변환 공식 (정확도 약 ~100m)
                    const lng = (x / 10000000) * 0.8 + 124.5;
                    const lat = (y / 10000000) * 0.8 + 30.5;
                    return { lat, lng };
                };
                const converted = tm128ToWgs84(parseInt(naverInfo.mapx), parseInt(naverInfo.mapy));
                finalLat = converted.lat;
                finalLng = converted.lng;
                coordSource = 'naver_converted';
                augmentationNotes.push(`[네이버] 좌표 변환: (${finalLat.toFixed(6)}, ${finalLng.toFixed(6)})`);
            } else if (finalLat && finalLng) {
                augmentationNotes.push(`[${coordSource}] 좌표: (${finalLat.toFixed(6)}, ${finalLng.toFixed(6)})`);
            } else {
                augmentationNotes.push('[누락] 좌표: 모든 소스에서 없음');
            }

            // reasoning_basis 통합
            const originalReasoning = restaurant.reasoning_basis || '';
            const augmentationLog = augmentationNotes.length > 0
                ? `\n--- 데이터 보완 ---\n${augmentationNotes.join('\n')}`
                : '';
            const finalReasoning = originalReasoning + augmentationLog;

            result.restaurants.push({
                ...restaurant,
                name: finalName,
                youtuber_name: '정육왕',
                youtuber_channel: '@meatcreator',
                youtube_link: video.youtube_link,
                video_title: video.title,
                lat: finalLat,
                lng: finalLng,
                address: finalAddress,
                geocoded_address: finalRoadAddress || finalJibunAddress || null,
                road_address: finalRoadAddress,
                jibun_address: finalJibunAddress,
                phone: finalPhone,
                category: finalCategory,
                geocoding_source: coordSource,
                reasoning_basis: finalReasoning || null,
                map_type: video.mapUrls?.[0]?.type || null,
                map_url: video.mapUrls?.[0]?.url || null
            });
        }
    }

    result.is_restaurant_video = geminiResult?.is_restaurant_video ?? null;  // null = 분석 실패 (재시도 필요)
    result.video_type = geminiResult?.video_type || 'unknown';

    return result;
}

/**
 * 메인 실행
 */
async function main() {
    log('info', '==================================================');
    log('info', '           맛집 정보 추출 시작 (Extracting)       ');
    log('info', '==================================================');

    const startTime = Date.now();

    // 모델 쿼타 상태 사전 확인 (무한 대기하므로 false 반환 없음)
    await checkModelQuotas();

    // 입력 파일 확인 (모든 영상 또는 지도 URL 있는 영상)
    // 우선순위: 전체 영상 처리 파일 > 지도 URL 영상 파일
    let inputFile = path.join(TODAY_PATH, 'meatcreator_videos_all.jsonl');

    if (!fs.existsSync(inputFile)) {
        // 전체 영상 목록에서 처리할 영상 필터링
        const allVideosFile = path.join(TODAY_PATH, 'meatcreator_videos.json');
        if (!fs.existsSync(allVideosFile)) {
            log('error', '영상 목록 파일이 없습니다. 먼저 crawl-channel.js를 실행하세요.');
            process.exit(1);
        }

        const allVideos = JSON.parse(fs.readFileSync(allVideosFile, 'utf-8'));

        // 모든 영상 처리 (필터링 없음 - 1041개 전부)
        const videosToProcess = allVideos.videos;

        const content = videosToProcess.map(v => JSON.stringify(v)).join('\n');
        fs.writeFileSync(inputFile, content, 'utf-8');

        const withMapCount = videosToProcess.filter(v => v.hasMapUrl).length;
        const withoutMapCount = videosToProcess.length - withMapCount;
        log('info', `처리할 영상 ${videosToProcess.length}개`);
        log('info', `  - 지도 URL 포함: ${withMapCount}개`);
        log('info', `  - 지도 URL 없음: ${withoutMapCount}개`);
    }

    // 영상 목록 로드
    const content = fs.readFileSync(inputFile, 'utf-8');
    const videos = content.trim().split('\n').map(line => JSON.parse(line));

    log('info', `처리할 영상: ${videos.length}개`);

    // 이미 처리된 영상 체크 (videoId와 description 해시로 변경 감지)
    const outputFile = path.join(TODAY_PATH, 'meatcreator_restaurants.jsonl');
    const processedVideos = new Map(); // videoId -> { descriptionHash, lineIndex, restaurants, is_restaurant_video }
    const allResults = new Map();      // videoId -> full JSON data (중복 방지용)

    if (fs.existsSync(outputFile)) {
        const existingContent = fs.readFileSync(outputFile, 'utf-8');
        const lines = existingContent.trim().split('\n');
        for (let idx = 0; idx < lines.length; idx++) {
            const line = lines[idx];
            if (line) {
                try {
                    const data = JSON.parse(line);
                    // description 해시 저장 (변경 감지용)
                    const descHash = data.descriptionHash || '';
                    processedVideos.set(data.videoId, {
                        descriptionHash: descHash,
                        lineIndex: idx,
                        restaurants: data.restaurants?.length || 0,
                        is_restaurant_video: data.is_restaurant_video ?? null
                    });
                    // 전체 데이터 저장 (나중에 덮어쓰기 위해)
                    allResults.set(data.videoId, data);
                } catch { }
            }
        }
        log('info', `이미 처리된 영상: ${processedVideos.size}개`);
    }

    // description 해시 함수 (간단한 변경 감지용)
    function hashDescription(desc) {
        if (!desc) return '';
        // 간단한 해시: 첫 100자 + 길이 + 지도 URL 포함 여부
        const hasMapUrl = /maps\.google|goo\.gl\/maps|naver\.me|map\.naver|place\.naver|map\.kakao|kko\.to/i.test(desc);
        return `${desc.slice(0, 100).trim()}|${desc.length}|${hasMapUrl}`;
    }

    // 통계
    const stats = {
        total: videos.length,
        processed: 0,
        skipped: 0,
        updated: 0,  // description 변경으로 재처리
        success: 0,
        failed: 0,
        restaurantsFound: 0,
        commits: 0
    };

    // 배치 설정
    let batchCount = 0;
    const LOG_BATCH_SIZE = 20;     // 20개마다 진행 상황 로그 (로그 I/O 최적화)
    const COMMIT_BATCH_SIZE = 50;  // 50개마다 저장 (빈번한 I/O 오류 방지)
    let lastCommitCount = 0;

    // GitHub Actions 관련 커밋 함수 제거됨

    // 파이프라인 시작 시간 기록
    recordPipelineStart();

    // 처리할 영상 필터링
    const videosToProcess = [];
    for (let i = 0; i < videos.length; i++) {
        const video = videos[i];
        const currentDescHash = hashDescription(video.description);

        // 이미 처리된 영상 체크 (description 변경 감지 포함)
        const existing = processedVideos.get(video.videoId);
        if (existing) {
            // description이 변경되었는지 확인
            if (existing.descriptionHash === currentDescHash) {
                // 재처리 조건: 
                //   1. restaurants=0 이고 is_restaurant_video=true (맛집 영상인데 추출 실패)
                //   2. is_restaurant_video=null (분석 자체 실패)
                // 스킵 조건: restaurants>0 이거나, is_restaurant_video=false (맛집 아닌 영상)
                const shouldRetry = existing.is_restaurant_video === null ||
                    (existing.restaurants === 0 && existing.is_restaurant_video === true);
                if (!shouldRetry) {
                    stats.skipped++;
                    continue;
                }
                stats.updated++;
            } else {
                stats.updated++;
            }
        }

        videosToProcess.push({ video, index: i, descHash: currentDescHash });
    }

    log('info', `처리 대상: ${videosToProcess.length}개 / 스킵: ${stats.skipped}개`);
    log('info', `병렬 처리 모드: 동시 ${rateLimiter.CONCURRENCY}개`);

    // 단일 영상 처리 함수
    async function processVideoWithRateLimit(item) {
        const { video, index, descHash } = item;

        // Rate limit 대기
        const canProceed = await rateLimiter.waitForSlot();
        if (!canProceed) {
            return { success: false, quotaExceeded: true };
        }

        try {
            // 모든 모델이 블랙리스트되었는지 확인
            const allModels = ['gemini-3-pro-preview', 'gemini-3-flash-preview'];
            const allBlacklisted = allModels.every(m => isModelBlacklisted(m));

            if (allBlacklisted) {
                // 가장 빠른 리셋 시간 확인
                const earliestReset = getEarliestResetTime();
                if (earliestReset) {
                    const waitMs = earliestReset - Date.now();
                    if (waitMs > 0 && waitMs <= 24 * 60 * 60 * 1000) { // 24시간 이내면 대기
                        log('info', `모든 모델 쿼타 소진 - 리셋까지 ${Math.ceil(waitMs / 60000)}분 대기...`);
                        await sleep(waitMs + 5000);
                        log('info', `쿼타 리셋 완료 - 계속 진행`);
                        // 블랙리스트 정리 (만료된 항목 제거)
                        allModels.forEach(m => isModelBlacklisted(m));
                    } else {
                        rateLimiter.release();
                        return { success: false, allBlacklisted: true, waitMs };
                    }
                } else {
                    rateLimiter.release();
                    return { success: false, allBlacklisted: true };
                }
            }

            log('info', `[${index + 1}/${videos.length}] 처리 중: ${video.title.slice(0, 40)}...`);

            const result = await processVideo(video);

            if (!result) {
                log('warning', `  → Gemini 분석 실패 - 모든 모델 실패`);
                rateLimiter.release();
                // 모든 모델이 실패하면 allBlacklisted로 처리하여 루프 중단
                return { success: false, allBlacklisted: true, videoId: video.videoId };
            }

            // description 해시 추가
            result.descriptionHash = descHash;

            rateLimiter.release();
            return { success: true, result, video };

        } catch (error) {
            log('error', `  → 처리 실패: ${error.message}`);
            rateLimiter.release();

            // 429 에러 감지
            if (error.message?.includes('429') || error.message?.includes('rate')) {
                await rateLimiter.handleRateLimitError();
            }

            return { success: false, error };
        }
    }

    // 병렬 처리 (배치 단위)
    const BATCH_SIZE = rateLimiter.CONCURRENCY;
    batchCount = 0;       // 리셋 (이미 상위에서 선언됨)
    lastCommitCount = 0;  // 리셋 (이미 상위에서 선언됨)

    for (let i = 0; i < videosToProcess.length; i += BATCH_SIZE) {
        // Gemini CLI가 access_token 만료 시 자동으로 refresh_token으로 갱신하므로
        // 수동 토큰 체크 불필요

        const batch = videosToProcess.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(item => processVideoWithRateLimit(item)));

        // 결과 처리
        for (const res of results) {
            if (res.quotaExceeded) {
                // waitForSlot에서 이미 대기하므로 이 코드는 도달할 일이 거의 없으나 안전장치로 유지
                log('warning', '일일 쿼타 초과 감지 - 잠시 대기 후 재시도');
                await sleep(60000);
                i -= BATCH_SIZE; // 현재 배치 재시도
                continue;
            }

            if (res.allBlacklisted) {
                log('error', '='.repeat(50));
                log('error', '모든 Gemini 모델 사용 불가');
                log('error', '='.repeat(50));

                // 블랙리스트된 모델들의 상태 출력
                for (const [model, info] of blacklistedModels) {
                    const reasonText = info.reason === 'daily_quota' ? '일일 쿼타 소진' : 'API 오류';
                    if (info.resetTime) {
                        const waitMs = info.resetTime - Date.now();
                        const waitHours = Math.floor(waitMs / 3600000);
                        const waitMins = Math.ceil((waitMs % 3600000) / 60000);
                        log('warning', `  ${model}: ${reasonText} (리셋까지 ${waitHours}시간 ${waitMins}분)`);
                    } else {
                        log('warning', `  ${model}: ${reasonText}`);
                    }
                }

                // 가장 빠른 리셋 시간까지 대기
                const earliest = getEarliestResetTime();
                let waitMs = earliest ? (earliest - Date.now()) : (60 * 60 * 1000); // 기본 1시간

                if (waitMs <= 0) waitMs = 60 * 60 * 1000; // 최소 1시간

                const waitHours = Math.floor(waitMs / 3600000);
                const waitMins = Math.ceil((waitMs % 3600000) / 60000);
                log('info', '');
                log('info', `쿼타 리셋까지 ${waitHours}시간 ${waitMins}분 대기 중...`);
                log('info', '(Ctrl+C로 중단 가능)');

                // 중간 저장
                const allData = Array.from(allResults.values());
                if (allData.length > 0) {
                    try {
                        fs.writeFileSync(outputFile, allData.map(d => JSON.stringify(d)).join('\n') + '\n', 'utf-8');
                        log('info', `중간 저장 완료: ${allData.length}개`);
                    } catch (e) {
                        log('warning', `중간 저장 실패: ${e.message}`);
                    }
                }
                rateLimiter.forceFlush();

                // 대기
                await sleep(waitMs + 5000);

                // 블랙리스트 정리 (만료된 항목 제거)
                for (const model of blacklistedModels.keys()) {
                    isModelBlacklisted(model);
                }

                log('success', '쿼타 리셋 완료 - 크롤링 재개');
                log('info', '');

                // 같은 배치를 다시 처리하도록 인덱스 되돌림
                i -= BATCH_SIZE;
                break; // 현재 결과 처리 루프 탈출 후 배치 재시도
            }

            if (res.success && res.result) {
                // 결과를 Map에 저장 (중복 방지 - videoId로 덮어쓰기)
                allResults.set(res.result.videoId, res.result);
                stats.processed++;
                stats.success++;
                stats.restaurantsFound += res.result.restaurants.length;
                batchCount++;

                log('success', `  ${res.result.restaurants.length}개 맛집 발견`);
            } else if (!res.success && !res.quotaExceeded && !res.allBlacklisted) {
                stats.failed++;
            }
        }

        // 진행 상황 출력 (더 깔끔하게)
        if (batchCount >= LOG_BATCH_SIZE) {
            const rateStats = rateLimiter.getStats();
            const percent = Math.round((stats.processed / videosToProcess.length) * 100);
            const progressBar = '[' + '▓'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5)) + ']';
            log('progress', `${progressBar} ${percent}% | ${stats.processed}/${videosToProcess.length} | 맛집: ${stats.restaurantsFound}개 | RPD: ${rateStats.rpd}`);
            batchCount = 0;
        }

        // 50개마다 파일 저장 + 자동 커밋 (I/O 최적화)
        if (stats.processed - lastCommitCount >= COMMIT_BATCH_SIZE) {
            // 종료 전 저장
            const allData = Array.from(allResults.values());
            try {
                fs.writeFileSync(outputFile, allData.map(d => JSON.stringify(d)).join('\n') + '\n', 'utf-8');
            } catch (e) { log('error', `비상 저장 실패: ${e.message}`); }

            let saved = false;
            const content = Array.from(allResults.values()).map(d => JSON.stringify(d)).join('\n') + '\n'; // Define content here
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    fs.writeFileSync(outputFile, content, 'utf-8');
                    saved = true;
                    break;
                } catch (e) {
                    log('warning', `파일 저장 실패(시도 ${attempt}/3): ${e.message}`);
                    await sleep(2000 * attempt);
                }
            }

            if (saved) {
                // commitProgress removed
                lastCommitCount = stats.processed;
            } else {
                log('error', '파일 저장 최종 실패 - 다음 배치에서 재시도');
            }
        }
    }

    // 마지막 남은 데이터 저장 + 커밋
    const allDataFinal = Array.from(allResults.values());
    const finalContent = allDataFinal.map(d => JSON.stringify(d)).join('\n') + '\n';

    // 최종 저장 재시도 로직
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            fs.writeFileSync(outputFile, finalContent, 'utf-8');
            break;
        } catch (e) {
            log('warning', `최종 저장 실패(시도 ${attempt}/5): ${e.message}`);
            await sleep(2000 * attempt);
        }
    }

    rateLimiter.forceFlush();

    if (stats.processed > lastCommitCount) {
        // commitProgress removed
    }

    // 결과 출력
    const duration = Date.now() - startTime;

    log('info', '');
    log('info', '==================================================');
    log('success', '                처리 완료 (COMPLETED)             ');
    log('info', '==================================================');
    log('info', ` 총 영상: ${stats.total}개`);
    log('info', ` 처리됨: ${stats.processed}개`);
    log('info', `스킵됨: ${stats.skipped}개 (이미 처리)`);
    if (stats.updated > 0) {
        log('info', `재처리: ${stats.updated}개 (description 변경)`);
    }
    log('success', `성공: ${stats.success}개`);
    if (stats.failed > 0) {
        log('error', ` 실패: ${stats.failed}개`);
    }
    log('info', `발견된 맛집: ${stats.restaurantsFound}개`);

    log('info', ` 소요 시간: ${Math.round(duration / 1000)}초`);
    const finalRateStats = rateLimiter.getStats();
    log('info', `Rate Limit: RPM ${finalRateStats.rpm}, RPD ${finalRateStats.rpd}`);
    log('info', '='.repeat(60));



    // 실패한 영상(is_restaurant_video=null) 재시도 확인
    const failedVideos = Array.from(allResults.values()).filter(v => v.is_restaurant_video === null);
    if (failedVideos.length > 0) {
        log('info', '');
        log('warning', ` 분석 실패 영상 ${failedVideos.length}개 발견 - 30초 후 재시도...`);
        log('info', '(Ctrl+C로 종료 가능)');
        await sleep(30000);

        // 만료된 블랙리스트 정리
        for (const model of blacklistedModels.keys()) {
            isModelBlacklisted(model);
        }

        log('info', '');
        log('info', '='.repeat(60));
        log('info', '  실패 영상 재분석 시작');
        log('info', '='.repeat(60));

        // main 함수를 다시 호출하여 재시도 (null인 영상만 처리됨)
        return main();
    }
}

// 프로세스 종료 핸들러
process.on('SIGINT', () => {
    log('info', '프로세스 중단됨 (Ctrl+C)');
    rateLimiter.forceFlush();
    process.exit(0);
});

main();

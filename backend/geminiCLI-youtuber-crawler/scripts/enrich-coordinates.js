/**
 * 맛집 데이터 보완 스크립트 (Cross-Validation)
 * 
 * 기능:
 * 1. 좌표 보완 (Kakao API - WGS84)
 * 2. 전화번호 교차 검증 (Naver Priority > Kakao Fallback)
 * 3. 해외 식당 분리 처리 (API 호출 생략으로 효율화)
 * 
 * Note: 카테고리는 Gemini가 여러 소스를 참고해 결정하므로 API 덮어쓰기 하지 않음
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

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
    }
}

// API Keys
const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

if (!KAKAO_REST_API_KEY) {
    console.error(' KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다.');
    process.exit(1);
}

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

// 로그 함수
function log(level, msg) {
    const time = getKSTDate().toTimeString().slice(0, 8);
    const tags = {
        info: '[INFO]',
        success: '[OK]',
        warning: '[WARN]',
        error: '[ERR]',
        debug: '[DBG]',
        skip: '[SKIP]',
        phone: '[TEL]',
        coord: '[GEO]',
        overseas: '[INTL]'
    };
    console.log(`[${time}] ${tags[level] || '[LOG]'} ${msg}`);
}

/**
 * 한국 주소인지 판별 (해외 식당 분리용)
 */
function isKoreanAddress(address) {
    if (!address) return false;

    // 한글 포함 여부 확인
    const hasKorean = /[가-힣]/.test(address);

    // 한국 지역명 키워드
    const koreanKeywords = [
        '서울', '부산', '인천', '대구', '광주', '대전', '울산', '세종',
        '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
        '특별시', '광역시', '특별자치', '도', '시', '군', '구', '읍', '면', '동', '리'
    ];

    const hasKoreanKeyword = koreanKeywords.some(kw => address.includes(kw));

    return hasKorean && hasKoreanKeyword;
}

/**
 * 네이버 지역 검색 API (전화번호 확보용 - 한국 전용)
 */
async function searchNaverLocal(query) {
    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) return null;
    if (!query || query.trim() === '') return null;

    try {
        const encodedQuery = encodeURIComponent(query.trim());
        const apiUrl = `https://openapi.naver.com/v1/search/local.json?query=${encodedQuery}&display=1&sort=random`;

        const response = await fetch(apiUrl, {
            headers: {
                'X-Naver-Client-Id': NAVER_CLIENT_ID,
                'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
            }
        });

        if (!response.ok) return null;

        const data = await response.json();
        if (data.items && data.items.length > 0) {
            const item = data.items[0];
            // HTML 태그 제거
            const title = item.title.replace(/<[^>]+>/g, '');
            const phone = item.telephone || null;

            return {
                title,
                phone,
                address: item.roadAddress || item.address,
                category: item.category
            };
        }
        return null;
    } catch (error) {
        return null;
    }
}

/**
 * 카카오 주소 검색 API
 */
async function geocodeWithKakao(address) {
    if (!address || address.trim() === '') return null;

    try {
        const encodedAddress = encodeURIComponent(address.trim());
        const apiUrl = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodedAddress}`;

        const response = await fetch(apiUrl, {
            headers: { 'Authorization': `KakaoAK ${KAKAO_REST_API_KEY}` }
        });

        if (!response.ok) return null;

        const data = await response.json();

        if (data.documents && data.documents.length > 0) {
            const firstResult = data.documents[0];
            const lat = parseFloat(firstResult.y);
            const lng = parseFloat(firstResult.x);

            if (!isNaN(lat) && !isNaN(lng)) {
                return {
                    lat,
                    lng,
                    road_address: firstResult.road_address?.address_name || null,
                    jibun_address: firstResult.address?.address_name || null,
                    phone: null
                };
            }
        }

        // 주소 검색 실패 시 키워드 검색으로 폴백
        return await geocodeWithKeyword(address);

    } catch (error) {
        return null;
    }
}

/**
 * 카카오 키워드 검색 API (폴백 + 전화번호 확보)
 */
async function geocodeWithKeyword(query) {
    try {
        const encodedQuery = encodeURIComponent(query.trim());
        const apiUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodedQuery}`;

        const response = await fetch(apiUrl, {
            headers: { 'Authorization': `KakaoAK ${KAKAO_REST_API_KEY}` }
        });

        if (!response.ok) return null;

        const data = await response.json();

        if (data.documents && data.documents.length > 0) {
            const firstResult = data.documents[0];
            const lat = parseFloat(firstResult.y);
            const lng = parseFloat(firstResult.x);

            if (!isNaN(lat) && !isNaN(lng)) {
                return {
                    lat,
                    lng,
                    road_address: firstResult.road_address_name || null,
                    jibun_address: firstResult.address_name || null,
                    place_name: firstResult.place_name || null,
                    phone: firstResult.phone || null
                };
            }
        }
        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Data Enrichment (한국 식당용)
 * 전략:
 * 1. Kakao: 좌표(Lat/Lng) 메인 소스
 * 2. Naver: 전화번호(Phone) 메인 소스 (Priority)
 */
async function enrichKoreanData(name, address) {
    let kakaoResult = null;
    let naverResult = null;

    // 1. Kakao 검색 (좌표 확보)
    if (name) {
        let searchQuery = name;
        if (address) {
            const regionMatch = address.match(/([가-힣]+구|[가-힣]+시|[가-힣]+동)/);
            if (regionMatch) searchQuery = `${name} ${regionMatch[1]}`;
        }
        kakaoResult = await geocodeWithKeyword(searchQuery);
    }

    if (!kakaoResult && address) {
        kakaoResult = await geocodeWithKakao(address);
    }

    // 2. Naver 검색 (전화번호 확보)
    if (name) {
        let searchQuery = name;
        if (address) {
            const regionMatch = address.match(/([가-힣]+구|[가-힣]+시|[가-힣]+동)/);
            if (regionMatch) searchQuery = `${name} ${regionMatch[1]}`;
        }
        naverResult = await searchNaverLocal(searchQuery);
    }

    // 결과 병합
    if (kakaoResult) {
        const finalPhone = naverResult?.phone || kakaoResult.phone || null;

        return {
            ...kakaoResult,
            phone: finalPhone,
            phone_source: naverResult?.phone ? 'naver_api' : (kakaoResult.phone ? 'kakao_api' : null),
            api_source: naverResult ? 'kakao+naver' : 'kakao_only'
        };
    }

    return null;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 메인 실행
 */
async function main() {
    log('info', '==========================================================');
    log('info', '       데이터 보완 시작 (Cross-Validation Engine)          ');
    log('info', '==========================================================');
    log('info', '');

    const startTime = Date.now();

    // 입력 파일 찾기
    let inputFile = path.join(TODAY_PATH, 'meatcreator_restaurants.jsonl');

    if (!fs.existsSync(inputFile)) {
        const folders = fs.readdirSync(DATA_DIR)
            .filter(f => /^\d{2}-\d{2}-\d{2}$/.test(f))
            .sort()
            .reverse();

        for (const folder of folders) {
            const filePath = path.join(DATA_DIR, folder, 'meatcreator_restaurants.jsonl');
            if (fs.existsSync(filePath)) {
                inputFile = filePath;
                log('info', ` 최근 데이터 파일 사용: ${folder}`);
                break;
            }
        }
    }

    if (!fs.existsSync(inputFile)) {
        log('error', '맛집 데이터 파일이 없습니다. 먼저 extract-addresses.js를 실행하세요.');
        process.exit(1);
    }

    log('info', ` 입력 파일: ${inputFile}`);

    // 데이터 로드
    const content = fs.readFileSync(inputFile, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    const entries = lines.map(line => JSON.parse(line));

    log('info', ` ${entries.length}개 영상 데이터 로드`);
    log('info', '');

    // 통계
    const stats = {
        totalRestaurants: 0,
        koreanRestaurants: 0,
        overseasRestaurants: 0,
        coordsEnriched: 0,
        phoneEnriched: 0,
        alreadyComplete: 0,
        failed: 0,
        apiUsage: {
            kakao_only: 0,
            kakao_naver: 0
        }
    };

    // 데이터 보완 루프
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];

        if (!entry.restaurants || entry.restaurants.length === 0) {
            continue;
        }

        for (let j = 0; j < entry.restaurants.length; j++) {
            const restaurant = entry.restaurants[j];
            stats.totalRestaurants++;

            // 해외 식당 판별
            const isKorean = isKoreanAddress(restaurant.address);

            if (!isKorean) {
                stats.overseasRestaurants++;
                log('overseas', `[${stats.totalRestaurants}] 해외 식당 스킵: ${restaurant.name || 'Unknown'}`);
                continue;
            }

            stats.koreanRestaurants++;

            // 보완 필요 여부 확인
            const needCoords = !restaurant.lat || !restaurant.lng;
            const needPhone = !restaurant.phone;

            if (!needCoords && !needPhone) {
                stats.alreadyComplete++;
                continue;
            }

            log('info', `[${stats.totalRestaurants}] 보완 시도: ${restaurant.name} (좌표:${needCoords ? '' : ''}, 전화:${needPhone ? '' : ''})`);

            // API 호출
            const result = await enrichKoreanData(restaurant.name, restaurant.address);

            if (result) {
                const updatedRestaurant = { ...restaurant };
                let isUpdated = false;

                // 1. 좌표 보완
                if (needCoords && result.lat && result.lng) {
                    updatedRestaurant.lat = result.lat;
                    updatedRestaurant.lng = result.lng;
                    updatedRestaurant.road_address = result.road_address || restaurant.road_address;
                    updatedRestaurant.jibun_address = result.jibun_address || restaurant.jibun_address;
                    updatedRestaurant.geocoded_place_name = result.place_name;
                    updatedRestaurant.geocoding_source = result.place_name ? 'kakao_keyword' : 'kakao_address';
                    stats.coordsEnriched++;
                    isUpdated = true;
                    log('coord', `  → 좌표 확보: (${result.lat.toFixed(6)}, ${result.lng.toFixed(6)})`);
                }

                // 2. 전화번호 보완
                if (needPhone && result.phone) {
                    updatedRestaurant.phone = result.phone;
                    updatedRestaurant.phone_source = result.phone_source;
                    stats.phoneEnriched++;
                    isUpdated = true;
                    const sourceLabel = result.phone_source === 'naver_api' ? 'NAVER' : 'KAKAO';
                    log('phone', `  → 전화번호 확보: ${result.phone} [${sourceLabel}]`);
                }

                if (isUpdated) {
                    entry.restaurants[j] = updatedRestaurant;
                    if (result.api_source === 'kakao+naver') stats.apiUsage.kakao_naver++;
                    else stats.apiUsage.kakao_only++;
                }
            } else {
                if (needCoords) {
                    stats.failed++;
                    log('warning', `  → 보완 실패 (API 검색 불가)`);
                }
            }

            // API Rate Limit (500ms-1초 랜덤 딜레이)
            const delay = 500 + Math.floor(Math.random() * 500);
            await sleep(delay);
        }
    }

    // 결과 저장
    const outputContent = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
    fs.writeFileSync(inputFile, outputContent, 'utf-8');

    // 통계 출력
    const duration = Date.now() - startTime;

    log('info', '');
    log('info', '==========================================================');
    log('success', '               데이터 보완 완료 (Completed)                ');
    log('info', '==========================================================');
    log('info', '');
    log('info', '[처리 통계]');
    log('info', `  총 맛집: ${stats.totalRestaurants}개`);
    log('info', `  ├─ 한국: ${stats.koreanRestaurants}개`);
    log('info', `  └─ 해외: ${stats.overseasRestaurants}개 (API 스킵)`);
    log('info', '');
    log('info', '[보완 결과]');
    log('info', `  좌표 보완: ${stats.coordsEnriched}개`);
    log('info', `  전화번호 보완: ${stats.phoneEnriched}개`);
    log('info', `  이미 완료: ${stats.alreadyComplete}개`);
    log('info', `  보완 실패: ${stats.failed}개`);
    log('info', '');
    log('info', '[API 사용]');
    log('info', `  Kakao 단독: ${stats.apiUsage.kakao_only}회`);
    log('info', `  Kakao+Naver: ${stats.apiUsage.kakao_naver}회`);
    log('info', '');
    log('info', `소요 시간: ${Math.round(duration / 1000)}초`);
    log('info', '='.repeat(60));
}

main().catch(error => {
    log('error', `오류: ${error.message}`);
    process.exit(1);
});

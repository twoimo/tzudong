/**
 * 맛집 데이터에 위도/경도 좌표 추가
 * 카카오 지오코딩 API 사용
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

// 설정
const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;

if (!KAKAO_REST_API_KEY) {
    console.error('❌ KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다.');
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
    const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌', debug: '🔍' };
    console.log(`[${time}] ${icons[level] || ''} ${msg}`);
}

/**
 * 카카오 주소 검색 API
 */
async function geocodeWithKakao(address) {
    if (!address || address.trim() === '') {
        return null;
    }

    try {
        const encodedAddress = encodeURIComponent(address.trim());
        const apiUrl = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodedAddress}`;

        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `KakaoAK ${KAKAO_REST_API_KEY}`
            }
        });

        if (!response.ok) {
            log('warning', `카카오 API 실패 (${response.status}): ${address}`);
            return null;
        }

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
                };
            }
        }

        // 주소 검색 실패 시 키워드 검색으로 폴백
        return await geocodeWithKeyword(address);

    } catch (error) {
        log('warning', `카카오 API 오류: ${error.message}`);
        return null;
    }
}

/**
 * 카카오 키워드 검색 API (폴백)
 */
async function geocodeWithKeyword(query) {
    try {
        const encodedQuery = encodeURIComponent(query.trim());
        const apiUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodedQuery}`;

        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `KakaoAK ${KAKAO_REST_API_KEY}`
            }
        });

        if (!response.ok) {
            return null;
        }

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
                };
            }
        }

        return null;

    } catch (error) {
        return null;
    }
}

/**
 * 맛집 이름 + 주소로 검색 (더 정확한 결과)
 */
async function geocodeWithNameAndAddress(name, address) {
    // 1. 맛집 이름으로 먼저 검색
    if (name) {
        const result = await geocodeWithKeyword(name);
        if (result) {
            log('debug', `이름으로 좌표 획득: ${name} → (${result.lat}, ${result.lng})`);
            return result;
        }
    }

    // 2. 주소로 검색
    if (address) {
        const result = await geocodeWithKakao(address);
        if (result) {
            log('debug', `주소로 좌표 획득: ${address} → (${result.lat}, ${result.lng})`);
            return result;
        }
    }

    // 3. 맛집 이름 + 지역으로 검색
    if (name && address) {
        // 주소에서 지역명 추출 (예: "서울 강남구" → "강남")
        const regionMatch = address.match(/([가-힣]+구|[가-힣]+시|[가-힣]+동)/);
        if (regionMatch) {
            const searchQuery = `${name} ${regionMatch[1]}`;
            const result = await geocodeWithKeyword(searchQuery);
            if (result) {
                log('debug', `조합 검색으로 좌표 획득: ${searchQuery} → (${result.lat}, ${result.lng})`);
                return result;
            }
        }
    }

    return null;
}

/**
 * sleep 함수
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 메인 실행
 */
async function main() {
    log('info', '='.repeat(60));
    log('info', '  좌표 보완 시작 (지오코딩)');
    log('info', '='.repeat(60));

    const startTime = Date.now();

    // 입력 파일 찾기
    let inputFile = path.join(TODAY_PATH, 'meatcreator_restaurants.jsonl');

    // 오늘 폴더에 없으면 가장 최근 폴더에서 찾기
    if (!fs.existsSync(inputFile)) {
        const folders = fs.readdirSync(DATA_DIR)
            .filter(f => /^\d{2}-\d{2}-\d{2}$/.test(f))
            .sort()
            .reverse();

        for (const folder of folders) {
            const filePath = path.join(DATA_DIR, folder, 'meatcreator_restaurants.jsonl');
            if (fs.existsSync(filePath)) {
                inputFile = filePath;
                log('info', `최근 데이터 파일 사용: ${folder}`);
                break;
            }
        }
    }

    if (!fs.existsSync(inputFile)) {
        log('error', '맛집 데이터 파일이 없습니다. 먼저 extract-addresses.js를 실행하세요.');
        process.exit(1);
    }

    log('info', `입력 파일: ${inputFile}`);

    // 데이터 로드
    const content = fs.readFileSync(inputFile, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    const entries = lines.map(line => JSON.parse(line));

    log('info', `${entries.length}개 영상 데이터 로드`);

    // 통계
    const stats = {
        totalRestaurants: 0,
        alreadyHasCoords: 0,
        enriched: 0,
        failed: 0,
        bySource: {
            google_url: 0,
            kakao_place: 0,
            kakao_address: 0,
            kakao_keyword: 0,
        },
        byMapType: {
            google: 0,
            naver: 0,
            kakao: 0,
            none: 0,
        }
    };

    // 좌표 보완
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];

        if (!entry.restaurants || entry.restaurants.length === 0) {
            continue;
        }

        for (let j = 0; j < entry.restaurants.length; j++) {
            const restaurant = entry.restaurants[j];
            stats.totalRestaurants++;

            // 지도 URL 형태 통계
            const mapType = restaurant.map_type || 'none';
            stats.byMapType[mapType] = (stats.byMapType[mapType] || 0) + 1;

            // 이미 좌표가 있는 경우 스킵
            if (restaurant.lat && restaurant.lng) {
                stats.alreadyHasCoords++;
                // 좌표 출처 통계
                if (restaurant.geocoding_source) {
                    stats.bySource[restaurant.geocoding_source] = (stats.bySource[restaurant.geocoding_source] || 0) + 1;
                }
                continue;
            }

            // 주소가 없는 경우
            if (!restaurant.address && !restaurant.name) {
                stats.failed++;
                continue;
            }

            log('info', `[${stats.totalRestaurants}] 지오코딩: ${restaurant.name || 'Unknown'}`);

            // 지오코딩 시도
            const result = await geocodeWithNameAndAddress(
                restaurant.name,
                restaurant.address
            );

            if (result) {
                const geocodingSource = result.place_name ? 'kakao_keyword' : 'kakao_address';
                entry.restaurants[j] = {
                    ...restaurant,
                    lat: result.lat,
                    lng: result.lng,
                    road_address: result.road_address || restaurant.road_address,
                    jibun_address: result.jibun_address || restaurant.jibun_address,
                    geocoded_place_name: result.place_name,
                    geocoding_source: geocodingSource,
                };
                stats.enriched++;
                stats.bySource[geocodingSource] = (stats.bySource[geocodingSource] || 0) + 1;
                log('success', `  → 좌표 획득: (${result.lat}, ${result.lng}) [${geocodingSource}]`);
            } else {
                stats.failed++;
                log('warning', `  → 좌표 획득 실패`);
            }

            // API 호출 간격 (100ms)
            await sleep(100);
        }
    }

    // 결과 저장 (원본 파일 덮어쓰기)
    const outputContent = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
    fs.writeFileSync(inputFile, outputContent, 'utf-8');

    // 통계 출력
    const duration = Date.now() - startTime;

    log('info', '');
    log('info', '='.repeat(60));
    log('success', '좌표 보완 완료');
    log('info', '='.repeat(60));
    log('info', `총 맛집: ${stats.totalRestaurants}개`);
    log('info', `이미 좌표 있음: ${stats.alreadyHasCoords}개`);
    log('success', `좌표 보완됨: ${stats.enriched}개`);
    log('warning', `좌표 획득 실패: ${stats.failed}개`);
    log('info', '');
    log('info', '📍 지도 URL 형태별:');
    log('info', `  - 구글 지도: ${stats.byMapType.google || 0}개`);
    log('info', `  - 네이버 지도: ${stats.byMapType.naver || 0}개`);
    log('info', `  - 카카오 지도: ${stats.byMapType.kakao || 0}개`);
    log('info', `  - 지도 URL 없음: ${stats.byMapType.none || 0}개`);
    log('info', '');
    log('info', '🔍 좌표 출처별:');
    log('info', `  - 구글 URL 직접 추출: ${stats.bySource.google_url || 0}개`);
    log('info', `  - 카카오 placeId: ${stats.bySource.kakao_place || 0}개`);
    log('info', `  - 카카오 주소 검색: ${stats.bySource.kakao_address || 0}개`);
    log('info', `  - 카카오 키워드 검색: ${stats.bySource.kakao_keyword || 0}개`);
    log('info', '');
    log('info', `소요 시간: ${Math.round(duration / 1000)}초`);
    log('info', '='.repeat(60));
}

main().catch(error => {
    log('error', `오류: ${error.message}`);
    process.exit(1);
});

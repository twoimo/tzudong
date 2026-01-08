/**
 * RULE 기반 평가 스크립트
 * 
 * 기능:
 * 1. 카테고리 유효성 검증 (15개 허용 목록)
 * 2. 위치 정합성 검증 (Naver Local Search + NCP Geocoding)
 * 
 * Input: meatcreator_restaurants.jsonl
 * Output: 동일 파일에 evaluation_results 필드 추가
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
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const NCP_KEY_ID = process.env.NCP_MAPS_KEY_ID || process.env.NCP_KEY_ID;
const NCP_KEY = process.env.NCP_MAPS_KEY || process.env.NCP_KEY;

// 유효한 카테고리 목록
const VALID_CATEGORIES = [
    '치킨', '중식', '돈까스·회', '피자', '패스트푸드', '찜·탕',
    '족발·보쌈', '분식', '카페·디저트', '한식', '고기', '양식',
    '아시안', '야식', '도시락'
];

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
        eval: '[EVAL]',
        cat: '[CAT]',
        loc: '[LOC]'
    };
    console.log(`[${time}] ${tags[level] || '[LOG]'} ${msg}`);
}

// API 통계
const apiStats = {
    naverCalls: 0,
    ncpCalls: 0,
    naverErrors: 0,
    ncpErrors: 0
};

/**
 * 문자열 정규화
 */
function normSpace(s) {
    if (!s) return '';
    return s.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/**
 * 주소에서 층 정보 제거
 */
function removeFloorInfo(addr) {
    if (!addr) return '';
    return addr.replace(/\s*(지하\s*\d+층|\d+층)\s*$/, '').trim();
}

/**
 * 주소에서 지역명 추출
 */
function extractRegion(addr) {
    if (!addr) return '';
    
    // 특별시/광역시
    let match = addr.match(/(\w+특별시|\w+광역시)/);
    if (match) return match[1];
    
    // 시/군/구
    match = addr.match(/(\w+시|\w+군|\w+구)/);
    if (match) return match[1];
    
    return '';
}

/**
 * 한국 주소인지 판별
 */
function isKoreanAddress(address) {
    if (!address) return false;
    const hasKorean = /[가-힣]/.test(address);
    const koreanKeywords = ['서울', '부산', '인천', '대구', '광주', '대전', '울산', '세종',
        '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
    const hasKoreanKeyword = koreanKeywords.some(kw => address.includes(kw));
    return hasKorean && hasKoreanKeyword;
}

/**
 * Haversine 거리 계산 (미터)
 */
function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000.0;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
              Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * 네이버 지역 검색 API
 */
async function naverLocalSearch(query, display = 5) {
    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) return [];
    if (!query || query.trim() === '') return [];
    
    apiStats.naverCalls++;
    
    try {
        const encodedQuery = encodeURIComponent(normSpace(query));
        const apiUrl = `https://openapi.naver.com/v1/search/local.json?query=${encodedQuery}&display=${display}`;
        
        const response = await fetch(apiUrl, {
            headers: {
                'X-Naver-Client-Id': NAVER_CLIENT_ID,
                'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
            }
        });
        
        if (!response.ok) {
            apiStats.naverErrors++;
            return [];
        }
        
        const data = await response.json();
        const items = data.items || [];
        
        return items.map(item => ({
            title: normSpace(item.title.replace(/<\/?b>/g, '')),
            address: normSpace(item.address || item.roadAddress || ''),
            roadAddress: normSpace(item.roadAddress || ''),
            mapx: item.mapx,
            mapy: item.mapy
        }));
    } catch (error) {
        apiStats.naverErrors++;
        return [];
    }
}

/**
 * NCP Geocoding API - 지번주소 반환
 */
async function ncpGeocodeToJibun(query) {
    if (!NCP_KEY_ID || !NCP_KEY) return null;
    if (!query || query.trim() === '') return null;
    
    apiStats.ncpCalls++;
    
    try {
        const encodedQuery = encodeURIComponent(normSpace(query));
        const apiUrl = `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodedQuery}`;
        
        const response = await fetch(apiUrl, {
            headers: {
                'X-NCP-APIGW-API-KEY-ID': NCP_KEY_ID,
                'X-NCP-APIGW-API-KEY': NCP_KEY
            }
        });
        
        if (!response.ok) {
            apiStats.ncpErrors++;
            return null;
        }
        
        const data = await response.json();
        const addresses = data.addresses || [];
        
        if (addresses.length > 0) {
            return normSpace(addresses[0].jibunAddress || '');
        }
        return null;
    } catch (error) {
        apiStats.ncpErrors++;
        return null;
    }
}

/**
 * NCP Geocoding API - 전체 주소 정보 반환
 */
async function ncpGeocodeAddresses(addr) {
    if (!NCP_KEY_ID || !NCP_KEY) return null;
    if (!addr || addr.trim() === '') return null;
    
    apiStats.ncpCalls++;
    
    try {
        const encodedQuery = encodeURIComponent(normSpace(addr));
        const apiUrl = `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodedQuery}`;
        
        const response = await fetch(apiUrl, {
            headers: {
                'X-NCP-APIGW-API-KEY-ID': NCP_KEY_ID,
                'X-NCP-APIGW-API-KEY': NCP_KEY
            }
        });
        
        if (!response.ok) {
            apiStats.ncpErrors++;
            return null;
        }
        
        const data = await response.json();
        return data.addresses || null;
    } catch (error) {
        apiStats.ncpErrors++;
        return null;
    }
}

/**
 * 카테고리 유효성 평가
 */
function evaluateCategoryValidity(restaurants) {
    return restaurants.map(r => {
        const name = normSpace(r.name || '');
        const categories = r.categories || (r.category ? [r.category] : []);
        
        // 최소 하나의 카테고리가 유효 목록에 있으면 true
        const isValid = categories.some(cat => VALID_CATEGORIES.includes(cat));
        
        return {
            name,
            eval_value: isValid
        };
    });
}

/**
 * 단일 레스토랑 위치 평가
 */
async function evaluateLocationOne(restaurant) {
    const name = normSpace(restaurant.name || '');
    const originAddressRaw = normSpace(restaurant.address || restaurant.origin_address || '');
    const originAddress = removeFloorInfo(originAddressRaw);
    
    // 해외 식당은 스킵
    if (!isKoreanAddress(originAddress)) {
        return {
            name,
            eval_value: true, // 해외 식당은 평가 스킵 (통과 처리)
            origin_address: originAddress,
            naver_address: null,
            falseMessage: null,
            skipped: true
        };
    }
    
    // 1단계: name으로 검색
    const nameCands = await naverLocalSearch(name, 5);
    await sleep(300);
    
    // 2단계: name + 지역으로 검색
    const region = extractRegion(originAddress);
    let nameRegionCands = [];
    if (region) {
        nameRegionCands = await naverLocalSearch(`${name} ${region}`, 5);
        await sleep(300);
    }
    
    // 3단계: origin_address를 NCP 지오코딩으로 지번주소 변환
    const geocodedJibun = await ncpGeocodeToJibun(originAddress);
    await sleep(300);
    
    if (!geocodedJibun) {
        return {
            name,
            eval_value: false,
            origin_address: originAddress,
            naver_address: null,
            falseMessage: '1단계 실패: 주소 지오코딩 실패'
        };
    }
    
    // 후보 합치기 및 중복 제거
    const allCandidates = [...nameCands, ...nameRegionCands];
    const seenAddresses = new Set();
    const uniqueCandidates = allCandidates.filter(cand => {
        const addrKey = normSpace(cand.address);
        if (addrKey && !seenAddresses.has(addrKey)) {
            seenAddresses.add(addrKey);
            return true;
        }
        return false;
    });
    
    if (uniqueCandidates.length === 0) {
        return {
            name,
            eval_value: false,
            origin_address: originAddress,
            naver_address: null,
            falseMessage: '1단계 실패: 검색 결과 없음'
        };
    }
    
    // 1단계: 지번주소 일치 비교
    const geocodedAddrNorm = normSpace(geocodedJibun);
    let matchedResult = null;
    
    for (const cand of uniqueCandidates) {
        const candAddrNorm = normSpace(cand.address);
        if (candAddrNorm === geocodedAddrNorm) {
            matchedResult = cand;
            break;
        }
    }
    
    // 2단계: 거리 기반 매칭
    let minDist = Infinity;
    if (!matchedResult) {
        const geocodedAddresses = await ncpGeocodeAddresses(originAddress);
        await sleep(300);
        
        if (!geocodedAddresses || geocodedAddresses.length === 0) {
            return {
                name,
                eval_value: false,
                origin_address: originAddress,
                naver_address: null,
                falseMessage: '2단계 실패: 지오코딩 정보 없음'
            };
        }
        
        const geocodedLat = parseFloat(geocodedAddresses[0].y || 0);
        const geocodedLng = parseFloat(geocodedAddresses[0].x || 0);
        
        for (const cand of uniqueCandidates) {
            const candJibun = cand.address;
            if (!candJibun) continue;
            
            const candGeocoded = await ncpGeocodeAddresses(candJibun);
            await sleep(200);
            
            if (candGeocoded && candGeocoded.length > 0) {
                const candLat = parseFloat(candGeocoded[0].y || 0);
                const candLng = parseFloat(candGeocoded[0].x || 0);
                const dist = haversineM(geocodedLat, geocodedLng, candLat, candLng);
                
                if (dist <= 20.0 && dist < minDist) {
                    minDist = dist;
                    matchedResult = cand;
                }
            }
        }
        
        if (!matchedResult) {
            return {
                name,
                eval_value: false,
                origin_address: originAddress,
                naver_address: null,
                falseMessage: '2단계 실패: 20m 이내 후보 없음'
            };
        }
    }
    
    // 매칭된 결과의 주소로 상세 정보 얻기
    const matchedAddr = matchedResult.address || matchedResult.roadAddress;
    const matchedGeocoded = await ncpGeocodeAddresses(matchedAddr);
    
    let naverAddress = null;
    if (matchedGeocoded && matchedGeocoded.length > 0) {
        const addrInfo = matchedGeocoded[0];
        naverAddress = {
            roadAddress: addrInfo.roadAddress || '',
            jibunAddress: addrInfo.jibunAddress || '',
            englishAddress: addrInfo.englishAddress || '',
            x: addrInfo.x || '',
            y: addrInfo.y || '',
            distance: minDist !== Infinity ? minDist : 0
        };
    }
    
    return {
        name,
        eval_value: true,
        origin_address: originAddress,
        naver_address: naverAddress ? [naverAddress] : null,
        falseMessage: null
    };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 메인 실행
 */
async function main() {
    log('info', '='.repeat(60));
    log('info', ' RULE 기반 평가 시작');
    log('info', '='.repeat(60));
    
    const startTime = Date.now();
    
    // API 키 확인
    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
        log('warning', 'NAVER API 키가 없습니다. 위치 검증이 제한됩니다.');
    }
    if (!NCP_KEY_ID || !NCP_KEY) {
        log('warning', 'NCP API 키가 없습니다. 지오코딩이 제한됩니다.');
    }
    
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
        log('error', '맛집 데이터 파일이 없습니다.');
        process.exit(1);
    }
    
    log('info', ` 입력 파일: ${inputFile}`);
    
    // 데이터 로드
    const content = fs.readFileSync(inputFile, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    const entries = lines.map(line => JSON.parse(line));
    
    log('info', ` ${entries.length}개 영상 데이터 로드`);
    
    // 통계
    const stats = {
        totalRestaurants: 0,
        categoryPassed: 0,
        categoryFailed: 0,
        locationPassed: 0,
        locationFailed: 0,
        locationSkipped: 0
    };
    
    // 평가 루프
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const restaurants = entry.analysis || entry.restaurants || [];
        
        if (restaurants.length === 0) continue;
        
        log('info', `[${i + 1}/${entries.length}] 평가 중: ${entry.videoId || 'unknown'}`);
        
        // 카테고리 평가
        const categoryEval = evaluateCategoryValidity(restaurants);
        
        // 위치 평가
        const locationEval = [];
        for (const r of restaurants) {
            stats.totalRestaurants++;
            const result = await evaluateLocationOne(r);
            locationEval.push(result);
            
            // 통계 업데이트
            if (result.skipped) {
                stats.locationSkipped++;
            } else if (result.eval_value) {
                stats.locationPassed++;
            } else {
                stats.locationFailed++;
                log('loc', `  ✗ ${result.name}: ${result.falseMessage}`);
            }
        }
        
        // 카테고리 통계
        categoryEval.forEach(e => {
            if (e.eval_value) stats.categoryPassed++;
            else stats.categoryFailed++;
        });
        
        // evaluation_results 필드 추가
        entry.evaluation_results = {
            category_validity_TF: categoryEval,
            location_match_TF: locationEval
        };
        
        // 진행 상황 출력
        if ((i + 1) % 10 === 0) {
            log('info', `진행: ${i + 1}/${entries.length} 완료`);
        }
    }
    
    // 결과 저장 (원본 파일 덮어쓰기)
    const outputContent = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(inputFile, outputContent, 'utf-8');
    
    // 통계 출력
    const duration = Date.now() - startTime;
    
    log('info', '');
    log('info', '='.repeat(60));
    log('success', ' RULE 기반 평가 완료');
    log('info', '='.repeat(60));
    log('info', '');
    log('info', '[평가 결과]');
    log('info', `  총 맛집: ${stats.totalRestaurants}개`);
    log('info', '');
    log('cat', `  카테고리 통과: ${stats.categoryPassed}개`);
    log('cat', `  카테고리 실패: ${stats.categoryFailed}개`);
    log('info', '');
    log('loc', `  위치 통과: ${stats.locationPassed}개`);
    log('loc', `  위치 실패: ${stats.locationFailed}개`);
    log('loc', `  위치 스킵 (해외): ${stats.locationSkipped}개`);
    log('info', '');
    log('info', '[API 사용량]');
    log('info', `  Naver: ${apiStats.naverCalls}회 (에러: ${apiStats.naverErrors})`);
    log('info', `  NCP: ${apiStats.ncpCalls}회 (에러: ${apiStats.ncpErrors})`);
    log('info', '');
    log('info', `소요 시간: ${Math.round(duration / 1000)}초`);
    log('info', '='.repeat(60));
}

main().catch(error => {
    log('error', `오류: ${error.message}`);
    console.error(error);
    process.exit(1);
});

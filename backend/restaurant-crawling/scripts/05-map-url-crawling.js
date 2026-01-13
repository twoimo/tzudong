/**
 * 05-naver-map-crawling.js
 * 정육왕 채널용 지도 기반 음식점 정보 수집
 * 
 * 기능:
 * 1. 영상 설명에서 네이버/카카오/구글 지도 URL 추출
 * 2. Puppeteer로 지도 접속 → 상호명, 주소, 전화번호, 카테고리 수집
 * 3. 네이버 지도: NCP 지오코딩으로 좌표 검증
 * 4. 구글/카카오 지도: 네이버 검색 API로 상호명/주소 보완 → NCP 지오코딩
 * 5. Gemini CLI로 youtuber_review 추출
 * 
 * 사용법:
 *   node 05-naver-map-crawling.js --channel meatcreator
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import yaml from 'js-yaml';
import { execSync, spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env 로드
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    config({ path: envPath });
}

// 카테고리 매핑
const CATEGORY_MAP = {
    '한식': '한식', '고기': '고기', '고깃집': '고기', '삼겹살': '고기',
    '갈비': '고기', '곱창': '고기', '스테이크': '양식', '양식': '양식',
    '이탈리안': '양식', '중식': '중식', '중국집': '중식', '일식': '돈까스·회',
    '초밥': '돈까스·회', '회': '돈까스·회', '돈까스': '돈까스·회',
    '치킨': '치킨', '피자': '피자', '패스트푸드': '패스트푸드', '햄버거': '패스트푸드',
    '찜': '찜·탕', '탕': '찜·탕', '찌개': '찜·탕', '족발': '족발·보쌈',
    '보쌈': '족발·보쌈', '분식': '분식', '떡볶이': '분식', '카페': '카페·디저트',
    '디저트': '카페·디저트', '베이커리': '카페·디저트', '아시안': '아시안',
    '태국': '아시안', '베트남': '아시안', '야식': '야식', '도시락': '도시락'
};

const VALID_CATEGORIES = [
    '치킨', '중식', '돈까스·회', '피자', '패스트푸드', '찜·탕',
    '족발·보쌈', '분식', '카페·디저트', '한식', '고기', '양식', '아시안', '야식', '도시락'
];

// 로그 함수
function log(level, msg) {
    const time = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' });
    const tags = { info: '[INFO]', success: '[OK]', warning: '[WARN]', error: '[ERR]', debug: '[DBG]' };
    if (level === 'debug' && process.env.DEBUG !== 'true') return;
    console.log(`[${time}] ${tags[level] || '[LOG]'} ${msg}`);
}

// config 로드
function loadChannelsConfig() {
    const configPath = path.resolve(__dirname, '../../config/channels.yaml');
    if (!fs.existsSync(configPath)) throw new Error(`설정 파일 없음: ${configPath}`);
    return yaml.load(fs.readFileSync(configPath, 'utf-8'));
}

// 텍스트 정제
function cleanText(text) {
    if (!text) return null;
    return text.replace(/[\x00-\x1F\x7F]/g, '').replace(/\s*:\s*네이버.*$/, '').trim();
}

// 카테고리 정규화
function normalizeCategory(category) {
    if (!category) return null;
    for (const [key, value] of Object.entries(CATEGORY_MAP)) {
        if (category.includes(key)) return value;
    }
    return null;
}

// 거리 계산 (Haversine)
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // 지구 반경 (m)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// 시군구 추출 (시도 제외)
function extractSigungu(address) {
    if (!address) return null;
    // 시도 제거: 서울특별시, 인천광역시, 경기도 등
    const withoutSido = address.replace(/^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원도|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|제주특별자치도|서울시?|부산시?|대구시?|인천시?|광주시?|대전시?|울산시?|세종시?|경기|강원|충북|충남|전북|전남|경북|경남|제주)\s*/, '');
    return withoutSido.trim();
}

// NCP 지오코딩 API
async function ncpGeocode(address) {
    const keyId = process.env.NCP_MAPS_KEY_ID_BYEON;
    const key = process.env.NCP_MAPS_KEY_BYEON;
    if (!keyId || !key) {
        log('warning', 'NCP API 키 없음');
        return null;
    }

    try {
        const url = `https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(address)}`;
        const response = await fetch(url, {
            headers: {
                'X-NCP-APIGW-API-KEY-ID': keyId,
                'X-NCP-APIGW-API-KEY': key
            }
        });

        if (!response.ok) return null;

        const data = await response.json();
        if (data.addresses && data.addresses.length > 0) {
            const addr = data.addresses[0];
            return {
                roadAddress: addr.roadAddress,
                jibunAddress: addr.jibunAddress,
                englishAddress: addr.englishAddress,
                addressElements: addr.addressElements,
                lat: parseFloat(addr.y),
                lng: parseFloat(addr.x)
            };
        }
    } catch (err) {
        log('debug', `NCP 지오코딩 실패: ${err.message}`);
    }
    return null;
}

// 네이버 검색 API (구글/카카오 지도에서 가져온 정보를 보완)
// display=3으로 3개 결과 반환
async function searchNaverApi(query) {
    const clientId = process.env.NAVER_CLIENT_ID_BYEON;
    const clientSecret = process.env.NAVER_CLIENT_SECRET_BYEON;
    if (!clientId || !clientSecret) {
        log('warning', '네이버 검색 API 키 없음');
        return [];
    }

    try {
        const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=3&sort=random`;
        const response = await fetch(url, {
            headers: {
                'X-Naver-Client-Id': clientId,
                'X-Naver-Client-Secret': clientSecret
            }
        });

        if (!response.ok) return [];

        const data = await response.json();
        if (data.items && data.items.length > 0) {
            return data.items.map(item => ({
                name: item.title.replace(/<[^>]+>/g, ''),
                address: item.address,         // 지번주소
                roadAddress: item.roadAddress, // 도로명주소
                category: item.category
            }));
        }
    } catch (err) {
        log('debug', `네이버 검색 API 실패: ${err.message}`);
    }
    return [];
}

// Puppeteer 인스턴스
let puppeteerBrowser = null;
let puppeteerModule = null;

async function initPuppeteer() {
    if (puppeteerModule) return true;
    try {
        const puppeteerExtra = await import('puppeteer-extra');
        const StealthPlugin = await import('puppeteer-extra-plugin-stealth');
        puppeteerExtra.default.use(StealthPlugin.default());
        puppeteerModule = puppeteerExtra;
        return true;
    } catch {
        try {
            puppeteerModule = await import('puppeteer');
            return true;
        } catch {
            log('error', 'Puppeteer 모듈 없음');
            return false;
        }
    }
}

async function getBrowser() {
    if (!puppeteerModule) return null;
    if (!puppeteerBrowser) {
        const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
        puppeteerBrowser = await puppeteerModule.default.launch({
            headless: true,
            executablePath,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
    }
    return puppeteerBrowser;
}

async function closeBrowser() {
    if (puppeteerBrowser) {
        await puppeteerBrowser.close();
        puppeteerBrowser = null;
    }
}

// 지도 URL 추출 (네이버, 카카오, 구글)
function extractMapUrls(text) {
    if (!text) return [];
    const patterns = [
        // 네이버 지도
        /https?:\/\/(?:m\.|map\.|place\.)?naver\.(?:com|me)\/[^\s\)\}\]"'<>]+/gi,
        /https?:\/\/naver\.me\/[^\s\)\}\]"'<>]+/gi,
        // 카카오 지도
        /https?:\/\/(?:map|place\.map)\.kakao\.com\/[^\s\)\}\]"'<>]+/gi,
        /https?:\/\/kko\.to\/[^\s\)\}\]"'<>]+/gi,
        // 구글 지도
        /https?:\/\/(?:www\.)?google\.com\/maps\/[^\s\)\}\]"'<>]+/gi,
        /https?:\/\/maps\.app\.goo\.gl\/[^\s\)\}\]"'<>]+/gi,
        /https?:\/\/goo\.gl\/maps\/[^\s\)\}\]"'<>]+/gi,
    ];
    const urls = [];
    for (const pattern of patterns) {
        const matches = text.match(pattern) || [];
        urls.push(...matches);
    }
    return [...new Set(urls)];
}

// URL 타입 판별
function getMapType(url) {
    if (url.includes('naver.com') || url.includes('naver.me')) return 'naver';
    if (url.includes('kakao.com') || url.includes('kko.to')) return 'kakao';
    if (url.includes('google.com') || url.includes('goo.gl') || url.includes('maps.app')) return 'google';
    return 'unknown';
}

// 네이버 지도에서 장소 정보 수집
async function collectFromNaverMap(page, mapUrl) {
    try {
        // 단축 URL 처리
        let url = mapUrl;
        if (url.includes('naver.me')) {
            try {
                const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
                url = response.url;
            } catch {}
        }

        // 유효하지 않은 URL 스킵
        if (url.includes('form.naver.com') || url.includes('smartstore.naver.com')) {
            return null;
        }

        // place ID 추출
        const patterns = [
            /place\.naver\.com\/(?:restaurant|place)\/(\d+)/,
            /map\.naver\.com\/p\/entry\/place\/(\d+)/,
            /pcmap\.place\.naver\.com\/(?:restaurant|place)\/(\d+)/,
        ];
        let placeId = null;
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) { placeId = match[1]; break; }
        }
        if (!placeId) return null;

        const placeUrl = `https://pcmap.place.naver.com/restaurant/${placeId}/home`;
        await page.goto(placeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000));

        // 주소/전화번호 펼치기 클릭
        try {
            await page.click('a.PkgBl, ._UCia');
            await new Promise(r => setTimeout(r, 1000));
        } catch {}
        try {
            await page.click('a.BfF3H');
            await new Promise(r => setTimeout(r, 1000));
        } catch {}

        // 정보 추출
        const placeInfo = await page.evaluate(() => {
            const result = { name: null, roadAddress: null, jibunAddress: null, phone: null, category: null };
            
            // 상호명
            const ogTitle = document.querySelector('meta[property="og:title"]');
            if (ogTitle) result.name = ogTitle.getAttribute('content')?.replace(/\s*:\s*네이버$/, '').trim();
            if (!result.name) {
                const nameEl = document.querySelector('span.GHAhO');
                if (nameEl) result.name = nameEl.textContent?.trim();
            }

            // 카테고리
            const categoryEl = document.querySelector('span.lnJFt');
            if (categoryEl) result.category = categoryEl.textContent?.trim();

            // 주소
            const rows = document.querySelectorAll('.nQ7Lh');
            rows.forEach(row => {
                const text = row.innerText;
                if (text.includes('도로명')) result.roadAddress = text.replace('도로명', '').replace(/복사/g, '').trim();
                if (text.includes('지번')) result.jibunAddress = text.replace('지번', '').replace(/복사/g, '').trim();
            });

            // 전화번호
            const phoneEl = document.querySelector('span.xlx7Q') || document.querySelector('a[href^="tel:"]');
            if (phoneEl) {
                let phone = phoneEl.textContent?.trim() || phoneEl.href?.replace('tel:', '');
                if (/^[\d\-+().\s]+$/.test(phone)) result.phone = phone;
            }

            return result;
        });

        // URL에서 좌표 추출
        const currentUrl = page.url();
        try {
            const urlObj = new URL(currentUrl);
            const lat = urlObj.searchParams.get('lat');
            const lng = urlObj.searchParams.get('lng');
            if (lat && lng) {
                placeInfo.originalLat = parseFloat(lat);
                placeInfo.originalLng = parseFloat(lng);
            }
        } catch {}

        placeInfo.description_map_url = mapUrl;
        placeInfo.name = cleanText(placeInfo.name);
        placeInfo.category = normalizeCategory(placeInfo.category);

        // 음식점명 또는 주소 없으면 실패
        if (!placeInfo.name || (!placeInfo.jibunAddress && !placeInfo.roadAddress)) {
            log('debug', `네이버 지도: 음식점명/주소 없음 - 실패`);
            return null;
        }

        return placeInfo;

    } catch (error) {
        log('debug', `네이버 지도 수집 실패: ${error.message}`);
        return null;
    }
}

// 카카오 지도에서 장소 정보 수집
async function collectFromKakaoMap(page, mapUrl) {
    try {
        // 단축 URL 처리
        let url = mapUrl;
        if (url.includes('kko.to')) {
            try {
                const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
                url = response.url;
            } catch {}
        }

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000));

        const placeInfo = await page.evaluate(() => {
            const result = { name: null, address: null };
            
            // OG 태그에서 추출
            const ogTitle = document.querySelector('meta[property="og:title"]');
            if (ogTitle) {
                let name = ogTitle.getAttribute('content');
                if (name && name.includes('|')) name = name.split('|')[0].trim();
                result.name = name;
            }
            
            const ogDesc = document.querySelector('meta[property="og:description"]');
            if (ogDesc) result.address = ogDesc.getAttribute('content');
            
            return result;
        });

        placeInfo.description_map_url = mapUrl;
        placeInfo.name = cleanText(placeInfo.name);
        placeInfo.mapType = 'kakao';

        // 음식점명 또는 주소 없으면 실패
        if (!placeInfo.name || !placeInfo.address) {
            log('debug', `카카오 지도: 음식점명/주소 없음 - 실패`);
            return null;
        }

        return placeInfo;

    } catch (error) {
        log('debug', `카카오 지도 수집 실패: ${error.message}`);
        return null;
    }
}

// 구글 지도에서 장소 정보 수집
async function collectFromGoogleMap(page, mapUrl) {
    try {
        // 단축 URL 처리
        let url = mapUrl;
        if (url.includes('goo.gl') || url.includes('maps.app')) {
            try {
                const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
                url = response.url;
            } catch {}
        }

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 3000));

        // URL에서 좌표 추출
        const currentUrl = page.url();
        let lat = null, lng = null;
        const coordMatch = currentUrl.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (coordMatch) {
            lat = parseFloat(coordMatch[1]);
            lng = parseFloat(coordMatch[2]);
        }

        const placeInfo = await page.evaluate(() => {
            const result = { name: null, address: null };
            
            // 상호명
            const nameEl = document.querySelector('h1.DUwDvf') || document.querySelector('h1');
            if (nameEl) result.name = nameEl.textContent?.trim();
            
            if (!result.name) {
                const ogTitle = document.querySelector('meta[property="og:title"]');
                if (ogTitle) {
                    let name = ogTitle.getAttribute('content');
                    if (name) name = name.replace(/ - Google 지도/g, '').replace(/ - Google Maps/g, '').trim();
                    result.name = name;
                }
            }
            
            // 주소
            const addressBtn = document.querySelector('button[data-item-id*="address"]');
            if (addressBtn) {
                const addrText = addressBtn.querySelector('.Io6YTe') || addressBtn.querySelector('.fontBodyMedium');
                if (addrText) result.address = addrText.textContent?.trim();
            }
            
            return result;
        });

        placeInfo.description_map_url = mapUrl;
        placeInfo.name = cleanText(placeInfo.name);
        placeInfo.originalLat = lat;
        placeInfo.originalLng = lng;
        placeInfo.mapType = 'google';

        // 음식점명 또는 주소 없으면 실패
        if (!placeInfo.name || !placeInfo.address) {
            log('debug', `구글 지도: 음식점명/주소 없음 - 실패`);
            return null;
        }

        return placeInfo;

    } catch (error) {
        log('debug', `구글 지도 수집 실패: ${error.message}`);
        return null;
    }
}
// 층/호 정규화 (숫자층, 숫자 층, 숫자호, 숫자 호, 콤마 포함)
function normalizeAddressForCompare(address) {
    if (!address) return '';
    // 맨 뒤의 "숫자층", "숫자 층", "숫자호", "숫자 호" 제거 (콤마 포함)
    let normalized = address.replace(/,?\s*\d+\s*층\s*$/, '').trim();
    normalized = normalized.replace(/,?\s*\d+\s*호\s*$/, '').trim();
    return normalized;
}

// 구글/카카오 지도에서 가져온 정보를 네이버 검색으로 보완
// 네이버 검색 3개 결과 중 시군구 일치하는 것 선택
// 검색 실패 또는 시군구 불일치시 null 반환 (실패 처리)
async function enrichWithNaverSearch(placeInfo) {
    if (!placeInfo || !placeInfo.name) return null;
    
    // 검색 쿼리: 상호명 + 시군구 (있으면)
    let query = placeInfo.name;
    if (placeInfo.address) {
        const sigungu = extractSigungu(placeInfo.address);
        if (sigungu) query = `${placeInfo.name} ${sigungu.split(' ')[0]}`;
    }
    
    // 네이버 검색 결과 3개 받아오기
    const naverResults = await searchNaverApi(query);
    if (!naverResults || naverResults.length === 0) {
        log('warning', `네이버 검색 실패 (폐업 등): ${placeInfo.name}`);
        return null;
    }
    
    // 원본 주소에서 시군구 추출 (층/호 정규화 후)
    const originalAddrNorm = normalizeAddressForCompare(placeInfo.address);
    const originalSigungu = extractSigungu(originalAddrNorm);
    
    if (!originalSigungu) {
        log('warning', `원본 주소에서 시군구 추출 실패: ${placeInfo.address}`);
        return null;
    }
    
    // 3개 결과 중 시군구 일치하는 것 찾기
    let matched = null;
    for (const item of naverResults) {
        // 지번주소 시군구 비교
        const jibunAddrNorm = normalizeAddressForCompare(item.address);
        const jibunSigungu = extractSigungu(jibunAddrNorm);
        
        // 도로명주소 시군구 비교
        const roadAddrNorm = normalizeAddressForCompare(item.roadAddress);
        const roadSigungu = extractSigungu(roadAddrNorm);
        
        if ((jibunSigungu && jibunSigungu === originalSigungu) ||
            (roadSigungu && roadSigungu === originalSigungu)) {
            matched = item;
            log('debug', `시군구 일치: ${placeInfo.name} -> ${item.name} (${originalSigungu})`);
            break;
        }
    }
    
    if (!matched) {
        log('warning', `시군구 일치 항목 없음 (실패 처리): ${placeInfo.name}`);
        return null;
    }
    
    // origin_name 저장 (크롤링에서 받은 원본 상호명)
    placeInfo.origin_name = placeInfo.name;
    delete placeInfo.name;  // name 필드 삭제
    
    // 선택된 결과로 덮어쓰기
    placeInfo.naver_name = matched.name;          // 네이버 검색 결과 상호명
    placeInfo.jibunAddress = matched.address;     // 지번주소
    placeInfo.roadAddress = matched.roadAddress;  // 도로명주소
    placeInfo.category = normalizeCategory(matched.category);
    
    return placeInfo;
}

// 필수 필드 검증 (05에서는 naver_name 필수, jibunAddress, lat, lng)
function hasRequiredFields(placeInfo) {
    if (!placeInfo) return false;
    if (!placeInfo.naver_name) return false;  // 네이버 검색 통과 시 항상 있음
    if (!placeInfo.jibunAddress) return false;
    if (placeInfo.lat == null || placeInfo.lng == null) return false;
    return true;
}

// lat/lng 검증 및 지오코딩
// 선택된 주소로 지오코딩 → 모든 주소 정보 채우기
// 원본 좌표 있으면 20m 비교 → 초과시 null 반환 (실패 처리)
// 원본 좌표 없으면 지오코딩 결과 그대로 사용
async function verifyAndGeocode(placeInfo) {
    const addressToGeocode = placeInfo.roadAddress || placeInfo.jibunAddress;
    if (!addressToGeocode) {
        log('warning', `지오코딩할 주소 없음: ${placeInfo.naver_name || placeInfo.origin_name}`);
        return null; // 주소 없으면 실패
    }

    const geocodeResult = await ncpGeocode(addressToGeocode);
    if (!geocodeResult) {
        log('warning', `지오코딩 실패: ${addressToGeocode}`);
        return null; // 지오코딩 실패 → 실패
    }

    // 원본 좌표가 있으면 20m 비교
    if (placeInfo.originalLat && placeInfo.originalLng) {
        const distance = calculateDistance(
            placeInfo.originalLat, placeInfo.originalLng,
            geocodeResult.lat, geocodeResult.lng
        );
        if (distance > 20) {
            log('warning', `좌표 20m 초과 (실패): ${placeInfo.naver_name || placeInfo.origin_name} - ${distance.toFixed(1)}m`);
            return null; // 20m 초과 → 실패 (원본 유지 아님)
        }
        log('debug', `좌표 검증 통과: ${placeInfo.naver_name || placeInfo.origin_name} - ${distance.toFixed(1)}m`);
    }

    // 지오코딩 결과로 모든 주소 정보 채우기
    placeInfo.lat = geocodeResult.lat;
    placeInfo.lng = geocodeResult.lng;
    placeInfo.roadAddress = geocodeResult.roadAddress || placeInfo.roadAddress;
    placeInfo.jibunAddress = geocodeResult.jibunAddress || placeInfo.jibunAddress;
    placeInfo.englishAddress = geocodeResult.englishAddress;
    placeInfo.addressElements = geocodeResult.addressElements;

    delete placeInfo.originalLat;
    delete placeInfo.originalLng;
    return placeInfo;
}

// Gemini CLI로 youtuber_review 추출
async function extractYoutuberReview(videoId, metaData, transcript, places) {
    const promptPath = path.resolve(__dirname, '../prompts/map_url_crawling_review.txt');
    const tempDir = path.resolve(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const tempPromptPath = path.join(tempDir, `prompt_${videoId}.txt`);
    const tempResponsePath = path.join(tempDir, `response_${videoId}.json`);

    // 프롬프트 생성
    const placeNames = places.map(p => p.name).filter(Boolean);
    const prompt = `
<영상 정보>
제목: ${metaData?.title || ''}
설명: ${metaData?.description?.substring(0, 500) || ''}
</영상 정보>

<자막>
${transcript?.substring(0, 5000) || '자막 없음'}
</자막>

<음식점 목록>
${placeNames.join('\n')}
</음식점 목록>

<출력 규칙>
1) **하나의 유튜브 링크에서 여러 개의 식당이 등장할 경우, 각 식당마다 별도의 JSON 객체를 생성하여 reviews 배열에 포함함.**
2) **최종 출력은 단일 JSON 객체로, 다음 구조를 따름:**
{
  "reviews": [
    {
      "origin_name": "음식점명",
      "youtuber_review": "리뷰 요약",
      "category": "카테고리 (위 목록 중 하나)"
      "reasoning_basis": 추론 근거(해당 식당에 대한 리뷰, 카테고리 정리한 근거) 작성(자막 타임스탬프 포함 권장).
    }, ...
  ]
}
3) **다른 설명, 마크다운 태그 없이 순수 JSON 객체만 출력함.**
4) **<작업 순서>에서 '예.'는 예시일 뿐이므로 출력 결과값으로 사용하지 않으며, 반드시 <작업 순서>에 따라 정리한 결과를 사용합니다.**
</출력 규칙>
`;

    fs.writeFileSync(tempPromptPath, prompt);

    // Gemini CLI 호출 (최대 3회 재시도)
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const model = process.env.PRIMARY_MODEL || 'gemini-2.5-flash';
            execSync(`gemini -m ${model} -f "${tempPromptPath}" --output-format json > "${tempResponsePath}"`, {
                timeout: 120000,
                encoding: 'utf-8'
            });

            // 응답 파싱
            const responseText = fs.readFileSync(tempResponsePath, 'utf-8');
            let parsed = JSON.parse(responseText);
            if (parsed.response) {
                // Gemini CLI wrapper 형식
                let jsonText = parsed.response;
                if (jsonText.includes('```json')) {
                    jsonText = jsonText.replace(/```json\n?/, '').replace(/```\s*$/, '');
                }
                parsed = JSON.parse(jsonText);
            }

            // Enum 검증
            if (parsed.reviews && Array.isArray(parsed.reviews)) {
                for (const review of parsed.reviews) {
                    if (review.category && !VALID_CATEGORIES.includes(review.category)) {
                        review.category = normalizeCategory(review.category);
                    }
                }
                return parsed.reviews;
            }
        } catch (err) {
            log('warning', `Gemini CLI 시도 ${attempt}/${maxRetries} 실패: ${err.message}`);
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 5000)); // 5초 대기
            }
        }
    }

    // 정리
    try { fs.unlinkSync(tempPromptPath); } catch {}
    try { fs.unlinkSync(tempResponsePath); } catch {}

    return [];
}

// 메인 함수
async function main() {
    const args = process.argv.slice(2);
    let targetChannel = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--channel' && args[i + 1]) {
            targetChannel = args[i + 1];
        }
    }

    // 정육왕(meatcreator)만 처리
    const ALLOWED_CHANNELS = ['meatcreator'];
    
    const config = loadChannelsConfig();
    let channels = targetChannel ? [targetChannel] : ALLOWED_CHANNELS;
    
    // 허용된 채널만 필터링
    channels = channels.filter(ch => ALLOWED_CHANNELS.includes(ch));
    
    if (channels.length === 0) {
        log('warning', '처리할 채널 없음 (이 스크립트는 정육왕 전용)');
        return;
    }

    if (!await initPuppeteer()) {
        log('error', 'Puppeteer 초기화 실패');
        process.exit(1);
    }

    const dataDir = path.resolve(__dirname, '../../data');

    for (const channelName of channels) {
        log('info', `=== ${channelName} 처리 시작 ===`);

        const channelDir = path.join(dataDir, channelName);
        const mapUrlCrawlingDir = path.join(channelDir, 'map_url_crawling');
        const crawlingDir = path.join(channelDir, 'crawling');
        const metaDir = path.join(channelDir, 'meta');
        const transcriptDir = path.join(channelDir, 'transcript');
        const urlsFile = path.join(channelDir, 'urls', 'urls.txt');

        if (!fs.existsSync(mapUrlCrawlingDir)) fs.mkdirSync(mapUrlCrawlingDir, { recursive: true });

        if (!fs.existsSync(urlsFile)) {
            log('warning', `urls.txt 없음: ${urlsFile}`);
            continue;
        }

        const urls = fs.readFileSync(urlsFile, 'utf-8').split('\n').filter(Boolean);
        log('info', `총 URL: ${urls.length}개`);

        const browser = await getBrowser();
        if (!browser) continue;

        let processed = 0, skipped = 0, success = 0;

        for (const url of urls) {
            const videoIdMatch = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?&]+)/);
            if (!videoIdMatch) continue;
            const videoId = videoIdMatch[1];

            // 중복 검사
            const mapUrlCrawlingFile = path.join(mapUrlCrawlingDir, `${videoId}.jsonl`);
            const crawlingFile = path.join(crawlingDir, `${videoId}.jsonl`);
            if (fs.existsSync(mapUrlCrawlingFile) || fs.existsSync(crawlingFile)) {
                skipped++;
                continue;
            }

            processed++;

            // meta 데이터 로드
            const metaFile = path.join(metaDir, `${videoId}.jsonl`);
            let metaData = null;
            let recollectVersion = {};
            if (fs.existsSync(metaFile)) {
                const lines = fs.readFileSync(metaFile, 'utf-8').split('\n').filter(Boolean);
                if (lines.length > 0) {
                    metaData = JSON.parse(lines[lines.length - 1]);
                    recollectVersion.meta = metaData.recollect_id || 0;
                }
            }

            if (!metaData || !metaData.description) {
                log('debug', `[${videoId}] meta 데이터 없음`);
                continue;
            }

            // 지도 URL 추출 (네이버, 카카오, 구글)
            const mapUrls = extractMapUrls(metaData.description);
            if (mapUrls.length === 0) {
                log('debug', `[${videoId}] 지도 URL 없음`);
                continue;
            }

            log('info', `[${videoId}] 지도 URL ${mapUrls.length}개 발견`);

            // transcript 로드
            const transcriptFile = path.join(transcriptDir, `${videoId}.jsonl`);
            let transcript = '';
            if (fs.existsSync(transcriptFile)) {
                const lines = fs.readFileSync(transcriptFile, 'utf-8').split('\n').filter(Boolean);
                if (lines.length > 0) {
                    const transcriptData = JSON.parse(lines[lines.length - 1]);
                    transcript = transcriptData.transcript_text || '';
                    recollectVersion.transcript = transcriptData.recollect_id || 0;
                }
            }

            // Puppeteer로 수집
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

            const places = [];
            for (const mapUrl of mapUrls) {
                const mapType = getMapType(mapUrl);
                let placeInfo = null;

                // 지도 타입에 따라 Puppeteer로 수집
                switch (mapType) {
                    case 'naver':
                        placeInfo = await collectFromNaverMap(page, mapUrl);
                        break;
                    case 'kakao':
                        placeInfo = await collectFromKakaoMap(page, mapUrl);
                        break;
                    case 'google':
                        placeInfo = await collectFromGoogleMap(page, mapUrl);
                        break;
                }

                // 모든 지도: 네이버 검색 API로 검증 (3개 결과 중 시군구 일치)
                if (placeInfo) {
                    placeInfo = await enrichWithNaverSearch(placeInfo);
                }

                // enrichWithNaverSearch 성공 시 origin_name/naver_name이 있음
                if (placeInfo && (placeInfo.origin_name || placeInfo.naver_name)) {
                    placeInfo = await verifyAndGeocode(placeInfo);
                    
                    // verifyAndGeocode가 null 반환 시 실패 처리
                    if (!placeInfo) {
                        log('warning', `  → 검증 실패 - 06 파이프라인으로 처리`);
                        continue;
                    }
                    
                    // 필수 필드 검증 (origin_name 또는 naver_name, jibunAddress, lat, lng)
                    if (hasRequiredFields(placeInfo)) {
                        places.push(placeInfo);
                        log('success', `  → ${placeInfo.naver_name || placeInfo.origin_name} (${mapType})`);
                    } else {
                        log('warning', `  → ${placeInfo.naver_name || placeInfo.origin_name} 필수 필드 누락 - 06 파이프라인으로 처리`);
                    }
                }
            }

            await page.close();

            if (places.length === 0) {
                log('debug', `[${videoId}] 수집된 장소 없음`);
                continue;
            }

            // Gemini CLI로 youtuber_review 추출
            const reviews = await extractYoutuberReview(videoId, metaData, transcript, places);
            
            // 리뷰 매칭 (naver_name 또는 origin_name으로 매칭)
            for (const place of places) {
                const placeName = place.naver_name || place.origin_name;
                const review = reviews.find(r => r.origin_name === placeName);
                if (review) {
                    place.youtuber_review = review.youtuber_review;
                    place.reasoning_basis = review.reasoning_basis;
                    if (review.category && VALID_CATEGORIES.includes(review.category)) {
                        place.category = review.category;
                    }
                }
            }

            // 저장
            const record = {
                youtube_link: `https://www.youtube.com/watch?v=${videoId}`,
                recollect_version: recollectVersion,
                restaurants: places,
                channel_name: channelName
            };

            fs.appendFileSync(mapUrlCrawlingFile, JSON.stringify(record, null, 0) + '\n');
            success++;
            log('success', `[${videoId}] 저장 완료 (${places.length}개)`);
        }

        log('info', `=== ${channelName} 완료: 처리 ${processed}, 성공 ${success}, 스킵 ${skipped} ===`);
    }

    await closeBrowser();
    log('success', '모든 작업 완료');
}

main().catch(err => {
    log('error', `오류 발생: ${err.message}`);
    process.exit(1);
});

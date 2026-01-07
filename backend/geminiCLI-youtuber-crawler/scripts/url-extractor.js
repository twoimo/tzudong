import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

dotenv.config();
puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 네이버/카카오 API 키 (환경변수에서 로드)
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const KAKAO_API_KEY = process.env.KAKAO_API_KEY; // REST API Key

/**
 * 유튜브 설명란에서 지도/맛집 URL을 추출합니다.
 * @param {string} description 
 * @returns {string|null} 발견된 첫 번째 URL
 */
export function findMapUrl(description) {
    if (!description) return null;
    // naver.me, map.naver.com, kko.to, map.kakao.com, place.map.kakao.com 등 매칭
    const urlRegex = /(https?:\/\/(?:map\.naver\.com\/v5\/entry\/place\/|naver\.me\/|kko\.to\/|map\.kakao\.com\/|place\.map\.kakao\.com\/)[^\s]+)/g;
    const match = description.match(urlRegex);
    return match ? match[0] : null;
}

/**
 * URL에서 식당 정보를 추출합니다.
 * 1. Puppeteer로 크롤링 시도
 * 2. 실패 시 API Fallback 시도 (구현 예정)
 * @param {string} url 
 * @returns {Promise<{name: string, address: string, lat: string, lng: string, type: string}|null>}
 */
export async function extractDataFromUrl(url) {
    console.log(`[URL Extractor] Processing URL: ${url}`);

    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=ko-KR,ko'],
        });
        const page = await browser.newPage();

        // 모바일 뷰포트 설정 (지도앱 리다이렉트 방지 및 파싱 용이성)
        await page.setViewport({ width: 375, height: 812 });

        // URL 방문
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        const finalUrl = page.url();
        console.log(`[URL Extractor] Resolved URL: ${finalUrl}`);

        // 네이버 지도 처리
        if (finalUrl.includes('map.naver.com') || finalUrl.includes('place.naver.com')) {
            return await extractNaverMap(page, finalUrl);
        }
        // 카카오맵 처리
        else if (finalUrl.includes('map.kakao.com') || finalUrl.includes('place.map.kakao.com')) {
            return await extractKakaoMap(page, finalUrl);
        }

        return null;

    } catch (error) {
        console.error(`[URL Extractor] Crawling failed: ${error.message}`);
        // 크롤링 실패 시 API Fallback 시도
        console.log(`[URL Extractor] Attempting API Fallback...`);
        return await fallbackToApi(url);
    } finally {
        if (browser) await browser.close();
    }
}

async function extractNaverMap(page, url) {
    try {
        // iframe 진입 필요 여부 확인 (PC 버전일 경우) - 모바일 모드로 접속했으므로 대부분 바로 노출됨
        // 상호명 선택자 (네이버 플레이스 모바일)
        await page.waitForSelector('.GHAhO', { timeout: 5000 }).catch(() => { }); // 타이틀 클래스 예시 (변동 가능)

        // 네이버는 동적 클래스명이 많으므로, 메타 태그나 JSON-LD 우선 확인
        const data = await page.evaluate(() => {
            // 1. JSON-LD 확인
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            for (const s of scripts) {
                try {
                    const json = JSON.parse(s.innerText);
                    if (json['@type'] === 'Restaurant' || json['@type'] === 'Place' || json.name) {
                        return {
                            name: json.name,
                            address: json.address?.streetAddress || json.address,
                            lat: json.geo?.latitude,
                            lng: json.geo?.longitude,
                            type: json['@type']
                        };
                    }
                } catch (e) { }
            }

            // 2. 메타 태그 확인 (OG Tag)
            const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
            const ogDesc = document.querySelector('meta[property="og:description"]')?.content;
            const ogUrl = document.querySelector('meta[property="og:url"]')?.content;

            // 제목에서 상호명 추출 (예: "XX식당 : 네이버 방문자리뷰...")
            let name = ogTitle;
            if (name && name.includes(':')) {
                name = name.split(':')[0].trim();
            }

            return { name, description: ogDesc, url: ogUrl };
        });

        if (data && data.name) {
            // 좌표 보완
            if (!data.lat || !data.lng) {
                const apiData = await fallbackToApi(url, data.name);
                if (apiData) return { ...data, ...apiData };
            }
            return data;
        }

        return null;
    } catch (e) {
        console.error(`[Naver Extraction Error] ${e.message}`);
        return null;
    }
}

async function extractKakaoMap(page, url) {
    try {
        await page.waitForSelector('.tit_location', { timeout: 5000 }).catch(() => { });

        const data = await page.evaluate(() => {
            // 카카오맵 모바일/PC 구조에 따라 다름. 메타 태그 우선
            const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
            const ogDesc = document.querySelector('meta[property="og:description"]')?.content;

            // 카카오맵은 보통 "상호명 | 카카오맵" 형태
            let name = ogTitle;
            if (name && name.includes('|')) {
                name = name.split('|')[0].trim();
            }

            return { name, address: ogDesc }; // 카카오는 description에 주소가 있는 경우가 많음
        });

        if (data && data.name) {
            // 좌표 보완
            if (!data.lat || !data.lng) {
                const apiData = await fallbackToApi(url, data.name);
                if (apiData) return { ...data, ...apiData };
            }
            return data;
        }
        return null; // 실패
    } catch (e) {
        console.error(`[Kakao Extraction Error] ${e.message}`);
        return null;
    }
}

async function searchNaverApi(query) {
    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) return null;
    try {
        const apiUrl = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=1&sort=random`;
        const response = await fetch(apiUrl, {
            headers: {
                'X-Naver-Client-Id': NAVER_CLIENT_ID,
                'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
            }
        });
        const data = await response.json();
        if (data.items && data.items.length > 0) {
            const item = data.items[0];
            // Naver API returns katec coordinates or similar, need checking. 
            // Actually standard API returns mapx, mapy (TM128). Need to convert or use address for geocoding separately if needed.
            // But for "context" to Gemini, Name and Road Address are most important.
            return {
                name: item.title.replace(/<[^>]+>/g, ''),
                address: item.roadAddress || item.address,
                category: item.category,
                mapx: item.mapx,
                mapy: item.mapy
            };
        }
    } catch (e) {
        console.error(`[Naver API Error] ${e.message}`);
    }
    return null;
}

async function searchKakaoApi(query) {
    if (!KAKAO_API_KEY) return null;
    try {
        const apiUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}`;
        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `KakaoAK ${KAKAO_API_KEY}`
            }
        });
        const data = await response.json();
        if (data.documents && data.documents.length > 0) {
            const item = data.documents[0];
            return {
                name: item.place_name,
                address: item.road_address_name || item.address_name,
                lat: item.y,
                lng: item.x,
                id: item.id
            };
        }
    } catch (e) {
        console.error(`[Kakao API Error] ${e.message}`);
    }
    return null;
}

async function fallbackToApi(originalUrl, knownName = '') {
    // 1. URL이 리다이렉트된 최종 URL일 경우, ID나 Query 추출 시도
    // 2. knownName이 있으면 바로 검색
    let query = knownName;

    if (!query) {
        // 간단한 추출 로직: URL 세그먼트 분석 (예: place/1234 -> API로 상세 조회는 불가하지만 이름 추측 어려움)
        // 여기서는 knownName이 없을 경우 URL 분석이 어렵다고 판단, null 반환
        return null;
    }

    console.log(`[API Fallback] Searching for '${query}' via APIs...`);

    // 네이버 검색 우선
    const naverResult = await searchNaverApi(query);
    if (naverResult) return naverResult;

    // 카카오 검색
    const kakaoResult = await searchKakaoApi(query);
    if (kakaoResult) return kakaoResult;

    return null;
}

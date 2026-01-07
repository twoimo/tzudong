/**
 * Phase 1.5: 맛집 URL 정보 수집 스크립트
 * Puppeteer로 네이버/카카오/구글 맵 URL에서 상세 정보를 수집
 * - 상호명, 도로명 주소, 지번 주소, 전화번호, 위도/경도, 카테고리
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
        break;
    }
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

// 장소 정보 파일 (날짜에 관계없이 공유)
const SHARED_PLACE_INFO_FILE = path.join(DATA_DIR, 'place_info.jsonl');

// 로그 함수
const DEBUG_MODE = process.env.DEBUG === 'true';

function log(level, msg) {
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

    console.log(`[${time}] ${tags[level] || '[LOG]'} ${msg}`);
}

// Puppeteer 동시 실행 제한 (성능 최적화: 로컬 3개)
const isGitHubActionsEnv = !!process.env.GITHUB_ACTIONS;
const PUPPETEER_CONCURRENCY = isGitHubActionsEnv ? 1 : 3;
let puppeteerActiveCount = 0;
const puppeteerQueue = [];

async function acquirePuppeteerSlot() {
    if (puppeteerActiveCount < PUPPETEER_CONCURRENCY) {
        puppeteerActiveCount++;
        return;
    }
    await new Promise(resolve => puppeteerQueue.push(resolve));
    puppeteerActiveCount++;
}

function releasePuppeteerSlot() {
    puppeteerActiveCount--;
    if (puppeteerQueue.length > 0) {
        const next = puppeteerQueue.shift();
        next();
    }
}

// Puppeteer 인스턴스 (재사용)
let puppeteerBrowser = null;
let puppeteerModule = null;
let puppeteerChecked = false;
let stealthApplied = false;

// User-Agent 로테이션
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRandomDelay() {
    // 성능 최적화: 1-2초로 단축 (차단 위험 낮은 사이트)
    return 1000 + Math.floor(Math.random() * 1000);
}

/**
 * Puppeteer 브라우저 초기화
 */
async function initPuppeteer() {
    if (puppeteerChecked) return puppeteerModule !== null;

    puppeteerChecked = true;
    try {
        const puppeteerExtra = await import('puppeteer-extra');
        const StealthPlugin = await import('puppeteer-extra-plugin-stealth');

        if (!stealthApplied) {
            puppeteerExtra.default.use(StealthPlugin.default());
            stealthApplied = true;
            log('info', 'Stealth 모드 활성화됨');
        }

        puppeteerModule = puppeteerExtra;
        return true;
    } catch (err) {
        log('warning', `puppeteer-extra 로드 실패: ${err.message}`);
        try {
            puppeteerModule = await import('puppeteer');
            return true;
        } catch {
            log('error', 'Puppeteer 모듈 없음');
            puppeteerModule = null;
            return false;
        }
    }
}

/**
 * 브라우저 가져오기 (재사용)
 */
async function getBrowser() {
    if (!puppeteerModule) return null;

    if (!puppeteerBrowser) {
        // ARM64 시스템에서 시스템 Chromium 사용
        const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';

        puppeteerBrowser = await puppeteerModule.default.launch({
            headless: true,
            executablePath,
            protocolTimeout: 300000,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        log('info', `브라우저 시작: ${executablePath}`);
    }
    return puppeteerBrowser;
}

/**
 * 단축 URL 리다이렉트 처리
 */
async function resolveShortUrl(url) {
    try {
        const response = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            headers: {
                'User-Agent': getRandomUserAgent()
            }
        });
        return response.url;
    } catch (error) {
        log('debug', `단축 URL 해석 실패: ${error.message}`);
        return url;
    }
}

/**
 * 네이버 지도에서 장소 정보 수집
 */
async function collectFromNaverMap(page, mapUrl) {
    try {
        // 단축 URL 처리
        let url = mapUrl;
        if (url.includes('naver.me')) {
            url = await resolveShortUrl(url);
        }

        // place.naver.com URL인지 확인
        const placeMatch = url.match(/place\.naver\.com\/(?:restaurant|place)\/(\d+)/);
        if (!placeMatch) {
            log('debug', `네이버 place ID 추출 실패: ${url}`);
            return null;
        }

        const placeId = placeMatch[1];
        const placeUrl = `https://pcmap.place.naver.com/restaurant/${placeId}/home`;

        await page.goto(placeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 장소 정보 추출
        const placeInfo = await page.evaluate(() => {
            const result = {
                name: null,
                roadAddress: null,
                jibunAddress: null,
                phone: null,
                category: null,
                lat: null,
                lng: null
            };

            // 1. og:title에서 상호명 추출 (가장 신뢰성 높음)
            const ogTitle = document.querySelector('meta[property="og:title"]');
            if (ogTitle) {
                const titleContent = ogTitle.getAttribute('content');
                if (titleContent) {
                    // "오코메 : 네이버" -> "오코메"
                    result.name = titleContent.replace(/\s*:\s*네이버$/, '').trim();
                }
            }

            // 2. span.GHAhO에서 상호명 (fallback)
            if (!result.name) {
                const nameEl = document.querySelector('span.GHAhO');
                if (nameEl) result.name = nameEl.textContent?.trim();
            }

            // 3. 카테고리 (span.lnJFt)
            const categoryEl = document.querySelector('span.lnJFt');
            if (categoryEl) result.category = categoryEl.textContent?.trim();

            // 4. 주소 추출 - 복수 셀렉터 시도
            const addressSelectors = [
                '.LDgIH',           // 기존 셀렉터
                '.place_section_content .O8qbU .vV_z_', // 섹션 내 주소
                '[data-testid="location-address"]',
                '.zD5Nm .pzITx',    // 상세정보 주소
            ];

            for (const selector of addressSelectors) {
                if (result.roadAddress) break;
                const el = document.querySelector(selector);
                if (el) {
                    const text = el.textContent?.trim();
                    if (text && (text.includes('로') || text.includes('길') || text.includes('동'))) {
                        result.roadAddress = text;
                    }
                }
            }

            // 5. 전화번호 추출 - 복수 셀렉터 시도
            const phoneSelectors = [
                'span.xlx7Q',       // 기존 셀렉터
                'a[href^="tel:"]',  // 전화 링크
                '.O8qbU .vV_z_',    // 상세 정보
            ];

            for (const selector of phoneSelectors) {
                if (result.phone) break;
                const el = document.querySelector(selector);
                if (el) {
                    let phoneText = el.textContent?.trim();
                    if (el.tagName === 'A' && el.href) {
                        phoneText = el.href.replace('tel:', '');
                    }
                    // 전화번호 패턴 확인
                    if (phoneText && /^[\d\-+().\s]+$/.test(phoneText)) {
                        result.phone = phoneText;
                    }
                }
            }

            return result;
        });

        // 좌표 추출 (URL에서)
        const coordMatch = url.match(/[?&]c=([^&]+)/);
        if (coordMatch) {
            try {
                const coords = coordMatch[1].split(',');
                if (coords.length >= 2) {
                    placeInfo.lat = parseFloat(coords[0]);
                    placeInfo.lng = parseFloat(coords[1]);
                }
            } catch { }
        }

        // 네이버 API로 좌표 보완 (주소가 있는 경우)
        if (!placeInfo.lat && placeInfo.roadAddress) {
            const naverApiKey = process.env.NAVER_CLIENT_ID;
            const naverSecretKey = process.env.NAVER_CLIENT_SECRET;

            if (naverApiKey && naverSecretKey) {
                try {
                    const geocodeUrl = `https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent(placeInfo.roadAddress)}`;
                    const response = await fetch(geocodeUrl, {
                        headers: {
                            'X-NCP-APIGW-API-KEY-ID': naverApiKey,
                            'X-NCP-APIGW-API-KEY': naverSecretKey
                        }
                    });
                    const data = await response.json();
                    if (data.addresses && data.addresses.length > 0) {
                        placeInfo.lat = parseFloat(data.addresses[0].y);
                        placeInfo.lng = parseFloat(data.addresses[0].x);
                    }
                } catch (err) {
                    log('debug', `네이버 좌표 API 실패: ${err.message}`);
                }
            }
        }

        placeInfo.source = 'naver';
        placeInfo.mapUrl = mapUrl;
        placeInfo.placeId = placeId;

        return placeInfo;

    } catch (error) {
        log('warning', `네이버 지도 수집 실패: ${error.message}`);
        return null;
    }
}

/**
 * 카카오 지도에서 장소 정보 수집
 */
async function collectFromKakaoMap(page, mapUrl) {
    try {
        // 단축 URL 처리
        let url = mapUrl;
        if (url.includes('kko.to')) {
            url = await resolveShortUrl(url);
        }

        // place ID 추출
        const placeMatch = url.match(/place\/(\d+)/);
        if (!placeMatch) {
            log('debug', `카카오 place ID 추출 실패: ${url}`);
            return null;
        }

        const placeId = placeMatch[1];

        // 카카오 API로 장소 정보 조회 (place ID로 직접 조회)
        const kakaoApiKey = process.env.KAKAO_REST_API_KEY;
        if (kakaoApiKey) {
            try {
                // 카카오 장소 상세 API 호출
                const apiUrl = `https://place.map.kakao.com/main/v/${placeId}`;
                const response = await fetch(apiUrl, {
                    headers: {
                        'User-Agent': getRandomUserAgent()
                    }
                });

                if (response.ok) {
                    const data = await response.json();

                    if (data.basicInfo) {
                        const info = data.basicInfo;
                        return {
                            name: info.placenamefull || info.placename,
                            roadAddress: info.address?.newaddr?.newaddrfull,
                            jibunAddress: info.address?.region?.newaddrfullname || info.address?.addrbunho,
                            phone: info.phonenum,
                            category: info.category?.catename,
                            lat: info.wpointx ? parseFloat(info.wpointy) : null,
                            lng: info.wpointx ? parseFloat(info.wpointx) : null,
                            source: 'kakao',
                            mapUrl: mapUrl,
                            placeId: placeId
                        };
                    }
                }
            } catch (err) {
                log('debug', `카카오 API 호출 실패: ${err.message}`);
            }
        }

        // API 실패 시 웹 스크래핑
        const placeUrl = `https://place.map.kakao.com/${placeId}`;
        await page.goto(placeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));

        const placeInfo = await page.evaluate(() => {
            const result = {
                name: null,
                roadAddress: null,
                jibunAddress: null,
                phone: null,
                category: null,
                lat: null,
                lng: null
            };

            // 상호명
            const nameEl = document.querySelector('.tit_location');
            if (nameEl) result.name = nameEl.textContent?.trim();

            // 카테고리
            const categoryEl = document.querySelector('.txt_location');
            if (categoryEl) result.category = categoryEl.textContent?.trim();

            // 주소
            const addressEl = document.querySelector('.txt_address');
            if (addressEl) result.roadAddress = addressEl.textContent?.trim();

            // 전화번호
            const phoneEl = document.querySelector('.txt_contact');
            if (phoneEl) result.phone = phoneEl.textContent?.trim();

            return result;
        });

        placeInfo.source = 'kakao';
        placeInfo.mapUrl = mapUrl;
        placeInfo.placeId = placeId;

        return placeInfo;

    } catch (error) {
        log('warning', `카카오 지도 수집 실패: ${error.message}`);
        return null;
    }
}

/**
 * 구글 지도에서 장소 정보 수집
 */
async function collectFromGoogleMap(page, mapUrl) {
    try {
        // 단축 URL 처리
        let url = mapUrl;
        if (url.includes('goo.gl') || url.includes('maps.app.goo.gl')) {
            url = await resolveShortUrl(url);
        }

        // 좌표 추출
        let lat = null, lng = null;
        const coordMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (coordMatch) {
            lat = parseFloat(coordMatch[1]);
            lng = parseFloat(coordMatch[2]);
        }

        // 장소명 추출
        let placeName = null;
        const placeMatch = url.match(/\/place\/([^/]+)/);
        if (placeMatch) {
            placeName = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
        }

        // 구글 지도 페이지 접속
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(resolve => setTimeout(resolve, 3000));

        const placeInfo = await page.evaluate(() => {
            const result = {
                name: null,
                roadAddress: null,
                phone: null,
                category: null
            };

            // 상호명
            const nameEl = document.querySelector('h1.DUwDvf');
            if (nameEl) result.name = nameEl.textContent?.trim();

            // 카테고리
            const categoryEl = document.querySelector('button[jsaction*="category"]');
            if (categoryEl) result.category = categoryEl.textContent?.trim();

            // 주소 (data-item-id에 "address" 포함)
            const addressBtn = document.querySelector('button[data-item-id*="address"]');
            if (addressBtn) {
                const addrText = addressBtn.querySelector('.Io6YTe');
                if (addrText) result.roadAddress = addrText.textContent?.trim();
            }

            // 전화번호
            const phoneBtn = document.querySelector('button[data-item-id*="phone"]');
            if (phoneBtn) {
                const phoneText = phoneBtn.querySelector('.Io6YTe');
                if (phoneText) result.phone = phoneText.textContent?.trim();
            }

            return result;
        });

        // 좌표 보완
        if (!lat && placeInfo.roadAddress) {
            // 카카오 API로 좌표 변환 (구글 API 키 없는 경우)
            const kakaoApiKey = process.env.KAKAO_REST_API_KEY;
            if (kakaoApiKey) {
                try {
                    const geocodeUrl = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(placeInfo.roadAddress)}`;
                    const response = await fetch(geocodeUrl, {
                        headers: {
                            'Authorization': `KakaoAK ${kakaoApiKey}`
                        }
                    });
                    const data = await response.json();
                    if (data.documents && data.documents.length > 0) {
                        lat = parseFloat(data.documents[0].y);
                        lng = parseFloat(data.documents[0].x);
                    }
                } catch (err) {
                    log('debug', `좌표 변환 실패: ${err.message}`);
                }
            }
        }

        placeInfo.lat = lat;
        placeInfo.lng = lng;
        placeInfo.source = 'google';
        placeInfo.mapUrl = mapUrl;

        return placeInfo;

    } catch (error) {
        log('warning', `구글 지도 수집 실패: ${error.message}`);
        return null;
    }
}

/**
 * 단일 영상의 모든 맛집 URL에서 정보 수집
 */
async function collectPlaceInfoForVideo(video, index, total) {
    await acquirePuppeteerSlot();

    const places = [];

    try {
        const browser = await getBrowser();
        if (!browser) {
            releasePuppeteerSlot();
            return { videoId: video.videoId, places: [], hasPlaceInfo: false };
        }

        const mapUrls = video.mapUrls || [];
        if (mapUrls.length === 0) {
            releasePuppeteerSlot();
            return { videoId: video.videoId, places: [], hasPlaceInfo: false };
        }

        log('info', `[${index + 1}/${total}] 장소 정보 수집: ${video.title?.slice(0, 40) || video.videoId}... (${mapUrls.length}개 URL)`);

        const page = await browser.newPage();
        await page.setUserAgent(getRandomUserAgent());
        await page.setViewport({ width: 1280, height: 800 });

        for (const mapInfo of mapUrls) {
            await new Promise(resolve => setTimeout(resolve, getRandomDelay()));

            let placeInfo = null;

            switch (mapInfo.type) {
                case 'naver':
                    placeInfo = await collectFromNaverMap(page, mapInfo.url);
                    break;
                case 'kakao':
                    placeInfo = await collectFromKakaoMap(page, mapInfo.url);
                    break;
                case 'google':
                    placeInfo = await collectFromGoogleMap(page, mapInfo.url);
                    break;
            }

            if (placeInfo && placeInfo.name) {
                places.push(placeInfo);
                log('success', `  → ${placeInfo.name} (${placeInfo.source})`);
            } else {
                log('debug', `  → 정보 추출 실패: ${mapInfo.url}`);
            }
        }

        await page.close();

    } catch (error) {
        log('warning', `영상 처리 실패 [${video.videoId}]: ${error.message}`);
    }

    releasePuppeteerSlot();

    return {
        videoId: video.videoId,
        places,
        hasPlaceInfo: places.length > 0,
        collectedAt: getKSTDate().toISOString()
    };
}

/**
 * 카테고리 정규화
 */
function normalizeCategory(category) {
    if (!category) return null;

    const categoryMap = {
        '한식': '한식',
        '고기': '고기',
        '고깃집': '고기',
        '삼겹살': '고기',
        '갈비': '고기',
        '곱창': '고기',
        '스테이크': '양식',
        '양식': '양식',
        '이탈리안': '양식',
        '중식': '중식',
        '중국집': '중식',
        '일식': '돈까스·회',
        '초밥': '돈까스·회',
        '회': '돈까스·회',
        '돈까스': '돈까스·회',
        '치킨': '치킨',
        '피자': '피자',
        '패스트푸드': '패스트푸드',
        '햄버거': '패스트푸드',
        '찜': '찜·탕',
        '탕': '찜·탕',
        '찌개': '찜·탕',
        '족발': '족발·보쌈',
        '보쌈': '족발·보쌈',
        '분식': '분식',
        '떡볶이': '분식',
        '카페': '카페·디저트',
        '디저트': '카페·디저트',
        '베이커리': '카페·디저트',
        '아시안': '아시안',
        '태국': '아시안',
        '베트남': '아시안',
        '야식': '야식',
        '도시락': '도시락'
    };

    for (const [key, value] of Object.entries(categoryMap)) {
        if (category.includes(key)) {
            return value;
        }
    }

    return null;
}

/**
 * 메인 실행
 */
async function main() {
    log('info', '='.repeat(60));
    log('info', '  Phase 1.5: 맛집 URL 정보 수집 시작');
    log('info', '='.repeat(60));

    const startTime = Date.now();

    // Puppeteer 초기화
    const puppeteerReady = await initPuppeteer();
    if (!puppeteerReady) {
        log('error', 'Puppeteer 초기화 실패');
        process.exit(1);
    }

    // 입력 파일 확인
    let inputFile = path.join(TODAY_PATH, 'meatcreator_videos_with_map.jsonl');

    if (!fs.existsSync(inputFile)) {
        // 전체 영상 파일에서 지도 URL이 있는 영상만 필터링
        const allVideosFile = path.join(TODAY_PATH, 'meatcreator_videos.json');
        if (!fs.existsSync(allVideosFile)) {
            log('error', '영상 목록 파일이 없습니다. 먼저 crawl-channel.js를 실행하세요.');
            process.exit(1);
        }

        const allVideos = JSON.parse(fs.readFileSync(allVideosFile, 'utf-8'));
        const videosWithMap = allVideos.videos.filter(v => v.hasMapUrl);

        if (videosWithMap.length === 0) {
            log('info', '지도 URL이 있는 영상이 없습니다.');
            return;
        }

        const content = videosWithMap.map(v => JSON.stringify(v)).join('\n');
        fs.writeFileSync(inputFile, content, 'utf-8');
        log('info', `지도 URL 포함 영상 ${videosWithMap.length}개`);
    }

    // 영상 목록 로드
    const content = fs.readFileSync(inputFile, 'utf-8');
    const videos = content.trim().split('\n').map(line => JSON.parse(line));

    log('info', `총 영상: ${videos.length}개`);

    // 이미 수집된 장소 정보 체크
    const placeInfoFile = SHARED_PLACE_INFO_FILE;
    const collectedPlaceInfo = new Map();

    if (fs.existsSync(placeInfoFile)) {
        const existingContent = fs.readFileSync(placeInfoFile, 'utf-8');
        const lines = existingContent.trim().split('\n');
        for (const line of lines) {
            if (line) {
                try {
                    const data = JSON.parse(line);
                    collectedPlaceInfo.set(data.videoId, data);
                } catch { }
            }
        }
        log('info', `기존 장소 정보 로드 (공유): ${collectedPlaceInfo.size}개`);
    }

    // 수집할 영상 필터링
    const videosToCollect = videos.filter(v => !collectedPlaceInfo.has(v.videoId));
    log('info', `수집 대상: ${videosToCollect.length}개 / 스킵: ${videos.length - videosToCollect.length}개`);
    log('info', `병렬 처리: 동시 ${PUPPETEER_CONCURRENCY}개`);

    if (videosToCollect.length === 0) {
        log('success', '모든 장소 정보가 이미 수집되었습니다.');
        return;
    }

    // 통계
    const stats = {
        total: videosToCollect.length,
        success: 0,
        noPlaceInfo: 0,
        totalPlaces: 0
    };

    // 배치 처리
    const BATCH_SIZE = PUPPETEER_CONCURRENCY;
    const SAVE_INTERVAL = 10;

    let processedCount = 0;
    const newResults = [];

    for (let i = 0; i < videosToCollect.length; i += BATCH_SIZE) {
        const batch = videosToCollect.slice(i, i + BATCH_SIZE);

        const results = await Promise.all(
            batch.map((video, idx) =>
                collectPlaceInfoForVideo(video, i + idx, videosToCollect.length)
            )
        );

        for (const result of results) {
            newResults.push(result);

            if (result.hasPlaceInfo) {
                stats.success++;
                stats.totalPlaces += result.places.length;
            } else {
                stats.noPlaceInfo++;
            }

            processedCount++;

            // 중간 저장
            if (processedCount % SAVE_INTERVAL === 0) {
                const allData = [...collectedPlaceInfo.values(), ...newResults];
                const content = allData.map(d => JSON.stringify(d)).join('\n');
                fs.writeFileSync(placeInfoFile, content, 'utf-8');
                log('info', `중간 저장: ${allData.length}개`);
            }
        }
    }

    // 최종 저장
    const allData = [...collectedPlaceInfo.values(), ...newResults];
    const finalContent = allData.map(d => JSON.stringify(d)).join('\n');
    fs.writeFileSync(placeInfoFile, finalContent, 'utf-8');

    // 브라우저 종료
    if (puppeteerBrowser) {
        await puppeteerBrowser.close();
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    log('info', '');
    log('info', '='.repeat(60));
    log('success', '장소 정보 수집 완료');
    log('info', '='.repeat(60));
    log('info', `성공 영상: ${stats.success}개`);
    log('info', `총 장소: ${stats.totalPlaces}개`);
    log('info', `정보 없음: ${stats.noPlaceInfo}개`);
    log('info', `소요 시간: ${elapsed}초`);
    log('info', `저장: ${placeInfoFile}`);
    log('info', '='.repeat(60));
}

main().catch(error => {
    log('error', `치명적 오류: ${error.message}`);
    console.error(error);
    process.exit(1);
});

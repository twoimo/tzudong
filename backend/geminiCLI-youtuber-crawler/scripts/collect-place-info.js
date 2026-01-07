/**
 * Phase 1.5: 맛집 URL 정보 수집 스크립트
 * Puppeteer로 네이버/카카오/구글 맵 URL에서 상세 정보를 수집
 * - 상호명, 도로명 주소, 지번 주소, 전화번호, 위도/경도, 카테고리
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { searchNaverApi, searchKakaoApi } from './url-extractor.js';

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

/**
 * 텍스트 정제 (제어문자 및 불필요한 공백 제거)
 * 예: "부일숯불갈비 : 네이버\u001c" -> "부일숯불갈비"
 */
function cleanText(text) {
    if (!text) return null;
    return text
        .replace(/[\x00-\x1F\x7F]/g, '') // 제어문자 제거
        .replace(/\s*:\s*네이버.*$/, '') // 네이버 접미사 제거
        .replace(/\s*\|\s*카카오맵.*$/, '') // 카카오 접미사 제거
        .trim();
}

// Puppeteer 동시 실행 제한 (안정성 최적화: 로컬 2개)
const isGitHubActionsEnv = !!process.env.GITHUB_ACTIONS;
const PUPPETEER_CONCURRENCY = isGitHubActionsEnv ? 1 : 2;
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
    'Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36'
];

function getRandomUserAgent() {
    // 네이버 지도 호환성(.Y31Sf 선택자)을 위해 데스크탑 User-Agent 강제
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
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

        // [Phase 4] URL에서 좌표 즉시 추출 (입력 URL에 파라미터가 있는 경우)
        try {
            const urlObj = new URL(url);
            const pLat = urlObj.searchParams.get('lat');
            const pLng = urlObj.searchParams.get('lng');
            if (pLat && pLng) {
                // placeInfo 객체가 아직 없으므로 임시 저장 변수 활용,
                // 하지만 여기서는 스코프 문제로 인해 아래 로직에서 처리됨.
            }
        } catch (e) { }

        // form.naver.com, smartstore.naver.com 등 유효하지 않은 URL 스킵
        if (url.includes('form.naver.com') || url.includes('smartstore.naver.com')) {
            log('debug', `Skip invalid URL: ${url}`);
            return { skipped: true };
        }

        // place ID 추출 (여러 형식 지원)
        // 1. place.naver.com/restaurant/12345 또는 place.naver.com/place/12345
        // 2. map.naver.com/p/entry/place/12345
        // 3. pcmap.place.naver.com/restaurant/12345
        let placeId = null;

        const patterns = [
            /place\.naver\.com\/(?:restaurant|place)\/(\d+)/,
            /map\.naver\.com\/p\/entry\/place\/(\d+)/,
            /pcmap\.place\.naver\.com\/(?:restaurant|place)\/(\d+)/,
            /appLink\.naver.*(?:pinId|id)=(\d+)/,
            /pinId=(\d+)/
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) {
                placeId = match[1];
                break;
            }
        }

        if (!placeId) {
            log('debug', `네이버 place ID 추출 실패: ${url}`);
            return null;
        }

        const placeUrl = `https://pcmap.place.naver.com/restaurant/${placeId}/home`;

        await page.goto(placeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 404 에러 페이지 감지 ("요청하신 페이지를 찾을 수 없습니다")
        // 이 경우 스킵 처리 - Gemini 분석에서 맛집명으로 찾아낼 수 있음
        const isErrorPage = await page.evaluate(() => {
            const errorText = document.body?.innerText || '';
            const errorIndicators = [
                '요청하신 페이지를 찾을 수 없습니다',
                '페이지의 주소가 잘못 입력되었거나',
                '페이지의 주소가 변경 혹은 삭제되어'
            ];
            return errorIndicators.some(indicator => errorText.includes(indicator));
        });

        if (isErrorPage) {
            log('debug', `네이버 404 페이지 감지, 스킵 처리: ${mapUrl}`);
            return { skipped: true, reason: 'naver_404_page' };
        }

        // 장소 정보 추출
        // 주소 펼치기 버튼 클릭 (숨겨진 지번/도로명 주소 확보)
        // 주소 펼치기 버튼 클릭 (숨겨진 지번/도로명 주소 확보)
        try {
            // 모바일/PC 공용 선택자
            const expandBtnSelector = 'a.PkgBl, ._UCia, a[role="button"]._UCia';
            const expandBtn = await page.$(expandBtnSelector);
            if (expandBtn) {
                log('debug', '주소 펼치기 버튼 발견, 클릭 시도...');

                // 1. Puppeteer 네이티브 클릭
                await expandBtn.click();

                // 2. 펼쳐질 때까지 대기 ("지번" 텍스트 확인)
                await new Promise(resolve => setTimeout(resolve, 2000));

                // 3. 펼쳐졌는지 확인 (단순 텍스트 확인)
                const bodyText = await page.evaluate(() => document.body.innerText);
                if (!bodyText.includes('지번')) {
                    log('debug', '클릭으로 "지번"이 드러나지 않음, evaluate 클릭 시도...');
                    await page.evaluate((sel) => {
                        const el = document.querySelector(sel);
                        if (el) el.click();
                    }, expandBtnSelector);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        } catch (e) {
            log('debug', `주소 펼치기 실패 (무시됨): ${e.message}`);
        }

        // 전화번호 보기 버튼 클릭 (숨겨진 번호 확보)
        try {
            const phoneBtnSelector = 'a.BfF3H'; // '전화번호 보기' 버튼
            const phoneBtn = await page.$(phoneBtnSelector);
            if (phoneBtn) {
                log('debug', '전화번호 보기 버튼 발견, 클릭 시도...');
                await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    if (el) el.click();
                }, phoneBtnSelector);
                // 펼쳐질 때까지 잠시 대기
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } catch (e) {
            log('debug', `전화번호 보기 클릭 실패 (무시됨): ${e.message}`);
        }

        const placeInfo = await page.evaluate((placeId) => {
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

            // 2. span.GHAhO에서 상호명 (대체)
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

            // 펼쳐진 상세 주소 확인 (.Y31Sf 내의 정보)
            const detailContainer = document.querySelector('.Y31Sf');
            if (detailContainer) {
                // 디버깅: 컨테이너 텍스트 로깅
                const containerText = detailContainer.innerText;
                result.debug_container_text = containerText; // 반환 값에 포함하여 외부에서 확인 가능하게

                const rows = detailContainer.querySelectorAll('.nQ7Lh');
                rows.forEach(row => {
                    const typeEl = row.querySelector('.TjXg1');
                    const type = typeEl?.textContent?.trim();



                    // 텍스트 정제 (타입, 복사 버튼 제거)
                    let val = row.innerText;
                    if (type) val = val.replace(type, '');
                    val = val.replace(/복사/g, '').trim();

                    if (type === '도로명') result.roadAddress = val;
                    if (type === '지번') result.jibunAddress = val;
                });

                // Fallback 1: Row 기반 검색
                if (!result.jibunAddress) {
                    rows.forEach(row => {
                        const text = row.innerText;
                        if (text.includes('지번')) {
                            let val = text.replace('지번', '').replace(/복사/g, '').trim();
                            result.jibunAddress = val;
                        }
                    });
                }
            } else {
                // log('debug', '.Y31Sf container not found, trying global search for .nQ7Lh');
            }

            // .nQ7Lh 전역 검색 (컨테이너 선택자가 다를 경우 대비)
            if (!result.jibunAddress) {
                const globalRows = document.querySelectorAll('.nQ7Lh');
                // log('debug', `Global .nQ7Lh count: ${globalRows.length}`); // Cannot log in browser context
                globalRows.forEach(row => {
                    const text = row.innerText;
                    if (text.includes('지번')) {
                        let val = text.replace('지번', '').replace(/복사/g, '').trim();
                        result.jibunAddress = val;
                    }
                    if (text.includes('도로명')) {
                        let val = text.replace('도로명', '').replace(/복사/g, '').trim();
                        result.roadAddress = val;
                    }
                });
            }

            // Fallback 2: 통짜 텍스트에서 검색 (지번 ... 복사 패턴)
            // ... (rest of fallback 2 is redundant if global search works, but keeping simpler version)

            // Fallback: 클래스에 의존하지 않는 텍스트 기반 검색 (매우 강력한 Fallback)
            if (!result.jibunAddress || !result.roadAddress) {
                const allElements = document.querySelectorAll('span, div, p');
                let foundJibunNode = false;

                for (const el of allElements) {
                    // "지번" 텍스트를 가진 요소 찾기
                    if (!result.jibunAddress && el.textContent && el.textContent.trim() === '지번') {
                        // 부모 요소에서 전체 텍스트 확인
                        const parent = el.parentElement;
                        if (parent) {
                            foundJibunNode = true;
                            // 부모의 텍스트에서 '지번'과 '복사'를 제외한 나머지
                            // 예: "지번 서울 ... 복사" -> "서울 ..."
                            // 텍스트 노드만 추출하는 것이 안전함
                            let val = parent.innerText.replace('지번', '').replace(/복사/g, '').trim();
                            if (val) {
                                result.jibunAddress = val;
                                // log('debug', `Found jibun via text traversal: ${val}`); // Cannot log in browser context
                            }
                        }
                    }
                }
            }

            // 대체 방법: 본문 텍스트 검색 (최후의 수단)
            if (!result.jibunAddress) {
                const bodyText = document.body.innerText;
                const jibunMatch = bodyText.match(/지번\s*([^\n]+?)\s*복사/);
                if (jibunMatch) {
                    result.jibunAddress = jibunMatch[1].trim();
                } else {
                    // Try finding "지번" line without regex
                    const lines = bodyText.split('\n');
                    for (let line of lines) {
                        if (line.includes('지번') && line.includes('복사')) {
                            result.jibunAddress = line.replace('지번', '').replace('복사', '').trim();
                            break;
                        }
                    }
                }
            }

            // 대체 방법: Apollo 상태 (숨겨진 데이터)
            if (!result.jibunAddress || !result.roadAddress) {
                try {
                    // placeId는 evaluate 함수 외부에서 전달받아야 함.
                    // 현재 evaluate 함수 내에서는 placeId 변수에 접근할 수 없음.
                    // 이 부분을 수정해야 합니다. (예: page.evaluate(() => { ... }, placeId))
                    // 임시로 placeId를 0으로 설정하여 컴파일 오류를 피합니다.
                    // 실제 사용 시에는 placeId를 인자로 전달해야 합니다.
                    const apolloState = window.__APOLLO_STATE__;
                    if (apolloState) {
                        for (const key in apolloState) {
                            const obj = apolloState[key];
                            // PlaceDetailBase:12345 등과 일치하는 항목 확인
                            // obj.id가 문자열일 수 있으므로 String()으로 변환하여 비교
                            if (key.startsWith('PlaceDetailBase') || (obj.id && String(obj.id) === String(placeId))) {
                                if (obj.address && !result.jibunAddress) {
                                    result.jibunAddress = obj.address;
                                }
                                if (obj.roadAddress && !result.roadAddress) {
                                    result.roadAddress = obj.roadAddress;
                                }
                            }
                        }
                    }
                } catch (e) {
                    // Ignore error
                }
            }
            // 본문 텍스트 검색 후에도 없으면 HTML 덤프
            if (!result.jibunAddress) {
                // 참고: 브라우저 컨텍스트에서는 파일을 쓸 수 없음.
                // Node.js 컨텍스트로 플래그나 콘텐츠를 반환해야 함.
                result.debug_html_dump = document.documentElement.outerHTML;
            }


            // 상세 주소가 없으면 기존 방식 시도
            if (!result.roadAddress) {
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

            // 6. 숨겨진 전화번호 (펼쳐진 레이어) 확인
            // <div class="_YI7T ..."><div class="J7eF_">휴대전화번호 <em>010-...</em>
            if (!result.phone) {
                const hiddenPhoneContainer = document.querySelector('div._YI7T .J7eF_');
                if (hiddenPhoneContainer) {
                    const em = hiddenPhoneContainer.querySelector('em');
                    if (em) {
                        result.phone = em.textContent?.trim();
                    }
                }
            }

            return result;
        }, placeId);

        // 디버깅: 지번 주소 실패 시 HTML 덤프 저장
        if (placeInfo.debug_html_dump) {
            log('warning', '지번 주소 누락. debug_naver_dump.html에 HTML 덤프 저장');
            fs.writeFileSync('debug_naver_dump.html', placeInfo.debug_html_dump);
            delete placeInfo.debug_html_dump; // Remove from result object
        }

        // 좌표 추출 (URL에서)
        // 1. URL Query Parameter (예: ?lng=129.113...&lat=35.148...)
        const currentUrl = page.url(); // 리다이렉트된 최종 URL 사용
        log('debug', `Naver Current URL: ${currentUrl}`);

        try {
            const urlObj = new URL(currentUrl);
            const urlLat = urlObj.searchParams.get('lat');
            const urlLng = urlObj.searchParams.get('lng');

            if (urlLat && urlLng) {
                placeInfo.lat = parseFloat(urlLat);
                placeInfo.lng = parseFloat(urlLng);
                log('debug', `URL 파라미터 좌표 추출 성공: ${urlLat}, ${urlLng}`);
            }
        } catch (e) {
            log('debug', `URL 파싱 오류: ${e.message}`);
        }

        // 2. 구형 파라미터 (?c=x,y)
        if (!placeInfo.lat) {
            const coordMatch = currentUrl.match(/[?&]c=([^&]+)/);
            if (coordMatch) {
                try {
                    const coords = coordMatch[1].split(',');
                    if (coords.length >= 2) {
                        placeInfo.lat = parseFloat(coords[0]);
                        placeInfo.lng = parseFloat(coords[1]);
                    }
                } catch { }
            }
        }

        // 데이터 정제
        placeInfo.name = cleanText(placeInfo.name);
        placeInfo.roadAddress = cleanText(placeInfo.roadAddress);

        // [Phase 3 보완] 좌표 누락 시 로직 개선 (User Request)

        // 1. 도로명 주소(roadAddress)가 있으면 -> Kakao Geocoding (정확도 최상)
        if (!placeInfo.lat && placeInfo.roadAddress) {
            const kakaoResult = await searchKakaoApi(placeInfo.roadAddress);
            if (kakaoResult && kakaoResult.lat) {
                placeInfo.lat = kakaoResult.lat;
                placeInfo.lng = kakaoResult.lng;
                log('debug', `도로명 주소 기반 Geocoding 성공: ${placeInfo.roadAddress}`);
            }
        }

        // 1-2. 여전히 좌표가 없고 지번 주소(jibunAddress)가 있으면 -> Kakao Geocoding
        if (!placeInfo.lat && placeInfo.jibunAddress) {
            const kakaoResult = await searchKakaoApi(placeInfo.jibunAddress);
            if (kakaoResult && kakaoResult.lat) {
                placeInfo.lat = kakaoResult.lat;
                placeInfo.lng = kakaoResult.lng;
                log('debug', `지번 주소 기반 Geocoding 성공: ${placeInfo.jibunAddress}`);
            }
        }

        // 2. 여전히 좌표가 없으면 -> 상호명(name)으로 API 검색
        if ((!placeInfo.lat) && placeInfo.name) {
            // 카카오 키워드 검색
            const kakaoResult = await searchKakaoApi(placeInfo.name);
            if (kakaoResult && kakaoResult.lat) {
                placeInfo.lat = kakaoResult.lat;
                placeInfo.lng = kakaoResult.lng;
                if (!placeInfo.roadAddress) placeInfo.roadAddress = kakaoResult.address;
                log('debug', `카카오 키워드 검색 성공: ${placeInfo.name}`);
            } else {
                // 카카오 실패시 네이버 검색
                const naverResult = await searchNaverApi(placeInfo.name);
                if (naverResult) {
                    log('debug', `네이버 검색 API 성공: ${placeInfo.name}`);
                    if (!placeInfo.roadAddress) placeInfo.roadAddress = naverResult.address;
                    if (!placeInfo.category) placeInfo.category = naverResult.category;

                    // 네이버 주소로 다시 Kakao Geocoding
                    if (placeInfo.roadAddress) {
                        const kResult = await searchKakaoApi(placeInfo.roadAddress);
                        if (kResult && kResult.lat) {
                            placeInfo.lat = kResult.lat;
                            placeInfo.lng = kResult.lng;
                        }
                    }
                }
            }
        }

        // [Phase 4] 초기 URL에서 추출한 좌표가 있다면 적용 (우선순위 높음 or 누락 시 보완)
        // 위에서 URL 파싱을 수행했어야 하는데 구조상 evaluate 이후에 하는 것이 깔끔함.
        // 왜냐하면 evaluate에서 가져온 값과 비교 가능하므로.
        if (!placeInfo.lat) {
            try {
                const urlObj = new URL(url);
                const pLat = urlObj.searchParams.get('lat');
                const pLng = urlObj.searchParams.get('lng');
                if (pLat && pLng) {
                    placeInfo.lat = parseFloat(pLat);
                    placeInfo.lng = parseFloat(pLng);
                    log('debug', `입력 URL에서 좌표 복구: ${pLat}, ${pLng}`);
                }
            } catch (e) { }
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

        // 데이터 정제
        placeInfo.name = cleanText(placeInfo.name);
        placeInfo.roadAddress = cleanText(placeInfo.roadAddress);

        // [Phase 3 보완] 좌표 누락 시 로직 개선
        if (!placeInfo.lat && placeInfo.roadAddress) {
            const kakaoResult = await searchKakaoApi(placeInfo.roadAddress);
            if (kakaoResult && kakaoResult.lat) {
                placeInfo.lat = kakaoResult.lat;
                placeInfo.lng = kakaoResult.lng;
            }
        }

        if (!placeInfo.lat && placeInfo.name) {
            const kakaoResult = await searchKakaoApi(placeInfo.name);
            if (kakaoResult && kakaoResult.lat) {
                placeInfo.lat = kakaoResult.lat;
                placeInfo.lng = kakaoResult.lng;
                if (!placeInfo.roadAddress) placeInfo.roadAddress = kakaoResult.address;
            }
        }

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

        // 좌표 추출 (초기 URL에서 시도)
        let lat = null, lng = null;
        let coordMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (coordMatch) {
            lat = parseFloat(coordMatch[1]);
            lng = parseFloat(coordMatch[2]);
        }

        // 구글 지도 페이지 접속 (타임아웃 60초)
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 3000));

        // URL이 변경되었을 수 있으므로 다시 좌표 추출 시도
        let currentUrl = page.url();
        log('debug', `Google Current URL: ${currentUrl}`);

        // 네이버 폼, 스마트스토어 등 유효하지 않은 URL 체크
        if (currentUrl.includes('form.naver.com') || currentUrl.includes('smartstore.naver.com')) {
            log('debug', `invalid URL 감지 - 스킵: ${currentUrl}`);
            return { skipped: true };
        }

        if (!lat) {
            coordMatch = currentUrl.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
            if (coordMatch) {
                lat = parseFloat(coordMatch[1]);
                lng = parseFloat(coordMatch[2]);
                log('debug', `리다이렉트 URL에서 좌표 추출: ${lat}, ${lng}`);
            }
        }

        const placeInfo = await page.evaluate(() => {
            const result = {
                name: null,
                roadAddress: null,
                phone: null,
                category: null
            };

            // 상호명
            const nameEl = document.querySelector('h1.DUwDvf') || document.querySelector('h1');
            if (nameEl) result.name = nameEl.textContent?.trim();

            if (!result.name) {
                const ogTitle = document.querySelector('meta[property="og:title"]');
                if (ogTitle) {
                    const content = ogTitle.getAttribute('content');
                    // 구글 지도 og:title 형식: "장소명 - Google 지도" 또는 유사 형식
                    if (content) result.name = content.replace(/ - Google 지도/g, '').replace(/ - Google Maps/g, '').trim();
                }
            }

            // 카테고리
            const categoryEl = document.querySelector('button[jsaction*="category"]');
            if (categoryEl) result.category = categoryEl.textContent?.trim();

            // 주소 (data-item-id에 "address" 포함)
            const addressBtn = document.querySelector('button[data-item-id*="address"]');
            if (addressBtn) {
                const addrText = addressBtn.querySelector('.Io6YTe') || addressBtn.querySelector('.fontBodyMedium');
                if (addrText) result.roadAddress = addrText.textContent?.trim();
            }

            // 전화번호
            const phoneBtn = document.querySelector('button[data-item-id*="phone"]');
            if (phoneBtn) {
                const phoneText = phoneBtn.querySelector('.Io6YTe') || phoneBtn.querySelector('.fontBodyMedium');
                if (phoneText) result.phone = phoneText.textContent?.trim();
            }

            return result;
        });

        log('debug', `Google Extracted: Name=${placeInfo.name}, Addr=${placeInfo.roadAddress}, Lat=${lat}, Lng=${lng}`);

        // 데이터 정제
        placeInfo.name = cleanText(placeInfo.name);
        placeInfo.roadAddress = cleanText(placeInfo.roadAddress);

        // [Phase 3 보완] 좌표 누락 시 로직 개선
        if (!placeInfo.lat && placeInfo.roadAddress) {
            const kakaoResult = await searchKakaoApi(placeInfo.roadAddress);
            if (kakaoResult && kakaoResult.lat) {
                placeInfo.lat = kakaoResult.lat;
                placeInfo.lng = kakaoResult.lng;
            }
        }

        if (!placeInfo.lat && placeInfo.name) {
            const kakaoResult = await searchKakaoApi(placeInfo.name);
            if (kakaoResult && kakaoResult.lat) {
                placeInfo.lat = kakaoResult.lat;
                placeInfo.lng = kakaoResult.lng;
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
 * 단일 영상의 모든 맛집 URL에서 정보 수집 (재시도 포함)
 */
async function collectPlaceInfoForVideo(video, index, total, isRetry = false) {
    await acquirePuppeteerSlot();

    const places = [];
    const failedUrls = []; // 실패한 URL 추적

    try {
        const browser = await getBrowser();
        if (!browser) {
            releasePuppeteerSlot();
            return { videoId: video.videoId, places: [], hasPlaceInfo: false, failedUrls: [] };
        }

        const mapUrls = video.mapUrls || [];
        if (mapUrls.length === 0) {
            releasePuppeteerSlot();
            return { videoId: video.videoId, places: [], hasPlaceInfo: false, failedUrls: [] };
        }

        if (!isRetry) {
            log('info', `[${index + 1}/${total}] 장소 정보 수집: ${video.title?.slice(0, 40) || video.videoId}... (${mapUrls.length}개 URL)`);
        }

        const page = await browser.newPage();
        await page.setUserAgent(getRandomUserAgent());
        await page.setViewport({ width: 1280, height: 800 });

        for (const mapInfo of mapUrls) {
            await new Promise(resolve => setTimeout(resolve, getRandomDelay()));

            let placeInfo = null;
            let success = false;
            const maxRetries = isRetry ? 1 : 2; // 재시도 모드면 1회, 일반이면 2회

            for (let attempt = 0; attempt < maxRetries && !success; attempt++) {
                try {
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
                        success = true;
                    } else if (attempt < maxRetries - 1) {
                        // 재시도 전 대기
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                } catch (err) {
                    if (attempt < maxRetries - 1) {
                        log('debug', `  → 재시도 중 (${attempt + 1}/${maxRetries}): ${mapInfo.url}`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            }

            if (placeInfo && placeInfo.name) {
                places.push(placeInfo);
                log('success', `  → ${placeInfo.name} (${placeInfo.source})`);
            } else if (placeInfo && placeInfo.skipped) {
                // 스킵된 URL (재시도 안함)
            } else {
                log('debug', `  → 정보 추출 실패: ${mapInfo.url}`);
                failedUrls.push(mapInfo); // 실패한 URL 저장
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
        collectedAt: getKSTDate().toISOString(),
        failedUrls
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
    log('info', '▶ 장소 정보 수집 시작 (Phase 1.6)');

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
    const allFailedVideos = []; // 실패한 URL이 있는 영상 수집

    for (let i = 0; i < videosToCollect.length; i += BATCH_SIZE) {
        const batch = videosToCollect.slice(i, i + BATCH_SIZE);

        const results = await Promise.all(
            batch.map((video, idx) =>
                collectPlaceInfoForVideo(video, i + idx, videosToCollect.length)
            )
        );

        for (const result of results) {
            // 모든 결과를 저장 (hasPlaceInfo 여부와 관계없이)
            // 이렇게 해야 다음 실행 시 스킵됨
            newResults.push(result);

            if (result.hasPlaceInfo) {
                stats.success++;
                stats.totalPlaces += result.places.length;
            } else {
                stats.noPlaceInfo++;
            }

            // 실패한 URL이 있는 영상 수집
            if (result.failedUrls && result.failedUrls.length > 0) {
                const originalVideo = videosToCollect.find(v => v.videoId === result.videoId);
                if (originalVideo) {
                    allFailedVideos.push({
                        ...originalVideo,
                        mapUrls: result.failedUrls // 실패한 URL만
                    });
                }
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

    // 실패한 URL 최종 재시도 (동시성 1)
    if (allFailedVideos.length > 0) {
        log('info', '');
        log('info', `실패한 URL 최종 재시도: ${allFailedVideos.length}개 영상 (동시성 1)`);

        // 브라우저 재시작
        if (puppeteerBrowser) {
            await puppeteerBrowser.close();
            puppeteerBrowser = null;
        }

        // 동시성 1로 순차 처리
        for (let i = 0; i < allFailedVideos.length; i++) {
            const video = allFailedVideos[i];
            log('info', `[재시도 ${i + 1}/${allFailedVideos.length}] ${video.title?.slice(0, 30) || video.videoId}...`);

            const result = await collectPlaceInfoForVideo(video, i, allFailedVideos.length, true);

            // 기존 결과 업데이트 또는 신규 추가 (재시도 성공 시)
            const existingIdx = newResults.findIndex(r => r.videoId === result.videoId);
            if (existingIdx >= 0 && result.places.length > 0) {
                // 기존 결과에 새 장소 추가
                newResults[existingIdx].places.push(...result.places);
                newResults[existingIdx].hasPlaceInfo = true;
                stats.totalPlaces += result.places.length;

            } else if (result.places.length > 0) {
                // 신규 추가 (초기 수집 실패했으나 재시도 성공)
                result.hasPlaceInfo = true;
                newResults.push(result);
                stats.totalPlaces += result.places.length;
                stats.success++;
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
    log('info', `재시도 영상: ${allFailedVideos.length}개`);
    log('info', `소요 시간: ${elapsed}초`);
    log('info', `저장: ${placeInfoFile}`);
    log('info', '='.repeat(60));

    // 프로세스 명시적 종료 (브라우저 종료 후에도 hang 방지)
    process.exit(0);
}

// 메인 실행 (직접 실행 시에만)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        log('error', `치명적 오류: ${error.message}`);
        console.error(error);
        process.exit(1);
    });
}

export { collectPlaceInfoForVideo, getBrowser, initPuppeteer };

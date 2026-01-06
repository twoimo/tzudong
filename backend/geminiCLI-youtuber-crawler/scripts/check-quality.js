/**
 * 데이터 품질 검사 스크립트 (Quality Check Report)
 * 
 * 기능:
 * 1. 필드별 Fill Rate 분석
 * 2. 누락 데이터 목록 출력
 * 3. 이상 데이터 탐지 (좌표 오류 등)
 * 4. 품질 리포트 생성
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
function log(msg) {
    console.log(msg);
}

/**
 * 한국 좌표 범위 확인
 */
function isValidKoreanCoords(lat, lng) {
    // 한국 영토 대략적 범위
    const KOREA_BOUNDS = {
        minLat: 33.0,
        maxLat: 43.0,
        minLng: 124.0,
        maxLng: 132.0
    };

    return lat >= KOREA_BOUNDS.minLat && lat <= KOREA_BOUNDS.maxLat &&
        lng >= KOREA_BOUNDS.minLng && lng <= KOREA_BOUNDS.maxLng;
}

/**
 * 한국 주소인지 판별
 */
function isKoreanAddress(address) {
    if (!address) return false;
    const hasKorean = /[가-힣]/.test(address);
    const koreanKeywords = ['서울', '부산', '인천', '대구', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
    const hasKoreanKeyword = koreanKeywords.some(kw => address.includes(kw));
    return hasKorean && hasKoreanKeyword;
}

/**
 * 메인 실행
 */
async function main() {
    log('');
    log('╔══════════════════════════════════════════════════════════╗');
    log('║            데이터 품질 검사 리포트                      ║');
    log('╚══════════════════════════════════════════════════════════╝');
    log('');

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
                log(`📂 분석 대상: ${folder}/meatcreator_restaurants.jsonl`);
                break;
            }
        }
    } else {
        log(`📂 분석 대상: ${TODAY_FOLDER}/meatcreator_restaurants.jsonl`);
    }

    if (!fs.existsSync(inputFile)) {
        log(' 데이터 파일이 없습니다.');
        process.exit(1);
    }

    // 데이터 로드
    const content = fs.readFileSync(inputFile, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    const entries = lines.map(line => JSON.parse(line));

    // 통계 수집
    const stats = {
        totalVideos: entries.length,
        restaurantVideos: 0,
        nonRestaurantVideos: 0,
        totalRestaurants: 0,
        koreanRestaurants: 0,
        overseasRestaurants: 0,
        fields: {
            name: { filled: 0, empty: 0 },
            phone: { filled: 0, empty: 0 },
            address: { filled: 0, empty: 0 },
            coords: { filled: 0, empty: 0 },
            category: { filled: 0, empty: 0 },
            business_hours: { filled: 0, empty: 0 },
            closed_days: { filled: 0, empty: 0 },
            parking: { filled: 0, empty: 0 },
            signature_menu: { filled: 0, empty: 0 },
            youtuber_review: { filled: 0, empty: 0 },
        },
        issues: {
            invalidCoords: [],
            missingPhone: [],
            missingAddress: [],
            coordsMismatch: []
        },
        phoneSources: {},
        geocodingSources: {}
    };

    // 분석
    for (const entry of entries) {
        if (entry.is_restaurant_video === true) {
            stats.restaurantVideos++;
        } else {
            stats.nonRestaurantVideos++;
        }

        if (!entry.restaurants || entry.restaurants.length === 0) continue;

        for (const r of entry.restaurants) {
            stats.totalRestaurants++;

            const isKorean = isKoreanAddress(r.address);
            if (isKorean) {
                stats.koreanRestaurants++;
            } else {
                stats.overseasRestaurants++;
            }

            // 필드별 통계
            if (r.name) stats.fields.name.filled++; else stats.fields.name.empty++;
            if (r.phone) stats.fields.phone.filled++; else stats.fields.phone.empty++;
            if (r.address) stats.fields.address.filled++; else stats.fields.address.empty++;
            if (r.lat && r.lng) stats.fields.coords.filled++; else stats.fields.coords.empty++;
            if (r.category) stats.fields.category.filled++; else stats.fields.category.empty++;
            if (r.business_hours) stats.fields.business_hours.filled++; else stats.fields.business_hours.empty++;
            if (r.closed_days) stats.fields.closed_days.filled++; else stats.fields.closed_days.empty++;
            if (r.parking) stats.fields.parking.filled++; else stats.fields.parking.empty++;
            if (r.signature_menu && r.signature_menu.length > 0) stats.fields.signature_menu.filled++; else stats.fields.signature_menu.empty++;
            if (r.youtuber_review) stats.fields.youtuber_review.filled++; else stats.fields.youtuber_review.empty++;

            // 소스별 통계
            if (r.phone_source) {
                stats.phoneSources[r.phone_source] = (stats.phoneSources[r.phone_source] || 0) + 1;
            }
            if (r.geocoding_source) {
                stats.geocodingSources[r.geocoding_source] = (stats.geocodingSources[r.geocoding_source] || 0) + 1;
            }

            // 이상 데이터 탐지
            // 1. 한국 식당인데 좌표가 한국 범위 밖
            if (isKorean && r.lat && r.lng && !isValidKoreanCoords(r.lat, r.lng)) {
                stats.issues.invalidCoords.push({
                    name: r.name,
                    address: r.address,
                    lat: r.lat,
                    lng: r.lng,
                    videoId: entry.videoId
                });
            }

            // 2. 전화번호 없는 한국 식당
            if (isKorean && !r.phone) {
                stats.issues.missingPhone.push({
                    name: r.name,
                    address: r.address,
                    videoId: entry.videoId
                });
            }

            // 3. 주소 없음
            if (!r.address) {
                stats.issues.missingAddress.push({
                    name: r.name,
                    videoId: entry.videoId
                });
            }

            // 4. 좌표 불일치 경고 (reasoning_basis에서 감지)
            if (r.reasoning_basis && r.reasoning_basis.includes('좌표경고')) {
                stats.issues.coordsMismatch.push({
                    name: r.name,
                    videoId: entry.videoId
                });
            }
        }
    }

    // 리포트 출력
    log('═'.repeat(60));
    log('');
    log('📈 전체 요약');
    log('─'.repeat(40));
    log(`   총 영상: ${stats.totalVideos}개`);
    log(`   ├─ 맛집 영상: ${stats.restaurantVideos}개`);
    log(`   └─ 기타 영상: ${stats.nonRestaurantVideos}개`);
    log('');
    log(`   총 음식점: ${stats.totalRestaurants}개`);
    log(`   ├─ 🇰🇷 한국 식당: ${stats.koreanRestaurants}개`);
    log(`   └─ 🌏 해외 식당: ${stats.overseasRestaurants}개`);
    log('');

    log(' 필드별 Fill Rate');
    log('─'.repeat(40));
    const fieldOrder = ['name', 'phone', 'address', 'coords', 'category', 'business_hours', 'closed_days', 'parking', 'signature_menu', 'youtuber_review'];
    const fieldLabels = {
        name: '상호명',
        phone: '전화번호',
        address: '주소',
        coords: '좌표(Lat/Lng)',
        category: '카테고리',
        business_hours: '영업시간',
        closed_days: '휴무일',
        parking: '주차정보',
        signature_menu: '대표메뉴',
        youtuber_review: '유튜버리뷰'
    };

    for (const field of fieldOrder) {
        const data = stats.fields[field];
        const total = data.filled + data.empty;
        const rate = total > 0 ? ((data.filled / total) * 100).toFixed(1) : 0;
        const bar = '█'.repeat(Math.floor(rate / 5)) + '░'.repeat(20 - Math.floor(rate / 5));
        const icon = rate >= 80 ? '' : rate >= 50 ? '' : '';
        log(`   ${icon} ${fieldLabels[field].padEnd(12)} ${bar} ${rate}% (${data.filled}/${total})`);
    }
    log('');

    log('📞 전화번호 소스 분포');
    log('─'.repeat(40));
    if (Object.keys(stats.phoneSources).length > 0) {
        for (const [source, count] of Object.entries(stats.phoneSources)) {
            log(`   • ${source}: ${count}개`);
        }
    } else {
        log('   (데이터 없음)');
    }
    log('');

    log('📍 좌표 소스 분포');
    log('─'.repeat(40));
    if (Object.keys(stats.geocodingSources).length > 0) {
        for (const [source, count] of Object.entries(stats.geocodingSources)) {
            log(`   • ${source}: ${count}개`);
        }
    } else {
        log('   (데이터 없음)');
    }
    log('');

    // 이상 데이터 리포트
    log(' 이상 데이터 탐지');
    log('─'.repeat(40));

    log(`   🔴 좌표 범위 오류 (한국 밖): ${stats.issues.invalidCoords.length}개`);
    if (stats.issues.invalidCoords.length > 0 && stats.issues.invalidCoords.length <= 10) {
        for (const item of stats.issues.invalidCoords) {
            log(`      └─ ${item.name} (${item.lat?.toFixed(2)}, ${item.lng?.toFixed(2)})`);
        }
    }

    log(`    전화번호 누락 (한국 식당): ${stats.issues.missingPhone.length}개`);
    if (stats.issues.missingPhone.length > 0 && stats.issues.missingPhone.length <= 5) {
        for (const item of stats.issues.missingPhone.slice(0, 5)) {
            log(`      └─ ${item.name}`);
        }
        if (stats.issues.missingPhone.length > 5) {
            log(`      └─ ... 외 ${stats.issues.missingPhone.length - 5}개`);
        }
    }

    log(`   🟠 주소 누락: ${stats.issues.missingAddress.length}개`);
    log(`   🟣 좌표 불일치 경고: ${stats.issues.coordsMismatch.length}개`);

    log('');
    log('═'.repeat(60));
    log(' 품질 검사 완료');
    log('');
}

main().catch(error => {
    console.error(` 오류: ${error.message}`);
    process.exit(1);
});

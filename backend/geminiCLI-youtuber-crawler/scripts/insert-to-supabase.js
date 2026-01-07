/**
 * 유튜버 맛집 데이터를 Supabase에 저장
 * restaurant_youtuber 테이블에 저장
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env 로드
const envPaths = [
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../geminiCLI-restaurant-evaluation/.env'),
];
for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        config({ path: envPath });
    }
}

// Supabase 설정
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error(' SUPABASE_URL 또는 SUPABASE_KEY 환경변수가 설정되지 않았습니다.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

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
    const tags = { info: '[INFO]', success: '[OK]', warning: '[WARN]', error: '[ERR]', debug: '[DBG]' };
    console.log(`[${time}] ${tags[level] || '[LOG]'} ${msg}`);
}

/**
 * unique_id 생성
 */
function generateUniqueId(restaurant) {
    const components = [
        restaurant.name || '',
        restaurant.youtuber_name || '',
        restaurant.youtube_link || '',
    ];

    // 간단한 해시 생성
    const str = components.join('|');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }

    return `yt_${Math.abs(hash).toString(36)}_${Date.now().toString(36)}`;
}

/**
 * 카테고리 정규화
 */
function normalizeCategory(category) {
    const categoryMap = {
        '고기': '고기',
        '정육': '고기',
        '소고기': '고기',
        '돼지고기': '고기',
        '삼겹살': '고기',
        '갈비': '고기',
        '스테이크': '양식',
        '중식': '중식',
        '중국집': '중식',
        '짜장면': '중식',
        '한식': '한식',
        '일식': '일식',
        '초밥': '일식',
        '양식': '양식',
        '파스타': '양식',
        '피자': '피자',
        '치킨': '치킨',
        '분식': '분식',
        '카페': '카페·디저트',
        '디저트': '카페·디저트',
    };

    if (!category) return ['고기']; // 정육왕 기본 카테고리

    const normalized = category.toLowerCase();
    for (const [key, value] of Object.entries(categoryMap)) {
        if (normalized.includes(key.toLowerCase())) {
            return [value];
        }
    }

    return [category];
}

/**
 * 데이터 변환
 */
function transformRestaurant(restaurant, video) {
    return {
        // 1. 식별 정보
        unique_id: generateUniqueId(restaurant),

        // 2. 맛집 기본 정보
        name: restaurant.name,
        categories: normalizeCategory(restaurant.category),
        phone: restaurant.phone || null,

        // 3. 주소 정보
        origin_address: restaurant.address || null,
        road_address: restaurant.road_address || restaurant.geocoded_address || null,
        jibun_address: restaurant.jibun_address || null,

        // 4. 좌표 정보
        lat: restaurant.lat || null,
        lng: restaurant.lng || null,
        geocoding_success: !!(restaurant.lat && restaurant.lng),
        geocoding_false_stage: restaurant.lat ? null : 1,

        // 5. 유튜버/유튜브 정보
        youtuber_name: restaurant.youtuber_name || '정육왕',
        youtuber_channel: restaurant.youtuber_channel || '@meatcreator',
        youtube_link: restaurant.youtube_link,
        youtube_meta: {
            title: restaurant.video_title,
            publishedAt: video?.publishedAt,
            duration: video?.duration,
        },

        // 6. 리뷰/평가 정보
        youtuber_review: restaurant.youtuber_review || null,
        reasoning_basis: restaurant.reasoning_basis || null,
        confidence: restaurant.confidence || 'medium',

        // 7. 영업 정보 (신규)
        business_hours: restaurant.business_hours || null,
        closed_days: restaurant.closed_days || null,
        is_closed: restaurant.is_closed || false,
        parking: restaurant.parking || null,
        signature_menu: restaurant.signature_menu || [],
        price_range: restaurant.price_range || null,

        // 8. 상태 정보
        status: 'pending',
        source_type: 'youtuber_crawl',
        is_missing: false,
        is_not_selected: false,

        // 9. 추가 메타
        map_url: restaurant.map_url || null,
        map_type: restaurant.map_type || null,
        geocoding_source: restaurant.geocoding_source || null,
        address_source: restaurant.address_source || 'inferred',
        address_elements: {},
    };
}

/**
 * Supabase에 데이터 삽입
 */
async function insertToSupabase(restaurants) {
    const stats = {
        total: restaurants.length,
        success: 0,
        skipped: 0,
        failed: 0,
        errors: []
    };

    // 기존 unique_id 로드
    log('info', '기존 데이터 확인 중...');
    const { data: existingData, error: fetchError } = await supabase
        .from('restaurant_youtuber')
        .select('unique_id, youtube_link, name');

    if (fetchError) {
        // 테이블이 없으면 생성 필요
        if (fetchError.message.includes('does not exist')) {
            log('warning', 'restaurant_youtuber 테이블이 없습니다. 마이그레이션을 실행하세요.');
            return stats;
        }
        log('error', `기존 데이터 조회 실패: ${fetchError.message}`);
    }

    // 기존 데이터 매핑 (YouTube Link + Name 조합)
    const existingMap = new Map();
    existingData?.forEach(d => {
        const key = `${d.youtube_link}|${d.name}`;
        existingMap.set(key, d.unique_id);
    });

    log('info', `기존 레코드: ${existingMap.size}개`);

    // 데이터 삽입 및 업데이트
    for (let i = 0; i < restaurants.length; i++) {
        const restaurant = restaurants[i];

        // 중복 체크 키 생성
        const key = `${restaurant.youtube_link}|${restaurant.name}`;
        let isUpdate = false;

        if (existingMap.has(key)) {
            // 이미 존재하면 ID를 기존 ID로 교체하여 업데이트 (Upsert)
            restaurant.unique_id = existingMap.get(key);
            isUpdate = true;
        }

        try {
            // Upsert (Insert or Update)
            const { error } = await supabase
                .from('restaurant_youtuber')
                .upsert(restaurant, { onConflict: 'unique_id' });

            if (error) {
                stats.failed++;
                stats.errors.push({ name: restaurant.name, error: error.message });
                log('error', `[${i + 1}/${stats.total}] ${restaurant.name} - 실패: ${error.message}`);
            } else {
                if (isUpdate) {
                    stats.success++; // 통계에서는 성공으로 처리하되 로그로 구분
                    log('success', `[${i + 1}/${stats.total}] ${restaurant.name} - 업데이트 완료`);
                } else {
                    stats.success++;
                    log('success', `[${i + 1}/${stats.total}] ${restaurant.name} - 신규 저장`);
                }
            }
        } catch (error) {
            stats.failed++;
            stats.errors.push({ name: restaurant.name, error: error.message });
            log('error', `[${i + 1}/${stats.total}] ${restaurant.name} - 예외: ${error.message}`);
        }

        // Rate limit 대응
        if ((i + 1) % 50 === 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    return stats;
}

/**
 * 메인 실행
 */
async function main() {
    log('info', '='.repeat(60));
    log('info', '  Supabase 데이터 삽입 시작');
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

    // 데이터 로드
    const content = fs.readFileSync(inputFile, 'utf-8');
    const videos = content.trim().split('\n').map(line => JSON.parse(line));

    // 레스토랑 데이터 추출 및 변환
    const restaurants = [];
    for (const video of videos) {
        const places = video.analysis || video.restaurants || [];
        for (const restaurant of places) {
            const transformed = transformRestaurant(restaurant, video);
            restaurants.push(transformed);
        }
    }

    log('info', `총 ${restaurants.length}개 맛집 데이터 로드 완료`);

    if (restaurants.length === 0) {
        log('warning', '삽입할 데이터가 없습니다.');
        return;
    }

    // Supabase에 삽입
    const stats = await insertToSupabase(restaurants);

    // 결과 출력
    const duration = Date.now() - startTime;

    log('info', '');
    log('info', '='.repeat(60));
    log('success', '데이터 삽입 완료');
    log('info', '='.repeat(60));
    log('info', `총 레코드: ${stats.total}개`);
    log('success', `성공: ${stats.success}개`);
    log('warning', `스킵: ${stats.skipped}개 (이미 존재)`);
    log('error', `실패: ${stats.failed}개`);
    log('info', `소요 시간: ${Math.round(duration / 1000)}초`);
    log('info', '='.repeat(60));

    if (stats.errors.length > 0 && stats.errors.length <= 10) {
        log('error', '실패한 항목:');
        stats.errors.forEach(({ name, error }, idx) => {
            console.log(`  ${idx + 1}. ${name}: ${error}`);
        });
    }
}

main();

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { execSync } from 'child_process';

// ES 모듈에서 __dirname 대체
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env 파일 로드 (geminiCLI-restaurant-evaluation/.env)
const envPath = path.resolve(__dirname, '../.env');
console.log('📁 .env 파일 경로:', envPath);
config({ path: envPath });

// 로그 설정
const LOG_BASE_DIR = path.resolve(__dirname, '../../log/geminiCLI-restaurant');
const STAGE_NAME = 'insert-supabase';

// 한국 시간 (KST, UTC+9) 반환 함수
function getKSTDate(): Date {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (9 * 60 * 60 * 1000));
}

function formatKSTDateTime(date: Date): string {
  const kst = getKSTDate();
  const yyyy = kst.getFullYear();
  const mm = String(kst.getMonth() + 1).padStart(2, '0');
  const dd = String(kst.getDate()).padStart(2, '0');
  const hh = String(kst.getHours()).padStart(2, '0');
  const mi = String(kst.getMinutes()).padStart(2, '0');
  const ss = String(kst.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+09:00`;
}

const startTime = getKSTDate();

// 날짜별 폴더 관리 함수
function getTodayFolder(): string {
  // PIPELINE_DATE 환경변수가 있으면 우선 사용 (GitHub Actions에서 설정)
  const pipelineDate = process.env.PIPELINE_DATE;
  if (pipelineDate) {
    return pipelineDate;
  }
  
  const now = getKSTDate();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// 로그 디렉토리 생성 (supabase/yy-mm-dd/)
const LOG_DIR = path.join(LOG_BASE_DIR, 'supabase', getTodayFolder());
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLatestFolder(dataDir: string): string | null {
  if (!fs.existsSync(dataDir)) return null;
  
  const folders = fs.readdirSync(dataDir)
    .filter(f => /^\d{2}-\d{2}-\d{2}$/.test(f))
    .sort()
    .reverse();
  
  return folders.length > 0 ? folders[0] : null;
}

function getAllTransformFiles(dataDir: string): string[] {
  if (!fs.existsSync(dataDir)) return [];
  
  const files: string[] = [];
  const folders = fs.readdirSync(dataDir)
    .filter(f => /^\d{2}-\d{2}-\d{2}$/.test(f));
  
  for (const folder of folders) {
    const filePath = path.join(dataDir, folder, 'tzuyang_restaurant_transforms.jsonl');
    if (fs.existsSync(filePath)) {
      files.push(filePath);
    }
  }
  
  return files;
}

// 데이터 경로 설정
const DATA_DIR = path.resolve(__dirname, '../data');
const TODAY_FOLDER = getTodayFolder();
const LATEST_FOLDER = getLatestFolder(DATA_DIR);

// 입력 파일 경로 결정
let INPUT_FILE = path.join(DATA_DIR, TODAY_FOLDER, 'tzuyang_restaurant_transforms.jsonl');
if (!fs.existsSync(INPUT_FILE) && LATEST_FOLDER) {
  INPUT_FILE = path.join(DATA_DIR, LATEST_FOLDER, 'tzuyang_restaurant_transforms.jsonl');
}

// 시간 포맷팅 함수
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

function formatDateTime(date: Date): string {
  const kst = getKSTDate();
  const yyyy = kst.getFullYear();
  const mm = String(kst.getMonth() + 1).padStart(2, '0');
  const dd = String(kst.getDate()).padStart(2, '0');
  const hh = String(kst.getHours()).padStart(2, '0');
  const mi = String(kst.getMinutes()).padStart(2, '0');
  const ss = String(kst.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function getKSTTimeString(): string {
  const kst = getKSTDate();
  const hh = String(kst.getHours()).padStart(2, '0');
  const mi = String(kst.getMinutes()).padStart(2, '0');
  const ss = String(kst.getSeconds()).padStart(2, '0');
  return `${hh}:${mi}:${ss}`;
}

// 로그 레벨별 출력 함수
function logInfo(msg: string): void {
  console.log(`[${getKSTTimeString()}] ℹ️  ${msg}`);
}

function logSuccess(msg: string): void {
  console.log(`[${getKSTTimeString()}] ✅ ${msg}`);
}

function logWarning(msg: string): void {
  console.log(`[${getKSTTimeString()}] ⚠️  ${msg}`);
}

function logError(msg: string): void {
  console.error(`[${getKSTTimeString()}] ❌ ${msg}`);
}

function logDebug(msg: string): void {
  console.log(`[${getKSTTimeString()}] 🔍 ${msg}`);
}

// Supabase 클라이언트 설정
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  logError('SUPABASE_URL 또는 SUPABASE_KEY 환경변수가 설정되지 않았습니다.');
  logError(`SUPABASE_URL: ${supabaseUrl || '(없음)'}`);
  logError(`SUPABASE_KEY: ${supabaseKey ? '설정됨' : '(없음)'}`);
  process.exit(1);
}

logSuccess('환경변수 로드 완료');
logInfo(`Supabase URL: ${supabaseUrl}`);
logDebug(`사용 중인 키: ${supabaseKey.substring(0, 20)}...`);

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

interface RestaurantData {
  youtube_link: string;
  unique_id: string;
  status: string;
  youtube_meta: any;
  name: string;
  phone: string | null;
  category: string;
  reasoning_basis: string;
  tzuyang_review: string;
  origin_address: any;
  roadAddress: string | null;
  jibunAddress: string | null;
  englishAddress: string | null;
  addressElements: any;
  lat: number | null;
  lng: number | null;
  geocoding_success: boolean;
  geocoding_false_stage: number | null;
  is_missing: boolean;
  is_notSelected: boolean;
  evaluation_results: any;
  source_type: string;
}

// RLS 정책 비활성화 (서비스 역할 키 사용시 자동 우회됨)
// 하지만 명시적으로 비활성화하려면 SQL을 직접 실행해야 합니다.

async function disableRLS() {
  logInfo('RLS 정책을 비활성화합니다...');
  
  const { error } = await supabase.rpc('exec_sql', {
    sql_query: `
      ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
      ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
    `
  });

  if (error) {
    logWarning(`RLS 비활성화 실패 (서비스 키로 자동 우회됩니다): ${error.message}`);
  } else {
    logSuccess('RLS 정책이 비활성화되었습니다.');
  }
}

async function enableRLS() {
  logInfo('RLS 정책을 다시 활성화합니다...');
  
  const { error } = await supabase.rpc('exec_sql', {
    sql_query: `
      ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    `
  });

  if (error) {
    logError(`RLS 활성화 실패: ${error.message}`);
  } else {
    logSuccess('RLS 정책이 활성화되었습니다.');
  }
}

async function insertRestaurants(): Promise<{
  successCount: number;
  failCount: number;
  skippedCount: number;
  restoredCount: number;
  totalLines: number;
  errors: Array<{ name: string; error: string }>;
}> {
  const stats = {
    successCount: 0,
    failCount: 0,
    skippedCount: 0,
    restoredCount: 0,
    totalLines: 0,
    errors: [] as Array<{ name: string; error: string }>
  };

  try {
    // 모든 날짜 폴더에서 transforms 파일 읽기
    const allTransformFiles = getAllTransformFiles(DATA_DIR);
    logInfo(`📂 모든 날짜 폴더에서 transforms 파일 검색 중...`);
    logInfo(`   발견된 파일: ${allTransformFiles.length}개`);
    
    if (allTransformFiles.length === 0) {
      logError(`transforms 파일이 존재하지 않습니다.`);
      return stats;
    }
    
    // 모든 파일에서 데이터 로드 (중복 제거용 Set)
    const allLines: string[] = [];
    const seenUniqueIds = new Set<string>();
    
    for (const filePath of allTransformFiles) {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const lines = fileContent.trim().split('\n').filter(l => l.trim());
      
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          const uniqueId = data.unique_id;
          
          // 파일 간 중복 체크 (같은 unique_id는 첫 번째만 사용)
          if (uniqueId && !seenUniqueIds.has(uniqueId)) {
            seenUniqueIds.add(uniqueId);
            allLines.push(line);
          }
        } catch (e) {
          // JSON 파싱 오류는 무시
        }
      }
      
      logDebug(`   ${path.basename(path.dirname(filePath))}: ${lines.length}개 로드`);
    }
    
    stats.totalLines = allLines.length;
    logInfo(`총 ${allLines.length}개의 레스토랑 데이터를 읽었습니다. (중복 제거 후)`);

    // DB에서 모든 unique_id를 한번에 로드 (성능 개선)
    logInfo('DB에서 기존 unique_id를 로드하는 중...');
    const dbLoadStart = Date.now();
    
    const { data: existingRecords, error: fetchError } = await supabase
      .from('restaurants')
      .select('unique_id, status');

    if (fetchError) {
      logError(`DB 조회 실패: ${fetchError.message}`);
      throw fetchError;
    }

    const dbLoadDuration = Date.now() - dbLoadStart;
    logDebug(`DB 로드 시간: ${formatDuration(dbLoadDuration)}`);

    // 메모리에서 중복 체크를 위한 Set 생성
    const existingUniqueIds = new Set<string>();
    const deletedUniqueIds = new Set<string>();

    if (existingRecords) {
      for (const record of existingRecords) {
        existingUniqueIds.add(record.unique_id);
        if (record.status === 'deleted') {
          deletedUniqueIds.add(record.unique_id);
        }
      }
    }

    logInfo(`기존 레코드: ${existingUniqueIds.size}개 (삭제됨: ${deletedUniqueIds.size}개)`);

    // 데이터 삽입
    const insertStart = Date.now();
    const lines = allLines;  // 변수명 호환성 유지
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const data: RestaurantData = JSON.parse(line);
        
        // categories 배열로 변환
        const categories = data.category ? [data.category] : [];

        // 삽입할 데이터 준비 (컬럼 순서 정리)
        const restaurantData = {
          // 기본 식별 정보
          unique_id: data.unique_id,
          name: data.name,
          phone: data.phone, // 전화번호 그대로 저장 (해외 번호 포함)
          categories: categories,
          status: data.status || 'pending',
          source_type: data.source_type,
          
          // 유튜브 및 평가 정보
          youtube_link: data.youtube_link,
          youtube_meta: data.youtube_meta,
          evaluation_results: data.evaluation_results,
          reasoning_basis: data.reasoning_basis,
          tzuyang_review: data.tzuyang_review || null,
          
          // 주소 정보
          origin_address: data.origin_address,
          road_address: data.roadAddress,
          jibun_address: data.jibunAddress,
          english_address: data.englishAddress,
          address_elements: data.addressElements || {},
          
          // 지오코딩 및 상태
          geocoding_success: data.geocoding_success,
          geocoding_false_stage: data.geocoding_false_stage,
          is_missing: data.is_missing,
          is_not_selected: data.is_notSelected || false,
          
          // 위치 좌표 (naver_address 지오코딩 결과)
          lat: data.lat || null,
          lng: data.lng || null,
          
          // 리뷰 통계
          review_count: 0
        };

        // 중복 체크 (메모리에서 빠르게 처리)
        if (existingUniqueIds.has(data.unique_id)) {
          // deleted 레코드인 경우에만 복원
          if (deletedUniqueIds.has(data.unique_id)) {
            const { error: updateError } = await supabase
              .from('restaurants')
              .update({
                ...restaurantData,
                status: data.status || 'pending',
                updated_at: formatKSTDateTime(getKSTDate()),
              })
              .eq('unique_id', data.unique_id);

            if (updateError) {
              stats.failCount++;
              stats.errors.push({ name: data.name, error: updateError.message });
              logError(`[${i + 1}/${lines.length}] ${data.name} - 복원 실패: ${updateError.message}`);
            } else {
              stats.restoredCount++;
              stats.successCount++;
              logSuccess(`[${i + 1}/${lines.length}] ${data.name} - 복원 및 업데이트 성공`);
            }
          } else {
            // 이미 active 레코드가 있으면 스킵 (로그 없이)
            stats.skippedCount++;
          }
          continue;
        }

        // 새 레코드 삽입
        const { error } = await supabase
          .from('restaurants')
          .insert(restaurantData);

        if (error) {
          stats.failCount++;
          const errorMsg = error.message || error.hint || JSON.stringify(error);
          stats.errors.push({ name: data.name, error: errorMsg });
          logError(`[${i + 1}/${lines.length}] ${data.name} - 실패: ${errorMsg}`);
        } else {
          stats.successCount++;
          logSuccess(`[${i + 1}/${lines.length}] ${data.name} - 성공`);
        }

        // 100개마다 잠시 대기 (Rate limit 방지)
        if ((i + 1) % 100 === 0) {
          logInfo(`진행률: ${i + 1}/${lines.length} (${Math.round((i + 1) / lines.length * 100)}%)`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (parseError: any) {
        stats.failCount++;
        logError(`[${i + 1}/${lines.length}] JSON 파싱 실패: ${parseError.message}`);
      }
    }

    const insertDuration = Date.now() - insertStart;
    logInfo(`데이터 삽입 소요 시간: ${formatDuration(insertDuration)}`);

    return stats;

  } catch (error: any) {
    logError(`오류 발생: ${error.message}`);
    throw error;
  }
}

async function main() {
  try {
    logInfo('=' .repeat(60));
    logInfo('  Supabase 데이터 삽입 시작');
    logInfo('=' .repeat(60));
    logInfo(`시작 시간: ${formatDateTime(startTime)}`);
    
    // 서비스 역할 키를 사용하면 RLS를 자동으로 우회하지만,
    // 명시적으로 비활성화하려면 아래 주석을 해제하세요.
    // await disableRLS();
    
    const stats = await insertRestaurants();
    
    // await enableRLS();
    
    const endTime = getKSTDate();
    const duration = endTime.getTime() - startTime.getTime();
    
    // 결과 출력
    logInfo('');
    logInfo('=' .repeat(60));
    logSuccess('📊 데이터 삽입 완료');
    logInfo('=' .repeat(60));
    logInfo(`시작 시간: ${formatDateTime(startTime)}`);
    logInfo(`종료 시간: ${formatDateTime(endTime)}`);
    logInfo(`총 소요 시간: ${formatDuration(duration)}`);
    logInfo('');
    logInfo('📊 처리 통계:');
    logSuccess(`  성공: ${stats.successCount}개`);
    if (stats.restoredCount > 0) {
      logInfo(`  복원: ${stats.restoredCount}개`);
    }
    logWarning(`  스킵: ${stats.skippedCount}개 (이미 존재)`);
    if (stats.failCount > 0) {
      logError(`  실패: ${stats.failCount}개`);
    }
    logInfo(`  총 라인: ${stats.totalLines}개`);
    
    if (stats.totalLines > 0) {
      const successRate = ((stats.successCount / stats.totalLines) * 100).toFixed(1);
      logInfo(`  성공률: ${successRate}%`);
    }
    logInfo('=' .repeat(60));

    if (stats.errors.length > 0 && stats.errors.length <= 20) {
      logError('실패한 항목:');
      stats.errors.forEach(({ name, error }, idx) => {
        logError(`  ${idx + 1}. ${name}: ${error}`);
      });
    }

    // JSON 로그 저장 (한국 시간 기준 파일명)
    const kstNow = getKSTDate();
    const logFileName = `${STAGE_NAME}_${kstNow.getFullYear()}${String(kstNow.getMonth() + 1).padStart(2, '0')}${String(kstNow.getDate()).padStart(2, '0')}_${String(kstNow.getHours()).padStart(2, '0')}${String(kstNow.getMinutes()).padStart(2, '0')}${String(kstNow.getSeconds()).padStart(2, '0')}.json`;
    const logFilePath = path.join(LOG_DIR, logFileName);
    
    const logData = {
      stage: STAGE_NAME,
      started_at: formatDateTime(startTime),
      ended_at: formatDateTime(endTime),
      duration_seconds: Math.floor(duration / 1000),
      duration_formatted: formatDuration(duration),
      statistics: {
        total_lines: stats.totalLines,
        success: stats.successCount,
        failed: stats.failCount,
        skipped: stats.skippedCount,
        restored: stats.restoredCount,
        success_rate: stats.totalLines > 0 
          ? `${((stats.successCount / stats.totalLines) * 100).toFixed(1)}%` 
          : 'N/A'
      },
      errors: stats.errors.slice(0, 50)  // 최대 50개만 저장
    };
    
    fs.writeFileSync(logFilePath, JSON.stringify(logData, null, 2), 'utf-8');
    logSuccess(`로그 파일 저장: ${logFilePath}`);
    
    logSuccess('모든 작업이 완료되었습니다!');
  } catch (error: any) {
    logError(`작업 실패: ${error.message}`);
    process.exit(1);
  }
}

main();

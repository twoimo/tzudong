import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// ES 모듈에서 __dirname 대체
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// frontend 폴더의 .env 파일 로드 (프로젝트 루트/.env가 없으면 frontend/.env 사용)
const rootEnvPath = path.resolve(__dirname, '../../../.env');
const frontendEnvPath = path.resolve(__dirname, '../../../frontend/.env');
const envPath = fs.existsSync(rootEnvPath) ? rootEnvPath : frontendEnvPath;
console.log('📁 .env 파일 경로:', envPath);
config({ path: envPath });

// Supabase 클라이언트 설정
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL 또는 SUPABASE_KEY 환경변수가 설정되지 않았습니다.');
  console.error('📍 SUPABASE_URL:', supabaseUrl || '(없음)');
  console.error('🔑 SUPABASE_KEY:', supabaseKey ? '설정됨' : '(없음)');
  process.exit(1);
}

console.log('✅ 환경변수 로드 완료');
console.log('📍 Supabase URL:', supabaseUrl);
console.log('🔑 사용 중인 키:', supabaseKey.substring(0, 20) + '...');

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
  console.log('📝 RLS 정책을 비활성화합니다...');
  
  const { error } = await supabase.rpc('exec_sql', {
    sql_query: `
      ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
      ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
    `
  });

  if (error) {
    console.error('⚠️  RLS 비활성화 실패 (서비스 키로 자동 우회됩니다):', error.message);
  } else {
    console.log('✅ RLS 정책이 비활성화되었습니다.');
  }
}

async function enableRLS() {
  console.log('📝 RLS 정책을 다시 활성화합니다...');
  
  const { error } = await supabase.rpc('exec_sql', {
    sql_query: `
      ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    `
  });

  if (error) {
    console.error('❌ RLS 활성화 실패:', error.message);
  } else {
    console.log('✅ RLS 정책이 활성화되었습니다.');
  }
}

async function insertRestaurants() {
  try {
    // JSONL 파일 읽기
    const filePath = path.join(__dirname, '../tzuyang_restaurant_transforms.jsonl');
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const lines = fileContent.trim().split('\n');
    
    console.log(`📊 총 ${lines.length}개의 레스토랑 데이터를 읽었습니다.\n`);

    // DB에서 모든 unique_id를 한번에 로드 (성능 개선)
    console.log('🔍 DB에서 기존 unique_id를 로드하는 중...');
    const { data: existingRecords, error: fetchError } = await supabase
      .from('restaurants')
      .select('unique_id, status');

    if (fetchError) {
      console.error('❌ DB 조회 실패:', fetchError.message);
      throw fetchError;
    }

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

    console.log(`✅ 기존 레코드: ${existingUniqueIds.size}개 (삭제됨: ${deletedUniqueIds.size}개)\n`);

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;
    const errors: Array<{ name: string; error: string }> = [];

    // 데이터 삽입
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
          
          // 위치 좌표
          lat: data.origin_address?.lat || null,
          lng: data.origin_address?.lng || null,
          
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
                updated_at: new Date().toISOString(),
              })
              .eq('unique_id', data.unique_id);

            if (updateError) {
              failCount++;
              errors.push({ name: data.name, error: updateError.message });
              console.log(`❌ [${i + 1}/${lines.length}] ${data.name} - 복원 실패: ${updateError.message}`);
            } else {
              successCount++;
              console.log(`🔄 [${i + 1}/${lines.length}] ${data.name} - 복원 및 업데이트 성공`);
            }
          } else {
            // 이미 active 레코드가 있으면 스킵
            skippedCount++;
            console.log(`⏭️  [${i + 1}/${lines.length}] ${data.name} - 이미 존재 (스킵)`);
          }
          continue;
        }

        // 새 레코드 삽입
        const { error } = await supabase
          .from('restaurants')
          .insert(restaurantData);

        if (error) {
          failCount++;
          const errorMsg = error.message || error.hint || JSON.stringify(error);
          errors.push({ name: data.name, error: errorMsg });
          console.log(`❌ [${i + 1}/${lines.length}] ${data.name} - 실패: ${errorMsg}`);
        } else {
          successCount++;
          console.log(`✅ [${i + 1}/${lines.length}] ${data.name} - 성공`);
        }

        // 100개마다 잠시 대기 (Rate limit 방지)
        if ((i + 1) % 100 === 0) {
          console.log(`\n⏳ 잠시 대기 중...\n`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (parseError: any) {
        failCount++;
        console.log(`❌ [${i + 1}/${lines.length}] JSON 파싱 실패: ${parseError.message}`);
      }
    }

    // 결과 출력
    console.log('\n' + '='.repeat(60));
    console.log('📊 데이터 삽입 완료!');
    console.log('='.repeat(60));
    console.log(`✅ 성공: ${successCount}개`);
    console.log(`⏭️  스킵: ${skippedCount}개 (이미 존재)`);
    console.log(`❌ 실패: ${failCount}개`);
    console.log('='.repeat(60));

    if (errors.length > 0) {
      console.log('\n❌ 실패한 항목:');
      errors.forEach(({ name, error }, idx) => {
        console.log(`  ${idx + 1}. ${name}: ${error}`);
      });
    }

  } catch (error: any) {
    console.error('❌ 오류 발생:', error.message);
    throw error;
  }
}

async function main() {
  try {
    console.log('🚀 데이터 삽입을 시작합니다...\n');
    
    // 서비스 역할 키를 사용하면 RLS를 자동으로 우회하지만,
    // 명시적으로 비활성화하려면 아래 주석을 해제하세요.
    // await disableRLS();
    
    await insertRestaurants();
    
    // await enableRLS();
    
    console.log('\n✨ 모든 작업이 완료되었습니다!');
  } catch (error: any) {
    console.error('❌ 작업 실패:', error.message);
    process.exit(1);
  }
}

main();

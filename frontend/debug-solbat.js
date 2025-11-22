// 솔밭식당 검색 디버깅 스크립트
const { createClient } = require('@supabase/supabase-js');

// 환경 변수 로드 (실제 값으로 교체 필요)
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function debugSolbatSearch() {
  console.log('🔍 솔밭식당 검색 디버깅 시작...');

  try {
    // 1. 이름으로 검색
    console.log('\n1. 이름으로 검색 (RPC 함수 사용)');
    const { data: nameResults, error: nameError } = await supabase.rpc('search_restaurants_by_name', {
      search_query: '솔밭식당',
      similarity_threshold: 0.001,
      max_results: 50
    });

    if (nameError) {
      console.error('이름 검색 오류:', nameError);
    } else {
      console.log('이름 검색 결과 개수:', nameResults?.length || 0);
      if (nameResults && nameResults.length > 0) {
        nameResults.forEach((r, i) => {
          console.log(`${i+1}. ${r.name} (ID: ${r.id}) - ${r.address}`);
          console.log(`   병합됨: ${r.merged_restaurants ? '예' : '아니오'}`);
        });
      }
    }

    // 2. YouTube 제목으로 검색
    console.log('\n2. YouTube 제목으로 검색 (RPC 함수 사용)');
    const { data: youtubeResults, error: youtubeError } = await supabase.rpc('search_restaurants_by_youtube_title', {
      search_query: '솔밭식당',
      similarity_threshold: 0.01,
      max_results: 50
    });

    if (youtubeError) {
      console.error('YouTube 검색 오류:', youtubeError);
    } else {
      console.log('YouTube 검색 결과 개수:', youtubeResults?.length || 0);
      if (youtubeResults && youtubeResults.length > 0) {
        youtubeResults.forEach((r, i) => {
          console.log(`${i+1}. ${r.name} (ID: ${r.id}) - ${r.youtube_link}`);
          console.log(`   병합됨: ${r.merged_restaurants ? '예' : '아니오'}`);
        });
      }
    }

    // 3. 직접 restaurants 테이블에서 검색
    console.log('\n3. restaurants 테이블 직접 검색');
    const { data: directResults, error: directError } = await supabase
      .from('restaurants')
      .select('*')
      .ilike('name', '%솔밭식당%')
      .eq('status', 'approved')
      .limit(10);

    if (directError) {
      console.error('직접 검색 오류:', directError);
    } else {
      console.log('직접 검색 결과 개수:', directResults?.length || 0);
      if (directResults && directResults.length > 0) {
        directResults.forEach((r, i) => {
          console.log(`${i+1}. ${r.name} (ID: ${r.id})`);
          console.log(`   주소: ${r.road_address || r.jibun_address}`);
          console.log(`   좌표: ${r.lat}, ${r.lng}`);
          console.log(`   카테고리: ${r.categories}`);
          console.log(`   유튜브: ${r.youtube_link}`);
          console.log(`   리뷰: ${r.tzuyang_review?.substring(0, 50)}...`);
        });
      }
    }

  } catch (error) {
    console.error('디버깅 중 오류 발생:', error);
  }
}

debugSolbatSearch();

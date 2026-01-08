import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .env 파일 로드 (scripts 폴더의 상위 폴더)
const envPath = join(__dirname, '..', '.env');
console.log(`📁 .env 경로: ${envPath}`);
dotenv.config({ path: envPath });

class CoordinateEnricher {
  constructor(inputFile, outputFile = null) {
    this.inputFile = inputFile;
    this.outputFile = outputFile || inputFile; // 기본값: 입력 파일에 덮어쓰기
    this.kakaoApiKey = process.env.KAKAO_REST_API_KEY;
    
    if (!this.kakaoApiKey) {
      throw new Error('KAKAO_REST_API_KEY 환경변수가 설정되어 있지 않습니다.');
    }
  }

  /**
   * 카카오 지오코딩 API를 통해 주소로 좌표를 조회합니다.
   */
  async getCoordinatesFromKakao(address) {
    if (!address || address.trim() === '') {
      return null;
    }

    try {
      const encodedAddress = encodeURIComponent(address.trim());
      const apiUrl = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodedAddress}`;

      console.log(`🗺️  카카오 API 호출: ${address}`);

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `KakaoAK ${this.kakaoApiKey}`
        },
        timeout: 10000
      });

      if (!response.ok) {
        console.warn(`⚠️  카카오 API 실패 (${response.status}): ${address}`);
        return null;
      }

      const data = await response.json();

      if (data.documents && data.documents.length > 0) {
        const firstResult = data.documents[0];
        const lat = parseFloat(firstResult.y);
        const lng = parseFloat(firstResult.x);

        if (!isNaN(lat) && !isNaN(lng)) {
          console.log(`✅ 좌표 획득: ${address} → (${lat}, ${lng})`);
          return { lat, lng };
        }
      }

      // 주소 검색 결과가 없으면 키워드 검색 시도
      return await this.getCoordinatesFromKakaoKeyword(address);

    } catch (error) {
      console.warn(`⚠️  카카오 API 오류 (${address}):`, error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  /**
   * 카카오 키워드 검색 API를 통해 좌표를 조회합니다 (주소 검색 실패 시 대체)
   */
  async getCoordinatesFromKakaoKeyword(query) {
    try {
      const encodedQuery = encodeURIComponent(query.trim());
      const apiUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodedQuery}`;

      console.log(`🔍 카카오 키워드 검색: ${query}`);

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `KakaoAK ${this.kakaoApiKey}`
        },
        timeout: 10000
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      if (data.documents && data.documents.length > 0) {
        const firstResult = data.documents[0];
        const lat = parseFloat(firstResult.y);
        const lng = parseFloat(firstResult.x);

        if (!isNaN(lat) && !isNaN(lng)) {
          console.log(`✅ 키워드 검색으로 좌표 획득: (${lat}, ${lng})`);
          return { lat, lng };
        }
      }

      console.warn(`⚠️  좌표를 찾을 수 없음: ${query}`);
      return null;

    } catch (error) {
      return null;
    }
  }

  /**
   * JSONL 파일을 읽어서 좌표가 없는 항목들을 보완합니다.
   */
  async enrichFromJsonl() {
    if (!existsSync(this.inputFile)) {
      console.error(`❌ 파일을 찾을 수 없습니다: ${this.inputFile}`);
      process.exit(1);
    }

    console.log(`📖 JSONL 파일 읽기: ${this.inputFile}`);
    const content = readFileSync(this.inputFile, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    console.log(`📊 ${lines.length}개 항목 발견`);

    let totalRestaurants = 0;
    let enrichedCount = 0;
    let updatedEntries = [];

    for (let i = 0; i < lines.length; i++) {
      const entry = JSON.parse(lines[i]);

      if (entry.restaurants && Array.isArray(entry.restaurants)) {
        for (let j = 0; j < entry.restaurants.length; j++) {
          const restaurant = entry.restaurants[j];
          totalRestaurants++;

          // 좌표가 없고 주소가 있는 경우에만 API 호출
          if ((restaurant.lat === null || restaurant.lat === undefined) &&
              restaurant.address && restaurant.address.trim() !== '') {

            console.log(`\n🔄 [${i + 1}/${lines.length}] ${restaurant.name || 'Unknown'}`);

            const coordinates = await this.getCoordinatesFromKakao(restaurant.address);
            if (coordinates) {
              entry.restaurants[j] = {
                ...restaurant,
                lat: coordinates.lat,
                lng: coordinates.lng
              };
              enrichedCount++;
            }

            // API 호출 간격 (100ms)
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      }

      updatedEntries.push(entry);
    }

    // 파일에 쓰기
    console.log(`\n💾 결과 저장: ${this.outputFile}`);
    const outputContent = updatedEntries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
    writeFileSync(this.outputFile, outputContent, 'utf-8');

    console.log('\n✅ 좌표 보완 완료!');
    console.log(`📊 총 음식점 수: ${totalRestaurants}`);
    console.log(`📍 좌표 보완됨: ${enrichedCount}`);
  }

  /**
   * 단일 JSON 객체 (Gemini CLI 출력)를 처리합니다.
   */
  async enrichFromJson() {
    if (!existsSync(this.inputFile)) {
      console.error(`❌ 파일을 찾을 수 없습니다: ${this.inputFile}`);
      process.exit(1);
    }

    console.log(`📖 JSON 파일 읽기: ${this.inputFile}`);
    const content = readFileSync(this.inputFile, 'utf-8');
    const data = JSON.parse(content);

    let enrichedCount = 0;

    if (data.restaurants && Array.isArray(data.restaurants)) {
      for (let i = 0; i < data.restaurants.length; i++) {
        const restaurant = data.restaurants[i];

        if ((restaurant.lat === null || restaurant.lat === undefined) &&
            restaurant.address && restaurant.address.trim() !== '') {

          console.log(`\n🔄 [${i + 1}/${data.restaurants.length}] ${restaurant.name || 'Unknown'}`);

          const coordinates = await this.getCoordinatesFromKakao(restaurant.address);
          if (coordinates) {
            data.restaurants[i] = {
              ...restaurant,
              lat: coordinates.lat,
              lng: coordinates.lng
            };
            enrichedCount++;
          }

          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }

    console.log(`\n💾 결과 저장: ${this.outputFile}`);
    writeFileSync(this.outputFile, JSON.stringify(data, null, 2), 'utf-8');

    console.log('\n✅ 좌표 보완 완료!');
    console.log(`📊 총 음식점 수: ${data.restaurants?.length || 0}`);
    console.log(`📍 좌표 보완됨: ${enrichedCount}`);

    return data;
  }
}

// CLI 실행
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
사용법:
  node enrich-coordinates.js <입력파일> [출력파일]
  
예시:
  node enrich-coordinates.js ../data/result.json
  node enrich-coordinates.js ../data/results.jsonl ../data/results_enriched.jsonl
  
지원 형식:
  - .json: 단일 JSON 객체 (Gemini CLI 출력 형식)
  - .jsonl: JSONL 형식 (여러 개의 JSON 객체)
`);
    process.exit(0);
  }

  const inputFile = args[0].startsWith('/') ? args[0] : join(process.cwd(), args[0]);
  const outputFile = args[1] ? (args[1].startsWith('/') ? args[1] : join(process.cwd(), args[1])) : inputFile;

  const enricher = new CoordinateEnricher(inputFile, outputFile);

  if (inputFile.endsWith('.jsonl')) {
    await enricher.enrichFromJsonl();
  } else {
    await enricher.enrichFromJson();
  }
}

main().catch(error => {
  console.error('❌ 오류:', error.message);
  process.exit(1);
});

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import fetch from 'node-fetch';

class CoordinateEnricher {
  constructor() {
    this.filePath = join(process.cwd(), 'tzuyang_restaurant_results.jsonl');
  }

  /**
   * 네이버 지도 API를 통해 주소로 좌표를 조회합니다.
   */
  async getCoordinatesFromNaverMap(address) {
    if (!address || address.trim() === '') {
      return null;
    }

    try {
      // 주소를 URL 인코딩
      const encodedAddress = encodeURIComponent(address.trim());
      const apiUrl = `http://www.moamodu.com/develop/naver_map_new_proxy.php?query=${encodedAddress}`;

      console.log(`🗺️  Naver Map API 호출: ${address}`);

      const response = await fetch(apiUrl, {
        timeout: 10000, // 10초 타임아웃
      });

      if (!response.ok) {
        console.warn(`⚠️  Naver Map API 실패 (${response.status}): ${address}`);
        return null;
      }

      const data = await response.json();

      if (data.status === 'OK' && data.addresses && data.addresses.length > 0) {
        const firstResult = data.addresses[0];
        const lat = parseFloat(firstResult.y);
        const lng = parseFloat(firstResult.x);

        if (!isNaN(lat) && !isNaN(lng)) {
          console.log(`✅ 좌표 획득: ${address} → (${lat}, ${lng})`);
          return { lat, lng };
        }
      }

      console.warn(`⚠️  유효한 좌표를 찾을 수 없음: ${address}`);
      return null;

    } catch (error) {
      console.warn(`⚠️  Naver Map API 오류 (${address}):`, error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  /**
   * 모든 데이터를 읽어서 좌표가 없는 항목들을 보완합니다.
   */
  async enrichAllCoordinates(limit = 0) { // limit이 0이면 전체, 아니면 해당 개수만큼만
    try {
      console.log('📖 Reading JSONL file...');
      const content = readFileSync(this.filePath, 'utf-8');
      const lines = content.trim().split('\n');

      console.log(`📊 Found ${lines.length} entries to process`);

      let totalRestaurants = 0;
      let enrichedCount = 0;
      let updatedEntries = [];
      const maxEntries = limit > 0 ? Math.min(limit, lines.length) : lines.length;

      console.log(`🎯 Processing up to ${maxEntries} entries (${limit > 0 ? 'LIMITED MODE' : 'FULL MODE'})`);

      for (let i = 0; i < maxEntries; i++) {
        const line = lines[i];
        const entry = JSON.parse(line.trim());

        if (entry.restaurants && Array.isArray(entry.restaurants)) {
          let entryUpdated = false;

          for (let j = 0; j < entry.restaurants.length; j++) {
            const restaurant = entry.restaurants[j];
            totalRestaurants++;

            // 좌표가 없는 경우에만 API 호출
            if ((restaurant.lat === null || restaurant.lat === undefined ||
                 restaurant.lng === null || restaurant.lng === undefined) &&
                restaurant.address && restaurant.address.trim() !== '') {

              console.log(`🔄 Processing ${i + 1}/${lines.length}: ${restaurant.name || 'Unknown'} - ${restaurant.address}`);

              const coordinates = await this.getCoordinatesFromNaverMap(restaurant.address);
              if (coordinates) {
                entry.restaurants[j] = {
                  ...restaurant,
                  lat: coordinates.lat,
                  lng: coordinates.lng
                };
                enrichedCount++;
                entryUpdated = true;
                console.log(`📍 좌표 보완 완료: ${restaurant.name || 'Unknown'}`);
              }

              // API 호출 간격 조절 (너무 빠른 호출 방지)
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }

          if (entryUpdated || entry.restaurants.length > 0) {
            updatedEntries.push(entry);
          } else {
            updatedEntries.push(entry);
          }
        } else {
          updatedEntries.push(entry);
        }

        if ((i + 1) % 50 === 0) {
          console.log(`🔄 Processed ${i + 1}/${lines.length} entries...`);
        }
      }

      // 파일에 다시 쓰기
      console.log('💾 Writing enriched data to file...');
      const outputContent = updatedEntries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
      writeFileSync(this.filePath, outputContent, 'utf-8');

      console.log('✅ Coordinate enrichment completed!');
      console.log(`📊 Total restaurants processed: ${totalRestaurants}`);
      console.log(`📍 Coordinates enriched: ${enrichedCount}`);

    } catch (error) {
      console.error('❌ Error enriching coordinates:', error.message);
      process.exit(1);
    }
  }
}

// 실행
async function main() {
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : 0;
  const enricher = new CoordinateEnricher();
  await enricher.enrichAllCoordinates(limit);
}

main().catch(console.error);

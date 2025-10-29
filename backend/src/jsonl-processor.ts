import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RestaurantInfo, RestaurantData } from './types.js';

export class JsonlProcessor {
  private filePath: string;

  constructor(filePath: string = './tzuyang_restaurant_results.jsonl') {
    this.filePath = join(process.cwd(), filePath);
  }

  readAllEntries(): RestaurantData[] {
    try {
      const content = readFileSync(this.filePath, 'utf-8');
      const lines = content.trim().split('\n');
      return lines.map(line => {
        const parsed = JSON.parse(line.trim());
        // 기존 RestaurantInfo 구조를 RestaurantData로 변환
        if (parsed.youtube_link && !parsed.restaurants) {
          return {
            youtube_link: parsed.youtube_link,
            restaurants: [{
              name: parsed.name,
              phone: parsed.phone,
              address: parsed.address,
              lat: parsed.lat,
              lng: parsed.lng,
              category: parsed.category,
              youtube_link: parsed.youtube_link,
              reasoning_basis: parsed.reasoning_basis || ''
            }]
          };
        }
        // 이미 RestaurantData 구조인 경우
        return parsed;
      }).filter(Boolean);
    } catch (error) {
      console.error('Error reading JSONL file:', error);
      return [];
    }
  }

  findNullEntries(): RestaurantData[] {
    const entries = this.readAllEntries();
    return entries.filter(entry => {
      // restaurants 배열이 없거나 빈 배열인 경우
      if (!entry.restaurants || entry.restaurants.length === 0) {
        return true;
      }

      // 모든 restaurant 객체 중 하나라도 reasoning_basis가 없거나 빈 문자열인 경우
      return entry.restaurants.some(restaurant =>
        !restaurant.reasoning_basis || restaurant.reasoning_basis.trim() === ''
      );
    });
  }

  updateEntry(youtubeLink: string, newData: RestaurantInfo[]): boolean {
    try {
      const entries = this.readAllEntries();
      const index = entries.findIndex(entry => entry.youtube_link === youtubeLink);

      if (index === -1) {
        // 새로운 항목 추가
        entries.push({
          youtube_link: youtubeLink,
          restaurants: newData
        });
      } else {
        // 기존 항목 업데이트 - 새로운 restaurants 추가
        entries[index].restaurants = [...(entries[index].restaurants || []), ...newData];
      }

      // 파일에 다시 쓰기
      const content = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
      writeFileSync(this.filePath, content, 'utf-8');

      console.log(`✅ Updated entry for ${youtubeLink} with ${newData.length} restaurant(s)`);
      return true;

    } catch (error) {
      console.error('Error updating JSONL file:', error);
      return false;
    }
  }

  getNextNullEntry(): RestaurantData | null {
    const nullEntries = this.findNullEntries();
    return nullEntries.length > 0 ? nullEntries[0] : null;
  }

  getRemainingCount(): number {
    return this.findNullEntries().length;
  }
}

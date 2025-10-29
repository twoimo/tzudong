import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RestaurantInfo } from './types.js';

export class JsonlProcessor {
  private filePath: string;

  constructor(filePath: string = './tzuyang_restaurant_results.jsonl') {
    this.filePath = join(process.cwd(), filePath);
  }

  readAllEntries(): RestaurantInfo[] {
    try {
      const content = readFileSync(this.filePath, 'utf-8');
      const lines = content.trim().split('\n');
      return lines.map(line => JSON.parse(line.trim())).filter(Boolean);
    } catch (error) {
      console.error('Error reading JSONL file:', error);
      return [];
    }
  }

  findNullEntries(): RestaurantInfo[] {
    const entries = this.readAllEntries();
    return entries.filter(entry =>
      entry.name === null ||
      entry.phone === null ||
      entry.address === null ||
      entry.category === null
    );
  }

  updateEntry(youtubeLink: string, newData: RestaurantInfo): boolean {
    try {
      const entries = this.readAllEntries();
      const index = entries.findIndex(entry => entry.youtube_link === youtubeLink);

      if (index === -1) {
        console.error(`Entry with youtube_link ${youtubeLink} not found`);
        return false;
      }

      // 데이터 업데이트
      entries[index] = { ...entries[index], ...newData };

      // 파일에 다시 쓰기
      const content = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
      writeFileSync(this.filePath, content, 'utf-8');

      console.log(`✅ Updated entry for ${youtubeLink}`);
      return true;

    } catch (error) {
      console.error('Error updating JSONL file:', error);
      return false;
    }
  }

  getNextNullEntry(): RestaurantInfo | null {
    const nullEntries = this.findNullEntries();
    return nullEntries.length > 0 ? nullEntries[0] : null;
  }

  getRemainingCount(): number {
    return this.findNullEntries().length;
  }
}

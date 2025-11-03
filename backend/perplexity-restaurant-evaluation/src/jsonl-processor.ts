import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RestaurantEvaluation, EvaluationData } from './types.js';

export class JsonlProcessor {
  private filePath: string;

  constructor(filePath: string = './tzuyang_restaurant_evaluation.jsonl') {
    this.filePath = join(process.cwd(), filePath);
  }

  readAllEntries(): EvaluationData[] {
    try {
      const content = readFileSync(this.filePath, 'utf-8');
      const lines = content.trim().split('\n');
      return lines.map(line => {
        const parsed = JSON.parse(line.trim());
        return parsed;
      }).filter(Boolean);
    } catch (error) {
      console.error('Error reading JSONL file:', error);
      return [];
    }
  }

  findNullEntries(): EvaluationData[] {
    const entries = this.readAllEntries();
    return entries.filter(entry => {
      // evaluations 배열이 없거나 빈 배열인 경우
      if (!entry.evaluations || entry.evaluations.length === 0) {
        return true;
      }
      return false;
    });
  }

  updateEntry(youtubeLink: string, newData: RestaurantEvaluation[]): boolean {
    try {
      const entries = this.readAllEntries();
      const index = entries.findIndex(entry => entry.youtube_link === youtubeLink);

      if (index === -1) {
        // 새로운 항목 추가
        entries.push({
          youtube_link: youtubeLink,
          evaluations: newData
        });
      } else {
        // 기존 항목 업데이트
        entries[index].evaluations = [...(entries[index].evaluations || []), ...newData];
      }

      // 파일에 다시 쓰기
      const content = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
      writeFileSync(this.filePath, content, 'utf-8');

      console.log(`✅ Updated entry for ${youtubeLink} with ${newData.length} evaluation(s)`);
      return true;

    } catch (error) {
      console.error('Error updating JSONL file:', error);
      return false;
    }
  }

  getNextNullEntry(): EvaluationData | null {
    const nullEntries = this.findNullEntries();
    return nullEntries.length > 0 ? nullEntries[0] : null;
  }

  getRemainingCount(): number {
    return this.findNullEntries().length;
  }
}
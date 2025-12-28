#!/usr/bin/env node
/**
 * CLI: 히트맵 수집 실행
 * - 점진적 스케줄링: 1주 → 2주 → 3주... 최대 12주
 * - 50개 URL 제한 (환경변수 MAX_URLS_PER_RUN)
 * - 10개마다 커밋, 에러 시에도 커밋
 */

import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getUrlsFromFile, extractVideoId, collectHeatmap, saveHeatmapData } from './heatmap.js';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HEATMAPS_DIR = path.join(__dirname, '..', 'data', 'heatMaps');
const BRANCH = 'feat/crawling-youtube-heat-map';
const COMMIT_INTERVAL = 10;
const MAX_URLS_PER_RUN = parseInt(process.env.MAX_URLS_PER_RUN) || 50;
const MAX_INTERVAL_WEEKS = 12;

/**
 * 점진적 스케줄링: 다음 수집 시점 결정
 * @param {string} videoId 
 * @returns {boolean} 수집해야 하면 true
 */
async function shouldCollect(videoId) {
  const filePath = path.join(HEATMAPS_DIR, `${videoId}.jsonl`);
  
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    
    if (lines.length === 0) {
      return true; // 수집 기록 없음 → 수집
    }
    
    if (lines.length === 1) {
      // 1개만 있으면 1주 후에 수집
      const lastEntry = JSON.parse(lines[lines.length - 1]);
      const lastDate = parseKoreanDate(lastEntry.collectedAt);
      const weeksSince = (Date.now() - lastDate.getTime()) / (7 * 24 * 60 * 60 * 1000);
      return weeksSince >= 1;
    }
    
    // 2개 이상: 마지막 두 수집 간격 + 1주
    const lastEntry = JSON.parse(lines[lines.length - 1]);
    const prevEntry = JSON.parse(lines[lines.length - 2]);
    
    const lastDate = parseKoreanDate(lastEntry.collectedAt);
    const prevDate = parseKoreanDate(prevEntry.collectedAt);
    
    const gapWeeks = (lastDate.getTime() - prevDate.getTime()) / (7 * 24 * 60 * 60 * 1000);
    const requiredWeeks = Math.min(gapWeeks + 1, MAX_INTERVAL_WEEKS);
    
    const weeksSinceLastCollection = (Date.now() - lastDate.getTime()) / (7 * 24 * 60 * 60 * 1000);
    
    return weeksSinceLastCollection >= requiredWeeks;
    
  } catch (error) {
    // 파일이 없으면 수집 필요
    return true;
  }
}

/**
 * 한국 시간 문자열을 Date로 파싱
 */
function parseKoreanDate(dateStr) {
  // "2025. 12. 28. 오후 4:15:55" 형식 파싱
  const match = dateStr.match(/(\d{4})\. (\d{1,2})\. (\d{1,2})\. (오전|오후) (\d{1,2}):(\d{2}):(\d{2})/);
  if (match) {
    let [, year, month, day, ampm, hour, minute, second] = match;
    hour = parseInt(hour);
    if (ampm === '오후' && hour !== 12) hour += 12;
    if (ampm === '오전' && hour === 12) hour = 0;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), hour, parseInt(minute), parseInt(second));
  }
  // ISO 형식 fallback
  return new Date(dateStr);
}

function gitCommitAndPush(message) {
  try {
    execSync(`git fetch origin ${BRANCH}`, { stdio: 'inherit' });
    execSync(`git pull origin ${BRANCH} --rebase`, { stdio: 'inherit' });
    execSync('git add -A', { stdio: 'inherit' });
    const status = execSync('git status --porcelain').toString();
    
    if (status.trim()) {
      execSync(`git commit -m "${message}"`, { stdio: 'inherit' });
      execSync(`git push origin ${BRANCH}`, { stdio: 'inherit' });
      console.log(`✅ Git 커밋/푸시 완료: ${message}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`⚠️ Git 작업 실패: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🎬 YouTube Heatmap Collector CLI\n');
  console.log(`📊 설정: 최대 ${MAX_URLS_PER_RUN}개 URL, 점진적 스케줄링 적용\n`);
  
  const allUrls = await getUrlsFromFile();
  
  if (allUrls.length === 0) {
    console.log('수집할 URL이 없습니다.');
    process.exit(0);
  }
  
  // 점진적 스케줄링 적용 - 수집 대상 필터링
  console.log(`🔍 ${allUrls.length}개 URL 중 수집 대상 확인 중...`);
  const urlsToCollect = [];
  
  for (const url of allUrls) {
    if (urlsToCollect.length >= MAX_URLS_PER_RUN) break;
    
    const videoId = extractVideoId(url);
    if (!videoId) continue;
    
    if (await shouldCollect(videoId)) {
      urlsToCollect.push(url);
    }
  }
  
  console.log(`✅ 이번 실행 대상: ${urlsToCollect.length}개 URL\n`);
  
  if (urlsToCollect.length === 0) {
    console.log('📅 이번에 수집할 URL이 없습니다 (스케줄 미도래)');
    process.exit(0);
  }
  
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });
  
  const results = { total: urlsToCollect.length, collected: 0, failed: 0, skipped: 0 };
  let processedCount = 0;
  
  try {
    for (const url of urlsToCollect) {
      const videoId = extractVideoId(url);
      
      try {
        const data = await collectHeatmap(browser, videoId);
        
        if (data) {
          await saveHeatmapData(videoId, data);
          results.collected++;
        } else {
          results.failed++;
        }
      } catch (error) {
        console.error(`❌ 수집 실패 (${videoId}): ${error.message}`);
        results.failed++;
        
        if (error.message.includes('blocked') || error.message.includes('ERR_')) {
          console.log('⚠️ 봇 차단 의심 - 현재까지 수집분 커밋 후 종료');
          gitCommitAndPush(`📊 emergency: heatmap collection interrupted at ${processedCount} videos`);
          break;
        }
      }
      
      processedCount++;
      
      if (processedCount % COMMIT_INTERVAL === 0) {
        const date = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        gitCommitAndPush(`📊 chore: collect ${processedCount} heatmaps (${date})`);
      }
      
      // Rate limiting
      const randomMs = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);
      
      if (processedCount % 10 === 0) {
        await new Promise(r => setTimeout(r, randomMs(30000, 40000)));
      } else if (processedCount % 5 === 0) {
        await new Promise(r => setTimeout(r, randomMs(10000, 15000)));
      } else {
        await new Promise(r => setTimeout(r, randomMs(2000, 5000)));
      }
    }
  } catch (error) {
    console.error('❌ 예상치 못한 오류:', error.message);
    gitCommitAndPush(`📊 emergency: heatmap collection error - ${error.message.slice(0, 50)}`);
  } finally {
    await browser.close();
  }
  
  const date = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  gitCommitAndPush(`📊 chore: heatmap collection complete - ${results.collected}/${results.total} (${date})`);
  
  console.log('\n📊 수집 결과:');
  console.log(`   총 대상: ${results.total}`);
  console.log(`   수집 성공: ${results.collected}`);
  console.log(`   수집 실패: ${results.failed}`);
  
  process.exit(0);
}

main();

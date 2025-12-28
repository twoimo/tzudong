#!/usr/bin/env node
/**
 * YouTube HeatmapMarkers Collection CLI
 * fetch 기반 수집 - svgPathData 없이 heatmapMarkers만 수집
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { fetchHeatmapMarkers } from './heatmap-fetch.js';

// 설정
const MAX_URLS_PER_RUN = parseInt(process.env.MAX_URLS_PER_RUN) || 50;
const MAX_INTERVAL_WEEKS = 12;
const BRANCH = 'feat/crawling-youtube-heat-map';

// 경로 설정
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const PROJECT_DIR = path.resolve(SCRIPT_DIR, '..');
const URLS_FILE = path.join(PROJECT_DIR, 'data', 'urls', 'youtube-urls.txt');
const HEATMAPS_DIR = path.join(PROJECT_DIR, 'data', 'heatmapMarkers');

/**
 * URL에서 비디오 ID 추출
 */
function extractVideoId(url) {
  const match = url.match(/(?:v=|\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

/**
 * 점진적 스케줄링: 수집해야 하는지 확인
 */
async function shouldCollect(videoId) {
  const filePath = path.join(HEATMAPS_DIR, `${videoId}.jsonl`);
  
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    
    if (lines.length === 0) return true;
    
    if (lines.length === 1) {
      const lastEntry = JSON.parse(lines[lines.length - 1]);
      const lastDate = new Date(lastEntry.collectedAt);
      const weeksSince = (Date.now() - lastDate.getTime()) / (7 * 24 * 60 * 60 * 1000);
      return weeksSince >= 1;
    }
    
    const lastEntry = JSON.parse(lines[lines.length - 1]);
    const prevEntry = JSON.parse(lines[lines.length - 2]);
    
    const lastDate = new Date(lastEntry.collectedAt);
    const prevDate = new Date(prevEntry.collectedAt);
    
    const gapWeeks = (lastDate.getTime() - prevDate.getTime()) / (7 * 24 * 60 * 60 * 1000);
    const requiredWeeks = Math.min(gapWeeks + 1, MAX_INTERVAL_WEEKS);
    
    const weeksSinceLastCollection = (Date.now() - lastDate.getTime()) / (7 * 24 * 60 * 60 * 1000);
    
    return weeksSinceLastCollection >= requiredWeeks;
    
  } catch (error) {
    return true;
  }
}

/**
 * 데이터 저장
 */
async function saveData(videoId, data) {
  const filePath = path.join(HEATMAPS_DIR, `${videoId}.jsonl`);
  const jsonLine = JSON.stringify(data) + '\n';
  await fs.appendFile(filePath, jsonLine);
  console.log(`  💾 저장 완료: ${filePath}`);
}

/**
 * Git 커밋 및 푸시
 */
function gitCommitAndPush(message) {
  try {
    execSync('git add -A', { stdio: 'inherit' });
    const status = execSync('git status --porcelain').toString();
    
    if (status.trim()) {
      execSync(`git commit -m "${message}"`, { stdio: 'inherit' });
      execSync(`git fetch origin ${BRANCH}`, { stdio: 'inherit' });
      
      try {
        execSync(`git rebase origin/${BRANCH}`, { stdio: 'inherit' });
      } catch (rebaseError) {
        console.log('⚠️ Rebase 충돌 - abort 후 merge 시도');
        execSync('git rebase --abort', { stdio: 'inherit' });
      }
      
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

/**
 * 메인 실행
 */
async function main() {
  console.log('\n🎬 YouTube HeatmapMarkers Collector (Fetch 기반)');
  console.log(`📊 설정: 최대 ${MAX_URLS_PER_RUN}개 URL, 점진적 스케줄링 적용\n`);
  
  // URL 파일 읽기
  let allUrls = [];
  try {
    const content = await fs.readFile(URLS_FILE, 'utf-8');
    allUrls = content.trim().split('\n').filter(url => url.trim() && !url.startsWith('#'));
  } catch (error) {
    console.error('❌ URL 파일을 읽을 수 없습니다:', error.message);
    process.exit(1);
  }
  
  // 수집 대상 필터링
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
  
  const results = { total: urlsToCollect.length, collected: 0, failed: 0 };
  let processedCount = 0;
  
  for (const url of urlsToCollect) {
    const videoId = extractVideoId(url);
    console.log(`📺 수집 시작: ${videoId}`);
    
    try {
      const data = await fetchHeatmapMarkers(videoId);
      
      if (data && data.heatmapMarkers && data.heatmapMarkers.length > 0) {
        // 타임스탬프 추가
        data.collectedAt = new Date().toISOString().replace('Z', '+09:00');
        
        await saveData(videoId, data);
        results.collected++;
        console.log(`  ✅ 수집 완료: 조회수 ${data.stats.viewCount.toLocaleString()}, 마커 ${data.heatmapMarkers.length}개`);
      } else {
        results.failed++;
      }
    } catch (error) {
      console.error(`  ❌ 오류: ${error.message}`);
      results.failed++;
    }
    
    processedCount++;
    
    // 10개마다 커밋
    if (processedCount % 10 === 0 && results.collected > 0) {
      const timestamp = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      gitCommitAndPush(`📊 chore: collect ${processedCount} heatmapMarkers (${timestamp})`);
    }
    
    // Rate limiting (차단 방지 - 2초 대기)
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // 최종 커밋
  if (results.collected > 0) {
    const timestamp = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    gitCommitAndPush(`📊 chore: collect heatmapMarkers final (${timestamp})`);
  }
  
  console.log('\n📊 수집 완료');
  console.log(`  ✅ 성공: ${results.collected}개`);
  console.log(`  ❌ 실패: ${results.failed}개`);
}

main().catch(console.error);

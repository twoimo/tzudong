#!/usr/bin/env npx ts-node
/**
 * Puppeteer 기반 기존 Transcript duration 필드 backfill
 * 
 * 기존 transcript 데이터의 모든 항목을 Maestra.ai로 다시 수집하여
 * duration을 추가합니다.
 * 
 * 사용법:
 *   npx ts-node backfill-duration-puppeteer.ts
 *   npx ts-node backfill-duration-puppeteer.ts --date 25-12-03
 *   npx ts-node backfill-duration-puppeteer.ts --max 50
 *   npx ts-node backfill-duration-puppeteer.ts --dry-run
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ============================================================
// 설정
// ============================================================

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'backend', 'geminiCLI-restaurant-crawling', 'data');

const DELAY_MIN = 1000;      // 1초 (수정됨)
const DELAY_MAX = 3000;      // 3초 (수정됨)
const PAGE_TIMEOUT = 60000;  // 60초
const REST_INTERVAL = 200;   // 200개마다 휴식
const REST_DURATION = 120000; // 2분
const COMMIT_INTERVAL = 100; // 100개마다 중간 저장 + git commit

// ============================================================
// 타입 정의
// ============================================================

interface TranscriptSegment {
  start: number;
  duration?: number | null;
  text: string;
}

interface TranscriptData {
  youtube_link: string;
  language: string;
  collected_at: string;
  transcript: TranscriptSegment[];
}

// ============================================================
// 유틸리티 함수
// ============================================================

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function randomDelay(min: number = DELAY_MIN, max: number = DELAY_MAX): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

function log(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') {
  const timestamp = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' });
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
  console.log(`[${timestamp}] ${icons[type]} ${message}`);
}

// ============================================================
// Maestra.ai 파싱 (duration 포함)
// ============================================================

async function collectFromMaestra(page: Page, videoId: string): Promise<TranscriptSegment[] | null> {
  const url = `https://maestra.ai/tools/video-to-text/youtube-transcript-generator?v=${videoId}`;
  
  try {
    log(`Maestra.ai 접속: ${videoId}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    
    // mode-toggle 버튼 또는 "텍스트 변환하기" 버튼 대기 (최대 60초)
    let modeToggleFound = false;
    const startTime = Date.now();
    const maxWait = 60000;
    
    while (Date.now() - startTime < maxWait) {
      const hasModeToggle = await page.evaluate(() => {
        return document.querySelector('button.mode-toggle') !== null;
      });
      
      if (hasModeToggle) {
        modeToggleFound = true;
        break;
      }
      
      const submitButton = await page.evaluate(() => {
        const btn = document.querySelector('input.search-button[type="submit"]') as HTMLInputElement;
        if (btn && (btn.value === '텍스트 변환하기' || btn.value === 'Get Transcript')) {
          return true;
        }
        return false;
      });
      
      if (submitButton) {
        await page.click('input.search-button[type="submit"]');
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (!modeToggleFound) {
      log(`Maestra.ai: mode-toggle 없음 - ${videoId}`, 'warning');
      return null;
    }
    
    // caption 모드로 전환
    const currentMode = await page.evaluate(() => {
      const btn = document.querySelector('button.mode-toggle');
      return btn?.getAttribute('data-mode') || '';
    });
    
    if (currentMode !== 'caption') {
      await page.click('button.mode-toggle svg[data-icon="caption"]');
      
      let captionModeReady = false;
      const modeStartTime = Date.now();
      while (Date.now() - modeStartTime < 10000) {
        const mode = await page.evaluate(() => {
          const btn = document.querySelector('button.mode-toggle');
          return btn?.getAttribute('data-mode') || '';
        });
        if (mode === 'caption') {
          captionModeReady = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      if (!captionModeReady) {
        log(`Maestra.ai: caption 모드 전환 실패 - ${videoId}`, 'warning');
        return null;
      }
    }
    
    // 자막 라인 대기 (최대 30초)
    let captionLinesFound = false;
    const captionStartTime = Date.now();
    
    while (Date.now() - captionStartTime < 30000) {
      const count = await page.evaluate(() => {
        return document.querySelectorAll('.transcript-content samp.caption-line').length;
      });
      
      if (count > 0) {
        captionLinesFound = true;
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (!captionLinesFound) {
      log(`Maestra.ai: 자막 라인 없음 - ${videoId}`, 'warning');
      return null;
    }
    
    // 자막 파싱 (duration 포함)
    const transcript = await page.evaluate(() => {
      const segments: { start: number; duration: number | null; text: string }[] = [];
      const captionLines = document.querySelectorAll('.transcript-content samp.caption-line');
      
      // 시간 문자열을 초로 변환 (m:ss, mm:ss, h:mm:ss, hh:mm:ss 모두 지원)
      // 예: "0:05", "5:30", "12:45", "1:23:45", "01:23:45"
      const parseTimeToSeconds = (timeStr: string): number => {
        const parts = timeStr.split(':').map(Number);
        if (parts.length === 2) {
          // m:ss 또는 mm:ss
          return parts[0] * 60 + parts[1];
        } else if (parts.length === 3) {
          // h:mm:ss 또는 hh:mm:ss
          return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
        return 0;
      };
      
      captionLines.forEach(line => {
        const textEl = line.querySelector('.caption-text');
        // .caption-time 또는 .timestamp span 모두 확인
        const timeEl = line.querySelector('.caption-time') || line.querySelector('.timestamp');
        
        if (textEl) {
          const dataStart = line.getAttribute('data-start');
          const startSeconds = dataStart ? parseFloat(dataStart) : 0;
          
          // duration 계산: "0:05 - 0:44", "5:30 - 6:15", "1:23:45 - 1:24:30" 형태에서 파싱
          // m:ss, mm:ss, h:mm:ss, hh:mm:ss 모두 매칭
          let duration: number | null = null;
          if (timeEl) {
            const timeText = timeEl.textContent?.trim() || '';
            const timeMatch = timeText.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)/);
            if (timeMatch) {
              const startFromRange = parseTimeToSeconds(timeMatch[1]);
              const endFromRange = parseTimeToSeconds(timeMatch[2]);
              duration = endFromRange - startFromRange;
            }
          }
          
          segments.push({
            start: startSeconds,
            duration: duration,
            text: textEl.textContent?.trim() || ''
          });
        }
      });
      
      return segments;
    });
    
    if (transcript.length === 0) {
      log(`Maestra.ai: 파싱 결과 없음 - ${videoId}`, 'warning');
      return null;
    }
    
    log(`Maestra.ai: ${transcript.length}개 세그먼트 수집 - ${videoId}`, 'success');
    return transcript;
    
  } catch (error) {
    log(`Maestra.ai 오류: ${videoId} - ${error}`, 'error');
    return null;
  }
}

// ============================================================
// TubeTranscript.com Fallback (duration 없음)
// ============================================================

async function collectFromTubeTranscript(page: Page, videoId: string): Promise<TranscriptSegment[] | null> {
  const url = `https://www.tubetranscript.com/ko/watch?v=${videoId}`;
  
  try {
    log(`TubeTranscript.com fallback: ${videoId}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    
    // main-transcript-content가 나타날 때까지 대기 (최대 60초)
    log(`TubeTranscript 자막 대기 중: ${videoId}`);
    try {
      await page.waitForFunction(
        () => document.querySelector('#main-transcript-content') !== null,
        { timeout: 60000, polling: 1000 }
      );
    } catch {
      log(`TubeTranscript: 자막 컨테이너 없음 (60초 초과) - ${videoId}`, 'warning');
      return null;
    }
    
    // 실제 자막 콘텐츠(.transcript-group-box)가 나타날 때까지 대기 (최대 60초)
    try {
      await page.waitForFunction(
        () => document.querySelector('#main-transcript-content .transcript-group-box') !== null,
        { timeout: 60000, polling: 1000 }
      );
    } catch {
      log(`TubeTranscript: 자막 콘텐츠 없음 (60초 초과) - ${videoId}`, 'warning');
      return null;
    }
    
    // 자막 파싱 (duration은 null로 설정 - TubeTranscript은 start만 제공)
    const transcript = await page.evaluate(() => {
      const segments: { start: number; duration: number | null; text: string }[] = [];
      const groups = document.querySelectorAll('#main-transcript-content .transcript-group-box');
      
      groups.forEach(group => {
        const timeEl = group.querySelector('.transcript-time a[target="_blank"]');
        const textEl = group.querySelector('.transcript-text');
        
        if (timeEl && textEl) {
          const timeStr = timeEl.textContent?.trim() || '';
          const parts = timeStr.split(':').map(Number);
          
          let startSeconds = 0;
          if (parts.length === 2) {
            // mm:ss
            startSeconds = parts[0] * 60 + parts[1];
          } else if (parts.length === 3) {
            // h:mm:ss 또는 hh:mm:ss
            startSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
          }
          
          segments.push({
            start: startSeconds,
            duration: null,  // TubeTranscript은 duration 정보 없음
            text: textEl.textContent?.trim() || ''
          });
        }
      });
      
      return segments;
    });
    
    if (transcript.length === 0) {
      log(`TubeTranscript: 파싱 결과 없음 - ${videoId}`, 'warning');
      return null;
    }
    
    log(`TubeTranscript: ${transcript.length}개 세그먼트 수집 (duration: null) - ${videoId}`, 'success');
    return transcript;
    
  } catch (error) {
    log(`TubeTranscript 오류: ${videoId} - ${error}`, 'error');
    return null;
  }
}

// ============================================================
// 메인 함수
// ============================================================

async function main() {
  // 인자 파싱
  const args = process.argv.slice(2);
  let targetDates: string[] = ['25-12-04', '25-12-05'];  // 기본값
  let maxItems = 9999;  // 사실상 무제한
  let dryRun = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      targetDates = [args[i + 1]];
    } else if (args[i] === '--max' && args[i + 1]) {
      maxItems = parseInt(args[i + 1], 10);
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }
  
  log('============================================================');
  log('🔧 Transcript Duration Backfill (Puppeteer)');
  log(`📁 데이터 디렉토리: ${DATA_DIR}`);
  log(`📅 대상 날짜: ${targetDates.join(', ')}`);
  log(`📊 최대 처리: ${maxItems}개`);
  log(`🧪 DRY-RUN: ${dryRun ? 'ON' : 'OFF'}`);
  log(`⏱️ 딜레이: ${DELAY_MIN/1000}~${DELAY_MAX/1000}초`);
  log(`🛑 휴식: ${REST_INTERVAL}개마다 ${REST_DURATION/60000}분`);
  log(`💾 중간 저장: ${COMMIT_INTERVAL}개마다 저장 + git commit`);
  log('============================================================');
  
  // 폴더 확인
  const folders: string[] = [];
  for (const date of targetDates) {
    const folderPath = path.join(DATA_DIR, date);
    if (fs.existsSync(folderPath)) {
      folders.push(date);
    } else {
      log(`폴더 없음: ${date}`, 'warning');
    }
  }
  
  if (folders.length === 0) {
    log('처리할 폴더가 없습니다', 'error');
    return;
  }
  
  log(`📂 처리할 폴더: ${folders.join(', ')}`);
  
  // 브라우저 시작
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  
  let totalUpdated = 0;
  let totalFailed = 0;
  let totalProcessed = 0;
  
  try {
    for (const folder of folders) {
      const transcriptFile = path.join(DATA_DIR, folder, 'tzuyang_restaurant_transcripts.json');
      
      if (!fs.existsSync(transcriptFile)) {
        log(`${folder}: transcript 파일 없음`, 'warning');
        continue;
      }
      
      log(`\n📂 ${folder} 처리 시작...`);
      
      // 데이터 로드
      let transcripts: TranscriptData[];
      try {
        transcripts = JSON.parse(fs.readFileSync(transcriptFile, 'utf-8'));
      } catch (e) {
        log(`${folder}: 파일 로드 실패`, 'error');
        continue;
      }
      
      log(`  📄 ${transcripts.length}개 항목 로드됨`);
      
      let folderUpdated = 0;
      let folderFailed = 0;
      
      for (let i = 0; i < transcripts.length; i++) {
        if (totalProcessed >= maxItems) {
          log(`최대 처리 수 도달 (${maxItems}개)`, 'warning');
          break;
        }
        
        const item = transcripts[i];
        const videoId = extractVideoId(item.youtube_link);
        
        if (!videoId) {
          log(`  [${i + 1}/${transcripts.length}] 비디오 ID 추출 실패: ${item.youtube_link}`, 'error');
          folderFailed++;
          totalFailed++;
          continue;
        }
        
        totalProcessed++;
        log(`  [${totalProcessed}] ${folder} - ${i + 1}/${transcripts.length}: ${videoId}`);
        
        // 1차: Maestra.ai로 수집
        let newTranscript = await collectFromMaestra(page, videoId);
        
        // 2차: Maestra.ai 실패 시 TubeTranscript.com으로 fallback
        if (!newTranscript || newTranscript.length === 0) {
          log(`  🔄 Maestra.ai 실패, TubeTranscript fallback 시도 - ${videoId}`, 'warning');
          await randomDelay();  // fallback 전 딜레이
          newTranscript = await collectFromTubeTranscript(page, videoId);
        }
        
        if (newTranscript && newTranscript.length > 0) {
          if (!dryRun) {
            // 기존 collected_at 유지, transcript만 교체
            item.transcript = newTranscript;
          }
          folderUpdated++;
          totalUpdated++;
          log(`  ✅ ${videoId} (${newTranscript.length} segments)`, 'success');
        } else {
          folderFailed++;
          totalFailed++;
          log(`  ❌ ${videoId} 모든 소스에서 수집 실패`, 'error');
        }
        
        // 100개마다 중간 저장 + git commit
        if (totalProcessed % COMMIT_INTERVAL === 0 && totalProcessed > 0 && !dryRun && folderUpdated > 0) {
          log(`\n💾 중간 저장: ${totalProcessed}개 처리 완료`, 'success');
          fs.writeFileSync(transcriptFile, JSON.stringify(transcripts, null, 2), 'utf-8');
          
          // git commit
          try {
            const relativeFile = path.relative(PROJECT_ROOT, transcriptFile);
            execSync(`git add "${relativeFile}"`, { cwd: PROJECT_ROOT, stdio: 'pipe' });
            execSync(`git commit -m "chore: backfill progress - ${totalProcessed} items processed"`, { cwd: PROJECT_ROOT, stdio: 'pipe' });
            log(`  📤 Git commit 완료`, 'success');
          } catch (gitError) {
            log(`  ⚠️ Git commit 실패 (변경사항 없음 또는 에러): ${gitError}`, 'warning');
          }
        }
        
        // 200개마다 2분 휴식
        if (totalProcessed % REST_INTERVAL === 0 && totalProcessed > 0) {
          log(`\n🛑 ${totalProcessed}개 완료 - ${REST_DURATION / 60000}분 휴식 시작...`, 'warning');
          await new Promise(resolve => setTimeout(resolve, REST_DURATION));
          log(`🚀 휴식 끝 - 수집 재개\n`, 'success');
        }
        
        // 딜레이 (마지막 항목 제외)
        if (i < transcripts.length - 1) {
          await randomDelay();
        }
      }
      
      // 저장
      if (!dryRun && folderUpdated > 0) {
        fs.writeFileSync(transcriptFile, JSON.stringify(transcripts, null, 2), 'utf-8');
        log(`  💾 ${folder} 저장 완료 (${folderUpdated}개 업데이트)`);
      }
      
      log(`  📊 ${folder} 결과: 성공 ${folderUpdated}, 실패 ${folderFailed}`);
      
      if (totalProcessed >= maxItems) break;
    }
    
  } finally {
    await browser.close();
  }
  
  log('\n============================================================');
  log('📊 최종 결과');
  log(`  ✅ 성공: ${totalUpdated}`);
  log(`  ❌ 실패: ${totalFailed}`);
  log(`  📝 총 처리: ${totalProcessed}`);
  log('============================================================');
}

main().catch(console.error);

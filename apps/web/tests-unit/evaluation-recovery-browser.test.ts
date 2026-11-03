import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, expect as pw } from '@playwright/test';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';

const appRoot = join(import.meta.dir, '..');
async function bundle() {
  const entry = `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { EvaluationEvidenceRecovery } from './components/admin/EvaluationEvidenceRecovery';
    const id = '22222222-2222-4222-8222-222222222222';
    const binding = { restaurantId:id, policyVersion:2, rowSha256:'a'.repeat(64), inputSha256:'b'.repeat(64), videoId:'ABCDEFGHIJK' };
    const record = { id, status:'hold', origin_name:'검수 식당', name:'검수 식당', youtube_link:'https://www.youtube.com/watch?v=ABCDEFGHIJK',
      updated_at:'2026-11-03T00:00:00Z', trace_id:'fixture', channel_name:'tzuyang', categories:['한식'], geocoding_success:false, evaluation_results:{} };
    const context = { schemaVersion:1, ...binding, originName:record.origin_name, sourceUpdatedAt:record.updated_at };
    const fixture = { mode:'normal', jobs:[], calls:[], events:0, proposals:0 };
    globalThis.__recovery = fixture;
    addEventListener('admin:record-action-applied', () => fixture.events++);
    const json = (body,status=200) => new Response(JSON.stringify(body), { status, headers:{'Content-Type':'application/json'} });
    const receipt = (request,state) => ({ operationId:request.operationId, action:request.phase.includes('retire') ? 'restaurant.evidence_recovery.retire' : request.phase.includes('apply') ? 'restaurant.evidence_recovery.apply' : 'restaurant.evidence_recovery.request',
      ...(request.phase.includes('retire')?{retirementPolicyVersion:3}:{}),
      state, targetIds:[id], jobId:request.jobId, auditId:state==='applied'?'44444444-4444-4444-8444-444444444444':null,
      previewHash:'c'.repeat(64),expiresAt:new Date(Date.now()+(fixture.expiredOperationId===request.operationId?-60000:60000)).toISOString(),readback:[{id,kind:'restaurant',status:'hold',fingerprint:'a'.repeat(64)}],mediaCleanupPending:false,
      policyVersion:binding.policyVersion,rowSha256:binding.rowSha256,inputSha256:binding.inputSha256,videoId:binding.videoId });
    const metadata = (request,state,reason) => ({ schemaVersion:1,jobId:request.jobId,...binding,state,reason,resultSha256:state==='draft'||state==='applied'?'d'.repeat(64):null,receipt:null });
    const statusJob = job => ({ ...job, receipt:null, requestOperationId:job.requestOperationId,applyOperationId:job.applyOperationId??null,retireOperationId:job.retireOperationId??null,proposal:job.proposal??null });
    globalThis.fetch = async (url,options) => {
      if (!options?.method) {
        fixture.calls.push({phase:'GET'});
        if(fixture.mode==='read_fail') return json({},503);
        return json({schemaVersion:1,restaurantId:id,jobs:fixture.jobs,context:fixture.mode==='stale'?{...context,originName:'바뀐 원본'}:context,contextError:null});
      }
      const input=JSON.parse(options.body);fixture.calls.push(input);
      if(input.phase==='preview_request') {
        const result={...metadata(input,'preview','request_preview'),receipt:receipt(input,'preview')};
        fixture.jobs=[statusJob({...result,requestOperationId:input.operationId})];return json(result);
      }
      if(input.phase==='request') {
        const result={...metadata(input,'queued','queued'),receipt:receipt(input,'applied')};
        fixture.jobs=[statusJob({...result,requestOperationId:input.operationId})];
        if(fixture.mode==='lost_ack') throw new Error('synthetic lost acknowledgment');return json(result);
      }
      if(input.phase==='read') {
        if(fixture.mode==='operation_read_fail') return json({error:'EVIDENCE_RECOVERY_UNAVAILABLE'},503);
        const job=fixture.jobs.find(j=>j.jobId===input.jobId);
        if(!job)return json({error:'EVIDENCE_RECOVERY_NOT_FOUND'},404);
        const retiring=job.retireOperationId===input.operationId;
        if(retiring) return json({...metadata(input,job.state,job.reason),resultSha256:job.resultSha256,receipt:receipt({...input,phase:'preview_retire'},job.state==='failed'?'applied':'preview')});
        const applying=job.applyOperationId===input.operationId;
        const state=applying&&job.state==='applied'?'applied':job.state==='preview'||applying?'preview':'applied';
        return json({...metadata(input,job.state,job.reason),resultSha256:job.resultSha256,receipt:receipt({...input,phase:applying?'preview_apply':'preview_request'},state)});
      }
      if(input.phase==='preview_retire') {
        if(fixture.mode!=='policy_changed') return json({error:'EVIDENCE_RECOVERY_STATE_CONFLICT'},409);
        const job=fixture.jobs[0];job.retireOperationId=input.operationId;
        return json({...metadata(input,'draft','evidence_ready'),receipt:receipt(input,'preview')});
      }
      if(input.phase==='retire') {
        const job=fixture.jobs[0];job.state='failed';job.reason='policy_changed';job.proposal=null;
        return json({...metadata(input,'failed','policy_changed'),resultSha256:job.resultSha256,receipt:receipt(input,'applied')});
      }
      if(input.phase==='preview_apply') {
        const job=fixture.jobs[0];job.applyOperationId=input.operationId;
        return json({...metadata(input,'draft','evidence_ready'),receipt:receipt(input,'preview')});
      }
      if(input.phase==='apply') {
        const job=fixture.jobs[0];job.state='applied';job.reason='evidence_applied';job.proposal=null;
        return json({...metadata(input,'applied','evidence_applied'),receipt:receipt(input,'applied')});
      }
      return json({},503);
    };
    fixture.draft = () => {
      const job=fixture.jobs[0];job.state='draft';job.reason='evidence_ready';job.resultSha256='d'.repeat(64);
      job.proposal={evaluation_results:{location_match_TF:{eval_basis:'공개 영상과 지점 주소를 확인했습니다.'}},geocoding_success:true,categories:['한식'],jibun_address:'서울시 종로구 공개 사업장',naver_name:'검수 식당'};
    };
    function App(){ const [open,setOpen]=useState(true);return <><button onClick={()=>setOpen(true)}>검수 열기</button><EvaluationEvidenceRecovery record={open?record:null} onClose={()=>setOpen(false)}/></>; }
    createRoot(document.body.appendChild(document.createElement('div'))).render(<App/>);
  `;
  const built = await Bun.build({ entrypoints: ['recovery-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'recovery-fixture', setup(builder) {
      builder.onResolve({ filter: /^recovery-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
    } }] });
  if (!built.success) throw new Error(built.logs.map(String).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

test('recovery dialog binds the source, reconciles a lost acknowledgment and applies only a reviewed draft', async () => {
  const browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  try {
    const script = await bundle();
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage(); page.setDefaultTimeout(8_000);
        const errors: string[] = []; let outside = 0;
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
          if (route.request().url() === 'https://recovery.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><body></body></html>' });
          outside++; return route.abort();
        });
        await page.goto('https://recovery.test/admin'); await page.addScriptTag({ content: script });
        const start = page.getByRole('button', { name: '근거 복구 내용 확인', exact: true });
        await pw(start).toBeEnabled();
        await page.evaluate(() => { (globalThis as any).__recovery.mode = 'stale'; });
        await page.getByRole('button', { name: '상태 새로 조회' }).click();
        await pw(start).toBeDisabled(); await pw(page.getByRole('alert')).toContainText('현재 저장된 원본이 다릅니다');
        await page.evaluate(() => { (globalThis as any).__recovery.mode = 'normal'; });
        await page.getByRole('button', { name: '상태 새로 조회' }).click(); await pw(start).toBeEnabled();
        await page.evaluate(() => { (globalThis as any).__recovery.mode = 'read_fail'; });
        await page.getByRole('button', { name: '상태 새로 조회' }).click(); await pw(start).toBeDisabled();
        await page.evaluate(() => { (globalThis as any).__recovery.mode = 'normal'; });
        await page.getByRole('button', { name: '상태 새로 조회' }).click(); await pw(start).toBeEnabled();
        await start.click(); await pw(page.getByRole('button', { name: '근거 복구 요청', exact: true })).toBeVisible();
        await page.evaluate(() => { (globalThis as any).__recovery.mode = 'lost_ack'; });
        await page.getByRole('button', { name: '근거 복구 요청', exact: true }).click();
        await pw(page.getByRole('button', { name: '기존 처리 결과 확인', exact: true })).toBeEnabled();
        await pw(start).toBeDisabled();
        await page.getByRole('button', { name: '기존 처리 결과 확인', exact: true }).click();
        await pw(page.getByText('근거 수집 대기', { exact: true })).toBeVisible();
        expect(await page.evaluate(() => (globalThis as any).__recovery.calls.filter((c: any) => c.phase === 'request').length)).toBe(1);
        await page.getByRole('button', { name: '닫기', exact: true }).first().click();
        await page.getByRole('button', { name: '검수 열기' }).click();
        await pw(page.getByText('근거 수집 대기', { exact: true })).toBeVisible(); await pw(start).toBeDisabled();
        await page.evaluate(() => { (globalThis as any).__recovery.draft(); });
        await page.getByRole('button', { name: '상태 새로 조회' }).click();
        await pw(page.getByRole('region', { name: '보강 내용 미리보기' })).toContainText('서울시 종로구 공개 사업장');
        await page.getByRole('button', { name: '보강 내용 확인', exact: true }).click();
        await pw(page.getByRole('button', { name: '보강 근거 저장', exact: true })).toBeEnabled();
        const expiredOperation = await page.evaluate(() => {
          const f=(globalThis as any).__recovery; f.expiredOperationId=f.jobs[0].applyOperationId; f.mode='operation_read_fail'; return f.expiredOperationId;
        });
        await page.getByRole('button', { name: '닫기', exact: true }).first().click();
        await page.getByRole('button', { name: '검수 열기' }).click();
        await page.getByRole('button', { name: '보강 내용 확인', exact: true }).click();
        await pw(page.getByRole('alert')).toBeVisible();
        await page.getByRole('button', { name: '보강 내용 확인', exact: true }).click();
        expect(await page.evaluate(() => (globalThis as any).__recovery.calls.filter((c: any) => c.phase === 'preview_apply').length)).toBe(1);
        await page.evaluate(() => { (globalThis as any).__recovery.mode='normal'; });
        await page.getByRole('button', { name: '보강 내용 확인', exact: true }).click();
        await pw(page.getByText('적용되지 않은 미리보기의 만료를 확인했습니다.', { exact: false })).toBeVisible();
        await pw(page.getByRole('button', { name: '보강 근거 저장', exact: true })).toHaveCount(0);
        await page.getByRole('button', { name: '보강 내용 확인', exact: true }).click();
        await pw(page.getByRole('button', { name: '보강 근거 저장', exact: true })).toBeEnabled();
        expect(await page.evaluate(() => (globalThis as any).__recovery.jobs[0].applyOperationId)).not.toBe(expiredOperation);
        await page.getByRole('button', { name: '보강 근거 저장', exact: true }).click();
        await pw(page.getByText('보강 근거 저장 완료', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: '적용 결과 확인', exact: true }).click();
        expect(await page.evaluate(() => (globalThis as any).__recovery.calls.filter((c: any) => c.phase === 'apply').length)).toBe(1);
        expect(await page.evaluate(() => (globalThis as any).__recovery.events)).toBe(1);
        expect(outside).toBe(0); expect(errors).toEqual([]);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}, 60_000);

test('recovery dialog retires only a reviewed stale draft and reconciles before a new request', async () => {
  const browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  try {
    const script = await bundle();
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage(); page.setDefaultTimeout(8_000);
        const errors: string[] = []; let outside = 0;
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
          if (route.request().url() === 'https://recovery.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><body></body></html>' });
          outside++; return route.abort();
        });
        await page.goto('https://recovery.test/admin'); await page.addScriptTag({ content: script });
        const start = page.getByRole('button', { name: '근거 복구 내용 확인', exact: true });
        await start.click(); await page.getByRole('button', { name: '근거 복구 요청', exact: true }).click();
        await page.evaluate(() => { (globalThis as any).__recovery.draft(); });
        await page.getByRole('button', { name: '상태 새로 조회' }).click();
        const retire = page.getByRole('button', { name: '이전 초안 종료 검토', exact: true });
        await retire.click();
        await pw(page.getByRole('alert')).toBeVisible();
        await pw(page.getByRole('button', { name: '이전 초안 종료', exact: true })).toHaveCount(0);
        await pw(retire).toBeEnabled();
        expect(await page.evaluate(() => (globalThis as any).__recovery.jobs[0].state)).toBe('draft');
        await page.evaluate(() => { (globalThis as any).__recovery.mode='policy_changed'; });
        await retire.click();
        await pw(page.getByRole('region', { name: '근거 복구 확인' })).toContainText('수집된 근거와 처리 이력');
        expect(await page.evaluate(() => (globalThis as any).__recovery.calls.filter((c: any) => c.phase === 'retire').length)).toBe(0);
        await page.getByRole('button', { name: '이전 초안 종료', exact: true }).click();
        await pw(page.getByText('이전 초안을 종료했습니다.', { exact: false })).toBeVisible();
        await pw(start).toBeEnabled();
        await page.getByRole('button', { name: '닫기', exact: true }).first().click();
        await page.getByRole('button', { name: '검수 열기' }).click();
        await page.getByRole('button', { name: '초안 종료 결과 확인', exact: true }).click();
        await pw(start).toBeEnabled();
        const calls = await page.evaluate(() => (globalThis as any).__recovery.calls);
        expect(calls.filter((c: any) => c.phase === 'retire').length).toBe(1);
        expect(calls.find((c: any) => c.phase === 'retire').confirmation).toBe('RETIRE STALE EVIDENCE RECOVERY');
        expect(calls.filter((c: any) => c.phase === 'apply').length).toBe(0);
        expect(calls.filter((c: any) => c.phase === 'request').length).toBe(1);
        expect(await page.evaluate(() => (globalThis as any).__recovery.events)).toBe(0);
        expect(outside).toBe(0); expect(errors).toEqual([]);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}, 60_000);

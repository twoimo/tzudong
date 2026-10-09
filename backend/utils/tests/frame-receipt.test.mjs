import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ffmpeg = '/opt/homebrew/bin/ffmpeg';
const ffprobe = '/opt/homebrew/bin/ffprobe';
const python = process.env.RUN_DAILY_PYTHON || 'python3';

function images(directory) {
    const files = fs.readdirSync(directory, { recursive: true }).filter(file => file.endsWith('.jpg') && !file.includes('.history'));
    return files.sort().map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex')]);
}

test('real ffmpeg preserves bytes, validates reuse, repairs one damaged segment, and retains failed outputs', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tzudong-frame-receipt-'));
    const previous = { FFMPEG_CMD: process.env.FFMPEG_CMD, FFPROBE_CMD: process.env.FFPROBE_CMD, RUN_DAILY_PYTHON: process.env.RUN_DAILY_PYTHON };
    try {
        const journal = path.join(temporary, 'calls');
        const failure = path.join(temporary, 'fail');
        const wrapper = path.join(temporary, 'ffmpeg');
        fs.writeFileSync(wrapper, `#!/bin/sh\nif [ "$1" != "-version" ]; then printf '%s\\n' "$$" >> '${journal}'; [ -f '${failure}' ] && exit 1; fi\nexec '${ffmpeg}' "$@"\n`, { mode: 0o700 });
        Object.assign(process.env, { FFMPEG_CMD: wrapper, FFPROBE_CMD: ffprobe, RUN_DAILY_PYTHON: python });
        const { extractFrames } = await import('../../restaurant-crawling/scripts/04-extract-frames-with-heatmap.js');
        const video = path.join(temporary, 'video.mp4');
        const generation = spawnSync(ffmpeg, ['-v','error','-f','lavfi','-i','testsrc2=size=160x96:rate=4','-t','5','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',video]);
        assert.equal(generation.status, 0);
        // Only the unexported function is exposed in the frozen baseline;
        // its extraction, encoder and timestamp algorithm are unchanged.
        const baselineDir = path.join(temporary, 'backend/restaurant-crawling/scripts');
        fs.mkdirSync(baselineDir, { recursive: true });
        fs.writeFileSync(path.join(temporary, 'backend/package.json'), '{"type":"module"}');
        fs.symlinkSync(path.join(root,'backend/node_modules'),path.join(temporary,'backend/node_modules'));
        fs.symlinkSync(path.join(root,'backend/utils'),path.join(temporary,'backend/utils'));
        const baseline = path.join(baselineDir, 'baseline.js');
        const source = spawnSync('git',['show','e6c7c97c:backend/restaurant-crawling/scripts/04-extract-frames-with-heatmap.js'],{ cwd: root, encoding:'utf8' });
        assert.equal(source.status,0);
        fs.writeFileSync(baseline, source.stdout+'\nexport { extractFrames };\n');
        const { extractFrames: extractBefore } = await import(baseline);
        const before = path.join(temporary,'before'), after = path.join(temporary,'after');
        fs.mkdirSync(before); fs.mkdirSync(after);
        const segments = [{startSec:0,endSec:2,peakSec:1},{startSec:2,endSec:4,peakSec:3}];
        const args = [video,segments,null,'360p',2,0,'jpg'];
        const baselineResult = await extractBefore(...args.map((value,index)=>index===2?before:value));
        const candidateResult = await extractFrames(...args.map((value,index)=>index===2?after:value));
        assert.deepEqual(candidateResult,baselineResult);
        assert.deepEqual(images(after),images(before));
        const calls = () => fs.readFileSync(journal,'utf8').trim().split('\n').length;
        const firstCalls = calls();
        assert.deepEqual(await extractFrames(video,segments,after,'360p',2,0,'jpg'),candidateResult);
        assert.equal(calls(),firstCalls);
        const damaged = images(after)[0][0];
        fs.writeFileSync(path.join(after,damaged),'damaged');
        await extractFrames(video,segments,after,'360p',2,0,'jpg');
        assert.equal(calls(),firstCalls+1);
        assert.deepEqual(images(after),images(before));
        assert(fs.readdirSync(after,{recursive:true}).some(file=>file.includes('.history')&&file.endsWith('.jpg')));
        const preserved = images(after);
        fs.writeFileSync(failure,'fail');
        const failed = await extractFrames(video,segments,after,'360p',3,0,'jpg');
        assert.equal(failed.failedSegments,2);
        assert.deepEqual(images(after),preserved);
        fs.rmSync(failure);
        const recovered = await extractFrames(video,segments,after,'360p',3,0,'jpg');
        assert.equal(recovered.failedSegments,0);
        assert(recovered.totalFrames>0);
        const concurrent = path.join(temporary,'concurrent');fs.mkdirSync(concurrent);
        const initialCalls=calls();
        const code=`const {extractFrames}=await import(${JSON.stringify(path.join(root,'backend/restaurant-crawling/scripts/04-extract-frames-with-heatmap.js'))});const result=await extractFrames(${JSON.stringify(video)},${JSON.stringify(segments)},${JSON.stringify(concurrent)},'360p',2,0,'jpg');if(result.failedSegments)process.exitCode=1;`;
        const child = () => new Promise((resolve,reject)=>{
            const process=spawn(globalThis.process.execPath,['--input-type=module','-e',code],{stdio:'ignore'});
            process.once('error',reject);process.once('close',status=>status===0?resolve():reject(new Error('FRAME_CHILD_FAILED')));
        });
        await Promise.all([child(),child()]);
        assert.equal(calls(),initialCalls+2);
        assert.deepEqual(images(concurrent),images(before));
    } finally {
        for (const [key,value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]; else process.env[key]=value;
        }
        fs.rmSync(temporary,{recursive:true,force:true});
    }
});

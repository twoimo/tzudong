import {expect,test} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

test('compact brand PNG preserves transparent background and pin center',async()=>{
    const png=await readFile(new URL('../public/logo-png-129-8d374bb80346.png',import.meta.url));
    expect(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))).toBe(true);
    expect(createHash('sha256').update(png).digest('hex')).toBe('8d374bb803469959cb37a2f6193f177d063265d077f717de0dc6dcc64bc3a646');
    const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    expect([info.width,info.height]).toEqual([129,129]);
    for(const [x,y] of [[0,0],[128,0],[0,128],[128,128],[64,64],[64,51]]){
        expect(data[(y*info.width+x)*info.channels+3]).toBe(0);
    }
    expect(png.length).toBeLessThan(30000);
});

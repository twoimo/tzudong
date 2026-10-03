// Deterministic delivery derivative; preserve the original artwork and alpha.
import sharp from 'sharp';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source=await readFile(new URL('../public/logo.png',import.meta.url));
// The odd grid retains the original transparent center and supports 32px at 4x.
const png=await sharp(source).resize(129,129,{kernel:'nearest'}).png({compressionLevel:9,adaptiveFiltering:true,palette:false}).toBuffer();
const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
for(const [x,y] of [[0,0],[128,0],[0,128],[128,128],[64,64],[64,51]]){
    if(data[(y*info.width+x)*info.channels+3]!==0)throw new Error('Brand PNG transparency mismatch');
}
const sha=createHash('sha256').update(png).digest('hex');
const name=`logo-png-129-${sha.slice(0,12)}.png`;
const output=new URL(`../public/${name}`,import.meta.url);
try {
    const existing=await readFile(output);
    if(!existing.equals(png))throw new Error('Existing brand PNG bytes differ');
} catch(error) {
    if(error.code!=='ENOENT')throw error;
    await writeFile(output,png,{flag:'wx'});
}
console.log(JSON.stringify({name,sha256:sha,bytes:png.length,originalBytes:source.length,size:129,sourceUnmodified:true,transparentCenter:true,sharp:sharp.versions.sharp}));

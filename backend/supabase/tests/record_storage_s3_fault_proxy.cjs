// Synthetic, task-network-only S3 fault injection. No headers, keys or payloads are logged.
const http = require('node:http');
let armed = false, batches = 0, injected = 0;
const reply = (res, status, value) => { res.writeHead(status, {'content-type':'application/json'}); res.end(JSON.stringify(value)); };
http.createServer((req,res)=>{
  if (req.url==='/__fixture/arm' && req.method==='POST') { armed=true; return reply(res,200,{armed:true}); }
  if (req.url==='/__fixture/status' && req.method==='GET') return reply(res,200,{batches,injected});
  const batch=req.method==='POST' && new URL(req.url,'http://fixture').searchParams.has('delete');
  if(batch) batches++;
  if(batch && armed) {
    armed=false;
    const chunks=[];let length=0;
    req.on('data',chunk=>{ length+=chunk.length; if(length>65536) {req.destroy();return;} chunks.push(chunk); });
    req.on('end',()=>{
      const keys=[...Buffer.concat(chunks).toString('utf8').matchAll(/<Key>([^<]+)<\/Key>/g)].map(match=>match[1]);
      // The case starts with exactly one standard object, no .info object. Preserve
      // that object and return its per-key failure alongside an absent .info success.
      if(keys.length!==2 || keys[0].endsWith('.info') || keys[1]!==keys[0]+'.info') return reply(res,500,{code:'FIXTURE_UNEXPECTED_DELETE_SHAPE'});
      injected++;
      const body='<?xml version="1.0" encoding="UTF-8"?><DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Error><Key>'+keys[0]+'</Key><Code>AccessDenied</Code><Message>synthetic failure</Message></Error><Deleted><Key>'+keys[1]+'</Key></Deleted></DeleteResult>';
      res.writeHead(200,{'content-type':'application/xml','content-length':Buffer.byteLength(body)});res.end(body);
    });
    return;
  }
  // Preserve Host and signed path; only the destination socket changes.
  const upstream=http.request({hostname:'minio',port:9000,path:req.url,method:req.method,headers:req.headers},remote=>{res.writeHead(remote.statusCode,remote.headers);remote.pipe(res);});
  upstream.on('error',()=>{if(!res.headersSent) reply(res,502,{code:'FIXTURE_UPSTREAM_FAILED'});else res.destroy();});
  req.pipe(upstream);
}).listen(9000,'0.0.0.0');

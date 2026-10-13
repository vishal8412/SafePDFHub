import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const root=resolve('word-to-pdf-validation');await mkdir(root,{recursive:true});
const temp=await mkdtemp(join(root,'lifecycle-'));
const fake=join(temp,'office');
await writeFile(fake,'#!/bin/sh\nif [ "$1" = "--version" ]; then echo test-office; exit 0; fi\nsleep 60\n',{mode:0o755});
const child=spawn(process.execPath,['services/word-to-pdf/server.mjs'],{env:{...process.env,PORT:'8082',TMPDIR:temp,LIBREOFFICE_PATH:fake,CONVERSION_TIMEOUT_MS:'1000'},stdio:'ignore'});
const base='http://127.0.0.1:8082';
const delay=()=>new Promise(r=>setTimeout(r,40));
async function until(fn){for(let i=0;i<150;i++){try{if(await fn())return;}catch{}await delay();}throw Error('Condition timed out');}
const health=async()=>await(await fetch(base+'/health')).json();
const body=await readFile('regression-fixtures/word-to-pdf/layout.docx');
const post=(signal)=>fetch(base+'/convert/docx',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body,signal});
try {
 await until(async()=>(await health()).ready);
 const controller=new AbortController();const pending=post(controller.signal).catch(()=>null);
 await until(async()=>(await health()).busy);
 assert.equal((await post()).status,503);
 controller.abort();await pending;
 await until(async()=>!(await health()).busy);
 const serviceDir=(await readdir(temp)).find(x=>x.startsWith('safepdfhub-word-service-'));
 assert.deepEqual(await readdir(join(temp,serviceDir)),[]);
 const timed=await post();assert.equal(timed.status,500);assert.match((await timed.json()).error,/timed out/);
 await until(async()=>!(await health()).busy);
 assert.deepEqual(await readdir(join(temp,serviceDir)),[]);
 assert.equal((await fetch(base+'/convert/docx',{method:'POST',headers:{'Content-Type':'text/plain'},body:'bad'})).status,415);
 console.log('PASS: active-job rejection, real request cancellation, process timeout, temporary-file cleanup and service recovery');
}finally{child.kill('SIGTERM');await once(child,'exit');await rm(temp,{recursive:true,force:true});}

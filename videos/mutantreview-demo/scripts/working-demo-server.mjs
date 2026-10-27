import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const checkout=process.argv[2];
if(!checkout)throw new Error('Pass an isolated local checkout path.');
const output=resolve(project,'capture/working');await mkdir(output,{recursive:true});
const clients=new Set();const messages=[];let busy=false;let sequence=0;
const emit=(type,text)=>{const event={type,text,at:new Date().toISOString()};messages.push(event);const s=`data: ${JSON.stringify(event)}\n\n`;for(const c of clients)c.write(s);};
const html=await readFile(resolve(project,'scripts/working-demo-stage.html'),'utf8');
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:4185');
  if(url.pathname==='/events'){
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
   for(const event of messages)res.write(`data: ${JSON.stringify(event)}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return;
  }
  if(url.pathname==='/code'){
   const file=url.searchParams.get('file')==='source'?'packages/demo-domain/src/shipping.ts':'packages/demo-domain/src/shipping.test.ts';
   res.writeHead(200,{'Content-Type':'text/plain'});res.end(await readFile(resolve(checkout,file),'utf8'));return;
  }
  if(url.pathname==='/run'&&req.method==='POST'){
   const action=url.searchParams.get('action');if(!['review','reject','verify','apply'].includes(action)||busy){res.writeHead(409);return res.end('Unsupported action or command already running.');}
   busy=true;const id=++sequence;const filename=resolve(output,`${id}-${action}.txt`);await writeFile(filename,'');emit('start',action);
   const started=Date.now();const child=spawn(process.execPath,['--import','tsx',resolve(project,'scripts/working-demo-worker.mjs'),action],{cwd:checkout,windowsHide:true,stdio:['ignore','pipe','pipe']});
   const collect=(chunk)=>{const text=chunk.toString().replace(/\x1b\[[0-9;]*m/g,'');appendFile(filename,text);for(const line of text.split('\n'))if(line.trim()&&!line.startsWith('warning: in the working copy'))emit('line',line);};
   child.stdout.on('data',collect);child.stderr.on('data',collect);
   child.on('error',e=>{emit('line',e.message);busy=false;emit('done','failed');});
   child.on('close',code=>{busy=false;emit('line',`Completed in ${((Date.now()-started)/1000).toFixed(1)}s. Process exit ${code}.`);emit('done',code===0?action:'failed');writeFile(resolve(output,'events.json'),JSON.stringify(messages,null,2));});
   res.writeHead(202);res.end('Started');return;
  }
  if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html'});res.end(html);return;}
  res.writeHead(404);res.end('Not found');
 }catch(e){res.writeHead(500);res.end(e.message);}
});
server.listen(4185,'127.0.0.1',()=>console.log('Working demo recorder: http://127.0.0.1:4185'));

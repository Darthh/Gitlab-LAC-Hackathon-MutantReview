import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source='capture/working/page@86055bb133d14210a50f1c9e31021fc4.webm';
const ending='capture/working/page@bbd2c5394381368ff3d27bfa873c21fe.webm';
const edits=[
 [source,.6,8.2,1,'Start the real review'],
 [source,8.2,40.5,5,'Review execution — sped up 5×'],
 [source,40.5,54.5,1,'Baseline, survivor and failed gate'],
 [source,138.95,150.05,1,'Inspect the boundary and requirement'],
 [source,150.05,165,1,'Execute and reject the ineffective draft'],
 [source,175.75,191.5,1,'Execute and verify the exact boundary test'],
 [source,225.6,236.3,1,'Inspect the verified proposal'],
 [source,236.3,244.5,1,'Apply the verified test locally'],
 [source,244.5,258,3.5,'Repair execution — sped up 3.5×'],
 [source,269.5,278.2,1,'Fresh result: 100% and gate passed'],
 [ending,.8,18.3,1,'Actual repaired dashboard, test file and gate output'],
];
await mkdir(resolve(project,'renders/working-parts'),{recursive:true});
let time=0;const clips=[];
async function run(args){await new Promise((ok,no)=>{const c=spawn('ffmpeg',args,{cwd:project,windowsHide:true,stdio:'inherit'});c.on('error',no);c.on('close',code=>code===0?ok():no(new Error('FFmpeg failed: '+code)));});}
for(let i=0;i<edits.length;i++){
 const [file,start,end,rate,label]=edits[i];const duration=(end-start)/rate;
 const output=`renders/working-parts/${String(i).padStart(2,'0')}.mp4`;
 console.log(`Edit ${i+1}/${edits.length}: ${label}`);
 await run(['-y','-hide_banner','-loglevel','error','-ss',String(start),'-t',String(end-start),'-i',file,'-vf',`setpts=(PTS-STARTPTS)/${rate},fps=30`,'-c:v','h264_nvenc','-preset','p7','-rc','vbr','-cq','15','-b:v','0','-pix_fmt','yuv420p','-an',output]);
 clips.push({source:file,sourceStart:start,sourceEnd:end,rate,start:time,end:time+duration,label,output});time+=duration;
}
const list=clips.map(c=>`file '${resolve(project,c.output).replaceAll('\\','/')}'`).join('\n');
await writeFile(resolve(project,'renders/working-parts/concat.txt'),list+'\n');
await run(['-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i','renders/working-parts/concat.txt','-c','copy','-movflags','+faststart','assets/working-recording.mp4']);
const duration=Math.round(time*1000)/1000;
const captions=[
 [0,4,'MutantReview mutation-tests code changed in a merge request.'],
 [4,7.6,'Here, I run its real engine on the checkout demo.'],
 [7.6,13.83,'Vitest and Stryker are running. This wait is sped up 5×.'],
 [13.83,19,'The baseline tests pass with 100% branch coverage.'],
 [19,24,'But one mutation survives: changing >= to > goes undetected.'],
 [24,27.83,'The 80% score is below the 90% policy, so the gate fails.'],
 [27.83,33,'The finding identifies the exact $100 free-shipping boundary.'],
 [33,38.93,'The contract says orders of at least $100 ship free.'],
 [38.93,44,'First, I propose a test for an order of $100.01.'],
 [44,49,'MutantReview executes it on the original code and the mutant.'],
 [49,53.88,'It passes on both, so the repair is rejected.'],
 [53.88,59,'Now I propose a test at exactly $100, or 10,000 cents.'],
 [59,64,'Zero shipping comes from the written requirement, not the implementation.'],
 [64,69.63,'This test passes on the original and kills the exact mutation.'],
 [69.63,75,'I inspect the verified proposal before changing the test file.'],
 [75,80.33,'These are the actual finding, contract, and proposed assertion.'],
 [80.33,84.8,'I apply that verified test to the local checkout.'],
 [84.8,88.53,'The updated test file is printed, and a fresh review starts.'],
 [88.53,92.39,'Stryker reruns the mutations. Execution is sped up 3.5×.'],
 [92.39,97,'Now all five tests pass, and every mutation is caught.'],
 [97,101.09,'The real gate command returns passed with exit code zero.'],
 [101.09,106.5,'The dashboard shows 100% mutation score and zero surviving mutants.'],
 [106.5,112,'Here is the added boundary test in the actual test file.'],
 [112,duration,'MutantReview found the gap, rejected a weak fix, and proved the repair.'],
];
const captionShift=clips[2].start-13.83;
for(const c of captions){if(c[0]>=13.83)c[0]+=captionShift;if(c[1]>=13.83&&c[1]!==duration)c[1]+=captionShift;}
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const stamp=s=>{const n=Math.round(s*1000);return`${String(Math.floor(n/3600000)).padStart(2,'0')}:${String(Math.floor(n/60000)%60).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')},${String(n%1000).padStart(3,'0')}`};
await writeFile(resolve(project,'working-subtitles.srt'),captions.map(([a,b,t],i)=>`${i+1}\n${stamp(a)} --> ${stamp(b)}\n${t}\n`).join('\n'));
await writeFile(resolve(project,'working-cut.json'),JSON.stringify({duration,width:3840,height:2160,music:{file:'aruarian dance.mp3',providedBy:'user',volume:.3},clips,captions},null,2)+'\n');
await import('./compose-working-demo.mjs');
console.log(`Built ${duration.toFixed(3)}s actual recorded demo. User-provided soundtrack volume: 30%.`);

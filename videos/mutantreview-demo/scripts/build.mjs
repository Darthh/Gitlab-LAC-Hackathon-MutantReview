import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(project, '../..');
const evidence = JSON.parse(await readFile(resolve(project, 'capture/proof/before.json'), 'utf8'));
const original = JSON.parse(await readFile(resolve(project, 'capture/proof/original.json'), 'utf8'));
const mutant = JSON.parse(await readFile(resolve(project, 'capture/proof/mutant.json'), 'utf8'));
const e2e = await readFile(resolve(project, 'capture/proof/e2e-summary.txt'), 'utf8');
if (evidence.mutation.score !== 80 || evidence.baseline.branchCoverage !== 100 || !original.success || mutant.success) {
  throw new Error('Recorded evidence does not support the planned demonstration.');
}
if (!/8 passed/.test(e2e) || /Test Files\s+\d+ failed/.test(e2e)) throw new Error('Wait for the real eight-test end-to-end run to pass.');
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const captions = [
  [0,3.5,'Your tests passed. Would they notice the code breaking?'],
  [3.5,7,'MutantReview checks whether your tests can detect a behavior change.'],
  [7,12,'This is the real Front Desk, running a fresh local review.'],
  [12,17,'Four baseline tests pass, with 100% branch coverage.'],
  [17,22,'But one of five mutations survives. The 80% score blocks the 90% gate.'],
  [22,27,'MutantReview changes the code slightly and reruns the tests.'],
  [27,31,'Here, “at least $100” becomes “more than $100.”'],
  [31,35,'An order of exactly $100 loses free shipping. No existing test notices.'],
  [35,40,'The written contract says orders of at least $100 ship free.'],
  [40,45,'The missing test checks exactly 10,000 cents and expects zero shipping.'],
  [45,49,'This local fixture shows the repair. In the Duo flow, the agent drafts it.'],
  [49,54,'A proposed test must pass on the original implementation.'],
  [54,59,'It must also fail against the exact mutation it claims to catch.'],
  [59,63,'A clean rerun reproduces both results. This is execution evidence.'],
  [63,68,'A convincing-looking test can still protect nothing.'],
  [68,73,'Testing $100.01 passes with both comparisons, so that draft is rejected.'],
  [73,77,'The real Vitest and Stryker end-to-end tests verify that rejection.'],
  [77,82,'A human selects the verified tests to apply through a merge request comment.'],
  [82,87,'The flow checks permissions, proposal integrity, and the reviewed revision.'],
  [87,91,'In the local end-to-end test, the approved repair moves the score to 100%.'],
  [91,94,'The repair records its result and teaches AGENTS.md.'],
  [94,99,'MutantReview also checks whether edited tests lose existing protection.'],
  [99,103,'This separate local scenario catches a boundary test that was weakened.'],
  [103,107,'Green tests should never hide behavior they used to protect.'],
  [107,112,'Changed-line scope and a three-finding limit keep the review focused.'],
  [112,118,'The console shows the findings, proof, history, and execution footprint.'],
  [118,123,'MutantReview. Tests that notice when the code breaks.'],
  [123,128,'Find the project on GitLab. Human approval. Executable proof.'],
];

const scene = (id,start,duration,kicker,title,content,label='ACTUAL LOCAL EXECUTION') => `<section id="${id}" class="clip scene" data-start="${start}" data-duration="${duration}" data-track-index="1"><div class="ground"></div><header><div class="eyebrow">${esc(kicker)}</div><h1>${title}</h1><div class="source">${esc(label)}</div></header>${content}</section>`;
const screen = (src,extra='') => `<div class="screen-window" data-layout-allow-overflow><img class="screen-image ${extra}" src="assets/${src}" alt="Actual MutantReview dark Front Desk capture" /></div>`;
const scenes = [
scene('s01',0,7,'MUTANTREVIEW / PRODUCT DEMO','',`<div class="intro"><img src="assets/mutant-m.svg" alt="MutantReview green mutant M logo"/><div><h2 class="intro-title">Your tests passed.</h2><h2 class="intro-question">Would they catch<br class="display-break">a broken boundary?</h2></div></div><div class="intro-proof"><div><strong>100%</strong><span>Branch coverage</span></div><div><strong class="amber">80%</strong><span>Mutation score</span></div><p>Same code. A different question.</p></div>`, 'REAL EXECUTION • NO VOICEOVER'),
scene('s02',7,15,'01 / REVIEW','Green tests. One unprotected boundary.',screen('overview.png')+`<div class="focus stats-focus"></div><div class="metric-callout"><strong>80%</strong><span>Below the 90% policy</span></div>`),
scene('s03',22,13,'02 / FIND THE GAP','One character. A missed $100 boundary.',screen('mutation-close.png','screen-close')+`<div class="mutation-callout"><code>&gt;=</code><span>becomes</span><code class="amber">&gt;</code></div>`),
scene('s04',35,14,'03 / DRAFT A REPAIR','Test the requirement at its exact boundary.',`<div class="split"><div class="explainer"><div class="tag">SHIPPING-001</div><h2>Orders of at least<br class="display-break">$100 ship free.</h2><div class="test-code"><span class="code-muted">// amounts are in cents</span><code>expect(shippingFee(<b>10_000</b>))<br class="display-break">  .toBe(<b>0</b>);</code></div><p>Expected value comes from the written contract.</p></div><div class="detail-crop" data-layout-allow-overflow><img src="assets/test-close.png" alt="Actual proposed boundary test in the dark Front Desk"/></div></div>`, 'LOCAL FIXTURE • DUO DRAFTING NOT RECORDED'),
scene('s05',49,14,'04 / VERIFY','A test earns trust by catching the mutation.',screen('verification.png')+`<div class="proof-strip"><div><span>ORIGINAL CODE</span><strong class="green">${original.numPassedTests}/${original.numTotalTests} tests pass</strong></div><div><span>EXACT MUTANT</span><strong class="red">Boundary assertion fails</strong></div><div><span>FRESH RERUN</span><strong class="green">Same result, twice</strong></div></div>`),
scene('s06',63,14,'05 / REJECT USELESS DRAFTS','Plausible is not enough.',`<div class="comparison"><div class="comparison-card"><div class="tag">INEFFECTIVE DRAFT</div><code>shippingFee(10_001)</code><h2>$100.01</h2><p>Passes with <code>&gt;=</code> and <code>&gt;</code></p><div class="verdict red">REJECTED BY EXECUTION</div></div><div class="comparison-card"><div class="tag">VERIFIED BOUNDARY</div><code>shippingFee(10_000)</code><h2>Exactly $100</h2><p>Passes on original. Fails on mutant.</p><div class="verdict green">VERIFIED FOR REVIEW</div></div></div><div class="terminal-receipt"><code>$ npm run test:e2e</code><span class="green">8 tests passed • real Vitest + Stryker</span><span>Includes draft rejection and approved repair checks</span></div>`, 'REAL END-TO-END TEST • GITLAB API SIMULATED'),
scene('s07',77,17,'06 / HUMAN APPROVAL','You choose the repair.',`<div class="approval-command"><span class="code-muted">Reviewer comment</span><code id="approval-type">${[...'@mutant-review apply 1'].map((c,i)=>`<span class="approval-char">${esc(c===' '?'\u00a0':c)}</span>`).join('')}</code><span class="code-muted">Use the configured flow account handle in your project.</span></div><div class="approval-checks"><span>Permissions checked</span><span>Proposal verified</span><span>MR revision checked</span></div><div class="approval-result"><strong>80%</strong><span>→</span><strong class="green">100%</strong><p>Changed-line mutation score in the local e2e test</p></div><div class="outputs"><code>shipping.test.ts</code><span>+</span><code>repair ledger</code><span>+</span><code>AGENTS.md lesson</code></div>`, 'APPROVAL FLOW ILLUSTRATION • LOCAL E2E • GITLAB API SIMULATED'),
scene('s08',94,13,'07 / PROTECT EXISTING TESTS','Catch protection that a test edit removes.',screen('protection.png')+`<div class="scenario-label">Separate local demonstration scenario</div>`,'ACTUAL UI • LOCAL LOST-PROTECTION SCENARIO'),
scene('s09',107,11,'08 / FOCUSED REVIEW','Inspect the proof. Keep the cost visible.',screen('footprint.png')+`<div class="principle-strip"><span>Changed lines only</span><span>At most 3 findings</span><span>Evidence you can inspect</span></div>`),
scene('s10',118,10,'MUTANTREVIEW','',`<div class="closing"><img src="assets/mutant-m.svg" alt="MutantReview logo"/><h2>MutantReview</h2><p>Tests that notice when the code breaks.</p><div class="closing-rule"></div><span>Human approval. Executable proof.</span><code>gitlab.com/mutant-review1/mutant-review</code></div><div class="credits"><p>Music: “Cipher” — Kevin MacLeod (incompetech.com)</p><p>Creative Commons Attribution 4.0 • creativecommons.org/licenses/by/4.0/</p><p>Excerpt, volume adjustment and fades • No voiceover</p></div>`, 'DARK FRONT DESK • UHD 4K'),
].join('\n');

const css = `
@font-face{font-family:'GitLab Sans';src:url('assets/GitLabSans.woff2') format('woff2');font-weight:100 900;font-style:normal}
@font-face{font-family:'GitLab Mono';src:url('assets/GitLabMono.woff2') format('woff2');font-weight:100 900;font-style:normal}
*{box-sizing:border-box}html,body{margin:0;background:#050506;color:#ececef;font-family:'GitLab Sans',sans-serif}#root{position:relative;width:100%;height:100%;overflow:hidden;background:#050506}.clip{position:absolute}.scene{inset:0}.ground{position:absolute;inset:0;background:#050506}header{position:absolute;left:64px;right:64px;top:36px;height:100px}header h1{margin:15px 0 0;font-size:48px;line-height:1.08;font-weight:650;letter-spacing:-1.2px;max-width:1540px}.eyebrow{font-family:'GitLab Mono',monospace;font-size:16px;letter-spacing:2px;color:#91d4a8}.source{position:absolute;top:0;right:0;font-family:'GitLab Mono',monospace;font-size:14px;letter-spacing:.7px;color:#b2b2b6;max-width:650px;text-align:right}.screen-window{position:absolute;left:64px;top:166px;width:1792px;height:746px;overflow:hidden;border:1px solid #4c4b51;border-radius:10px;background:#18171d}.screen-image{display:block;width:1792px;height:1008px;max-width:none;object-fit:fill}.screen-close{margin-top:-150px}.focus{position:absolute;border:3px solid #e9be74;border-radius:8px;pointer-events:none}.stats-focus{left:327px;top:518px;width:1457px;height:153px}.metric-callout{position:absolute;right:106px;top:711px;background:#18171d;border:1px solid #e9be74;padding:18px 28px;display:flex;align-items:center;gap:22px}.metric-callout strong{font-size:60px;line-height:1;color:#e9be74}.metric-callout span{font-size:25px}.mutation-callout{position:absolute;right:117px;top:728px;padding:20px 35px;background:#18171d;border:1px solid #4c4b51;display:flex;align-items:center;gap:35px}.mutation-callout code{font-size:64px;font-weight:650}.mutation-callout span{font-size:22px;color:#b2b2b6}code{font-family:'GitLab Mono',monospace}.amber{color:#e9be74}.green{color:#91d4a8}.red{color:#ff8797}.intro{position:absolute;left:112px;top:222px;display:flex;align-items:flex-start;gap:48px}.intro img{width:136px;height:136px;margin-top:18px}.intro h2{margin:0;font-size:76px;line-height:1.12;letter-spacing:-2px}.intro-title{font-weight:500;color:#b2b2b6}.intro-question{font-weight:680;margin-top:16px!important}.intro-proof{position:absolute;left:298px;top:620px;display:flex;align-items:center;gap:65px}.intro-proof>div{display:flex;flex-direction:column;border-left:3px solid #009777;padding-left:25px}.intro-proof strong{font-size:72px;line-height:1.1}.intro-proof span{font-size:22px;color:#b2b2b6;margin-top:13px}.intro-proof p{font-size:25px;max-width:260px;color:#b2b2b6;line-height:1.5}.split{position:absolute;left:80px;right:64px;top:190px;height:692px;display:grid;grid-template-columns:640px 1fr;gap:55px}.explainer{padding:30px 0}.tag{font-family:'GitLab Mono',monospace;font-size:16px;letter-spacing:1px;color:#91d4a8}.explainer h2{font-size:48px;line-height:1.15;margin:25px 0 35px;letter-spacing:-1px}.test-code{padding:28px 22px;background:#18171d;border:1px solid #4c4b51;border-left:3px solid #009777}.test-code>span{display:block;font-size:18px;margin-bottom:24px}.test-code code{font-size:28px;line-height:1.8;white-space:nowrap}.test-code b{color:#91d4a8;font-weight:600}.code-muted{color:#b2b2b6}.explainer>p{font-size:22px;line-height:1.5;color:#b2b2b6;max-width:550px;margin-top:28px}.detail-crop{overflow:hidden;border:1px solid #4c4b51;border-radius:8px;background:#18171d}.detail-crop img{width:1840px;height:1035px;max-width:none;margin-left:-398px;margin-top:-290px}.proof-strip{position:absolute;left:318px;right:109px;top:712px;display:flex;gap:12px;background:#050506;padding:12px}.proof-strip>div{flex:1;background:#18171d;border:1px solid #4c4b51;padding:25px 18px;display:flex;flex-direction:column;gap:18px}.proof-strip span{font-family:'GitLab Mono',monospace;font-size:14px;color:#b2b2b6}.proof-strip strong{font-size:24px}.comparison{position:absolute;left:128px;right:128px;top:238px;display:grid;grid-template-columns:1fr 1fr;gap:32px}.comparison-card{padding:36px;border:1px solid #4c4b51;background:#18171d;border-radius:10px}.comparison-card>code{font-size:27px;display:block;margin-top:28px}.comparison-card h2{font-size:54px;margin:28px 0 20px;font-weight:650;letter-spacing:-1px}.comparison-card p{font-size:24px;color:#b2b2b6;min-height:36px}.verdict{padding-top:28px;border-top:1px solid #4c4b51;font-family:'GitLab Mono',monospace;font-size:21px;letter-spacing:.8px;margin-top:28px}.terminal-receipt{position:absolute;left:128px;right:128px;top:750px;padding:23px 28px;background:#111115;border:1px solid #4c4b51;display:flex;align-items:center;gap:35px}.terminal-receipt code{font-size:22px}.terminal-receipt>span{font-size:20px;max-width:510px}.approval-command{position:absolute;left:140px;right:140px;top:213px;background:#18171d;border:1px solid #4c4b51;border-left:4px solid #009777;padding:27px 34px;display:flex;flex-direction:column;gap:22px}.approval-command>span{font-size:19px}.approval-command>code{font-size:52px;line-height:1.4}.approval-char{display:inline-block}.approval-checks{position:absolute;left:140px;right:140px;top:456px;display:flex;gap:25px}.approval-checks span{padding:15px 22px;background:#192c25;border:1px solid #358369;font-size:22px;color:#91d4a8}.approval-result{position:absolute;left:140px;top:574px;display:flex;align-items:center;gap:40px;flex-wrap:wrap;width:1640px}.approval-result>strong{font-size:108px;font-weight:650;line-height:1}.approval-result>span{font-size:70px;color:#b2b2b6}.approval-result p{font-size:24px;color:#b2b2b6;max-width:410px;margin-left:30px;line-height:1.4}.outputs{position:absolute;left:140px;right:140px;top:791px;display:flex;gap:25px;align-items:center}.outputs code{font-size:23px;padding:20px 25px;background:#18171d;border:1px solid #4c4b51}.outputs>span{font-size:27px;color:#91d4a8}.scenario-label{position:absolute;right:105px;top:842px;padding:13px 23px;background:#322a1d;border:1px solid #a97521;font-size:21px;color:#e9be74}.principle-strip{position:absolute;left:318px;right:110px;top:825px;display:flex;gap:12px;background:#050506;padding:12px}.principle-strip span{flex:1;font-size:23px;text-align:center;background:#192c25;color:#91d4a8;padding:16px 10px;border:1px solid #358369}.closing{position:absolute;left:100px;right:100px;top:175px;display:flex;flex-direction:column;align-items:center}.closing img{width:116px;height:116px}.closing h2{font-size:76px;letter-spacing:-2px;line-height:1.15;margin:25px 0 15px}.closing>p{font-size:40px;margin:0;color:#ececef}.closing-rule{width:80px;height:3px;background:#009777;margin:34px 0}.closing>span{font-size:25px;color:#b2b2b6}.closing>code{font-size:24px;margin-top:25px;color:#9dc7f1}.credits{position:absolute;left:100px;right:100px;top:741px;text-align:center;color:#b2b2b6}.credits p{font-size:18px;line-height:1.5;margin:5px 0}.caption{left:96px;right:96px;bottom:67px;margin:0;z-index:50;text-align:center;font-size:29px;line-height:1.35;font-weight:500;color:#ececef;letter-spacing:.05px}.caption>span{display:block;padding:8px 20px;background:#050506}.timeline-rule{position:absolute;left:64px;right:64px;bottom:32px;height:2px;background:#333238;z-index:60}.timeline-fill{height:2px;width:100%;background:#009777;transform-origin:left center}.video-overlay{position:absolute;left:65px;top:167px;width:1790px;height:744px;object-fit:cover;object-position:center top;z-index:4}.display-break{display:block}
`;

let animations = `const tl=gsap.timeline({paused:true});\n`;
for(const [id,start] of [['s01',0],['s02',7],['s03',22],['s04',35],['s05',49],['s06',63],['s07',77],['s08',94],['s09',107],['s10',118]]) {
  animations += `tl.fromTo('#${id} header',{opacity:0,y:12},{opacity:1,y:0,duration:.4,ease:'power2.out'},${start+.05});\n`;
}
animations += `
tl.fromTo('.intro img',{opacity:0,scale:.88},{opacity:1,scale:1,duration:.65,ease:'power3.out'},.1);
tl.fromTo('.intro-title',{opacity:0,y:25},{opacity:1,y:0,duration:.55},.1);
tl.fromTo('.intro-question',{opacity:0,y:25},{opacity:1,y:0,duration:.6},1.1);
tl.fromTo('.intro-proof',{opacity:0,y:15},{opacity:1,y:0,duration:.6},3.1);
tl.fromTo('.stats-focus',{opacity:0},{opacity:1,duration:.3},12);
tl.fromTo('.metric-callout',{opacity:0,y:18},{opacity:1,y:0,duration:.4},17);
tl.fromTo('.mutation-callout',{opacity:0,y:12},{opacity:1,y:0,duration:.4},27);
tl.fromTo('.test-code',{opacity:0,y:16},{opacity:1,y:0,duration:.5},39.7);
tl.fromTo('.proof-strip>div',{opacity:0,y:15},{opacity:1,y:0,duration:.5,stagger:3.8},49.5);
tl.fromTo('.comparison-card:first-child',{opacity:0,y:20},{opacity:1,y:0,duration:.5},63.4);
tl.fromTo('.comparison-card:last-child',{opacity:0,y:20},{opacity:1,y:0,duration:.5},67.5);
tl.fromTo('.verdict',{opacity:0},{opacity:1,duration:.4,stagger:.3},70.5);
tl.fromTo('.terminal-receipt',{opacity:0,y:15},{opacity:1,y:0,duration:.5},73);
tl.fromTo('.approval-char',{opacity:0},{opacity:1,duration:.001,stagger:.065},78);
tl.fromTo('.approval-checks span',{opacity:0,y:12},{opacity:1,y:0,duration:.35,stagger:.8},82);
tl.fromTo('.approval-result',{opacity:0,y:18},{opacity:1,y:0,duration:.5},87);
tl.fromTo('.outputs code,.outputs>span',{opacity:0,y:12},{opacity:1,y:0,duration:.35,stagger:.12},91);
tl.fromTo('.scenario-label',{opacity:0,y:12},{opacity:1,y:0,duration:.4},98.5);
tl.fromTo('.principle-strip span',{opacity:0,y:12},{opacity:1,y:0,duration:.4,stagger:1.5},108);
tl.fromTo('.closing img',{opacity:0,scale:.9},{opacity:1,scale:1,duration:.6},118.1);
tl.fromTo('.closing h2,.closing>p',{opacity:0,y:15},{opacity:1,y:0,duration:.6,stagger:.2},118.3);
tl.fromTo('.timeline-fill',{scaleX:0},{scaleX:1,duration:128,ease:'none'},0);
window.__timelines['main']=tl;`;

const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=1920, height=1080"><title>MutantReview — Tests that notice</title><script src="assets/gsap.min.js"></script><style>${css}</style></head><body><div id="root" data-composition-id="main" data-width="1920" data-height="1080" data-duration="128" data-fps="30">${scenes}
<video id="overview-recording" class="clip video-overlay" src="assets/console-tour.mp4" muted playsinline data-start="7.3" data-duration="3.3" data-media-start="0" data-track-index="2"></video>
<video id="finding-recording" class="clip video-overlay" src="assets/finding-interaction.mp4" muted playsinline data-start="22" data-duration="12.9" data-media-start="0" data-track-index="2"></video>
${captions.map(([start,end,text],i)=>`<p id="caption-${i+1}" class="clip caption" data-start="${start}" data-duration="${end-start}" data-track-index="5"><span>${esc(text)}</span></p>`).join('\n')}
<audio id="music" src="assets/soundtrack.mp3" data-start="0" data-duration="128" data-track-index="6" data-volume="1" data-timeline-role="music" data-automation="{&quot;version&quot;:1,&quot;lanes&quot;:[{&quot;target&quot;:&quot;volume&quot;,&quot;points&quot;:[{&quot;t&quot;:0,&quot;v&quot;:0},{&quot;t&quot;:1.2,&quot;v&quot;:0.8},{&quot;t&quot;:123,&quot;v&quot;:0.8},{&quot;t&quot;:127.8,&quot;v&quot;:0}]}]}"></audio>
<div class="timeline-rule"><div class="timeline-fill"></div></div></div><script>${animations}</script></body></html>`;
await writeFile(resolve(project,'index.html'),html);
const stamp=(s)=>{const ms=Math.round(s*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
await writeFile(resolve(project,'subtitles.srt'),captions.map(([a,b,t],i)=>`${i+1}\n${stamp(a)} --> ${stamp(b)}\n${t}\n`).join('\n'));
await writeFile(resolve(project,'assets/proof-data.json'),JSON.stringify({revision:evidence.provenance.headSha,runId:evidence.runId,baseline:evidence.baseline,score:evidence.mutation.score,gate:evidence.gate,original:{passed:original.numPassedTests,total:original.numTotalTests},mutant:{passed:mutant.numPassedTests,total:mutant.numTotalTests},e2ePassed:8,approval:'Local e2e test; GitLab API simulated. No live approval or remote repair.',captions},null,2)+'\n');
console.log('Built 128-second composition, English SRT and execution provenance.');

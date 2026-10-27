// Executes the existing MutantReview engine in a dedicated local demo checkout.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const action=process.argv[2];
const repo=process.cwd();
const readJson=async(p)=>JSON.parse(await readFile(p,'utf8'));
const statePath='.mutant-review/work/working-demo.json';
const testPath='packages/demo-domain/src/shipping.test.ts';
const exactTest="it('ships free at exactly $100 (SHIPPING-001)', () => {\n  expect(shippingFee(10_000)).toBe(0);\n});";
const wrongTest="it('ships free above $100 (proposed repair)', () => {\n  expect(shippingFee(10_001)).toBe(0);\n});";
const load=async(file)=>import(pathToFileURL(resolve(repo,file)).href);
const command=async(command,args)=>{
  console.log(`\n$ node --import tsx packages/cli/src/index.ts ${command}`);
  return await new Promise((res,rej)=>{
    const child=spawn(process.execPath,['--import','tsx','packages/cli/src/index.ts',command,...args],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
    child.on('error',rej);child.on('close',code=>{console.log(`Exit code: ${code}`);res(code);});
  });
};
await mkdir('.mutant-review/work',{recursive:true});
if(action==='review'){
  if(await command('demo',[])!==0) throw new Error('The real review did not complete.');
  const evidence=await readJson('evidence/latest.json');
  const finding=evidence.triage.ranked.find(f=>f.replacement==='subtotalCents > 10_000');
  if(!finding)throw new Error('Expected real surviving boundary finding was not produced.');
  await writeFile(statePath,JSON.stringify({finding,originalTest:await readFile(testPath,'utf8'),verified:null},null,2));
  console.log(`\nBaseline: ${evidence.baseline.tests} tests passed; branch coverage ${evidence.baseline.branchCoverage}%.`);
  console.log(`Stryker: ${evidence.mutation.score}% mutation score; gate ${evidence.gate.status}.`);
  console.log(`Surviving change: ${finding.original} -> ${finding.replacement}`);
  const code=await command('gate',[]);
  if(code!==1)throw new Error('The baseline gate did not fail as expected.');
  await copyFile('evidence/latest.json','.mutant-review/work/working-demo-before.json');
}else if(action==='reject'||action==='verify'){
  const state=await readJson(statePath);
  const {verifyDraft}=await load('packages/cli/src/flow.ts');
  const exact=action==='verify';
  const draft={finding:1,testPath,imports:[],test:exact?exactTest:wrongTest,expectedFrom:'SHIPPING-001: orders of at least $100 receive free shipping; amounts are integer cents.'};
  console.log(`\n$ MutantReview verifyDraft(${exact?'exact boundary':'above boundary'})`);
  console.log(draft.test);
  console.log('\nExecuting real Vitest on the original code, then Stryker on the targeted mutant...');
  const verdict=await verifyDraft(draft,state.finding,exact?201:202);
  console.log('Original implementation: '+(await readJson(`evidence/flow/draft-${exact?201:202}.json`)).success);
  if('reason' in verdict){
    console.log(`\nREJECTED: ${verdict.reason}`);
    if(exact)throw new Error('Exact boundary draft was not verified.');
  }else{
    console.log('\nVERIFIED: this test passes on the original and kills the exact mutation.');
    if(!exact)throw new Error('Ineffective draft was not rejected.');
    state.verified=verdict;await writeFile(statePath,JSON.stringify(state,null,2));
  }
  if(await readFile(testPath,'utf8')!==state.originalTest)throw new Error('Verification changed the demo test file.');
  console.log('Verification restored the test file; the proposal has not been applied.');
}else if(action==='apply'){
  const state=await readJson(statePath);
  if(!state.verified)throw new Error('No verified repair is available.');
  if(await readFile(testPath,'utf8')!==state.originalTest)throw new Error('The local demo changed since verification.');
  console.log('\n$ Apply the verified boundary test to this local demo checkout');
  await writeFile(testPath,state.originalTest+'\n'+state.verified.test+'\n');
  console.log(await readFile(testPath,'utf8'));
  console.log('\nThe test file now contains the verified assertion. Rerunning the real review...');
  if(await command('demo',[])!==0)throw new Error('Repaired review did not complete.');
  const evidence=await readJson('evidence/latest.json');
  console.log(`\nAFTER REPAIR: ${evidence.baseline.tests} tests passed, ${evidence.mutation.score}% mutation score, gate ${evidence.gate.status}.`);
  if(evidence.mutation.score!==100||evidence.gate.status!=='passed')throw new Error('The real repaired result was not 100% and passed.');
  if(await command('gate',[])!==0)throw new Error('The repaired gate failed.');
  await copyFile('evidence/latest.json','.mutant-review/work/working-demo-after.json');
  console.log('\nLocal repair complete: 80% -> 100%. The previously surviving mutation is now caught.');
}else throw new Error('Unsupported demo action.');

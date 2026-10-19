import { normalizeReport, MAX_REPORT_BYTES } from '@zofai/ci-evidence';
import { assertSafeRelativePath, redact, redactText, safeReadFile, safeReadJson } from '@zofai/evidence-spec';
export type TestStatus='passed'|'failed'|'skipped'|'error';
export interface ObservationRun { id:string; status:'completed'|'partial'|'missing'|'error'; tests:{name:string;status:TestStatus}[] }
export interface DetectionOptions { minSamples?:number }
export interface TestInstability {
 name:string;classification:'observed-instability'|'consistent-pass'|'consistent-fail'|'execution-errors'|'insufficient-data';
 passed:number;failed:number;skipped:number;errors:number;missing:number;evaluatedSamples:number;
 transitions:number;comparableAdjacentPairs:number;observedFailureRate:number|null;observedTransitionRate:number|null;
 rank:number;explanation:string;
}
export interface InstabilityReport {
 schemaVersion:'test-instability/v1';runCount:number;minSamples:number;complete:boolean;
 tests:TestInstability[];runIssues:{runId:string;code:string}[];
 limitations:string[];verificationResult:'not-run';quarantinedTests:[];
}
export interface JUnitOptions extends DetectionOptions {root:string;files:string[]}
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function label(value:unknown,max:number):string{if(typeof value!=='string'||!value||value.length>max||/[\x00-\x1f\x7f]/.test(value))throw new Error('Invalid observation label');return redactText(value);}
function validateRuns(value:unknown):ObservationRun[]{
 if(!Array.isArray(value)||value.length>256)throw new Error('Observation run count exceeds supported limits');
 let total=0;const ids=new Set<string>();const result:ObservationRun[]=[];
 for(const run of value){
  if(!object(run)||Object.keys(run).some(k=>!['id','status','tests'].includes(k))||!['completed','partial','missing','error'].includes(String(run.status))||!Array.isArray(run.tests)||run.tests.length>10000)throw new Error('Invalid observation run');
  const id=label(run.id,128);if(ids.has(id))throw new Error('Duplicate observation run identity');ids.add(id);const names=new Set<string>();const tests:ObservationRun['tests']=[];
  if(run.status==='missing'&&run.tests.length)throw new Error('Missing runs cannot contain test observations');
  for(const test of run.tests){if(++total>100000)throw new Error('Observation count exceeds supported limits');if(!object(test)||Object.keys(test).some(k=>!['name','status'].includes(k))||!['passed','failed','skipped','error'].includes(String(test.status)))throw new Error('Invalid test observation');const name=label(test.name,1024);if(names.has(name))throw new Error('Duplicate or redacted test identity in one run');names.add(name);tests.push({name,status:test.status as TestStatus});}
  result.push({id,status:run.status as ObservationRun['status'],tests});
 }
 return result;
}
export function detectFlakiness(input:ObservationRun[],options:DetectionOptions={}):InstabilityReport{
 if(!options||typeof options!=='object'||Object.keys(options).some(k=>k!=='minSamples'))throw new Error('Invalid detector options');
 const minSamples=options.minSamples??3;if(!Number.isSafeInteger(minSamples)||minSamples<2||minSamples>256)throw new Error('Minimum sample count must be between 2 and 256');
 const runs=validateRuns(input);const runIssues:InstabilityReport['runIssues']=[];
 for(const run of runs){if(run.status!=='completed')runIssues.push({runId:run.id,code:`RUN_${run.status.toUpperCase()}`});else if(!run.tests.length)runIssues.push({runId:run.id,code:'RUN_WITHOUT_TESTS'});}
 const names=[...new Set(runs.flatMap(r=>r.tests.map(t=>t.name)))].sort();
 const matrices=runs.map(r=>new Map(r.tests.map(t=>[t.name,t.status])));
 const tests:TestInstability[]=names.map(name=>{
  let passed=0,failed=0,skipped=0,errors=0,missing=0,transitions=0,comparableAdjacentPairs=0;let previous:'passed'|'failed'|undefined;
  for(const matrix of matrices){const status=matrix.get(name);if(status==='passed'||status==='failed'){if(status==='passed')passed++;else failed++;if(previous){comparableAdjacentPairs++;if(previous!==status)transitions++;}previous=status;}else{if(status==='skipped')skipped++;else if(status==='error')errors++;else missing++;previous=undefined;}}
  const evaluatedSamples=passed+failed;let classification:TestInstability['classification'];
  if(evaluatedSamples<minSamples)classification='insufficient-data';else if(passed&&failed)classification='observed-instability';else if(errors)classification='execution-errors';else if(failed)classification='consistent-fail';else classification='consistent-pass';
  const explanations:Record<TestInstability['classification'],string>={
   'insufficient-data':`Only ${evaluatedSamples} pass/fail observations; at least ${minSamples} are required.`,
   'observed-instability':`Observed both passing (${passed}) and failing (${failed}) outcomes; this does not prove a flaky root cause.`,
   'execution-errors':`Pass/fail sample threshold reached, but ${errors} execution error(s) prevent a consistent-outcome classification.`,
   'consistent-fail':`All ${evaluatedSamples} evaluated pass/fail outcomes failed; skipped and missing observations remain separate.`,
   'consistent-pass':`All ${evaluatedSamples} evaluated pass/fail outcomes passed; this does not prove future stability.`
  };
  return{name,classification,passed,failed,skipped,errors,missing,evaluatedSamples,transitions,comparableAdjacentPairs,observedFailureRate:evaluatedSamples?failed/evaluatedSamples:null,observedTransitionRate:comparableAdjacentPairs?transitions/comparableAdjacentPairs:null,rank:0,explanation:explanations[classification]};
 });
 const priority:Record<TestInstability['classification'],number>={'observed-instability':4,'execution-errors':3,'consistent-fail':2,'insufficient-data':1,'consistent-pass':0};
 tests.sort((a,b)=>priority[b.classification]-priority[a.classification]||b.transitions-a.transitions||b.failed-a.failed||a.name.localeCompare(b.name,'en'));tests.forEach((t,index)=>{t.rank=index+1;});
 const complete=!!runs.length&&!!tests.length&&!runIssues.length&&tests.every(t=>!t.missing&&!t.skipped&&!t.errors&&t.evaluatedSamples>=minSamples);
 return redact({schemaVersion:'test-instability/v1',runCount:runs.length,minSamples,complete,tests,runIssues,limitations:[
  'Metrics describe observed outcomes, not proven flakiness or a scientific confidence estimate.',
  'Changes to source, environments, inputs or infrastructure between runs can explain inconsistent outcomes.',
  'Input order defines run order. Transitions count only adjacent runs with pass/fail observations; missing, skipped or error outcomes break adjacency.',
  'Skipped, missing and error outcomes are excluded from the pass/fail denominator and reported separately.',
  'Ranks use classification priority, transition count, failure count, then test name; they are review priorities, not probabilities.',
  'Test identities must be unique within each run. Redacted identity collisions are rejected.',
  'No tests are executed or quarantined; analysis does not verify that supplied outcomes are authentic.'
 ],verificationResult:'not-run',quarantinedTests:[]} as InstabilityReport);
}
export async function analyzeJUnit(options:JUnitOptions):Promise<InstabilityReport>{
 if(!options||typeof options.root!=='string'||!Array.isArray(options.files)||options.files.length>64)throw new Error('Invalid JUnit artifact selection');
 const selected=new Set<string>();for(const file of options.files){assertSafeRelativePath(file);if(selected.has(file))throw new Error('Duplicate JUnit artifact path');selected.add(file);}
 const runs:ObservationRun[]=[];const extraIssues:InstabilityReport['runIssues']=[];let totalBytes=0;
 for(let index=0;index<options.files.length;index++){
  const file=options.files[index];assertSafeRelativePath(file);const id=`run-${index+1}`;
  try{
   const buffer=await safeReadFile(options.root,file,MAX_REPORT_BYTES);totalBytes+=buffer.length;if(totalBytes>32*1024*1024)throw new Error('Total JUnit input bytes exceed limits');
   const evidence=normalizeReport(buffer,{format:'junit'});
   runs.push({id,status:evidence.execution.status,tests:evidence.tests.map(t=>({name:t.name,status:t.status}))});
   if(evidence.execution.status==='error')extraIssues.push({runId:id,code:'INVALID_JUNIT'});
  }catch{runs.push({id,status:'error',tests:[]});extraIssues.push({runId:id,code:'UNREADABLE_OR_LIMITED_JUNIT'});}
  if(totalBytes>32*1024*1024){for(let remaining=index+1;remaining<options.files.length;remaining++)runs.push({id:`run-${remaining+1}`,status:'missing',tests:[]});break;}
 }
 const report=detectFlakiness(runs,{...(options.minSamples!==undefined?{minSamples:options.minSamples}:{})});report.runIssues.push(...extraIssues);if(extraIssues.length)report.complete=false;return report;
}
export async function analyzeObservationFile(root:string,file:string,options:DetectionOptions={}):Promise<InstabilityReport>{return detectFlakiness(await safeReadJson(root,file,4*1024*1024) as ObservationRun[],options);}
export function formatReport(report:InstabilityReport):string{return redact([`Observed test instability: ${report.runCount} run(s); minimum ${report.minSamples} pass/fail samples`, `Input coverage: ${report.complete?'complete for supplied observations':'incomplete'}`,...report.tests.map(t=>`${t.rank}. ${t.name}: ${t.classification} — ${t.explanation} Transitions ${t.transitions}/${t.comparableAdjacentPairs}; missing ${t.missing}, skipped ${t.skipped}, errors ${t.errors}.`),...report.runIssues.map(i=>`Run issue: ${i.runId} ${i.code}`),...report.limitations.map(l=>`Limitation: ${l}`)].join('\n'));}

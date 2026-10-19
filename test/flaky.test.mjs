import test from'node:test';import assert from'node:assert/strict';import{mkdtemp,mkdir,writeFile,rm,symlink}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{execFileSync}from'node:child_process';import{detectFlakiness,analyzeJUnit,analyzeObservationFile,formatReport}from'../dist/index.js';
const roots=[];async function fixture(files){const root=await mkdtemp(join(tmpdir(),'zof-flaky-'));roots.push(root);for(const[p,s]of Object.entries(files)){await mkdir(join(root,p,'..'),{recursive:true});await writeFile(join(root,p),s);}return root;}test.after(async()=>{for(const root of roots)await rm(root,{recursive:true,force:true});});
function observations(statuses,name='test'){return statuses.map((status,i)=>({id:`run-${i}`,status:'completed',tests:status?[{name,status}]:[]}));}
test('deterministic JUnit fixtures classify pass, fail, intermittent and insufficient samples',async()=>{
 const r=await analyzeJUnit({root:'examples/junit',files:['run-1.xml','run-2.xml','run-3.xml']});const tests=Object.fromEntries(r.tests.map(t=>[t.name,t]));
 assert.equal(tests.stable.classification,'consistent-pass');assert.equal(tests.failing.classification,'consistent-fail');assert.equal(tests.intermittent.classification,'observed-instability');assert.equal(tests.rare.classification,'insufficient-data');assert.equal(tests.rare.missing,2);assert.equal(r.complete,false);assert.equal(tests.intermittent.transitions,2);assert.equal(tests.intermittent.observedTransitionRate,1);assert.equal(tests.intermittent.observedFailureRate,2/3);assert.equal(r.tests[0].name,'intermittent');assert.deepEqual(r.quarantinedTests,[]);
});
test('valid observations provide exact sample metrics and configurable minimum sizes',()=>{
 const r=detectFlakiness(observations(['passed','failed','passed','passed']),{minSamples:4});assert.equal(r.tests[0].transitions,2);assert.equal(r.tests[0].comparableAdjacentPairs,3);assert.equal(r.tests[0].observedFailureRate,.25);assert.equal(r.tests[0].observedTransitionRate,2/3);assert.equal(r.complete,true);
 const insufficient=detectFlakiness(observations(['passed','failed']),{minSamples:3});assert.equal(insufficient.tests[0].classification,'insufficient-data');assert.equal(insufficient.complete,false);
 assert.equal(detectFlakiness(observations(['passed','failed']),{minSamples:2}).tests[0].classification,'observed-instability');assert.match(formatReport(r),/not proven flakiness/);
});
test('skips, execution errors and missing observations are distinct and break transition adjacency',()=>{
 const r=detectFlakiness(observations(['passed','skipped','failed',undefined,'error','passed']),{minSamples:3});const t=r.tests[0];assert.equal(t.skipped,1);assert.equal(t.errors,1);assert.equal(t.missing,1);assert.equal(t.evaluatedSamples,3);assert.equal(t.transitions,0);assert.equal(t.comparableAdjacentPairs,0);assert.equal(t.observedTransitionRate,null);assert.equal(t.classification,'observed-instability');assert.equal(r.complete,false);
 const errors=detectFlakiness(observations(['passed','passed','passed','error']));assert.equal(errors.tests[0].classification,'execution-errors');
 const allSkipped=detectFlakiness(observations(['skipped','skipped','skipped']));assert.equal(allSkipped.tests[0].classification,'insufficient-data');assert.equal(allSkipped.tests[0].observedFailureRate,null);
});
test('empty, missing and partial runs never establish complete observation coverage',()=>{
 for(const runs of[[],[{id:'run',status:'missing',tests:[]}],[{id:'run',status:'completed',tests:[]}],[{id:'run',status:'partial',tests:[{name:'x',status:'passed'}]}]])assert.equal(detectFlakiness(runs).complete,false);
 assert.equal(detectFlakiness(observations(['passed','passed','passed'])).verificationResult,'not-run');
});
test('duplicates, invalid sample sizes and excessive runs/observations are rejected',()=>{
 for(const minSamples of[0,1,257,1.5,NaN,Infinity])assert.throws(()=>detectFlakiness([],{minSamples}));
 assert.throws(()=>detectFlakiness([{id:'same',status:'completed',tests:[]},{id:'same',status:'completed',tests:[]} ]));
 assert.throws(()=>detectFlakiness([{id:'x',status:'completed',tests:[{name:'same',status:'passed'},{name:'same',status:'failed'}]}]));
 assert.throws(()=>detectFlakiness([{id:'x',status:'missing',tests:[{name:'test',status:'passed'}]}]));
 assert.throws(()=>detectFlakiness([{id:'x',status:'completed',tests:[{name:'test',status:'success'}]}]));
 assert.throws(()=>detectFlakiness(Array.from({length:257},(_,i)=>({id:`${i}`,status:'completed',tests:[]}))));
 assert.throws(()=>detectFlakiness([{id:'x',status:'completed',tests:Array.from({length:10001},(_,i)=>({name:`test-${i}`,status:'passed'}))}]));
});
test('JUnit class and suite identities keep similarly named tests separate',async()=>{
 const root=await fixture({'r.xml':'<testsuites><testsuite name="suite-a"><testcase classname="ClassA" name="same"/><testcase classname="ClassB" name="same"/><testcase name="other"/></testsuite></testsuites>'});
 const r=await analyzeJUnit({root,files:['r.xml']});assert.deepEqual(r.tests.map(t=>t.name).sort(),['ClassA::same','ClassB::same','suite-a::other']);
 await assert.rejects(analyzeJUnit({root,files:['r.xml','r.xml']}));
 await writeFile(join(root,'duplicates.xml'),'<testsuite><testcase name="same"/><testcase name="same"/></testsuite>');await assert.rejects(analyzeJUnit({root,files:['duplicates.xml']}));
});
test('malformed XML, XXE, oversized inputs and missing files produce explicit incomplete reports',async()=>{
 const secret='ghp_'+'K'.repeat(36);const root=await fixture({'valid.xml':'<testsuite tests="1"><testcase name="stable"/></testsuite>','bad.xml':'<testsuite>','xxe.xml':`<!DOCTYPE test [<!ENTITY x SYSTEM "file:///private/${secret}">]><testsuite><testcase name="&x;"/></testsuite>`,'large.xml':'x'.repeat(4*1024*1024+1)});
 const r=await analyzeJUnit({root,files:['valid.xml','bad.xml','xxe.xml','large.xml','missing.xml']});assert.equal(r.complete,false);assert.equal(r.runCount,5);assert.ok(r.runIssues.some(i=>i.code==='INVALID_JUNIT'));assert.ok(r.runIssues.some(i=>i.code==='UNREADABLE_OR_LIMITED_JUNIT'));assert.ok(!JSON.stringify(r).includes(secret));assert.equal(r.tests[0].evaluatedSamples,1);
 await assert.rejects(analyzeJUnit({root,files:['../outside.xml']}));await assert.rejects(analyzeJUnit({root,files:['https://example.invalid/report.xml']}));
 if(process.platform!=='win32'){await symlink(join(root,'valid.xml'),join(root,'link.xml'));const links=await analyzeJUnit({root,files:['link.xml']});assert.equal(links.complete,false);assert.deepEqual(links.tests,[]);}
});
test('credential-bearing test names redacted; raw application logs and environment never copied',async()=>{
 const secret='ghp_'+'L'.repeat(36);const root=await fixture({'r.xml':`<testsuite><testcase name="${secret}"/><system-out>password=synthetic-log-secret</system-out></testsuite>`});process.env.SYNTHETIC_SECRET='never-in-report';
 const r=await analyzeJUnit({root,files:['r.xml']});const text=JSON.stringify(r);assert.ok(!text.includes(secret));assert.ok(!text.includes('synthetic-log-secret'));assert.ok(!text.includes('never-in-report'));delete process.env.SYNTHETIC_SECRET;
 const first='ghp_'+'A'.repeat(36),second='ghp_'+'B'.repeat(36);assert.throws(()=>detectFlakiness([{id:'x',status:'completed',tests:[{name:first,status:'passed'},{name:second,status:'failed'}]}]));
});
test('observation files are bounded and strict',async()=>{
 const root=await fixture({'good.json':JSON.stringify(observations(['passed','passed','passed'])),'bad.json':'invalid'});assert.equal((await analyzeObservationFile(root,'good.json')).complete,true);await assert.rejects(analyzeObservationFile(root,'bad.json'));await assert.rejects(analyzeObservationFile(root,'../secret.json'));
});
test('documentation CLI examples expose instability, gaps and stable observations with correct exit codes',()=>{
 const run=(args)=>execFileSync(process.execPath,['dist/cli.js','--root','examples',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const stable=JSON.parse(run(['--observations','stable-observations.json','--json']));assert.equal(stable.tests[0].classification,'consistent-pass');
 assert.throws(()=>run(['--junit','junit/run-1.xml','--junit','junit/run-2.xml','--junit','junit/run-3.xml','--json','--fail-on-instability']),e=>e.status===1&&JSON.parse(e.stdout).tests[0].classification==='observed-instability');
 assert.throws(()=>run(['--observations','gapped-observations.json','--min-samples','2','--json']),e=>e.status===3&&JSON.parse(e.stdout).tests[0].transitions===0);
 assert.throws(()=>run(['--min-samples','secret-value']),e=>e.status===2&&!e.stderr.includes('secret-value'));
});

import test from 'node:test';import assert from 'node:assert/strict';import{mkdtemp,mkdir,writeFile,readFile,rm,access}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{execFileSync}from'node:child_process';
const run=(args,options={})=>execFileSync(process.execPath,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000,...options});
test('clean install of packed candidate and candidate dependencies executes real JUnit instability analysis',async()=>{
 const npm=process.env.npm_execpath;assert.ok(npm);const root=await mkdtemp(join(tmpdir(),'zof-flaky-pack-'));try{
 const pack=JSON.parse(run([npm,'pack','--ignore-scripts','--json','--pack-destination',root]))[0];assert.ok(pack.files.some(f=>f.path==='dist/index.d.ts'));assert.ok(pack.files.every(f=>!/^src\/|^test\/|\.map$|\.env/.test(f.path)));
 const project=join(root,'clean');await mkdir(project);await writeFile(join(project,'package.json'),'{"private":true,"type":"module"}');
 const artifacts=resolve('../../orchestration/artifacts');const candidates=[];for(const name of['ci-evidence','evidence-spec']){const f=join(artifacts,`zof-ai-${name}-0.1.1.tgz`);try{await access(f);candidates.push(f);}catch{}}
 run([npm,'install','--ignore-scripts','--no-audit','--no-fund',...candidates,join(root,pack.filename)],{cwd:project});
 const output=run(['--input-type=module','-e',"import{analyzeJUnit}from'@zof-ai/flaky-test-detector';console.log(JSON.stringify(await analyzeJUnit({root:'node_modules/@zof-ai/flaky-test-detector/examples/junit',files:['run-1.xml','run-2.xml','run-3.xml']})));"],{cwd:project});assert.equal(JSON.parse(output).tests[0].classification,'observed-instability');
 const pkg=JSON.parse(await readFile(join(project,'node_modules/@zof-ai/flaky-test-detector/package.json'),'utf8'));assert.equal(pkg.dependencies['@zof-ai/ci-evidence'],'0.1.1');assert.equal(pkg.bin['zof-flaky-test-detector'],'./dist/cli.js');
 assert.match(run([npm,'exec','--offline','--','zof-flaky-test-detector','--help'],{cwd:project}),/Usage:/);
 }finally{await rm(root,{recursive:true,force:true});}
});

/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {parseNode}=require('./rule-parser.cjs');
const {parseRaw,immutableWrite,requireText}=require('./build-update.cjs');
const {readTemplates,renderTemplates,verifyRollbacks}=require('./module-snapshots.cjs');
const {sourceSections,parseRuleRow,collectRules,mergeScripts,mergeRewrites,exceptionTree,unionExceptions,renderGuardedRuleSet}=require('./upstream-merge.cjs');

const passed=[];function check(name,run){run();passed.push(name);}

check('Upstream modules accept metadata and retain every selected row',()=>{
  const data=sourceSections('#!name=Sample\n[Rule]\nDOMAIN,one.example,REJECT\n[URL Rewrite]\n^https://ad.example/ - reject\n[Script]\nOne = type=http-response,pattern=^https://api.example/,script-path=https://example.com/a.js\n','sample',['Rule','URL Rewrite','Script']);
  assert.equal(data.Rule.length,1);assert.equal(data['URL Rewrite'].length,1);assert.equal(data.Script.length,1);
});
check('Unexpected upstream sections fail instead of being silently dropped',()=>assert.throws(()=>sourceSections('[Rule]\nDOMAIN,one.example,REJECT\n[New Section]\nx\n','sample',['Rule']),/unsupported section/));
check('AWA rule conversion strips policy and pre-matching for the external list',()=>{
  const row=parseRuleRow('DOMAIN-SUFFIX,ads.example,REJECT,extended-matching,pre-matching','REJECT');
  assert.equal(row.line,'DOMAIN-SUFFIX,ads.example');assert.equal(row.policy,'REJECT');
});
check('Naisi logical rules and reject-drop policy are preserved',()=>{
  const a=parseRuleRow('AND,((DOMAIN,a.example),(NOT,((DOMAIN-SUFFIX,keep.example)))),REJECT-DROP');
  assert.equal(a.policy,'REJECT-DROP');assert.equal(parseNode(a.line).type,'AND');
});
check('New upstream domain entries flow through without an allowlist',()=>{
  const merged=collectRules({awaRows:['DOMAIN-SUFFIX,new-awa.example,REJECT'],naisiModuleRows:['DOMAIN,new-naisi.example,REJECT'],staticRows:['DOMAIN,own.example,DIRECT']});
  assert.ok(merged.awa.some(x=>x.line==='DOMAIN-SUFFIX,new-awa.example'));
  assert.ok(merged.naisi.some(x=>x.line==='DOMAIN,new-naisi.example'));
});
check('Static rules take priority and exact source duplicates are counted once',()=>{
  const merged=collectRules({awaRows:['DOMAIN,own.example,REJECT','DOMAIN,awa.example,REJECT'],naisiModuleRows:['DOMAIN,awa.example,REJECT','DOMAIN,nai.example,REJECT'],staticRows:['DOMAIN,own.example,DIRECT']});
  assert.equal(merged.awa.length,1);assert.equal(merged.naisi.length,1);assert.equal(merged.dedup.static,1);assert.equal(merged.dedup.crossSource,1);
});
check('Conflicting reject and reject-drop rules fail closed',()=>assert.throws(()=>collectRules({awaRows:[],naisiModuleRows:['DOMAIN,collision.example,REJECT','DOMAIN,collision.example,REJECT-DROP'],staticRows:[]}),/Conflicting Naisi REJECT and REJECT-DROP/));
check('Surge reject placeholders normalize for rewrite deduplication',()=>{
  assert.equal(mergeRewrites(['^https://ad.example/ _ reject'],['^https://ad.example/ - reject']).rows.length,1);
});
check('All distinct upstream rewrites are merged and duplicate actions appear once',()=>{
  const merged=mergeRewrites(['^https://own.example/ _ reject'],['^https://new.example/ - reject','^https://new.example/ - reject']);
  assert.equal(merged.rows.length,2);assert.equal(merged.importedCount,1);
});
check('Self-maintained scripts keep priority while new upstream patterns are imported',()=>{
  const own='Own = type=http-response,pattern=^https://same.example/,script-path=https://example.com/own.js,timeout=5';
  const upstreamSame='Upstream = type=http-response,pattern=^https://same.example/,script-path=https://example.com/up.js,timeout=60';
  const upstreamNew='New = type=http-response,pattern=^https://new.example/,script-path=https://example.com/new.js';
  const merged=mergeScripts([own],[upstreamSame,upstreamNew]);
  assert.equal(merged.rows.length,2);assert.ok(merged.rows[0]===own);assert.match(merged.rows[1],/^Naisi-New-[a-f0-9]{8} = /);
  assert.equal(merged.deduplicated[0].kind,'self-maintained-script-priority');
});
check('Duplicate upstream script match patterns keep the first executable row',()=>{
  const first='First = type=http-response,pattern=^https://same.example/,script-path=https://example.com/a.js';
  const second='Second = type=http-response,pattern=^https://same.example/,script-path=https://example.com/b.js';
  const merged=mergeScripts([],[first,second]);assert.equal(merged.importedCount,1);assert.equal(merged.deduplicated.length,1);
});
check('Compatibility wrappers carry the exact exception union and manual update interval',()=>{
  const baseline=fs.readFileSync(path.join(__dirname,'baseline','AdBlock-AllInOne.sgmodule'),'utf8');
  const nai=baseline.split(/\r?\n/).find(row=>row.includes('/Surge/module/blockAds.module'));
  const awa=baseline.split(/\r?\n/).find(row=>row.includes('AWAvenue-Ads-Rule-Surge-RULE-SET-Only.Ads.list'));
  const exceptions=unionExceptions(exceptionTree(nai,'/Surge/module/blockAds.module'),exceptionTree(awa,'AWAvenue-Ads-Rule'));
  const output=renderGuardedRuleSet('https://example.com/resources.list',exceptions,'REJECT');
  assert.equal(parseNode(output.slice(0,output.lastIndexOf(',REJECT'))).type,'AND');assert.ok(output.includes('update-interval=-1'));assert.ok(output.includes('DOMAIN,api-access.pangolin-sdk-toutiao.com'));assert.ok(output.includes('DOMAIN,ad.12306.cn'));assert.ok(exceptions.length>100);
  assert.doesNotMatch(baseline,/Loon\/rule\/rejectAd\.list/);
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8')).sources.naisi,'ruleList'),false);
});
check('GitHub branch, refs/heads and github.com raw paths normalize to Git repositories',()=>{
  assert.deepEqual(parseRaw('https://raw.githubusercontent.com/owner/repo/refs/heads/main/a.js'),parseRaw('https://raw.githubusercontent.com/owner/repo/main/a.js'));
  assert.equal(parseRaw('https://github.com/owner/repo/raw/main/a.js').rawURL,'https://raw.githubusercontent.com/owner/repo/main/a.js');
});
check('HTML and redirects are rejected as source data',()=>{
  assert.throws(()=>requireText({buffer:Buffer.from('<html>'),contentType:'text/html',finalURL:'https://example.com/x'},'https://example.com/x'));
  assert.throws(()=>requireText({buffer:Buffer.from('public'),contentType:'text/plain',finalURL:'https://example.com/'},'https://example.com/x'));
});
check('Immutable resource names cannot be overwritten',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'surge-immutable-'));immutableWrite(directory,'sample.list',Buffer.from('first'));
  assert.throws(()=>immutableWrite(directory,'sample.list',Buffer.from('second')),/Immutable/);
  assert.equal(fs.readFileSync(path.join(directory,'Resources/AdBlock/sample.list'),'utf8'),'first');
});
check('Maintenance templates must exist and cover every root module',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'surge-template-'));assert.throws(()=>readTemplates(directory),/Missing/);
  fs.mkdirSync(path.join(directory,'.adblock/modules'),{recursive:true});assert.throws(()=>readTemplates(directory),/Empty/);
  const text='#!name=Test\n[Map Local]\n^https://ad.example.com/ data-type=text data="{}"\n';
  fs.writeFileSync(path.join(directory,'.adblock/modules/known.sgmodule'),text);assert.equal(readTemplates(directory).length,1);
  fs.writeFileSync(path.join(directory,'missing.sgmodule'),text);assert.throws(()=>readTemplates(directory),/no maintenance template/);
});
check('Standalone script rendering preserves arguments and emits the final version',()=>{
  const text='#!name=Legacy\n[Script]\nclean = type=http-response,pattern=^https://ad.example.com/,script-path=https://example.com/source.js,requires-body=true,argument="{\\"enabled\\":false}"\n';
  const rendered=renderTemplates([{name:'legacy.js',text}],new Map([['https://example.com/source.js','https://example.com/fixed.js']]),'6.6.0-manual.test')[0];
  assert.ok(rendered.text.startsWith('#!version=6.6.0-manual.test\n'));assert.ok(rendered.text.includes('argument="{\\"enabled\\":false}"'));assert.ok(rendered.text.includes('script-path=https://example.com/fixed.js'));
});
check('Rollback snapshots are checked without overwriting corrupted data',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'surge-rollback-'));fs.mkdirSync(path.join(directory,'Rollback/6.4.0'),{recursive:true});
  const digest=require('node:crypto').createHash('sha256').update('original').digest('hex');
  for(const file of ['AdBlock-AllInOne.sgmodule','AdBlock-AppClean-V5.txt'])fs.writeFileSync(path.join(directory,'Rollback/6.4.0',file),'original');
  const records=[{version:'6.4.0',moduleSHA256:digest,sharedSHA256:digest}];verifyRollbacks(directory,records);
  const module=path.join(directory,'Rollback/6.4.0/AdBlock-AllInOne.sgmodule');fs.writeFileSync(module,'changed');
  assert.throws(()=>verifyRollbacks(directory,records),/Rollback integrity/);assert.equal(fs.readFileSync(module,'utf8'),'changed');
});

console.log(JSON.stringify({passed:true,checks:passed.length,names:passed}));

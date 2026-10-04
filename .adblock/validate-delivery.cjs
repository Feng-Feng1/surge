/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),vm=require('node:vm');
const {parseNode}=require('./build-protection.cjs');
const {sourceURLs,parseRaw}=require('./build-update.cjs');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function rows(text,section) {
  const match=text.match(new RegExp('\\['+section.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\]\\r?\\n([\\s\\S]*?)(?=\\n\\[|$)'));
  if(!match)throw Error('Missing section '+section);
  return match[1].split(/\r?\n/).filter(x=>x.trim()&&!x.startsWith('#'));
}
function validate(root=path.resolve(__dirname,'..')) {
  const cfg=JSON.parse(fs.readFileSync(path.join(root,'.adblock','config.json'),'utf8'));
  const baseline=fs.readFileSync(path.join(root,'.adblock','baseline','AdBlock-AllInOne.sgmodule'),'utf8').replace(/\r\n/g,'\n');
  const moduleText=fs.readFileSync(path.join(root,'AdBlock-AllInOne.sgmodule'),'utf8');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'AdBlock-AdGuard-Update.json'),'utf8'));
  assert.equal(sha(moduleText),manifest.moduleSHA256);
  assert.equal(sha(fs.readFileSync(path.join(root,'.adblock','build-update.cjs'))),manifest.builderSHA256);
  assert.equal(sha(fs.readFileSync(path.join(root,'AdBlock-AppClean-V5.txt'))),cfg.baselineSharedSHA256);
  new vm.Script(fs.readFileSync(path.join(root,'AdBlock-AppClean-V5.txt'),'utf8'));
  for(const name of ['URL Rewrite','Body Rewrite','Map Local','MITM'])assert.deepEqual(rows(moduleText,name),rows(baseline,name),name);
  let restored=moduleText;
  for(const record of manifest.sourceRecords){assert.match(parseRaw(record.pinnedURL).ref,/^[a-f0-9]{40}$/);restored=restored.replaceAll(record.pinnedURL,record.sourceURL);}
  const shared=manifest.resources.find(x=>x.kind==='shared');
  const sharedRuntime=sourceURLs(moduleText).scripts.find(x=>x.endsWith('/'+shared.name));
  assert.ok(sharedRuntime);
  const oldShared=sourceURLs(baseline).scripts.find(x=>parseRaw(x).file==='AdBlock-AppClean-V5.txt');
  restored=restored.replaceAll(sharedRuntime,oldShared);
  assert.deepEqual(rows(restored,'Script'),rows(baseline,'Script'));
  const ruleRows=rows(moduleText,'Rule'),adguard=ruleRows.filter(x=>x.includes('/Resources/AdBlock/')&&x.startsWith('AND,'));
  assert.equal(adguard.length,1);
  assert.equal(ruleRows.length,rows(baseline,'Rule').length+1);
  const originalRules=rows(restored,'Rule').filter(x=>x!==adguard[0]).map(x=>x.replaceAll('update-interval=-1','update-interval=86400'));
  assert.deepEqual(originalRules,rows(baseline,'Rule'));
  const tree=parseNode(adguard[0].slice(0,-',REJECT'.length));
  assert.equal(tree.type,'AND');assert.equal(tree.children.length,3);
  assert.equal(tree.children[0].type,'DOMAIN-SET');
  for(const child of tree.children.slice(1)){assert.equal(child.type,'NOT');assert.equal(child.children[0].type,'RULE-SET');}
  for(const resource of manifest.resources) {
    assert.match(resource.name,/^[a-f0-9]{64}\.(?:txt|list|domain-set)$/);
    const bytes=fs.readFileSync(path.join(root,'Resources','AdBlock',resource.name));
    assert.equal(sha(bytes),resource.sha256);assert.ok(resource.name.startsWith(resource.sha256));assert.equal(bytes.length,resource.bytes);
  }
  const rawSource=manifest.resources.find(x=>x.kind==='adguard-input');
  assert.ok(rawSource);assert.equal(rawSource.sha256,manifest.dnsSourceSHA256);
  const blockFile=manifest.resources.find(x=>x.kind==='domains'),exceptionFile=manifest.resources.find(x=>x.kind==='exceptions'),protectFile=manifest.resources.find(x=>x.kind==='compatibility');
  for(const [child,resource] of [[tree.children[0],blockFile],[tree.children[1].children[0],exceptionFile],[tree.children[2].children[0],protectFile]]) {assert.ok(child.value.endsWith('/'+resource.name));assert.ok(child.parameters.includes('update-interval=-1'));}
  const domainEntries=fs.readFileSync(path.join(root,'Resources','AdBlock',blockFile.name),'utf8').split('\n').filter(x=>x&&!x.startsWith('#'));
  assert.equal(domainEntries.length,manifest.convertedDomainEntries);
  const exceptionRows=fs.readFileSync(path.join(root,'Resources','AdBlock',exceptionFile.name),'utf8').split('\n').filter(x=>x&&!x.startsWith('#'));
  assert.equal(exceptionRows.length,manifest.exceptionRows);assert.ok(exceptionRows.every(x=>/^(?:DOMAIN|DOMAIN-SUFFIX|DOMAIN-WILDCARD),/.test(x)&&!x.includes(',DIRECT')));
  assert.equal(sha(fs.readFileSync(path.join(root,'Rollback','6.3.1','AdBlock-AllInOne.sgmodule'))),cfg.baselineModuleSHA256);
  assert.equal(sha(fs.readFileSync(path.join(root,'Rollback','6.3.1','AdBlock-AppClean-V5.txt'))),cfg.baselineSharedSHA256);
  return {passed:true,version:manifest.version,domains:manifest.convertedDomainEntries,exceptions:manifest.exceptionRows,protected:manifest.protectionRows,pinnedSources:manifest.sourceRecords.length,scriptBindings:rows(moduleText,'Script').length,mainRules:ruleRows.length,sourceFreezing:true,coreUnchanged:true,noGlobalDirectFromAdGuard:true,rollbackExact:true};
}
module.exports={validate,rows};
if(require.main===module) {try{console.log(JSON.stringify(validate(process.argv[2]&&path.resolve(process.argv[2]))));}catch(e){console.error('Delivery validation failed: '+e.message);process.exitCode=1;}}

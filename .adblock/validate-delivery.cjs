/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {parseNode}=require('./rule-parser.cjs');
const {sourceURLs,parseRaw}=require('./build-update.cjs');
const {readTemplates,renderTemplates,verifyRollbacks}=require('./module-snapshots.cjs');
const {canonicalNode,normalizeNode}=require('./upstream-merge.cjs');
const {parseScriptRow,scriptPatternKey}=require('./upstream-merge.cjs');

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function rows(text,section) {
  const match=text.match(new RegExp('\\['+section.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\]\\r?\\n([\\s\\S]*?)(?=\\n\\[|$)'));
  if(!match)throw Error('Missing section '+section);
  return match[1].split(/\r?\n/).map(value=>value.trim()).filter(value=>value&&!/^(?:#|;|\/\/)/.test(value));
}

function validate(root=path.resolve(__dirname,'..')) {
  const cfg=JSON.parse(fs.readFileSync(path.join(root,'.adblock','config.json'),'utf8'));
  const baseline=fs.readFileSync(path.join(root,'.adblock','baseline','AdBlock-AllInOne.sgmodule'),'utf8').replace(/\r\n/g,'\n');
  const moduleText=fs.readFileSync(path.join(root,'AdBlock-AllInOne.sgmodule'),'utf8');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'AdBlock-Update.json'),'utf8'));
  assert.equal(sha(moduleText),manifest.moduleSHA256);
  assert.equal(sha(fs.readFileSync(path.join(root,'.adblock','build-update.cjs'))),manifest.builderSHA256);
  assert.equal(sha(fs.readFileSync(path.join(root,'.adblock','upstream-merge.cjs'))),manifest.mergerSHA256);
  assert.equal(sha(fs.readFileSync(path.join(root,'.adblock','rule-parser.cjs'))),manifest.parserSHA256);
  assert.equal(sha(baseline),cfg.baselineModuleSHA256);
  assert.equal(sha(fs.readFileSync(path.join(root,'AdBlock-AppClean-V5.txt'))),cfg.baselineSharedSHA256);
  assert.doesNotMatch(moduleText,/AdGuard|Adguard|可莉|kelee\.one|LiveMerge/i);

  const expectedLabels=['AWAvenue Surge module','Naisi Surge module'];
  for(const label of expectedLabels) {
    const source=manifest.sourceRecords.find(row=>row.label===label);
    assert.ok(source,'Missing upstream source '+label);assert.match(parseRaw(source.pinnedURL).ref,/^[a-f0-9]{40}$/);
    assert.match(source.sha256,/^[a-f0-9]{64}$/);assert.ok(source.bytes>1000);
  }
  assert.equal(manifest.sourceRecords.filter(row=>row.label?.startsWith('Naisi')).length,1);
  assert.ok(manifest.sourceRecords.some(row=>row.label==='Naisi Surge module'&&row.pinnedURL.includes('/Surge/module/blockAds.module')));
  assert.doesNotMatch(JSON.stringify(manifest),/rejectAd\.list|Loon\/rule/);
  assert.ok(manifest.sourcePolicy.includes('All rows'));
  assert.equal(manifest.manualApplication,true);assert.equal(manifest.ruleUpdateInterval,-1);
  assert.equal(manifest.upstreamRows.awaRules>0,true);assert.equal(manifest.upstreamRows.naisiURLRewrites>0,true);assert.equal(manifest.upstreamRows.naisiScripts>0,true);

  const ruleRows=rows(moduleText,'Rule');
  const rulesetRules=ruleRows.filter(row=>row.startsWith('AND,')&&row.includes('RULE-SET,https://raw.githubusercontent.com/')&&row.includes('/Resources/AdBlock/'));
  assert.equal(rulesetRules.length,manifest.mergedRows.naisiDropRules?3:2);
  assert.ok(rulesetRules.some(row=>row.endsWith(',REJECT,pre-matching')));
  assert.ok(rulesetRules.some(row=>row.endsWith(',REJECT')));
  if(manifest.mergedRows.naisiDropRules)assert.ok(rulesetRules.some(row=>row.endsWith(',REJECT-DROP')));
  assert.ok(rulesetRules.every(row=>row.includes('update-interval=-1')));
  for(const rule of rulesetRules)assert.equal(parseNode(rule.slice(0,rule.lastIndexOf(',REJECT'))).type,'AND');

  const resourceByKind=new Map();
  for(const resource of manifest.resources) {
    assert.match(resource.name,/^[a-f0-9]{64}\.(?:txt|list)$/);assert.ok(resource.name.startsWith(resource.sha256));
    const bytes=fs.readFileSync(path.join(root,'Resources','AdBlock',resource.name));
    assert.equal(sha(bytes),resource.sha256);assert.equal(bytes.length,resource.bytes);resourceByKind.set(resource.kind,resource);
  }
  for(const kind of ['awa-rules','naisi-rules','shared'])assert.ok(resourceByKind.has(kind),'Missing resource '+kind);
  if(manifest.mergedRows.naisiDropRules)assert.ok(resourceByKind.has('naisi-drop-rules'));
  const ruleResources=['awa-rules','naisi-rules',...(manifest.mergedRows.naisiDropRules?['naisi-drop-rules']:[])];
  for(const kind of ruleResources) {
    const resource=resourceByKind.get(kind),content=fs.readFileSync(path.join(root,'Resources','AdBlock',resource.name),'utf8');
    const entries=content.split(/\r?\n/).map(value=>value.trim()).filter(value=>value&&!/^(?:#|;|\/\/)/.test(value));
    const keys=new Set();
    for(const entry of entries) {
      assert.doesNotMatch(entry,/\bpre-matching\b|,(?:REJECT|REJECT-DROP|DIRECT)(?:,|$)/i);
      const key=canonicalNode(normalizeNode(parseNode(entry),kind));assert.ok(!keys.has(key),'Duplicate rule in '+kind+': '+entry);keys.add(key);
    }
  }
  for(const kind of ruleResources)assert.ok(rulesetRules.some(row=>row.includes('/'+resourceByKind.get(kind).name)),'Rule set not referenced: '+kind);

  assert.equal(rows(moduleText,'URL Rewrite').length,manifest.mergedRows.urlRewrites);
  assert.equal(rows(moduleText,'Script').length,manifest.mergedRows.scripts);
  const scriptPatterns=new Set();
  for(const row of rows(moduleText,'Script')) {
    const key=scriptPatternKey(parseScriptRow(row,'delivery validation'));
    if(scriptPatterns.has(key))throw Error('Duplicate script match pattern: '+key);scriptPatterns.add(key);
  }
  for(const record of manifest.sourceRecords.filter(row=>row.kind==='script'))assert.match(parseRaw(record.pinnedURL).ref,/^[a-f0-9]{40}$/);

  const templates=readTemplates(root);
  const replacements=new Map();
  for(const record of manifest.sourceRecords)if(record.sourceURL&&record.pinnedURL)replacements.set(record.sourceURL,record.pinnedURL);
  for(const item of manifest.releaseReferences||[])replacements.set(item.url,item.url);
  const shared=resourceByKind.get('shared');
  const sharedURL=sourceURLs(moduleText).scripts.find(url=>url.endsWith('/'+shared.name));assert.ok(sharedURL);
  for(const item of templates)for(const url of sourceURLs(item.text).scripts) {
    try{const parsed=parseRaw(url);if(parsed.owner.toLowerCase()===cfg.repository.split('/')[0].toLowerCase()&&parsed.repo.toLowerCase()==='surge'&&parsed.file==='AdBlock-AppClean-V5.txt')replacements.set(url,sharedURL);}catch{}
  }
  const standalone=renderTemplates(templates,replacements,manifest.version);
  const rootModules=fs.readdirSync(root).filter(name=>name.endsWith('.sgmodule')||(name.endsWith('.js')&&/^#!name\s*=/m.test(fs.readFileSync(path.join(root,name),'utf8')))).filter(name=>name!=='AdBlock-AllInOne.sgmodule').sort();
  assert.deepEqual(rootModules,standalone.map(item=>item.name).sort());
  assert.deepEqual(manifest.moduleSnapshots,standalone.map(({name,sha256})=>({name,sha256})));
  for(const item of standalone)assert.equal(fs.readFileSync(path.join(root,item.name),'utf8'),item.text);
  verifyRollbacks(root,cfg.rollbackSnapshots);assert.deepEqual(manifest.rollbackSnapshots,cfg.rollbackSnapshots);
  assert.equal(manifest.preparedFrom,cfg.baselineVersion);
  return {passed:true,version:manifest.version,awaRules:manifest.mergedRows.awaRules,naisiRules:manifest.mergedRows.naisiRules,naisiDropRules:manifest.mergedRows.naisiDropRules,urlRewrites:manifest.mergedRows.urlRewrites,scripts:manifest.mergedRows.scripts,deduplicated:manifest.deduplicated,sourceCommits:expectedLabels.length,manualApplication:true,rollbackExact:true,noAdGuardOrKeliInActiveModule:true};
}

module.exports={validate,rows};
if(require.main===module){try{console.log(JSON.stringify(validate(process.argv[2]&&path.resolve(process.argv[2]))));}catch(error){console.error('Delivery validation failed: '+error.message);process.exitCode=1;}}

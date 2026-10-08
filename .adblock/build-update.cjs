/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const {parseNode,splitTopLevel}=require('./rule-parser.cjs');
const {sourceSections,collectRules,mergeScripts,mergeRewrites,exceptionTree,unionExceptions,renderGuardedRuleSet,renderRuleFile}=require('./upstream-merge.cjs');
const {readTemplates,renderTemplates,verifyRollbacks}=require('./module-snapshots.cjs');

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));

function sourceURLs(moduleText) {
  return {
    scripts:[...new Set([...moduleText.matchAll(/script-path=([^,\r\n]+)/g)].map(x=>x[1]))],
    rules:[...new Set([...moduleText.matchAll(/RULE-SET,([^,)]+)/g)].map(x=>x[1]))]
  };
}

function parseRaw(url) {
  const value=new URL(url);if(value.protocol!=='https:'||value.username||value.password)throw Error('Unsupported source URL');
  const parts=value.pathname.split('/').filter(Boolean);let owner,repository,ref,files;
  if(value.hostname==='raw.githubusercontent.com') {
    if(parts.length<4)throw Error('Invalid raw GitHub path');
    [owner,repository]=parts;ref=parts[2]==='refs'&&parts[3]==='heads'?parts[4]:parts[2];
    files=parts.slice(parts[2]==='refs'&&parts[3]==='heads'?5:3);
  } else if(value.hostname==='github.com'&&parts.length>=5&&parts[2]==='raw') {
    [owner,repository]=parts;ref=parts[3]==='refs'&&parts[4]==='heads'?parts[5]:parts[3];
    files=parts.slice(parts[3]==='refs'&&parts[4]==='heads'?6:4);
  } else throw Error('Unsupported source host');
  const file=files.join('/');
  if(!file||!/^[-\w.]+$/.test(owner)||!/^[-\w.]+$/.test(repository)||!/^[-\w.]+$/.test(ref||''))throw Error('Invalid GitHub source reference');
  return {owner,repo:repository,ref,file,key:owner+'/'+repository+'/'+ref,rawURL:'https://raw.githubusercontent.com/'+owner+'/'+repository+'/'+ref+'/'+file};
}

async function download(url,maxBytes,token) {
  const headers={'User-Agent':'Surge-AdBlock-Verified-Builder/6.6','Accept':'*/*'};
  if(token)headers.Authorization='Bearer '+token;
  let response,lastError;
  for(let attempt=0;attempt<4;attempt++) {
    try {
      response=await fetch(url,{headers,signal:AbortSignal.timeout(60000)});
      if(response.ok)break;
      const transient=response.status===429||response.status>=500;
      if(!transient||attempt===3)throw Error('Source download failed: HTTP '+response.status+' '+url);
      await response.body?.cancel();lastError=Error('HTTP '+response.status);
    } catch(error) {
      if(error.message.startsWith('Source download failed: HTTP '))throw error;
      lastError=error.cause?.message||error.message;
      if(attempt===3)throw Error('Fetch failed after 4 attempts for '+url+': '+lastError);
    }
    await new Promise(resolve=>setTimeout(resolve,250*(2**attempt)));
  }
  if(Number(response.headers.get('content-length'))>maxBytes)throw Error('Source exceeds download limit: '+url);
  const buffer=Buffer.from(await response.arrayBuffer());
  if(!buffer.length||buffer.length>maxBytes)throw Error('Empty or oversized source: '+url);
  return {buffer,contentType:response.headers.get('content-type')||'',finalURL:response.url,sha256:sha(buffer)};
}

function requireText(record,url) {
  if(/html/i.test(record.contentType)||/^\s*(?:<!doctype|<html)/i.test(record.buffer.toString('utf8').slice(0,300)))throw Error('HTML is not a filtering resource: '+url);
  if(record.finalURL&&record.finalURL!==url)throw Error('Unexpected source redirect: '+url);
  return record.buffer.toString('utf8').replace(/^\uFEFF/,'');
}

function getSectionRows(text,name) {
  let current='';const rows=[];let matches=0;
  for(const raw of text.replace(/^\uFEFF/,'').split(/\r?\n/)) {
    const line=raw.trim(),heading=/^\[([^\]]+)\]$/.exec(line);
    if(heading){current=heading[1];if(current===name)matches++;continue;}
    if(current===name&&line&&!/^(?:#|;|\/\/)/.test(line))rows.push(line);
  }
  if(matches!==1)throw Error('Expected exactly one ['+name+'] section');
  return rows;
}

function replaceSection(text,name,rows,nextName) {
  const heading='['+name+']',start=text.indexOf(heading+'\n');
  if(start<0)throw Error('Missing ['+name+'] in maintenance baseline');
  const contentStart=start+heading.length+1;const end=nextName?text.indexOf('\n['+nextName+']',contentStart):-1;
  if(nextName&&end<0)throw Error('Missing ['+nextName+'] after ['+name+']');
  const stop=end<0?text.length:end;
  return text.slice(0,contentStart)+rows.join('\n')+'\n'+text.slice(stop);
}

function parseList(text,label) {
  const rows=text.replace(/^\uFEFF/,'').split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!/^(?:#|;|\/\/)/.test(line));
  if(rows.length<500)throw Error(label+': unexpectedly short source list ('+rows.length+')');
  return rows;
}

function immutableWrite(root,name,bytes) {
  const file=path.join(root,'Resources','AdBlock',name);
  if(fs.existsSync(file)&&!fs.readFileSync(file).equals(bytes))throw Error('Immutable resource name already contains different bytes');
  fs.mkdirSync(path.dirname(file),{recursive:true});if(!fs.existsSync(file))fs.writeFileSync(file,bytes);
}

async function mapLimit(values,limit,worker) {
  const result=new Array(values.length);let cursor=0;
  async function run(){while(true){const index=cursor++;if(index>=values.length)return;result[index]=await worker(values[index],index);}}
  await Promise.all(Array.from({length:Math.min(limit,values.length)},run));return result;
}

async function build(options={}) {
  const root=options.root||path.resolve(__dirname,'..');const cfg=readJson(path.join(root,'.adblock','config.json'));
  const baselineBytes=fs.readFileSync(path.join(root,'.adblock','baseline','AdBlock-AllInOne.sgmodule'));
  const sharedBytes=fs.readFileSync(path.join(root,'.adblock','baseline','AdBlock-AppClean-V5.txt'));
  if(sha(baselineBytes)!==cfg.baselineModuleSHA256||sha(sharedBytes)!==cfg.baselineSharedSHA256)throw Error('Maintenance baseline verification failed');
  verifyRollbacks(root,cfg.rollbackSnapshots);
  const baseline=baselineBytes.toString('utf8').replace(/\r\n/g,'\n');
  const templates=readTemplates(root);const repo=options.repository||process.env.GITHUB_REPOSITORY||cfg.repository;
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo))throw Error('Invalid destination repository');
  const owner=repo.split('/')[0],snapshot=options.snapshot?readJson(options.snapshot):null,snapshotDir=options.snapshot&&path.dirname(path.resolve(options.snapshot));
  const commitCache=new Map(),sourceRecords=[],resources=[];

  async function fetchBytes(url,limit) {
    if(snapshot){const record=snapshot.sources.find(item=>item.url===url);if(!record)throw Error('Offline source is missing: '+url);const buffer=fs.readFileSync(path.resolve(snapshotDir,record.file));if(sha(buffer)!==record.sha256||buffer.length>limit)throw Error('Offline source hash/size failure: '+url);return {buffer,contentType:record.contentType||'',finalURL:record.finalURL||url,sha256:sha(buffer)};}
    return download(url,limit,process.env.GITHUB_TOKEN);
  }

  async function pin(url) {
    const parsed=parseRaw(url);let commit=commitCache.get(parsed.key);
    if(!commit) {
      const pending=(async()=>{
        if(/^[a-f0-9]{40}$/.test(parsed.ref))return parsed.ref;
        if(snapshot){const value=snapshot.commits[parsed.key];if(!value)throw Error('Offline snapshot lacks commit '+parsed.key);return value;}
        const api='https://api.github.com/repos/'+parsed.owner+'/'+parsed.repo+'/commits/'+encodeURIComponent(parsed.ref);
        const response=await download(api,2000000,process.env.GITHUB_TOKEN);return JSON.parse(response.buffer.toString('utf8')).sha;
      })();
      commitCache.set(parsed.key,pending);commit=await pending;
    } else if(commit&&typeof commit.then==='function')commit=await commit;
    if(!/^[a-f0-9]{40}$/.test(commit||''))throw Error('No verified Git commit for '+parsed.key);
    commitCache.set(parsed.key,commit);
    return {...parsed,commit,pinnedURL:'https://raw.githubusercontent.com/'+parsed.owner+'/'+parsed.repo+'/'+commit+'/'+parsed.file};
  }

  async function getUpstream(url,limit,label) {
    const pinned=await pin(url),record=await fetchBytes(pinned.pinnedURL,limit),text=requireText(record,pinned.pinnedURL);
    const source={label,url,pinnedURL:pinned.pinnedURL,commit:pinned.commit,sha256:record.sha256,bytes:record.buffer.length};
    sourceRecords.push(source);return {text,source};
  }

  const awaSource=await getUpstream(cfg.sources.awa.url,2000000,'AWAvenue Surge module');
  const naisiModuleSource=await getUpstream(cfg.sources.naisi.module,12000000,'Naisi Surge module');
  const naisiListSource=await getUpstream(cfg.sources.naisi.ruleList,5000000,'Naisi rejectAd list');
  const awaSections=sourceSections(awaSource.text,'AWAvenue',cfg.sources.awa.allowedSections);
  const naisiSections=sourceSections(naisiModuleSource.text,'Naisi',cfg.sources.naisi.allowedSections);
  const awaRows=awaSections.Rule;if(awaRows.length<100)throw Error('AWAvenue [Rule] section is unexpectedly short');
  for(const name of ['Rule','URL Rewrite','Script'])if(naisiSections[name].length<cfg.sources.naisi.minimumRows[name])throw Error('Naisi ['+name+'] section is unexpectedly short');
  const naisiListRows=parseList(naisiListSource.text,'Naisi rejectAd.list');

  const baseRuleRows=getSectionRows(baseline,'Rule');
  const naisiWrapper=baseRuleRows.find(row=>row.includes('/Loon/rule/rejectAd.list'));
  const awaWrapper=baseRuleRows.find(row=>row.includes('AWAvenue-Ads-Rule-Surge-RULE-SET-Only.Ads.list'));
  if(!naisiWrapper||!awaWrapper)throw Error('Maintenance baseline lost an upstream compatibility wrapper');
  const staticRuleRows=baseRuleRows.filter(row=>row!==naisiWrapper&&row!==awaWrapper);
  const mergedRules=collectRules({awaRows,naisiModuleRows:naisiSections.Rule,naisiListRows,staticRows:staticRuleRows});
  if(!mergedRules.awa.length||!mergedRules.naisi.length)throw Error('Merged upstream block sets are unexpectedly empty');
  const exceptions=unionExceptions(exceptionTree(naisiWrapper,'/Loon/rule/rejectAd.list'),exceptionTree(awaWrapper,'AWAvenue-Ads-Rule-Surge-RULE-SET-Only.Ads.list'));

  const awaBytes=renderRuleFile(awaSource.source.pinnedURL,mergedRules.awa);
  const naisiBytes=renderRuleFile(naisiModuleSource.source.pinnedURL+' + '+naisiListSource.source.pinnedURL,mergedRules.naisi);
  const dropBytes=mergedRules.naisiDrop.length?renderRuleFile(naisiModuleSource.source.pinnedURL,mergedRules.naisiDrop):null;
  for(const item of [
    {kind:'awa-rules',bytes:awaBytes,extension:'list'},
    {kind:'naisi-rules',bytes:naisiBytes,extension:'list'},
    ...(dropBytes?[{kind:'naisi-drop-rules',bytes:dropBytes,extension:'list'}]:[]),
    {kind:'shared',bytes:sharedBytes,extension:'txt'}
  ])resources.push({...item,sha256:sha(item.bytes),name:sha(item.bytes)+'.'+item.extension});
  const resourceURL=kind=>'https://raw.githubusercontent.com/'+repo+'/'+cfg.branch+'/Resources/AdBlock/'+resources.find(item=>item.kind===kind).name;

  let moduleText=baseline;
  const ruleEnd=moduleText.indexOf('\n[URL Rewrite]');if(ruleEnd<0)throw Error('Missing [URL Rewrite] boundary');
  const rulePrefix=moduleText.slice(0,ruleEnd);
  const naisiLine=renderGuardedRuleSet(resourceURL('naisi-rules'),exceptions,'REJECT');
  const dropLine=dropBytes?renderGuardedRuleSet(resourceURL('naisi-drop-rules'),exceptions,'REJECT-DROP'):'';
  const awaLine=renderGuardedRuleSet(resourceURL('awa-rules'),exceptions,'REJECT',true);
  if(rulePrefix.split(naisiWrapper).length!==2||rulePrefix.split(awaWrapper).length!==2)throw Error('Compatibility wrapper marker is ambiguous');
  moduleText=moduleText.replace(naisiWrapper,'# Naisi rules: full source sections, exact duplicates removed.\n'+naisiLine+(dropLine?'\n'+dropLine:''));
  moduleText=moduleText.replace(awaWrapper,'# AWAvenue rules: the full [Rule] section, in pre-matching priority.\n'+awaLine);
  if(/AdGuard|Adguard|可莉|kelee\.one|LiveMerge/i.test(moduleText))throw Error('Removed source unexpectedly remains in the main module baseline');

  const baseRewrites=getSectionRows(moduleText,'URL Rewrite');
  const rewrites=mergeRewrites(baseRewrites,naisiSections['URL Rewrite']);
  moduleText=replaceSection(moduleText,'URL Rewrite',['# Self-maintained and Naisi URL Rewrite rules; duplicate match/action pairs appear once.',...rewrites.rows],'Body Rewrite');
  const baseScripts=getSectionRows(moduleText,'Script');
  const scripts=mergeScripts(baseScripts,naisiSections.Script);
  moduleText=replaceSection(moduleText,'Script',['# Self-maintained and Naisi scripts; one matching script per request, duplicate patterns appear once.',...scripts.rows],'MITM');

  const releaseReferences=[],replacements=new Map(),localScripts=new Map();
  const allModuleTexts=[moduleText,...templates.map(item=>item.text)];
  const allURLs={scripts:[...new Set(allModuleTexts.flatMap(item=>sourceURLs(item).scripts))]};
  const sharedURLs=allURLs.scripts.filter(url=>{
    try{const parsed=parseRaw(url);return parsed.owner.toLowerCase()===owner.toLowerCase()&&parsed.repo.toLowerCase()==='surge'&&parsed.file==='AdBlock-AppClean-V5.txt';}catch{return false;}
  });
  for(const url of sharedURLs)replacements.set(url,resourceURL('shared'));
  const upstreamScripts=allURLs.scripts.filter(url=>!sharedURLs.includes(url));
  const scriptSources=await mapLimit(upstreamScripts,8,async sourceURL=>{
    const releaseURL=new URL(sourceURL);
    if(releaseURL.protocol==='https:'&&releaseURL.hostname==='github.com'&&/^\/[\w.-]+\/[\w.-]+\/releases\/download\/v\d+\.\d+\.\d+[\w.-]*\/[^/]+\.js$/.test(releaseURL.pathname)) {
      replacements.set(sourceURL,sourceURL);releaseReferences.push({url:sourceURL,pinType:'release-version',deviceVerified:false});return;
    }
    const pinned=await pin(sourceURL),record=await fetchBytes(pinned.pinnedURL,10000000),text=requireText(record,pinned.pinnedURL);
    // Surge executes script resources in a callback-like context. Wrapping the
    // source permits top-level return and await used by some Loon/Surge scripts,
    // while still rejecting malformed JavaScript before publishing the module.
    try{new vm.Script('(async function(){\n'+text+'\n})',{filename:pinned.file});}catch(error){throw Error('External script syntax failed at '+pinned.pinnedURL+': '+error.message);}
    replacements.set(sourceURL,pinned.pinnedURL);
    sourceRecords.push({kind:'script',sourceURL,pinnedURL:pinned.pinnedURL,commit:pinned.commit,sha256:record.sha256,bytes:record.buffer.length});
  });
  await Promise.all(scriptSources);
  moduleText=moduleText;
  for(const [sourceURL,pinnedURL] of replacements)moduleText=moduleText.replaceAll(sourceURL,pinnedURL);
  moduleText=moduleText.replace(/script-update-interval=-1/g,'script-update-interval=86400');
  const after=sourceURLs(moduleText);
  for(const url of after.scripts) {
    const releaseURL=new URL(url);
    if(releaseURL.hostname==='raw.githubusercontent.com'&&!/\/[a-f0-9]{40}\//.test(releaseURL.pathname)&&!releaseURL.pathname.includes('/Resources/AdBlock/'))throw Error('Mutable script reference remains: '+url);
  }

  sourceRecords.sort((a,b)=>(a.label||a.sourceURL||'').localeCompare(b.label||b.sourceURL||''));
  const builderSHA256=sha(fs.readFileSync(path.join(root,'.adblock','build-update.cjs')));
  const mergerSHA256=sha(fs.readFileSync(path.join(root,'.adblock','upstream-merge.cjs')));
  const parserSHA256=sha(fs.readFileSync(path.join(root,'.adblock','rule-parser.cjs')));
  const fingerprint=sha(JSON.stringify({config:cfg,builderSHA256,mergerSHA256,parserSHA256,modules:sha(fs.readFileSync(path.join(root,'.adblock','module-snapshots.cjs'))),templates:templates.map(item=>({name:item.name,sha256:sha(item.text)})),sources:sourceRecords.map(({label,pinnedURL,sha256})=>({label,pinnedURL,sha256})),resources:resources.map(({kind,name})=>({kind,name})),repository:repo}));
  const version=cfg.productVersion+'-manual.'+fingerprint.slice(0,12);
  const standalone=renderTemplates(templates,replacements,version);
  for(const item of standalone)for(const url of sourceURLs(item.text).scripts) {
    const parsed=new URL(url);if(parsed.hostname==='raw.githubusercontent.com'&&!/\/[a-f0-9]{40}\//.test(parsed.pathname)&&!parsed.pathname.includes('/Resources/AdBlock/'))throw Error('Mutable standalone script reference remains: '+item.name);
  }
  moduleText=moduleText.replace(/^#!version=.*$/m,'#!version='+version).replace(/^#!name=.*$/m,'#!name=AdBlock AllInOne｜秋风奶思自维护版').replace(/^#!date=.*$/m,'#!date='+new Date().toISOString().slice(0,10)).replace(/^#!desc=.*$/m,'#!desc=每日合并秋风广告规则、奶思规则/重写/脚本及自维护清理；仅需在Surge手动更新模块。');
  moduleText=moduleText.replace(/^# 首次需上传本仓库配套资源.*$/m,'# GitHub每日准备已验证快照；此后只需在 Surge 更新本模块。').replace(/^# GitHub每日准备.*$/m,'# 规则优先级：自维护功能规则优先，秋风广告规则进入 pre-matching，奶思规则随后。').replace(/^# 核心基线.*$/m,'# 上游规则/脚本固定到 Git commit；同一上游的新内容只会在新模块快照中应用。');
  if(/AdGuard|Adguard|可莉|kelee\.one|LiveMerge/i.test(moduleText))throw Error('Removed source unexpectedly remains in the generated main module');
  if(/RULE-SET,[^\n]*update-interval=86400/.test(moduleText))throw Error('Rule set auto-update interval remains enabled');

  for(const resource of resources) {
    const existing=path.join(root,'Resources','AdBlock',resource.name);
    if(fs.existsSync(existing)&&!fs.readFileSync(existing).equals(resource.bytes))throw Error('Immutable resource integrity failed');
  }
  const sourceDate=new Date().toISOString().slice(0,10);
  const manifest={
    schema:3,version,fingerprint,builderSHA256,mergerSHA256,parserSHA256,preparedFrom:cfg.baselineVersion,
    moduleSHA256:sha(moduleText),sharedSHA256:sha(sharedBytes),sourceRecords,releaseReferences,
    upstreamRows:{awaRules:awaRows.length,naisiModuleRules:naisiSections.Rule.length,naisiListRules:naisiListRows.length,naisiURLRewrites:naisiSections['URL Rewrite'].length,naisiScripts:naisiSections.Script.length},
    mergedRows:{awaRules:mergedRules.awa.length,naisiRules:mergedRules.naisi.length,naisiDropRules:mergedRules.naisiDrop.length,urlRewrites:rewrites.rows.length,scripts:scripts.rows.length},
    deduplicated:{...mergedRules.dedup,urlRewrites:rewrites.deduplicated.length,scripts:scripts.deduplicated.length,compatibilityExceptions:exceptions.length},
    imported:{urlRewrites:rewrites.importedCount,scripts:scripts.importedCount},
    resources:resources.map(({kind,name,sha256,bytes})=>({kind,name,sha256,bytes:bytes.length})),
    moduleSnapshots:standalone.map(({name,sha256})=>({name,sha256})),rollbackSnapshots:cfg.rollbackSnapshots,
    manualApplication:true,ruleUpdateInterval:-1,scriptRefreshBehavior:'Pinned Git commit; new upstream content is applied only after the next generated module is manually updated in Surge.',
    sourcePolicy:'All rows from AWAvenue [Rule] and Naisi [Rule], [URL Rewrite], and [Script] are imported; unsupported source changes fail the build. Exact and first-match duplicates are removed; self-maintained matching scripts keep priority.',
    deviceVerified:false,preparedDate:sourceDate,
    limitations:['Only the upstream sections requested for the combined module are imported; Naisi Body Rewrite, Map Local, Header Rewrite, and MITM sections remain excluded.','Surge applies a script at most once per request; duplicate matching patterns preserve the first active rule.','New rules/resources and the updated module require network access when first downloaded.']
  };
  for(const resource of resources)immutableWrite(root,resource.name,resource.bytes);
  fs.writeFileSync(path.join(root,'AdBlock-AllInOne.sgmodule'),moduleText,'utf8');
  fs.writeFileSync(path.join(root,'AdBlock-AppClean-V5.txt'),sharedBytes);
  fs.writeFileSync(path.join(root,'AdBlock-Update.json'),JSON.stringify(manifest,null,2)+'\n');
  for(const {name,text} of standalone)fs.writeFileSync(path.join(root,name),text,'utf8');
  return manifest;
}

module.exports={build,parseRaw,sourceURLs,requireText,getSectionRows,immutableWrite};
if(require.main===module) {
  const args=process.argv.slice(2),snapshotIndex=args.indexOf('--snapshot'),rootIndex=args.indexOf('--root');
  build({root:rootIndex>=0?path.resolve(args[rootIndex+1]):undefined,snapshot:snapshotIndex>=0?path.resolve(args[snapshotIndex+1]):undefined})
    .then(manifest=>console.log(JSON.stringify({version:manifest.version,awa:manifest.mergedRows.awaRules,naisi:manifest.mergedRows.naisiRules,rewrites:manifest.imported.urlRewrites,scripts:manifest.imported.scripts,moduleSHA256:manifest.moduleSHA256})))
    .catch(error=>{console.error('Update was not published: '+error.message);process.exitCode=1;});
}

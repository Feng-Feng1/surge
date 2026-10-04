/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { convert } = require('./convert-adguard.cjs');
const { buildProtection, parseNode } = require('./build-protection.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
function sourceURLs(moduleText) {
  const scripts = [...new Set([...moduleText.matchAll(/script-path=([^,\r\n]+)/g)].map(x=>x[1]))];
  const rules = [...new Set([...moduleText.matchAll(/RULE-SET,([^,)]+)/g)].map(x=>x[1]))];
  return {scripts,rules};
}
function parseRaw(url) {
  const value = new URL(url);
  if (value.protocol !== 'https:' || value.hostname !== 'raw.githubusercontent.com') throw Error('Unsupported source host');
  const parts = value.pathname.split('/').filter(Boolean);
  if (parts.length < 4) throw Error('Invalid source path');
  const [owner,repo] = parts;
  const ref = parts[2] === 'refs' && parts[3] === 'heads' ? parts[4] : parts[2];
  const file = parts.slice(parts[2] === 'refs' && parts[3] === 'heads' ? 5 : 3).join('/');
  if (!file || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo) || !/^[\w.-]+$/.test(ref)) throw Error('Invalid repository reference');
  return {owner,repo,ref,file,key:owner+'/'+repo+'/'+ref};
}
async function download(url, maxBytes, token) {
  const headers = {'User-Agent':'Surge-AdGuard-Manual-Updater/6.4','Accept':'*/*'};
  if (token) headers.Authorization = 'Bearer '+token;
  const response = await fetch(url,{headers,signal:AbortSignal.timeout(60000)});
  if (!response.ok) throw Error('Source download failed: HTTP '+response.status+' '+url);
  if (Number(response.headers.get('content-length')) > maxBytes) throw Error('Source exceeds download limit');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > maxBytes) throw Error('Empty or oversized source');
  return {buffer,contentType:response.headers.get('content-type')||'',finalURL:response.url,sha256:sha(buffer)};
}
function requireText(record, url) {
  if (/html/i.test(record.contentType)||/^\s*(?:<!doctype|<html)/i.test(record.buffer.toString('utf8').slice(0,300))) throw Error('HTML is not a filtering resource: '+url);
  if (record.finalURL !== url) throw Error('Unexpected source redirect: '+url);
  return record.buffer.toString('utf8').replace(/^\uFEFF/,'');
}
function validateRuleSet(text) {
  const allowed = new Set(['DOMAIN','DOMAIN-SUFFIX','DOMAIN-KEYWORD','DOMAIN-WILDCARD','IP-CIDR','IP-CIDR6','URL-REGEX','USER-AGENT','PROCESS-NAME','IP-ASN']);
  function validateNode(node,depth=0) {
    if (depth>=10 && ['AND','OR','NOT'].includes(node.type)) throw Error('Rule tree exceeds Surge logical nesting limit');
    if (['AND','OR','NOT'].includes(node.type)) {
      if (!node.children.length || (node.type==='NOT' && node.children.length!==1)) throw Error('Invalid logical rule');
      for (const child of node.children) validateNode(child,depth+1);
    } else if (!allowed.has(node.type) || !node.value || node.parameters.some(x=>!['no-resolve','extended-matching'].includes(x))) throw Error('Unexpected external rule-set format');
  }
  const rows=text.split(/\r?\n/).filter(x=>x.trim()&&!/^\s*[#;/]/.test(x));
  if (rows.length < 10) throw Error('Unexpected empty/short external rule-set');
  for (const row of rows) validateNode(parseNode(row));
  return rows.length;
}
function immutableWrite(root, name, bytes) {
  const file = path.join(root,'Resources','AdBlock',name);
  if (fs.existsSync(file) && !fs.readFileSync(file).equals(bytes)) throw Error('Immutable resource name already contains different bytes');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if (!fs.existsSync(file)) fs.writeFileSync(file,bytes);
}
async function build(options={}) {
  const root = options.root || path.resolve(__dirname,'..');
  const cfg = readJson(path.join(root,'.adblock','config.json'));
  const baselineBytes = fs.readFileSync(path.join(root,'.adblock','baseline','AdBlock-AllInOne.sgmodule'));
  const sharedBytes = fs.readFileSync(path.join(root,'.adblock','baseline','AdBlock-AppClean-V5.txt'));
  if (sha(baselineBytes)!==cfg.baselineModuleSHA256 || sha(sharedBytes)!==cfg.baselineSharedSHA256) throw Error('Baseline verification failed');
  const baseline = baselineBytes.toString('utf8').replace(/\r\n/g,'\n');
  const repo = options.repository || process.env.GITHUB_REPOSITORY || cfg.repository;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error('Invalid destination repository');
  const snapshot = options.snapshot ? readJson(options.snapshot) : null;
  const snapshotDir = options.snapshot && path.dirname(path.resolve(options.snapshot));
  const commitCache = new Map();
  const sourceRecords = [];
  async function getBytes(url, limit) {
    if (snapshot) {
      const record = snapshot.sources.find(x=>x.url===url);
      if (!record) throw Error('Offline source is missing: '+url);
      const buffer=fs.readFileSync(path.resolve(snapshotDir,record.file));
      if (sha(buffer)!==record.sha256 || !buffer.length || buffer.length>limit) throw Error('Offline source hash or size failed');
      return {buffer,sha256:record.sha256,contentType:record.contentType,finalURL:record.finalURL||url};
    }
    return download(url,limit);
  }
  async function pin(url) {
    const parsed=parseRaw(url);
    let commit=commitCache.get(parsed.key);
    if (!commit) {
      if (/^[a-f0-9]{40}$/.test(parsed.ref)) commit=parsed.ref;
      else if (snapshot) commit=snapshot.commits[parsed.key];
      else {
        const api='https://api.github.com/repos/'+parsed.owner+'/'+parsed.repo+'/commits/'+encodeURIComponent(parsed.ref);
        const apiRecord=await download(api,2000000,process.env.GITHUB_TOKEN);
        const obj=JSON.parse(apiRecord.buffer.toString('utf8')); commit=obj.sha;
      }
      if (!/^[a-f0-9]{40}$/.test(commit||'')) throw Error('No verified Git commit for '+parsed.key);
      commitCache.set(parsed.key,commit);
    }
    return 'https://raw.githubusercontent.com/'+parsed.owner+'/'+parsed.repo+'/'+commit+'/'+parsed.file;
  }
  const urls=sourceURLs(baseline);
  const sharedURLs=urls.scripts.filter(url=>parseRaw(url).file==='AdBlock-AppClean-V5.txt');
  if (sharedURLs.length!==1) throw Error('Unexpected shared source references');
  const replacements=new Map();
  for (const sourceURL of [...urls.scripts.filter(x=>!sharedURLs.includes(x)),...urls.rules]) {
    const pinnedURL=await pin(sourceURL);
    const record=await getBytes(pinnedURL,10000000);
    const text=requireText(record,pinnedURL);
    const kind=urls.scripts.includes(sourceURL)?'script':'rule-set';
    const rules=kind==='rule-set'?validateRuleSet(text):null;
    if (kind==='script') new vm.Script(text,{filename:parseRaw(sourceURL).file});
    replacements.set(sourceURL,pinnedURL);
    sourceRecords.push({kind,sourceURL,pinnedURL,commit:parseRaw(pinnedURL).ref,sha256:record.sha256,bytes:record.buffer.length,rows:rules});
  }
  const dnsRecord=await getBytes(cfg.dnsSource,20000000);
  const dnsText=requireText(dnsRecord,cfg.dnsSource);
  if (!/^! Title: AdGuard DNS filter\s*$/m.test(dnsText)) throw Error('Unexpected AdGuard source title');
  const converted=convert(dnsText);
  if (converted.blockEntries.length<cfg.minimumConvertedEntries || converted.blockEntries.length>cfg.maximumConvertedEntries) throw Error('Unexpected converted domain count');
  const protection=buildProtection(baseline);
  const protectionRows=protection.rows || protection.sortedRows;
  if (!Array.isArray(protectionRows)||!protectionRows.length) throw Error('Missing compatibility protection');
  const lastModified=dnsText.match(/^! Last modified:\s*(.+)$/m)?.[1] || 'not declared';
  const common=['# Surge AdGuard DNS conservative subset','# Source: '+cfg.dnsSource,'# Source SHA256: '+dnsRecord.sha256,'# Author-declared modified: '+lastModified,'# Derived data license: GPL-3.0-only','# Cosmetic/scriptlet/HTTP context rules are not converted.'];
  const block=Buffer.from([...common,...converted.blockEntries].join('\n')+'\n');
  const exceptions=Buffer.from([...common,'# Exceptions apply only within the AdGuard layer. No DIRECT policy.',...converted.exceptionRules].join('\n')+'\n');
  const protect=Buffer.from(['# Compatibility exclusions apply only within the AdGuard layer.',...protectionRows].join('\n')+'\n');
  const resources=[{kind:'domains',extension:'domain-set',bytes:block},{kind:'exceptions',extension:'list',bytes:exceptions},{kind:'compatibility',extension:'list',bytes:protect},{kind:'shared',extension:'txt',bytes:sharedBytes},{kind:'adguard-input',extension:'txt',bytes:dnsRecord.buffer}].map(x=>({...x,sha256:sha(x.bytes),name:sha(x.bytes)+'.'+x.extension}));
  const resourceURL=kind=>'https://raw.githubusercontent.com/'+repo+'/'+cfg.branch+'/Resources/AdBlock/'+resources.find(x=>x.kind===kind).name;
  replacements.set(sharedURLs[0],resourceURL('shared'));
  const builderSHA256=sha(fs.readFileSync(path.join(root,'.adblock','build-update.cjs')));
  const fingerprint=sha(JSON.stringify({config:cfg,builder:builderSHA256,converter:sha(fs.readFileSync(path.join(root,'.adblock','convert-adguard.cjs'))),protection:sha(fs.readFileSync(path.join(root,'.adblock','build-protection.cjs'))),dns:dnsRecord.sha256,sources:sourceRecords,resources:resources.map(({kind,name})=>({kind,name})),repo}));
  const version=cfg.productVersion+'-manual.'+fingerprint.slice(0,12);
  let moduleText=baseline;
  for(const [source,pinned] of replacements) moduleText=moduleText.replaceAll(source,pinned);
  moduleText=moduleText.replace(/update-interval=86400/g,'update-interval=-1');
  // Rule intervals are negative; script intervals are kept valid and poll fixed commit/hash URLs.
  moduleText=moduleText.replace(/script-update-interval=-1/g,'script-update-interval=86400');
  const adguardRule='AND,((DOMAIN-SET,'+resourceURL('domains')+',update-interval=-1),(NOT,((RULE-SET,'+resourceURL('exceptions')+',no-resolve,update-interval=-1))),(NOT,((RULE-SET,'+resourceURL('compatibility')+',no-resolve,update-interval=-1)))),REJECT';
  const ruleEnd=moduleText.indexOf('\n[URL Rewrite]');
  if (ruleEnd<0) throw Error('Missing rule insertion boundary');
  moduleText=moduleText.slice(0,ruleEnd)+'\n# AdGuard DNS广告与追踪域名安全子集；例外只排除此层，不改变代理策略。\n'+adguardRule+'\n'+moduleText.slice(ruleEnd);
  moduleText=moduleText.replace(/^#!version=.*$/m,'#!version='+version)
    .replace(/^#!name=.*$/m,'#!name=AdBlock AllInOne｜AdGuard手动更新版')
    .replace(/^#!date=.*$/m,'#!date='+new Date(lastModified==='not declared'?Date.now():lastModified).toISOString().slice(0,10))
    .replace(/^#!desc=.*$/m,'#!desc=原App清理与AdGuard DNS安全子集；GitHub准备更新，Surge手动应用新版后切换固定资源。保留地图兼容，网页CSS和原生未知容器不作转换。')
    .replace(/^# 先将配套 AdBlock-AppClean-V5\.txt 同名上传，.*$/m,'# 首次需上传本包全部仓库配套文件（含Resources、.adblock与.github）；后续在Surge更新此模块。')
    .replace(/^# 合并订阅通过 Script Hub 更新；.*$/m,'# 本版由仓库工作流准备固定资源；在Surge更新本模块后应用新版本。')
    .replace(/^# 此文件为稳定核心，合并订阅.*$/m,'# 核心来自已核验6.3.1；外部脚本/规则固定原仓Git commit，AdGuard及共享资源使用内容哈希。');
  if (/RULE-SET,[^\n]*update-interval=86400/.test(moduleText)) throw Error('Automatic rule interval remains');
  const after=sourceURLs(moduleText);
  if (after.scripts.some(x=>!/\/([a-f0-9]{40}|Resources\/AdBlock\/)/.test(new URL(x).pathname))) throw Error('Mutable script reference remains');
  const allNames=resources.map(x=>x.name);
  for (const resource of resources) {
    const existing=path.join(root,'Resources','AdBlock',resource.name);
    if (fs.existsSync(existing)&&!fs.readFileSync(existing).equals(resource.bytes)) throw Error('Immutable resource integrity failed');
  }
  const manifest={schema:1,version,fingerprint,builderSHA256,preparedFrom:'6.3.1',moduleSHA256:sha(moduleText),sharedSHA256:sha(sharedBytes),dnsSource:cfg.dnsSource,dnsSourceSHA256:dnsRecord.sha256,sourceLastModified:lastModified,dnsConverted:converted.stats,convertedDomainEntries:converted.blockEntries.length,exceptionRows:converted.exceptionRules.length,protectionRows:protectionRows.length,resources:resources.map(({kind,name,sha256,bytes})=>({kind,name,sha256,bytes:bytes.length})),sourceRecords,manualApplication:true,ruleUpdateInterval:-1,scriptRefreshBehavior:'Fixed commit or content-hash URL; periodic downloads do not select new upstream code.',noGlobalDirectFromAdGuard:true,unknownExceptionsFailUpdate:true,deviceVerified:false,limitations:['Conservative AdGuard DNS hostname subset, not full AdGuard engine or CNAME response filtering.','All supported exceptions prevail over important blocks to avoid stronger blocking.','Surge module update checks and first/new-resource downloads may still use network.','CSS, scriptlets and browser context rules cannot directly remove native App containers.']};
  // Every source and immutable destination is checked before any published file is written.
  for (const resource of resources) immutableWrite(root,resource.name,resource.bytes);
  fs.writeFileSync(path.join(root,'AdBlock-AllInOne.sgmodule'),moduleText,'utf8');
  fs.writeFileSync(path.join(root,'AdBlock-AppClean-V5.txt'),sharedBytes);
  fs.writeFileSync(path.join(root,'AdBlock-AdGuard-Update.json'),JSON.stringify(manifest,null,2)+'\n');
  const rollback=path.join(root,'Rollback','6.3.1');fs.mkdirSync(rollback,{recursive:true});
  fs.writeFileSync(path.join(rollback,'AdBlock-AllInOne.sgmodule'),baselineBytes);fs.writeFileSync(path.join(rollback,'AdBlock-AppClean-V5.txt'),sharedBytes);
  return manifest;
}
module.exports={build,parseRaw,sourceURLs,validateRuleSet,immutableWrite,requireText};
if (require.main===module) {
  const args=process.argv.slice(2), index=args.indexOf('--snapshot');
  const rootIndex=args.indexOf('--root');
  build({root:rootIndex>=0?path.resolve(args[rootIndex+1]):undefined,snapshot:index>=0?path.resolve(args[index+1]):undefined}).then(m=>console.log(JSON.stringify({version:m.version,domains:m.convertedDomainEntries,exceptions:m.exceptionRows,protected:m.protectionRows,pinnedSources:m.sourceRecords.length,moduleSHA256:m.moduleSHA256}))).catch(e=>{console.error('Update was not published: '+e.message);process.exitCode=1;});
}

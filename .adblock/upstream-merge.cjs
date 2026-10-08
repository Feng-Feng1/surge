/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';

const crypto=require('node:crypto');
const {splitTopLevel,parseNode,renderNode}=require('./rule-parser.cjs');

const ruleTypes=new Set(['DOMAIN','DOMAIN-SUFFIX','DOMAIN-KEYWORD','DOMAIN-WILDCARD','DOMAIN-SET','RULE-SET','IP-CIDR','IP-CIDR6','GEOIP','IP-ASN','USER-AGENT','URL-REGEX','PROCESS-NAME','DEST-PORT','SRC-PORT','IN-PORT','SRC-IP','DEVICE-NAME','MAC-ADDRESS','PROTOCOL','HOSTNAME-TYPE','SUBNET','CELLULAR-RADIO','CELLULAR-CARRIER','SCRIPT']);
const blockPolicies=new Set(['REJECT','REJECT-DROP']);
const removableOptions=new Set(['no-resolve','extended-matching','pre-matching']);
const safeHash=value=>crypto.createHash('sha256').update(value).digest('hex');

function sourceSections(text,label,allowedSections) {
  const result={};let current=null;
  for(const [index,raw] of text.replace(/^\uFEFF/,'').split(/\r?\n/).entries()) {
    const line=raw.trim(),heading=/^\[([^\]]+)\]$/.exec(line);
    if(heading) {
      current=heading[1];
      if(Object.prototype.hasOwnProperty.call(result,current))throw Error(label+': duplicate section '+current+' at line '+(index+1));
      if(!allowedSections.includes(current))throw Error(label+': unsupported section '+current+' at line '+(index+1));
      result[current]=[];continue;
    }
    if(!current&&line.startsWith('#!'))continue;
    if(!line||/^(?:#|;|\/\/)/.test(line))continue;
    if(!current)throw Error(label+': content before first section at line '+(index+1));
    result[current].push(line);
  }
  for(const section of allowedSections)if(!result[section])result[section]=[];
  return result;
}

function normalizeNode(node,location) {
  if(node.children) {
    if(!['AND','OR','NOT'].includes(node.type)||!node.children.length||(node.type==='NOT'&&node.children.length!==1))throw Error(location+': invalid logical rule');
    return {type:node.type,children:node.children.map(child=>normalizeNode(child,location))};
  }
  if(!ruleTypes.has(node.type)||typeof node.value!=='string'||!node.value.trim())throw Error(location+': unsupported or empty rule '+node.type);
  const parameters=(node.parameters||[]).map(value=>value.trim().toLowerCase());
  if(parameters.some(value=>!removableOptions.has(value)))throw Error(location+': unsupported rule option');
  return {type:node.type,value:node.value.trim(),parameters:[]};
}

function canonicalNode(node) {
  if(node.children) {
    const children=node.children.map(canonicalNode);
    if(node.type==='AND'||node.type==='OR')children.sort();
    return node.type+'('+children.join('|')+')';
  }
  let value=node.value;
  if(['DOMAIN','DOMAIN-SUFFIX','DOMAIN-KEYWORD','DOMAIN-WILDCARD','IP-CIDR','IP-CIDR6'].includes(node.type))value=value.toLowerCase();
  const parameters=(node.parameters||[]).map(x=>x.toLowerCase()).sort();
  return node.type+','+value+','+parameters.join(',');
}

function parseRuleRow(raw,defaultPolicy,location='upstream rule') {
  const fields=splitTopLevel(raw);let policy=defaultPolicy,expression=raw;
  if(fields.length>=3&&blockPolicies.has(fields[2].toUpperCase())) {
    policy=fields[2].toUpperCase();
    expression=[...fields.slice(0,2),...fields.slice(3).filter(option=>option.toLowerCase()!=='pre-matching')].join(',');
  } else if(!policy) throw Error(location+': missing supported block policy');
  const parsed=normalizeNode(parseNode(expression),location);
  return {policy,node:parsed,line:renderNode(parsed),key:canonicalNode(parsed),source:raw};
}

function collectRules({awaRows,naisiModuleRows,staticRows}) {
  const staticKeys=new Set();
  for(const raw of staticRows) {
    const fields=splitTopLevel(raw);
    if(fields.length<3)throw Error('Invalid static rule: '+raw.slice(0,160));
    const predicate=[...fields.slice(0,2),...fields.slice(3).filter(option=>option.toLowerCase()!=='pre-matching')].join(',');
    try{staticKeys.add(canonicalNode(normalizeNode(parseNode(predicate),'static rule')))}catch(error){
      if(/RULE-SET,https:\/\/raw\.githubusercontent\.com\/(?:fmz200\/wool_scripts|TG-Twilight\/AWAvenue-Ads-Rule)/i.test(raw))continue;
      throw error;
    }
  }
  const awa=new Map(),normal=new Map(),drop=new Map(),dedup={static:0,awa:0,naisiModule:0,naisiModuleDrop:0,crossSource:0};
  for(const raw of awaRows) {
    const rule=parseRuleRow(raw,'REJECT','AWAvenue [Rule]');
    if(rule.policy!=='REJECT')throw Error('AWAvenue entry is not a reject rule');
    if(staticKeys.has(rule.key)){dedup.static++;continue;}
    if(awa.has(rule.key)){dedup.awa++;continue;}
    awa.set(rule.key,rule);
  }
  const awaKeys=new Set(awa.keys());
  for(const raw of naisiModuleRows) {
    const rule=parseRuleRow(raw,null,'Naisi [Rule]');
    const target=rule.policy==='REJECT-DROP'?drop:normal;
    const source=rule.policy==='REJECT-DROP'?'naisiModuleDrop':'naisiModule';
    if(staticKeys.has(rule.key)){dedup.static++;continue;}
    if(rule.policy==='REJECT-DROP'&&awaKeys.has(rule.key))throw Error('Conflicting REJECT-DROP and AWAvenue rule for '+rule.line);
    if(rule.policy==='REJECT'&&awaKeys.has(rule.key)){dedup.crossSource++;continue;}
    if(target.has(rule.key)){dedup[source]++;continue;}
    target.set(rule.key,rule);
  }
  for(const [key] of drop)if(normal.has(key))throw Error('Conflicting Naisi REJECT and REJECT-DROP rules for '+normal.get(key).line);
  return {awa:[...awa.values()],naisi:[...normal.values()],naisiDrop:[...drop.values()],dedup,staticRuleCount:staticKeys.size,sourceCounts:{awa:awaRows.length,naisiModule:naisiModuleRows.length}};
}

function parseScriptRow(raw,location='upstream script') {
  const at=raw.indexOf('=');if(at<=0)throw Error(location+': invalid script declaration');
  const name=raw.slice(0,at).trim();const fields={};
  for(const item of splitTopLevel(raw.slice(at+1))) {
    const divider=item.indexOf('=');if(divider<=0)throw Error(location+': invalid script parameter');
    const key=item.slice(0,divider).trim(),value=item.slice(divider+1).trim();
    if(Object.prototype.hasOwnProperty.call(fields,key))throw Error(location+': duplicate script parameter '+key);
    fields[key]=value;
  }
  if(!fields.type||!fields.pattern||!fields['script-path'])throw Error(location+': missing type, pattern or script-path');
  return {name,fields,raw};
}

function scriptPatternKey(row) {
  const parsed=typeof row==='string'?parseScriptRow(row):row;
  return parsed.fields.type.toLowerCase()+'|'+parsed.fields.pattern.replace(/^(["'])(.*)\1$/s,'$2');
}

function scriptBehaviorKey(row) {
  const parsed=typeof row==='string'?parseScriptRow(row):row;
  const ignored=new Set(['timeout','engine','script-update-interval']);
  const fields=Object.entries(parsed.fields).filter(([key])=>!ignored.has(key)).sort(([a],[b])=>a.localeCompare(b));
  return JSON.stringify(fields);
}

function uniqueScriptName(original,signature) {
  const title=original.replace(/[^\p{L}\p{N}_.-]+/gu,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,36)||'script';
  return 'Naisi-'+title+'-'+safeHash(signature).slice(0,8);
}

function mergeScripts(baseRows,upstreamRows) {
  const output=[],patterns=new Set(),behaviors=new Set(),names=new Set(),deduplicated=[];
  function addBase(raw) {
    const parsed=parseScriptRow(raw,'baseline script'),pattern=scriptPatternKey(parsed),behavior=scriptBehaviorKey(parsed);
    if(names.has(parsed.name))throw Error('Duplicate baseline script name: '+parsed.name);
    if(patterns.has(pattern)){deduplicated.push({kind:'baseline-script-pattern',pattern,name:parsed.name});return;}
    patterns.add(pattern);behaviors.add(behavior);names.add(parsed.name);output.push(raw);
  }
  for(const row of baseRows)addBase(row);
  const baselineUniqueCount=output.length;
  for(const raw of upstreamRows) {
    const parsed=parseScriptRow(raw,'Naisi [Script]');
    const pattern=scriptPatternKey(parsed),behavior=scriptBehaviorKey(parsed);
    if(patterns.has(pattern)) {
      deduplicated.push({kind:behaviors.has(behavior)?'same-script':'self-maintained-script-priority',pattern,name:parsed.name,sourceHash:safeHash(raw)});
      continue;
    }
    const name=uniqueScriptName(parsed.name,raw);
    if(names.has(name))throw Error('Generated duplicate Naisi script label');
    const outputRow=name+' = '+raw.slice(raw.indexOf('=')+1).trim();
    patterns.add(pattern);behaviors.add(behavior);names.add(name);output.push(outputRow);
  }
  return {rows:output,deduplicated,baselineCount:baseRows.length,baselineUniqueCount,upstreamCount:upstreamRows.length,importedCount:output.length-baselineUniqueCount};
}

function rewriteIdentity(raw) {
  const parts=raw.trim().split(/\s+/);if(parts.length<2)throw Error('Invalid URL Rewrite line: '+raw);
  const action=parts[parts.length-1].toLowerCase();
  if(!['header','302','307','reject'].includes(action))throw Error('Unsupported URL Rewrite action: '+raw);
  const pattern=parts[0];
  return action==='reject'?pattern+'|reject':pattern+'|'+parts.slice(1).join(' ').toLowerCase();
}

function mergeRewrites(baseRows,upstreamRows) {
  const rows=[],seen=new Set(),deduplicated=[];
  for(const raw of baseRows) {
    const key=rewriteIdentity(raw);
    if(seen.has(key)){deduplicated.push({source:'baseline',key});continue;}
    seen.add(key);rows.push(raw);
  }
  const baselineUniqueCount=rows.length;
  for(const raw of upstreamRows) {
    const key=rewriteIdentity(raw);
    if(seen.has(key)){deduplicated.push({source:'Naisi',key});continue;}
    seen.add(key);rows.push(raw);
  }
  return {rows,deduplicated,baselineCount:baseRows.length,baselineUniqueCount,upstreamCount:upstreamRows.length,importedCount:rows.length-baselineUniqueCount};
}

function exceptionTree(ruleRow,expectedSource) {
  if(!ruleRow||!ruleRow.includes(expectedSource))throw Error('Missing compatibility wrapper for '+expectedSource);
  const fields=splitTopLevel(ruleRow),tree=parseNode(fields.slice(0,2).join(','));
  if(tree.type!=='AND'||tree.children.length!==2||tree.children[0].type!=='RULE-SET'||tree.children[1].type!=='NOT')throw Error('Unexpected compatibility wrapper shape for '+expectedSource);
  const exclusion=tree.children[1].children[0];
  if(!exclusion||exclusion.type!=='OR'||!exclusion.children.length)throw Error('Missing compatibility exceptions for '+expectedSource);
  return exclusion.children;
}

function unionExceptions(naiRows,awaRows) {
  const result=new Map();
  for(const row of [...naiRows,...awaRows]) {
    const node=normalizeNode(typeof row==='string'?parseNode(row):row,'compatibility exception');
    if(node.children||!ruleTypes.has(node.type))throw Error('Compatibility exception must be a simple supported rule');
    result.set(canonicalNode(node),node);
  }
  if(!result.size)throw Error('Empty compatibility exception set');
  return [...result.values()];
}

function renderGuardedRuleSet(url,exceptions,policy,preMatching=false) {
  const set={type:'RULE-SET',value:url,parameters:['no-resolve','extended-matching','update-interval=-1']};
  const exclusion={type:'NOT',children:[{type:'OR',children:exceptions}]};
  const logical={type:'AND',children:[set,exclusion]};
  return renderNode(logical)+','+policy+(preMatching?',pre-matching':'');
}

function renderRuleFile(source,records) {
  const lines=['# Generated from verified upstream data; do not edit by hand.','# Source: '+source];
  for(const row of records)lines.push(row.line);
  return Buffer.from(lines.join('\n')+'\n','utf8');
}

module.exports={sourceSections,normalizeNode,canonicalNode,parseRuleRow,collectRules,parseScriptRow,scriptPatternKey,scriptBehaviorKey,mergeScripts,rewriteIdentity,mergeRewrites,exceptionTree,unionExceptions,renderGuardedRuleSet,renderRuleFile};

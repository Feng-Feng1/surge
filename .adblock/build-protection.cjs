// SPDX-License-Identifier: MIT
// Independently written parser; generated predicates retain source provenance.
'use strict';
const crypto=require('node:crypto');
const net=require('node:net');
const TYPE_DOMAIN=new Set(['DOMAIN','DOMAIN-SUFFIX','DOMAIN-WILDCARD']);
const TYPE_NEGATIVE=new Set([...TYPE_DOMAIN,'DOMAIN-KEYWORD','IP-CIDR','IP-CIDR6']);

function splitTopLevel(text) {
  const result=[];let start=0,depth=0,quote='',escaped=false;
  for(let at=0;at<text.length;at++) {
    const character=text[at];
    if(escaped){escaped=false;continue;}
    if(character==='\\'){escaped=true;continue;}
    if(quote){if(character===quote)quote='';continue;}
    if(character==='"'||character==="'"){quote=character;continue;}
    if(character==='(')depth++;
    else if(character===')'){if(--depth<0)throw new Error('Unbalanced rule parentheses');}
    else if(character===','&&depth===0){result.push(text.slice(start,at).trim());start=at+1;}
  }
  if(depth!==0||quote)throw new Error('Unbalanced rule expression');
  result.push(text.slice(start).trim());return result;
}
function unwrapOne(text) {
  text=text.trim();if(!text.startsWith('('))return null;
  let depth=0,quote='',escaped=false;
  for(let at=0;at<text.length;at++) {
    const c=text[at];
    if(escaped){escaped=false;continue;}if(c==='\\'){escaped=true;continue;}
    if(quote){if(c===quote)quote='';continue;}if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='(')depth++;
    else if(c===')'&&--depth===0)return at===text.length-1?text.slice(1,-1).trim():null;
  }
  throw new Error('Unbalanced predicate parentheses');
}
function parseNode(text) {
  let unwrapped;while((unwrapped=unwrapOne(text))!==null)text=unwrapped;
  const fields=splitTopLevel(text),type=fields[0].toUpperCase();
  if(['AND','OR','NOT'].includes(type)) {
    if(fields.length!==2)throw new Error('Unexpected logical predicate fields');
    const list=unwrapOne(fields[1]);if(list===null)throw new Error('Logical predicate list missing parentheses');
    const children=splitTopLevel(list).map(parseNode);
    if(type==='NOT'&&children.length!==1)throw new Error('NOT requires exactly one predicate');
    return {type,children};
  }
  return {type,value:fields[1],parameters:fields.slice(2)};
}
function sourceGroup(urlText) {
  let url;try{url=new URL(urlText);}catch{return null;}
  if(url.protocol!=='https:'||url.hostname.toLowerCase()!=='raw.githubusercontent.com'||url.username||url.password)return null;
  if(/^\/fmz200\/wool_scripts\/(?:main|master|[a-f0-9]{40})\/Loon\/rule\/rejectAd\.list$/.test(url.pathname))return 'fmz-negative';
  if(/^\/TG-Twilight\/AWAvenue-Ads-Rule\/(?:main|master|[a-f0-9]{40})\/Filters\/AWAvenue-Ads-Rule-Surge-RULE-SET-Only\.Ads\.list$/.test(url.pathname))return 'awa-negative';
  return null;
}
function bareHost(value) {
  if(typeof value!=='string')throw new Error('Missing hostname');
  let host=value.trim().toLowerCase().replace(/\.$/,'');
  const port=/:([0-9]+)$/.exec(host);
  if(port){if(Number(port[1])>65535)throw new Error('Invalid hostname port');host=host.slice(0,port.index).replace(/\.$/,'');}
  if(!host||host==='*'||!/^[a-z0-9_*?.-]+$/.test(host)||host.startsWith('.')||host.includes('..'))throw new Error('Unsupported or globally broad hostname: '+value);
  return host;
}
function normalizePredicate(node) {
  if(!TYPE_NEGATIVE.has(node.type)||typeof node.value!=='string'||!node.value)throw new Error('Unsupported native negative predicate: '+node.type);
  const type=node.type,value=node.value.trim().toLowerCase();
  if(TYPE_DOMAIN.has(type)) {
    const host=bareHost(value);
    if(type!=='DOMAIN-WILDCARD'&&/[*?]/.test(host))throw new Error('Wildcard in exact/suffix domain predicate');
    return type+','+host+',extended-matching';
  }
  if(type==='DOMAIN-KEYWORD') {
    if(!/^[a-z0-9_.-]+$/.test(value))throw new Error('Unsupported domain keyword');
    return type+','+value+',extended-matching';
  }
  if(!/^[a-f0-9.:]+\/\d+$/.test(value))throw new Error('Unsupported IP exclusion');
  const [address,prefix]=value.split('/'),family=net.isIP(address),maximum=type==='IP-CIDR'?32:128;
  if(family!==(type==='IP-CIDR'?4:6)||Number(prefix)>maximum)throw new Error('Invalid IP exclusion');
  const allowed=new Set(['no-resolve']);
  if(node.parameters.some(parameter=>!allowed.has(parameter.toLowerCase())))throw new Error('Unsupported IP exclusion parameter');
  return type+','+value+(node.parameters.some(parameter=>parameter.toLowerCase()==='no-resolve')?',no-resolve':'');
}
function negativeRows(node,add,evidence) {
  if(node.type==='OR'){node.children.forEach(child=>negativeRows(child,add,evidence));return;}
  // Flattening an AND/NOT subtree would broaden its conditional match; fail for review.
  if(['AND','NOT'].includes(node.type))throw new Error('Native exclusion has a conditional subtree; manual review required');
  add(normalizePredicate(node),{...evidence,sourceType:node.type,sourceValue:node.value});
}
function buildProtection(moduleText) {
  if(typeof moduleText!=='string')throw new TypeError('moduleText must be a string');
  const rows=new Map(),skipped=[],sourceCounts={},andSources=[];let section='';
  function add(row,evidence){if(!rows.has(row))rows.set(row,[]);rows.get(row).push(evidence);sourceCounts[evidence.sourceGroup]=(sourceCounts[evidence.sourceGroup]||0)+1;}
  const lines=moduleText.replace(/^\uFEFF/,'').split(/\r?\n/);
  for(let index=0;index<lines.length;index++) {
    const text=lines[index].trim(),line=index+1;
    if(!text||/^(?:#|;|\/\/)/.test(text))continue;
    const heading=/^\[([^\]]+)\]$/.exec(text);if(heading){section=heading[1].toLowerCase();continue;}
    if(section==='mitm'&&/^hostname\s*=/i.test(text)) {
      const list=text.slice(text.indexOf('=')+1).replace(/%(?:APPEND|INSERT)%/gi,'');
      for(const value of list.split(',').map(item=>item.trim()).filter(Boolean)) {
        if(value.startsWith('-')){skipped.push({sourceGroup:'mitm',line,value,reason:'Negative MITM host is not an enabled interception target'});continue;}
        const host=bareHost(value),type=/[*?]/.test(host)?'DOMAIN-WILDCARD':'DOMAIN';
        add(type+','+host+',extended-matching',{sourceGroup:'mitm',line,sourceType:'hostname',sourceValue:value});
      }
    } else if(section==='rule') {
      // Non-domain top-level rules need not be parsed unless they are known AND rules.
      const type=text.slice(0,text.indexOf(',')).toUpperCase();
      if(TYPE_DOMAIN.has(type)) {
        const fields=splitTopLevel(text);
        if(fields[2]&&fields[2].toUpperCase()==='DIRECT')add(normalizePredicate({type,value:fields[1],parameters:fields.slice(3)}),{sourceGroup:'native-direct',line,sourceType:type,sourceValue:fields[1]});
      } else if(type==='AND') {
        const fields=splitTopLevel(text);
        if(!fields[2]||fields[2].toUpperCase()!=='REJECT')continue;
        const root=parseNode('AND,'+fields[1]);
        const known=root.children.filter(child=>child.type==='RULE-SET').map(child=>({group:sourceGroup(child.value),url:child.value})).filter(item=>item.group);
        if(known.length===0)continue;
        if(known.length!==1)throw new Error('Ambiguous native external-set AND rule');
        const {group,url}=known[0];
        const negatives=root.children.filter(child=>child.type==='NOT');
        if(negatives.length!==1)throw new Error('Native external-set AND exclusion shape changed');
        negativeRows(negatives[0].children[0],add,{sourceGroup:group,line,sourceURL:url});
        andSources.push({sourceGroup:group,line,sourceURL:url});
      }
    }
  }
  // Requested narrow map scope, not all baidu.com or qq.com services.
  add('DOMAIN-SUFFIX,map.baidu.com,extended-matching',{sourceGroup:'baidu-map-scope',sourceType:'DOMAIN-SUFFIX',sourceValue:'map.baidu.com',reason:'Protect only the new AdGuard layer from changing known map compatibility'});
  const sortedRows=[...rows.keys()].sort();
  const metadata={schemaVersion:1,moduleSHA256:crypto.createHash('sha256').update(moduleText).digest('hex'),uniqueRows:sortedRows.length,sourceCounts,andSources,skipped,evidence:sortedRows.map(row=>({row,sources:rows.get(row)})),semantics:'Boolean match predicates for NOT(protection) in the new AdGuard layer only; no DIRECT policy and no modification/reordering of native rules.',scope:'MITM positive hosts, top-level domain DIRECT rules, exact fmz/AWA external-set NOT subtrees and map.baidu.com; unsupported conditional exclusions fail for review.'};
  return {sortedRows,metadata};
}
module.exports={buildProtection,parseNode};
if(require.main===module) {
  const fs=require('node:fs'),path=require('node:path');
  const input=process.argv[2]||path.join(__dirname,'../../outputs/去广告完整版优化-6.3.1/AdBlock-AllInOne.sgmodule');
  const out=process.argv[3]||__dirname;fs.mkdirSync(out,{recursive:true});
  const result=buildProtection(fs.readFileSync(input,'utf8'));
  fs.writeFileSync(path.join(out,'native-protection.list'),'# Match predicates; used only inside NOT of the new AdGuard blocking layer.\n'+result.sortedRows.join('\n')+'\n');
  fs.writeFileSync(path.join(out,'native-protection-metadata.json'),JSON.stringify(result.metadata,null,2));
  console.log(JSON.stringify({input:path.basename(input),uniqueRows:result.sortedRows.length,sourceCounts:result.metadata.sourceCounts,skipped:result.metadata.skipped.length}));
}

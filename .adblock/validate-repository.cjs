/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const {parseNode}=require('./build-protection.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const truth=v=>v==='true'||v==='1';
const allowedTypes=new Set(['http-request','http-response','cron','event','generic','dns','rule']);
const scriptKeys=new Set(['type','pattern','script-path','requires-body','max-size','binary-body-mode','full-header-mode','timeout','argument','engine','debug','script-update-interval','cronexp','event-name','wake-system']);
const ruleTypes=new Set(['DOMAIN','DOMAIN-SUFFIX','DOMAIN-KEYWORD','DOMAIN-WILDCARD','DOMAIN-SET','RULE-SET','IP-CIDR','IP-CIDR6','GEOIP','IP-ASN','USER-AGENT','URL-REGEX','PROCESS-NAME','DEST-PORT','SRC-PORT','IN-PORT','SRC-IP','DEVICE-NAME','MAC-ADDRESS','PROTOCOL','HOSTNAME-TYPE','SUBNET','CELLULAR-RADIO','CELLULAR-CARRIER','SCRIPT']);
const policies=new Set(['DIRECT','REJECT','REJECT-DROP','REJECT-NO-DROP','REJECT-TINYGIF']);
function failure(location,message){throw Error(location+': '+message);}
function splitFields(text,delimiter,depthAware=false){
 const fields=[];let start=0,quote=null,depth=0;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='\\'&&quote&&text[i+1]===quote){i++;continue;}
  if(c==='\\'&&quote&&text[i+1]==='\\'){i++;continue;}
  if(quote){if(c===quote)quote=null;continue;}
  if(c==='"'||c==="'"){quote=c;continue;}
  if(depthAware&&c==='(')depth++;
  if(depthAware&&c===')'){depth--;if(depth<0)throw Error('Unbalanced parentheses');}
  const separator=delimiter==='space'?/\s/.test(c):c===delimiter;
  if(separator&&depth===0){const value=text.slice(start,i).trim();if(value||delimiter!=='space')fields.push(value);start=i+1;}
 }
 if(quote)throw Error('Unclosed quoted value');
 if(depthAware&&depth!==0)throw Error('Unbalanced parentheses');
 const value=text.slice(start).trim();if(value||delimiter!=='space')fields.push(value);
 return fields;
}
function unquote(value,strict=false){
 if(value?.[0]!=='"'&&value?.[0]!=="'")return value;
 const quote=value[0];let result='',closed=false;
 for(let i=1;i<value.length;i++){
  const c=value[i];
  if(c==='\\'&&(value[i+1]===quote||value[i+1]==='\\')){result+=value[++i];continue;}
  if(c===quote){closed=true;if(i!==value.length-1){if(strict)throw Error('Unescaped quote inside quoted value');return value.slice(1,-1);}break;}
  result+=c;
 }
 if(!closed)throw Error('Unclosed quoted value');
 return result;
}
function parameters(text,location){const result={};for(const field of splitFields(text,',')){const at=field.indexOf('=');if(at<=0)failure(location,'Expected key=value script parameter');const key=field.slice(0,at).trim();if(has(result,key))failure(location,'Duplicate script parameter '+key);result[key]=field.slice(at+1).trim();}return result;}
function sections(text,location){
 const result={};let current=null;
 for(const [index,raw] of text.replace(/^\uFEFF/,'').split(/\r?\n/).entries()){
  const row=raw.trim(),line=index+1;
  if(/^\[.*\]$/.test(row)){current=row.slice(1,-1);if(has(result,current))failure(location+':'+line,'Duplicate section');result[current]=[];continue;}
  if(!row||/^(?:#|;|\/\/)/.test(row))continue;
  if(current)result[current].push({raw:row,line});
 }
 return result;
}
function isModule(text){return /^#!\s*name\s*=/m.test(text)&&/^\[(?:Script|Rule|MITM|URL Rewrite|Map Local|Body Rewrite)\]\s*$/m.test(text);}
function isRuntimeText(text){return /\$(?:done|request|response|script|httpClient|persistentStore)\b/.test(text)&&/^\s*(?:\/\*|\/\/|[;(]|['"]use strict|(?:const|let|var|function|if|try)\b)/.test(text.replace(/^\uFEFF/,''));}
function compilePattern(value,location){try{return new RegExp(unquote(value));}catch{failure(location,'Invalid URL regular expression');}}
function within(root,file){const relative=path.relative(root,file);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
function ownPath(value,owner,repo){
 const url=new URL(value);if(url.hostname!=='raw.githubusercontent.com')return null;
 const parts=url.pathname.split('/').filter(Boolean);if(parts[0]?.toLowerCase()!==owner.toLowerCase()||parts[1]?.toLowerCase()!==repo.toLowerCase())return null;
 const start=parts[2]==='refs'&&parts[3]==='heads'?5:3;
 return parts.slice(start).map(decodeURIComponent).join('/');
}
function verifyTree(node,location,depth=0){
 if(['AND','OR','NOT'].includes(node.type)){
  if(depth>=10)failure(location,'Logical rule depth exceeds 10');
  if(!node.children.length||(node.type==='NOT'&&node.children.length!==1))failure(location,'Invalid logical rule arity');
  for(const child of node.children)verifyTree(child,location,depth+1);
 }else if(!ruleTypes.has(node.type)||!node.value)failure(location,'Invalid native rule leaf');
}
function validate(root=path.resolve(__dirname,'..')){
 root=path.resolve(root);
 const configFile=path.join(root,'.adblock','config.json');
 const config=fs.existsSync(configFile)?JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,'')):{};
 const repository=config.repository||'Feng-Feng1/surge';
 const [owner,repo]=repository.split('/');
 const summary={passed:true,rootModules:0,moduleFiles:[],rootRuntimeFiles:0,rootJSONFiles:0,URLPatterns:0,scriptBindings:0,localResourceBindings:0,contentAddressedResources:0,warnings:[],limits:['Static official-format checks and Node JavaScript syntax; not Surge native parsing or phone validation.','External upstream availability/bytes are checked by the update builder, not this offline validator.','Installed module order and base-profile MITM exclusions are outside this repository.']};
 const runtimes=new Map(),resources=new Map();
 function resource(value,location,script=false){
  value=unquote(value,true);let relative;
  if(/^https?:\/\//.test(value)){try{relative=ownPath(value,owner,repo);}catch{failure(location,'Invalid script/resource URL');}if(relative===null)return null;}
  else relative=value;
  const file=path.resolve(root,relative);if(!within(root,file))failure(location,'Resource leaves repository directory');
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())failure(location,'Referenced local/own-repository resource is missing');
  const bytes=fs.readFileSync(file);summary.localResourceBindings++;
  const hashName=path.basename(file).match(/^([a-f0-9]{64})\.(?:js|txt|list|domain-set)$/);
  if(relative.startsWith('Resources/AdBlock/')&&!hashName)failure(location,'Own immutable resource must use a content hash filename');
  if(hashName){if(sha(bytes)!==hashName[1])failure(location,'Content-addressed resource hash mismatch');if(!resources.has(file)){resources.set(file,true);summary.contentAddressedResources++;}}
  if(script){const source=bytes.toString('utf8');if(isModule(source))failure(location,'script-path points to module text');try{new vm.Script(source,{filename:relative});}catch{failure(location,'Referenced JavaScript syntax does not compile');}return source;}
  return bytes.toString('utf8');
 }
 const rootFiles=fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isFile()).map(e=>e.name);
 for(const file of rootFiles){
  const text=fs.readFileSync(path.join(root,file),'utf8');
  if(file.endsWith('.json')){try{JSON.parse(text.replace(/^\uFEFF/,''));summary.rootJSONFiles++;}catch{failure(file,'Invalid JSON file');}}
  if(file.endsWith('.sgmodule')||isModule(text)){summary.rootModules++;summary.moduleFiles.push(file);validateModule(file,text);}
  else if(file.endsWith('.js')||file.endsWith('.cjs')||(file.endsWith('.txt')&&isRuntimeText(text))){try{new vm.Script(text,{filename:file});}catch{failure(file,'Root JavaScript syntax does not compile');}runtimes.set(file,sha(Buffer.from(text)));summary.rootRuntimeFiles++;}
 }
 function validateModule(file,text){
  const section=sections(text,file),names=new Set();
  for(const name of Object.keys(section))if(/^Ruleset\s/.test(name)||name==='Snell Server')failure(file,'Module feature requires iOS 5.23+, beyond target 5.22.1');
  for(const row of section.Script||[]){
   const location=file+':'+row.line;let name,fields;
   const legacy=row.raw.match(/^(http-request|http-response)\s+(\S+)\s+(.+)$/);
   if(legacy){fields={type:legacy[1],pattern:legacy[2],...parameters(legacy[3],location)};name=path.basename(unquote(fields['script-path']||''));summary.warnings.push({file,line:row.line,kind:'legacy-script-form'});}
   else {const at=row.raw.indexOf('=');if(at<=0)failure(location,'Invalid script declaration');name=row.raw.slice(0,at).trim();fields=parameters(row.raw.slice(at+1),location);}
   if(!name||names.has(name))failure(location,'Missing/duplicate script name');names.add(name);
   if(!fields['script-path'])failure(location,'Script requires script-path');
   const type=fields.type||'generic';if(!allowedTypes.has(type))failure(location,'Unknown script type');
   if(!has(fields,'type'))summary.warnings.push({file,line:row.line,kind:'implicit-generic-type'});
   if(type==='http-request'||type==='http-response'){if(!fields.pattern)failure(location,'HTTP script requires pattern');compilePattern(fields.pattern,location);summary.URLPatterns++;}
   if(type==='cron'&&!fields.cronexp)failure(location,'Cron script requires cronexp');
   if(type==='event'&&!fields['event-name'])failure(location,'Event script requires event-name');
   for(const key of ['requires-body','binary-body-mode','full-header-mode','debug','wake-system'])if(has(fields,key)&&!['true','false','1','0'].includes(fields[key]))failure(location,'Invalid Boolean '+key);
   if(has(fields,'max-size')&&(!/^-?\d+$/.test(fields['max-size'])||Number(fields['max-size']) < -1))failure(location,'Invalid max-size');
   if(fields['max-size']==='-1')summary.warnings.push({file,line:row.line,kind:'unbounded-body-preserved'});
   if(has(fields,'timeout')&&(!Number.isFinite(Number(fields.timeout))||Number(fields.timeout)<=0))failure(location,'Invalid timeout');
   if(has(fields,'script-update-interval')&&!/^-?\d+$/.test(fields['script-update-interval']))failure(location,'Invalid script-update-interval');
   if(has(fields,'engine')&&!['auto','jsc','webview'].includes(fields.engine))failure(location,'Invalid script engine');
   if(truth(fields['binary-body-mode'])&&!truth(fields['requires-body']))failure(location,'Binary body binding requires body access');
   for(const key of Object.keys(fields))if(!scriptKeys.has(key))summary.warnings.push({file,line:row.line,kind:'undocumented-script-parameter',key});
   if(has(fields,'argument'))unquote(fields.argument,true);
   const source=resource(fields['script-path'],location,true);
   if(type==='http-response'&&source&&/\$response\.(?:body|bodyBytes)\b/.test(source)&&!truth(fields['requires-body']))failure(location,'Body-reading response script lacks requires-body');
   if(source&&fields.argument&&/JSON\.parse\(\$argument\)/.test(source)){
    const argument=unquote(fields.argument,true);if(argument.startsWith('{')&&!argument.includes('{{{')){try{JSON.parse(argument);}catch{failure(location,'JSON-consuming script has invalid JSON argument');}}
   }
   summary.scriptBindings++;
  }
  for(const row of section['URL Rewrite']||[]){const location=file+':'+row.line,tokens=splitFields(row.raw,'space');if(![2,3].includes(tokens.length)||!['header','302','307','reject'].includes(tokens[2]||'header'))failure(location,'Invalid URL Rewrite declaration');compilePattern(tokens[0],location);summary.URLPatterns++;}
  for(const row of section['Map Local']||[]){
   const location=file+':'+row.line,tokens=splitFields(row.raw,'space');compilePattern(tokens.shift(),location);summary.URLPatterns++;const fields={};
   for(const token of tokens){const at=token.indexOf('=');if(at<=0)failure(location,'Map Local requires key=value options');const key=token.slice(0,at);if(has(fields,key))failure(location,'Duplicate Map Local option');fields[key]=token.slice(at+1);}
   const type=fields['data-type']||'file';if(!['file','text','tiny-gif','base64'].includes(type))failure(location,'Invalid Map Local data-type');
   if(has(fields,'status-code')&&(!/^\d+$/.test(fields['status-code'])||Number(fields['status-code'])<200||Number(fields['status-code'])>999))failure(location,'Invalid Map Local status-code');
   if(type!=='tiny-gif'&&!has(fields,'data'))failure(location,'Map Local data missing');
   for(const key of ['data','header'])if(has(fields,key))unquote(fields[key],true);
   if(type==='file')resource(fields.data,location,false);
   if(type==='base64'){const data=unquote(fields.data,true);if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))failure(location,'Invalid Map Local base64');}
  }
  for(const row of section['Body Rewrite']||[]){const location=file+':'+row.line,tokens=splitFields(row.raw,'space');if(!['http-request','http-response','http-request-jq','http-response-jq'].includes(tokens[0]))failure(location,'Invalid Body Rewrite type');if(tokens.length<3||(!tokens[0].endsWith('-jq')&&(tokens.length<4||tokens.length%2!==0)))failure(location,'Invalid Body Rewrite parameter count');compilePattern(tokens[1],location);summary.URLPatterns++;if(!tokens[0].endsWith('-jq'))for(let i=2;i<tokens.length;i+=2)compilePattern(tokens[i],location);}
  for(const row of section['Header Rewrite']||[]){const location=file+':'+row.line,tokens=splitFields(row.raw,'space');if(!['http-request','http-response'].includes(tokens[0])||tokens.length<4)failure(location,'Invalid Header Rewrite declaration');compilePattern(tokens[1],location);summary.URLPatterns++;if(/^(?:content-length|transfer-encoding)$/i.test(unquote(tokens[3])))failure(location,'Header Rewrite must not mutate framing headers');}
  for(const row of section.Rule||[]){
   const location=file+':'+row.line,tokens=splitFields(row.raw,',',true);if(tokens.length<3||!policies.has(tokens[2]))failure(location,'Module rule must use an internal policy');
   let node;try{node=parseNode(tokens.slice(0,2).join(','));}catch{failure(location,'Invalid native rule structure');}verifyTree(node,location);
   function inspect(n){if(n.type==='URL-REGEX'){compilePattern(n.value,location);summary.URLPatterns++;}if(['RULE-SET','DOMAIN-SET'].includes(n.type)&&/^https?:\/\//.test(n.value))resource(n.value,location,false);for(const c of n.children||[])inspect(c);}inspect(node);
  }
  for(const row of section.MITM||[]){const location=file+':'+row.line,m=row.raw.match(/^([\w-]+)\s*=\s*(.*)$/);if(!m)failure(location,'Invalid MITM assignment');if(!['hostname','skip-server-cert-verify'].includes(m[1]))failure(location,'Module cannot set this MITM field');if(m[1]==='hostname'){if(!/^%(?:APPEND|INSERT)%\s/.test(m[2]))summary.warnings.push({file,line:row.line,kind:'mitm-hostname-replaces-base'});const hosts=m[2].replace(/^%(?:APPEND|INSERT)%\s*/,'').split(',').map(x=>x.trim());if(hosts.some(h=>!h||/\s/.test(h)))failure(location,'Empty/whitespace MITM hostname entry');}}
 }
 function checkPrivacy(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){if(entry.name==='.git'||entry.name==='node_modules')continue;const file=path.join(directory,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory())checkPrivacy(file);else if(/\.har$/i.test(entry.name))failure(path.relative(root,file),'Private HAR capture must not be included in deployment repository');}}
 checkPrivacy(root);
 return summary;
}
module.exports={validate,sections,splitFields,parameters,unquote,isModule,isRuntimeText,verifyTree};
if(require.main===module){try{console.log(JSON.stringify(validate(process.argv[2]&&path.resolve(process.argv[2]))));}catch(e){console.error('Repository validation failed: '+e.message);process.exitCode=1;}}

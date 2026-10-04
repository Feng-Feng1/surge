'use strict';

// Node 20+, no dependencies or network/file writes. Input: official AdGuard DNS
// filter only, not browser Chinese/Mobile filters. Output requires an AND+NOT
// exception carve in Surge; exceptionRules must never become global DIRECT.
const { isIP } = require('node:net');
const { createHash } = require('node:crypto');
const NON_DNS_EXCEPTION = String.raw`@@/\.(gif|jpe?g|png|webp)#(\/?.+)?(\/(ad)s?\/|\/ad-)/`;
const HOST_FRAGMENT_EXCEPTION = '@@-ds.metric.gstatic.com^|';

class ConversionError extends Error {
  constructor(message, line, raw, code = 'UNSUPPORTED_EXCEPTION') {
    super(`${message} (line ${line})`);
    this.name = 'ConversionError'; this.code = code; this.line = line; this.raw = raw;
  }
}

function validHostname(host) {
  return typeof host === 'string' && host.length <= 253 && host.includes('.') &&
    !isIP(host) && !/^\d+$/.test(host.split('.').at(-1)) &&
    host.split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}

function splitModifiers(value) {
  const result = []; let current = '', quote = null, escaped = false;
  for (const char of value) {
    if (escaped) { current += char; escaped = false; continue; }
    if (char === '\\') { current += char; escaped = true; continue; }
    if (quote) { current += char; if (char === quote) quote = null; continue; }
    if (char === "'" || char === '"') { current += char; quote = char; continue; }
    if (char === ',') { result.push(current.trim()); current = ''; continue; }
    current += char;
  }
  result.push(current.trim());
  return {values: result, valid: !quote && !escaped && result.every(Boolean)};
}

function parseRule(raw, line) {
  const exception = raw.startsWith('@@');
  const body = exception ? raw.slice(2) : raw;
  let modifierIndex = -1, malformed = false;
  if (body.startsWith('/')) {
    let escaped = false, end = -1;
    for (let i = 1; i < body.length; i++) {
      if (escaped) { escaped = false; continue; }
      if (body[i] === '\\') { escaped = true; continue; }
      if (body[i] === '/') { end = i; break; }
    }
    if (end < 0) malformed = true;
    else if (body[end + 1] === '$') modifierIndex = end + 1;
    else if (end !== body.length - 1) malformed = true;
  } else modifierIndex = body.indexOf('$');
  const pattern = modifierIndex < 0 ? body : body.slice(0, modifierIndex);
  const split = modifierIndex < 0 ? {values:[],valid:true} : splitModifiers(body.slice(modifierIndex+1));
  const modifiers = split.values;
  const normalized = modifiers.map(m => {
    const at=m.indexOf('='); return at < 0 ? m.toLowerCase() : m.slice(0,at).toLowerCase()+m.slice(at);
  });
  const canonical = (omitBadfilter=false) => (exception?'@@':'') + pattern +
    ((omitBadfilter ? normalized.filter(m=>m!=='badfilter') : normalized).length ? '$'+
      [...new Set(omitBadfilter ? normalized.filter(m=>m!=='badfilter') : normalized)].sort().join(',') : '');
  return {raw,line,exception,pattern,modifiers,normalized,malformed:malformed||!split.valid,canonical};
}

function blockEntry(rule) {
  if (rule.malformed) return {reason:'malformed rule'};
  if (rule.normalized.some(m=>m!=='important')) return {reason:'unsupported block modifier; retained scope must not be stripped'};
  let match=/^\|\|([a-z0-9.-]+)\^\|?$/i.exec(rule.pattern);
  if (match && validHostname(match[1])) return {entry:'.'+match[1].toLowerCase(),kind:'suffix'};
  match=/^\|([a-z0-9.-]+)\^\|$/i.exec(rule.pattern);
  if (match && validHostname(match[1])) return {entry:match[1].toLowerCase(),kind:'exact'};
  if (validHostname(rule.pattern)) return {entry:rule.pattern.toLowerCase(),kind:'exact'};
  return {reason:'unsupported block pattern, path, wildcard, regex, IP, or invalid hostname'};
}

function validHostnameMask(mask) {
  return mask.length <= 253 && mask.includes('.') && mask.includes('*') &&
    /^[a-z0-9*.-]+$/i.test(mask) && !mask.startsWith('.') && !mask.endsWith('.') && !mask.includes('..') &&
    mask.split('.').every(label=>label.length<=63 && (label.includes('*') || /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)));
}

function exceptionEntries(rule) {
  if (rule.malformed) throw new ConversionError('Cannot safely parse exception',rule.line,rule.raw);
  // This exact upstream URL exception requires a literal #. DNS QNAME hostnames
  // cannot contain it. Any different/modified regex exception fails publication.
  if (rule.raw === NON_DNS_EXCEPTION) return {entries:[],kind:'non_dns_url_regex',reason:'Exact upstream regex requires literal #; cannot match a DNS hostname.'};
  if (rule.pattern.startsWith('/')) throw new ConversionError('New regex exception requires explicit semantic review',rule.line,rule.raw);
  let match=/^\|\|([a-z0-9.-]+)\^\|?$/i.exec(rule.pattern);
  if (match && validHostname(match[1])) return {entries:['DOMAIN-SUFFIX,'+match[1].toLowerCase()],kind:'suffix'};
  match=/^\|([a-z0-9.-]+)\^\|$/i.exec(rule.pattern);
  if (match && validHostname(match[1])) return {entries:['DOMAIN,'+match[1].toLowerCase()],kind:'exact'};
  if (validHostname(rule.pattern)) return {entries:['DOMAIN,'+rule.pattern.toLowerCase()],kind:'exact'};
  match=/^\|\|([a-z0-9*.-]+)\^\|?$/i.exec(rule.pattern);
  if (match && validHostnameMask(match[1])) {
    const mask=match[1].toLowerCase();
    return {entries:['DOMAIN-WILDCARD,'+mask,'DOMAIN-WILDCARD,*.'+mask],kind:'wildcard_suffix',reason:'AdGuard || applies to root matching mask and any additional subdomain; retain both native masks.'};
  }
  if (rule.raw === HOST_FRAGMENT_EXCEPTION) return {entries:['DOMAIN-WILDCARD,*-ds.metric.gstatic.com'],kind:'terminal_host_fragment',reason:'Exact upstream unanchored fragment is anchored at hostname end; native * preserves any valid hostname prefix.'};
  throw new ConversionError('New exception pattern requires explicit semantic review',rule.line,rule.raw);
}

function convert(text) {
  if (typeof text !== 'string') throw new TypeError('convert(text) requires a UTF-8 source string');
  const stats={totalLines:0,blankLines:0,commentLines:0,headerLines:0,inputBlockRules:0,inputExceptionRules:0,
    badfilterDirectives:0,disabledRules:0,disabledBlockRules:0,disabledExceptionRules:0,
    convertedBlockRules:0,convertedSuffixBlocks:0,convertedExactBlocks:0,importantBlocksConverted:0,
    skippedBlockRules:0,activeExceptionRules:0,convertedSuffixExceptions:0,convertedExactExceptions:0,
    convertedWildcardExceptions:0,convertedFragmentExceptions:0,ignoredNonDNSExceptions:0,
    broadenedModifierExceptions:0,blockEntryCount:0,exceptionRuleCount:0};
  const metadata={},rules=[],badfilterAudit=[],skippedBlocks=[],exceptionAudit=[],disabledRows=[];
  const metadataKeys=new Set(['Title','Description','Homepage','License','Last modified','Version','Expires','Checksum']);
  let metadataOpen=true;
  const rawLines=text.replace(/^\uFEFF/,'').split(/\r?\n/);stats.totalLines=rawLines.length;
  for (const [i,value] of rawLines.entries()) {
    const raw=value.trim(),line=i+1;
    if (!raw) {stats.blankLines++;continue;}
    if (/^!#(?:if|else|elif|endif|include)\b/.test(raw)) throw new ConversionError('DNS source unexpectedly contains a conditional/include directive',line,raw,'UNSUPPORTED_DIRECTIVE');
    if (/^[!#]/.test(raw)) {
      stats.commentLines++;
      if(raw.startsWith('! Source name:')||raw.startsWith('! Source:'))metadataOpen=false;
      const header=/^!\s*([A-Za-z][A-Za-z -]*):\s*(.+)$/.exec(raw);
      if(metadataOpen&&header&&metadataKeys.has(header[1])&&!Object.hasOwn(metadata,header[1]))metadata[header[1]]=header[2];
      continue;
    }
    if (/^\[Adblock(?: Plus)?(?: [^\]]+)?\]$/i.test(raw)) {stats.headerLines++;continue;}
    metadataOpen=false;
    const rule=parseRule(raw,line);rules.push(rule);
    stats[rule.exception?'inputExceptionRules':'inputBlockRules']++;
  }
  // Two passes are necessary: badfilter directives can occur after their target.
  // Canonical modifier ordering preserves complete rule scope, including values.
  const disabled=new Set();
  for (const rule of rules) if (!rule.malformed && rule.normalized.includes('badfilter')) {
    const target=rule.canonical(true);disabled.add(target);stats.badfilterDirectives++;
    badfilterAudit.push({line:rule.line,raw:rule.raw,target,matchingLines:rules.filter(r=>!r.normalized.includes('badfilter')&&r.canonical()===target).map(r=>r.line)});
  }
  const blocks=new Set(),exceptions=new Set();
  for (const rule of rules) {
    if (!rule.malformed && rule.normalized.includes('badfilter'))continue;
    if (disabled.has(rule.canonical())) {
      stats.disabledRules++;stats[rule.exception?'disabledExceptionRules':'disabledBlockRules']++;
      disabledRows.push({line:rule.line,raw:rule.raw});continue;
    }
    // DNS rewrites have higher priority than ordinary blocking. Ignoring a
    // positive rewrite while retaining a same-host ordinary block can overblock.
    if(rule.normalized.some(m=>m.split('=')[0]==='dnsrewrite')) {
      throw new ConversionError('Active DNS rewrite cannot be represented by routing rejection',rule.line,rule.raw,'UNSUPPORTED_DNSREWRITE');
    }
    if (rule.exception) {
      stats.activeExceptionRules++;
      const result=exceptionEntries(rule);
      for(const entry of result.entries)exceptions.add(entry);
      const key={suffix:'convertedSuffixExceptions',exact:'convertedExactExceptions',wildcard_suffix:'convertedWildcardExceptions',terminal_host_fragment:'convertedFragmentExceptions',non_dns_url_regex:'ignoredNonDNSExceptions'}[result.kind];
      stats[key]++;
      const broadened=rule.modifiers.length>0;
      if(broadened)stats.broadenedModifierExceptions++;
      exceptionAudit.push({line:rule.line,raw:rule.raw,kind:result.kind,nativeRules:result.entries,modifiers:rule.modifiers,
        modifierScopeBroadened:broadened,reason:result.reason||(broadened?'Exception modifiers removed to allow conservatively broader scope.':'Equivalent hostname matching for supported DNS pattern.')});
    } else {
      const result=blockEntry(rule);
      if(!result.entry){stats.skippedBlockRules++;if(skippedBlocks.length<40)skippedBlocks.push({line:rule.line,raw:rule.raw,reason:result.reason});continue;}
      blocks.add(result.entry);stats.convertedBlockRules++;
      stats[result.kind==='suffix'?'convertedSuffixBlocks':'convertedExactBlocks']++;
      if(rule.normalized.includes('important'))stats.importantBlocksConverted++;
    }
  }
  const blockEntries=[...blocks].sort(),exceptionRules=[...exceptions].sort();
  stats.blockEntryCount=blockEntries.length;stats.exceptionRuleCount=exceptionRules.length;
  return {blockEntries,exceptionRules,stats,metadata,sourceSha256:createHash('sha256').update(text,'utf8').digest('hex'),
    semantics:{input:'Official AdGuard DNS filter only',blockFormat:'Surge native DOMAIN-SET: .host suffix or host exact',exceptionFormat:'Surge native RULE-SET without policy',
      exceptionPriority:'All exceptions override all blocks, including $important blocks; deliberately allows more than AdGuard in such conflicts.',
      integration:'Caller MUST reject only when block set matches AND exception set does not match, and preserve independent app/map compatibility guards. Never install exceptionRules as global DIRECT.',
      unsupportedBlocks:'Skipped instead of broadening their scope; active dnsrewrite fails conversion because its higher priority can change ordinary blocking.',unsupportedExceptions:'Throw ConversionError; caller must preserve previously published complete snapshot.',
      limits:['Routing rejection is not a DNS response rewrite.','No CNAME resolution, cosmetic/DOM/scriptlet/native-app-container filtering.','No independent public suffix list: input must remain the official validated DNS product, with caller compatibility and shared-provider-root protections.']},
    audit:{badfilters:badfilterAudit,disabledRows,exceptions:exceptionAudit,skippedBlockExamples:skippedBlocks}};
}

module.exports={convert,validHostname,ConversionError,NON_DNS_EXCEPTION};

if(require.main===module) {
  const filename=process.argv[2];
  if(!filename){process.stderr.write('Usage: node convert-adguard.cjs official-dns-filter.txt\n');process.exitCode=2;}
  else {
    try {const result=convert(require('node:fs').readFileSync(filename,'utf8'));process.stdout.write(JSON.stringify({stats:result.stats,metadata:result.metadata,sourceSha256:result.sourceSha256,semantics:result.semantics},null,2)+'\n');}
    catch(error){process.stderr.write(`${error.name}: ${error.message}\n`);process.exitCode=1;}
  }
}

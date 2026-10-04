/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {convert}=require('./convert-adguard.cjs');
const {buildProtection,parseNode}=require('./build-protection.cjs');
const {parseRaw,validateRuleSet,immutableWrite,requireText}=require('./build-update.cjs');
const results=[];function check(name,fn){fn();results.push(name);}
check('DNS suffix and exact forms remain different',()=>{const x=convert('||ads.example.com^\n|exact.example.net^|\nplain.example.net');assert.ok(x.blockEntries.includes('.ads.example.com'));assert.ok(x.blockEntries.includes('exact.example.net'));assert.ok(x.blockEntries.includes('plain.example.net'));});
check('Wildcard exception covers root and descendants',()=>{const x=convert('||example.com^\n@@||cdn*.example.com^|');assert.ok(x.exceptionRules.includes('DOMAIN-WILDCARD,cdn*.example.com'));assert.ok(x.exceptionRules.includes('DOMAIN-WILDCARD,*.cdn*.example.com'));});
check('Exceptions never emit global DIRECT',()=>assert.ok(convert('||example.com^\n@@||example.com^').exceptionRules.every(x=>!x.includes('DIRECT'))));
check('Important remains conservatively subject to exceptions',()=>{const x=convert('||example.com^$important\n@@||example.com^');assert.ok(x.blockEntries.includes('.example.com'));assert.ok(x.exceptionRules.includes('DOMAIN-SUFFIX,example.com'));});
check('Badfilter disables the matching original',()=>assert.ok(!convert('||example.com^\n||example.com^$badfilter').blockEntries.includes('.example.com')));
check('Context block is never broadened to global domain',()=>assert.equal(convert('||example.com^$third-party\n||other.example.net^').blockEntries.length,1));
check('Unknown regular expression exception fails update',()=>assert.throws(()=>convert('||example.com^\n@@/unknown-expression/')));
check('Active DNS rewrite fails update',()=>assert.throws(()=>convert('||example.com^\n||other.example.net^$dnsrewrite=NXDOMAIN;;')));
check('Explicit non-DNS image URL exception is accounted for',()=>assert.doesNotThrow(()=>convert(String.raw`||example.com^
@@/\.(gif|jpe?g|png|webp)#(\/?.+)?(\/(ad)s?\/|\/ad-)/`)));
check('Native logical rules are validated recursively',()=>assert.equal(validateRuleSet(Array(10).fill('AND,((DOMAIN,a.example.com),(NOT,((DOMAIN-SUFFIX,keep.example.com))))').join('\n')),10));
check('Unknown native rule leaf is rejected',()=>assert.throws(()=>validateRuleSet(Array(10).fill('AND,((DOMAIN,a.example.com),(SURPRISE,a.example.net))').join('\n'))));
check('Native nesting limit permits ten logical levels and rejects eleven',()=>{let row='DOMAIN,a.example.com';for(let n=0;n<10;n++)row='NOT,(('+row+'))';assert.equal(validateRuleSet(Array(10).fill(row).join('\n')),10);assert.throws(()=>validateRuleSet(Array(10).fill('NOT,(('+row+'))').join('\n')));});
check('Native policy embedded in source list is rejected',()=>assert.throws(()=>validateRuleSet(Array(10).fill('DOMAIN,a.example.com,REJECT').join('\n'))));
check('Raw branch and refs/heads paths resolve identically',()=>assert.deepEqual(parseRaw('https://raw.githubusercontent.com/owner/repo/refs/heads/main/file.js'),parseRaw('https://raw.githubusercontent.com/owner/repo/main/file.js')));
check('HTML status200 content is rejected',()=>assert.throws(()=>requireText({buffer:Buffer.from('<html>'),contentType:'text/html',finalURL:'https://example.com/x'},'https://example.com/x')));
check('Unexpected source redirect is rejected',()=>assert.throws(()=>requireText({buffer:Buffer.from('public'),contentType:'text/plain',finalURL:'https://example.com/'},'https://example.com/x')));
check('Compatibility protects baseline interfaces and map requests',()=>{const x=buildProtection(fs.readFileSync(path.join(__dirname,'baseline','AdBlock-AllInOne.sgmodule'),'utf8'));assert.ok(x.sortedRows.includes('DOMAIN-SUFFIX,map.baidu.com,extended-matching'));assert.ok(x.sortedRows.some(s=>s.startsWith('DOMAIN,sdk.e.qq.com,')));assert.ok(x.sortedRows.some(s=>s.includes('v2mi.gdt.qq.com')));});
check('Immutable resources cannot be overwritten',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'adblock-immutable-'));immutableWrite(dir,'synthetic.txt',Buffer.from('first'));assert.throws(()=>immutableWrite(dir,'synthetic.txt',Buffer.from('second')));assert.equal(fs.readFileSync(path.join(dir,'Resources','AdBlock','synthetic.txt'),'utf8'),'first');});
check('Native AND supports exactly scoped NOT predicates',()=>{const x=parseNode('AND,((DOMAIN-SET,https://example.com/d,update-interval=-1),(NOT,((RULE-SET,https://example.com/a,update-interval=-1))),(NOT,((RULE-SET,https://example.com/p,update-interval=-1))))');assert.equal(x.children.length,3);assert.equal(x.children[1].children[0].type,'RULE-SET');});
console.log(JSON.stringify({passed:true,checks:results.length,names:results}));

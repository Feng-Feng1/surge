/* SPDX-License-Identifier: GPL-3.0-only */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// The templates are the editable source; root modules are the generated delivery.
function readTemplates(root) {
  const directory = path.join(root, '.adblock', 'modules');
  if (!fs.existsSync(directory)) throw Error('Missing module template directory');
  const names=fs.readdirSync(directory).sort();
  if(!names.length) throw Error('Empty module template directory');
  for(const name of fs.readdirSync(root)) {
    const isRootModule=name.endsWith('.sgmodule')||(name.endsWith('.js')&&/^#!name\s*=/m.test(fs.readFileSync(path.join(root,name),'utf8')));
    if(isRootModule && name!=='AdBlock-AllInOne.sgmodule' && !names.includes(name)) throw Error('Root module has no maintenance template: '+name);
  }
  return names.map(name => {
    if (!/^[A-Za-z0-9_.-]+\.(?:sgmodule|js)$/.test(name)) throw Error('Unexpected module template name');
    const text = fs.readFileSync(path.join(directory, name), 'utf8').replace(/\r\n/g, '\n');
    if (!/^#!name\s*=/m.test(text) || !/^\[(?:Script|Rule|URL Rewrite|Map Local)\]$/m.test(text)) throw Error('Invalid module template: ' + name);
    return {name, text};
  });
}

function renderTemplates(templates, replacements, version) {
  return templates.map(({name, text}) => {
    for (const [source, pinned] of replacements) text = text.replaceAll(source, pinned);
    // A fixed resource may be checked periodically; it cannot select newer code.
    text = text.replace(/script-update-interval=-1/g, 'script-update-interval=86400');
    if (/^#!version\s*=/m.test(text)) text = text.replace(/^#!version\s*=.*$/m, '#!version=' + version);
    else text = '#!version=' + version + '\n' + text;
    return {name, text, sha256: sha(text)};
  });
}

function verifyRollbacks(root, records) {
  if (!Array.isArray(records) || !records.length) throw Error('Missing rollback integrity records');
  for (const record of records) {
    if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(record.version)) throw Error('Invalid rollback version');
    for (const [name, expected] of [['AdBlock-AllInOne.sgmodule', record.moduleSHA256], ['AdBlock-AppClean-V5.txt', record.sharedSHA256]]) {
      const bytes = fs.readFileSync(path.join(root, 'Rollback', record.version, name));
      if (sha(bytes) !== expected) throw Error('Rollback integrity failed: ' + record.version + '/' + name);
    }
  }
}

module.exports = {readTemplates, renderTemplates, verifyRollbacks};

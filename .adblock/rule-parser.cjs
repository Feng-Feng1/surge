/* SPDX-License-Identifier: MIT */
'use strict';

function splitTopLevel(text) {
  const result=[];let start=0,depth=0,quote='',escaped=false;
  for(let at=0;at<text.length;at++) {
    const c=text[at];
    if(escaped){escaped=false;continue;}
    if(c==='\\'){escaped=true;continue;}
    if(quote){if(c===quote)quote='';continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='(')depth++;
    else if(c===')'){if(--depth<0)throw Error('Unbalanced rule parentheses');}
    else if(c===','&&depth===0){result.push(text.slice(start,at).trim());start=at+1;}
  }
  if(depth!==0||quote)throw Error('Unbalanced rule expression');
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
  throw Error('Unbalanced predicate parentheses');
}

function parseNode(text) {
  let unwrapped;while((unwrapped=unwrapOne(text))!==null)text=unwrapped;
  const fields=splitTopLevel(text),type=fields[0].toUpperCase();
  if(['AND','OR','NOT'].includes(type)) {
    if(fields.length!==2)throw Error('Unexpected logical predicate fields');
    const list=unwrapOne(fields[1]);if(list===null)throw Error('Logical predicate list missing parentheses');
    const children=splitTopLevel(list).map(parseNode);
    if(type==='NOT'&&children.length!==1)throw Error('NOT requires exactly one predicate');
    return {type,children};
  }
  return {type,value:fields[1],parameters:fields.slice(2)};
}

function renderNode(node) {
  if(node.children)return node.type+',(('+node.children.map(renderNode).join('),(')+'))';
  return [node.type,node.value,...(node.parameters||[])].join(',');
}

module.exports={splitTopLevel,unwrapOne,parseNode,renderNode};

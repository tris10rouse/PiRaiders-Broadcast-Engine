'use strict';
// Bounded transport decoding, not a contract/schema or playback validator.
const {TextDecoder}=require('node:util');
function parseExchangeJSON(bytes){
  if(!Buffer.isBuffer(bytes))throw Error('METADATA_INVALID');
  let source;try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw Error('METADATA_INVALID');}
  if(source.charCodeAt(0)===0xfeff)throw Error('METADATA_INVALID');
  let cursor=0,nodes=0;
  function fail(){throw Error('METADATA_INVALID');}
  function space(){while([' ','\t','\r','\n'].includes(source[cursor]))cursor++;}
  function string(){
    const start=cursor++;let escaped=false,ended=false;
    while(cursor<source.length){const character=source[cursor++];if(!escaped&&character==='"'){ended=true;break;}if(!escaped&&character==='\\')escaped=true;else escaped=false;}
    if(!ended)fail();let value;try{value=JSON.parse(source.slice(start,cursor));}catch{fail();}
    // RFC8785 cannot canonicalize unpaired UTF16 surrogates. Reject before a
    // later semantic validator can accidentally hash replacement characters.
    for(let index=0;index<value.length;index++){const unit=value.charCodeAt(index);if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(++index);if(!(next>=0xdc00&&next<=0xdfff))fail();}else if(unit>=0xdc00&&unit<=0xdfff)fail();}
    return value;
  }
  function value(depth){
    if(++nodes>300000||depth>32)fail();space();const character=source[cursor];
    if(character==='"')return string();
    if(character==='{'){
      cursor++;space();const result=Object.create(null),keys=new Set();if(source[cursor]==='}'){cursor++;return Object.freeze(result);}
      for(;;){space();if(source[cursor]!=='"')fail();const key=string();if(keys.has(key))fail();keys.add(key);space();if(source[cursor++]!==':')fail();result[key]=value(depth+1);space();const end=source[cursor++];if(end==='}')return Object.freeze(result);if(end!==',')fail();}
    }
    if(character==='['){
      cursor++;space();const result=[];if(source[cursor]===']'){cursor++;return Object.freeze(result);}
      for(;;){result.push(value(depth+1));space();const end=source[cursor++];if(end===']')return Object.freeze(result);if(end!==',')fail();}
    }
    for(const [word,item]of [['true',true],['false',false],['null',null]])if(source.startsWith(word,cursor)){cursor+=word.length;return item;}
    const match=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(cursor));
    if(!match)fail();cursor+=match[0].length;const number=Number(match[0]);if(!Number.isSafeInteger(number)||number<0)fail();return number;
  }
  const result=value(0);space();if(cursor!==source.length)fail();return result;
}
module.exports={parseExchangeJSON};

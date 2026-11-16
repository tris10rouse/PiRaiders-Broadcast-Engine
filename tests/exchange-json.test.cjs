'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseExchangeJSON}=require('../scripts/lib/exchange-json.cjs');
const parse=value=>parseExchangeJSON(Buffer.from(value));
test('fatal UTF8 transport parsing retains immutable JSON values and exact safe integers',()=>{
 const value=parse('{"text":"synthetic \\ud83d\\udc3e","n":9007199254740991,"items":[null,true,false,0]}');
 assert.equal(value.text,'synthetic 🐾');assert.equal(value.n,Number.MAX_SAFE_INTEGER);assert.equal(Object.isFrozen(value),true);assert.equal(Object.isFrozen(value.items),true);assert.equal(Object.getPrototypeOf(value),null);
 assert.equal(parse('1e0'),1);assert.equal(parse('-0'),-0);
});
test('duplicate decoded keys, BOM, invalid UTF8, surrogates and unsafe/noninteger numbers are rejected',()=>{
 for(const bytes of [Buffer.from('{"x":1,"\\u0078":2}'),Buffer.from('\ufeff{}'),Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xc0,0xaf,0x22,0x7d]),...['{"x":"\\ud800"}','{"x":"\\udc00"}','9007199254740992','-1','1.5','1e999','{"x":NaN}','[1,]','{"x":1,}','{}extra'].map(value=>Buffer.from(value))])assert.throws(()=>parseExchangeJSON(bytes),error=>error.message==='METADATA_INVALID');
});
test('transport object construction cannot mutate prototypes and depth is bounded',()=>{
 const value=parse('{"__proto__":{"synthetic":true},"constructor":1}');assert.equal(Object.getPrototypeOf(value),null);assert.equal(value.__proto__.synthetic,true);assert.equal({}.synthetic,undefined);
 assert.throws(()=>parse('['.repeat(34)+'0'+']'.repeat(34)),/METADATA_INVALID/);
});

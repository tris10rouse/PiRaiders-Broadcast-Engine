'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {probeConfiguration,faultCategory,exitCategory}=require('../scripts/probe-caspar-config-path-windows.cjs');
test('configuration-path diagnostic keeps the config byte-identical, private and non-NDI',()=>{
 const directory=path.resolve('synthetic-ascii-runtime'),first=probeConfiguration(directory),second=probeConfiguration(directory);assert.deepEqual(first,second);const xml=first.toString('utf8');assert.ok(xml.includes('<consumers/>'));assert.ok(xml.includes('<controllers/>'));assert.ok(xml.includes('<auto-load>false</auto-load>'));assert.ok(xml.includes('<cache-path/>'));assert.equal(xml.includes('http:'),false);assert.equal([...first].some(value=>value>127),false);assert.throws(()=>probeConfiguration(path.resolve('synthetic-鷹-runtime')),/PROBE_ASCII_CONTROL_REQUIRED/);
});
test('configuration-path diagnostic exposes only fixed fault/exit categories',()=>{
 for(const code of ['CONSOLE_TIMEOUT','CONSOLE_CLOSED','CONSOLE_OUTPUT_CLOSED','CONSOLE_PROCESS','CONSOLE_REJECTED'])assert.equal(faultCategory(Error(code)),code);
 for(const text of ['http://private/#piraiders='+ 'A'.repeat(43),'C:\\private\\file','PRIVATE_SECRET','CONSOLE_TIMEOUT\nprivate'])assert.equal(faultCategory(Error(text)),'COMPONENT_FAILURE');
 assert.equal(exitCategory(null),'NOT_OBSERVED');assert.equal(exitCategory({code:0,signal:null}),'TARGET_EXIT_ZERO');assert.equal(exitCategory({code:252,signal:null}),'NATIVE_BOUNDARY_EXIT_252');assert.equal(exitCategory({code:1,signal:null}),'TARGET_EXIT_NONZERO');assert.equal(exitCategory({code:null,signal:'SIGTERM'}),'PROCESS_SIGNALLED');assert.equal(exitCategory({code:'private'}),'NOT_OBSERVED');
});

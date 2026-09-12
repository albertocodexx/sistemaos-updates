'use strict';
const assert=require('node:assert/strict');
const { limites }=require('../../src/pdf-assinaturas');
for(const fundo of ['transparente','branco']) {
  const p=new Uint8ClampedArray(100*100*4); if(fundo==='branco')p.fill(255);
  for(let y=40;y<50;y++)for(let x=30;x<70;x++)p.set([20,20,20,255],(y*100+x)*4);
  assert.deepEqual(limites(p,100,100),{x:28,y:38,width:44,height:14});
}
assert.equal(limites(new Uint8ClampedArray(400),10,10),null);
const branco=new Uint8ClampedArray(400).fill(255);assert.equal(limites(branco,10,10),null);
const borda=new Uint8ClampedArray(400);borda.set([0,0,0,255],0);assert.deepEqual(limites(borda,10,10),{x:0,y:0,width:3,height:3});
console.log('OK: recorte de assinatura transparente/branca, margens, vazio e traço na borda.');

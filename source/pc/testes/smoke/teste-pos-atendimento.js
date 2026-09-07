'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-pos-atendimento-qa-'));
const electron = require.resolve('electron');
Module._cache[electron] = new Module(electron);
Module._cache[electron].exports = { app: { getPath: () => temp } };
const db = require('../../src/db');
const { AftercareService } = require('../../src/supabase/aftercare-service');

(async () => {
  const ordem = db.criarOS({cliente:{nome:'Cliente QA',telefone:'00000000000'},aparelho:{marca:'Teste',modelo:'QA',defeitoRelatado:'Teste'},valorTotalServico:200});
  const dados = {numeroOS:ordem.numero,nomeRetirou:'Recebedor QA',telefoneRetirou:'00000000000',marca:'Teste',modelo:'QA',reparoRealizado:'Reparo QA',valorReparo:200,formaPagamento:'Pix',dataHoraAssinatura:'2026-08-28T15:00:00Z',garantiaDataInicio:'2026-08-25T15:00:00Z',garantiaDias:90,termosGarantia:'Condições QA.',assinaturaPendente:true,naoAssinado:false};
  const r = db.criarOuSubstituirEntrega(dados);
  assert.notEqual(db.obterOSPorNumero(ordem.numero).status,'Entregue','aguardar assinatura não pode concluir a saída do aparelho');
  assert.equal(r.entrega.assinaturaPendente,true);
  assert.equal(r.garantia.dataInicio,dados.garantiaDataInicio);
  assert.equal(r.garantia.dataLimite.slice(0,10),'2026-11-23');
  assert.equal(r.garantia.termos,'Condições QA.');
  assert.equal(r.garantia.clienteNome,'Cliente QA');
  assert.ok(r.garantia.clienteNumero);
  assert.equal(r.entrega.clienteNumero,r.garantia.clienteNumero);
  db.editarEntrega(ordem.numero,{nomeRetirou:'Outro QA',estadoAssinatura:'nao_assinado'});
  assert.equal(db.obterEntregaPorNumeroOS(ordem.numero).naoAssinado,true);
  assert.equal(db.listarGarantias().length,1);
  db.criarOuAtualizarGarantia({numeroOS:ordem.numero,garantiaDias:120,termos:'Texto corrigido'});
  assert.equal(db.obterGarantiaPorNumeroOS(ordem.numero).clienteTelefone,'00000000000');
  db.editarEntrega(ordem.numero,{nomeRetirou:'Mais um QA'});
  assert.equal(db.obterGarantiaPorNumeroOS(ordem.numero).garantiaDias,120,'editar recebedor não desfaz garantia manual');
  const ordemComPrazo = db.criarOS({cliente:{nome:'Cliente Prazo'},aparelho:{marca:'Teste',modelo:'Prazo',defeitoRelatado:'Teste'},garantiaDias:45});
  const pendenteComPrazo = db.criarEntregaPendente(ordemComPrazo.numero,{nomeRetirou:'Cliente Prazo'});
  assert.equal(pendenteComPrazo.garantiaDias,45,'nova entrega herda o prazo informado na OS');
  const retornoLegado = db.criarOuSubstituirEntrega({
    numeroOS: ordemComPrazo.numero, cicloEntregaId: 'RET-LEGADO-QA', retornoGarantiaId: 'RET-LEGADO-QA',
    nomeRetirou: 'Cliente Prazo', garantiaDias: 0, assinaturaPendente: true, naoAssinado: false
  }).entrega;
  assert.equal(retornoLegado.garantiaDias,0,'registro legado continua intacto no banco');
  assert.equal(db.obterEntregaPorNumeroOS(ordemComPrazo.numero,'RET-LEGADO-QA').garantiaDias,45,'a leitura herda o prazo canônico da OS');
  db.criarOuSubstituirEntrega({...db.obterEntregaPorNumeroOS(ordem.numero),assinaturaRetirouBase64:'assinatura-qa'});
  assert.throws(()=>db.editarEntrega(ordem.numero,{valorReparo:220}),/nova assinatura/);
  const corrigida = db.editarEntrega(ordem.numero,{valorReparo:220,confirmarNovaAssinatura:true,estadoAssinatura:'pendente'}).entrega;
  assert.equal(corrigida.assinaturaRetirouBase64,'');
  assert.equal(corrigida.assinaturaPendente,true);
  db.criarOuSubstituirEntrega({...corrigida,assinaturaRetirouBase64:'nova-assinatura-qa'});
  assert.equal(db.editarEntrega(ordem.numero,{valorReparo:230,confirmarNovaAssinatura:true,estadoAssinatura:'manter'}).entrega.assinaturaPendente,true,'editar documento assinado exige nova assinatura, não declara recusa');
  db.editarEntrega(ordem.numero,{garantiaDias:0});
  assert.equal(db.obterEntregaPorNumeroOS(ordem.numero).dataLimiteGarantia,'');
  assert.throws(()=>db.editarEntrega(ordem.numero,{garantiaDias:-1}),/dias/);
  for(let n=0;n<11;n++) {
    const foto=db.aplicarArquivoSupabaseOS(ordem.numero,{id:'foto-qa-'+n,categoria:'foto_entrada',mime_type:'image/png',nome_arquivo:'qa.png'},Buffer.from('imagem-qa-'+n));
    assert.equal(foto.aplicado,true,'fotos previamente cadastradas não bloqueiam a sincronização ao juntar aparelhos');
  }
  assert.equal(db.obterOSPorNumero(ordem.numero).fotos.length,11);
  assert.equal(db.aplicarArquivoSupabaseOS(ordem.numero,{id:'foto-qa-0',categoria:'foto_entrada',mime_type:'image/png'},Buffer.from('imagem-qa-0')).aplicado,false);

  // Servidor simulado com revisão: edição bidirecional e isolamento por empresa.
  let locais = [{numeroOS:'OS-0007',clienteNome:'QA nuvem',clienteNumero:'10007',garantiaDias:90,dataInicio:'2026-08-25',termos:'QA',origem:'manual'}];
  let remotas = []; let leituras=0, escritas=0;
  const estado = {mapeamentosOS:{'OS-0007':{id:'os-7'}},documentosComerciais:{}};
  const store={obter:()=>structuredClone(estado),alterar:fn=>fn(estado)};
  const cliente={rpc:async(nome,p)=>{
    assert.equal(nome,'salvar_pos_atendimento');
    let linha=p.p_id ? remotas.find(r=>r.id===p.p_id&&r.revision===p.p_revision):null;
    if(p.p_id&&!linha)return {data:null};
    if(!linha){linha={id:'g-7',revision:0};remotas.push(linha);}
    Object.assign(linha,p.p_excluir?{deleted_at:new Date().toISOString()}:p.p_dados,{revision:linha.revision+1,updated_at:'rev-'+(linha.revision+1)});escritas++;
    return {data:structuredClone(linha)};
  },from:()=>{
    let payload=null; const filtros={};
    const q={select:()=>q,eq:(k,v)=>(filtros[k]=v,q),is:()=>q,order:()=>q,
      range:async()=>{leituras++;assert.equal(filtros.empresa_id,'qa-empresa');return {data:structuredClone(remotas.filter(r=>!r.deleted_at))};},
      insert:()=>{throw new Error('Gravação deve usar RPC, nunca INSERT direto');},update:()=>{throw new Error('Gravação deve usar RPC, nunca UPDATE direto');},
      maybeSingle:async()=>{
        let linha=filtros.id ? remotas.find(r=>r.id===filtros.id&&r.revision===filtros.revision):null;
        if(filtros.id&&!linha)return {data:null};
        if(!linha){linha={id:'g-7',revision:0};remotas.push(linha);}
        Object.assign(linha,payload,{revision:linha.revision+1,updated_at:'rev-'+(linha.revision+1)});escritas++;
        return {data:structuredClone(linha)};
      }};return q;
  }};
  const servico=new AftercareService({getClient:()=>cliente,getContext:()=>({empresa_id:'qa-empresa'}),stateStore:store,db:{listarGarantias:()=>structuredClone(locais),listarEntregas:()=>[],obterOSPorNumero:()=>({}),obterGarantiaPorNumeroOS:n=>locais.find(g=>g.numeroOS===n),receberGarantiaRemota:g=>(locais=[g],g)}});
  assert.equal((await servico.sincronizar('garantia')).enviados,1);
  assert.equal(remotas[0].dados_extras.clienteNumero,'10007');
  await servico.sincronizar('garantia'); // ajusta hash da cópia normalizada
  const consultas=leituras;
  await servico.sincronizar('garantia');
  assert.equal(leituras,consultas,'não consulta a nuvem continuamente sem alteração');
  locais[0].termos='Edição PC';
  assert.equal((await servico.sincronizar('garantia')).enviados,1);
  assert.equal(remotas[0].termos,'Edição PC');
  remotas[0].termos='Edição celular';remotas[0].revision++;remotas[0].updated_at='rev-mobile';
  servico.ultimasConsultas.clear();
  assert.equal((await servico.sincronizar('garantia')).recebidos,1);
  assert.equal(locais[0].termos,'Edição celular');
  remotas[0].revision++;remotas[0].updated_at='rev-conflito';locais[0].termos='Conflito PC';
  const escritasAntes=escritas;
  await assert.rejects(servico.sincronizar('garantia'),/outro aparelho/);
  assert.equal(escritas,escritasAntes,'conflito não sobrescreve a nuvem');
  locais=[];servico.registrarExclusao('garantia','OS-0007');
  await servico.sincronizar('garantia');
  assert.ok(remotas[0].deleted_at);
  console.log('OK: entrega editável, assinatura segura, garantia automática/manual, datas, ID, nuvem, revisão, throttling e exclusão.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
  if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('sistemaos-pos-atendimento-qa-'))fs.rmSync(temp,{recursive:true,force:true});
});

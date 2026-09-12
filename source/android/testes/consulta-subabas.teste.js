'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const ler = p => fs.readFileSync(path.join(__dirname, '../www', p), 'utf8');
const tick = () => new Promise(r => setImmediate(r));
async function esperar(fn) { for (let i=0;i<80;i++) { if(fn())return; await tick(); } assert.fail('Ação não terminou'); }
(async () => {
  const dom = new JSDOM(ler('index.html'), { url:'https://teste.local', runScripts:'outside-only' });
  const w=dom.window, d=w.document, get=id=>d.getElementById(id);
  let chamadas=[], share, abrir=0, esperarBusca=null;
  const row={id:'doc-1',numero:'OS-0019',numero_os_snapshot:'OS-0019',cliente_nome_snapshot:'Gabriela',fornecedor_nome:'Gabriela',marca:'Motorola',modelo:'G9',valor:220,valor_total:220,quantidade_arquivos:15,status:'Entregue'};
  w.SupabaseClientApp={obterCliente:()=>({
    from(table) { const call={table}; chamadas.push(call); return { select(p){call.select=p;return this;},is(k,v){call.deleted=[k,v];return this;},or(f){call.filter=f;return this;},order(){return this;},limit:async()=>esperarBusca||{data:[row]} }; },
    rpc:async()=>({data:[]})
  })};
  ['os','entrega','garantia'].forEach(t=>w.eval(ler('js/supabase/'+t+'-service.js')));
  w.eval(ler('js/supabase/consultas-service.js'));
  w.CloudData={listarArquivos:async()=>[{id:'pdf-1',nomeArquivo:'OS-0019.pdf',mimeType:'application/pdf',temArquivoNuvem:true}],obterArquivo:async()=>({disponivel:true,url:'https://teste.local/documento.pdf'}),providerConsultas:()=> 'supabase'};
  w.SistemaOSCompartilhar={compartilharPdfPorUrl:async(...args)=>{share=args;return{}},mensagemResultado:()=> 'Pronto'};
  w.SistemaOSDesbloqueiosMobile={visualizar:()=>abrir++,compartilhar:async()=>{share=['desbloqueio']}};
  w.eval(ler('js/consulta.js'));
  get('consulta-cliente-termo').value='Gabriela'; get('btn-consultar-cliente').click();
  await esperar(()=>d.querySelector('.consulta-busca-documento'));
  assert.equal(chamadas[0].table,'vw_ordens_servico_leve');
  assert.match(chamadas[0].filter,/cliente_nome_snapshot.ilike/);
  assert.match(get('consulta-cliente-resultado').textContent,/Gabriela/,'Busca independe de FK do cliente');
  d.querySelector('.consulta-busca-acoes .btn-primario').click();
  assert.doesNotMatch(d.querySelector('.consulta-busca-detalhe').textContent,/Quantidade de arquivos|Percentual Pagamento|Disponibilidade dos arquivos/);
  let arquivos=d.querySelector('.btn-listar-arquivos-consulta');
  assert.equal(arquivos.textContent,'Ver arquivos'); arquivos.click(); await esperar(()=>arquivos.textContent==='Ver arquivos (1)');
  assert.equal(d.querySelectorAll('.arquivo-consulta-item').length,1);
  d.querySelector('.arquivo-consulta-item .btn-compartilhar-pdf-consulta').click(); await esperar(()=>share);
  assert.match(share[3],/Gabriela/); assert.match(share[3],/OS-0019/);
  for(const tipo of ['entrega','garantia','compra','venda','desbloqueio']) {
    get('consulta-aba-'+tipo).click(); await esperar(()=>d.querySelector('.consulta-busca-documento'));
    assert.equal(get('consulta-aba-'+tipo).getAttribute('aria-selected'),'true');
    assert.equal(d.querySelectorAll('[aria-selected=true][role=tab]').length,1);
    assert.ok(d.querySelector('.consulta-busca-acoes .btn-compartilhar-pdf-consulta'));
  }
  d.querySelector('.consulta-busca-acoes .btn-primario').click(); assert.equal(abrir,1);
  get('consulta-aba-cliente').click(); await esperar(()=>d.querySelectorAll('.consulta-busca-documento').length===6);
  assert.match(get('consulta-cliente-resultado').textContent,/nome salvo no atendimento/);
  get('consulta-cliente-termo').value='19'; get('consulta-aba-os').click(); await esperar(()=>!get('btn-consultar-cliente').disabled);
  assert.match(chamadas.at(-1).filter,/numero.eq."OS-0019"/);
  assert.equal(w.SistemaOSConsultasBusca._literal('x",empresa_id.eq.outro'), '"x\\",empresa_id.eq.outro"');
  await assert.rejects(w.SistemaOSConsultasBusca.buscar('__proto__','Teste'),/inválido/);
  assert.equal(w.SistemaOSConsultasBusca._padrao('%_*'),'%\\%\\_\\*%');
  let liberar; esperarBusca=new Promise(resolve=>{liberar=resolve});
  get('btn-consultar-cliente').click();
  d.dispatchEvent(new w.CustomEvent('sistema-os:sessao-alterada'));
  liberar({data:[row]}); await tick(); await tick();
  assert.equal(get('consulta-cliente-resultado').textContent,'','Resposta antiga não reaparece ao trocar empresa');
  assert.equal(get('consulta-os-resultado').textContent,'');
  dom.window.close();
  console.log('OK: busca por snapshot, sete subabas, contagem real, compartilhar com mensagem, nome sem FK, QR numérico e descarte de resposta de sessão anterior.');
})().catch(e=>{console.error(e);process.exitCode=1;});

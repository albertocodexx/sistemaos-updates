'use strict';
// Electron; somente fixtures, diretório temporário e banco substituído em memória.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'), mobile=path.resolve(root,'../sistemaos-android');
const out=path.join(root,'output/consulta-assinaturas');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'os-consultas-qa-')));
app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,width:412,height:900,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false,offscreen:true}});
 await w.loadURL('about:blank');
 const assinatura=await w.webContents.executeJavaScript(`(()=>{let c=document.createElement('canvas');c.width=1200;c.height=800;let x=c.getContext('2d');x.strokeStyle='#202020';x.lineWidth=4;x.beginPath();x.moveTo(550,450);x.bezierCurveTo(580,400,570,500,600,445);x.bezierCurveTo(630,390,660,500,675,440);x.stroke();return c.toDataURL('image/png')})()`);
 fs.writeFileSync(path.join(out,'assinatura-fixture.txt'),assinatura);
 const config={nomeEmpresa:'Assistência QA',endereco:'Rua de Teste, 100',telefone:'(11) 99999-0000',usarTermosPredefinidosOS:true,tema:{corPrincipal:'#111111',corCabecalhos:'#111111'}};
 const fixture={numero:'OS-TESTE',numeroOS:'OS-TESTE',id:'TESTE',data:'2026-09-12',dataInicio:'2026-09-12',dataVenda:'2026-09-12',cliente:{nome:'Cliente QA',clienteId:'10000'},clienteNome:'Cliente QA',nomeRetirou:'Cliente QA',aparelho:{marca:'Motorola',modelo:'Moto G9',cor:'Azul'},marca:'Motorola',modelo:'Moto G9',defeitoRelatado:'Tela quebrada',reparoRealizado:'Troca da tela',garantiaDias:90,prazoDias:90,valor:220,valorTotalServico:220,status:'Pronto para retirada',assinaturaClienteBase64:assinatura,assinaturaAssistenciaBase64:assinatura,assinaturaRetirouBase64:assinatura,assinaturaCompradorBase64:assinatura,assinaturaVendedorBase64:assinatura};
 const dbPath=require.resolve('../../src/db');const fake={obterConfig:()=>config};
 for(const n of ['','Venda','Compra','Entrega','Garantia','Desbloqueio']){fake['getPdf'+n+'Dir']=()=>out;fake['atualizarCaminhoPdf'+n]=()=>{};}
 require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:fake};
 const pdf=require('../../src/pdf');
 for(const fn of ['gerarPdfDaOS','gerarPdfEntrega','gerarPdfGarantia','gerarPdfCompra','gerarPdfVenda','gerarPdfDesbloqueio']){
   let f={...fixture}; if(fn==='gerarPdfCompra')f.numero='CP-TESTE';if(fn==='gerarPdfDesbloqueio')f.numero='DES-TESTE';
   let arquivo=await pdf[fn](f);assert.ok(fs.statSync(arquivo).size>1000);
 }
 const mobileAssets=path.join(mobile,'android/app/src/androidTest/assets/pdf-qa');
 const injetor=require(path.join(mobile,'www/js/assinatura-injetor.js'));
 for(const [nome,fn]of [['os','gerarHtmlOS'],['entrega','gerarHtmlEntrega'],['garantia','gerarHtmlGarantia'],['desbloqueio','gerarHtmlDesbloqueio'],['compra','gerarHtmlCompra'],['venda','gerarHtmlVenda']]){
   let html=require(path.join(mobile,'www/src/templates/'+nome+'-template'))[fn](fixture,config);
   if(nome!=='garantia')html=injetor.injetarAssinaturas(html,nome,{outraParte:assinatura,assistencia:assinatura});
   fs.writeFileSync(path.join(mobileAssets,nome+'.html'),html);
 }
 // Testa o recorte no navegador real: ignora logo, mantém traço, não distorce.
 await w.loadURL('data:text/html,'+encodeURIComponent('<div class="assinatura-espaco" style="width:300px;height:34px"><img src="'+assinatura+'"></div><img id="logo" src="'+assinatura+'">'));
 await w.webContents.executeJavaScript(fs.readFileSync(path.join(root,'src/pdf-assinaturas.js'),'utf8'));
 const crop=await w.webContents.executeJavaScript(`(async()=>{let orig=document.querySelector('img').src;SistemaOSPdfAssinaturas.preparar(document);await Promise.all([...document.images].map(i=>i.decode()));let im=document.querySelector('img');return {w:im.naturalWidth,h:im.naturalHeight,height:im.style.height,logo:document.getElementById('logo').src===orig}})()`);
 assert.ok(crop.w<250&&crop.h<150);assert.equal(crop.height,'56px');assert.equal(crop.logo,true);
 let html=fs.readFileSync(path.join(mobile,'www/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 html=html.replace('<head>','<head><base href="'+require('url').pathToFileURL(path.join(mobile,'www')+path.sep).href+'">');
 const page=path.join(out,'consulta-fixture.html');fs.writeFileSync(page,html);await w.loadFile(page);
 await w.webContents.executeJavaScript(`document.body.innerHTML=document.getElementById('painel-consulta').outerHTML;document.getElementById('painel-consulta').hidden=false;document.documentElement.setAttribute('data-tema','escuro');window.SistemaOSConsultasBusca={buscar:async()=>({itens:[{tipo:'os',dados:{id:'qa',numero:'OS-0019',cliente:{nome:'Gabriela'},aparelho:{marca:'Motorola',modelo:'Moto G9'},valor:220,status:'Entregue'}}]})};window.CloudData={listarArquivos:async()=>[{id:'qa-pdf',nomeArquivo:'OS-0019.pdf',mimeType:'application/pdf',temArquivoNuvem:true}],obterArquivo:async()=>({})};void 0;`);
 await w.webContents.executeJavaScript(fs.readFileSync(path.join(mobile,'www/js/consulta.js'),'utf8'));
 await w.webContents.executeJavaScript(`document.getElementById('consulta-cliente-termo').value='Gabriela';document.getElementById('btn-consultar-cliente').click();`);
 await new Promise(r=>setTimeout(r,120));
 for(const tema of ['escuro','claro']){
  await w.webContents.executeJavaScript(`document.documentElement.setAttribute('data-tema','${tema}');document.body.setAttribute('data-tema','${tema}');`);
  await new Promise(r=>setTimeout(r,80));
  fs.writeFileSync(path.join(out,'consulta-'+tema+'.png'),(await w.webContents.capturePage()).toPNG());
  const layout=await w.webContents.executeJavaScript(`({largura:document.documentElement.clientWidth,total:document.documentElement.scrollWidth})`);
  assert.ok(layout.total<=layout.largura+2,'Sem rolagem horizontal no celular');
 }
 w.destroy();console.log('OK: PDFs PC por rotas reais, recorte preserva logos, fixtures Android assinadas e UI em 412px.');app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});

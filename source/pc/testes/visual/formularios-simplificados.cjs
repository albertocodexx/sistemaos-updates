// Executar com Electron. Usa somente HTML estático e dados fictícios, sem preload/banco/rede.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const raiz = path.resolve(__dirname, '../..');
app.on('window-all-closed', () => {});
app.disableHardwareAcceleration();
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-forms-')));
const out = path.join(raiz, 'output/formularios');
fs.mkdirSync(out, { recursive: true });
async function janela(htmlPath, scripts, width, height) {
  const folder = path.dirname(htmlPath);
  let html = fs.readFileSync(htmlPath, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace('<head>', '<head><base href="' + require('url').pathToFileURL(folder + path.sep).href + '">');
  const fixture = path.join(out, width + '-fixture.html');
  fs.writeFileSync(fixture, html);
  const w = new BrowserWindow({ show:false, width, height, webPreferences:{ sandbox:true, contextIsolation:true, backgroundThrottling:false, offscreen:true } });
  w.webContents.on('console-message', (...args) => console.log('Renderer:', args.map(a => typeof a==='string' ? a : a?.message || '').filter(Boolean).join(' ')));
  await w.loadFile(fixture);
  await w.webContents.executeJavaScript(`
    window.controlesAntes = [...document.querySelectorAll('input,select,textarea')];
    window.valoresAntes = new Map(controlesAntes.map(el => [el, el.value]));
    document.getElementById('codigoInterno') && (document.getElementById('codigoInterno').value = 'ANTIGO-123');
    window.visivel = el => {
      if (!el) return false;
      for(let p=el; p; p=p.parentElement) {
        if(p.hidden || p.classList.contains('escondido') || p.classList.contains('form-retirado') || p.dataset.recolhido==='true') return false;
        if(p.tagName==='DETAILS' && !p.open && !p.querySelector('summary')?.contains(el)) return false;
      }
      return true;
    };
    window.exigir = (v,m) => { if(!v) { console.error(m); throw Error(m); } };
    void 0;
  `);
  for (const script of scripts) await w.webContents.executeJavaScript(fs.readFileSync(script, 'utf8'));
  return w;
}
app.whenReady().then(async () => {
  const pc = await janela(path.join(raiz, 'renderer/index.html'), ['form-layout.js','form-organizer.js'].map(f => path.join(raiz,'renderer/core',f)), 1366,1000);
  console.log(await pc.webContents.executeJavaScript(`
    exigir(controlesAntes.every(el=>el.isConnected), 'Nenhum controle ou valor legado pode ser perdido');
    const ids = ['diagValorEstimado','statusOS','dataPrevista','prioridadeOS','nome','telefone','defeitoRelatado'];
    ids.forEach(id=>exigir(visivel(document.getElementById(id)), 'Essencial oculto: '+id));
    document.querySelector('[data-form-todas]').click();
    ['codigoInterno','etiquetaInterna','tagBancada','numeroPatrimonio','tecnicoAuxiliar','diagPrazoEstimado','diagPecas','obsSaida']
      .forEach(id=>exigir(!visivel(document.getElementById(id)), 'Campo aposentado reapareceu: '+id));
    document.querySelector('[data-form-essenciais]').click();
    ids.forEach(id=>exigir(visivel(document.getElementById(id)), 'Essencial recolhido: '+id));
    exigir(document.getElementById('codigoInterno').value==='ANTIGO-123','Valor antigo alterado');
    const c = document.getElementById('diagSolucao'); c.value='Troca de tela';
    exigir(c.value==='Troca de tela' && visivel(c), 'Serviço deve permanecer editável');
    const test = document.getElementById('valorInvestido');
    test.dispatchEvent(new Event('invalid'));
    exigir(visivel(test), 'Validação precisa abrir a seção do campo');
    document.querySelector('[data-form-essenciais]').click();
    document.getElementById('modalEditarOS').classList.remove('escondido');
    ['editDiagValorEstimado','editStatusOS','editStatusPagamento','editStatusAprovacao','editDataPrevista',
      'editLembreteCobrancaData','editLembreteCobrancaValor','btnAdicionarLembreteCobranca']
      .forEach(id=>exigir(visivel(document.getElementById(id)), 'Essencial de edição oculto: '+id));
    ['editLembreteCobrancaData','editLembreteCobrancaValor'].forEach(id => {
      const el = document.getElementById(id);
      exigir(!!el.closest('.form-atendimento'), 'Cobrança fora do resumo financeiro: '+id);
      exigir(!el.closest('details'), 'Cobrança indevidamente escondida: '+id);
    });
    document.getElementById('modalEditarOS').classList.add('escondido');
    const forms=['#aba-nova-os','#modalEditarOS','#modalFormCompra'];
    JSON.stringify(forms.map(s=>({form:s,camposRetirados:document.querySelector(s).querySelectorAll('.form-retirado input,.form-retirado textarea,.form-retirado select').length})));
  `));
  // Captura apenas a tela do formulário, sem interferir no Sistema OS aberto.
  await pc.webContents.executeJavaScript(`document.querySelectorAll('.modal-fundo').forEach(n=>n.classList.add('escondido')); document.getElementById('telaLogin').classList.add('escondido');document.querySelectorAll('body > *').forEach(n=>{if(!n.matches('main,.svg-sprite'))n.style.display='none';});document.querySelector('.conteudo').style.padding='20px'; document.querySelector('.conteudo').scrollIntoView();`);
  await new Promise(r=>setTimeout(r,350));
  pc.webContents.invalidate();
  await new Promise(r=>setTimeout(r,350));
  console.log(await pc.webContents.executeJavaScript(`JSON.stringify({login:getComputedStyle(document.getElementById('telaLogin')).display,form:document.querySelector('.conteudo').getBoundingClientRect().toJSON(),top:document.elementFromPoint(200,200)?.outerHTML.slice(0,120)})`));
  fs.writeFileSync(path.join(out,'pc-nova-os.png'), (await pc.webContents.capturePage()).toPNG());
  await pc.webContents.executeJavaScript(`
    const compra=document.getElementById('modalFormCompra');compra.style.display='';compra.classList.remove('escondido');
    ['cpVNome','cpVTelefone','cpAMarca','cpAModelo','cpDValor','cpDFormaPagamento'].forEach(id=>exigir(visivel(document.getElementById(id)),id));
    document.querySelector('#modalFormCompra [data-form-todas]').click();
    ['cpVRg','cpVNascimento','cpVWhatsapp','cpAEmailSenha','cpDObs'].forEach(id=>exigir(!visivel(document.getElementById(id)),id));
    document.querySelector('#modalFormCompra [data-form-essenciais]').click();
  `);
  pc.webContents.invalidate(); await new Promise(r=>setTimeout(r,350));
  fs.writeFileSync(path.join(out,'pc-compra.png'),(await pc.webContents.capturePage()).toPNG());
  pc.destroy();
  const mobileRoot = path.resolve(raiz,'../sistemaos-android/www');
  const cel = await janela(path.join(mobileRoot,'index.html'),[path.join(mobileRoot,'js/form-layout.js')],390,844);
  console.log(await cel.webContents.executeJavaScript(`
    exigir(controlesAntes.every(el=>el.isConnected), 'Celular perdeu controles');
    ['os-valor','os-status','os-data-prevista','cliente-nome','cliente-telefone','aparelho-defeito']
      .forEach(id=>exigir(!document.getElementById(id).closest('details'), 'Essencial dentro de seção fechada: '+id));
    ['os-observacoes','compra-vendedor-rg','compra-aparelho-imei2','compra-conta-email-senha','compra-avaliacao-descricao','compra-observacoes']
      .forEach(id=>exigir(!!document.getElementById(id).closest('.form-retirado'), 'Repetição não retirada: '+id));
    const nomes = [...document.querySelectorAll('[id]')].map(e=>e.id);
    exigir(new Set(nomes).size===nomes.length,'IDs duplicados no celular');
    const fake=document.getElementById('compra-vendedor-rg');fake.value='DOCUMENTO ANTIGO';
    exigir(fake.value==='DOCUMENTO ANTIGO','Dados antigos devem ser preservados');
    'OK: celular sem repetições, essenciais visíveis e controles preservados';
  `));
  await cel.webContents.executeJavaScript(`document.querySelectorAll('body > *').forEach(n=>{if(!n.matches('main'))n.style.display='none';});document.querySelector('main').hidden=false; document.querySelectorAll('main > *').forEach(n=>{n.hidden=n.id!=='form-os';}); document.getElementById('form-os').hidden=false;`);
  await new Promise(r=>setTimeout(r,350));
  fs.writeFileSync(path.join(out,'celular-nova-os.png'),(await cel.webContents.capturePage()).toPNG());
  cel.destroy();
  console.log('OK: regressão e capturas de formulários concluídas.'); app.quit();
}).catch(e=>{ console.error(e); app.exit(1); });

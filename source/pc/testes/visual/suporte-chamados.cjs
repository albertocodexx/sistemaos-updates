'use strict';
// Formulários reais, CSS real e transporte simulado: não cria chamados na produção.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
app.disableHardwareAcceleration();
const raiz = path.resolve(__dirname, '../..');
const saida = path.join(raiz, 'output/suporte');
fs.mkdirSync(saida, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(require('os').tmpdir(), 'suporte-qa-')));
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  for (const mobile of [false, true]) {
    const pasta = mobile ? path.resolve(raiz, '../sistemaos-android/www') : path.join(raiz, 'renderer');
    let html = fs.readFileSync(path.join(pasta, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    html = html.replace('<head>', '<head><base href="' + pathToFileURL(pasta + path.sep).href + '">');
    const arquivo = path.join(saida, mobile ? 'celular.html' : 'pc.html');
    fs.writeFileSync(arquivo, html);
    const janela = new BrowserWindow({ show: false, width: mobile ? 390 : 1280, height: 900, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false } });
    await janela.loadFile(arquivo);
    await janela.webContents.executeJavaScript(`
      document.querySelectorAll('body > *').forEach(el => { el.style.display = 'none'; });
      window.capturados = [];
      window.transporte = async (acao, dados) => {
        if (acao.startsWith('criar_')) {
          capturados.push({acao, dados});
          await new Promise(resolve => setTimeout(resolve, 30));
          return { sucesso: true, chamadoId: 'qa', protocolo: 'CH-QA' };
        }
        return { sucesso: true, chamados: [] };
      };
      window.api = {
        supabasecriarchamadosuporte: dados => transporte(dados.origem.startsWith('login_') ? 'criar_publico' : 'criar_autenticado', dados),
        supabasechamadosuporte: transporte
      };
      window.SupabaseClientApp = { obterCliente: () => ({ functions: { invoke: async (_, opts) => ({ data: await transporte(opts.body.acao, opts.body.dados) }) } }) };
      window.SistemaOSSessao = { obterEstado: () => ({}) };
      window.exigir = (ok, mensagem) => { if (!ok) throw Error(mensagem); };
      void 0;
    `);
    await janela.webContents.executeJavaScript(fs.readFileSync(path.join(pasta, mobile ? 'js/chamado-anexos.js' : 'modules/suporte/anexos.js'), 'utf8'));
    await janela.webContents.executeJavaScript(fs.readFileSync(path.join(pasta, mobile ? 'js/chamados.js' : 'modules/suporte/chamados.js'), 'utf8'));
    const resultado = await janela.webContents.executeJavaScript(`(async () => {
      const mobile = ${mobile};
      const mapa = mobile ? { motivo:'motivo-novo-chamado-app', detalhe:'detalhe-novo-chamado-app', complemento:'complemento-novo-chamado-app', referencia:'referencia-novo-chamado-app', mensagem:'descricao-novo-chamado-app', telefone:'telefone-novo-chamado-app', outro:'motivo-outro-novo-chamado-app', form:'form-novo-chamado-app', botao:'enviar-novo-chamado-app', status:'status-novo-chamado-app' } : { motivo:'motivoNovoChamado', detalhe:'detalheNovoChamado', complemento:'complementoNovoChamado', referencia:'referenciaNovoChamado', mensagem:'mensagemNovoChamado', telefone:'telefoneNovoChamado', outro:'motivoOutroNovoChamado', form:'formNovoChamadoCentral', botao:'btnEnviarNovoChamado', status:'statusNovoChamadoCentral' };
      const el = chave => document.getElementById(mapa[chave]);
      const escolher = motivo => { el('motivo').value = motivo; el('motivo').dispatchEvent(new Event('change')); };
      const enviar = async () => {
        el('form').requestSubmit(); el('form').requestSubmit();
        for(let i=0; i<100 && el('botao').disabled; i++) await new Promise(resolve=>setTimeout(resolve, 10));
        exigir(!el('botao').disabled, 'Botão ficou bloqueado');
      };
      const origem = mobile ? 'config_celular' : 'config_pc';
      for (const motivo of ['trial_assinatura','cobranca_pagamento','acesso_login','sincronizacao_backup','documento_assinatura','erro_sistema','configuracao_integracao','duvida_funcionalidade','sugestao','outro']) {
        await SistemaOSChamados.abrirNovo({origem}); escolher(motivo);
        exigir(!document.querySelector('label[for="'+(mobile?'usuario-novo-chamado-app':'usuarioNovoChamado')+'"]'), 'Identidade repetida');
        document.querySelectorAll('#'+mapa.form+' [hidden]').forEach(node=>exigir(getComputedStyle(node).display==='none', 'Campo oculto visível: '+node.id));
        for(const chave of ['detalhe','complemento']) if(!el(chave).parentElement.hidden && el(chave).options.length>1) el(chave).selectedIndex=1;
        el('telefone').value='27999998888'; el('mensagem').value='Solicitação fictícia para teste isolado.'; el('outro').value='Outro assunto';
        const antes=capturados.length; await enviar();
        exigir(capturados.length===antes+1, 'Envio bloqueado ou duplicado em '+motivo+': '+el('status').textContent);
        exigir(!('usuario' in capturados.at(-1).dados) && !('empresa' in capturados.at(-1).dados), 'Identidade autenticada deve vir do servidor');
      }
      await SistemaOSChamados.abrirNovo({origem}); escolher('documento_assinatura');
      el('complemento').value='venda'; el('detalhe').value='pdf'; el('referencia').value='EST-9999';
      escolher('sugestao'); el('detalhe').value='os'; el('telefone').value='27999998888'; el('mensagem').value='Melhorar a busca das ordens de serviço.';
      await enviar();
      const dados=capturados.at(-1).dados;
      exigir(!dados.complemento && !dados.referencia && !dados.plataforma && !dados.motivoOutro, 'Detalhes antigos enviados em outro motivo');
      await SistemaOSChamados.abrirNovo({origem:mobile?'login_celular':'login_pc',empresa:'empresa-qa',usuario:'usuario.qa'});
      escolher('acesso_login'); el('detalhe').value='senha'; el('telefone').value='27999998888'; el('mensagem').value='Não consigo recuperar a minha senha.';
      await enviar(); exigir(capturados.at(-1).dados.usuario==='usuario.qa' && capturados.at(-1).dados.empresa==='empresa-qa', 'Login não encaminhou contexto automático');
      await SistemaOSChamados.abrirNovo({origem}); escolher('documento_assinatura');
      const form=el('form').getBoundingClientRect();
      exigir(form.left>=0 && form.right<=innerWidth+1, 'Formulário cortado lateralmente');
      return {plataforma:mobile?'Android':'PC', envios:capturados.length, largura:form.width, motivos:10};
    })()`);
    await new Promise(resolve=>setTimeout(resolve, 200));
    fs.writeFileSync(path.join(saida, mobile ? 'celular.png' : 'pc.png'), (await janela.webContents.capturePage()).toPNG());
    console.log(JSON.stringify(resultado)); janela.destroy();
  }
  app.exit(0);
}).catch(erro=>{ console.error(erro); app.exit(1); });

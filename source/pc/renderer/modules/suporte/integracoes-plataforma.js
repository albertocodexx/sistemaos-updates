(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let integracoes = [];
  let monitorBaileys = null;

  function criar() {
    if ($('integracoesPlataformaSaaS')) return;
    const painel = $('painelGlobalSistema');
    if (!painel) return;
    const secao = document.createElement('section');
    secao.id = 'integracoesPlataformaSaaS';
    secao.className = 'suporte-subsecao';
    secao.hidden = true;
    secao.innerHTML = `<div class="config-secao-titulo">Cobrança automática do Sistema OS</div>
      <p class="campo-desc">Esta conta recebe as assinaturas de todas as empresas. Ela é separada das contas usadas por cada assistência para cobrar clientes.</p>
      <div class="grade-2">
        <div style="padding:14px;border:1px solid var(--borda);border-radius:10px;background:var(--bg)">
          <strong>Mercado Pago das assinaturas</strong><p id="statusMpPlataforma" class="campo-desc">Não conectado</p>
          <div class="campo"><label for="mpPlataformaToken">Chave da conta Mercado Pago</label><input id="mpPlataformaToken" type="password" autocomplete="new-password" placeholder="APP_USR-..."></div>
          <div class="campo"><label for="mpPlataformaWebhook">Assinatura de segurança dos avisos (opcional)</label><input id="mpPlataformaWebhook" type="password" autocomplete="new-password"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" id="btnConectarMpPlataforma" class="botao botao-primario botao-pequeno">Conectar</button><button type="button" id="btnDesconectarMpPlataforma" class="botao botao-perigo botao-pequeno" hidden>Desconectar</button></div>
        </div>
        <div class="suporte-integracao-card">
          <strong>WhatsApp automático das assinaturas</strong><p id="statusWhatsPlataforma" class="campo-desc">Não conectado</p>
          <div class="suporte-whatsapp-modos" role="radiogroup" aria-label="Canal das cobranças por WhatsApp">
            <label><input type="radio" name="whatsModoPlataforma" id="whatsModoBaileys" value="baileys"><span><strong>Baileys por QR Code</strong><small>Grátis; depende deste PC ligado.</small></span></label>
            <label><input type="radio" name="whatsModoPlataforma" id="whatsModoHibrido" value="hibrido"><span><strong>Automático (recomendado)</strong><small>Baileys primeiro; Meta como reserva.</small></span></label>
            <label><input type="radio" name="whatsModoPlataforma" id="whatsModoMeta" value="meta"><span><strong>API oficial da Meta</strong><small>Funciona 24 horas, mesmo com o PC fechado.</small></span></label>
          </div>
          <div id="painelWhatsBaileysPlataforma" class="suporte-whatsapp-painel" hidden>
            <p id="statusBaileysPlataforma" class="campo-desc">Consultando a conexão por QR…</p>
            <div class="linha-acoes"><button type="button" id="btnAbrirBaileysPlataforma" class="botao botao-secundario botao-pequeno">Abrir QR Code</button><button type="button" id="btnUsarBaileysPlataforma" class="botao botao-primario botao-pequeno">Usar nas cobranças</button></div>
          </div>
          <div id="painelWhatsMetaPlataforma" class="suporte-whatsapp-painel" hidden>
            <div class="campo"><label for="whatsPlataformaPhone">Número da conta na Meta</label><input id="whatsPlataformaPhone" inputmode="numeric" autocomplete="off"></div>
            <div class="campo"><label for="whatsPlataformaToken">Chave permanente da Meta</label><input id="whatsPlataformaToken" type="password" autocomplete="new-password"></div>
            <details><summary>Modelos aprovados na Meta</summary><div class="campo"><label for="whatsTemplateLembrete">Lembrete</label><input id="whatsTemplateLembrete" placeholder="sistemaos_lembrete_assinatura"></div><div class="campo"><label for="whatsTemplateVencida">Assinatura vencida</label><input id="whatsTemplateVencida" placeholder="sistemaos_assinatura_vencida"></div><div class="campo"><label for="whatsTemplatePagamento">Pagamento confirmado</label><input id="whatsTemplatePagamento" placeholder="sistemaos_pagamento_confirmado"></div></details>
            <div class="linha-acoes"><button type="button" id="btnConectarWhatsPlataforma" class="botao botao-primario botao-pequeno">Conectar Meta</button></div>
          </div>
          <div class="linha-acoes" style="margin-top:10px"><button type="button" id="btnDesconectarWhatsPlataforma" class="botao botao-perigo botao-pequeno" hidden>Desconectar canal</button></div>
        </div>
      </div><p id="statusIntegracoesPlataforma" class="campo-desc" role="status"></p>`;
    const metricas = $('metricasSuporteGlobal');
    if (metricas) metricas.before(secao); else painel.appendChild(secao);
    $('btnConectarMpPlataforma').addEventListener('click', conectarMp);
    $('btnDesconectarMpPlataforma').addEventListener('click', () => desconectar('mercado_pago'));
    $('btnConectarWhatsPlataforma').addEventListener('click', conectarWhats);
    $('btnDesconectarWhatsPlataforma').addEventListener('click', () => desconectar('whatsapp'));
    $('btnAbrirBaileysPlataforma').addEventListener('click', abrirBaileys);
    $('btnUsarBaileysPlataforma').addEventListener('click', usarBaileys);
    document.querySelectorAll('input[name="whatsModoPlataforma"]').forEach((radio) => radio.addEventListener('change', atualizarModoWhats));
  }

  function porTipo(tipo) { return integracoes.find((item) => item.tipo === tipo); }

  function desenhar() {
    const mp = porTipo('mercado_pago');
    const whats = porTipo('whatsapp');
    $('statusMpPlataforma').textContent = mp?.status === 'conectada' ? `Conectado: ${mp.conta_mascarada || 'conta ativa'}` : 'Não conectado';
    const usaBaileys = whats?.provedor === 'baileys_pc';
    const usaHibrido = whats?.provedor === 'hibrido_baileys_meta';
    $('statusWhatsPlataforma').textContent = whats?.status === 'conectada'
      ? `${usaHibrido ? 'Automático selecionado' : usaBaileys ? 'Baileys selecionado' : 'Meta conectada'}: ${whats.conta_mascarada || 'conta ativa'}` : 'Não conectado';
    $('btnDesconectarMpPlataforma').hidden = mp?.status !== 'conectada';
    $('btnDesconectarWhatsPlataforma').hidden = whats?.status !== 'conectada';
    $('mpPlataformaToken').value = ''; $('mpPlataformaToken').placeholder = mp?.status === 'conectada' ? 'Chave guardada com segurança' : 'APP_USR-...';
    $('whatsPlataformaToken').value = ''; $('whatsPlataformaToken').placeholder = whats?.status === 'conectada' ? 'Chave guardada com segurança' : 'Cole a chave permanente';
    $('whatsPlataformaPhone').value = whats?.metadados?.phone_number_id || '';
    $('whatsTemplateLembrete').value = whats?.metadados?.templates?.lembrete || '';
    $('whatsTemplateVencida').value = whats?.metadados?.templates?.vencida || '';
    $('whatsTemplatePagamento').value = whats?.metadados?.templates?.pagamento_confirmado || '';
    $('whatsModoBaileys').checked = usaBaileys || !whats;
    $('whatsModoHibrido').checked = usaHibrido;
    $('whatsModoMeta').checked = Boolean(whats) && !usaBaileys && !usaHibrido;
    atualizarModoWhats();
    atualizarStatusBaileys().catch(() => {});
  }

  function atualizarModoWhats() {
    const modo = document.querySelector('input[name="whatsModoPlataforma"]:checked')?.value || 'baileys';
    $('painelWhatsBaileysPlataforma').hidden = modo === 'meta';
    $('painelWhatsMetaPlataforma').hidden = modo === 'baileys';
    $('btnUsarBaileysPlataforma').textContent = modo === 'hibrido' ? 'Ativar automático' : 'Usar nas cobranças';
  }

  async function atualizarStatusBaileys() {
    const status = await window.api.wappstatus?.().catch(() => null);
    const conectado = status?.status === 'conectado';
    $('statusBaileysPlataforma').textContent = conectado
      ? 'QR conectado. As cobranças serão enviadas enquanto este PC estiver aberto.'
      : 'QR ainda não conectado. Abra o painel e leia o QR Code com o WhatsApp.';
    return conectado;
  }

  async function abrirBaileys() {
    $('btnWappPanel')?.click();
    setTimeout(() => atualizarStatusBaileys().catch(() => {}), 1200);
  }

  async function usarBaileys() {
    if (!(await atualizarStatusBaileys())) {
      $('statusIntegracoesPlataforma').textContent = 'Conecte o QR Code antes de ativar o Baileys para cobranças.';
      abrirBaileys();
      return;
    }
    $('statusIntegracoesPlataforma').textContent = 'Ativando Baileys para as cobranças…';
    const modo = document.querySelector('input[name="whatsModoPlataforma"]:checked')?.value || 'baileys';
    const resposta = await window.api.supabaseassinaturassaas('configurar_whatsapp_baileys', { modo });
    if (!resposta?.sucesso) { $('statusIntegracoesPlataforma').textContent = resposta?.erro || 'Não foi possível ativar o Baileys.'; return; }
    $('statusIntegracoesPlataforma').textContent = resposta.mensagem || 'Baileys ativado.';
    await carregar();
    await processarFilaBaileys();
  }

  async function processarFilaBaileys() {
    const whats = porTipo('whatsapp');
    if (!['baileys_pc', 'hibrido_baileys_meta'].includes(whats?.provedor) || !(await atualizarStatusBaileys())) return;
    const fila = await window.api.supabaseassinaturassaas?.('buscar_fila_baileys', {});
    if (!fila?.sucesso) return;
    for (const item of fila.itens || []) {
      let envio = null;
      try { envio = await window.api.wappflyenviar(item.destinatario, item.mensagem); } catch (erro) { envio = { sucesso: false, erro: erro.message }; }
      await window.api.supabaseassinaturassaas('confirmar_envio_baileys', {
        filaId: item.id,
        sucesso: envio?.sucesso === true,
        mensagemId: envio?.idMensagem || envio?.id || '',
        erro: envio?.erro || ''
      }).catch(() => {});
    }
  }

  async function carregar() {
    criar();
    const resposta = await window.api.supabaseassinaturassaas?.('listar_integracoes_plataforma', {});
    if (!resposta?.sucesso) { $('statusIntegracoesPlataforma').textContent = resposta?.erro || ''; return; }
    integracoes = resposta.integracoes || [];
    desenhar();
  }

  async function conectarMp() {
    const token = $('mpPlataformaToken').value.trim();
    if (!token) { $('statusIntegracoesPlataforma').textContent = 'Informe a chave do Mercado Pago.'; return; }
    $('statusIntegracoesPlataforma').textContent = 'Conectando Mercado Pago…';
    const resposta = await window.api.supabaseassinaturassaas('conectar_mercado_pago', { accessToken: token, webhookSecret: $('mpPlataformaWebhook').value.trim() });
    if (!resposta?.sucesso) { $('statusIntegracoesPlataforma').textContent = resposta?.erro || 'Não foi possível conectar.'; return; }
    $('statusIntegracoesPlataforma').textContent = resposta.mensagem || 'Mercado Pago conectado.';
    await carregar();
  }

  async function conectarWhats() {
    const token = $('whatsPlataformaToken').value.trim();
    const phone = $('whatsPlataformaPhone').value.trim();
    if (!token || !phone) { $('statusIntegracoesPlataforma').textContent = 'Informe a conta e a chave da Meta.'; return; }
    $('statusIntegracoesPlataforma').textContent = 'Conectando WhatsApp…';
    const resposta = await window.api.supabaseassinaturassaas('conectar_whatsapp', {
      accessToken: token, phoneNumberId: phone,
      templateLembrete: $('whatsTemplateLembrete').value.trim(),
      templateVencida: $('whatsTemplateVencida').value.trim(),
      templatePagamento: $('whatsTemplatePagamento').value.trim()
    });
    if (!resposta?.sucesso) { $('statusIntegracoesPlataforma').textContent = resposta?.erro || 'Não foi possível conectar.'; return; }
    $('statusIntegracoesPlataforma').textContent = resposta.mensagem || 'WhatsApp conectado.';
    if (document.querySelector('input[name="whatsModoPlataforma"]:checked')?.value === 'hibrido') {
      const hibrido = await window.api.supabaseassinaturassaas('configurar_whatsapp_baileys', { modo: 'hibrido' });
      if (!hibrido?.sucesso) { $('statusIntegracoesPlataforma').textContent = hibrido?.erro || 'Meta conectada, mas não foi possível ativar o modo automático.'; }
    }
    await carregar();
  }

  async function desconectar(tipo) {
    if (!window.confirm('Desconectar esta conta? Os dados das empresas serão preservados.')) return;
    const resposta = await window.api.supabaseassinaturassaas('desconectar_integracao', { tipo });
    $('statusIntegracoesPlataforma').textContent = resposta?.sucesso ? 'Conta desconectada.' : (resposta?.erro || 'Não foi possível desconectar.');
    await carregar();
  }

  document.addEventListener('sistemaos:sessao-pronta', (evento) => {
    criar();
    const permitido = evento.detail?.administradorGlobal && evento.detail?.papelSuporte === 'administrador_geral';
    $('integracoesPlataformaSaaS').hidden = !permitido;
    if (monitorBaileys) clearInterval(monitorBaileys);
    if (permitido) {
      setTimeout(() => carregar().then(processarFilaBaileys).catch(() => {}), 900);
      monitorBaileys = setInterval(() => processarFilaBaileys().catch(() => {}), 60000);
    }
  });
})();

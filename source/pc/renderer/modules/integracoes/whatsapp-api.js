(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let integracao = null;
  let empresa = null;

  function garantirSecao() {
    if ($('integracaoWhatsAppApiEmpresa')) return;
    const referencia = $('integracaoMercadoPagoEmpresa');
    if (!referencia) return;
    const secao = document.createElement('div');
    secao.id = 'integracaoWhatsAppApiEmpresa';
    secao.className = 'config-secao';
    secao.hidden = true;
    secao.innerHTML = `
      <div class="config-secao-titulo">WhatsApp</div>
      <p class="campo-desc">O WhatsApp por QR continua principal. Se quiser, conecte também a API oficial para avisos automáticos quando o PC estiver fechado.</p>
      <div class="grade-2">
        <label class="campo-checkbox" style="padding:12px;border:1px solid var(--borda);border-radius:10px"><input type="radio" name="whatsappModo" value="baileys" checked><span><strong>QR no PC</strong><br><small>Principal e mais simples.</small></span></label>
        <label class="campo-checkbox" style="padding:12px;border:1px solid var(--borda);border-radius:10px"><input type="radio" name="whatsappModo" value="hibrido"><span><strong>QR + automático</strong><br><small>Usa o QR no PC e a API quando ele estiver fechado.</small></span></label>
        <label class="campo-checkbox" style="padding:12px;border:1px solid var(--borda);border-radius:10px"><input type="radio" name="whatsappModo" value="api"><span><strong>Somente automático</strong><br><small>Envia pela API oficial.</small></span></label>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"><button type="button" id="btnAbrirBaileysConfig" class="botao botao-secundario">Abrir conexão por QR</button><span id="statusWhatsAppApi" class="campo-desc">Consultando…</span></div>
      <div id="camposWhatsAppApi" style="margin-top:14px;padding:14px;border:1px solid var(--borda);border-radius:10px;background:var(--bg)" hidden>
        <div class="grade-2">
          <div class="campo"><label for="whatsAppCloudPhoneId">Número da conta na Meta</label><input id="whatsAppCloudPhoneId" inputmode="numeric" autocomplete="off" placeholder="Ex.: 123456789"></div>
          <div class="campo"><label for="whatsAppCloudWabaId">Conta comercial (opcional)</label><input id="whatsAppCloudWabaId" inputmode="numeric" autocomplete="off"></div>
          <div class="campo campo-largo"><label for="whatsAppCloudToken">Chave permanente da Meta</label><input id="whatsAppCloudToken" type="password" autocomplete="new-password" placeholder="Deixe vazio para manter a chave atual"></div>
        </div>
        <p class="campo-desc">A chave é enviada direto ao cofre seguro e não fica salva neste computador.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" id="btnConectarWhatsAppApi" class="botao botao-primario">Conectar automático</button><button type="button" id="btnVerificarWhatsAppApi" class="botao botao-secundario">Verificar</button><button type="button" id="btnDesconectarWhatsAppApi" class="botao botao-perigo" hidden>Desconectar automático</button></div>
      </div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--borda)">
        <strong>Contato para avisos da assinatura</strong>
        <div class="grade-2" style="margin-top:10px"><div class="campo"><label for="contatoCobrancaNome">Nome</label><input id="contatoCobrancaNome" autocomplete="name"></div><div class="campo"><label for="contatoCobrancaWhatsApp">WhatsApp</label><input id="contatoCobrancaWhatsApp" inputmode="tel" autocomplete="tel"></div><div class="campo campo-largo"><label for="contatoCobrancaEmail">E-mail</label><input id="contatoCobrancaEmail" type="email" autocomplete="email"></div></div>
        <label class="campo-checkbox"><input id="avisosCobrancaAtivos" type="checkbox" checked><span>Receber lembretes e confirmação de pagamento</span></label>
        <button type="button" id="btnSalvarContatoCobranca" class="botao botao-secundario" style="margin-top:10px">Salvar contato</button>
      </div>`;
    referencia.after(secao);

    secao.querySelectorAll('input[name="whatsappModo"]').forEach((campo) => campo.addEventListener('change', atualizarCampos));
    $('btnAbrirBaileysConfig').addEventListener('click', () => $('btnWappPanel')?.click());
    $('btnConectarWhatsAppApi').addEventListener('click', conectar);
    $('btnVerificarWhatsAppApi').addEventListener('click', verificar);
    $('btnDesconectarWhatsAppApi').addEventListener('click', desconectar);
    $('btnSalvarContatoCobranca').addEventListener('click', salvarContato);
  }

  function modoSelecionado() {
    return document.querySelector('input[name="whatsappModo"]:checked')?.value || 'baileys';
  }

  function atualizarCampos() {
    const modo = modoSelecionado();
    $('camposWhatsAppApi').hidden = modo === 'baileys';
  }

  function desenhar() {
    if (!integracao && !empresa) return;
    const conectado = integracao?.status === 'conectada';
    const modo = empresa?.whatsapp_modo || integracao?.metadados?.modo || 'baileys';
    const radio = document.querySelector(`input[name="whatsappModo"][value="${modo}"]`);
    if (radio) radio.checked = true;
    atualizarCampos();
    $('statusWhatsAppApi').textContent = conectado
      ? `Automático conectado: ${integracao.conta_mascarada || 'conta ativa'}`
      : 'Conexão por QR disponível. Automático opcional.';
    $('btnDesconectarWhatsAppApi').hidden = !conectado;
    $('whatsAppCloudPhoneId').value = integracao?.metadados?.phone_number_id || '';
    $('whatsAppCloudWabaId').value = integracao?.metadados?.waba_id || '';
    $('whatsAppCloudToken').value = '';
    $('whatsAppCloudToken').placeholder = conectado ? 'Chave guardada com segurança' : 'Cole a chave permanente';
    $('contatoCobrancaNome').value = empresa?.contato_cobranca_nome || '';
    $('contatoCobrancaWhatsApp').value = empresa?.contato_cobranca_whatsapp || '';
    $('contatoCobrancaEmail').value = empresa?.contato_cobranca_email || '';
    $('avisosCobrancaAtivos').checked = empresa?.avisos_cobranca_ativos !== false;
  }

  async function carregar() {
    garantirSecao();
    const status = await window.api.supabasestatus?.();
    const secao = $('integracaoWhatsAppApiEmpresa');
    if (!secao) return;
    secao.hidden = !status?.autenticado || !status?.empresaId;
    if (secao.hidden) return;
    const [respostaIntegracao, respostaAssinatura] = await Promise.all([
      window.api.supabaseintegracaowhatsappapi?.('status', {}),
      window.api.supabaseassinaturassaas?.('resumo', {})
    ]);
    integracao = respostaIntegracao?.integracao || null;
    empresa = respostaAssinatura?.empresa || null;
    desenhar();
  }

  async function conectar() {
    const modo = modoSelecionado();
    if (modo === 'baileys') {
      await desconectar();
      $('btnWappPanel')?.click();
      return;
    }
    const botao = $('btnConectarWhatsAppApi');
    botao.disabled = true;
    $('statusWhatsAppApi').textContent = 'Conectando…';
    const resposta = await window.api.supabaseintegracaowhatsappapi('conectar', {
      accessToken: $('whatsAppCloudToken').value.trim(),
      phoneNumberId: $('whatsAppCloudPhoneId').value.trim(),
      wabaId: $('whatsAppCloudWabaId').value.trim(),
      modo
    });
    botao.disabled = false;
    if (!resposta?.sucesso) { $('statusWhatsAppApi').textContent = resposta?.erro || 'Não foi possível conectar.'; return; }
    integracao = resposta.integracao;
    if (empresa) empresa.whatsapp_modo = modo;
    desenhar();
    window.toast?.('WhatsApp automático conectado.', 'sucesso');
  }

  async function verificar() {
    $('statusWhatsAppApi').textContent = 'Verificando…';
    const resposta = await window.api.supabaseintegracaowhatsappapi('verificar', {});
    if (resposta?.integracao) integracao = resposta.integracao;
    $('statusWhatsAppApi').textContent = resposta?.status_verificado ? 'WhatsApp automático conectado.' : (resposta?.erro || resposta?.mensagem || 'Conexão não encontrada.');
    desenhar();
  }

  async function desconectar() {
    const resposta = await window.api.supabaseintegracaowhatsappapi('desconectar', {});
    if (!resposta?.sucesso) { $('statusWhatsAppApi').textContent = resposta?.erro || 'Não foi possível desconectar.'; return; }
    integracao = resposta.integracao;
    if (empresa) empresa.whatsapp_modo = 'baileys';
    desenhar();
    window.toast?.('O WhatsApp por QR continua disponível.', 'sucesso');
  }

  async function salvarContato() {
    const resposta = await window.api.supabaseassinaturassaas('salvar_contato', {
      nome: $('contatoCobrancaNome').value,
      email: $('contatoCobrancaEmail').value,
      whatsapp: $('contatoCobrancaWhatsApp').value,
      avisosAtivos: $('avisosCobrancaAtivos').checked,
      modo: modoSelecionado()
    });
    if (!resposta?.sucesso) { window.toast?.(resposta?.erro || 'Não foi possível salvar o contato.', 'erro'); return; }
    empresa = Object.assign(empresa || {}, resposta.empresa || {});
    window.toast?.('Contato de cobrança salvo.', 'sucesso');
  }

  document.addEventListener('sistemaos:sessao-pronta', (evento) => {
    if (evento.detail?.administradorGlobal) return;
    setTimeout(() => carregar().catch(() => {}), 1800);
  });
  $('btnConfig')?.addEventListener('click', () => setTimeout(() => carregar().catch(() => {}), 200));
})();

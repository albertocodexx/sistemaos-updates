(function () {
  'use strict';
  const rotulos = { aguardando_configuracao: 'Aguardando dados fiscais', na_fila: 'Na fila de emissão',
    processando: 'Aguardando autorização', autorizada: 'Autorizada', rejeitada: 'Precisa de revisão', cancelada: 'Cancelada' };
  let geracao = 0;
  window.carregarNotasAssinaturaPC = async function (lista, suporte = false, pagina = 0) {
    if (!lista) return;
    const minhaGeracao = ++geracao;
    lista.textContent = 'Consultando notas das assinaturas…';
    try {
      const r = await window.api.supabaseassinaturassaas('listar_notas_assinatura', { pagina });
      if (minhaGeracao !== geracao) return;
      if (!r?.sucesso) throw new Error(r?.erro || 'Não foi possível consultar as notas.');
      lista.replaceChildren();
      const atualizar = document.createElement('button');
      atualizar.className = 'botao botao-secundario botao-pequeno';
      atualizar.textContent = 'Atualizar notas';
      atualizar.onclick = () => window.carregarNotasAssinaturaPC(lista, suporte, pagina);
      lista.append(atualizar);
      if (!r.notas?.length) {
        const vazio = document.createElement('p'); vazio.textContent = 'Nenhuma nota de assinatura nesta página.'; lista.append(vazio);
      }
      for (const nota of r.notas || []) {
        const item = document.createElement('article');
        item.className = 'assinatura-resumo'; item.style.marginTop = '12px';
        const titulo = document.createElement('strong');
        titulo.textContent = nota.descricao;
        const detalhe = document.createElement('span');
        detalhe.textContent = `${Number(nota.valor).toLocaleString('pt-BR', { style:'currency', currency:'BRL' })} · ${new Date(nota.created_at).toLocaleDateString('pt-BR')} · ${rotulos[nota.status] || 'Em conferência'}`;
        const mensagem = document.createElement('small'); mensagem.textContent = nota.ultimo_erro ||
          (nota.numero ? `NFS-e nº ${nota.numero} · Verificação: ${nota.codigo_verificacao || 'pendente'}` : 'A autorização é acompanhada automaticamente.');
        item.append(titulo, detalhe, mensagem);
        if (suporte && nota.cliente_nome) { const cliente = document.createElement('span'); cliente.textContent = nota.cliente_nome; item.prepend(cliente); }
        const acoes = document.createElement('div'); acoes.className = 'linha-acoes';
        if (nota.pdf_disponivel) {
          for (const baixar of [false,true]) {
            const botao = document.createElement('button'); botao.className = 'botao botao-secundario botao-pequeno';
            botao.textContent = baixar ? 'Baixar PDF' : 'Abrir NF';
            botao.onclick = async () => {
              botao.disabled = true;
              try {
                const ret = await window.api.assinaturadocumentofiscal(nota.id, baixar);
                if (!ret?.sucesso) throw new Error(ret?.erro || 'Não foi possível obter o PDF.');
              } catch (e) { window.toast?.(e.message,'erro'); }
              finally { botao.disabled = false; }
            };
            acoes.append(botao);
          }
        } else if (suporte && !['rejeitada','cancelada'].includes(nota.status)) {
          const botao = document.createElement('button'); botao.className = 'botao botao-secundario botao-pequeno'; botao.textContent = 'Conferir emissão';
          botao.onclick = async () => {
            if (!await window.confirmModal('Conferir e encaminhar a nota desta assinatura paga para o emissor?', { titulo: 'Nota da assinatura' })) return;
            botao.disabled = true;
            try {
              const ret = await window.api.supabaseassinaturassaas('emitir_nota_assinatura', { cobrancaId: nota.cobranca_id });
              if (!ret?.sucesso) throw new Error(ret?.erro || 'Falha ao solicitar emissão.');
              window.toast?.(ret.mensagem,'sucesso');
              await window.carregarNotasAssinaturaPC(lista, suporte, pagina);
            } catch (e) { window.toast?.(e.message,'erro'); botao.disabled = false; }
          };
          acoes.append(botao);
        }
        item.append(acoes); lista.append(item);
      }
      for (const [exibir, titulo, alvo] of [[pagina>0,'Anteriores',pagina-1],[r.mais,'Próximas',pagina+1]]) {
        if (!exibir) continue;
        const b = document.createElement('button'); b.className = 'botao botao-secundario'; b.textContent = titulo;
        b.onclick = () => window.carregarNotasAssinaturaPC(lista,suporte,alvo); lista.append(b);
      }
    } catch (e) { if (minhaGeracao === geracao) lista.textContent = e.message || 'Não foi possível consultar as notas.'; }
  };
})();

(function(root) {
  'use strict';
  const esc = valor => String(valor ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function modelo(g) {
    return { ...(g.dados_extras || {}), numeroOS:g.numero_os_snapshot, clienteNome:g.cliente_nome_snapshot,
      clienteTelefone:g.cliente_telefone_snapshot, clienteCpf:g.dados_extras?.clienteCpf || '', marca:g.marca_snapshot, modelo:g.modelo_snapshot,
      imei:g.imei_snapshot, servicoRealizado:g.reparo_realizado, garantiaDias:g.garantia_dias, dataInicio:g.data_abertura+'T12:00:00',
      dataLimite:g.data_limite ? g.data_limite+'T12:00:00' : '', termos:g.termos || '' };
  }
  function retornoAtual(linha) {
    const extras = linha.dados_extras || {};
    const retornos = Array.isArray(extras.retornosGarantia) ? extras.retornosGarantia : [];
    return retornos.find(item => item.id === extras.retornoAtualId) || retornos.find(item => item.status !== 'Entregue') || retornos[0] || null;
  }
  function criarPainelRetorno(linhaInicial, numero) {
    let linha = linhaInicial;
    let forcarNovo = false;
    const section = document.createElement('section');
    section.className = 'garantia-retorno';
    const render = () => {
      const atual = forcarNovo ? null : retornoAtual(linha);
      const retornos = Array.isArray(linha.dados_extras?.retornosGarantia) ? linha.dados_extras.retornosGarantia : [];
      section.innerHTML = '<h3>Retorno em garantia</h3>' + (atual
        ? '<p class="garantia-retorno-status"><strong>Status atual:</strong> '+esc(atual.status)+' · '+retornos.length+' retorno(s)</p>'+
          '<p><strong>Motivo:</strong> '+esc(atual.motivo)+'</p>'+
          '<label>Alterar etapa<select data-retorno-status>'+root.SistemaOSSupabaseGarantia.STATUS_RETORNO.filter(s=>s!=='Entregue'||atual.status==='Entregue').map(s=>'<option '+(s===atual.status?'selected':'')+'>'+esc(s)+'</option>').join('')+'</select></label>'+
          '<p class="garantia-retorno-ajuda">Ao marcar <strong>Pronto para retirada</strong>, o app abre uma nova entrega para assinatura. A etapa Entregue é concluída somente após assinar ou marcar Não assinado.</p>'+
          '<label>Observação desta etapa<textarea data-retorno-observacao rows="3" placeholder="O que foi analisado ou realizado"></textarea></label>'+
          '<button type="button" class="btn-primario" data-atualizar-retorno>Salvar nova etapa</button>'+
          '<details><summary>Ver histórico</summary><ol>'+((atual.historico||[]).map(h=>'<li><strong>'+esc(h.status)+'</strong> · '+esc(new Date(h.em).toLocaleDateString('pt-BR'))+'<br>'+esc(h.observacao||'Sem observação.')+'</li>').join('')||'<li>Nenhuma etapa.</li>')+'</ol></details>'
        : '<p>Nenhum retorno registrado para esta garantia.</p>'+
          '<label>Motivo do retorno<input data-retorno-motivo maxlength="600" placeholder="Ex.: vidro descolando do LCD"></label>'+
          '<label>Observação inicial<textarea data-retorno-observacao rows="3"></textarea></label>'+
          '<button type="button" class="btn-primario" data-registrar-retorno>Registrar retorno</button>')+
        '<button type="button" class="btn-secundario" data-novo-retorno '+(atual && atual.status !== 'Entregue' ? 'hidden' : '')+'>Registrar outro retorno</button><p data-retorno-feedback role="status"></p>';
      const feedback = section.querySelector('[data-retorno-feedback]');
      section.querySelector('[data-registrar-retorno]')?.addEventListener('click', async e => {
        const botao=e.currentTarget; botao.disabled=true; feedback.textContent='Salvando…';
        try {
          const resposta=await root.SistemaOSSupabaseGarantia.registrarRetorno(linha,{motivo:section.querySelector('[data-retorno-motivo]').value,observacao:section.querySelector('[data-retorno-observacao]').value});
          linha=resposta.linha; forcarNovo=false; render(); root.SistemaOSToast.mostrar(resposta.duplicado?'Esse retorno já estava aberto.':'Retorno registrado e enviado ao PC.',resposta.duplicado?'aviso':'sucesso');
        } catch(erro){feedback.textContent='Não foi salvo: '+erro.message; botao.disabled=false;}
      });
      section.querySelector('[data-atualizar-retorno]')?.addEventListener('click', async e => {
        const botao=e.currentTarget; botao.disabled=true; feedback.textContent='Salvando…';
        try {
          const resposta=await root.SistemaOSSupabaseGarantia.atualizarRetorno(linha,atual.id,{status:section.querySelector('[data-retorno-status]').value,observacao:section.querySelector('[data-retorno-observacao]').value});
          linha=resposta.linha; render(); root.SistemaOSToast.mostrar(resposta.entrega?'Nova entrega da garantia preparada. A entrega original foi preservada.':'Etapa da garantia atualizada.','sucesso');
          if (resposta.entrega) {
            section.dispatchEvent(new root.CustomEvent('sistema-os:abrir-entrega-retorno', {
              bubbles: true,
              detail: { entrega: resposta.entrega }
            }));
          }
        } catch(erro){feedback.textContent='Não foi salvo: '+erro.message; botao.disabled=false;}
      });
      section.querySelector('[data-novo-retorno]')?.addEventListener('click', () => {
        forcarNovo=true; render();
      });
    };
    render();
    section.atualizarLinha = function(novaLinha) {
      linha = novaLinha;
      forcarNovo = false;
      render();
    };
    return section;
  }
  async function abrir(numero, previa) {
    try {
      let linha = await root.SistemaOSSupabaseGarantia.obterCompleta(numero);
      if (!linha) throw new Error('Nenhuma garantia encontrada para esta OS.');
      const dialog = document.createElement('dialog');
      dialog.className = 'garantia-editor';
      dialog.setAttribute('aria-label', (previa ? 'Comprovante de garantia ' : 'Editar garantia ') + numero);
      const focoAnterior = document.activeElement;
      let painelRetorno = null;
      const fechar = () => { dialog.close(); dialog.remove(); focoAnterior?.focus(); };
      const campo = (rotulo, nome, valor, tipo='text') => '<label>'+rotulo+'<input name="'+nome+'" type="'+tipo+'" value="'+esc(valor)+'" '+(tipo==='number'?'min="0" max="36500" step="1"':'')+'></label>';
      dialog.innerHTML = '<header><h2>'+esc(previa?'Garantia '+numero:'Editar garantia '+numero)+'</h2><button type="button" class="btn-secundario" data-fechar aria-label="Fechar garantia">Fechar</button></header>';
      const fecharBotao = dialog.querySelector('[data-fechar]');
      fecharBotao.addEventListener('click', fechar);
      dialog.addEventListener('cancel', e => { e.preventDefault(); fechar(); });
      if (previa) {
        if (!root.SistemaOSGerarHtmlGarantia) throw new Error('O modelo ainda está carregando. Tente novamente.');
        const html = root.SistemaOSGerarHtmlGarantia(modelo(linha), root.ConfigApp.montarDadosEmpresa());
        const frame = document.createElement('iframe'); frame.title = 'Prévia do comprovante de garantia'; frame.srcdoc = html;
        dialog.appendChild(frame);
        const imprimir = document.createElement('button'); imprimir.type = 'button'; imprimir.className = 'btn-primario'; imprimir.textContent = 'Imprimir / salvar PDF';
        imprimir.onclick = async () => {
          try {
            const plugin = root.Capacitor?.Plugins?.Impressao;
            if (plugin?.imprimir) await plugin.imprimir({html, titulo:'Garantia '+numero});
            else { frame.contentWindow.focus(); frame.contentWindow.print(); }
          } catch (e) { root.SistemaOSToast.mostrar('Não foi possível imprimir. Tente novamente.', 'erro'); }
        };
        dialog.appendChild(imprimir);
      } else {
        const form = document.createElement('form');
        form.innerHTML = '<p>OS e identificação do cliente são preservadas. Alterações valem apenas para esta garantia.</p>'+
          campo('Cliente','cliente_nome_snapshot',linha.cliente_nome_snapshot)+campo('Telefone','cliente_telefone_snapshot',linha.cliente_telefone_snapshot,'tel')+
          campo('CPF (opcional)','clienteCpf',linha.dados_extras?.clienteCpf)+
          '<div class="garantia-grade">'+campo('Prazo em dias','garantia_dias',linha.garantia_dias,'number')+campo('Data inicial','data_abertura',linha.data_abertura,'date')+'</div>'+
          campo('Marca','marca_snapshot',linha.marca_snapshot)+campo('Modelo','modelo_snapshot',linha.modelo_snapshot)+
          '<label>Serviço realizado<textarea name="reparo_realizado" rows="3">'+esc(linha.reparo_realizado)+'</textarea></label>'+
          '<label>Termos desta garantia<textarea name="termos" rows="6">'+esc(linha.termos)+'</textarea></label>'+
          '<p data-feedback role="status"></p><button class="btn-primario" type="submit">Salvar garantia na nuvem</button>';
        ['cliente_nome_snapshot','garantia_dias','data_abertura'].forEach(nome=>form.elements[nome].required=true);
        form.onsubmit = async e => {
          e.preventDefault(); const btn = form.querySelector('button[type=submit]'); const feedback=form.querySelector('[data-feedback]');
          btn.disabled=true; feedback.textContent='Salvando…';
          try {
            const dados=Object.fromEntries(new FormData(form));
            dados.dados_extras={clienteCpf:dados.clienteCpf}; delete dados.clienteCpf;
            linha=await root.SistemaOSSupabaseGarantia.salvar(linha,dados);
            painelRetorno?.atualizarLinha(linha);
            feedback.textContent='Garantia salva na nuvem. O PC receberá a atualização na sincronização.';
            document.dispatchEvent(new CustomEvent('sistema-os:garantia-atualizada',{detail:{numeroOS:numero}}));
          } catch(erro) { feedback.textContent='Não foi salvo: '+erro.message; }
          finally { btn.disabled=false; }
        };
        dialog.appendChild(form);
      }
      painelRetorno = criarPainelRetorno(linha, numero);
      painelRetorno.addEventListener('sistema-os:abrir-entrega-retorno', evento => {
        const entrega = evento.detail?.entrega;
        if (!entrega || !root.SistemaOSEntrega?.iniciarPorOS) return;
        fechar();
        root.SistemaOSEntrega.iniciarPorOS(entrega);
      });
      dialog.appendChild(painelRetorno);
      document.body.appendChild(dialog); dialog.showModal();
    } catch(erro) { root.SistemaOSToast.mostrar(erro.message,'erro'); }
  }
  root.SistemaOSGarantiaUI={abrir, modelo};
})(window);

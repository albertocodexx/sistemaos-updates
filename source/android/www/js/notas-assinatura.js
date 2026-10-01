(function (root) {
  'use strict';
  var geracao = 0;
  var estados = { aguardando_configuracao: 'Aguardando dados fiscais', na_fila: 'Na fila',
    processando: 'Aguardando autorização', autorizada: 'Autorizada', rejeitada: 'Precisa de revisão', cancelada: 'Cancelada' };
  root.carregarNotasAssinaturaMobile = async function (lista, chamar, pagina) {
    pagina = pagina || 0;
    var atual = ++geracao;
    lista.textContent = 'Consultando notas…';
    try {
      var r = await chamar('listar_notas_assinatura', { pagina: pagina });
      if (atual !== geracao || !lista.isConnected) return;
      lista.replaceChildren();
      var atualizar = document.createElement('button'); atualizar.type='button'; atualizar.className='btn-secundario';
      atualizar.textContent='Atualizar notas'; atualizar.onclick=function () { root.carregarNotasAssinaturaMobile(lista,chamar,pagina); }; lista.append(atualizar);
      if (!r.notas?.length) { var vazio=document.createElement('p'); vazio.textContent='Nenhuma nota de assinatura nesta página.'; lista.append(vazio); }
      (r.notas || []).forEach(function (nota) {
        var item=document.createElement('article'); item.className='assinatura-mobile-resumo';
        var titulo=document.createElement('strong'); titulo.textContent=nota.descricao;
        var resumo=document.createElement('span'); resumo.textContent=Number(nota.valor).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+' · '+new Date(nota.created_at).toLocaleDateString('pt-BR');
        var status=document.createElement('small'); status.textContent=estados[nota.status] || 'Em conferência';
        var info=document.createElement('small'); info.textContent=nota.ultimo_erro || (nota.numero ? 'NFS-e nº '+nota.numero+' · Código: '+nota.codigo_verificacao : 'Acompanhe a autorização por aqui.');
        item.append(titulo,resumo,status,info);
        if (nota.pdf_disponivel) [false,true].forEach(function (baixar) {
          var b=document.createElement('button'); b.type='button'; b.className='btn-secundario'; b.textContent=baixar ? 'Baixar PDF' : 'Abrir NF';
          b.onclick=async function () {
            b.disabled=true;
            try {
              var dados=await chamar('obter_nota_assinatura',{id:nota.id,baixar:baixar});
              var url=String(dados.nota?.url || '');
              if (!/^https:\/\//i.test(url)) throw new Error('O PDF ainda não está disponível.');
              var navegador=root.Capacitor?.Plugins?.Browser;
              if (navegador?.open) await navegador.open({url:url});
              else root.open(url,'_blank','noopener,noreferrer');
            } catch(e) { root.SistemaOSToast?.mostrar(e.message || 'Falha ao abrir a nota.',{ehErro:true}); }
            finally { b.disabled=false; }
          }; item.append(b);
        });
        lista.append(item);
      });
      [[pagina>0,'Anteriores',pagina-1],[r.mais,'Próximas',pagina+1]].forEach(function (opcao) {
        if (!opcao[0]) return;
        var b=document.createElement('button'); b.type='button'; b.className='btn-secundario'; b.textContent=opcao[1];
        b.onclick=function () { root.carregarNotasAssinaturaMobile(lista,chamar,opcao[2]); }; lista.append(b);
      });
    } catch(e) { if(atual===geracao) lista.textContent=e.message || 'Não foi possível consultar as notas.'; }
  };
})(window);

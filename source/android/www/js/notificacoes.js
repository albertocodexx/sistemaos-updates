// js/notificacoes.js
//
// Notificações locais (fora do app, mesmo com app fechado) para OS
// atrasada / perto do prazo, via @capacitor/local-notifications.
//
// IMPORTANTE — este módulo NÃO funciona sozinho. Ele espera que o
// build Capacitor tenha o plugin instalado e registrado:
//
//   npm install @capacitor/local-notifications
//   npx cap sync
//
// e que window.Capacitor.Plugins.LocalNotifications exista em tempo
// de execução (só existe dentro do WebView do app empacotado — nunca
// existe no navegador comum, nem antes do `npx cap sync`). Sem isso,
// TODA função aqui vira no-op seguro: resolve com { agendada: false,
// motivo: 'plugin-indisponivel' } e nunca lança.
//
// Android 13+ exige permissão em tempo de execução para notificações
// (POST_NOTIFICATIONS) — solicitarPermissao() cobre isso; sem chamar
// essa função ao menos uma vez (ex.: ao entrar na aba Estatísticas),
// as notificações agendadas abaixo não aparecem no Android 13+.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(typeof window !== 'undefined' ? window : globalThis);
  } else {
    root.Notificacoes = factory(root);
  }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  function plugin() {
    var capacitor = root && root.Capacitor;
    return (capacitor && capacitor.Plugins && capacitor.Plugins.LocalNotifications) || null;
  }

  function disponivel() {
    return !!plugin();
  }

  function rotuloOS(valor) {
    if (root.SistemaOSNumero && typeof root.SistemaOSNumero.formatar === 'function') {
      return root.SistemaOSNumero.formatar(valor) || 'OS';
    }
    var texto = String(valor == null ? '' : valor).trim();
    var anterior = null;
    while (texto && texto !== anterior) {
      anterior = texto;
      texto = texto.replace(/^(?:OS)\s*(?:n(?:[º°o.]|ro\.?)?\s*)?[#:\-–—]*\s*/i, '').trim();
    }
    return texto ? 'OS-' + texto.replace(/^[#:\-–—\s]+/, '') : 'OS';
  }

  // Pede a permissão de notificação ao usuário (Android 13+/iOS).
  // Idempotente — o próprio plugin não pergunta de novo se já foi
  // concedida/negada antes; chamar de novo só confirma o estado atual.
  function solicitarPermissao() {
    var p = plugin();
    if (!p) return Promise.resolve({ concedida: false, motivo: 'plugin-indisponivel' });
    return p.requestPermissions()
      .then(function (resultado) {
        return { concedida: resultado && resultado.display === 'granted' };
      })
      .catch(function (erro) {
        return { concedida: false, motivo: 'erro', erro: erro };
      });
  }

  // Gera um id numérico estável a partir do número da OS (o plugin
  // exige id inteiro) — mesmo número da OS sempre gera o mesmo id, o
  // que permite reagendar/substituir a notificação de uma OS específica
  // sem duplicar (o plugin substitui notificações de mesmo id).
  function idNotificacaoParaOS(numeroOS, sufixo) {
    var texto = rotuloOS(numeroOS) + '|' + (sufixo || '');
    var hash = 0;
    for (var i = 0; i < texto.length; i++) {
      hash = ((hash << 5) - hash + texto.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) || 1;
  }

  // Agenda (ou substitui) uma notificação imediata para uma OS
  // atrasada ou perto do prazo. `os` é um item do array
  // `ordensAbertas` do resumo de estatísticas (ver js/estatisticas.js):
  // precisa ter
  // numero, aparelho, clienteNome, dataPrevista.
  //
  // Resolve SEMPRE (nunca rejeita) com { agendada: true } ou
  // { agendada: false, motivo }.
  function notificarOSAtrasadaOuPertoDoPrazo(os, tipoAlerta) {
    var p = plugin();
    if (!p) return Promise.resolve({ agendada: false, motivo: 'plugin-indisponivel' });
    if (!os || !os.numero) return Promise.resolve({ agendada: false, motivo: 'os-invalida' });

    var titulo = tipoAlerta === 'atrasada'
      ? rotuloOS(os.numero) + ' atrasada'
      : rotuloOS(os.numero) + ' perto do prazo';
    var aparelho = os.aparelho || 'aparelho';
    var dataFormatada = formatarDataPrevista(os.dataPrevista, os.horaPrevista);
    var defeito = os.defeito || os.defeitoRelatado || '';
    var emitidaEm = formatarDataHoraNotificacao(new Date());
    var corpo = aparelho + (defeito ? ' — defeito: ' + defeito : '') +
      (os.clienteNome ? ' — ' + os.clienteNome : '') +
      (dataFormatada ? ' — prazo: ' + dataFormatada : '') +
      (emitidaEm ? ' — aviso: ' + emitidaEm : '');

    return p.schedule({
      notifications: [{
        id: idNotificacaoParaOS(os.numero, tipoAlerta),
        title: titulo,
        body: corpo,
        schedule: { at: new Date() } // imediata — o agendamento de "quando checar" é feito por quem chama (ver checarPendentesEAlertar)
      }]
    }).then(function () {
      return { agendada: true };
    }).catch(function (erro) {
      return { agendada: false, motivo: 'erro', erro: erro };
    });
  }

  function formatarDataPrevista(dataPrevista, horaPrevista) {
    if (!dataPrevista) return '';
    try {
      var partes = dataPrevista.split('-'); // YYYY-MM-DD
      var formatada = partes[2] + '/' + partes[1] + '/' + partes[0];
      return horaPrevista ? formatada + ' ' + horaPrevista : formatada;
    } catch (e) {
      return dataPrevista;
    }
  }

  function formatarDataHoraNotificacao(data) {
    try {
      var instante = data instanceof Date ? data : new Date(data);
      if (!Number.isFinite(instante.getTime())) return '';
      return instante.toLocaleDateString('pt-BR') + ' às ' +
        instante.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  // Percorre um resumo já classificado (ver Estatisticas.classificarOrdens)
  // e notifica cada OS atrasada/perto do prazo — uma vez por OS por
  // chamada (o id estável evita duplicar notificação da MESMA OS se
  // esta função rodar de novo antes do status mudar; o plugin
  // substitui a notificação existente de mesmo id em vez de empilhar).
  function checarPendentesEAlertar(classificado) {
    if (!disponivel() || !classificado) return Promise.resolve({ notificadas: 0 });
    var pendentes = (classificado.atrasadas || []).map(function (os) { return { os: os, tipo: 'atrasada' }; })
      .concat((classificado.pertoDoPrazo || []).map(function (os) { return { os: os, tipo: 'perto-do-prazo' }; }));

    return pendentes.reduce(function (promessa, item) {
      return promessa.then(function (contagem) {
        return notificarOSAtrasadaOuPertoDoPrazo(item.os, item.tipo).then(function (resultado) {
          return contagem + (resultado.agendada ? 1 : 0);
        });
      });
    }, Promise.resolve(0)).then(function (total) {
      return { notificadas: total };
    });
  }

  // Agenda um aviso para 24 horas antes do prazo. Como o agendamento fica
  // registrado pelo Android, ele aparece mesmo se o APK estiver fechado.
  // Reabrir a aba Reparos apenas atualiza a notificacao de mesmo id.
  function agendarAvisoReparo(os) {
    var p = plugin();
    if (!p) return Promise.resolve({ agendada: false, motivo: 'plugin-indisponivel' });
    if (!os || !os.numero || !os.dataPrevista) return Promise.resolve({ agendada: false, motivo: 'sem-prazo' });
    var id = idNotificacaoParaOS(os.numero, 'reparo-prazo');
    if (['Entregue', 'Cancelado'].indexOf(os.status) !== -1) {
      return p.cancel({ notifications: [{ id: id }] })
        .then(function () { return { agendada: false, motivo: 'reparo-encerrado' }; })
        .catch(function () { return { agendada: false, motivo: 'reparo-encerrado' }; });
    }
    var limite = new Date(String(os.dataPrevista) + 'T' + String(os.horaPrevista || '23:59') + ':00');
    if (!Number.isFinite(limite.getTime())) return Promise.resolve({ agendada: false, motivo: 'prazo-invalido' });
    var quando = new Date(limite.getTime() - 24 * 60 * 60 * 1000);
    var atrasada = limite.getTime() < Date.now();
    if (quando.getTime() <= Date.now()) quando = new Date(Date.now() + 2000);
    var aparelho = os.aparelho || 'Aparelho não informado';
    var defeito = os.defeito || os.defeitoRelatado || 'Defeito não informado';
    var corpo = aparelho + ' — ' + defeito + ' — prazo: ' + formatarDataPrevista(os.dataPrevista, os.horaPrevista) +
      ' — aviso: ' + formatarDataHoraNotificacao(quando);
    return p.schedule({
      notifications: [{
        id: id,
        title: atrasada ? 'Reparo ' + rotuloOS(os.numero) + ' atrasado' : 'Reparo ' + rotuloOS(os.numero) + ' perto do prazo',
        body: corpo,
        schedule: { at: quando, allowWhileIdle: true },
        extra: { numeroOS: rotuloOS(os.numero), tela: 'reparos' }
      }]
    }).then(function () {
      return { agendada: true, para: quando.toISOString() };
    }).catch(function (erro) {
      return { agendada: false, motivo: 'erro', erro: erro };
    });
  }

  function agendarAvisosReparos(ordens) {
    if (!disponivel()) return Promise.resolve({ agendadas: 0 });
    return (ordens || []).reduce(function (promessa, os) {
      return promessa.then(function (total) {
        return agendarAvisoReparo(os).then(function (resultado) {
          return total + (resultado.agendada ? 1 : 0);
        });
      });
    }, Promise.resolve(0)).then(function (total) { return { agendadas: total }; });
  }

  function valorTotalOS(os) {
    return Number(os && (os.valorTotalServico || os.valor) || 0) || 0;
  }

  function valorRecebidoOS(os) {
    var exato = Number(os && os.valorRecebidoConfirmado || 0);
    if (exato > 0) return exato;
    var total = valorTotalOS(os);
    var percentual = Number(os && os.percentualPagamentoConfirmado || 0);
    if (/^(autorizado|pago)$/.test(String(os && os.statusPagamento || '').toLowerCase())) percentual = 100;
    return total > 0 ? total * Math.max(0, Math.min(100, percentual)) / 100 : 0;
  }

  function chaveLembreteAgendado(os, item) {
    var versao = item.atualizadoEm || item.data || item.status || '';
    return 'sistema-os-lembrete-cobranca:' + empresaAtiva() + ':' + rotuloOS(os.numero) + ':' + String(item.id || item.data) + ':' + versao;
  }

  function statusLembreteCobranca(item) {
    var salvo = String(item && item.status || '').toLowerCase();
    if (item && (item.confirmadoEm || item.pagoEm) && salvo !== 'desativada') return 'paga';
    if (salvo === 'paga' || salvo === 'atrasada' || salvo === 'desativada') return salvo;
    var limite = new Date(String(item && item.data || '').slice(0, 10) + 'T23:59:59');
    return Number.isFinite(limite.getTime()) && limite.getTime() < Date.now() ? 'atrasada' : 'pendente';
  }

  function cancelarLembreteCobranca(os, item) {
    var p = plugin();
    if (!p || !os || !os.numero || !item) return Promise.resolve({ cancelada: false });
    var id = idNotificacaoParaOS(os.numero, 'cobranca-' + String(item.id || item.data));
    return p.cancel({ notifications: [{ id: id }] })
      .then(function () { return { cancelada: true }; })
      .catch(function () { return { cancelada: false }; });
  }

  function agendarLembreteCobranca(os, item) {
    var p = plugin();
    if (!p || !os || !os.numero || !item || !item.data) return Promise.resolve({ agendada: false });
    var id = idNotificacaoParaOS(os.numero, 'cobranca-' + String(item.id || item.data));
    var status = statusLembreteCobranca(item);
    if (status === 'paga' || status === 'desativada') {
      return cancelarLembreteCobranca(os, item).then(function () { return { agendada: false, motivo: status }; });
    }
    var quando = new Date(String(item.data).slice(0, 10) + 'T09:00:00');
    if (!Number.isFinite(quando.getTime())) return Promise.resolve({ agendada: false, motivo: 'data-invalida' });
    quando.setDate(quando.getDate() - Math.max(0, Math.min(30, Number(item.avisarAntesDias || 0))));
    var atrasado = status === 'atrasada' || quando.getTime() < Date.now();
    if (atrasado) {
      try {
        if (root.localStorage.getItem(chaveLembreteAgendado(os, item)) === 'avisado') return Promise.resolve({ agendada: false, motivo: 'ja-avisado' });
        root.localStorage.setItem(chaveLembreteAgendado(os, item), 'avisado');
      } catch (_) {}
      quando = new Date(Date.now() + 1200);
    }
    var total = valorTotalOS(os);
    var recebido = valorRecebidoOS(os);
    var falta = Math.max(0, total - recebido);
    var valorLembrete = Number(item.valor || 0);
    var cliente = String(os.cliente && os.cliente.nome || '').trim();
    var detalhes = [cliente, valorLembrete > 0 ? 'Parcela ' + numeroMoeda(valorLembrete) : '', 'Falta ' + (numeroMoeda(falta) || 'confirmar')].filter(Boolean);
    return p.schedule({
      notifications: [{
        id: id,
        title: (atrasado ? 'Cobrança atrasada — ' : 'Lembrete de cobrança — ') + rotuloOS(os.numero),
        body: detalhes.join(' · '),
        schedule: { at: quando, allowWhileIdle: true },
        extra: { numeroOS: rotuloOS(os.numero), tela: 'cobrancas', tipo: 'cobranca-os', lembreteId: item.id || '' }
      }]
    }).then(function () { return { agendada: true }; }).catch(function (erro) { return { agendada: false, erro: erro }; });
  }

  function notificarTesteCobranca(os, item) {
    var p = plugin();
    if (!p || !os || !os.numero || !item) return Promise.resolve({ agendada: false, motivo: 'plugin-indisponivel' });
    return solicitarPermissao().then(function (permitida) {
      if (!permitida || permitida.concedida !== true) return { agendada: false, motivo: permitida && permitida.motivo || 'permissao' };
      var valor = Number(item.valor || 0);
      var cliente = String(os.cliente && os.cliente.nome || 'Cliente não informado').trim();
      return p.schedule({
        notifications: [{
          id: idNotificacaoParaOS(os.numero, 'cobranca-teste'),
          title: 'Teste de cobrança — ' + rotuloOS(os.numero),
          body: [cliente, valor > 0 ? numeroMoeda(valor) : '', 'Vencimento ' + String(item.data || '').split('-').reverse().join('/')].filter(Boolean).join(' · '),
          schedule: { at: new Date(Date.now() + 900), allowWhileIdle: true },
          extra: { numeroOS: rotuloOS(os.numero), tela: 'cobrancas', tipo: 'cobranca-teste', lembreteId: item.id || '' }
        }]
      }).then(function () { return { agendada: true }; }).catch(function (erro) { return { agendada: false, erro: erro }; });
    });
  }

  function agendarLembretesCobranca(ordens) {
    return (ordens || []).reduce(function (promessa, os) {
      return promessa.then(function (total) {
        return (os.lembretesCobranca || []).reduce(function (cadeia, item) {
          return cadeia.then(function (contagem) {
            return agendarLembreteCobranca(os, item).then(function (resultado) { return contagem + (resultado.agendada ? 1 : 0); });
          });
        }, Promise.resolve(total));
      });
    }, Promise.resolve(0)).then(function (total) { return { agendadas: total }; });
  }

  function osEstaAutorizada(os) {
    if (!os) return false;
    var pagamento = String(os.statusPagamento || os.status_pagamento || '').toLowerCase();
    var status = String(os.status || '').toLowerCase();
    return ['autorizado', 'pago', 'pago 50%'].indexOf(pagamento) !== -1 || os.statusAprovacao === 'Aprovado' ||
      (pagamento === 'aguardando pagamento na retirada' &&
        status !== 'aguardando aprovação' && status !== 'aguardando aprovacao' && status !== 'cancelado');
  }

  function notificarOSAutorizada(os) {
    var p = plugin();
    if (!p) return Promise.resolve({ agendada: false, motivo: 'plugin-indisponivel' });
    if (!os || !os.numero) return Promise.resolve({ agendada: false, motivo: 'os-invalida' });
    var aparelho = os.aparelho || {};
    var modelo = [aparelho.marca || os.marca, aparelho.modelo || os.modelo]
      .filter(Boolean).join(' ').trim() || 'Aparelho não informado';
    var emitidaEm = formatarDataHoraNotificacao(new Date());
    return p.schedule({
      notifications: [{
        id: idNotificacaoParaOS(os.numero, 'autorizada'),
        title: rotuloOS(os.numero) + ' autorizada',
        body: modelo + ' foi autorizado para reparo.' + (emitidaEm ? ' ' + emitidaEm + '.' : ''),
        schedule: { at: new Date(Date.now() + 250), allowWhileIdle: true },
        extra: { numeroOS: rotuloOS(os.numero), tela: 'reparos', tipo: 'os-autorizada' }
      }]
    }).then(function () {
      return { agendada: true };
    }).catch(function (erro) {
      return { agendada: false, motivo: 'erro', erro: erro };
    });
  }

  function numeroMoeda(valor) {
    var numero = Number(valor);
    if (!Number.isFinite(numero) || numero <= 0) return '';
    try {
      return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    } catch (_) {
      return 'R$ ' + numero.toFixed(2).replace('.', ',');
    }
  }

  // Retorna uma assinatura pequena e deterministica do pagamento. O monitor
  // compara esta assinatura com o retrato anterior e, por isso, uma entrada
  // de 50% e a quitacao posterior de 100% geram avisos distintos sem repetir
  // a mesma notificacao a cada evento Realtime.
  function assinaturaPagamentoRecebido(os) {
    if (!os) return '';
    var status = String(os.statusPagamento || os.status_pagamento || '').trim().toLowerCase();
    var percentual = Number(os.percentualPagamentoConfirmado || os.percentual_pagamento_confirmado || 0);
    var recebido = percentual > 0 || status === 'autorizado' || status === 'pago' || status === 'pago 50%';
    if (!recebido) return '';
    if (percentual <= 0) percentual = 100; // compatibilidade com OS antigas
    return [Math.min(100, percentual), status, String(os.formaPagamento || os.forma_pagamento || '')].join('|');
  }

  function notificarPagamentoRecebido(os) {
    var p = plugin();
    if (!p) return Promise.resolve({ agendada: false, motivo: 'plugin-indisponivel' });
    if (!os || !os.numero) return Promise.resolve({ agendada: false, motivo: 'os-invalida' });

    var percentual = Number(os.percentualPagamentoConfirmado || os.percentual_pagamento_confirmado || 0);
    if (percentual <= 0) percentual = 100;
    percentual = Math.min(100, percentual);
    var total = Number(os.valorTotalServico || os.valor || 0);
    var valorRecebido = percentual < 100 && total > 0 ? total * (percentual / 100) : total;
    var forma = String(os.formaPagamento || os.forma_pagamento || '').trim();
    var cliente = String((os.cliente && os.cliente.nome) || os.clienteNome || '').trim();
    var detalhes = [];
    var valorFormatado = numeroMoeda(valorRecebido);
    if (valorFormatado) detalhes.push(valorFormatado);
    detalhes.push(percentual + '% confirmado');
    if (forma) detalhes.push(forma);
    if (cliente) detalhes.push(cliente);
    var emitidaEm = formatarDataHoraNotificacao(new Date());

    return p.schedule({
      notifications: [{
        id: idNotificacaoParaOS(os.numero, 'pagamento-' + percentual),
        title: 'Pagamento recebido — ' + rotuloOS(os.numero),
        body: detalhes.join(' · ') + (emitidaEm ? '. ' + emitidaEm + '.' : ''),
        schedule: { at: new Date(Date.now() + 250), allowWhileIdle: true },
        extra: {
          numeroOS: rotuloOS(os.numero),
          tela: 'consulta',
          tipo: 'pagamento-recebido',
          percentual: percentual
        }
      }]
    }).then(function () {
      return { agendada: true };
    }).catch(function (erro) {
      return { agendada: false, motivo: 'erro', erro: erro };
    });
  }

  var pararMonitorAutorizacoes = null;
  var timerMonitorAutorizacoes = null;
  var timerVerificacaoAutorizacoes = null;
  var monitorEmAndamento = false;
  var ultimaVerificacaoAutorizacoes = 0;
  var INTERVALO_MINIMO_VERIFICACAO_MS = 15000;

  function empresaAtiva() {
    try { return root.localStorage.getItem('sistema-os-empresa-ativa-v1') || 'sem-empresa'; }
    catch (_) { return 'sem-empresa'; }
  }

  function chaveMonitorAutorizacoes() {
    return 'sistema-os-eventos-v2:' + empresaAtiva();
  }

  function lerMonitorAutorizacoes() {
    try { return JSON.parse(root.localStorage.getItem(chaveMonitorAutorizacoes()) || 'null'); }
    catch (_) { return null; }
  }

  function salvarMonitorAutorizacoes(estado) {
    try { root.localStorage.setItem(chaveMonitorAutorizacoes(), JSON.stringify(estado)); }
    catch (_) { /* armazenamento cheio não bloqueia o aplicativo */ }
  }

  // Compara com o último retrato salvo. Assim uma autorização ocorrida com o
  // app em segundo plano também é avisada quando o usuário volta ao aplicativo.
  function verificarNovasAutorizacoes() {
    if (monitorEmAndamento || !root.SistemaOSSupabaseOS ||
        typeof root.SistemaOSSupabaseOS.listarLeves !== 'function') return Promise.resolve({ notificadas: 0 });
    // No segundo plano o WebView não consegue notificar melhor do que o
    // agendamento já feito. Evitar a leitura recorrente preserva a bateria e
    // impede carga inútil no Supabase quando o app não está visível.
    if (root.document && root.document.visibilityState === 'hidden') {
      return Promise.resolve({ notificadas: 0, motivo: 'app-em-segundo-plano' });
    }
    monitorEmAndamento = true;
    ultimaVerificacaoAutorizacoes = Date.now();
    return root.SistemaOSSupabaseOS.listarLeves(500).then(function (ordens) {
      agendarLembretesCobranca(ordens).catch(function () {});
      var anterior = lerMonitorAutorizacoes();
      var atual = {};
      var novas = [];
      var pagamentos = [];
      (ordens || []).forEach(function (os) {
        var numero = rotuloOS(os.numero);
        if (!numero) return;
        var autorizada = osEstaAutorizada(os);
        var pagamento = assinaturaPagamentoRecebido(os);
        atual[numero] = { autorizada: autorizada, pagamento: pagamento };
        if (!anterior) return;
        var estadoAnterior = anterior[numero];
        var autorizadaAntes = estadoAnterior && typeof estadoAnterior === 'object'
          ? estadoAnterior.autorizada === true : estadoAnterior === true;
        var pagamentoAntes = estadoAnterior && typeof estadoAnterior === 'object'
          ? String(estadoAnterior.pagamento || '') : '';
        if (pagamento && pagamento !== pagamentoAntes) pagamentos.push(os);
        else if (autorizada && !autorizadaAntes) novas.push(os);
      });
      salvarMonitorAutorizacoes(atual);
      return pagamentos.reduce(function (promessa, os) {
        return promessa.then(function (total) {
          return notificarPagamentoRecebido(os).then(function (resultado) {
            return total + (resultado.agendada ? 1 : 0);
          });
        });
      }, Promise.resolve(0)).then(function (totalPagamentos) {
        return novas.reduce(function (promessa, os) {
          return promessa.then(function (total) {
            return notificarOSAutorizada(os).then(function (resultado) {
              return total + (resultado.agendada ? 1 : 0);
            });
          });
        }, Promise.resolve(totalPagamentos));
      });
    }).then(function (total) {
      return { notificadas: total };
    }).catch(function (erro) {
      return { notificadas: 0, erro: erro };
    }).then(function (resultado) {
      monitorEmAndamento = false;
      return resultado;
    });
  }

  function agendarVerificacaoAutorizacoes(imediata) {
    if (timerVerificacaoAutorizacoes) return;
    var espera = imediata ? 0 : Math.max(1200, INTERVALO_MINIMO_VERIFICACAO_MS - (Date.now() - ultimaVerificacaoAutorizacoes));
    timerVerificacaoAutorizacoes = root.setTimeout(function () {
      timerVerificacaoAutorizacoes = null;
      verificarNovasAutorizacoes();
    }, espera);
  }

  function pararMonitor() {
    if (typeof pararMonitorAutorizacoes === 'function') pararMonitorAutorizacoes();
    pararMonitorAutorizacoes = null;
    if (timerMonitorAutorizacoes) root.clearInterval(timerMonitorAutorizacoes);
    timerMonitorAutorizacoes = null;
    if (timerVerificacaoAutorizacoes) root.clearTimeout(timerVerificacaoAutorizacoes);
    timerVerificacaoAutorizacoes = null;
  }

  function iniciarMonitorAutorizacoes() {
    pararMonitor();
    solicitarPermissao().then(function () { agendarVerificacaoAutorizacoes(true); }).catch(function () {});
    if (root.SistemaOSSupabaseOS && typeof root.SistemaOSSupabaseOS.assinar === 'function') {
      pararMonitorAutorizacoes = root.SistemaOSSupabaseOS.assinar(function () {
        agendarVerificacaoAutorizacoes(false);
      });
    }
    // Realtime é o caminho normal. Esta verificação de segurança é menos
    // frequente justamente para não escanear a empresa a cada minuto.
    timerMonitorAutorizacoes = root.setInterval(function () {
      agendarVerificacaoAutorizacoes(false);
    }, 120000);
  }

  var listenerAcaoNotificacaoInstalado = false;
  function instalarAberturaNotificacao() {
    var p = plugin();
    if (!p || listenerAcaoNotificacaoInstalado || typeof p.addListener !== 'function') return;
    listenerAcaoNotificacaoInstalado = true;
    p.addListener('localNotificationActionPerformed', function (evento) {
      var extra = evento && evento.notification && evento.notification.extra || {};
      if (!extra.numeroOS) return;
      var abrir = function () {
        if (extra.tela === 'cobrancas' && root.SistemaOSCobrancas && typeof root.SistemaOSCobrancas.abrir === 'function') {
          root.SistemaOSCobrancas.abrir(extra.numeroOS, extra.lembreteId || '');
          return;
        }
        if (root.SistemaOSConsulta && typeof root.SistemaOSConsulta.abrirOS === 'function') {
          root.SistemaOSConsulta.abrirOS(extra.numeroOS, { origem: 'notificacao', lembreteId: extra.lembreteId || '' });
        }
      };
      if (root.SistemaOSConsulta) abrir();
      else root.document && root.document.addEventListener('sistema-os:consulta-pronta', abrir, { once: true });
    });
  }

  if (root.document) {
    root.document.addEventListener('sistema-os:sessao-alterada', function (evento) {
      var tipo = evento && evento.detail && evento.detail.tipo;
      if (tipo === 'autenticado') iniciarMonitorAutorizacoes();
      else if (tipo === 'deslogado') pararMonitor();
    });
    root.document.addEventListener('visibilitychange', function () {
      if (root.document.visibilityState === 'visible') agendarVerificacaoAutorizacoes(true);
    });
    root.setTimeout(function () {
      instalarAberturaNotificacao();
      var estado = root.SistemaOSSessao && root.SistemaOSSessao.obterEstado
        ? root.SistemaOSSessao.obterEstado() : null;
      if (estado && estado.tipo === 'autenticado') iniciarMonitorAutorizacoes();
    }, 1500);
  }

  return {
    disponivel: disponivel,
    solicitarPermissao: solicitarPermissao,
    notificarOSAtrasadaOuPertoDoPrazo: notificarOSAtrasadaOuPertoDoPrazo,
    checarPendentesEAlertar: checarPendentesEAlertar,
    agendarAvisoReparo: agendarAvisoReparo,
    agendarAvisosReparos: agendarAvisosReparos,
    agendarLembreteCobranca: agendarLembreteCobranca,
    agendarLembretesCobranca: agendarLembretesCobranca,
    cancelarLembreteCobranca: cancelarLembreteCobranca,
    notificarTesteCobranca: notificarTesteCobranca,
    statusLembreteCobranca: statusLembreteCobranca,
    notificarOSAutorizada: notificarOSAutorizada,
    notificarPagamentoRecebido: notificarPagamentoRecebido,
    assinaturaPagamentoRecebido: assinaturaPagamentoRecebido,
    verificarNovasAutorizacoes: verificarNovasAutorizacoes,
    osEstaAutorizada: osEstaAutorizada
  };
});

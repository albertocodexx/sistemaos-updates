// Repositório do domínio de Clientes.
// Mantém o formato atual do database.json. A persistência é injetada pelo
// db.js para que o domínio possa ser exercitado sem acessar arquivo físico.

function createClientesRepository({ loadDB, saveDB }) {
  function buscarHistoricoCliente(cpf, nome) {
    const database = loadDB();
    const ordens = database.ordens || [];
    return ordens.filter(o => {
      const c = o.cliente || {};
      if (cpf && c.cpf && c.cpf.replace(/\D/g,'') === cpf.replace(/\D/g,'')) return true;
      if (!cpf && nome && c.nome && c.nome.toLowerCase() === nome.toLowerCase()) return true;
      return false;
    }).sort((a, b) => new Date(b.data) - new Date(a.data)).slice(0, 20);
  }

  function _clienteNormalizarCpf(cpf) { return (cpf || '').replace(/\D/g, ''); }
  function _clienteNormalizarNome(nome) { return (nome || '').trim().toLowerCase().replace(/\s+/g, ' '); }

  // Chave de agrupamento: CPF continua sendo o identificador mais estável
  // para unir documentos antigos (ainda sem ID) aos novos. O ID numérico
  // assume quando não há CPF; por fim usamos o nome para cadastros mínimos.
  // Sem nome e sem CPF não dá pra identificar o cliente — é ignorado.
  function _clienteChave(nome, cpf, clienteId) {
    const cpfNorm = _clienteNormalizarCpf(cpf);
    if (cpfNorm) return 'cpf:' + cpfNorm;
    const id = String(clienteId || '').replace(/\D/g, '');
    if (id) return 'id:' + id;
    const nomeNorm = _clienteNormalizarNome(nome);
    return nomeNorm ? 'nome:' + nomeNorm : null;
  }

  function agregarClientes() {
    const database = loadDB();
    const mapa = new Map();

    function registro(chave, nome, cpf, telefone, email, clienteId) {
      if (!mapa.has(chave)) {
        mapa.set(chave, {
          chave, clienteId: String(clienteId || '').replace(/\D/g, ''), nome: '', cpf: '', telefone: '', email: '',
          os: [], vendas: [], compras: [], entregas: [], garantias: [], desbloqueios: [],
          totalOS: 0, totalValorOS: 0, totalVendas: 0, totalCompras: 0,
          primeiraData: null, ultimaData: null
        });
      }
      const reg = mapa.get(chave);
      if (!reg.clienteId && clienteId) reg.clienteId = String(clienteId).replace(/\D/g, '');
      if (nome && nome.length > reg.nome.length) reg.nome = nome; // fica com o nome mais completo
      if (cpf && !reg.cpf) reg.cpf = cpf;
      if (telefone) reg.telefone = telefone; // telefone mais recente prevalece
      if (email && !reg.email) reg.email = email;
      return reg;
    }

    function atualizaDatas(reg, dataISO) {
      if (!dataISO) return;
      if (!reg.primeiraData || new Date(dataISO) < new Date(reg.primeiraData)) reg.primeiraData = dataISO;
      if (!reg.ultimaData || new Date(dataISO) > new Date(reg.ultimaData)) reg.ultimaData = dataISO;
    }

    // 1) Ordens de Serviço
    (database.ordens || []).forEach(os => {
      const c = os.cliente || {};
      if (c.excluido === true) return;
      const chave = _clienteChave(c.nome, c.cpf, c.clienteId);
      if (!chave) return;
      const reg = registro(chave, c.nome, c.cpf, c.telefone, c.email, c.clienteId);
      const ap = os.aparelho || {};
      const valorEstimado = parseFloat(os.valorTotalServico)
        || parseFloat(os.diagnosticoTecnico?.valorEstimado)
        || 0;
      reg.os.push({
        numero: os.numero,
        data: os.data,
        status: os.status || '',
        aparelho: [ap.marca, ap.modelo].filter(Boolean).join(' '),
        valorEstimado
      });
      reg.totalOS += 1;
      reg.totalValorOS += valorEstimado;
      atualizaDatas(reg, os.data);
    });

    const ordensPorNumero = new Map((database.ordens || []).map(os => [String(os.numero || '').trim(), os]));
    function registroRelacionado(item) {
      const os = ordensPorNumero.get(String(item.numeroOS || '').trim());
      const c = os?.cliente || {};
      const clienteId = item.clienteId || item.clienteNumero || c.clienteId;
      const chave = _clienteChave(c.nome || item.clienteNome || item.nomeRetirou, c.cpf || item.clienteCpf || item.cpfRetirou, clienteId);
      return chave ? registro(chave, c.nome || item.clienteNome || item.nomeRetirou, c.cpf || item.clienteCpf || item.cpfRetirou, c.telefone || item.clienteTelefone || item.telefoneRetirou, c.email, clienteId) : null;
    }

    // 2) Entregas e garantias: também fazem parte do prontuário do cliente.
    (database.entregas || []).forEach(entrega => {
      const reg = registroRelacionado(entrega);
      if (!reg) return;
      reg.entregas.push({
        documentoEntregaId: entrega.documentoEntregaId || '', numeroOS: entrega.numeroOS,
        data: entrega.dataHoraAssinatura || entrega.atualizadoEm, tipo: entrega.tipoEntrega || 'original',
        cicloEntregaId: entrega.cicloEntregaId || 'original', garantiaDias: Number(entrega.garantiaDias) || 0,
        assinaturaPendente: entrega.assinaturaPendente === true
      });
      atualizaDatas(reg, entrega.dataHoraAssinatura || entrega.atualizadoEm);
    });

    (database.garantias || []).forEach(garantia => {
      const reg = registroRelacionado(garantia);
      if (!reg) return;
      reg.garantias.push({
        numeroOS: garantia.numeroOS, data: garantia.dataInicio || garantia.criadoEm,
        dataLimite: garantia.dataLimite || '', garantiaDias: Number(garantia.garantiaDias) || 0,
        statusRetorno: garantia.statusRetorno || '', retornos: Array.isArray(garantia.retornosGarantia) ? garantia.retornosGarantia.length : 0
      });
      atualizaDatas(reg, garantia.atualizadoEm || garantia.dataInicio || garantia.criadoEm);
    });

    // 3) Vendas (itens de estoque com status "Vendido")
    (database.estoque || []).forEach(item => {
      if (item.status !== 'Vendido') return;
      if (item.compradorExcluido === true) return;
      const chave = _clienteChave(item.compradorNome, item.compradorCpf, item.compradorClienteId);
      if (!chave) return;
      const reg = registro(chave, item.compradorNome, item.compradorCpf, item.compradorTelefone, '', item.compradorClienteId);
      const dataVenda = item.dataVenda || item.dataCadastro;
      reg.vendas.push({
        id: item.id,
        data: dataVenda,
        aparelho: [item.marca, item.modelo].filter(Boolean).join(' '),
        valor: parseFloat(item.valorVenda) || 0
      });
      reg.totalVendas += parseFloat(item.valorVenda) || 0;
      atualizaDatas(reg, dataVenda);
    });

    // 4) Compras (contratos de compra de aparelho usado — cliente = vendedor)
    (database.compras || []).forEach(cp => {
      const v = cp.vendedor || {};
      if (v.excluido === true) return;
      const chave = _clienteChave(v.nome, v.cpf, v.clienteId);
      if (!chave) return;
      const reg = registro(chave, v.nome, v.cpf, v.telefone, v.email, v.clienteId);
      const ap = cp.aparelho || {};
      const dc = cp.dadosCompra || {};
      reg.compras.push({
        numero: cp.numero,
        data: cp.data,
        aparelho: [ap.marca, ap.modelo].filter(Boolean).join(' '),
        valor: parseFloat(dc.valor) || 0
      });
      reg.totalCompras += parseFloat(dc.valor) || 0;
      atualizaDatas(reg, cp.data);
    });

    // 5) Autorizações de desbloqueio. Esse registro também funciona como
    // origem de cliente: ao emitir a primeira autorização da pessoa, ela já
    // passa a existir na aba Clientes com o ID numérico atribuído pelo banco.
    (database.desbloqueios || []).forEach(documento => {
      const c = documento.cliente || {};
      if (c.excluido === true) return;
      const chave = _clienteChave(c.nome, c.cpf, c.clienteId);
      if (!chave) return;
      const reg = registro(chave, c.nome, c.cpf, c.telefone, c.email, c.clienteId);
      const ap = documento.aparelho || {};
      reg.desbloqueios.push({
        numero: documento.numero,
        data: documento.atualizadoEm || documento.criadoEm,
        aparelho: [ap.marca, ap.modelo].filter(Boolean).join(' '),
        tipoBloqueio: documento.tipoBloqueio || '',
        assinaturaPendente: documento.assinaturaPendente === true,
        naoAssinado: documento.naoAssinado === true,
        pdfPath: documento.pdfPath || ''
      });
      atualizaDatas(reg, documento.atualizadoEm || documento.criadoEm);
    });

    const lista = Array.from(mapa.values()).map(reg => {
      reg.os.sort((a, b) => new Date(b.data) - new Date(a.data));
      reg.vendas.sort((a, b) => new Date(b.data) - new Date(a.data));
      reg.compras.sort((a, b) => new Date(b.data) - new Date(a.data));
      reg.entregas.sort((a, b) => new Date(b.data) - new Date(a.data));
      reg.garantias.sort((a, b) => new Date(b.data) - new Date(a.data));
      reg.desbloqueios.sort((a, b) => new Date(b.data) - new Date(a.data));
      reg.totalDesbloqueios = reg.desbloqueios.length;
      reg.qtdInteracoes = reg.os.length + reg.vendas.length + reg.compras.length + reg.entregas.length + reg.garantias.length + reg.desbloqueios.length;
      return reg;
    });

    lista.sort((a, b) => new Date(b.ultimaData || 0) - new Date(a.ultimaData || 0));
    return lista;
  }

  function listarClientes() {
    return agregarClientes();
  }

  function buscarClientes(termo) {
    const lista = agregarClientes();
    if (!termo || !termo.trim()) return lista;
    const t = termo.trim().toLowerCase();
    const tDigits = t.replace(/\D/g, '');
    return lista.filter(c => {
      const nomeMatch = (c.nome || '').toLowerCase().includes(t);
      const cpfMatch = !!tDigits && (c.cpf || '').replace(/\D/g, '').includes(tDigits);
      const telMatch = !!tDigits && (c.telefone || '').replace(/\D/g, '').includes(tDigits);
      const idMatch = !!tDigits && String(c.clienteId || '').includes(tDigits);
      const emailMatch = (c.email || '').toLowerCase().includes(t);
      return nomeMatch || cpfMatch || telMatch || idMatch || emailMatch;
    });
  }

  function obterPerfilCliente(chave) {
    const lista = agregarClientes();
    return lista.find(c => c.chave === chave) || null;
  }

  // ─── v46.2.8 — Editar dados de cliente (nome/telefone/CPF) ────────────────
  // "Cliente" é um agregado calculado on-the-fly por agregarClientes() a
  // partir de três coleções (ordens[].cliente, estoque[] comprador*, e
  // compras[].vendedor) — não existe um registro próprio de cliente no banco.
  // Para "editar o cliente", propagamos a correção para todos os registros de
  // origem que compõem aquele agregado (identificado pela `chave` que
  // agregarClientes()/obterPerfilCliente() já retorna).
  //
  // Só os campos informados (não-undefined) em `dados` são alterados; campos
  // omitidos permanecem como estavam em cada registro de origem. Um campo
  // vazio ('') é uma alteração válida (limpa o campo), diferente de omitido.
  function atualizarDadosCliente(chave, dados) {
    if (!chave) return { sucesso: false, erro: 'Chave do cliente não informada.' };
    const { nome, telefone, cpf } = dados || {};
    if (nome === undefined && telefone === undefined && cpf === undefined) {
      return { sucesso: false, erro: 'Nenhum dado para atualizar.' };
    }

    const perfilAtual = obterPerfilCliente(chave);
    if (!perfilAtual) return { sucesso: false, erro: 'Cliente não encontrado.' };

    const database = loadDB();
    let registrosAtualizados = 0;

    // 1) Ordens de Serviço — cliente = os.cliente
    (database.ordens || []).forEach(os => {
      const c = os.cliente || {};
      if (_clienteChave(c.nome, c.cpf, c.clienteId) !== chave) return;
      if (nome !== undefined) c.nome = nome;
      if (telefone !== undefined) c.telefone = telefone;
      if (cpf !== undefined) c.cpf = cpf;
      os.cliente = c;
      registrosAtualizados++;
    });

    // 2) Estoque vendido — comprador = item.compradorNome/compradorCpf/compradorTelefone
    (database.estoque || []).forEach(item => {
      if (item.status !== 'Vendido') return;
      if (_clienteChave(item.compradorNome, item.compradorCpf, item.compradorClienteId) !== chave) return;
      if (nome !== undefined) item.compradorNome = nome;
      if (telefone !== undefined) item.compradorTelefone = telefone;
      if (cpf !== undefined) item.compradorCpf = cpf;
      registrosAtualizados++;
    });

    // 3) Compras — vendedor = cp.vendedor
    (database.compras || []).forEach(cp => {
      const v = cp.vendedor || {};
      if (_clienteChave(v.nome, v.cpf, v.clienteId) !== chave) return;
      if (nome !== undefined) v.nome = nome;
      if (telefone !== undefined) v.telefone = telefone;
      if (cpf !== undefined) v.cpf = cpf;
      cp.vendedor = v;
      registrosAtualizados++;
    });

    // 4) Autorizações de desbloqueio — mantém o prontuário e os PDFs futuros
    // alinhados com a correção feita no cadastro agregado.
    (database.desbloqueios || []).forEach(documento => {
      const c = documento.cliente || {};
      if (_clienteChave(c.nome, c.cpf, c.clienteId) !== chave) return;
      if (nome !== undefined) c.nome = nome;
      if (telefone !== undefined) c.telefone = telefone;
      if (cpf !== undefined) c.cpf = cpf;
      documento.cliente = c;
      registrosAtualizados++;
    });

    if (registrosAtualizados === 0) {
      return { sucesso: false, erro: 'Nenhum registro encontrado para este cliente.' };
    }

    saveDB(database);

    // Chave pode ter mudado (ex.: CPF novo informado onde antes só havia
    // nome). Usa nome/CPF finais (alterado, se veio; senão o que já existia
    // no perfil agregado) para recalcular a chave corretamente.
    const nomeFinal = nome !== undefined ? nome : perfilAtual.nome;
    const cpfFinal = cpf !== undefined ? cpf : perfilAtual.cpf;
    const novaChave = _clienteChave(nomeFinal, cpfFinal, perfilAtual.clienteId) || chave;
    const ordensAtualizadas = (database.ordens || [])
      .filter(os => _clienteChave(os.cliente?.nome, os.cliente?.cpf, os.cliente?.clienteId) === novaChave)
      .map(os => os.numero);
    return {
      sucesso: true,
      registrosAtualizados,
      ordensAtualizadas,
      cliente: obterPerfilCliente(novaChave) || obterPerfilCliente(chave)
    };
  }

  // Exclui o cadastro agregado e anonimiza dados pessoais nas transações
  // que precisam continuar existindo para estoque, financeiro e auditoria.
  // O marcador impede que o cliente volte à lista ao reiniciar o sistema.
  function excluirCliente(chave) {
    if (!chave) return { sucesso: false, erro: 'Chave do cliente não informada.' };
    const perfilAtual = obterPerfilCliente(chave);
    if (!perfilAtual) return { sucesso: false, erro: 'Cliente não encontrado.' };

    const database = loadDB();
    const ordensAtualizadas = [];
    const excluidoEm = new Date().toISOString();
    let registrosAtualizados = 0;

    (database.ordens || []).forEach(os => {
      const c = os.cliente || {};
      if (_clienteChave(c.nome, c.cpf, c.clienteId) !== chave) return;
      os.cliente = Object.assign({}, c, {
        nome: 'Cliente excluído',
        telefone: '',
        cpf: '',
        email: '',
        excluido: true,
        excluidoEm
      });
      ordensAtualizadas.push(os.numero);
      registrosAtualizados += 1;
    });

    (database.estoque || []).forEach(item => {
      if (item.status !== 'Vendido') return;
      if (_clienteChave(item.compradorNome, item.compradorCpf, item.compradorClienteId) !== chave) return;
      item.compradorNome = 'Cliente excluído';
      item.compradorTelefone = '';
      item.compradorCpf = '';
      item.compradorExcluido = true;
      item.compradorExcluidoEm = excluidoEm;
      registrosAtualizados += 1;
    });

    (database.compras || []).forEach(cp => {
      const v = cp.vendedor || {};
      if (_clienteChave(v.nome, v.cpf, v.clienteId) !== chave) return;
      cp.vendedor = Object.assign({}, v, {
        nome: 'Cliente excluído',
        telefone: '',
        cpf: '',
        email: '',
        excluido: true,
        excluidoEm
      });
      registrosAtualizados += 1;
    });

    (database.desbloqueios || []).forEach(documento => {
      const c = documento.cliente || {};
      if (_clienteChave(c.nome, c.cpf, c.clienteId) !== chave) return;
      documento.cliente = Object.assign({}, c, {
        nome: 'Cliente excluído',
        telefone: '',
        cpf: '',
        email: '',
        excluido: true,
        excluidoEm
      });
      registrosAtualizados += 1;
    });

    if (!registrosAtualizados) {
      return { sucesso: false, erro: 'Nenhum registro foi encontrado para este cliente.' };
    }
    saveDB(database);
    return {
      sucesso: true,
      registrosAtualizados,
      ordensAtualizadas,
      nomeAnterior: perfilAtual.nome || ''
    };
  }

  return {
    buscarHistoricoCliente,
    listarClientes,
    buscarClientes,
    obterPerfilCliente,
    atualizarDadosCliente,
    excluirCliente
  };
}

module.exports = { createClientesRepository };

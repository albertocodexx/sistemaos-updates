// js/validacao.js
//
// Espelha, campo a campo, a validação de src/db.js do PC — especificamente
// validarCPF, validarIMEI, validarDadosOS e a constante PRIORIDADES_OS_VALIDAS.
// Isso existe pra o formulário do celular barrar erros ANTES de exportar o
// .json, evitando que o PC rejeite o arquivo na hora de importar.
//
// Esta NÃO é uma cópia literal do arquivo do PC (db.js é Node/Electron, tem
// muita coisa que não se aplica aqui — leitura de disco, geração de número,
// etc.). É uma reimplementação das MESMAS regras, comentada linha a linha
// com a referência ao trecho original de src/db.js, pra facilitar auditoria
// se o PC mudar essas regras no futuro.

(function () {
  'use strict';

  // Espelha PRIORIDADES_OS_VALIDAS (src/db.js, linha ~501).
  var PRIORIDADES_OS_VALIDAS = ['Baixa', 'Normal', 'Alta', 'Urgente'];

  // Espelha function validarCPF(cpf) (src/db.js, linha ~122) — dígito
  // verificador em dois passos, padrão Receita Federal. Mesma lógica,
  // mesma ordem de operações, só reescrita em função nomeada isolada.
  function validarCPF(cpf) {
    var nums = (cpf || '').replace(/\D/g, '');
    if (nums.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(nums)) return false;
    var s = 0;
    for (var i = 0; i < 9; i++) s += parseInt(nums[i], 10) * (10 - i);
    var r = (s * 10) % 11;
    if (r === 10 || r === 11) r = 0;
    if (r !== parseInt(nums[9], 10)) return false;
    s = 0;
    for (var j = 0; j < 10; j++) s += parseInt(nums[j], 10) * (11 - j);
    r = (s * 10) % 11;
    if (r === 10 || r === 11) r = 0;
    return r === parseInt(nums[10], 10);
  }

  // Espelha function validarIMEI(imei) (src/db.js, linha ~140) — só
  // contagem de 15 dígitos, sem algoritmo Luhn (comentário original do PC
  // explica: 15 é o padrão GSM/GSMA atual, 14 era formato pré-2003).
  function validarIMEI(imei) {
    var nums = (imei || '').replace(/\D/g, '');
    return nums.length === 15;
  }

  // Espelha function validarDadosOS(dadosOS) (src/db.js, linha ~146).
  // Mesmos 5 campos obrigatórios, mesmas mensagens de erro, mesma
  // validação condicional de cpf/imei (só valida se preenchido).
  //
  // Diferença deliberada: o objeto de erros aqui usa as MESMAS chaves que
  // o db.js usa (nome, telefone, marca, modelo, defeitoRelatado, cpf,
  // imei), pra permitir apontar o erro no campo certo do formulário.
  function validarDadosOS(dadosOS) {
    var erros = {};
    var nome = ((dadosOS.cliente && dadosOS.cliente.nome) || '').trim();
    var telefone = ((dadosOS.cliente && dadosOS.cliente.telefone) || '').trim();
    var marca = ((dadosOS.aparelho && dadosOS.aparelho.marca) || '').trim();
    var modelo = ((dadosOS.aparelho && dadosOS.aparelho.modelo) || '').trim();
    var defeito = ((dadosOS.aparelho && dadosOS.aparelho.defeitoRelatado) || '').trim();
    var cpf = ((dadosOS.cliente && dadosOS.cliente.cpf) || '').trim();
    var imei = ((dadosOS.aparelho && dadosOS.aparelho.imei) || dadosOS.imei || '').trim();
    var semNumero = dadosOS.cliente && dadosOS.cliente.semNumero;

    if (!nome) erros.nome = 'Nome do cliente é obrigatório.';
    if (!telefone && !semNumero) erros.telefone = 'Informe o telefone ou marque "Cliente não tem número".';
    if (!marca) erros.marca = 'Marca é obrigatória.';
    if (!modelo) erros.modelo = 'Modelo é obrigatório.';
    if (!defeito) erros.defeitoRelatado = 'Defeito relatado é obrigatório.';
    if (cpf && !validarCPF(cpf)) erros.cpf = 'CPF inválido.';
    if (imei && !validarIMEI(imei)) erros.imei = 'IMEI inválido (deve ter 15 dígitos).';

    return Object.keys(erros).length === 0 ? null : erros;
  }

  // Validação dos dados de Compra (compra de aparelho usado do cliente),
  // no mesmo padrão de validarDadosOS: recebe o objeto `cp` no formato
  // esperado por gerarHtmlCompra (src/templates/compra-template.js) —
  // { vendedor, aparelho, avaliacao, dadosCompra } — e devolve um objeto
  // de erros (chaves iguais aos `data-erro-de` do form-compra em
  // index.html) ou `null` se estiver tudo certo.
  //
  // Campos obrigatórios (mesmo critério do form-compra em index.html):
  // nome e telefone do vendedor, marca e modelo do aparelho, valor pago.
  // CPF só é validado se preenchido (é opcional no formulário).
  function validarDadosCompra(cp) {
    var erros = {};
    var v = cp.vendedor || {};
    var ap = cp.aparelho || {};
    var compra = cp.dadosCompra || {};

    var vendedorNome = (v.nome || '').trim();
    var vendedorTelefone = (v.telefone || '').trim();
    var aparelhoMarca = (ap.marca || '').trim();
    var aparelhoModelo = (ap.modelo || '').trim();
    var vendedorCpf = (v.cpf || '').trim();
    var valor = compra.valor;
    var vendedorSemNumero = v.semNumero;

    if (!vendedorNome) erros.vendedorNome = 'Nome do vendedor é obrigatório.';
    if (!vendedorTelefone && !vendedorSemNumero) erros.vendedorTelefone = 'Informe o telefone ou marque "Vendedor não tem número".';
    if (!aparelhoMarca) erros.aparelhoMarca = 'Marca é obrigatória.';
    if (!aparelhoModelo) erros.aparelhoModelo = 'Modelo é obrigatório.';
    if (vendedorCpf && !validarCPF(vendedorCpf)) erros.vendedorCpf = 'CPF inválido.';
    if (valor === '' || valor === null || valor === undefined || isNaN(Number(valor)) || Number(valor) <= 0) {
      erros.valor = 'Valor pago é obrigatório e deve ser maior que zero.';
    }

    return Object.keys(erros).length === 0 ? null : erros;
  }

  // Validação dos dados de Venda (venda de aparelho ao cliente), no mesmo
  // padrão de validarDadosOS/validarDadosCompra: recebe o objeto `vd` no
  // formato "flat" esperado por gerarHtmlVenda (src/templates/venda-template.js)
  // — { marca, modelo, cor, imei, observacoes, garantia, compradorNome,
  // compradorTelefone, compradorCpf, valorVenda, formaPagamento } — e devolve
  // um objeto de erros (chaves iguais aos `data-erro-de` do form-venda em
  // index.html) ou `null` se estiver tudo certo.
  //
  // Campos obrigatórios (mesmo critério do form-venda em index.html): marca
  // e modelo do aparelho, nome e telefone do comprador, valor da venda. CPF
  // só é validado se preenchido (é opcional no formulário).
  function validarDadosVenda(vd) {
    var erros = {};
    vd = vd || {};

    var marca = (vd.marca || '').trim();
    var modelo = (vd.modelo || '').trim();
    var compradorNome = (vd.compradorNome || '').trim();
    var compradorTelefone = (vd.compradorTelefone || '').trim();
    var compradorCpf = (vd.compradorCpf || '').trim();
    var valor = vd.valorVenda;
    var compradorSemNumero = vd.compradorSemNumero;

    if (!vd.dataVenda || isNaN(new Date(vd.dataVenda).getTime())) erros.dataVenda = 'Informe a data da venda.';
    if (!marca) erros.marca = 'Marca é obrigatória.';
    if (!modelo) erros.modelo = 'Modelo é obrigatório.';
    if (!compradorNome) erros.compradorNome = 'Nome do comprador é obrigatório.';
    if (!compradorTelefone && !compradorSemNumero) erros.compradorTelefone = 'Informe o telefone ou marque "Comprador não tem número".';
    if (compradorCpf && !validarCPF(compradorCpf)) erros.compradorCpf = 'CPF inválido.';
    if (valor === '' || valor === null || valor === undefined || isNaN(Number(valor)) || Number(valor) <= 0) {
      erros.valorVenda = 'Valor da venda é obrigatório e deve ser maior que zero.';
    }

    return Object.keys(erros).length === 0 ? null : erros;
  }

  // Validação dos dados do Comprovante de Entrega (aba "Entregas"), no
  // mesmo padrão das outras 3: recebe o objeto `en` no formato esperado
  // por gerarHtmlEntrega (src/templates/entrega-template.js) — { numeroOS,
  // nomeRetirou, declaracao, dataHoraAssinatura } — e devolve um objeto de
  // erros (chaves iguais aos `data-erro-de` do form-entrega em index.html)
  // ou `null` se estiver tudo certo.
  //
  // Campos obrigatórios (ver PROMPT-CELULAR-aba-entregas.md, item 2):
  // número da OS e nome de quem retirou — os dois só como texto livre,
  // sem checagem de formato. Este módulo NÃO valida se a OS existe de
  // verdade (o celular não tem acesso ao banco do PC) — isso é
  // responsabilidade exclusiva do PC no momento do import, por decisão de
  // arquitetura.
  //
  // marca/modelo/reparoRealizado (seção "DADOS DO APARELHO") são
  // OPCIONAIS por design — mesmo critério do template
  // (entrega-template.js): a seção inteira some da prévia/PDF se os três
  // vierem vazios, e o comprovante de entrega é deliberadamente mais
  // enxuto que uma OS completa (não reconstitui a OS inteira, só
  // registra o essencial da retirada). NÃO tornar obrigatório aqui sem
  // também revisar a condicional do template — history: chegaram a ficar
  // obrigatórios numa sessão anterior, sem que este comentário fosse
  // atualizado, o que deixou a validação contradizendo o próprio
  // template que ela alimenta; revertido.
  function validarDadosEntrega(en) {
    var erros = {};
    en = en || {};
    if (!Number.isInteger(Number(en.garantiaDias || 0)) || Number(en.garantiaDias) < 0 || Number(en.garantiaDias) > 36500) erros.garantiaDias = 'Informe um prazo inteiro entre 0 e 36500 dias.';

    var numeroOS = (en.numeroOS || '').trim();
    var nomeRetirou = (en.nomeRetirou || '').trim();
    // marca/modelo/reparoRealizado: sem trim+checagem de obrigatoriedade
    // aqui de propósito — são opcionais, ver comentário acima.

    if (!numeroOS) erros.numeroOS = 'Número da OS é obrigatório.';
    if (!nomeRetirou) erros.nomeRetirou = 'Nome de quem retirou é obrigatório.';
    if (en.valorReparo === null || en.valorReparo === '' ||
        !Number.isFinite(Number(en.valorReparo)) || Number(en.valorReparo) < 0) {
      erros.valorReparo = 'Informe um valor cobrado válido (use 0 para serviço sem custo).';
    }
    if (!(en.formaPagamento || '').trim()) {
      erros.formaPagamento = 'Selecione a forma de pagamento.';
    }

    return Object.keys(erros).length === 0 ? null : erros;
  }

  window.SistemaOSValidacao = {
    PRIORIDADES_OS_VALIDAS: PRIORIDADES_OS_VALIDAS,
    validarCPF: validarCPF,
    validarIMEI: validarIMEI,
    validarDadosOS: validarDadosOS,
    validarDadosCompra: validarDadosCompra,
    validarDadosVenda: validarDadosVenda,
    validarDadosEntrega: validarDadosEntrega
  };
})();

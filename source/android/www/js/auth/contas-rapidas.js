/** Cofre local de contas. Guarda somente sessões cifradas; nunca armazena senhas. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SistemaOSContasRapidas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var BANCO = 'sistema-os-cofre-contas-v1';
  var VERSAO = 1;
  var STORE_CHAVES = 'chaves';
  var STORE_CONTAS = 'contas';
  var CHAVE = 'principal';

  function abrirBanco() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB || !root.crypto || !root.crypto.subtle) {
        reject(new Error('O cofre seguro de contas não está disponível neste aparelho.'));
        return;
      }
      var requisicao = root.indexedDB.open(BANCO, VERSAO);
      requisicao.onupgradeneeded = function () {
        var banco = requisicao.result;
        if (!banco.objectStoreNames.contains(STORE_CHAVES)) banco.createObjectStore(STORE_CHAVES);
        if (!banco.objectStoreNames.contains(STORE_CONTAS)) banco.createObjectStore(STORE_CONTAS, { keyPath: 'id' });
      };
      requisicao.onsuccess = function () { resolve(requisicao.result); };
      requisicao.onerror = function () { reject(requisicao.error || new Error('Falha ao abrir o cofre de contas.')); };
    });
  }

  async function transacao(store, modo, executar) {
    var banco = await abrirBanco();
    return new Promise(function (resolve, reject) {
      var tx = banco.transaction(store, modo);
      var resultado;
      try { resultado = executar(tx.objectStore(store)); } catch (erro) { banco.close(); reject(erro); return; }
      tx.oncomplete = function () { banco.close(); resolve(resultado); };
      tx.onerror = function () { banco.close(); reject(tx.error || new Error('Falha ao acessar o cofre de contas.')); };
      tx.onabort = tx.onerror;
    });
  }

  function requisicao(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Falha no cofre de contas.')); };
    });
  }

  async function obterChave() {
    var banco = await abrirBanco();
    try {
      var existente = await requisicao(banco.transaction(STORE_CHAVES, 'readonly').objectStore(STORE_CHAVES).get(CHAVE));
      if (existente) return existente;
    } finally { banco.close(); }
    var chave = await root.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await transacao(STORE_CHAVES, 'readwrite', function (store) { store.put(chave, CHAVE); });
    return chave;
  }

  function base64(bytes) {
    var texto = '';
    for (var i = 0; i < bytes.length; i += 1) texto += String.fromCharCode(bytes[i]);
    return root.btoa(texto);
  }

  function bytes(valor) {
    var binario = root.atob(String(valor || ''));
    var saida = new Uint8Array(binario.length);
    for (var i = 0; i < binario.length; i += 1) saida[i] = binario.charCodeAt(i);
    return saida;
  }

  async function cifrar(valor) {
    var chave = await obterChave();
    var iv = root.crypto.getRandomValues(new Uint8Array(12));
    var conteudo = new TextEncoder().encode(JSON.stringify(valor));
    var cifrado = await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, chave, conteudo);
    return { iv: base64(iv), dados: base64(new Uint8Array(cifrado)) };
  }

  async function decifrar(registro) {
    var chave = await obterChave();
    var aberto = await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(registro.iv) }, chave, bytes(registro.dados));
    return JSON.parse(new TextDecoder().decode(aberto));
  }

  function identificador(empresa, usuario) {
    return String(empresa || '').trim().toLowerCase() + ':' + String(usuario || '').trim().toLowerCase();
  }

  async function salvar(empresa, usuario, sessao, contexto) {
    if (!sessao || !sessao.access_token || !sessao.refresh_token) return false;
    var permitido = contexto && (contexto.administrador_global === true || contexto.recursos_habilitados && contexto.recursos_habilitados.troca_rapida_contas === true);
    if (!permitido) return false;
    var id = identificador(empresa || contexto.empresa_codigo, usuario);
    if (!id || id === ':') return false;
    var protegido = await cifrar({ access_token: sessao.access_token, refresh_token: sessao.refresh_token });
    await transacao(STORE_CONTAS, 'readwrite', function (store) {
      store.put({
        id: id, empresa: String(empresa || contexto.empresa_codigo || '').trim().toLowerCase(),
        usuario: String(usuario || '').trim().toLowerCase(), nome: String(contexto.perfil_nome || usuario || 'Usuário'),
        empresaNome: String(contexto.empresa_nome || empresa || ''), iv: protegido.iv, dados: protegido.dados,
        atualizadaEm: Date.now()
      });
    });
    return true;
  }

  async function listar() {
    var banco = await abrirBanco();
    try {
      var registros = await requisicao(banco.transaction(STORE_CONTAS, 'readonly').objectStore(STORE_CONTAS).getAll());
      return (registros || []).sort(function (a, b) { return b.atualizadaEm - a.atualizadaEm; }).map(function (item) {
        return { id: item.id, empresa: item.empresa, usuario: item.usuario, nome: item.nome, empresaNome: item.empresaNome, atualizadaEm: item.atualizadaEm };
      });
    } finally { banco.close(); }
  }

  async function remover(id) {
    await transacao(STORE_CONTAS, 'readwrite', function (store) { store.delete(String(id || '')); });
    return true;
  }

  async function trocar(id) {
    var banco = await abrirBanco();
    var registro;
    try { registro = await requisicao(banco.transaction(STORE_CONTAS, 'readonly').objectStore(STORE_CONTAS).get(String(id || ''))); }
    finally { banco.close(); }
    if (!registro) throw new Error('Esta conta não está mais salva neste aparelho.');
    var cliente = root.SupabaseClientApp.obterCliente();
    var anterior = await root.SistemaOSAuthService.obterSessao().catch(function () { return null; });
    try {
      var tokens = await decifrar(registro);
      var resultado = await cliente.auth.setSession(tokens);
      if (resultado.error) throw resultado.error;
      var estado = await root.SistemaOSSessao.validarSessao(resultado.data.session, true);
      if (!estado || !['autenticado', 'offline_com_sessao'].includes(estado.tipo)) {
        throw new Error((estado && estado.mensagem) || 'A sessão desta conta expirou.');
      }
      await salvar(registro.empresa, registro.usuario, resultado.data.session, estado.contexto);
      return estado;
    } catch (erro) {
      if (anterior && anterior.access_token && anterior.refresh_token) {
        await cliente.auth.setSession({ access_token: anterior.access_token, refresh_token: anterior.refresh_token }).catch(function () {});
        await root.SistemaOSSessao.validarSessao(anterior, false).catch(function () {});
      }
      if (/refresh|expired|jwt|session/i.test(String(erro && erro.message || erro))) await remover(id).catch(function () {});
      throw new Error(/refresh|expired|jwt|session/i.test(String(erro && erro.message || erro))
        ? 'A sessão salva expirou. Entre novamente com a senha para adicionar esta conta.'
        : String(erro && erro.message || erro));
    }
  }

  return { salvar: salvar, listar: listar, remover: remover, trocar: trocar, identificador: identificador };
});

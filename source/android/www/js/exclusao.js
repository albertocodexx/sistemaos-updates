/** Política de exclusão compartilhada entre PC e Android. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SistemaOSExclusao = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var politicaCache = null;
  var cacheEm = 0;

  function cliente() {
    if (!root.SupabaseClientApp || !root.SupabaseClientApp.obterCliente) {
      throw new Error('Serviço de segurança indisponível.');
    }
    return root.SupabaseClientApp.obterCliente();
  }

  function mensagem(erro) {
    return String(erro && (erro.message || erro.error_description) || erro || 'Erro desconhecido');
  }

  async function carregarPolitica(forcar) {
    if (!forcar && politicaCache && Date.now() - cacheEm < 15000) return politicaCache;
    var resposta = await cliente().rpc('obter_politica_exclusao');
    if (resposta.error) throw resposta.error;
    politicaCache = resposta.data || null;
    cacheEm = Date.now();
    return politicaCache;
  }

  async function definirMinhaSenha(senha) {
    var resposta = await cliente().rpc('definir_minha_senha_exclusao', {
      p_senha: String(senha || '')
    });
    if (resposta.error) throw resposta.error;
    politicaCache = resposta.data || null;
    cacheEm = Date.now();
    return politicaCache;
  }

  async function configurarPolitica(semSenhaTodos, usuarios) {
    var resposta = await cliente().rpc('configurar_politica_exclusao', {
      p_sem_senha_todos: semSenhaTodos === true,
      p_usuarios_sem_senha: Array.isArray(usuarios) ? usuarios : []
    });
    if (resposta.error) throw resposta.error;
    politicaCache = resposta.data || null;
    cacheEm = Date.now();
    return politicaCache;
  }

  function pedirSenha(rotulo) {
    return new Promise(function (resolve) {
      var anterior = root.document.getElementById('modal-senha-exclusao');
      if (anterior) anterior.remove();
      var fundo = root.document.createElement('div');
      fundo.id = 'modal-senha-exclusao';
      fundo.className = 'modal-senha-exclusao';
      fundo.innerHTML =
        '<div class="modal-senha-exclusao-card" role="dialog" aria-modal="true">' +
          '<div class="modal-senha-exclusao-icone"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></div>' +
          '<h3>Confirmação protegida</h3>' +
          '<p>Digite sua senha de exclusão para ' + String(rotulo || 'continuar') + '.</p>' +
          '<label for="campo-senha-exclusao">Sua senha</label>' +
          '<div class="campo-senha-exclusao-wrap">' +
            '<input id="campo-senha-exclusao" type="password" autocomplete="current-password">' +
            '<button type="button" id="mostrar-senha-exclusao" aria-label="Mostrar senha">Mostrar</button>' +
          '</div>' +
          '<p id="erro-senha-exclusao" class="erro-senha-exclusao" hidden></p>' +
          '<div class="modal-senha-exclusao-acoes">' +
            '<button type="button" id="cancelar-senha-exclusao" class="btn-secundario">Cancelar</button>' +
            '<button type="button" id="confirmar-senha-exclusao" class="btn-primario">Confirmar</button>' +
          '</div>' +
        '</div>';
      root.document.body.appendChild(fundo);
      var campo = fundo.querySelector('#campo-senha-exclusao');
      var finalizar = function (valor) { fundo.remove(); resolve(valor); };
      fundo.querySelector('#cancelar-senha-exclusao').onclick = function () { finalizar(null); };
      fundo.querySelector('#mostrar-senha-exclusao').onclick = function (evento) {
        campo.type = campo.type === 'password' ? 'text' : 'password';
        evento.currentTarget.textContent = campo.type === 'password' ? 'Mostrar' : 'Ocultar';
      };
      fundo.querySelector('#confirmar-senha-exclusao').onclick = function () {
        if (!campo.value) {
          var erro = fundo.querySelector('#erro-senha-exclusao');
          erro.textContent = 'Digite sua senha.';
          erro.hidden = false;
          return;
        }
        finalizar(campo.value);
      };
      campo.addEventListener('keydown', function (evento) {
        if (evento.key === 'Enter') {
          evento.preventDefault();
          fundo.querySelector('#confirmar-senha-exclusao').click();
        }
      });
      setTimeout(function () { campo.focus(); }, 50);
    });
  }

  async function autorizar(rotulo) {
    var politica = await carregarPolitica(true);
    if (politica && politica.sem_senha === true) return true;
    if (!politica || politica.senha_configurada !== true) {
      throw new Error('Defina sua senha de exclusão nas Configurações antes de continuar.');
    }
    var senha = await pedirSenha(rotulo);
    if (senha === null) return false;
    var resposta = await cliente().rpc('validar_minha_senha_exclusao', { p_senha: senha });
    if (resposta.error) throw resposta.error;
    if (resposta.data !== true) throw new Error('Senha de exclusão incorreta.');
    return true;
  }

  async function listarUsuariosEmpresa() {
    var contexto = root.SistemaOSPermissoes && root.SistemaOSPermissoes.obterContexto
      ? root.SistemaOSPermissoes.obterContexto()
      : null;
    var resposta = await cliente().functions.invoke('admin-global', {
      body: { acao: 'listar_usuarios_empresa', dados: { empresaId: contexto && contexto.empresa_id } }
    });
    if (resposta.error) throw resposta.error;
    if (resposta.data && resposta.data.erro) throw new Error(resposta.data.erro);
    return resposta.data && resposta.data.usuarios || [];
  }

  async function renderizarConfiguracao() {
    var bloco = root.document.getElementById('cfg-politica-exclusao');
    if (!bloco) return;
    var status = root.document.getElementById('cfg-status-exclusao');
    try {
      var politica = await carregarPolitica(true);
      var admin = politica && politica.administrador === true;
      bloco.querySelector('#cfg-minha-senha-exclusao').disabled = admin;
      bloco.querySelector('#btn-cfg-salvar-senha-exclusao').disabled = admin;
      bloco.querySelector('#cfg-admin-exclusao').hidden = !admin;
      status.textContent = admin
        ? 'Sua conta é administradora: exclusões não pedem senha.'
        : politica && politica.sem_senha
          ? 'Seu usuário foi liberado: exclusões não pedem senha.'
          : politica && politica.senha_configurada
            ? 'Sua senha está configurada e vale no PC e no celular.'
            : 'Defina uma senha própria antes de excluir.';
      if (!admin) return;
      bloco.querySelector('#cfg-exclusao-sem-senha-todos').checked = politica.sem_senha_todos === true;
      var usuarios = await listarUsuariosEmpresa();
      var liberados = new Set((politica.usuarios_sem_senha || []).map(String));
      var lista = bloco.querySelector('#cfg-usuarios-sem-senha');
      usuarios = usuarios.filter(function (u) {
        return u.ativo !== false && !/administrador|propriet[aá]rio/i.test(String(u.cargo || ''));
      });
      lista.innerHTML = usuarios.length ? usuarios.map(function (u) {
        return '<label class="checkbox-linha"><input type="checkbox" class="cfg-usuario-sem-senha" value="' +
          String(u.id) + '" ' + (liberados.has(String(u.id)) ? 'checked' : '') + '><span>' +
          String(u.nome || u.usuario || 'Usuário') + ' (' + String(u.cargo || 'Sem cargo') + ')</span></label>';
      }).join('') : '<p class="aviso aviso-tecnico">Nenhum usuário comum ativo.</p>';
    } catch (erro) {
      status.textContent = 'Não foi possível carregar a regra: ' + mensagem(erro);
    }
  }

  function registrarConfiguracao() {
    var bloco = root.document.getElementById('cfg-politica-exclusao');
    if (!bloco) return;
    bloco.querySelector('#btn-cfg-salvar-senha-exclusao').addEventListener('click', async function () {
      var campo = bloco.querySelector('#cfg-minha-senha-exclusao');
      try {
        if (String(campo.value || '').length < 6) throw new Error('Use pelo menos 6 caracteres.');
        await definirMinhaSenha(campo.value);
        campo.value = '';
        if (root.SistemaOSToast) root.SistemaOSToast.mostrar('Senha salva no PC e no celular.', 'sucesso');
        await renderizarConfiguracao();
      } catch (erro) {
        if (root.SistemaOSToast) root.SistemaOSToast.mostrar(mensagem(erro), 'erro');
      }
    });
    bloco.querySelector('#btn-cfg-salvar-politica-exclusao').addEventListener('click', async function () {
      try {
        var usuarios = Array.prototype.map.call(
          bloco.querySelectorAll('.cfg-usuario-sem-senha:checked'),
          function (el) { return el.value; }
        );
        await configurarPolitica(
          bloco.querySelector('#cfg-exclusao-sem-senha-todos').checked,
          usuarios
        );
        if (root.SistemaOSToast) root.SistemaOSToast.mostrar('Permissões de exclusão atualizadas.', 'sucesso');
        await renderizarConfiguracao();
      } catch (erro) {
        if (root.SistemaOSToast) root.SistemaOSToast.mostrar(mensagem(erro), 'erro');
      }
    });
    var abrirConfig = root.document.getElementById('btn-ir-config');
    if (abrirConfig) abrirConfig.addEventListener('click', function () {
      setTimeout(renderizarConfiguracao, 0);
    });
  }

  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', registrarConfiguracao);
    } else {
      registrarConfiguracao();
    }
  }

  return {
    carregarPolitica: carregarPolitica,
    definirMinhaSenha: definirMinhaSenha,
    configurarPolitica: configurarPolitica,
    autorizar: autorizar,
    renderizarConfiguracao: renderizarConfiguracao
  };
});

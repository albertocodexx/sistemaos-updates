// src/templates/browser-shim.js
//
// Os arquivos abaixo foram copiados SEM NENHUMA ALTERAÇÃO do sistema de
// PC (Sistema OS v43) — ver os cabeçalhos de cada um (as únicas edições
// pontuais foram os rótulos "VENDEDOR (LOJA)"/"VENDEDOR (CLIENTE)" nos
// templates de venda/compra, pra desambiguar quem assina o quê):
//   - src/templates/os-template.js        (gerarHtmlOS)
//   - src/templates/venda-template.js     (gerarHtmlVenda)
//   - src/templates/compra-template.js    (gerarHtmlCompra)
//   - src/templates/empresa-compositor.js (montarDadosEmpresa)
//   - src/templates/tema-pdf.js           (resolverTemaPdf)
//   - src/termos-predefinidos.js          (TERMOS_OS, TERMOS_VENDA, TERMOS_COMPRA)
//
// Esses arquivos usam `require`/`module.exports` (padrão CommonJS do
// Node/Electron), que não existe nativamente num <script> de navegador.
// Este shim NÃO reescreve a lógica de nenhum deles — só fornece, antes de
// carregá-los, um `module`/`require` mínimos o bastante pra essa cadeia de
// arquivos rodar sem erro dentro do navegador.
//
// Ordem de carregamento obrigatória no HTML (cada arquivo popula
// window.__modules antes do próximo precisar dele):
//   1. browser-shim.js        (este arquivo)
//   2. termos-predefinidos.js
//   3. tema-pdf.js
//   4. empresa-compositor.js
//   5. os-template.js
//   6. venda-template.js
//   7. compra-template.js
//   8. assinatura-injetor.js  (não usa require — pode entrar em qualquer ordem)
//
// venda-template.js e compra-template.js usam exatamente os mesmos caminhos
// de require (./empresa-compositor, ./tema-pdf, ../termos-predefinidos) que
// os-template.js já usa — por isso reaproveitam o ALIAS abaixo sem precisar
// de nenhuma entrada nova.
//
// Se um dia o PC atualizar qualquer um desses arquivos, basta substituir
// o arquivo copiado aqui pelo novo — este shim não precisa mudar, contanto
// que a cadeia de `require` entre eles continue sendo só entre eles mesmos
// (nenhuma dependência de módulo nativo do Node/Electron).

(function () {
  if (typeof window === 'undefined') return;

  window.__modules = window.__modules || {};

  // Mapa "caminho usado no require() original" -> chave interna do módulo.
  // Os 4 arquivos usam caminhos relativos entre si; mapeamos cada um deles
  // pro mesmo nome de arquivo, já que aqui todos vivem lado a lado.
  var ALIAS = {
    './empresa-compositor': 'empresa-compositor',
    './tema-pdf': 'tema-pdf',
    './fonte-termos-pdf': 'fonte-termos-pdf',
    './comprovante-os-template': 'comprovante-os-template',
    '../termos-predefinidos': 'termos-predefinidos',
    './termos-predefinidos': 'termos-predefinidos'
  };

  window.__criarRequire = function (nomeAtual) {
    return function (caminho) {
      var chave = ALIAS[caminho] || caminho;
      if (!window.__modules[chave]) {
        throw new Error(
          'browser-shim: módulo "' + caminho + '" (pedido por "' + nomeAtual +
          '") ainda não foi carregado. Confira a ordem dos <script> no HTML.'
        );
      }
      return window.__modules[chave].exports;
    };
  };

  // `module` global temporário: cada arquivo original, ao rodar, escreve em
  // `module.exports`. Antes de carregar cada arquivo, apontamos `module`
  // para um objeto novo associado ao nome dele; depois que o <script>
  // termina de rodar, guardamos esse objeto em window.__modules.
  window.__prepararModulo = function (nome) {
    window.module = { exports: {} };
    window.exports = window.module.exports;
    window.require = window.__criarRequire(nome);
  };

  window.__finalizarModulo = function (nome) {
    window.__modules[nome] = window.module;
    // Limpa os globais temporários assim que este módulo termina de rodar.
    // Sem isto, window.module/window.exports continuam existindo (com o
    // conteúdo do ÚLTIMO template carregado) para todo <script> carregado
    // depois deste no HTML. Outros wrappers UMD poderiam interpretar a
    // página como Node/CommonJS e sobrescrever o módulo do template.
    // __criarRequire (acima) já lê de window.__modules[chave].exports, nunca
    // de window.module/exports
    // diretamente, então nenhum require() entre os templates depende de
    // window.module/exports sobreviverem depois deste ponto — a limpeza
    // abaixo é segura.
    delete window.module;
    delete window.exports;
    delete window.require;
  };

  // Busca o texto de um arquivo local por XMLHttpRequest (NÃO fetch).
  // Decisão deliberada: fetch() sobre um caminho relativo funciona quando a
  // página é servida por http(s):// (como no teste local, via
  // `python3 -m http.server`), mas falha em cima do esquema file:// — que é
  // como o WebView do Android costuma abrir o index.html de dentro de um
  // APK. XMLHttpRequest sobre file:// tem suporte consolidado nos WebViews
  // baseados em Chromium (é a mesma API que innumeras libs offline-first
  // usam pra ler asset local empacotado), então cobre os dois ambientes:
  // http(s):// no teste local e file:// dentro do APK.
  function buscarTexto(src) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', src, true);
      xhr.onload = function () {
        // Sobre file://, o navegador normalmente reporta status 0 (não 200)
        // em vez do código HTTP — não existe HTTP de verdade nesse esquema.
        // Por isso o sucesso é aceito tanto em 200 quanto em 0, e só body
        // vazio é tratado como falha real (arquivo não encontrado ainda
        // assim retorna string vazia em alguns WebViews, em vez de erro).
        if ((xhr.status === 200 || xhr.status === 0) && xhr.responseText) {
          resolve(xhr.responseText);
        } else {
          reject(new Error(
            'Falha ao buscar ' + src + ' (status ' + xhr.status + '). ' +
            'Confira se o arquivo existe nesse caminho relativo ao index.html.'
          ));
        }
      };
      xhr.onerror = function () {
        reject(new Error('Falha ao buscar ' + src + ' (erro de rede/arquivo).'));
      };
      xhr.send();
    });
  }

  // Carrega e executa, em sequência, cada arquivo original (sem alterar seu
  // conteúdo) dentro do contexto module/require preparado acima. Retorna uma
  // Promise que resolve quando toda a cadeia terminou de carregar.
  window.__carregarModulosOS = function (lista) {
    var i = 0;
    function proximo() {
      if (i >= lista.length) return Promise.resolve();
      var item = lista[i++];
      return buscarTexto(item.src)
        .then(function (codigo) {
          window.__prepararModulo(item.nome);
          // Passamos module/exports/require explicitamente como parâmetros
          // da função — os 4 arquivos originais os usam como variáveis
          // locais (padrão CommonJS), então precisam chegar como argumentos
          // aqui, e não apenas existir em `window`. new Function(...) roda
          // o código dentro do seu PRÓPRIO escopo de função, isolado dos
          // outros 3 arquivos — sem isso, dois arquivos que declarem `const`
          // com o mesmo nome no nível superior colidiriam no mesmo escopo
          // global (foi exatamente esse erro que apareceu ao testar uma
          // versão anterior desta correção via <script src> puro).
          var executar = new Function('module', 'exports', 'require', codigo);
          executar(window.module, window.exports, window.require);
          window.__finalizarModulo(item.nome);
          return proximo();
        });
    }
    return proximo();
  };
})();

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const ler = rel => fs.readFileSync(path.join(raiz, rel), 'utf8');
const html = ler('www/index.html');
const app = ler('www/js/app.js');
const comprovante = ler('www/js/comprovante-os.js');
assert.ok(comprovante.includes('[dados.numeroOSAtribuido, dados.numeroOS, dados.numero]'), 'comprovante deve aceitar o numero oficial atribuido pela sincronizacao');
assert.ok(app.includes('dadosComprovante.numeroOSAtribuido = registro.numeroOSAtribuido'), 'emissao deve recuperar o numero guardado no registro do historico');
const css = ler('www/css/app.css');
const recebidos = ler('www/js/documentos-recebidos.js');
const injetor = ler('www/js/assinatura-injetor.js');

assert.ok(html.includes('id="os-assinar-depois"'), 'Nova OS deve oferecer Assinar depois');
assert.ok(html.includes('id="compra-assinar-depois"'), 'Compra deve oferecer Assinar depois');
assert.ok(html.includes('id="venda-assinar-depois"'), 'Venda deve oferecer Assinar depois');
assert.ok(html.includes('id="entrega-assinar-depois"'), 'Entrega deve oferecer Assinar depois');
for (const tipo of ['os', 'compra', 'venda', 'entrega']) {
  assert.ok(html.includes(`id="${tipo}-nao-assinado"`), `${tipo} deve oferecer Não assinado`);
  assert.ok(app.includes(`naoAssinado: naoAssinadoMarcado('${tipo}')`), `Não assinado deve seguir no objeto de ${tipo}`);
  assert.ok(app.includes(`assinaturaPendente: assinarDepoisMarcado('${tipo}')`), `Assinar depois deve seguir no objeto de ${tipo}`);
}
assert.ok(app.includes('permiteSalvarSemAssinatura'), 'OS pendente deve poder ser salva sem assinatura');
assert.ok(app.includes('permiteExportarSemAssinatura'), 'OS pendente deve poder ser enviada sem assinatura');
assert.ok(app.includes('osAtual.assinaturaPendente = false'), 'captura posterior deve encerrar a pendência');
assert.ok(app.includes('osAtual.naoAssinado = false'), 'uma assinatura real deve remover a marcação Não assinado');
assert.ok(app.includes('idEmEdicaoHistorico = registroHistoricoAtualId'), 'reabertura pendente deve atualizar o registro existente');
assert.ok(app.includes('montarItemAtualPreservandoId'), 'exportação posterior deve preservar o identificador original');
assert.ok(app.includes("documentoAtualTipo === 'entrega'"), 'preview deve distinguir Entrega');
assert.ok(app.includes("btnAssinarAssistencia.hidden = modoHistorico || documentoAtualTipo === 'entrega'"), 'Entrega não pode exibir assinatura da assistência');
assert.ok(recebidos.includes("if (tipo !== 'entrega' && tipo !== 'desbloqueio') respostaAutomatica.assinaturaAssistenciaBase64"), 'Entrega e desbloqueio não podem enviar assinatura da assistência');
assert.ok(recebidos.includes("if (tipo !== 'entrega' && tipo !== 'desbloqueio') {"), 'Resposta manual de Entrega e desbloqueio não pode enviar assinatura da assistência');
assert.ok(css.includes('--cor-fundo: #000000'), 'fundo padrão do APK deve ser preto');
assert.ok(injetor.includes('data-assinatura-estado="1"'), 'PDF móvel deve marcar visualmente documento sem assinatura');
assert.ok(app.includes("'AGUARDANDO ASSINATURA'") && app.includes("'NÃO ASSINADO'"), 'preview móvel deve distinguir pendente e não assinado');

console.log('OK: assinatura posterior cobre OS, Compra, Venda e Entrega; Entrega usa uma assinatura e o fundo é preto.');

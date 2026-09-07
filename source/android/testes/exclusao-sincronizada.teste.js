const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const ler = rel => fs.readFileSync(path.join(raiz, rel), 'utf8');
const app = ler('www/js/app.js');
const cloud = ler('www/js/cloud-data.js');
const sync = ler('www/js/supabase/sync-service.js');
const exclusao = ler('www/js/exclusao.js');
const historico = ler('www/js/historico.js');
const html = ler('www/index.html');
const suporte = ler('www/js/suporte-global.js');

assert.ok(cloud.includes('async function excluirOS'), 'exclusão deve poder resolver a identidade remota');
assert.ok(cloud.includes('await servicoOS.consultarPorNumero(ref.numero)'), 'OS antiga deve ser localizada pelo número');
assert.ok(app.includes('window.CloudData.excluirOS({ numero: numeroAntigo })'), 'histórico antigo deve excluir no Supabase');
assert.ok(cloud.includes('jaAusente: true'), 'ausência remota deve confirmar a exclusão idempotente');
assert.ok(sync.includes("operacao.operacao === 'delete' && tipo === 'nao-encontrada'"), 'retry de exclusão deve aceitar registro já ausente');
assert.ok(app.includes('resultadoAntigo.jaAusente') && app.includes('resultado.jaAusente'), 'histórico deve remover o card que já não existe no servidor');
assert.ok(historico.includes('function excluirRelacionadosOS'), 'exclusão da OS deve limpar documentos locais vinculados');
assert.ok(cloud.includes('limparLocalSeConfirmado'), 'qualquer tela que exclui a OS deve disparar a cascata local');
assert.ok(exclusao.includes("'obter_politica_exclusao'"), 'celular deve obter a política compartilhada');
assert.ok(exclusao.includes("'definir_minha_senha_exclusao'"), 'cada usuário deve definir sua própria senha');
assert.ok(exclusao.includes("'validar_minha_senha_exclusao'"), 'celular deve validar a mesma senha do PC');
assert.ok(exclusao.includes("politica.sem_senha === true"), 'usuário liberado não deve receber pedido de senha');
assert.ok(html.includes('id="cfg-exclusao-sem-senha-todos"'), 'administrador deve poder liberar todos');
assert.ok(html.includes('id="cfg-usuarios-sem-senha"'), 'administrador deve poder liberar usuários específicos');
assert.ok(suporte.includes("SistemaOSExclusao.autorizar('excluir o chamado"), 'exclusão de chamado também deve obedecer à política');

console.log('OK: exclusão remota permanente e senha individual compartilhada entre PC e celular validadas.');

// testes/teste-fotos-entrega-lote-bloco2.js
//
// Bloco 2 — fecha a validação que ficou como suposição não verificada:
// lote do celular com tipoDocumento:'entrega' + dados.fotos deve cair em
// os.fotos com categoria 'entrega' (importarLoteDoCelular ->
// criarOuSubstituirEntrega -> salvarFotosLoteOS -> salvarFotoOS).
//
// Mesmo padrão dos outros testes desta pasta: mocka `electron`, banco em
// dir temporário isolado, roda contra o db.js de verdade.
//
// Rodar: node testes/teste-fotos-entrega-lote-bloco2.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

const tmpDocsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-teste-fotos-entrega-'));
const mockElectronPath = path.join(__dirname, '__mock_electron_fotos_entrega_teste__.js');
fs.writeFileSync(mockElectronPath, `module.exports = { app: { getPath: () => ${JSON.stringify(tmpDocsDir)} } };`);

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return mockElectronPath;
  return originalResolve.call(this, request, ...args);
};

const db = require('../src/db.js');

let total = 0, falhas = 0;
function ok(desc, condicao) {
  total++;
  if (condicao) {
    console.log('OK   - ' + desc);
  } else {
    falhas++;
    console.log('FALHOU - ' + desc);
  }
}

const fotoPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const fotoComIndice = indice => 'data:image/png;base64,' + Buffer.from('imagem-teste-' + indice).toString('base64');

function criarOSTeste(overrides) {
  return db.criarOS(Object.assign({
    cliente: { nome: 'Teste Cliente', telefone: '27999999999' },
    aparelho: { marca: 'Samsung', modelo: 'A54', defeitoRelatado: 'Tela quebrada' }
  }, overrides || {}));
}

try {
  // ── Cenário 1: lote com 1 item 'entrega' + 2 fotos válidas ──────
  const os1 = criarOSTeste();
  const lote1 = {
    tipoArquivo: 'sistema-os-celular-lote',
    itens: [{
      tipoDocumento: 'entrega',
      idExportacao: 'exp-entrega-001',
      dados: {
        numeroOS: os1.numero,
        nomeRetirou: 'Fulano de Tal',
        marca: 'Samsung',
        modelo: 'A54',
        reparoRealizado: 'Troca de tela',
        declaracao: 'Recebi o aparelho.',
        dataHoraAssinatura: new Date().toISOString(),
        garantiaDias: 90,
        assinaturaRetirouBase64: 'data:image/png;base64,FAKESIG==',
        fotos: [
          { base64: fotoComIndice(1) },
          { base64: fotoComIndice(2) }
        ]
      }
    }]
  };

  const resultado1 = db.importarLoteDoCelular(lote1);
  ok('importarLoteDoCelular: sucesso', resultado1.sucesso === true);
  ok('importarLoteDoCelular: contabiliza 1 entrega importada', resultado1.importados.entrega === 1);

  const osAtualizada1 = db.obterOSPorNumero(os1.numero);
  const fotosEntrega1 = (osAtualizada1.fotos || []).filter(f => f.categoria === 'entrega');
  ok('lote entrega: as 2 fotos caem em os.fotos', (osAtualizada1.fotos || []).length === 2);
  ok('lote entrega: ambas com categoria "entrega"', fotosEntrega1.length === 2);
  ok('lote entrega: cada foto tem path gravado em disco',
    fotosEntrega1.every(f => f.path && fs.existsSync(f.path)));
  ok('lote entrega: registro em db.entregas também foi criado',
    db.listarEntregas().some(e => String(e.numeroOS) === String(os1.numero)));

  // ── Cenário 2: sem fotos no payload -> não quebra, os.fotos vazio ──
  const os2 = criarOSTeste({ cliente: { nome: 'Cliente2', telefone: '27988887777' }, aparelho: { marca: 'Apple', modelo: 'iPhone 12', defeitoRelatado: 'Bateria' } });
  const lote2 = {
    tipoArquivo: 'sistema-os-celular-lote',
    itens: [{
      tipoDocumento: 'entrega',
      idExportacao: 'exp-entrega-002',
      dados: {
        numeroOS: os2.numero,
        nomeRetirou: 'Ciclana',
        garantiaDias: 0,
        assinaturaRetirouBase64: 'data:image/png;base64,FAKESIG2=='
        // sem 'fotos'
      }
    }]
  };
  const resultado2 = db.importarLoteDoCelular(lote2);
  ok('lote entrega sem fotos: importa normalmente', resultado2.sucesso === true && resultado2.importados.entrega === 1);
  const osAtualizada2 = db.obterOSPorNumero(os2.numero);
  ok('lote entrega sem fotos: os.fotos permanece vazio (não lança erro)',
    (osAtualizada2.fotos || []).length === 0);

  // ── Cenário 3: foto com base64 inválido é ignorada, resto do lote segue ──
  const os3 = criarOSTeste({ cliente: { nome: 'Cliente3', telefone: '27977776666' }, aparelho: { marca: 'Motorola', modelo: 'Edge 30', defeitoRelatado: 'Não liga' } });
  const lote3 = {
    tipoArquivo: 'sistema-os-celular-lote',
    itens: [{
      tipoDocumento: 'entrega',
      idExportacao: 'exp-entrega-003',
      dados: {
        numeroOS: os3.numero,
        nomeRetirou: 'Beltrano',
        garantiaDias: 0,
        assinaturaRetirouBase64: 'data:image/png;base64,FAKESIG3==',
        fotos: [
          { base64: 'lixo-invalido-nao-e-base64-de-imagem' },
          { base64: fotoPngBase64 }
        ]
      }
    }]
  };
  const resultado3 = db.importarLoteDoCelular(lote3);
  ok('lote entrega com foto inválida: item de entrega ainda importa com sucesso',
    resultado3.sucesso === true && resultado3.importados.entrega === 1);
  const osAtualizada3 = db.obterOSPorNumero(os3.numero);
  ok('lote entrega com foto inválida: só a foto válida foi salva (inválida ignorada silenciosamente)',
    (osAtualizada3.fotos || []).length === 1 && osAtualizada3.fotos[0].categoria === 'entrega');

  // ── Cenário 4: 11 fotos no payload -> só 10 são salvas (limite) ──
  const os4 = criarOSTeste({ cliente: { nome: 'Cliente4', telefone: '27966665555' }, aparelho: { marca: 'Xiaomi', modelo: 'Redmi Note 12', defeitoRelatado: 'Câmera' } });
  const lote4 = {
    tipoArquivo: 'sistema-os-celular-lote',
    itens: [{
      tipoDocumento: 'entrega',
      idExportacao: 'exp-entrega-004',
      dados: {
        numeroOS: os4.numero,
        nomeRetirou: 'Sete Fotos',
        garantiaDias: 0,
        assinaturaRetirouBase64: 'data:image/png;base64,FAKESIG4==',
        fotos: Array.from({ length: 11 }, (_, indice) => ({ base64: fotoComIndice(100 + indice) }))
      }
    }]
  };
  const resultado4 = db.importarLoteDoCelular(lote4);
  ok('lote entrega com 11 fotos: importa com sucesso', resultado4.sucesso === true);
  const osAtualizada4 = db.obterOSPorNumero(os4.numero);
  ok('lote entrega com 11 fotos: limite de 10 respeitado (defesa em profundidade)',
    (osAtualizada4.fotos || []).length === 10);

  // ── Cenário 5: OS não encontrada -> rejeitado, sem tocar em fotos ──
  const lote5 = {
    tipoArquivo: 'sistema-os-celular-lote',
    itens: [{
      tipoDocumento: 'entrega',
      idExportacao: 'exp-entrega-005',
      dados: {
        numeroOS: 'OS-INEXISTENTE-999',
        nomeRetirou: 'Ninguem',
        garantiaDias: 0,
        assinaturaRetirouBase64: 'x',
        fotos: [{ base64: fotoPngBase64 }]
      }
    }]
  };
  const resultado5 = db.importarLoteDoCelular(lote5);
  ok('lote entrega com OS inexistente: rejeitado (não importa, não lança)',
    resultado5.sucesso === true && resultado5.rejeitados.length === 1 && resultado5.importados.entrega === 0);

  // Cenário 6: a mesma imagem recebida no lote e depois no Storage não duplica.
  const fotoDuplicada = fotoComIndice(1);
  const bufferDuplicado = Buffer.from(fotoDuplicada.replace(/^data:[^;]+;base64,/, ''), 'base64');
  const resultadoDuplicado = db.aplicarArquivoSupabaseOS(os1.numero, {
    id: 'arquivo-foto-duplicada', categoria: 'foto_entrega', mime_type: 'image/png', nome_arquivo: 'entrega.png'
  }, bufferDuplicado);
  ok('foto recebida por dois caminhos é detectada pelo conteúdo', resultadoDuplicado.duplicada === true);
  ok('foto recebida por dois caminhos não aumenta a galeria',
    (db.obterOSPorNumero(os1.numero).fotos || []).filter(f => f.categoria === 'entrega').length === 2);

} catch (err) {
  console.error('ERRO INESPERADO:', err);
  falhas++;
  total++;
} finally {
  try { fs.unlinkSync(mockElectronPath); } catch (e) { /* ignora */ }
  try { fs.rmSync(tmpDocsDir, { recursive: true, force: true }); } catch (e) { /* ignora */ }
}

console.log(`\n${total} teste(s), ${falhas} falha(s).`);
process.exit(falhas > 0 ? 1 : 0);

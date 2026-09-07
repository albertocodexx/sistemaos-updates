// Detecta duas chamadas literais ipcMain.handle() para o mesmo canal no main.
// A verificação é propositalmente simples nesta fase e vira uma proteção antes
// de os handlers serem migrados para src/ipc/ na Parte 7.
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');

function listarArquivosJavaScript(diretorio) {
  if (!fs.existsSync(diretorio)) return [];
  return fs.readdirSync(diretorio, { withFileTypes: true }).flatMap(item => {
    const caminho = path.join(diretorio, item.name);
    if (item.isDirectory()) return listarArquivosJavaScript(caminho);
    return item.isFile() && item.name.endsWith('.js') ? [caminho] : [];
  });
}

const arquivos = [path.join(raiz, 'main.js'), ...listarArquivosJavaScript(path.join(raiz, 'src', 'ipc'))];
const exp = /ipcMain\.handle\s*\(\s*['"]([^'"]+)['"]/g;
const contagem = new Map();

for (const arquivo of arquivos) {
  const fonte = fs.readFileSync(arquivo, 'utf8');
  let achado;
  exp.lastIndex = 0;
  while ((achado = exp.exec(fonte))) {
    const canal = achado[1];
    contagem.set(canal, (contagem.get(canal) || 0) + 1);
  }
}

const duplicados = [...contagem.entries()].filter(([, quantidade]) => quantidade > 1);
if (!contagem.size) {
  console.error('FALHOU - nenhum ipcMain.handle literal foi encontrado em main.js');
  process.exit(1);
}
if (duplicados.length) {
  console.error('FALHOU - canais IPC duplicados:');
  duplicados.forEach(([canal, quantidade]) => console.error(`- ${canal}: ${quantidade} registros`));
  process.exit(1);
}

console.log(`OK  - ${contagem.size} canais IPC literais encontrados em ${arquivos.length} arquivo(s), sem duplicidade.`);

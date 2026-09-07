// Teste de fumaça da entrada do Electron.
// Não abre uma janela e não executa o aplicativo: valida somente os arquivos
// e marcadores mínimos necessários para a inicialização continuar possível.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const raiz = path.resolve(__dirname, '..', '..');
let falhas = 0;

function verificar(condicao, mensagem) {
  if (condicao) console.log('OK  - ' + mensagem);
  else { falhas += 1; console.error('FALHOU - ' + mensagem); }
}

const pacote = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
verificar(pacote.main === 'main.js', 'package.json aponta para main.js');

const entradas = ['main.js', 'preload.js', path.join('renderer', 'index.html'), path.join('renderer', 'renderer.js')];
entradas.forEach((arquivo) => verificar(fs.existsSync(path.join(raiz, arquivo)), `entrada existe: ${arquivo}`));

const main = fs.readFileSync(path.join(raiz, 'main.js'), 'utf8');
const boot = fs.readFileSync(path.join(raiz, 'renderer', 'boot.html'), 'utf8');
for (const [, src] of boot.matchAll(/<img[^>]+src="([^"]+)"/g)) {
  verificar(fs.existsSync(path.resolve(raiz, 'renderer', src)), 'imagem da abertura existe: ' + src);
}
const runtime = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const estilo = fs.readFileSync(path.join(raiz, 'renderer', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const preloadApi = fs.readFileSync(path.join(raiz, 'src', 'preload', 'api.js'), 'utf8');
verificar(main.includes('app.whenReady'), 'main mantém o ciclo de vida do Electron');
verificar(main.includes('BrowserWindow'), 'main cria a janela principal');
verificar(main.includes('criarJanelaPrincipal();') && main.includes('void iniciarServicosEmSegundoPlano();'), 'janela abre antes dos serviços de nuvem e integrações');
verificar(main.includes('function iniciarServicosEmSegundoPlano()') && !main.includes('await supabaseDesktop.inicializar({\n      db, safeStorage'), 'restauração da nuvem não bloqueia a criação da janela');
verificar(main.includes('preload.js'), 'janela aponta para o preload');
verificar(main.includes('app.setAppUserModelId(ID_APLICATIVO_WINDOWS)'), 'Windows associa a janela ao ícone do Sistema OS');
verificar(main.includes('icon: CAMINHO_ICONE_APP'), 'janela principal declara a logo do aplicativo');
verificar(fs.existsSync(path.join(raiz, 'assets', 'app-icon.ico')), 'ícone de execução do aplicativo entra no pacote instalado');
verificar(runtime.includes('TEMPO_LIMITE_LOGIN') && runtime.includes('aguardarLoginComLimite'), 'login nunca fica aguardando o servidor indefinidamente');
verificar(runtime.includes('supabaseaguardarinicializacao') && preloadApi.includes('supabase:aguardarInicializacao'), 'login aguarda a inicialização segura sem exibir dados de sessão antiga');
verificar(estilo.includes('.login-caixa::-webkit-scrollbar') && estilo.includes('overflow-wrap: anywhere'), 'cartao de login exibe erros completos sem recorte');
verificar(main.includes('new Tray(') && main.includes('Sair completamente'), 'modo em segundo plano possui bandeja e saída explícita');
verificar(main.includes('CAMINHO_ICONE_BANDEJA') && main.includes("resize({ width: 20, height: 20"), 'ícone da bandeja usa PNG visível e tamanho adequado no Windows');
verificar(fs.existsSync(path.join(raiz, 'assets', 'tray-icon.png')) && main.includes("'assets', 'tray-icon.png'"), 'ícone da bandeja existe em uma pasta incluída no instalador');
verificar(main.includes('nativeImage.createFromPath(process.execPath)') && main.includes('if (imagemBase.isEmpty())'), 'bandeja não cria silenciosamente um ícone vazio');
verificar(main.includes("janelaPrincipal.on('close'") && main.includes('evento.preventDefault()'), 'fechar a janela mantém o atendimento ativo');
verificar(!main.includes('displayBalloon('), 'fechar a janela vai direto para os itens ocultos sem exibir mensagem');
verificar(main.includes('setLoginItemSettings') && main.includes("args: ['--background']"), 'atendimento pode iniciar com o Windows em segundo plano');
verificar(main.includes('openAtLogin: abrirComWindows === true') && !main.includes('openAtLogin: true'), 'inicialização com o Windows respeita a escolha local e não é reativada à força');
verificar(main.includes('name: ID_APLICATIVO_WINDOWS') && main.includes('enabled: abrirComWindows === true'), 'Windows altera a entrada exata do Sistema OS no Gerenciador de Inicialização');
verificar(main.includes("'preferencias-locais.json'") && main.includes('config:salvarPreferenciasLocais'), 'preferências exclusivas do computador são persistidas e expostas por IPC');
verificar(html.includes('id="abrirComWindowsConfig"') && html.includes('id="modoEconomicoSegundoPlanoConfig"'), 'Configurações oferece controles de inicialização e economia em segundo plano');
verificar(preloadApi.includes('configpreferenciaslocais') && preloadApi.includes('configsalvarpreferenciaslocais'), 'preload expõe somente os métodos permitidos das preferências locais');
verificar(main.includes('setBackgroundThrottling') && main.includes('inicioSomenteEmSegundoPlano'), 'modo oculto reduz renderização e adia a janela no início automático');
verificar(runtime.includes('onModoSegundoPlano') && estilo.includes('html.modo-segundo-plano'), 'renderer pausa animações quando está oculto');

['main.js', 'preload.js', path.join('renderer', 'renderer.js'), path.join('renderer', 'core', 'legacy-runtime.js'), path.join('src', 'backup.js'), path.join('src', 'whatsapp.js'), path.join('src', 'ipc', 'register-all.js'), path.join('src', 'ipc', 'licenca-handlers.js'), path.join('src', 'ipc', 'register-legacy.js'), path.join('src', 'db.js'), path.join('src', 'database', 'domain.js'), path.join('src', 'repositories', 'clientes-repository.js'), path.join('src', 'preload', 'os-api.js'), path.join('src', 'preload', 'api.js')].forEach((arquivo) => {
  const resultado = spawnSync(process.execPath, ['--check', path.join(raiz, arquivo)], { encoding: 'utf8' });
  verificar(resultado.status === 0, `sintaxe válida: ${arquivo}`);
  if (resultado.status !== 0 && resultado.stderr) console.error(resultado.stderr.trim());
});

if (falhas) process.exit(1);
console.log('\nTeste de inicialização estática aprovado.');

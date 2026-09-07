# Empacotando como APK com Capacitor — passo a passo

Testei cada comando abaixo de verdade (não é um roteiro de memória) contra
o projeto `celular-os-final-corrigido.zip`, com os dois bugs já corrigidos
(CSS da tela de assinatura e carregamento dos módulos via XMLHttpRequest).
Uma primeira versão deste guia tinha um erro — `webDir: '.'` — corrigido
abaixo: o Capacitor recusa a raiz do projeto como pasta web, então os
arquivos do app precisam morar numa subpasta (aqui chamada `www/`).

## Pré-requisitos (rodar no SEU computador, não aqui)

```bash
node --version   # precisa ser 18 ou mais recente
npm --version
```

Se não tiver Node, baixe em https://nodejs.org (versão LTS).

Você também vai precisar do **Android Studio** instalado — ele traz o SDK
do Android e as ferramentas de build. Baixe em
https://developer.android.com/studio. Na primeira abertura, deixe ele
baixar o "Android SDK" padrão que ele sugerir.

## Passo 1 — Extrair o projeto

```bash
unzip celular-os-final-corrigido.zip
cd celular-os-final
```

## Passo 2 — Colocar os arquivos web dentro de uma subpasta `www/`

O Capacitor exige que os arquivos do app (`index.html` e tudo que ele usa)
fiquem numa subpasta, separados do `package.json`/config do Capacitor —
não podem ficar direto na raiz. Dentro de `celular-os-final/`:

```bash
mkdir www
mv index.html css js src README.md www/
```

Depois deste passo, a pasta deve ficar assim:

```
celular-os-final/
└── www/
    ├── index.html
    ├── README.md
    ├── css/app.css
    ├── js/
    └── src/
```

Não é preciso editar nada dentro de `index.html`, `css/` ou `js/` — todos
os caminhos ali já são relativos (`css/app.css`, `js/app.js`,
`src/templates/...`), então continuam funcionando iguais depois da mudança
de pasta.

## Passo 3 — Iniciar um projeto Node

```bash
npm init -y
```

Cria um `package.json` na raiz de `celular-os-final/` (fora de `www/`).

## Passo 4 — Instalar o Capacitor

```bash
npm install @capacitor/core @capacitor/android @capacitor/app @capacitor/filesystem @capacitor/share @capacitor/camera
npm install -D @capacitor/cli
```

`@capacitor/app` é o que expõe o botão físico de voltar do Android para
dentro do WebView (evento `backButton`) — sem ele, `js/navegacao-voltar.js`
não tem como interceptar o botão, e o Android volta a fechar o app direto
em qualquer tela, que era o comportamento antigo (bug já corrigido no
código, mas que depende deste plugin para funcionar no APK real).

`@capacitor/filesystem` e `@capacitor/share` são os dois plugins que
fazem o menu de compartilhar (WhatsApp, Mensagens, E-mail etc.) abrir de
verdade ao exportar um documento — sem eles, o app cai sempre no download
direto, porque a API padrão do navegador (`navigator.share`) não tem
suporte confiável a compartilhar *arquivo* dentro do WebView que empacota
o APK. Ver `js/compartilhar-arquivo.js` para o código que os usa.

`@capacitor/camera` é o que faz o botão "Adicionar foto" (Nova OS e
Entregas) abrir o menu nativo "Câmera / Galeria / Cancelar" de verdade —
sem ele, o app cai no fallback de `<input type="file">`, que em muitos
Android abre direto a galeria/arquivos, sem oferecer a câmera como opção
clara. Ver `js/fotos.js` para o código que o usa.

### Permissões de câmera no Android (AndroidManifest.xml)

O plugin `@capacitor/camera` já registra as permissões necessárias no
Android automaticamente ao rodar `npx cap sync android` (Passo 6/"Sempre
que editar o código depois", abaixo) — não é preciso editar
`AndroidManifest.xml` manualmente. Se, mesmo assim, o app pedir permissão
de câmera e o Android negar sem mostrar o diálogo (comum em builds já
instaladas antes de adicionar o plugin), desinstale o app do celular
antes de instalar o novo `.apk` — o Android às vezes não atualiza a lista
de permissões de um app já instalado, só na reinstalação.

**Se você já tinha um projeto Android gerado antes** (pasta `android/`
já existe) e está só adicionando esses dois plugins novos a ele, pule
os Passos 5 e 6 (não rode `cap init`/`cap add android` de novo — isso
recriaria a pasta do zero e apagaria qualquer coisa que você tenha
configurado manualmente nela) e vá direto para:

```bash
npx cap sync android
```

Diferente de projetos web puros, `sync` (não só `copy`) é o comando certo
aqui — ele copia os arquivos de `www/` **e** registra o plugin nativo
novo no projeto Android (`android/app/src/main/...`), o que `cap copy`
sozinho não faz. Depois disso, vá direto ao Passo 7 para gerar o novo
APK — sem gerar de novo, o celular continua rodando a versão antiga, sem
os plugins.

## Passo 5 — Inicializar o Capacitor

**Pule este passo se você já tem um `capacitor.config.ts` (projeto já
inicializado antes) — rodar de novo pode sobrescrever configurações que
você já tenha ajustado.**

```bash
npx cap init "Sistema OS" "com.assistencia.sistemaos" --web-dir=www
```

- `"Sistema OS"` — nome do app, aparece embaixo do ícone no celular. Troque
  se quiser outro nome.
- `"com.suaempresa.sistemaos"` — Package ID, identifica o app de forma
  única no Android (formato `com.dominio.nomeapp`, sem espaços/acentos).
  **Troque `suaempresa` por algo seu** antes de instalar de verdade — não
  precisa ser um domínio real, só precisa ser único o bastante pra não
  colidir com outro app no mesmo celular. Depois de publicado/instalado,
  evite mudar esse valor — o Android trata um Package ID diferente como
  um app "diferente" (não atualiza o antigo, instala um segundo).
- `--web-dir=www` — aponta pra pasta que você criou no Passo 2.

Isso gera `capacitor.config.ts` na raiz.

## Passo 6 — Adicionar a plataforma Android

**Pule este passo se a pasta `android/` já existe** (mesmo motivo do
Passo 5 — recriaria do zero).

```bash
npx cap add android
```

Cria a pasta `android/` — um projeto Android nativo completo, gerado
automaticamente, que carrega o conteúdo de `www/` dentro de um WebView
configurado pelo Capacitor.

## Passo 7 — Abrir no Android Studio e gerar o APK

```bash
npx cap open android
```

Isso abre o Android Studio com o projeto carregado. Dentro dele:

1. Espere a barra de progresso embaixo terminar de sincronizar o Gradle
   (pode demorar alguns minutos na primeira vez).
2. Menu superior: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
3. Ao terminar, aparece uma notificação no canto inferior direito —
   **"APK(s) generated successfully"** com um link **"locate"**.
4. O arquivo fica em:
   `android/app/build/outputs/apk/debug/app-debug.apk`

Esse `.apk` já é instalável em qualquer Android (ative "Instalar de fontes
desconhecidas" nas configurações do celular, ou transfira e abra o
arquivo direto).

### Alternativa por linha de comando (sem abrir a interface do Android Studio)

Se preferir gerar o APK direto pelo terminal, sem abrir a janela do
Android Studio (ele só precisa estar instalado, pelo SDK):

```bash
cd android
./gradlew assembleDebug
```

O APK sai no mesmo caminho: `android/app/build/outputs/apk/debug/app-debug.apk`.

## Testando num celular conectado (mais rápido que gerar .apk toda vez)

Com o celular conectado por cabo USB e "Depuração USB" ativada (Configurações
→ Sobre o telefone → toque 7x em "Número da versão" pra liberar Opções de
Desenvolvedor → ativar Depuração USB):

```bash
npx cap run android
```

Isso instala e abre o app direto no celular conectado, sem precisar gerar
e transferir o `.apk` manualmente — útil pra testar rapidamente cada ajuste.

## Sempre que editar o código depois

Depois de qualquer mudança dentro de `www/` (index.html, css, js, src):

```bash
npx cap sync android
npx cap open android
# depois, no Android Studio: Build → Build APK(s)
```

`npx cap sync android` copia o conteúdo atualizado de `www/` para dentro
do projeto Android — sem rodar isso, o Android Studio builda com os
arquivos antigos.

## Por que isso resolve os bugs anteriores

- O Capacitor serve os arquivos web através de um esquema local
  (`https://localhost` dentro do WebView), não `file://` puro — é
  justamente o ambiente em que o `XMLHttpRequest` do `browser-shim.js`
  (já corrigido) funciona de forma consistente, então os 4 módulos do
  template devem carregar normalmente.
- `navigator.share`, usado no botão "Exportar para o PC", tende a se
  comportar melhor sob Capacitor do que num WebView cru, porque o
  Capacitor integra corretamente com os Intents do Android — mesmo assim,
  vale testar esse botão especificamente no celular real depois de
  instalado.
- O botão físico de voltar do Android agora navega uma tela para trás
  dentro do app (fecha a tela de assinatura, volta do preview pro
  formulário ou pro histórico, etc.) em vez de fechar o app direto — isso
  só funciona porque `@capacitor/app` foi adicionado no Passo 4 e
  `js/navegacao-voltar.js` escuta o evento `backButton` dele. Sem esse
  plugin instalado, o app volta a se comportar como antes (botão físico
  sempre fecha o app).

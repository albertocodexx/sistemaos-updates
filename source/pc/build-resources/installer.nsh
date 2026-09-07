; ============================================================
;  installer.nsh — Customizações NSIS para Sistema OS v26.6.1
;  Inserido automaticamente pelo electron-builder via
;  build.nsis.include = "build-resources/installer.nsh"
; ============================================================

; ────────────────────────────────────────────────────────────
; CONSTANTES INTERNAS
; ────────────────────────────────────────────────────────────
!ifndef APP_INTERNAL_NAME
  !define APP_INTERNAL_NAME  "sistema-os-at"
!endif
!ifndef APP_PRODUCT_NAME
  !define APP_PRODUCT_NAME   "Sistema OS"
!endif
!ifndef APP_DOCS_DIR
  !define APP_DOCS_DIR       "$DOCUMENTS\Sistema OS"
!endif
!ifndef APP_ELECTRON_DIR
  !define APP_ELECTRON_DIR   "$APPDATA\${APP_INTERNAL_NAME}"
!endif

; ────────────────────────────────────────────────────────────
; customHeader — Roda antes de qualquer include MUI2
;   Define visuais, fontes e ícones do wizard
;   ATENÇÃO: o electron-builder chama este macro duas vezes
;   (installer e uninstaller), por isso TODOS os !define
;   precisam ser protegidos com !ifndef / !endif para evitar
;   o erro "already defined" do NSIS.
; ────────────────────────────────────────────────────────────
!macro customHeader

  ; ── Aparência ──────────────────────────────────────────────
  !ifndef MUI_BGCOLOR
    !define MUI_BGCOLOR                 "FFFFFF"
  !endif
  !ifndef MUI_TEXTCOLOR
    !define MUI_TEXTCOLOR               "162850"
  !endif

  ; Painel lateral (Welcome / Finish) — 164×314 px BMP
  !ifndef MUI_WELCOMEFINISHPAGE_BITMAP
    !define MUI_WELCOMEFINISHPAGE_BITMAP   "${BUILD_RESOURCES_DIR}\welcome.bmp"
  !endif
  !ifndef MUI_UNWELCOMEFINISHPAGE_BITMAP
    !define MUI_UNWELCOMEFINISHPAGE_BITMAP "${BUILD_RESOURCES_DIR}\welcome.bmp"
  !endif

  ; Cabeçalho das páginas internas — 150×57 px BMP
  !ifndef MUI_HEADERIMAGE
    !define MUI_HEADERIMAGE
  !endif
  !ifndef MUI_HEADERIMAGE_RIGHT
    !define MUI_HEADERIMAGE_RIGHT
  !endif
  !ifndef MUI_HEADERIMAGE_BITMAP
    !define MUI_HEADERIMAGE_BITMAP         "${BUILD_RESOURCES_DIR}\header.bmp"
  !endif
  !ifndef MUI_HEADERIMAGE_UNBITMAP
    !define MUI_HEADERIMAGE_UNBITMAP       "${BUILD_RESOURCES_DIR}\header.bmp"
  !endif

  ; Ícone na barra de título — electron-builder já passa MUI_ICON e MUI_UNICON
  ; via command line, não redefinir aqui para evitar conflito.

  ; ── Textos da página de boas-vindas ────────────────────────
  !ifndef MUI_WELCOMEPAGE_TITLE
    !define MUI_WELCOMEPAGE_TITLE         "Bem-vindo ao Sistema OS v26.6.1"
  !endif
  !ifndef MUI_WELCOMEPAGE_TEXT
    !define MUI_WELCOMEPAGE_TEXT          "Este assistente irá guiá-lo na instalação do$\r$\n\
${APP_PRODUCT_NAME} — Sistema de Ordens de Serviço$\r$\n\
para Assistências Técnicas.$\r$\n$\r$\n\
Antes de continuar, recomendamos fechar todos$\r$\n\
os outros aplicativos abertos.$\r$\n$\r$\n\
Clique em Avançar para continuar."
  !endif

  ; ── Textos da página final ──────────────────────────────────
  !ifndef MUI_FINISHPAGE_TITLE
    !define MUI_FINISHPAGE_TITLE          "Instalação concluída!"
  !endif
  !ifndef MUI_FINISHPAGE_TEXT
    !define MUI_FINISHPAGE_TEXT           "O ${APP_PRODUCT_NAME} foi instalado com sucesso.$\r$\n$\r$\n\
Clique em Concluir para sair do assistente.$\r$\n\
Para abrir o sistema, use o atalho na Área de Trabalho."
  !endif
  !ifndef MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN            "$INSTDIR\${APP_PRODUCT_NAME}.exe"
  !endif
  !ifndef MUI_FINISHPAGE_RUN_TEXT
    !define MUI_FINISHPAGE_RUN_TEXT       "Iniciar o Sistema OS agora"
  !endif
  !ifndef MUI_FINISHPAGE_SHOWREADME
    !define MUI_FINISHPAGE_SHOWREADME     ""
  !endif
  !ifndef MUI_FINISHPAGE_LINK
    !define MUI_FINISHPAGE_LINK           "Precisa de ajuda? Acesse o suporte"
  !endif
  !ifndef MUI_FINISHPAGE_LINK_LOCATION
    !define MUI_FINISHPAGE_LINK_LOCATION  "https://suaempresa.com.br/suporte"
  !endif

  ; ── Página de desinstalação ─────────────────────────────────
  !ifndef MUI_UNWELCOMEPAGE_TITLE
    !define MUI_UNWELCOMEPAGE_TITLE       "Desinstalação — Sistema OS"
  !endif
  !ifndef MUI_UNWELCOMEPAGE_TEXT
    !define MUI_UNWELCOMEPAGE_TEXT        "Este assistente irá remover o ${APP_PRODUCT_NAME}$\r$\n\
do seu computador.$\r$\n$\r$\n\
Você poderá escolher se deseja manter ou excluir$\r$\n\
seus dados (banco de dados, PDFs e backups).$\r$\n$\r$\n\
Clique em Avançar para continuar."
  !endif
  !ifndef MUI_UNFINISHPAGE_TITLE
    !define MUI_UNFINISHPAGE_TITLE        "Remoção concluída"
  !endif
  !ifndef MUI_UNFINISHPAGE_TEXT
    !define MUI_UNFINISHPAGE_TEXT         "O ${APP_PRODUCT_NAME} foi removido do seu computador.$\r$\n$\r$\n\
Obrigado por ter usado o sistema!"
  !endif

  ; ── Configurações do Abort ───────────────────────────────────
  !ifndef MUI_ABORTWARNING
    !define MUI_ABORTWARNING
  !endif
  !ifndef MUI_ABORTWARNING_TEXT
    !define MUI_ABORTWARNING_TEXT         "Tem certeza que deseja cancelar a instalação do ${APP_PRODUCT_NAME}?"
  !endif
  !ifndef MUI_UNABORTWARNING
    !define MUI_UNABORTWARNING
  !endif
  !ifndef MUI_UNABORTWARNING_TEXT
    !define MUI_UNABORTWARNING_TEXT       "Tem certeza que deseja cancelar a remoção do ${APP_PRODUCT_NAME}?"
  !endif

!macroend

; ────────────────────────────────────────────────────────────
; customInstall — Roda APÓS copiar os arquivos do programa
;   Adiciona registros extras e personaliza atalhos
; ────────────────────────────────────────────────────────────
!macro customInstall

  ; Registrar data de instalação
  ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
  WriteRegStr HKCU "Software\${APP_INTERNAL_NAME}" \
              "InstallDate"    "$2/$1/$0"
  WriteRegStr HKCU "Software\${APP_INTERNAL_NAME}" \
              "InstallVersion" "${VERSION}"
  WriteRegStr HKCU "Software\${APP_INTERNAL_NAME}" \
              "InstallDir"     "$INSTDIR"

  ; Exibir balão informativo ao terminar (WinVista+)
  ; (silencioso — não bloqueia a instalação)

!macroend

; ────────────────────────────────────────────────────────────
; customUnInstall — Roda dentro da seção Uninstall
;   Limpa TUDO: cache Electron, sessão WhatsApp,
;   registros, e oferece remover dados do usuário.
; ────────────────────────────────────────────────────────────
!macro customUnInstall

  ; O electron-builder executa o desinstalador antigo durante toda
  ; atualizacao. Nesse fluxo ele passa --updated: nenhum cache, sessao,
  ; banco, PDF ou backup pode ser removido e nenhuma pergunta deve aparecer.
  ${If} ${isUpdated}
    DetailPrint "Atualizacao detectada: mantendo integralmente os dados do Sistema OS."
    Goto sistema_os_fim_desinstalacao_personalizada
  ${EndIf}

  ; ── Cabeçalho da mensagem ───────────────────────────────────
  DetailPrint "Removendo arquivos do sistema..."

  ; ── 1. Cache e dados internos do Electron ───────────────────
  ;  (%APPDATA%\sistema-os-at\)
  ;  Inclui: Cache, Code Cache, GPUCache, Session Storage,
  ;          IndexedDB, Local Storage, Preferences, baileys-session
  DetailPrint "Limpando cache do sistema..."
  RMDir /r "${APP_ELECTRON_DIR}"

  ; ── 2. Arquivos temporários do sistema ──────────────────────
  DetailPrint "Removendo arquivos temporários..."
  Delete "$TEMP\${APP_INTERNAL_NAME}-*.tmp"
  Delete "$TEMP\electron-*.tmp"

  ; ── 3. Entradas extras de registro ──────────────────────────
  DetailPrint "Removendo entradas do registro..."
  DeleteRegKey HKCU "Software\${APP_INTERNAL_NAME}"
  ; Protocolo personalizado (caso tenha sido registrado)
  DeleteRegKey HKCU "Software\Classes\sistema-os"

  ; ── 4. Atalhos que possam ter ficado para trás ──────────────
  Delete "$DESKTOP\${APP_PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_PRODUCT_NAME}\${APP_PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_PRODUCT_NAME}\Desinstalar ${APP_PRODUCT_NAME}.lnk"
  RMDir  "$SMPROGRAMS\${APP_PRODUCT_NAME}"
  Delete "$QUICKLAUNCH\${APP_PRODUCT_NAME}.lnk"

  ; ── 5. PERGUNTA: remover dados do usuário? ──────────────────
  ;  (banco de dados, PDFs, backups, uploads — em Documentos)
  ;  Perguntamos APENAS se a pasta existir.
  IfFileExists "${APP_DOCS_DIR}\*.*" perguntar_dados pular_dados

  perguntar_dados:
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
      "Seus dados do ${APP_PRODUCT_NAME} foram encontrados em:$\r$\n$\r$\n\
${APP_DOCS_DIR}$\r$\n$\r$\n\
Esta pasta contém:$\r$\n\
  • Banco de dados (database.json)$\r$\n\
  • PDFs de Ordens de Serviço$\r$\n\
  • Fotos e anexos das OS$\r$\n$\r$\n\
Deseja EXCLUIR esses arquivos? (PDFs, fotos e banco de dados)$\r$\n$\r$\n\
ATENÇÃO: Os backups em BACKUP - OS NUNCA serão removidos$\r$\n\
e serão restaurados automaticamente na próxima instalação.$\r$\n$\r$\n\
(Clique NÃO para manter todos os dados no computador)" \
      IDYES remover_dados IDNO pular_dados

  remover_dados:
    DetailPrint "Removendo dados do usuário (backups SEMPRE PRESERVADOS)..."

    ; ── Remove o banco de dados principal ────────────────────────
    Delete "${APP_DOCS_DIR}\database.json"

    ; ── Remove PDFs de Ordens de Serviço ─────────────────────────
    RMDir /r "${APP_DOCS_DIR}\PDFs"
    RMDir /r "${APP_DOCS_DIR}\PDFs - Vendas"
    RMDir /r "${APP_DOCS_DIR}\PDFs - Compras"

    ; ── NUNCA remove backups — nem individuais nem automáticos ────
    ; A pasta "BACKUP - OS" e TODO seu conteúdo (subpasta "auto"
    ; incluída) é SEMPRE preservada para restauração automática
    ; na próxima instalação. NÃO adicionar nenhum Delete/RMDir aqui.

    ; ── Remove uploads/fotos ─────────────────────────────────────
    RMDir /r "${APP_DOCS_DIR}\uploads"
    RMDir /r "${APP_DOCS_DIR}\logo"
    RMDir /r "${APP_DOCS_DIR}\fotos-os"

    ; ── Remove pasta de logs/auditoria (se existir) ──────────────
    RMDir /r "${APP_DOCS_DIR}\logs"

    ; ── Não remove a pasta raiz — BACKUP - OS ainda tem dados ────
    DetailPrint "Dados removidos. Backups preservados em:"
    DetailPrint "${APP_DOCS_DIR}\BACKUP - OS"
    Goto dados_ok

  pular_dados:
    DetailPrint "Dados do usuário mantidos em: ${APP_DOCS_DIR}"

  dados_ok:

  DetailPrint "Desinstalação concluída com sucesso."

  sistema_os_fim_desinstalacao_personalizada:

!macroend

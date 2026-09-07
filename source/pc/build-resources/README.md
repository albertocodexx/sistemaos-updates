# Build Resources — Instalador / Desinstalador

Esta pasta contém todos os recursos necessários para gerar o instalador
profissional do **Sistema OS** usando o electron-builder com NSIS.

## Arquivos incluídos

| Arquivo | Descrição |
|---|---|
| `installer.nsh` | Script NSIS com customizações do instalador e desinstalador |
| `welcome.bmp` | Painel lateral do wizard (164×314 px) — gerado automaticamente |
| `header.bmp` | Cabeçalho das páginas internas (150×57 px) — gerado automaticamente |
| `LICENSE.txt` | Texto da licença exibido na tela de contrato NSIS |
| `icon.ico` | Ícone do aplicativo *(você deve fornecer)* |
| `icon.png` | Ícone PNG para Linux *(você deve fornecer)* |
| `icon.icns` | Ícone macOS *(você deve fornecer, se for gerar para Mac)* |

## O que o instalador faz

1. **Boas-vindas** — Tela inicial com logo e branding do Sistema OS
2. **Licença** — Exibe `LICENSE.txt` para aceite obrigatório
3. **Pasta de destino** — Usuário pode alterar onde instalar
4. **Instalação** — Barra de progresso com mensagens amigáveis
5. **Conclusão** — Opção de abrir o sistema imediatamente

## O que o desinstalador faz

### Remove automaticamente (sem perguntar):
- Todos os arquivos do programa (`%PROGRAMFILES%\Sistema OS\`)
- Atalhos do Desktop e Menu Iniciar
- Cache e dados do Electron (`%APPDATA%\sistema-os-at\`):
  - Cache e Code Cache do Chromium
  - Sessão WhatsApp (baileys-session)
  - IndexedDB, Local Storage, Preferences
  - GPU Cache
- Entradas extras do Registro do Windows
- Arquivos temporários

### Pergunta ao usuário:
- **Deseja remover seus dados de trabalho?**
  - Banco de dados (`database.json`)
  - PDFs de OS e Vendas
  - Backups automáticos
  - Fotos e anexos dos equipamentos
  
  *(padrão: NÃO — mantém os dados)*

## Gerar os executáveis

```bash
# Instalar dependências
npm install

# Gerar instalador Windows (.exe)
npm run build:win

# O instalador será salvo em:
# dist/SistemaOS-25.1.0-Setup.exe
```

## Personalizar o visual

Para mudar as imagens do instalador, edite o arquivo `gen_bitmaps.py` na pasta
raiz do projeto e execute `python3 gen_bitmaps.py`. Isso regerará `welcome.bmp`
e `header.bmp` com as suas cores e textos.

## Requisitos

- Node.js 18+
- npm
- electron-builder 24+
- NSIS 3+ (instalado automaticamente pelo electron-builder)
- Python 3 + Pillow (apenas para reger as imagens)

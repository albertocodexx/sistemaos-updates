# Sistema OS — PC 40.5.1 / Android 20.5.2

## Versões

- Windows: `40.5.1`.
- Android: `20.5.2` (`versionCode 94`).
- Ambas seguem o padrão SemVer `MAJOR.MINOR.PATCH`, com linhas independentes por plataforma.

## Atualização móvel

- O APK oficial usa o nome `SistemaOS-Android-20.5.2.apk`.
- A release também oferece um arquivo de transição reconhecido pelos atualizadores antigos.
- A seleção do APK e o SHA-256 foram cobertos por testes automatizados.

## Funcionalidades desta atualização

- Compartilhamento de PDF com mensagem pronta para OS, entrega, garantia e desbloqueio no Android.
- Sugestões de marca, modelo e cor no formulário de desbloqueio do PC.

## Correção Android 20.5.2

- Corrige PDFs inteiramente pretos ou vazios no compartilhamento: aguarda a renderização, desenha em bitmap antes de gerar o PDF e verifica se existe conteúdo visível.
- Corrige o tamanho da folha para documentos A4 retrato e paisagem.
- Mantém o texto no compartilhamento e copia a mensagem para colar nos aplicativos que ignoram texto junto a um PDF.

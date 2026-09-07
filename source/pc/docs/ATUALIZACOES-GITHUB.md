# Atualizações automáticas — Sistema OS

O canal oficial de distribuição é o repositório público:

`https://github.com/albertocodexx/sistemaos-updates/releases`

O código-fonte e chaves do sistema **não** são publicados nesse repositório.
Somente os arquivos de instalação de cada versão são enviados para uma GitHub
Release pública.

## Arquivos obrigatórios por release

Para o Windows (gerados em `dist/`):

- `SistemaOS-<versão>-Setup.exe`
- `SistemaOS-<versão>-Setup.exe.blockmap`
- `latest.yml`

Para o Android:

- `SistemaOS-<versão>.apk`
- `SistemaOS-<versão>.apk.sha256`

O arquivo `latest.yml` deve ficar na mesma release do instalador Windows. Ele
contém a versão e a verificação criptográfica usadas pelo aplicativo antes de
baixar a atualização.

## Publicação de uma nova versão

1. Aumente a versão do Windows em `package.json` e gere `npm run build:win`.
2. Aumente `versionCode` e `versionName` do Android e gere o APK.
3. Crie uma release estável no GitHub (sem marcar como *pre-release* ou
   *draft*), usando a tag `v<versão-do-Windows>`.
4. Calcule o SHA-256 do APK e publique-o em um arquivo de texto com o mesmo
   nome do APK, acrescentando `.sha256`. No Windows:

   ```powershell
   (Get-FileHash .\SistemaOS-<versão>.apk -Algorithm SHA256).Hash.ToLower() |
     Set-Content .\SistemaOS-<versão>.apk.sha256 -NoNewline
   ```

5. Envie todos os arquivos acima para a release.

O Sistema OS para Windows consulta a release automaticamente e baixa a nova
versão em segundo plano. Ao terminar, o usuário apenas escolhe **Instalar e
reiniciar**. No Android, o app verifica automaticamente, oferece o download e
abre o instalador do próprio Android após a confirmação do usuário.

## Primeira instalação

A primeira instalação continua sendo manual. Depois de instalada a versão que
contém este mecanismo, as próximas versões serão encontradas pelo aplicativo.
No Android, o aparelho sempre pede a confirmação do sistema para instalar um
APK externo — essa confirmação é uma proteção obrigatória do Android.

# Validação do compartilhamento PDF - Android 20.5.2

Data: 12/09/2026.

## Correção

O compartilhamento anterior desenhava uma WebView desconectada da janela diretamente no canvas do PDF. A geração agora aguarda o frame visual, rasteriza em bitmap branco e grava essa imagem no PDF. Páginas pretas e documentos vazios impedem o compartilhamento, com erro visível e opção de tentar novamente. A4 paisagem/retrato e os termos da OS são ajustados antes da captura.

A mensagem é incluída no Intent e copiada para a área de transferência. O aplicativo de destino ainda decide se exibe texto junto ao PDF; quando não exibe, o usuário pode colar a mensagem. Não foi realizado envio a contatos reais.

## Verificações executadas

- `npm test`: aprovado.
- Verificações de sintaxe dos seis módulos JavaScript alterados: aprovadas.
- Teste de compartilhamento: texto e PDF presentes no payload, fallback de clipboard e compartilhamento preservado quando o clipboard falha.
- Emulador Android 15 / API 35: `PdfCompartilhavelTest`, 2 testes aprovados. Gera os templates reais de OS, entrega, garantia e desbloqueio com dados fictícios, mais um documento com duas páginas. Reabre cada PDF usando PdfRenderer e verifica conteúdo, orientação e os marcadores diferentes de cada página. Verifica rejeição de bitmap preto e vazio.
- Renderização dos cinco PDFs em PNG pelo Poppler e inspeção visual: aprovadas, incluindo todos os termos da OS e as duas páginas do documento de teste.
- Compilações debug e release com R8: aprovadas.
- APK oficial: `versionName 20.5.2`, `versionCode 94`, certificado estável confirmado pelo apksigner.

O teste foi executado em emulador; o celular físico do usuário não estava conectado.

## Reproduzir o teste gráfico

1. Executar `node testes/gerar-fixtures-pdf-android.js` e sincronizar os assets com `npx cap sync android`.
2. Compilar `:app:assembleDebug :app:assembleDebugAndroidTest` no Gradle.
3. Instalar o APK debug e o APK androidTest em um emulador de teste.
4. Executar `adb shell am instrument -w -e class com.assistencia.sistemaos.PdfCompartilhavelTest com.assistencia.sistemaos.test/androidx.test.runner.AndroidJUnitRunner`.

A Activity de teste existe apenas em `src/debug` e não faz parte do APK oficial. Os documentos de teste não contêm dados de clientes reais.

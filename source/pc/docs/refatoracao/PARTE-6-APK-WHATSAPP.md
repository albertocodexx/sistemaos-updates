# Parte 6 — APK, Firebase e WhatsApp

Data: 17/07/2026

Primeira extração desta etapa: `renderer/modules/mobile/sync-status.js`.

O módulo conserva o status visual da sincronização Firebase, o botão de sincronização manual e a atualização após documento/assinatura recebida. Ele expõe `init()` idempotente e `dispose()`.

As APIs de eventos do preload agora retornam uma função de cancelamento depois de inscrever o listener. Isto é compatível com chamadas existentes que ignoram o retorno e permite que o novo módulo limpe os dois ouvintes ao ser descartado.

Importação, lote, assinatura remota, entregas mobile e WhatsApp não foram movidos nesta subetapa.

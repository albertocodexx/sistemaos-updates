# Fluxo PC, Firebase e celular

O Firebase é a passagem de sincronização; os registros definitivos continuam
no banco local do PC depois da importação bem-sucedida.

    Celular
      -> Firestore / arquivos externos configurados
      -> src/firebase-sync.js no PC (listeners)
      -> main.js importa e grava via src/db.js
      -> main.js emite sync:documentoImportado ou sync:assinaturaRecebida
      -> preload.js entrega eventos ao renderer
      -> renderer/modules/mobile/sync-status.js atualiza a interface

No sentido PC para celular, o renderer chama o preload, que aciona os canais
de sincronização ou assinatura no processo principal. O main delega o envio a
src/firebase-sync.js; o celular consulta/recebe o documento pelo fluxo
configurado.

Os listeners do renderer retornam uma função de cancelamento. O módulo de
status usa essa função ao descartar a tela, evitando inscrição duplicada.

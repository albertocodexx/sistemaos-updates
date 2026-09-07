# Cobertura atual dos smoke tests

Execute a suíte com:

    npm run test:smoke

## Coberto automaticamente

| Área | Teste |
| --- | --- |
| Sintaxe e entradas do Electron | teste-inicializacao-electron.js |
| Registro e duplicidade dos 178 canais IPC | teste-ipc-registro-completo.js e teste-ipcs-duplicados.js |
| Delegação dos canais de licença | teste-ipc-licenca.js |
| API pública, grupos e compatibilidade do preload | teste-preload-api.js |
| Encaminhamento da API organizada de OS | teste-preload-os-api.js |
| Agregação e edição de Clientes em memória | teste-repositorio-clientes.js |
| Core e módulos extraídos do renderer | testes renderer-core, licença, OS, estoque e sync-status |

## Ainda manual ou de integração

Os smoke tests não substituem os cenários abaixo, pois exigem aplicativo
aberto, credenciais, dispositivo ou dados reais:

- criação/edição de OS, PDF e fotos;
- Firebase, Cloudinary, assinatura remota e APK;
- WhatsApp, Mercado Pago e IA;
- backup, restauração e atualização;
- permissões e fluxos visuais.

Use o checklist de regressão do plano após cada mudança nesses fluxos.

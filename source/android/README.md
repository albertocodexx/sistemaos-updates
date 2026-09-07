# Sistema OS — App do Celular

App web (sem instalação, sem APK) pra técnico preencher uma OS no
celular do cliente, mostrar a prévia com o mesmo template do PC, coletar
a assinatura do cliente na tela, guardar num histórico local do
aparelho e exportar um `.json` pra importar depois no sistema do PC.

## Como rodar localmente

Dentro da pasta `celular-os/`:

```bash
python3 -m http.server 8910
```

Abra `http://localhost:8910` no navegador do computador.

## Como testar no navegador do celular (rede Wi-Fi local)

1. Confirme que o celular está na **mesma rede Wi-Fi** do computador
   que está rodando o servidor.
2. Descubra o IP local do computador na rede:
   - Windows: `ipconfig` (procure "Endereço IPv4")
   - Linux/Mac: `ifconfig` ou `ip a` (procure algo como `192.168.x.x`)
3. No navegador do celular, acesse:
   ```
   http://SEU_IP_LOCAL:8910
   ```
   Exemplo: `http://192.168.0.15:8910`
4. Se não abrir, confira o firewall do computador — pode ser preciso
   liberar a porta 8910 para conexões da rede local.

Alternativa: `npx live-server --port=8910` funciona igual, se preferir.

## O fluxo completo (as 8 telas)

1. **Formulário** — Cliente / Aparelho / Ordem de serviço. Valida os 5
   campos obrigatórios (nome, telefone, marca, modelo, defeito
   relatado) e o dígito verificador de CPF/IMEI se preenchidos, com as
   mesmas regras de `validarDadosOS` do PC (`js/validacao.js`).
2. **Gerar prévia** — monta o objeto `os` e chama `gerarHtmlOS(os,
   config)` — a mesmíssima função usada pelo PC pra montar o PDF —
   exibindo o resultado (via cliente + via assistência) num `<iframe>`.
3. **Assinar** — abre uma tela cheia com `<canvas>`, desenho contínuo
   por toque (`touchstart`/`touchmove`/`touchend`). "Confirmar" só
   habilita depois do primeiro traço.
4. **Confirmar assinatura** — captura o canvas
   (`canvas.toDataURL()`) e injeta a imagem só no espaço de assinatura
   **do cliente** (nunca o da assistência técnica) já dentro do HTML
   renderizado, sem regenerar nada do zero.
5. **Prévia atualizada** — mostra o PDF com a assinatura já visível.
6. **Salvar no histórico do celular** — grava o registro completo
   (dados + assinatura + data/hora) no IndexedDB do navegador
   (`js/historico.js`). É um histórico **só deste aparelho**, separado
   do histórico oficial do PC.
7. **Exportar para o PC** — gera o `.json` no contrato exato esperado
   pela importação do PC (ver abaixo) e aciona o menu de compartilhar
   nativo (`navigator.share`, com fallback pra download se a API não
   estiver disponível no navegador).
8. **Histórico** (aba própria) — lista as OS salvas neste aparelho
   (cliente, aparelho, data, miniatura da assinatura). Abrir um item
   reabre a mesma prévia já renderizada e já assinada, sem precisar
   assinar de novo. Deixa claro que é um histórico local: *"Salvo neste
   aparelho. Ainda não importado no computador."*

## Reaproveitamento do template do PC

Estes 4 arquivos são **cópia byte a byte** do projeto Electron, sem
nenhuma alteração:

```
src/termos-predefinidos.js
src/templates/tema-pdf.js
src/templates/empresa-compositor.js
src/templates/os-template.js   ← exporta gerarHtmlOS(os, config)
```

`src/templates/browser-shim.js` é o único arquivo criado só pra esses 4
rodarem no navegador (sem `require`/`module.exports` nativos do Node) —
carrega cada um via `<script>` e resolve as dependências entre eles.

A injeção da assinatura acontece **de fora** do template (igual
`injetarAssinaturaClienteNoHtml` já faz no PC, em `src/pdf.js`): troca
o `<div class="assinatura-espaco"></div>` que precede o rótulo
"ASSINATURA DO CLIENTE" por uma `<img>`, via DOM dentro do iframe. O
template continua idêntico nos dois lados — nenhuma divergência visual
entre o que o celular mostra e o que o PC gera.

## Contrato do `.json` exportado

Formato aceito, sem fricção, por `importarOSDoCelular` (`v43/src/db.js`
do PC):

```json
{
  "tipoArquivo": "sistema-os-celular",
  "versaoFormato": 1,
  "geradoEm": "2026-07-03T21:00:00.000Z",
  "dadosOS": {
    "cliente": { "nome": "", "cpf": "", "email": "", "telefone": "" },
    "aparelho": {
      "tipo": "", "tipoEquipamento": "", "marca": "", "modelo": "",
      "cor": "", "imei": "", "defeitoRelatado": "", "observacoes": "",
      "acessorios": "", "senhaAparelho": ""
    },
    "observacoes": "", "prioridade": "Normal",
    "dataPrevista": "", "horaPrevista": ""
  },
  "assinaturaClienteBase64": "data:image/png;base64,...."
}
```

Regras importantes, testadas contra a validação real do PC:

- **Nunca** contém `numero` de OS em lugar nenhum — o celular não
  numera; o PC gera o número sequencial oficial no momento da
  importação (`criarOS`), com a mesma validação de qualquer OS criada
  manualmente.
- `dadosOS` só tem os campos que o formulário do celular coleta.
  Diagnóstico técnico, controle de bancada, técnico responsável,
  checklist de entrada/saída, valor investido e fotos **não** fazem
  parte disso — são preenchidos depois, no PC.

## Decisões fixadas (não é bug, é escolha deliberada)

- **`config` (nome da empresa, logo) fica fixo no código**
  (`CONFIG_FIXO` em `js/app.js`), sem tela de configuração e sem
  sincronismo com o PC nesta fase. Sem logo, o template usa o
  monograma automaticamente.
- **Sem fotos do aparelho.** `criarOS` aceita fotos, mas isso infla o
  `.json` exportado (base64 grande) — fase 1 do celular fica só com
  texto.
- **Sem numeração no celular.** O número de OS só existe depois da
  importação no PC.
- **Sem PDF binário no celular.** A prévia em HTML já resolve "ler
  antes de assinar"; gerar um PDF de verdade exigiria uma lib extra
  sem necessidade real nesta fase.
- **Histórico local (IndexedDB) é só uma cópia de conveniência** do
  aparelho — não sabe e não precisa saber se uma OS específica já foi
  importada no PC ou não.

## Fora de escopo nesta fase

- Empacotar como APK — isto aqui é uma página web comum, testável no
  navegador do celular pela rede Wi-Fi local.
- Qualquer alteração no lado do PC (`db.js`, `pdf.js`, `main.js`,
  `preload.js`, `renderer/*`) — já está pronto e testado; não foi
  tocado.
- Venda e compra — este app cobre só OS.
- Adaptação de layout responsivo pra tela pequena — o `<iframe>` da
  prévia mantém as dimensões A4 paisagem originais, com rolagem
  horizontal.

## Estrutura de arquivos

```
celular-os/
├── index.html                          formulário, prévia, histórico
├── README.md
├── css/app.css
├── js/
│   ├── app.js                          orquestra tudo: valida, monta `os`,
│   │                                    gera prévia, navega entre telas
│   ├── validacao.js                    espelha validarCPF/validarIMEI/
│   │                                    validarDadosOS do PC
│   ├── assinatura.js                   tela cheia de assinatura (canvas + touch)
│   └── historico.js                    histórico local (IndexedDB)
└── src/
    ├── termos-predefinidos.js          ← copiado do PC, sem alteração
    └── templates/
        ├── tema-pdf.js                 ← copiado do PC, sem alteração
        ├── empresa-compositor.js       ← copiado do PC, sem alteração
        ├── os-template.js              ← copiado do PC, sem alteração
        └── browser-shim.js             só pra esses 4 rodarem no navegador
```

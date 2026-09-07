# Arquitetura Futura — Versão Servidor / SaaS

> Documento técnico da Etapa 11.4. Descreve como o Sistema OS v4, hoje
> 100% local, está preparado para uma futura migração para servidor
> ou SaaS **sem precisar de refatoração** — só de novos adaptadores.

## 1. Modo de operação

O sistema tem dois modos previstos em `config.rede.modoOperacao`:

| Modo | Status | Descrição |
|---|---|---|
| `local` | ✅ Ativo (padrão e único implementado) | Dados em `database.json`, em disco, na pasta do usuário. Funciona 100% offline. |
| `servidor` | 🔒 Placeholder (não implementado) | Reservado para a futura versão com backend remoto. Tentar ativá-lo hoje retorna erro explícito (`src/db.js → salvarConfigRede`), em vez de deixar o sistema num estado quebrado. |

A troca de modo é centralizada — nenhuma tela ou regra de negócio
pergunta "estou local ou remoto?" diretamente; quem decide isso é
`src/dataService.js`.

## 2. Camada de abstração (`src/dataService.js`)

Hoje, `main.js` chama funções de `src/db.js` diretamente (CRUD de OS,
estoque, usuários, cargos, config, etc.) — esse arquivo já funciona
como o repositório único de acesso a dados, documentado no topo do
próprio `db.js`.

A Etapa 11.4 adiciona `src/dataService.js` como uma camada por cima
disso: um proxy que repassa qualquer chamada (`dataService.listarOS()`,
`dataService.criarUsuario(...)`, etc.) para o adaptador ativo no
momento, escolhido a partir de `config.rede.modoOperacao`:

```
main.js / IPC handlers
        │
        ▼
src/dataService.js   ← decide local x servidor a cada chamada
        │
        ├── modo "local"    → src/db.js (JSON em disco) — ativo hoje
        └── modo "servidor" → adaptador remoto (placeholder, Etapa futura)
```

Quando a versão servidor for implementada, o trabalho será **escrever
um novo adaptador** com a mesma assinatura de funções de `db.js`
(`listarOrdens`, `criarUsuario`, `obterConfig`, etc.) e plugá-lo no
lugar do `Proxy` placeholder em `dataService.js`. Nenhuma tela do
renderer, nenhum handler de IPC em `main.js` precisa mudar — todos já
chamam por nome de função, não por implementação.

## 3. Banco de dados desacoplado

`src/db.js` já isola 100% da leitura/escrita do `database.json` atrás
de funções nomeadas (é a única parte do sistema que toca o arquivo
físico). Isso é o que permite, no futuro, trocar o armazenamento:

- **Hoje:** JSON local (`fs.readFileSync` / `fs.writeFileSync`).
- **Futuro:** PostgreSQL ou MySQL atrás de um adaptador remoto, mantendo
  exatamente os mesmos nomes de função e formatos de retorno usados
  hoje (schema documentado no cabeçalho de `db.js`).

Nenhuma query SQL nem schema de banco relacional é necessário agora —
a estrutura só precisa continuar "escondendo" a origem dos dados atrás
de funções, o que já é verdade.

## 4. Estrutura pronta para API REST

Quando o modo servidor for implementado, o adaptador remoto deve:

1. Falar com uma API REST própria do backend SaaS (não com o banco
   diretamente) — autenticada via token.
2. Reaproveitar os mesmos contratos de função do adaptador local
   (mesmos parâmetros, mesmo formato de retorno), pra `dataService.js`
   continuar funcionando sem mudanças.
3. Tratar timeout/erro de rede convertendo pra erros amigáveis, do
   jeito que `main.js` já espera (`{ sucesso: false, erro }`).

## 5. Configurações futuras (já no schema, hoje inertes)

Campos já existentes em `config.rede` (ver `DEFAULT_CONFIG` em
`src/db.js`), editáveis via IPC `rede:obter` / `rede:salvar`:

| Campo | Uso futuro |
|---|---|
| `modoOperacao` | `'local'` ou `'servidor'` |
| `apiUrl` | endereço da API REST do servidor SaaS |
| `apiToken` | token de autenticação da instalação |
| `chaveEmpresa` | chave que identifica a empresa dona dos dados |
| `identificadorEmpresa` | identificador multiempresa (ver seção 6) |

Esses campos já são salvos e migrados junto com o resto da
configuração (`migrarConfig`), mas não têm efeito nenhum enquanto o
modo for `local`.

## 6. Multiempresa

A versão SaaS deve isolar dados por empresa. Dois pontos já preparados
para isso:

- `identificadorEmpresa` no `config.rede`, pensado para ser enviado em
  toda chamada ao backend remoto (como um tenant ID).
- Todo o schema de dados (OS, estoque, usuários, cargos) já é
  auto-contido em um único `database.json` por instalação — ou seja,
  cada instalação local já é, na prática, "uma empresa". Migrar pra
  multiempresa remoto significa apenas anexar `identificadorEmpresa` em
  cada requisição do adaptador remoto, sem mudar o formato dos dados.

## 7. Sincronização futura

Fora de escopo desta etapa, mas a arquitetura já não bloqueia isso:
como toda escrita já passa por funções centralizadas (`db.js` hoje,
`dataService.js` depois), um modo híbrido "local + sincroniza quando
há rede" pode ser implementado como um terceiro adaptador (ex.:
`adaptadorHibrido`) sem alterar main.js nem o renderer — só
implementando fila de pendências e reconciliação dentro do próprio
adaptador.

## 8. Migração sem refatoração — resumo

| Camada | Muda quando vier o modo servidor? |
|---|---|
| `renderer/*` (telas) | Não — continua chamando `window.api.*` |
| `preload.js` | Não — continua expondo os mesmos canais IPC |
| `main.js` (handlers IPC) | Não — continua chamando `dataService.*` |
| `src/dataService.js` | Pouco — só troca o adaptador escolhido |
| `src/db.js` (local) | Não — continua sendo o adaptador local |
| Adaptador remoto novo | **Sim — é o único código realmente novo** |

Esse é o objetivo da Etapa 11.4: a única peça que falta para um dia
ligar o modo servidor é escrever o adaptador remoto em si.

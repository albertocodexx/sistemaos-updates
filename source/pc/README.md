# Sistema OS v4 — A&T Assistência Técnica

Sistema completo de gestão para assistência técnica, desenvolvido em Electron com armazenamento local (JSON).

---

## ✅ Funcionalidades

### Ordens de Serviço
- Cadastro com dados de cliente e aparelho
- **Status da OS** com histórico de alterações (Aguardando análise → Em orçamento → Em reparo → Finalizado → Entregue → Cancelado)
- Geração de PDF automática em 2 vias
- Edição de OS com regeneração de PDF
- Busca por número, nome, CPF, telefone, status
- **Termos salvos por OS** — OS antigas preservam seus próprios termos, novos termos da configuração só valem para OS futuras
- **Checklist Técnico de Recebimento**: checklist de defeitos por tipo de equipamento
  (Notebook / Computador), campo livre de defeito relatado pelo cliente (coexistem),
  checklist de acessórios recebidos e checklist de testes de entrada (uso interno)
- **Diagnóstico Técnico**: diagnóstico, solução recomendada, peças necessárias,
  valor estimado e prazo estimado — exibidos no PDF como orçamento técnico

### Estoque de Aparelhos
- Cadastro completo: marca, modelo, cor, IMEI, observações, data de entrada
- **Status de estoque**: Aguardando chegada → Em análise → Em reparo → Pronto para venda → Reservado → Vendido → Cancelado
- Ao mudar para "Pronto para venda": sistema pergunta o valor de venda automaticamente
- **Controle financeiro** por aparelho: valor pago, gastos com peças, gastos extras, valor de venda, lucro
- **Checklist de venda** com 15 itens (tela, touch, câmeras, Wi-Fi, Bluetooth, etc.), data de conferência e responsável
- **Fotos** do aparelho com galeria
- **PDF de Venda** com dados do comprador, garantia, campo de assinatura e ID único

### Painel de Estoque
- Indicadores: total de aparelhos, disponíveis, em reparo, aguardando, reservados, vendidos
- Valores: total investido, total vendido, lucro total
- **Gráfico de barras** por mês — compras e vendas dos últimos 6 meses

### Configurações (salvamento automático)
- Nome, endereço, telefone, CNPJ
- Logo da assistência
- Termos padrão da OS (só para novas OS)
- Garantia padrão
- Texto do rodapé dos PDFs
- Modo escuro / claro

### Backup
- Exportar backup completo (OS + Estoque + Config) em JSON
- Importar backup sem perda de dados (duplicatas ignoradas)

---

## 🗂 Estrutura de Arquivos

```
sistema-os-v4/
├── main.js                       # Processo principal (IPC, janela, handlers)
├── preload.js                    # Bridge segura renderer ↔ main
├── package.json
├── renderer/
│   ├── index.html                # Interface completa (Nova OS, Histórico, Estoque, Painel)
│   ├── style.css                 # Tema claro e escuro
│   └── renderer.js               # Lógica de interface
└── src/
    ├── db.js                     # Banco de dados JSON local (todas as operações)
    ├── pdf.js                    # Geração de PDFs via Electron printToPDF
    ├── backup.js                 # Exportar e importar backup
    └── templates/
        ├── os-template.js        # HTML da Ordem de Serviço (2 vias)
        └── venda-template.js     # HTML do PDF de Venda do estoque
```

---

## 📦 Dados Salvos (Documents/Sistema OS/)

| Pasta/Arquivo       | Conteúdo                           |
|---------------------|------------------------------------|
| database.json       | Todas as OS, estoque, configuração |
| PDFs/               | PDF de cada Ordem de Serviço       |
| PDFs-Venda/         | PDF de cada venda do estoque       |
| BACKUP - OS/        | Backup automático por OS           |
| Logo/               | Logo da assistência                |
| Fotos-Estoque/      | Fotos dos aparelhos do estoque     |

---

## 🗃 Estrutura do Banco de Dados (database.json)

```json
{
  "versao": 3,
  "proximoNumero": 1,
  "proximoEstoqueId": 1,
  "config": {
    "nomeEmpresa": "...",
    "termosOS": "...",
    "garantiaPadrao": "90 dias",
    ...
  },
  "ordens": [
    {
      "numero": "OS-0001",
      "status": "Em reparo",
      "historicoStatus": [{ "status": "Aguardando análise", "data": "..." }],
      "termos": "...snapshot imutável dos termos no momento da criação...",
      "cliente": { "nome": "...", "cpf": "...", "telefone": "...", "email": "..." },
      "aparelho": {
        "marca": "...", "modelo": "...",
        "checklistDefeitos": ["Não liga", "Tela quebrada"],
        "acessoriosChecklist": ["Carregador", "Mochila"],
        "testesEntrada": ["Liga normalmente"],
        ...
      },
      "diagnosticoTecnico": {
        "diagnostico": "...", "solucao": "...", "pecas": "...",
        "valorEstimado": 250.5, "prazoEstimado": "5 dias úteis"
      },
      ...
    }
  ],
  "estoque": [
    {
      "id": "EST-0001",
      "status": "Pronto para venda",
      "valorPago": 300,
      "valorGastoPecas": 80,
      "gastosExtras": 20,
      "valorVenda": 650,
      "checklist": [ { "id": "tela", "label": "Tela funcionando", "ok": true }, ... ],
      "fotos": [ { "path": "...", "base64": "..." } ],
      ...
    }
  ]
}
```

---

## 🔌 APIs IPC (main ↔ renderer)

| Canal                        | Descrição                             |
|------------------------------|---------------------------------------|
| `os:criar`                   | Cria OS, gera PDF, backup automático  |
| `os:atualizar`               | Edita OS, regera PDF                  |
| `os:listar`                  | Lista todas as OS                     |
| `os:buscar`                  | Busca OS por termo                    |
| `os:obter`                   | Busca OS por número                   |
| `estoque:criar`              | Cria item no estoque                  |
| `estoque:atualizar`          | Atualiza item do estoque              |
| `estoque:listar`             | Lista todo o estoque                  |
| `estoque:stats`              | Retorna estatísticas do painel        |
| `estoque:gerarPdfVenda`      | Gera PDF de venda do aparelho         |
| `estoque:salvarFoto`         | Salva foto no disco e vincula ao item |
| `config:obter`               | Retorna configuração atual            |
| `config:salvar`              | Salva configuração                    |
| `backup:exportar`            | Exporta backup JSON completo          |
| `backup:importar`            | Importa backup JSON                   |

---

## 🚀 Como rodar

```bash
npm install
npm start
```

## 🏗 Como compilar

```bash
npm run build:win    # Windows (.exe)
npm run build:mac    # macOS (.dmg)
npm run build:linux  # Linux (.AppImage)
```

---

## 📋 Regras de Negócio

1. **Termos da OS**: Cada OS guarda um snapshot dos termos no momento da criação. Alterar os termos padrão nas configurações nunca altera OS anteriores.
2. **Status ao mudar para "Pronto para venda"**: O sistema solicita automaticamente o valor de venda.
3. **Vendido com PDF**: Ao marcar um aparelho como Vendido, o PDF de venda é gerado e aberto automaticamente.
4. **Lucro**: `Lucro = Valor de venda - (Valor pago + Gastos com peças + Gastos extras)`
5. **Backup**: Ao importar, OS e itens de estoque com IDs já existentes são ignorados (sem duplicação).
6. **Histórico de status**: Cada mudança de status é registrada com data/hora.

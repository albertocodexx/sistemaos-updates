# Sistema OS 40.5.11 / Android 20.5.10

Correções de autorização, cobranças sincronizadas e legibilidade das estatísticas no celular.

- OS com status técnico **Autorizada** voltam a aparecer corretamente na área Autorizadas, mesmo em registros antigos sem o campo separado de aprovação.
- A área Autorizadas agora separa Todas, Pagas, Pagamento na retirada e Finalizadas; uma OS só entra em Finalizadas quando está entregue e integralmente paga.
- O computador recebe uma área própria de Cobranças com filtros Todos, OS e Vendas, busca, criação, edição, situação e exclusão.
- Cobranças de OS e vendas usam a mesma origem sincronizada no PostgreSQL/Supabase e refletem alterações feitas no PC ou no celular.
- O saldo exibido passa a descontar a parcela atual: em uma venda de R$ 350,00 com cobrança de R$ 175,00, o restante mostrado é R$ 175,00.
- Lembretes locais do Android também incluem cobranças de vendas.
- O painel financeiro móvel mostra valor, mês e ano em cada barra, com rolagem horizontal quando há muitos meses.
- Os cartões de atividade recente no celular deixam de comprimir e cortar nome, aparelho, valor e data.

Validação executada: suíte completa do Android, suíte de smoke tests do PC, testes de sincronização, cobranças, notificações, Mercado Pago, isolamento multiempresa, filas offline, assinaturas e sintaxe.

Observação: o instalador Windows ainda não possui assinatura Authenticode comercial. Use somente os arquivos oficiais da página de Releases e confira o hash SHA-256 publicado.

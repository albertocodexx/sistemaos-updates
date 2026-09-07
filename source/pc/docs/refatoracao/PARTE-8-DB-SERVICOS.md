# Parte 8 — Banco e serviços

Primeiro recorte concluído: domínio de Clientes.

- src/repositories/clientes-repository.js contém a agregação, busca,
  histórico e atualização de clientes.
- O repositório recebe loadDB e saveDB por injeção; ele não sabe onde o banco
  físico está armazenado.
- src/db.js continua exportando os mesmos métodos públicos:
  buscarHistoricoCliente, listarClientes, buscarClientes, obterPerfilCliente e
  atualizarDadosCliente.
- O formato de database.json não foi alterado e não há migração de dados.

O teste de fumaça usa somente um estado em memória e comprova a propagação da
edição do cliente para OS, estoque vendido e compras.

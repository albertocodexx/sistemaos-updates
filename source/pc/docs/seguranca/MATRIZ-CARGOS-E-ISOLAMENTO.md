# Segurança, cargos e isolamento do Sistema OS

Revisão: 14 de setembro de 2026.

## Decisões aplicadas

O Sistema OS usa papéis estáveis e permissões por ação. A regra base é negar o que não foi liberado, validar a autorização no servidor em toda operação e obter a empresa pela sessão autenticada. O aplicativo não aceita `empresa_id` da URL, de um campo da tela ou de dados enviados pelo cliente como fonte de autorização.

| Cargo da assistência | OS e clientes | Estoque | Financeiro | Relatórios | Configuração e equipe |
|---|---|---|---|---|---|
| Administrador | controle completo | controle completo | controle completo | acesso completo | configura empresa, usuários e integrações |
| Gerente | cria, edita e exclui OS; edita clientes | cria e edita, sem exclusão definitiva | registra e edita, sem exclusão definitiva | somente leitura | consulta configuração e gerencia usuários sem excluir |
| Técnico | cria e atualiza OS; consulta e atualiza cliente | consulta e baixa peças, sem cadastrar/excluir | sem acesso | somente indicadores operacionais | sem acesso |
| Atendente | cria e atualiza OS e clientes | sem acesso | sem acesso | sem acesso | sem acesso |

| Cargo do suporte Aurevion | Permissões |
|---|---|
| Analista de Suporte | consulta empresas, chamados e diagnóstico; não altera plano, credencial ou exclusão |
| Gerente de Suporte | gerencia licenças, pagamentos e usuários das empresas; não acessa chaves globais nem conclui exclusão |
| Administrador Geral | ações administrativas críticas, incluindo chaves de IA, políticas globais, fiscal, planos e decisão final de exclusão |

As chaves de IA ficam cifradas no cofre da nuvem e são usadas somente pelas Edge Functions. Nenhuma chave é devolvida ao Electron ou ao APK. A personalização por empresa nasce desativada, pode ser ligada somente pelo Administrador Geral e ainda exige liberação explícita para cada empresa. O Administrador da assistência é o único cargo local que pode cadastrar uma chave própria. As cotas são atômicas no PostgreSQL e limitam uso por minuto e por mês, por empresa e globalmente.

## Banco e backup

Todas as tabelas operacionais usam RLS e vínculo obrigatório com a empresa da sessão. Views executam com as políticas do usuário. Arquivos e backups ficam em buckets privados, sob o prefixo UUID da empresa. Uma política restritiva reserva o backup completo ao Administrador da própria empresa. O download confere tamanho e SHA-256 antes de restaurar; versões históricas permitem recuperar a última cópia íntegra se uma gravação for interrompida. O tráfego usa HTTPS e o armazenamento gerenciado mantém criptografia em repouso.

Os testes `02_rls_multiempresa`, `04_storage_rls`, `13_ia_global_seguranca` e `14_backup_isolamento` tentam ler, gravar e alterar registros usando a sessão de outra empresa. Publicação exige que esses testes terminem sem acesso cruzado.

## Referências usadas

- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): menor privilégio, negação por padrão e validação em cada requisição.
- [OWASP Multi-Tenant Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html): empresa derivada da identidade verificada, RLS, caches e filas vinculados ao tenant e auditoria.
- [NIST — Role Based Access Control FAQ](https://csrc.nist.gov/Projects/Role-Based-Access-Control/faqs): autorização por papel, transação e separação de responsabilidades.
- [NIST SP 800-53 Rev. 5](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-53r5.pdf): menor privilégio, separação de funções e trilha de auditoria.
- [RepairDesk — Employee Roles and Permissions](https://help.repairdesk.co/portal/en/kb/articles/employee-roles-and-permissions): controles usados em assistência técnica para desconto, custos, estoque e operações de caixa.

## Limite da garantia

Os testes automatizados comprovam as regras implementadas e evitam regressões conhecidas. Segurança absoluta não existe; mudanças futuras de schema, Edge Functions ou políticas devem repetir esta suíte antes de publicação e receber revisão periódica de logs, dependências e permissões.

# Sistema OS 40.5.7 / Android 20.5.9

Correção do fluxo de consulta, assinatura e armazenamento de PDFs de venda.

- A busca de vendas no celular agora aceita parte do nome. Pesquisar `Alberto`, por exemplo, encontra `Alberto Parma Couto` e outros nomes correspondentes.
- Vendas antigas criadas no celular também são encontradas quando o nome estava salvo apenas nos dados internos do documento.
- Ao assinar uma venda, o Android gera o PDF final antes de salvar e coloca esse PDF na fila segura de sincronização.
- O PDF é catalogado como arquivo oficial da venda no armazenamento privado, ficando disponível na consulta em outros dispositivos.
- Ao consultar um documento antigo sem PDF catalogado, o celular tenta recuperar o registro local, regenerar o PDF e enviá-lo automaticamente.
- O PC também procura PDFs locais de compras e vendas antigas e os publica na nuvem de forma idempotente, sem criar arquivos duplicados.
- Nomes de arquivos preservam a extensão correta, evitando arquivos terminados em `.pdf.pdf`.
- O APK foi compilado com código interno 101 e assinatura verificada.

Validação executada: 91 verificações automatizadas do PC, suíte completa do Android, teste específico de busca parcial, geração nativa do PDF, fila privada de arquivos, recuperação de vendas antigas e builds finais de Windows e Android.

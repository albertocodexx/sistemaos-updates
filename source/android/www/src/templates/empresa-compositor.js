// src/templates/empresa-compositor.js
// ─────────────────────────────────────────────────────────────────────────
// Compositor centralizado dos dados da empresa (Etapa 3).
//
// Toda OS, comprovante de venda, relatório ou impressão que precisar exibir
// dados da empresa (nome, logo, contato, endereço, CNPJ, rodapé) deve passar
// pela config do banco através desta função — nunca ler `config.campo`
// diretamente espalhado pelos templates. Isso garante:
//
//   - Alterou nas Configurações -> reflete em todo lugar automaticamente,
//     sem precisar tocar em nenhum template.
//   - Mesma regra de "o que mostrar e quando" em todos os documentos
//     (exibição condicional centralizada — nada de campo vazio gerando
//     espaço ou linha em branco no PDF).
//   - O nome da empresa nunca aparece duplicado: quando não há logo,
//     mostra-se um monograma (iniciais) no lugar da logo — nunca o nome
//     da empresa escrito de novo ao lado do <h1>/título que já o exibe.
// ─────────────────────────────────────────────────────────────────────────

function iniciaisDoNome(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const iniciais = partes.map(p => p[0]).join('').toUpperCase();
  return iniciais || 'OS';
}

function formatarSiteParaPdf(site) {
  // URL completa costuma estourar a coluna estreita das duas vias. O endereço
  // continua o mesmo, mas no PDF exibimos a forma curta e legível.
  return String(site || '')
    .trim()
    .replace(/^https?:\/\/(?:www\.)?/i, '')
    .replace(/\/+$/, '');
}

function montarDadosEmpresa(config) {
  const empresa = config || {};

  const nome = (empresa.nomeFantasia || '').trim() || (empresa.nomeEmpresa || '').trim() || 'Assistência Técnica';

  // Razão social só é exibida se preenchida e diferente do nome já exibido
  // (evita repetir o mesmo texto duas vezes no cabeçalho).
  const razaoSocial = (empresa.razaoSocial || '').trim();
  const razaoSocialLinha = (razaoSocial && razaoSocial !== nome) ? razaoSocial : '';

  const temLogo = !!empresa.logoBase64;
  const iniciais = iniciaisDoNome(nome);

  const exibirCnpj = empresa.exibirCnpjDocumentos !== false; // padrão: exibir
  const cnpj = (exibirCnpj && empresa.possuiCnpj && empresa.cnpj) ? empresa.cnpj.trim() : '';
  const inscricaoEstadual = (cnpj && empresa.inscricaoEstadual) ? empresa.inscricaoEstadual.trim() : '';

  // Telefone principal (com fallback para o campo antigo) é a base; os
  // demais só entram na lista se preenchidos e diferentes do principal,
  // pra não repetir o mesmo número duas vezes.
  const telefonePrincipal = (empresa.telefonePrincipal || empresa.telefoneEmpresa || '').trim();
  const telefoneFixo = (empresa.telefoneFixo || '').trim();
  const whatsapp = (empresa.whatsapp || '').trim();
  const email = (empresa.email || '').trim();
  const site = formatarSiteParaPdf(empresa.site);

  const linhasContato = [];
  if (telefonePrincipal) linhasContato.push(`Tel.: ${telefonePrincipal}`);
  if (telefoneFixo && telefoneFixo !== telefonePrincipal) linhasContato.push(`Fixo: ${telefoneFixo}`);
  if (whatsapp && whatsapp !== telefonePrincipal && whatsapp !== telefoneFixo) linhasContato.push(`WhatsApp: ${whatsapp}`);
  if (email) linhasContato.push(email);
  if (site) linhasContato.push(site);

  const endereco = (empresa.enderecoEmpresa || empresa.endereco || '').trim();

  // Rodapé dinâmico: texto configurado pelo usuário + contato resumido
  // (site/e-mail), só entra cada linha se houver conteúdo.
  const rodape = [];
  if ((empresa.textoRodapePdf || '').trim()) rodape.push(empresa.textoRodapePdf.trim());
  const contatoResumo = [site, email].filter(Boolean).join(' · ');
  if (contatoResumo) rodape.push(contatoResumo);

  return {
    nome,
    razaoSocialLinha,
    logoBase64: empresa.logoBase64 || '',
    temLogo,
    iniciais,
    cnpj,
    inscricaoEstadual,
    linhasContato,
    endereco,
    rodape,
    // Expostos separadamente para uso no rodapé com ícones (data/telefone/e-mail)
    telefoneRodape: telefonePrincipal || whatsapp || telefoneFixo,
    emailRodape: email
  };
}

module.exports = { montarDadosEmpresa, formatarSiteParaPdf };

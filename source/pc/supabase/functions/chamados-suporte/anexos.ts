export function validarAnexos(valor: unknown) {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor) || valor.length > 3) throw new Error('Envie até 3 prints por mensagem.');
  return valor.map((item) => {
    const dados = String(item?.dados || '');
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dados);
    if (!match || dados.length > 1400000) throw new Error('Print inválido ou muito grande.');
    let bytes = '';
    try { bytes = atob(match[2]); } catch (_) { throw new Error('Print inválido.'); }
    const mime = match[1];
    const valido = mime === 'jpeg' ? bytes.startsWith('\xff\xd8\xff')
      : mime === 'png' ? bytes.startsWith('\x89PNG\r\n\x1a\n')
      : bytes.startsWith('RIFF') && bytes.slice(8,12) === 'WEBP';
    if (!valido || bytes.length < 16) throw new Error('O conteúdo do print não corresponde ao formato.');
    return {nome:String(item?.nome || 'Print').replace(/[<>\x00-\x1f]/g,'').slice(0,120),dados};
  });
}

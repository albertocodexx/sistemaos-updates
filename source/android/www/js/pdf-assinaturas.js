/* Ajusta somente a apresentação: as imagens originais assinadas não mudam. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SistemaOSPdfAssinaturas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function limites(pixels, largura, altura) {
    var x0 = largura, y0 = altura, x1 = -1, y1 = -1;
    for (var y = 0; y < altura; y++) for (var x = 0; x < largura; x++) {
      var i = (y * largura + x) * 4, alpha = pixels[i + 3] / 255;
      var escuroNoPapel = alpha * (255 - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]));
      if (escuroNoPapel < 18) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    if (x1 < x0) return null;
    var margem = Math.max(2, Math.ceil((y1 - y0 + 1) * .04));
    x0 = Math.max(0, x0 - margem); y0 = Math.max(0, y0 - margem);
    x1 = Math.min(largura - 1, x1 + margem); y1 = Math.min(altura - 1, y1 + margem);
    return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  }
  function preparar(doc) {
    var total = 0;
    // Não altera logos, fotos do aparelho nem imagens remotas.
    doc.querySelectorAll('.assinatura-espaco img,.assin-esp img,img.assinatura-imagem').forEach(function (img) {
      if (img.dataset.recorteAssinatura === 'ok' || !/^data:image\/(png|jpe?g|webp);base64,/i.test(img.src)) return;
      if (!img.complete || !img.naturalWidth || !img.naturalHeight) return;
      try {
        var escala = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
        var canvas = doc.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        var box = limites(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        if (!box) return;
        var recorte = doc.createElement('canvas');
        var larguraRecorte = Math.max(1, Math.round(box.width / escala));
        var alturaRecorte = Math.max(1, Math.round(box.height / escala));
        // Bounded output also limits memory on large, imported signatures.
        var fator = Math.min(1, 1600 / Math.max(larguraRecorte, alturaRecorte));
        recorte.width = Math.max(1, Math.round(larguraRecorte * fator));
        recorte.height = Math.max(1, Math.round(alturaRecorte * fator));
        recorte.getContext('2d').drawImage(img, box.x / escala, box.y / escala, box.width / escala, box.height / escala, 0, 0, recorte.width, recorte.height);
        img.src = recorte.toDataURL('image/png');
        img.dataset.recorteAssinatura = 'ok';
        img.style.height = '56px'; img.style.maxHeight = '56px';
        img.style.width = '100%'; img.style.maxWidth = '100%';
        img.style.objectFit = 'contain'; img.style.objectPosition = 'center bottom';
        var espaco = img.closest('.assinatura-espaco,.assin-esp');
        if (espaco) { espaco.style.minHeight = '56px'; espaco.style.height = '56px'; }
        total++;
      } catch (_) { /* Conservar a imagem válida original se o recorte falhar. */ }
    });
    return total;
  }
  return { preparar: preparar, limites: limites };
});

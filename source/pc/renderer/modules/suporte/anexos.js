(function (root) {
  'use strict';
  function montar(form, id) {
    var label = document.createElement('label'); label.className='suporte-anexos';label.textContent = 'Prints (opcional, até 3 imagens)';
    var input = document.createElement('input'); input.id=id; input.type='file'; input.multiple=true;
    input.accept='image/png,image/jpeg,image/webp';
    label.appendChild(input); form.insertBefore(label, form.lastElementChild);
  }
  async function ler(id) {
    var files=Array.from(document.getElementById(id)?.files || []);
    if(files.length>3) throw new Error('Selecione no máximo 3 prints.');
    var anexos=[];
    for (var file of files) {
      if(!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size>10*1024*1024) throw new Error('Use imagens PNG, JPG ou WebP de até 10 MB.');
      var url=URL.createObjectURL(file);
      try {
        var img=new Image(); await new Promise(function(resolve,reject){var prazo=setTimeout(()=>reject(new Error('Não foi possível ler este print.')),15000);img.onload=()=>{clearTimeout(prazo);resolve();};img.onerror=()=>{clearTimeout(prazo);reject(new Error('Não foi possível ler este print.'));};img.src=url;});
        var escala=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
        var canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(img.naturalWidth*escala));canvas.height=Math.max(1,Math.round(img.naturalHeight*escala));
        var ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
        var dados=canvas.toDataURL('image/jpeg',0.85);
        if(dados.length>1400000) throw new Error('Este print está muito grande. Recorte a área importante e tente novamente.');
        anexos.push({nome:file.name.slice(0,120),dados:dados});
      } finally {URL.revokeObjectURL(url);}
    }
    return anexos;
  }
  function mostrar(alvo, anexos) {
    (Array.isArray(anexos)?anexos:[]).slice(0,3).forEach(function(a){
      if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(a?.dados||'') || a.dados.length>1400000) return;
      var img=document.createElement('img');img.src=a.dados;img.alt=a.nome||'Print anexado';img.loading='lazy';img.style.cssText='display:block;max-width:100%;height:auto;margin-top:8px';alvo.appendChild(img);
    });
  }
  root.SistemaOSAnexosChamado={montar:montar,ler:ler,mostrar:mostrar};
})(typeof globalThis !== 'undefined'?globalThis:this);

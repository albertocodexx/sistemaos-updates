(function (root) {
  'use strict';

  var CATALOGO = {
    Apple: ['iPhone 5s','iPhone SE','iPhone 6','iPhone 6 Plus','iPhone 6s','iPhone 6s Plus','iPhone 7','iPhone 7 Plus','iPhone 8','iPhone 8 Plus','iPhone X','iPhone XR','iPhone XS','iPhone XS Max','iPhone 11','iPhone 11 Pro','iPhone 11 Pro Max','iPhone SE (2020)','iPhone 12','iPhone 12 mini','iPhone 12 Pro','iPhone 12 Pro Max','iPhone 13','iPhone 13 mini','iPhone 13 Pro','iPhone 13 Pro Max','iPhone SE (2022)','iPhone 14','iPhone 14 Plus','iPhone 14 Pro','iPhone 14 Pro Max','iPhone 15','iPhone 15 Plus','iPhone 15 Pro','iPhone 15 Pro Max','iPhone 16','iPhone 16e','iPhone 16 Plus','iPhone 16 Pro','iPhone 16 Pro Max'],
    Asus: ['Zenfone 2','Zenfone 3','Zenfone 4','Zenfone 5','Zenfone 6','Zenfone 7','Zenfone 8','Zenfone 8 Flip','Zenfone 9','Zenfone 10','Zenfone 11 Ultra','ROG Phone 3','ROG Phone 5','ROG Phone 5s','ROG Phone 6','ROG Phone 7','ROG Phone 8'],
    Google: ['Pixel 4','Pixel 4a','Pixel 5','Pixel 5a','Pixel 6','Pixel 6a','Pixel 6 Pro','Pixel 7','Pixel 7a','Pixel 7 Pro','Pixel 8','Pixel 8a','Pixel 8 Pro','Pixel 9','Pixel 9 Pro','Pixel 9 Pro XL','Pixel 9 Pro Fold'],
    Huawei: ['P20 Lite','P20 Pro','P30 Lite','P30 Pro','P40 Lite','P40 Pro','P50 Pro','Mate 20','Mate 20 Lite','Mate 30 Pro','Nova 5T','Nova 9','Nova 10','Y5','Y6','Y7','Y9 Prime'],
    Infinix: ['Hot 10','Hot 11','Hot 12','Hot 20','Hot 30','Hot 40','Hot 50','Note 10','Note 11','Note 12','Note 30','Note 40','Smart 6','Smart 7','Smart 8','Zero 20','Zero 30'],
    LG: ['G3','G4','G5','G6','G7 ThinQ','G8 ThinQ','K4','K8','K9','K10','K11','K12','K12+','K22','K40','K41S','K42','K50','K51S','K52','K61','K62','K71','Q6','Q7','Q60','Q70','Velvet','X Power','X Power 2','X Style'],
    Motorola: ['Moto G','Moto G 2ª geração','Moto G 3ª geração','Moto G4','Moto G4 Play','Moto G4 Plus','Moto G5','Moto G5 Plus','Moto G5S','Moto G5S Plus','Moto G6','Moto G6 Play','Moto G6 Plus','Moto G7','Moto G7 Play','Moto G7 Plus','Moto G7 Power','Moto G8','Moto G8 Play','Moto G8 Plus','Moto G8 Power','Moto G8 Power Lite','Moto G9','Moto G9 Play','Moto G9 Plus','Moto G9 Power','Moto G10','Moto G20','Moto G22','Moto G23','Moto G24','Moto G30','Moto G31','Moto G32','Moto G34','Moto G40 Fusion','Moto G41','Moto G42','Moto G50','Moto G51','Moto G52','Moto G53','Moto G54','Moto G55','Moto G60','Moto G60s','Moto G62','Moto G71','Moto G72','Moto G73','Moto G75','Moto G82','Moto G84','Moto G85','Moto E','Moto E2','Moto E4','Moto E4 Plus','Moto E5','Moto E5 Play','Moto E5 Plus','Moto E6 Play','Moto E6 Plus','Moto E7','Moto E7 Plus','Moto E13','Moto E20','Moto E22','Moto E22i','Moto E32','Moto E32s','Moto E40','Motorola One','Motorola One Action','Motorola One Fusion','Motorola One Fusion+','Motorola One Hyper','Motorola One Macro','Motorola One Vision','Edge 20','Edge 20 Lite','Edge 20 Pro','Edge 30','Edge 30 Fusion','Edge 30 Neo','Edge 30 Pro','Edge 40','Edge 40 Neo','Edge 50','Edge 50 Fusion','Edge 50 Neo','Edge 50 Pro','Edge 50 Ultra','Razr 40','Razr 40 Ultra','Razr 50','Razr 50 Ultra'],
    Nokia: ['C01 Plus','C20','C21 Plus','C30','C32','G10','G11','G20','G21','G22','G42','X20','X30'],
    Oppo: ['A15','A16','A17','A38','A53','A54','A57','A58','A77','A78','A79','Reno 6','Reno 7','Reno 8','Reno 10','Reno 11'],
    Realme: ['C11','C21','C25','C30','C33','C35','C51','C53','C55','C67','C75','7','8','9','10','11','12','GT 2','GT Neo 3','Narzo 50','Narzo 60'],
    Samsung: ['Galaxy J1','Galaxy J2','Galaxy J2 Prime','Galaxy J3','Galaxy J4','Galaxy J4+','Galaxy J5','Galaxy J5 Prime','Galaxy J6','Galaxy J6+','Galaxy J7','Galaxy J7 Prime','Galaxy J7 Pro','Galaxy J8','Galaxy A01','Galaxy A02','Galaxy A02s','Galaxy A03','Galaxy A03 Core','Galaxy A03s','Galaxy A04','Galaxy A04e','Galaxy A04s','Galaxy A05','Galaxy A05s','Galaxy A06','Galaxy A10','Galaxy A10s','Galaxy A11','Galaxy A12','Galaxy A13','Galaxy A14','Galaxy A15','Galaxy A16','Galaxy A20','Galaxy A20s','Galaxy A21s','Galaxy A22','Galaxy A23','Galaxy A24','Galaxy A25','Galaxy A30','Galaxy A30s','Galaxy A31','Galaxy A32','Galaxy A33','Galaxy A34','Galaxy A35','Galaxy A50','Galaxy A50s','Galaxy A51','Galaxy A52','Galaxy A52s','Galaxy A53','Galaxy A54','Galaxy A55','Galaxy A56','Galaxy A70','Galaxy A71','Galaxy A72','Galaxy A73','Galaxy M12','Galaxy M13','Galaxy M14','Galaxy M15','Galaxy M23','Galaxy M31','Galaxy M32','Galaxy M34','Galaxy M35','Galaxy M51','Galaxy M52','Galaxy M53','Galaxy M54','Galaxy Note 8','Galaxy Note 9','Galaxy Note 10','Galaxy Note 10+','Galaxy Note 20','Galaxy Note 20 Ultra','Galaxy S7','Galaxy S7 Edge','Galaxy S8','Galaxy S8+','Galaxy S9','Galaxy S9+','Galaxy S10e','Galaxy S10','Galaxy S10+','Galaxy S20','Galaxy S20+','Galaxy S20 Ultra','Galaxy S20 FE','Galaxy S21','Galaxy S21+','Galaxy S21 Ultra','Galaxy S21 FE','Galaxy S22','Galaxy S22+','Galaxy S22 Ultra','Galaxy S23','Galaxy S23+','Galaxy S23 Ultra','Galaxy S23 FE','Galaxy S24','Galaxy S24+','Galaxy S24 Ultra','Galaxy S24 FE','Galaxy S25','Galaxy S25+','Galaxy S25 Ultra','Galaxy Z Flip 3','Galaxy Z Flip 4','Galaxy Z Flip 5','Galaxy Z Flip 6','Galaxy Z Fold 3','Galaxy Z Fold 4','Galaxy Z Fold 5','Galaxy Z Fold 6'],
    TCL: ['20 SE','20 Pro 5G','30 SE','30 5G','40 SE','40 R 5G','50 SE','L7','L8','L9','L10','L10 Lite','L10+'],
    Tecno: ['Camon 18','Camon 19','Camon 20','Camon 30','Pova 4','Pova 5','Pova 6','Spark 8','Spark 9','Spark 10','Spark 20'],
    Xiaomi: ['Mi 8 Lite','Mi 9','Mi 9T','Mi 9 Lite','Mi 10','Mi 10T','Mi 11','Mi 11 Lite','Mi 11T','Mi 12','Mi 13','Poco C3','Poco C40','Poco C55','Poco C65','Poco M3','Poco M4 Pro','Poco M5','Poco M6','Poco X3','Poco X3 NFC','Poco X3 Pro','Poco X4 Pro','Poco X5','Poco X5 Pro','Poco X6','Poco X6 Pro','Poco F3','Poco F4','Poco F5','Redmi 7','Redmi 8','Redmi 8A','Redmi 9','Redmi 9A','Redmi 9C','Redmi 10','Redmi 10C','Redmi 12','Redmi 12C','Redmi 13','Redmi 13C','Redmi 14C','Redmi Note 7','Redmi Note 8','Redmi Note 8 Pro','Redmi Note 9','Redmi Note 9S','Redmi Note 10','Redmi Note 10 Pro','Redmi Note 11','Redmi Note 11 Pro','Redmi Note 12','Redmi Note 12 Pro','Redmi Note 13','Redmi Note 13 Pro','Redmi Note 14','Redmi Note 14 Pro']
  };

  function ordenar(lista) { return Array.from(new Set(lista || [])).sort(function (a, b) { return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }); }); }
  function marcaCanonica(valor) {
    var alvo = String(valor || '').trim().toLocaleLowerCase('pt-BR');
    return Object.keys(CATALOGO).find(function (marca) { return marca.toLocaleLowerCase('pt-BR') === alvo; }) || '';
  }
  function normalizar(valor) {
    return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  }
  function primeiroCompativel(valor, opcoes) {
    var termo = String(valor || '').trim().toLocaleLowerCase('pt-BR');
    if (!termo) return '';
    return ordenar(opcoes).find(function (opcao) { return opcao.toLocaleLowerCase('pt-BR').indexOf(termo) === 0; }) || '';
  }
  function ligar(marcaId, modeloId, sufixo) {
    var marca = document.getElementById(marcaId);
    var modelo = document.getElementById(modeloId);
    if (!marca || !modelo) return;
    var marcas = ordenar(Object.keys(CATALOGO));
    var todosModelos = ordenar(Object.keys(CATALOGO).reduce(function (itens, chave) { return itens.concat(CATALOGO[chave]); }, []));
    marca.removeAttribute('list');
    modelo.removeAttribute('list');

    function instalarAutocomplete(campo, obterOpcoes, aoEscolher) {
      var painel = document.createElement('div');
      var indiceAtivo = -1;
      painel.className = 'catalogo-sugestoes';
      painel.hidden = true;
      campo.parentElement.classList.add('campo-com-sugestoes');
      campo.insertAdjacentElement('afterend', painel);

      function fechar() {
        painel.hidden = true;
        painel.replaceChildren();
        indiceAtivo = -1;
        campo.setAttribute('aria-expanded', 'false');
      }

      function escolher(valor) {
        campo.value = valor;
        campo.dispatchEvent(new Event('change', { bubbles: true }));
        fechar();
        if (aoEscolher) aoEscolher(valor);
      }

      function renderizar() {
        var termo = normalizar(campo.value.trim());
        if (!termo) { fechar(); return; }
        var opcoes = ordenar(obterOpcoes()).filter(function (opcao) {
          return normalizar(opcao).indexOf(termo) !== -1;
        }).slice(0, 8);
        painel.replaceChildren();
        if (!opcoes.length) { fechar(); return; }
        opcoes.forEach(function (opcao, indice) {
          var botao = document.createElement('button');
          botao.type = 'button';
          botao.textContent = opcao;
          botao.dataset.indice = String(indice);
          botao.addEventListener('pointerdown', function (evento) {
            evento.preventDefault();
            escolher(opcao);
          });
          painel.appendChild(botao);
        });
        painel.hidden = false;
        campo.setAttribute('aria-expanded', 'true');
      }

      campo.setAttribute('autocomplete', 'off');
      campo.setAttribute('aria-autocomplete', 'list');
      campo.setAttribute('aria-expanded', 'false');
      campo.addEventListener('input', renderizar);
      campo.addEventListener('focus', renderizar);
      campo.addEventListener('keydown', function (evento) {
        var botoes = Array.from(painel.querySelectorAll('button'));
        if (evento.key === 'Escape') { fechar(); return; }
        if (evento.key === 'Tab') { fechar(); return; }
        if (evento.key !== 'ArrowDown' && evento.key !== 'ArrowUp' && evento.key !== 'Enter') return;
        if (painel.hidden || !botoes.length) return;
        evento.preventDefault();
        if (evento.key === 'Enter' && indiceAtivo >= 0) { escolher(botoes[indiceAtivo].textContent); return; }
        indiceAtivo = evento.key === 'ArrowUp'
          ? Math.max(0, indiceAtivo - 1)
          : Math.min(botoes.length - 1, indiceAtivo + 1);
        botoes.forEach(function (botao, indice) { botao.classList.toggle('ativo', indice === indiceAtivo); });
        botoes[indiceAtivo].scrollIntoView({ block: 'nearest' });
      });
      document.addEventListener('pointerdown', function (evento) {
        if (evento.target !== campo && !painel.contains(evento.target)) fechar();
      });
      return { atualizar: renderizar, fechar: fechar };
    }

    var autocompleteModelo = instalarAutocomplete(modelo, function () {
      var canonica = marcaCanonica(marca.value);
      return canonica ? CATALOGO[canonica] : todosModelos;
    });
    instalarAutocomplete(marca, function () { return marcas; }, function () {
      autocompleteModelo.fechar();
    });
    marca.addEventListener('input', function () { autocompleteModelo.fechar(); });
  }
  ligar('aparelho-marca', 'aparelho-modelo', 'os');
  ligar('compra-aparelho-marca', 'compra-aparelho-modelo', 'compra');
  root.SistemaOSCatalogoAparelhos = Object.freeze({ catalogo: CATALOGO, ligar: ligar });
})(window);

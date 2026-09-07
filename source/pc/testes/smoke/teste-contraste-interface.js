'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');
const html = ler('renderer', 'index.html');
const estilo = ler('renderer', 'style.css');
const tema = ler('renderer', 'monochrome-theme.css');
const runtime = ler('renderer', 'core', 'legacy-runtime.js');

function rgb(hex) {
  const valor = String(hex).replace('#', '');
  return [0, 2, 4].map((indice) => parseInt(valor.slice(indice, indice + 2), 16));
}

function luminancia(hex) {
  const canais = rgb(hex).map((canal) => {
    const normalizado = canal / 255;
    return normalizado <= 0.03928
      ? normalizado / 12.92
      : ((normalizado + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * canais[0]) + (0.7152 * canais[1]) + (0.0722 * canais[2]);
}

function contraste(a, b) {
  const maior = Math.max(luminancia(a), luminancia(b));
  const menor = Math.min(luminancia(a), luminancia(b));
  return (maior + 0.05) / (menor + 0.05);
}

for (const [nome, frente, fundo] of [
  ['ação no tema escuro', '#050505', '#f7f7f5'],
  ['ação no tema claro', '#ffffff', '#090909'],
  ['placeholder no tema escuro', '#969691', '#171717'],
  ['placeholder no tema claro', '#686862', '#fafaf8']
]) {
  assert(contraste(frente, fundo) >= 4.5, `${nome} deve atingir contraste WCAG AA`);
}

assert(html.includes('id="iaChatPainel" class="escondido" role="dialog"'), 'painel da IA deve ser identificado como diálogo');
assert(html.includes('id="iaChatMensagens" role="log" aria-live="polite"'), 'mensagens da IA devem ser anunciadas sem interromper o usuário');
assert(html.includes('id="iaChatEnviar" title="Enviar mensagem" aria-label="Enviar mensagem"><span>Enviar</span>'), 'ação de envio deve ter texto visível e nome acessível');
assert(html.includes('aria-controls="iaChatPainel" aria-expanded="false"'), 'botão flutuante deve expor o estado do painel');

assert(estilo.includes('.iaChatMsg-usuario') && estilo.includes('color: var(--ds-texto-invert);'), 'mensagem do usuário deve usar texto inverso');
assert(estilo.includes('#iaChatEnviar') && estilo.includes('min-width: 88px;'), 'botão de enviar deve ser legível e possuir alvo confortável');
assert(tema.includes('/* Contrato global de contraste.'), 'a última camada CSS deve proteger o contraste global');
assert(tema.includes('.iaChatMsg-erro') && tema.includes('color: var(--ds-erro-texto) !important;'), 'mensagens de erro devem ter contraste próprio');
assert(tema.includes('input::placeholder') && tema.includes('color: var(--ds-texto-desab) !important;'), 'placeholders devem permanecer legíveis');

assert(runtime.includes("painel.setAttribute('aria-hidden', 'false')"), 'abrir a IA deve atualizar seu estado acessível');
assert(runtime.includes("botao.setAttribute('aria-expanded', 'true')"), 'botão da IA deve informar quando está expandido');
assert(runtime.includes("enviarBtn.setAttribute('aria-busy', 'true')"), 'envio deve informar seu estado ocupado');

const padraoInseguro = /background\s*:\s*var\(--(?:cor-botoes|cor-principal|cor-links|primario)\)[^}]{0,180}color\s*:\s*(?:#fff(?:fff)?|white)\b/gi;
assert(!padraoInseguro.test(estilo), 'não pode existir ação variável com texto branco fixo');

console.log('OK: contraste AA, mensagens e controles da IA estão protegidos nos temas claro e escuro.');

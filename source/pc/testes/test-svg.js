const svg = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;flex:none;"><path d="M20 6 9 17l-5-5"/></svg>`;
console.log('SVG length:', svg.length);
console.log('Matches regex:', /<svg[\s\S]*?<\/svg>/g.test(svg));

const msg = svg + ' Garantia enviada pelo WhatsApp!';
const partes = msg.split(/(<svg[\s\S]*?<\/svg>)/g);
console.log('Parts:', partes.length);
partes.forEach((p, i) => {
  console.log('Part', i, ':', p.substring(0, 80) + (p.length > 80 ? '...' : ''));
});

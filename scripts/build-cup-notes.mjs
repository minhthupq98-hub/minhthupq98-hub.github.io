import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const assetVersion = 'bill-close-20261118';
const original = readFileSync(resolve(root, 'assets/index-BpABOaN7.js'), 'utf8');
const sha = createHash('sha1').update(`blob ${Buffer.byteLength(original)}\0`).update(original).digest('hex');
if (sha !== '28e83faab93c36b034d6bcfbcce2803cd0128412') {
  throw new Error(`The staff app changed (${sha}); review integration anchors before rebuilding.`);
}
let bundle = original;
function replaceOnce(before, after) {
  if (bundle.split(before).length !== 2) throw new Error(`Integration anchor is not unique: ${before.slice(0, 100)}`);
  bundle = bundle.replace(before, after);
}

replaceOnce('function dc(){', 'const {CupEditor:TkCupEditor,BillDialog:TkBillDialog,OrderPanel:TkOrderPanel}=tkCreateCupUI(Z,M);function dc(){');
replaceOnce('Z(`aside`,{className:`order-panel ${Xe?`mobile-expanded`:`mobile-collapsed`}`',
  'Z(TkOrderPanel,{className:`order-panel ${Xe?`mobile-expanded`:`mobile-collapsed`}`');
replaceOnce('Ht=e=>s(t=>t.find(t=>t.id===e.id)?t.map(t=>t.id===e.id?{...t,qty:t.qty+1}:t):[...t,{...e,qty:1}])',
  'Ht=e=>s(t=>tkAddProduct(t,e))');
replaceOnce('s(e.items.map(e=>({...e})))', 's(tkNormalizeLines(e.items))');
replaceOnce('children:`Ghi chú`}),Z(`input`,{value:ge', 'children:`Ghi chú chung`}),Z(`input`,{value:ge');
const cartStart = 'o.map(e=>Z(`div`,{className:`cart-line`';
const cartEnd = '},e.id))';
const start = bundle.indexOf(cartStart);
const end = bundle.indexOf(cartEnd, start) + cartEnd.length;
if (start < 0 || end < start) throw new Error('Missing cart renderer');
replaceOnce(bundle.slice(start, end), 'Z(TkCupEditor,{items:o,onChange:s,unitPrice:yt,money:Q})');
replaceOnce('Z(`div`,{className:`bill-dialog`,onClick:e=>e.stopPropagation(),children:[',
  'Z(TkBillDialog,{order:E,onClose:()=>he(null),children:[');
replaceOnce('[e.ice,e.sweetness,e.extras?.join(`, `),e.lineNote].filter(Boolean).join(` · `)||Q(n)',
  'tkItemSummary(e)||Q(n)');
const queue = 'e.items.map(e=>`${e.qty}× ${e.name}${[e.ice,e.sweetness,e.extras?.join(`, `)].filter(Boolean).length?` (${[e.ice,e.sweetness,e.extras?.join(`, `)].filter(Boolean).join(` · `)})`:``}`).join(` · `)';
replaceOnce(queue, 'e.items.map(e=>`${e.qty}× ${e.name}${tkItemSummary(e)?` (${tkItemSummary(e)})`:``}`).join(` · `)');

bundle = `import {createCupUI as tkCreateCupUI,addProduct as tkAddProduct,normalizeLines as tkNormalizeLines,itemSummary as tkItemSummary} from "./order-cups-v1.js?v=${assetVersion}";\n` + bundle.replaceAll('\u2014', '-');
writeFileSync(resolve(root, 'assets/staff-cup-notes-v1.js'), bundle);
const indexPath = resolve(root, 'index.html');
let html = readFileSync(indexPath, 'utf8');
html = html.replace('/assets/index-BpABOaN7.js', '/assets/staff-cup-notes-v1.js');
if (!html.includes('/assets/order-cups-v1.css')) {
  const anchor = 'document.head.appendChild(uxStylesheet);';
  if (!html.includes(anchor)) throw new Error('Missing staff stylesheet anchor');
  html = html.replace(anchor, `${anchor}\n          var cupStylesheet = document.createElement("link");\n          cupStylesheet.rel = "stylesheet";\n          cupStylesheet.href = "/assets/order-cups-v1.css";\n          document.head.appendChild(cupStylesheet);`);
}
html = html.replace(/\/assets\/order-cups-v1\.css(?:\?v=[\w-]+)?/g, `/assets/order-cups-v1.css?v=${assetVersion}`);
html = html.replace(/\/assets\/staff-cup-notes-v1\.js(?:\?v=[\w-]+)?/g, `/assets/staff-cup-notes-v1.js?v=${assetVersion}`);
writeFileSync(indexPath, html);
console.log('Built per-cup notes for staff; customer redirect and existing Operations files retained.');

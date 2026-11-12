import { readFileSync } from 'node:fs';
const buf = readFileSync('scripts/shots/report.pdf');
const head = buf.slice(0, 8).toString();
console.log('PDF header:', head);
console.log('size:', buf.length, 'bytes');
console.log('pages:', (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length);
// 图片 XObject 数量
console.log('image XObjects:', (buf.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length);
// 文本流里的关键英文标题(压缩流可能匹配不到,只做尽力校验)
const raw = buf.toString('latin1');
for (const kw of ['OLS', 'PDF']) {
  console.log(`contains ${kw}:`, raw.includes(kw));
}

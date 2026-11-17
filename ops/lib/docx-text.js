// Đọc chữ trong file .docx ngay trên trình duyệt, không cần thư viện ngoài.
// .docx là file zip; chỉ cần word/document.xml. Giải nén bằng DecompressionStream
// (Safari 16.4+, Chrome 80+, Node 18+). Kết quả là danh sách dòng phẳng:
// đoạn văn là một dòng, mỗi hàng bảng là các ô nối bằng " | ", đoạn trong ô nối bằng "\n".

export class DocxError extends Error {}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Đọc một entry trong zip theo central directory (chuẩn PKZIP, nén 0 hoặc 8).
export async function readZipEntry(buffer, name) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new DocxError('File không phải .docx hợp lệ (không đọc được zip)');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const entry = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    if (entry === name) {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new DocxError(`Kiểu nén ${method} chưa hỗ trợ`);
    }
    p += 46 + nlen + elen + clen;
  }
  return null;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
  : ENT[e] ?? m));

// document.xml -> dòng phẳng. Bảng lồng nhau: hàng của bảng trong cùng được in riêng.
export function documentXmlToLines(xml) {
  const lines = [];
  const rows = []; // ngăn xếp hàng đang mở: { cells: [], cell: null }
  let para = null; // đoạn đang mở ngoài bảng
  const re = /<w:(tbl|tr|tc|p|t|tab|br|cr)\b([^>]*?)(\/?)>|<\/w:(tbl|tr|tc|p|t)>/g;
  let m; let inText = false; let last = 0;
  const push = (s) => {
    const row = rows.at(-1);
    if (row?.cell) row.cell.cur += s; else if (para != null) para += s;
  };
  while ((m = re.exec(xml))) {
    if (inText) push(unxml(xml.slice(last, m.index)));
    inText = false;
    const [, open, , selfClose, close] = m;
    if (open === 't' && !selfClose) { inText = true; last = re.lastIndex; continue; }
    if (open === 'tab') push('\t');
    else if (open === 'br' || open === 'cr') push('\n');
    else if (open === 'tr' && !selfClose) rows.push({ cells: [], cell: null });
    else if (open === 'tc' && !selfClose) { const r = rows.at(-1); if (r) r.cell = { paras: [], cur: '' }; }
    else if (open === 'p' && !selfClose) { const r = rows.at(-1); if (r?.cell) r.cell.cur = ''; else para = ''; }
    else if (close === 'p') {
      const r = rows.at(-1);
      if (r?.cell) { if (r.cell.cur.trim()) r.cell.paras.push(r.cell.cur.trim()); r.cell.cur = ''; } else if (para != null) { if (para.trim()) lines.push(para.trim()); para = null; }
    } else if (close === 'tc') { const r = rows.at(-1); if (r?.cell) { r.cells.push(r.cell.paras.join('\n')); r.cell = null; } }
    else if (close === 'tr') {
      const r = rows.pop();
      const text = r.cells.filter(Boolean).join(' | ');
      if (text) lines.push(text);
    } else if (close === 'tbl') lines.push('---');
  }
  return lines;
}

export async function docxToLines(buffer) {
  const xml = await readZipEntry(buffer, 'word/document.xml');
  if (!xml) throw new DocxError('Không thấy nội dung word/document.xml trong file');
  return documentXmlToLines(new TextDecoder().decode(xml));
}

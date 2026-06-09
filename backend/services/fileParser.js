const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const PDFParser = require('pdf2json');

const CMAPS_DIR = path.join(__dirname, '../../node_modules/pdfjs-dist/cmaps');
const STANDARD_FONTS_DIR = path.join(__dirname, '../../node_modules/pdfjs-dist/standard_fonts');

let pdfjsLib = null;
async function getPdfLib() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist');
  }
  return pdfjsLib;
}

class NodeCMapReaderFactory {
  async fetch({ name }) {
    const filePath = path.join(CMAPS_DIR, name + '.bcmap');
    try {
      const data = fs.readFileSync(filePath);
      return { cMapData: new Uint8Array(data), compressionType: 1 };
    } catch {
      return { cMapData: new Uint8Array(), compressionType: 0 };
    }
  }
}

class NodeStandardFontDataFactory {
  async fetch({ filename }) {
    const filePath = path.join(STANDARD_FONTS_DIR, filename);
    try {
      const data = fs.readFileSync(filePath);
      return new Uint8Array(data);
    } catch {
      return new Uint8Array();
    }
  }
}

function isGarbled(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (!lines.length) return true;
  let garbled = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    // Detect hash-like gibberish lines (e.g. "db356aae0d2cc62c1HB429-_E1FYxIi-WPieWOGnnfDZMhFl3w~~")
    if (/^[a-fA-F0-9]{8,}[a-zA-Z0-9_+/=~\-]{10,}$/.test(trimmed)) {
      garbled++;
      continue;
    }
    const cjk = (trimmed.match(/[\u4e00-\u9fff]/g) || []).length;
    const ascii = (trimmed.match(/[a-zA-Z]/g) || []).length;
    const total = trimmed.length;
    if (total > 5 && (cjk + ascii) / total < 0.3) garbled++;
  }
  return garbled / lines.length > 0.4;
}

function extractWithPdf2Json(filePath) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser();
    parser.on('pdfParser_dataReady', (pdfData) => {
      const lines = [];
      for (const page of pdfData.Pages) {
        const pageLines = [];
        const sorted = [...page.Texts].sort((a, b) => a.y - b.y || a.x - b.x);
        let lastY = null;
        let currentLine = '';
        for (const t of sorted) {
          const y = Math.round(t.y * 10);
          if (lastY !== null && Math.abs(y - lastY) > 3) {
            pageLines.push(currentLine.trim());
            currentLine = '';
          }
          const decoded = t.R.map(r => {
            try { return decodeURIComponent(r.T); } catch { return r.T; }
          }).join('');
          currentLine += decoded;
          lastY = y;
        }
        if (currentLine.trim()) pageLines.push(currentLine.trim());
        lines.push(...pageLines);
      }
      resolve(lines.join('\n'));
    });
    parser.on('pdfParser_dataError', (err) => reject(err.parserError || err));
    parser.loadPDF(filePath);
  });
}

async function extractPdfText(filePath) {
  const lib = await getPdfLib();
  const data = new Uint8Array(fs.readFileSync(filePath));

  // Try 1: pdfjs-dist with CMap support
  let text = '';
  try {
    const doc = await lib.getDocument({
      data,
      CMapReaderFactory: NodeCMapReaderFactory,
      StandardFontDataFactory: NodeStandardFontDataFactory,
      useSystemFonts: false,
    }).promise;
    text = await extractTextFromDoc(doc);
  } catch {}

  if (!isGarbled(text)) return text;

  // Try 2: pdfjs-dist with disableFontFace
  try {
    const doc2 = await lib.getDocument({
      data,
      CMapReaderFactory: NodeCMapReaderFactory,
      StandardFontDataFactory: NodeStandardFontDataFactory,
      useSystemFonts: true,
      disableFontFace: true,
    }).promise;
    const text2 = await extractTextFromDoc(doc2);
    if (!isGarbled(text2)) return text2;
  } catch {}

  // Try 3: pdf2json (completely different extraction method)
  try {
    const text3 = await extractWithPdf2Json(filePath);
    if (!isGarbled(text3)) return text3;
  } catch {}

  return text;
}

async function extractTextFromDoc(doc) {
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines = [];
    let lastY = null;
    let currentLine = '';
    for (const item of content.items) {
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 2) {
        lines.push(currentLine.trim());
        currentLine = '';
      }
      currentLine += item.str;
      lastY = item.transform[5];
    }
    if (currentLine.trim()) lines.push(currentLine.trim());
    text += lines.join('\n') + '\n';
  }
  return text;
}

async function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    return extractPdfText(filePath);
  }

  if (ext === '.docx' || ext === '.doc') {
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (ext === '.txt') {
    return fs.readFileSync(filePath, 'utf-8');
  }

  throw new Error(`不支持的文件格式: ${ext}`);
}

function desensitize(text) {
  let result = text
    // Remove garbled/obfuscated lines (random alphanumeric strings with special chars like ~~)
    .replace(/^[\w+/=~]{20,}$/gm, '')
    // Remove lines that are mostly garbled Unicode (non-CJK, non-ASCII-printable)
    .replace(/^[^\x20-\x7E\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]{5,}$/gm, '')
    // Phone with label
    .replace(/(?:手机|电话|联系方式|Tel|Phone|Mobile)[：:]\s*\d[\d\-\s]{8,15}/gi, '')
    // Standalone phone numbers
    .replace(/1[3-9]\d[\s\-]?\d{4}[\s\-]?\d{4}/g, '')
    .replace(/\d{3}[\s\-]\d{4}[\s\-]\d{4}/g, '')
    // Email with label
    .replace(/(?:邮箱|email|e-mail)[：:]\s*[\w.\-]+@[\w.\-]+\.\w+/gi, '')
    // Standalone emails
    .replace(/[\w.\-]+@[\w.\-]+\.\w{2,}/gi, '')
    // Clean up leftover separators like " | " or " |  | "
    .replace(/\s*\|\s*\|\s*/g, ' | ')
    .replace(/\s*\|\s*$/gm, '')
    .replace(/^\s*\|\s*/gm, '')
    // Clean up empty lines
    .replace(/\n[ \t]*\n/g, '\n');
  return result.trim();
}

module.exports = { parseFile, desensitize, isGarbled };

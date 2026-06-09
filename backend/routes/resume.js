const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseFile, desensitize } = require('../services/fileParser');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '../uploads/resumes');
const DATA_FILE = path.join(__dirname, '../data/resumes.json');
const JDS_FILE = path.join(__dirname, '../data/jds.json');

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({ storage });

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function matchJdForResume(resumeName, jds) {
  const match = resumeName.match(/【(.+?)[_\s]/);
  if (!match) return null;
  const jobKeyword = match[1];
  const scored = jds.map(jd => {
    const title = jd.jobTitle || jd.originalName.replace(/\.\w+$/, '');
    if (title === jobKeyword) return { jd, score: 100 };
    if (title.includes(jobKeyword) || jobKeyword.includes(title)) return { jd, score: 80 };
    let common = 0;
    for (const ch of jobKeyword) { if (title.includes(ch)) common++; }
    return { jd, score: Math.round(common / jobKeyword.length * 60) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 40 ? scored[0].jd : null;
}

router.get('/', (req, res) => {
  res.json(readData());
});

router.post('/match-jds', (req, res) => {
  const jds = JSON.parse(fs.readFileSync(JDS_FILE, 'utf-8'));
  const { resumeIds } = req.body;
  const resumes = readData();
  const selected = resumes.filter(r => resumeIds?.includes(r.id));
  const result = selected.map(r => ({
    resumeId: r.id,
    jdId: matchJdForResume(r.originalName, jds)?.id || null,
  }));
  res.json(result);
});

router.post('/upload', upload.array('files'), async (req, res) => {
  const resumes = readData();
  const jds = JSON.parse(fs.readFileSync(JDS_FILE, 'utf-8'));
  const results = [];

  for (const file of req.files) {
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf-8');
    const matchedJd = matchJdForResume(originalName, jds);

    let candidateName = originalName;
    let phone = '';
    let email = '';
    try {
      const rawText = await parseFile(file.path);
      // Extract contact info before desensitization
      const phoneMatch = rawText.match(/1[3-9]\d[\s\-]?\d{4}[\s\-]?\d{4}/);
      if (phoneMatch) phone = phoneMatch[0].replace(/\s|\-/g, '');
      const emailMatch = rawText.match(/[\w.\-]+@[\w.\-]+\.\w{2,}/);
      if (emailMatch) email = emailMatch[0];
      const safeText = desensitize(rawText);
      const nameMatch = originalName.match(/】(.+?)(?:\s+\d)/);
      if (nameMatch) candidateName = nameMatch[1];
      const txtPath = file.path.replace(/\.\w+$/, '.desensitized.txt');
      fs.writeFileSync(txtPath, safeText, 'utf-8');
    } catch {}

    const record = {
      id: uuidv4(),
      originalName,
      candidateName,
      phone,
      email,
      matchedJdId: matchedJd ? matchedJd.id : null,
      matchedJdTitle: matchedJd ? (matchedJd.jobTitle || matchedJd.originalName) : null,
      filePath: file.path,
      size: fs.existsSync(file.path) ? fs.statSync(file.path).size : 0,
      uploadedAt: new Date().toISOString(),
    };
    resumes.push(record);
    results.push(record);
  }

  writeData(resumes);
  res.json({ success: true, files: results });
});

router.delete('/:id', (req, res) => {
  const resumes = readData();
  const idx = resumes.findIndex(r => r.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '未找到' });

  const [removed] = resumes.splice(idx, 1);
  if (fs.existsSync(removed.filePath)) fs.unlinkSync(removed.filePath);
  const txtPath = removed.filePath.replace(/\.\w+$/, '.desensitized.txt');
  if (fs.existsSync(txtPath)) fs.unlinkSync(txtPath);
  writeData(resumes);
  res.json({ success: true });
});

module.exports = router;

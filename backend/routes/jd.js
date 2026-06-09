const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { parseFile } = require('../services/fileParser');
const { extractJobTitle, extractJdKeywords } = require('../services/claudeService');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '../uploads/jds');
const DATA_FILE = path.join(__dirname, '../data/jds.json');

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

router.get('/', (req, res) => {
  res.json(readData());
});

router.post('/upload', upload.array('files'), async (req, res) => {
  const jds = readData();
  const results = [];

  for (const file of req.files) {
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf-8');
    const existing = jds.findIndex(j => j.originalName === originalName);
    let jobTitle = '';
    let keywords = { skills: [], experience: '' };
    try {
      const jdText = await parseFile(file.path);
      jobTitle = await extractJobTitle(jdText);
      keywords = await extractJdKeywords(jdText);
    } catch {}
    const record = {
      id: existing >= 0 ? jds[existing].id : uuidv4(),
      originalName: originalName,
      jobTitle,
      skills: keywords.skills,
      experience: keywords.experience,
      filePath: file.path,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      replaced: existing >= 0,
    };
    if (existing >= 0) {
      jds[existing] = record;
    } else {
      jds.push(record);
    }
    results.push(record);
  }

  writeData(jds);
  res.json({ success: true, files: results });
});

router.post('/text', async (req, res) => {
  const { jobTitle, jdText, force } = req.body;
  if (!jobTitle || !jdText) {
    return res.status(400).json({ error: '岗位名称和JD内容不能为空' });
  }

  const jds = readData();
  const originalName = `${jobTitle}.txt`;
  const existing = jds.findIndex(j => j.originalName === originalName);

  if (existing >= 0 && !force) {
    return res.status(409).json({ error: 'DUPLICATE_JD', jobTitle });
  }

  const id = existing >= 0 ? jds[existing].id : uuidv4();
  const fileName = `${id}.txt`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  fs.writeFileSync(filePath, jdText, 'utf-8');

  let keywords = { skills: [], experience: '' };
  try {
    keywords = await extractJdKeywords(jdText);
  } catch {}

  const record = {
    id,
    originalName,
    jobTitle,
    skills: keywords.skills,
    experience: keywords.experience,
    filePath,
    size: Buffer.byteLength(jdText, 'utf-8'),
    uploadedAt: new Date().toISOString(),
    replaced: existing >= 0,
  };

  if (existing >= 0) {
    if (fs.existsSync(jds[existing].filePath) && jds[existing].filePath !== filePath) {
      fs.unlinkSync(jds[existing].filePath);
    }
    jds[existing] = record;
  } else {
    jds.push(record);
  }

  writeData(jds);
  res.json({ success: true, file: record });
});

router.delete('/batch', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '请提供要删除的ID列表' });
  }
  const jds = readData();
  const remaining = jds.filter(j => !ids.includes(j.id));
  const removed = jds.filter(j => ids.includes(j.id));
  removed.forEach(j => {
    if (fs.existsSync(j.filePath)) fs.unlinkSync(j.filePath);
  });
  writeData(remaining);
  res.json({ success: true, deleted: removed.length });
});

router.delete('/:id', (req, res) => {
  const jds = readData();
  const idx = jds.findIndex(j => j.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '未找到' });

  const [removed] = jds.splice(idx, 1);
  if (fs.existsSync(removed.filePath)) fs.unlinkSync(removed.filePath);
  writeData(jds);
  res.json({ success: true });
});

router.get('/:id/content', async (req, res) => {
  const jds = readData();
  const jd = jds.find(j => j.id === req.params.id);
  if (!jd) return res.status(404).json({ error: '未找到' });
  if (!fs.existsSync(jd.filePath)) return res.status(404).json({ error: '文件不存在' });

  try {
    const text = await parseFile(jd.filePath);

    // Lazy extract keywords for old JDs that don't have them
    if (!jd.skills || !jd.skills.length) {
      let keywords = { skills: [], experience: '' };
      try { keywords = await extractJdKeywords(text); } catch {}
      jd.skills = keywords.skills;
      jd.experience = keywords.experience;
      writeData(jds);
    }

    res.json({
      jobTitle: jd.jobTitle,
      originalName: jd.originalName,
      content: text,
      skills: jd.skills || [],
      experience: jd.experience || '',
    });
  } catch (e) {
    res.status(500).json({ error: '文件解析失败' });
  }
});

module.exports = router;

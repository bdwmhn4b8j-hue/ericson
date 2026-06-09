const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { parseFile, isGarbled, desensitize } = require('../services/fileParser');
const ExcelJS = require('exceljs');
const { analyzeResume, generateInterviewQuestions } = require('../services/claudeService');

const router = express.Router();
const JDS_FILE = path.join(__dirname, '../data/jds.json');
const RESUMES_FILE = path.join(__dirname, '../data/resumes.json');
const REPORTS_FILE = path.join(__dirname, '../data/reports.json');

function readJSON(f) { return JSON.parse(fs.readFileSync(f, 'utf-8')); }
function writeJSON(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

// Simple promise-based queue to serialize access to reports.json
const reportQueue = [];
function withReportLock(fn) {
  return new Promise((resolve, reject) => {
    reportQueue.push({ fn, resolve, reject });
    if (reportQueue.length === 1) drainReportQueue();
  });
}
async function drainReportQueue() {
  while (reportQueue.length) {
    const { fn, resolve, reject } = reportQueue[0];
    try { resolve(await fn()); } catch (e) { reject(e); }
    reportQueue.shift();
  }
}

function updateReport(report) {
  return withReportLock(() => {
    const reports = readJSON(REPORTS_FILE);
    const idx = reports.findIndex(r => r.id === report.id);
    if (idx >= 0) reports[idx] = report;
    writeJSON(REPORTS_FILE, reports);
  });
}

router.post('/analyze', async (req, res) => {
  const { jdId, resumeIds, autoMatch } = req.body;
  if (!resumeIds?.length) {
    return res.status(400).json({ error: '请提供 resumeIds' });
  }

  const jds = readJSON(JDS_FILE);
  const allResumes = readJSON(RESUMES_FILE);
  const selected = allResumes.filter(r => resumeIds.includes(r.id));
  if (!selected.length) return res.status(404).json({ error: '未找到简历' });

  let reportIds = [];

  if (autoMatch) {
    const groups = new Map();
    for (const resume of selected) {
      const matchedJd = resume.matchedJdId ? jds.find(j => j.id === resume.matchedJdId) : null;
      const key = matchedJd ? matchedJd.id : '__unmatched__';
      if (!groups.has(key)) groups.set(key, { jd: matchedJd, resumes: [] });
      groups.get(key).resumes.push(resume);
    }
    const unmatched = groups.get('__unmatched__');
    if (unmatched) {
      groups.delete('__unmatched__');
    }

    for (const [jdIdKey, group] of groups) {
      if (!group.jd) continue;
      const rid = await createReport(group.jd, group.resumes);
      reportIds.push(rid);
    }

    if (unmatched) {
      return res.status(400).json({
        error: '部分简历无法自动匹配岗位',
        unmatched: unmatched.resumes.map(r => r.originalName),
        reportIds,
      });
    }
  } else {
    if (!jdId) return res.status(400).json({ error: '请提供 jdId' });
    const jd = jds.find(j => j.id === jdId);
    if (!jd) return res.status(404).json({ error: '未找到该 JD' });
    const rid = await createReport(jd, selected);
    reportIds.push(rid);
  }

  res.json({ reportIds });
});

async function createReport(jd, selectedResumes) {
  const reportId = uuidv4();
  const report = {
    id: reportId,
    jdId: jd.id,
    jdName: jd.originalName,
    jdJobTitle: jd.jobTitle || '',
    createdAt: new Date().toISOString(),
    status: 'running',
    total: selectedResumes.length,
    completed: 0,
    candidates: [],
  };

  const reports = readJSON(REPORTS_FILE);
  reports.push(report);
  writeJSON(REPORTS_FILE, reports);

  (async () => {
    let jdText;
    try {
      jdText = await parseFile(jd.filePath);
    } catch (e) {
      report.status = 'error';
      report.error = `无法解析 JD 文件: ${e.message}`;
      updateReport(report);
      return;
    }

    for (const resume of selectedResumes) {
      try {
        let resumeText = '';
        const ext = path.extname(resume.filePath).toLowerCase();
        const txtPath = resume.filePath.replace(/\.\w+$/, '.desensitized.txt');

        // Try desensitized txt first if available
        if (fs.existsSync(txtPath)) {
          resumeText = fs.readFileSync(txtPath, 'utf-8');
        }

        // If desensitized text is garbled/empty, try re-parsing the original file
        if (isGarbled(resumeText) || resumeText.trim().length < 20) {
          if (fs.existsSync(resume.filePath)) {
            const rawText = await parseFile(resume.filePath);
            if (!isGarbled(rawText) && rawText.trim().length >= 20) {
              const safeText = desensitize(rawText);
              fs.writeFileSync(txtPath, safeText, 'utf-8');
              resumeText = safeText;
            }
          }
        }

        // Final fallback: try the filePath directly (for non-PDF or old records)
        if (isGarbled(resumeText) || resumeText.trim().length < 20) {
          if (fs.existsSync(resume.filePath)) {
            resumeText = await parseFile(resume.filePath);
          }
        }

        if (!resumeText.trim() || resumeText.trim().length < 20) {
          throw new Error('简历内容为空或过少，可能是文件解析失败');
        }
        if (isGarbled(resumeText)) {
          // Delete garbled desensitized cache so it won't be reused
          if (fs.existsSync(txtPath)) fs.unlinkSync(txtPath);
          throw new Error('简历内容解析异常（乱码），该 PDF 可能使用了特殊字体或为图片格式，建议上传 docx/txt 格式或文字版 PDF');
        }
        const result = await analyzeResume(jdText, resumeText, resume.candidateName || resume.originalName);
        report.candidates.push({
          resumeId: resume.id,
          name: resume.candidateName || resume.originalName,
          ...result,
        });
      } catch (e) {
        report.candidates.push({
          resumeId: resume.id,
          name: resume.candidateName || resume.originalName,
          score: 0,
          level: '分析失败',
          strengths: [],
          gaps: [],
          summary: `分析失败: ${e.message}`,
          outsource: false,
          strengthKeywords: [],
          weaknessKeywords: [],
          careerPotential: { careerDirections: [], careerReason: '' },
        });
      }
      report.completed++;
      updateReport(report);
    }

    // Keep original analysis order (chronological), don't sort by score
    report.status = 'done';
    updateReport(report);
  })();

  return reportId;
}

router.get('/reports', async (req, res) => {
  try {
    const reports = await withReportLock(() => readJSON(REPORTS_FILE));
    res.json(reports.map(r => ({
      id: r.id,
      jdName: r.jdName,
      jdJobTitle: r.jdJobTitle || '',
      createdAt: r.createdAt,
      status: r.status,
      total: r.total,
      completed: r.completed,
      candidateNames: (r.candidates || []).map(c => c.name),
      candidateIds: (r.candidates || []).map(c => c.resumeId),
    })));
  } catch (e) {
    res.status(500).json({ error: '读取失败' });
  }
});

router.get('/reports/:id', async (req, res) => {
  try {
    const reports = await withReportLock(() => readJSON(REPORTS_FILE));
    const report = reports.find(r => r.id === req.params.id);
    if (!report) return res.status(404).json({ error: '未找到报告' });
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: '读取失败' });
  }
});

router.get('/reports/:id/export', async (req, res) => {
  const reports = readJSON(REPORTS_FILE);
  const report = reports.find(r => r.id === req.params.id);
  if (!report || report.status !== 'done') return res.status(404).json({ error: '报告不存在或未完成' });

  const resumes = readJSON(RESUMES_FILE);
  const resumeMap = new Map(resumes.map(r => [r.id, r]));

  const workbook = new ExcelJS.Workbook();
  const categories = [
    { level: '推荐', name: '推荐候选人', color: 'FF10B981' },
    { level: '备选', name: '备选候选人', color: 'FFF59E0B' },
    { level: '不推荐', name: '不推荐候选人', color: 'FFEF4444' },
  ];

  for (const cat of categories) {
    const candidates = report.candidates.filter(c => c.level === cat.level);
    const sheet = workbook.addWorksheet(cat.name);
    sheet.columns = [
      { header: '序号', key: 'index', width: 6 },
      { header: '姓名', key: 'name', width: 14 },
      { header: '评分', key: 'score', width: 8 },
      { header: '电话', key: 'phone', width: 16 },
      { header: '邮箱', key: 'email', width: 28 },
      { header: '综合评价', key: 'summary', width: 50 },
    ];

    // Style header
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cat.color } };

    candidates.forEach((c, i) => {
      const resume = resumeMap.get(c.resumeId);
      sheet.addRow({
        index: i + 1,
        name: c.name,
        score: c.score,
        phone: resume?.phone || '',
        email: resume?.email || '',
        summary: c.summary || '',
      });
    });
  }

  const jobTitle = report.jdJobTitle || report.jdName.replace(/\.\w+$/, '');
  const fileName = encodeURIComponent(`${jobTitle}_候选人汇总.xlsx`);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);

  await workbook.xlsx.write(res);
  res.end();
});

router.delete('/reports/:id', async (req, res) => {
  try {
    await withReportLock(() => {
      const reports = readJSON(REPORTS_FILE);
      const idx = reports.findIndex(r => r.id === req.params.id);
      if (idx < 0) return;
      reports.splice(idx, 1);
      writeJSON(REPORTS_FILE, reports);
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '删除失败' });
  }
});

router.post('/reports/:id/interview-questions', async (req, res) => {
  const reports = readJSON(REPORTS_FILE);
  const report = reports.find(r => r.id === req.params.id);
  if (!report || report.status !== 'done') return res.status(404).json({ error: '报告不存在或未完成' });

  const { resumeId } = req.body;
  if (!resumeId) return res.status(400).json({ error: '请提供 resumeId' });

  const candidate = report.candidates.find(c => c.resumeId === resumeId);
  if (!candidate) return res.status(404).json({ error: '未找到该候选人' });
  if (candidate.level === '分析失败') return res.status(400).json({ error: '该候选人分析失败，无法生成问题' });

  const jds = readJSON(JDS_FILE);
  const jd = jds.find(j => j.id === report.jdId);
  if (!jd) return res.status(404).json({ error: '未找到对应的JD' });

  try {
    let jdText;
    try {
      jdText = await parseFile(jd.filePath);
    } catch {
      jdText = jd.jobTitle || '';
    }

    const questions = await generateInterviewQuestions(jdText, candidate);
    if (!candidate.interviewQuestions) candidate.interviewQuestions = questions;
    updateReport(report);
    res.json(questions);
  } catch (e) {
    res.status(500).json({ error: `生成面试问题失败: ${e.message}` });
  }
});

module.exports = router;

const OpenAI = require('openai');

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

const MODEL = 'deepseek-chat';

// Outsource company detection from parsed text
const OUTSOURCE_PATTERNS = [
  { name: '软通动力', patterns: [/软通动力/, /软通/] },
  { name: '中软国际', patterns: [/中软国际/, /中软/] },
  { name: '文思海辉', patterns: [/文思海辉/, /文思/, /海辉/] },
  { name: '博彦科技', patterns: [/博彦/, /博彦科技/] },
  { name: '法本信息', patterns: [/法本信息/, /法本/] },
  { name: '神州数码', patterns: [/神州数码/] },
  { name: '中科软', patterns: [/中科软/] },
  { name: '博朗软件', patterns: [/博朗软件/, /博朗/] },
  { name: '浪潮', patterns: [/浪潮集团/] },
  { name: '柯莱特', patterns: [/柯莱特/] },
  { name: 'IBM ISSC', patterns: [/ISSC/] },
];

function detectOutsourceFromText(text) {
  const compact = text.replace(/\s+/g, '');
  const hits = [];
  for (const { name, patterns } of OUTSOURCE_PATTERNS) {
    for (const p of patterns) {
      if (p.test(compact)) {
        if (!hits.includes(name)) hits.push(name);
        break;
      }
    }
  }
  if (/驻场|外派/.test(compact) && hits.length === 0) {
    hits.push('外包（驻场/外派）');
  }
  return hits;
}

async function extractJobTitle(jdText) {
  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: `请从以下岗位JD中提取岗位名称，只输出岗位名称本身，不要输出任何其他内容。\n\n${jdText.slice(0, 2000)}`,
        },
      ],
    });
    return response.choices[0]?.message?.content?.trim() || '';
  } catch {
    return '';
  }
}

async function analyzeResume(jdText, resumeText, resumeName, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await _doAnalyzeResume(jdText, resumeText, resumeName);
    } catch (e) {
      const status = e.status || e.statusCode;
      const isRetryable = status === 504 || status === 429 || status >= 500
        || e.message?.includes('返回格式异常');
      if (attempt < retries && isRetryable) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

async function _doAnalyzeResume(jdText, resumeText, resumeName) {
  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 3072,
    messages: [
      {
        role: 'system',
        content: '你是一位资深招聘顾问，专业进行岗位与候选人简历的匹配分析。请严格按照指定 JSON 格式输出，不要输出任何多余内容。',
      },
      {
        role: 'user',
        content: `【岗位JD】\n${jdText}\n\n【候选人简历：${resumeName}】\n${resumeText}\n\n请对该候选人进行评估，严格输出以下 JSON 格式（不要 markdown 代码块）：
{
  "score": 数字(0-100),
  "level": "推荐" 或 "备选" 或 "不推荐",
  "strengths": ["优势1", "优势2", "优势3"],
  "gaps": ["差距1", "差距2"],
  "summary": "100字以内的综合评价",
  "outsource": true或false（是否有外包/外包公司工作经历）,
  "outsourceCompanies": ["外包公司1", "外包公司2"]（当outsource为true时，列出候选人工作过的外包/人力派遣公司名称；当outsource为false时输出空数组[]）,
  "strengthKeywords": ["优势关键词1", "优势关键词2", ...]（3-6个，概括候选人核心优势的短语关键词）,
  "weaknessKeywords": ["劣势关键词1", "劣势关键词2", ...]（2-4个，概括候选人与岗位差距的短语关键词）,
  "careerPotential": {
    "careerDirections": ["方向1", "方向2", "方向3"]（2-4个，基于候选人技能和经历推测的潜在职业发展方向，如技术管理、架构师、产品技术等）,
    "careerReason": "50字以内说明推荐这些方向的依据"
  }
}

outsource判断标准：工作经历中是否在软通动力、中软国际、文思海辉、博彦科技、法本信息、神州数码、IBM ISSC、中科软、博朗软件、浪潮、柯莱特等外包/人力派遣公司任职，或在某公司以"驻场"、"外派"形式工作。outsourceCompanies需从简历中准确提取对应的外包公司全称。注意：①在大公司（如腾讯、阿里、字节等）以"合作伙伴"、"合作方"身份工作不属于外包，这属于正式的合作岗位而非人力派遣；②只有任职公司本身就是外包/人力派遣公司，或者明确以驻场/外派方式被第三方派驻到甲方工作才算外包；③简历可能经OCR提取，公司名可能存在形近字误识别（如"博彦"→"描窟"等），请结合上下文推断。
careerDirections 判断标准：基于候选人现有技能栈、行业经验、项目深度、成长轨迹，推测其未来1-3年可能胜任的发展方向，不仅仅局限于当前应聘岗位。`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim() || '';
  // Strip markdown code block if present
  const stripped = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  let result;
  try {
    result = JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        result = JSON.parse(match[0]);
      } catch {
        throw new Error('AI 返回格式异常');
      }
    } else {
      throw new Error('AI 返回格式异常');
    }
  }

  // Fallback: fuzzy match outsource keywords in resume text if AI missed it
  if (!result.outsource) {
    const outsourceHits = detectOutsourceFromText(resumeText);
    if (outsourceHits.length > 0) {
      result.outsource = true;
      result.outsourceCompanies = outsourceHits;
    }
  }

  return result;
}

const CN_NUM = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

function normalizeExperience(str) {
  if (!str) return str;
  return str.replace(/([零一两二三四五六七八九十]+)/g, (match) => {
    if (CN_NUM[match] !== undefined) return String(CN_NUM[match]);
    // Handle "十几" pattern
    if (match.startsWith('十')) {
      const rest = match.slice(1);
      return rest && CN_NUM[rest] !== undefined ? String(10 + CN_NUM[rest]) : '10';
    }
    return match;
  });
}

async function extractJdKeywords(jdText) {
  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `请从以下岗位JD中提取关键信息，严格输出以下 JSON 格式（不要 markdown 代码块）：
{
  "skills": ["技能1", "技能2", ...],
  "experience": "年限要求（如：3-5年、应届即可、5年以上）"
}

只提取核心技能关键词（5-10个），不要提取软技能。如果JD中没有明确年限要求，experience 填 "不限"。
experience 中的数字必须使用阿拉伯数字（如"2年以上"而非"两年以上"）。

${jdText.slice(0, 3000)}`,
        },
      ],
    });
    const text = response.choices[0]?.message?.content?.trim() || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const result = JSON.parse(match[0]);
      result.experience = normalizeExperience(result.experience);
      return result;
    }
    return { skills: [], experience: '' };
  } catch {
    return { skills: [], experience: '' };
  }
}

async function generateInterviewQuestions(jdText, candidate) {
  const parts = [`候选人：${candidate.name}，评分：${candidate.score}，级别：${candidate.level}`];
  if (candidate.strengths?.length) parts.push(`优势：${candidate.strengths.join('、')}`);
  if (candidate.gaps?.length) parts.push(`差距：${candidate.gaps.join('、')}`);
  if (candidate.outsource) parts.push('有外包经历');
  parts.push(`综合评价：${candidate.summary}`);
  const candidateSummary = parts.join('；');

  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: 'system',
        content: '你是一位资深HR招聘顾问，擅长从HR视角为招聘团队提供面试参考问题。你的问题应聚焦于HR在初筛和面试中关心的维度（求职动机、稳定性、职业规划、薪资期望、团队适配、沟通表达等），而非业务技术深度考察。请严格按照指定 JSON 格式输出，不要输出任何多余内容。',
      },
      {
        role: 'user',
        content: `【岗位JD】\n${jdText}\n\n【候选人分析】\n${candidateSummary}\n\n请根据以上岗位JD和候选人分析，从HR视角生成面试参考问题。问题应由HR在初筛或面试中提出，而非业务部门技术面。严格输出以下 JSON 格式（不要 markdown 代码块）：
{"questions":[{"question":"问题内容","purpose":"考察目的","category":"求职动机/职业稳定性/薪资期望/团队适配/沟通表达/履历真实性/外包甄别"}]}

生成4-6个面试问题，包含：求职动机与意向1-2个、职业稳定性与规划1-2个、履历与适配度验证1-2个。purpose 不超过20字。确保 JSON 完整。`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim() || '';
  const stripped = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    let fixed = stripped.replace(/"[^"]*$/, '');
    const opens = (fixed.match(/[\[{]/g) || []).length;
    const closes = (fixed.match(/[\]}]/g) || []).length;
    for (let i = 0; i < opens - closes; i++) fixed += '}';
    try { return JSON.parse(fixed); } catch {}
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    throw new Error('AI 返回格式异常');
  }
}

module.exports = { extractJobTitle, analyzeResume, extractJdKeywords, generateInterviewQuestions };

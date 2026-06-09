import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { jdApi, resumeApi, analyzeApi } from '../api/client.js';
import FileDropZone from '../components/FileDropZone.jsx';

const fmtSize = (b) => b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(1)}MB`;

export default function ResumeScreen() {
  const [jds, setJds] = useState([]);
  const [resumes, setResumes] = useState([]);
  const [selectedResumes, setSelectedResumes] = useState(new Set());
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [msg, setMsg] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    jdApi.list().then(r => setJds(r.data));
    resumeApi.list().then(r => setResumes(r.data));
  }, []);

  const handleUpload = async (files) => {
    setUploading(true);
    setMsg(null);
    try {
      const res = await resumeApi.upload(files);
      const matchedCount = res.data.files.filter(f => f.matchedJdTitle).length;
      const unmatchedCount = res.data.files.length - matchedCount;
      let text = `成功上传 ${res.data.files.length} 份简历`;
      if (matchedCount) text += `，${matchedCount} 份已自动匹配岗位`;
      if (unmatchedCount) text += `，${unmatchedCount} 份未匹配到岗位`;
      setMsg({ type: 'success', text });
      const r = await resumeApi.list();
      setResumes(r.data);
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error || '上传失败' });
    } finally {
      setUploading(false);
    }
  };

  const toggleResume = (id) => {
    setSelectedResumes(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedResumes.size === resumes.length) setSelectedResumes(new Set());
    else setSelectedResumes(new Set(resumes.map(r => r.id)));
  };

  const handleDelete = async (id) => {
    await resumeApi.remove(id);
    setSelectedResumes(prev => { const n = new Set(prev); n.delete(id); return n; });
    resumeApi.list().then(r => setResumes(r.data));
  };

  const handleDeleteSelected = async () => {
    if (!selectedResumes.size) return;
    if (!confirm(`确认删除选中的 ${selectedResumes.size} 份简历？`)) return;
    for (const id of selectedResumes) {
      await resumeApi.remove(id);
    }
    setSelectedResumes(new Set());
    resumeApi.list().then(r => setResumes(r.data));
  };

  const handleAutoAnalyze = async () => {
    if (!selectedResumes.size) return setMsg({ type: 'error', text: '请选择至少一份简历' });
    const selected = resumes.filter(r => selectedResumes.has(r.id));
    const unmatched = selected.filter(r => !r.matchedJdId);
    if (unmatched.length) {
      return setMsg({
        type: 'error',
        text: `以下简历未匹配到岗位，请手动指定：${unmatched.map(r => r.originalName).join('、')}`,
      });
    }
    setAnalyzing(true);
    setMsg(null);
    try {
      const res = await analyzeApi.startAutoMatch(Array.from(selectedResumes));
      const ids = res.data.reportIds;
      navigate(`/reports?highlight=${ids[0]}`);
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error || '启动分析失败' });
      setAnalyzing(false);
    }
  };

  const matchedCount = resumes.filter(r => selectedResumes.has(r.id) && r.matchedJdTitle).length;
  const unmatchedSelected = resumes.filter(r => selectedResumes.has(r.id) && !r.matchedJdId).length;

  return (
    <div>
      <h2 style={{ marginBottom: 24, fontSize: '1.4rem' }}>简历筛选</h2>

      <section style={{ background: '#1a1f2e', border: '1px solid #2e3554', borderRadius: 10, padding: 20, marginBottom: 20 }}>
        <div style={{ marginBottom: 14, fontWeight: 500 }}>上传简历</div>
        <FileDropZone onFiles={handleUpload} label="批量上传候选人简历（自动匹配对应岗位 JD）" />
        {uploading && <div style={{ marginTop: 10, color: '#818cf8' }}>⏳ 上传并匹配中...</div>}
        {msg && (
          <div style={{
            marginTop: 12, padding: '10px 16px', borderRadius: 8, fontSize: '0.9rem',
            background: msg.type === 'success' ? '#0d2b1f' : '#2b0d0d',
            color: msg.type === 'success' ? '#10b981' : '#ef4444',
            border: `1px solid ${msg.type === 'success' ? '#10b981' : '#ef4444'}`,
          }}>
            {msg.type === 'success' ? '✅ ' : '❌ '}{msg.text}
          </div>
        )}
      </section>

      <section style={{ background: '#1a1f2e', border: '1px solid #2e3554', borderRadius: 10, padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontWeight: 500 }}>
            简历库 ({resumes.length} 份)
            {selectedResumes.size > 0 && <span style={{ color: '#818cf8', marginLeft: 8 }}>已选 {selectedResumes.size}</span>}
          </span>
          {resumes.length > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={selectAll} style={{
                padding: '5px 12px', background: 'transparent',
                border: '1px solid #2e3554', borderRadius: 6, color: '#8892a4', fontSize: '0.82rem',
              }}>
                {selectedResumes.size === resumes.length ? '取消全选' : '全选'}
              </button>
              {selectedResumes.size > 0 && (
                <button onClick={handleDeleteSelected} style={{
                  padding: '5px 12px', background: 'transparent',
                  border: '1px solid #ef4444', borderRadius: 6, color: '#ef4444', fontSize: '0.82rem',
                }}>
                  删除选中({selectedResumes.size})
                </button>
              )}
            </div>
          )}
        </div>

        {resumes.length === 0 ? (
          <div style={{ color: '#4a5568', textAlign: 'center', padding: '24px 0' }}>暂无简历，请先上传</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
            {[...resumes].sort((a, b) => {
              if (!a.matchedJdId && b.matchedJdId) return -1;
              if (a.matchedJdId && !b.matchedJdId) return 1;
              return 0;
            }).map(r => {
              const isUnmatched = !r.matchedJdId;
              return (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', borderRadius: 8,
                background: isUnmatched
                  ? '#2b1a0d'
                  : selectedResumes.has(r.id) ? '#1e2445' : '#232940',
                border: `1px solid ${isUnmatched
                  ? '#f97316'
                  : selectedResumes.has(r.id) ? '#6366f1' : '#2e3554'}`,
                cursor: 'pointer',
              }} onClick={() => toggleResume(r.id)}>
                <input
                  type="checkbox"
                  checked={selectedResumes.has(r.id)}
                  onChange={() => {}}
                  style={{ accentColor: '#6366f1', width: 16, height: 16 }}
                />
                <span style={{ fontSize: '1.1rem' }}>📝</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.92rem' }}>
                    {r.candidateName || r.originalName}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#8892a4', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <span>{fmtSize(r.size)}</span>
                    {r.matchedJdTitle ? (
                      <span style={{ color: '#10b981' }}>🏷️ {r.matchedJdTitle}</span>
                    ) : (
                      <span style={{ color: '#f97316', fontWeight: 600 }}>⚠️ 岗位JD库中未找到目标岗位</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                  style={{
                    padding: '4px 10px', background: 'transparent',
                    border: '1px solid #ef4444', color: '#ef4444',
                    borderRadius: 5, fontSize: '0.78rem',
                  }}
                >删除</button>
              </div>
            );})}
          </div>
        )}
      </section>

      <button
        onClick={handleAutoAnalyze}
        disabled={analyzing || !selectedResumes.size}
        style={{
          width: '100%', padding: '14px', borderRadius: 10,
          background: analyzing || !selectedResumes.size ? '#2e3554' : '#6366f1',
          color: '#fff', border: 'none', fontSize: '1rem', fontWeight: 600,
          cursor: analyzing || !selectedResumes.size ? 'not-allowed' : 'pointer',
          transition: 'background 0.2s',
        }}
      >
        {analyzing ? '⏳ 正在提交分析任务...' : `🚀 开始分析（${selectedResumes.size} 份简历，按岗位自动分组）`}
      </button>

      {selectedResumes.size > 0 && unmatchedSelected > 0 && (
        <div style={{ marginTop: 10, fontSize: '0.85rem', color: '#f59e0b', textAlign: 'center' }}>
          ⚠️ 已选简历中有 {unmatchedSelected} 份未匹配到岗位，需先匹配才能分析
        </div>
      )}
    </div>
  );
}

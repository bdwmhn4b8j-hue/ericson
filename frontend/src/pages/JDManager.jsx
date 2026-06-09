import React, { useEffect, useState } from 'react';
import { jdApi } from '../api/client.js';
import FileDropZone from '../components/FileDropZone.jsx';

const fmtSize = (b) => b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(1)}MB`;
const fmtDate = (s) => new Date(s).toLocaleString('zh-CN');

export default function JDManager() {
  const [jds, setJds] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [textTitle, setTextTitle] = useState('');
  const [textContent, setTextContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  const allChecked = jds.length > 0 && checkedIds.size === jds.length;
  const toggleCheck = (id) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setCheckedIds(prev => prev.size === jds.length ? new Set() : new Set(jds.map(j => j.id)));
  };

  const handleBatchDelete = async () => {
    if (!confirm(`确认删除选中的 ${checkedIds.size} 个 JD？`)) return;
    setBatchDeleting(true);
    try {
      await jdApi.batchRemove([...checkedIds]);
      if (checkedIds.has(selectedId)) {
        setSelectedId(null);
        setPreview(null);
      }
      setCheckedIds(new Set());
      load();
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error || '批量删除失败' });
    } finally {
      setBatchDeleting(false);
    }
  };

  const load = () => jdApi.list().then(r => setJds(r.data));
  useEffect(() => { load(); }, []);

  const loadPreview = async (id) => {
    setSelectedId(id);
    setLoadingPreview(true);
    try {
      const res = await jdApi.getContent(id);
      setPreview(res.data);
    } catch {
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleFiles = async (files) => {
    setUploading(true);
    setMsg(null);
    try {
      const res = await jdApi.upload(files);
      const replaced = res.data.files.filter(f => f.replaced).map(f => f.originalName);
      const added = res.data.files.filter(f => !f.replaced).map(f => f.originalName);
      let text = '';
      if (added.length) text += `新增 ${added.length} 个 JD：${added.join('、')}`;
      if (replaced.length) text += `${text ? '；' : ''}替换 ${replaced.length} 个 JD：${replaced.join('、')}`;
      setMsg({ type: 'success', text });
      load();
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error || '上传失败' });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('确认删除该 JD？')) return;
    await jdApi.remove(id);
    if (selectedId === id) {
      setSelectedId(null);
      setPreview(null);
    }
    load();
  };

  const handleTextSubmit = async (force = false) => {
    if (!textTitle.trim() || !textContent.trim()) {
      return setMsg({ type: 'error', text: '岗位名称和JD内容不能为空' });
    }
    setSubmitting(true);
    setMsg(null);
    try {
      const res = await jdApi.createByText(textTitle.trim(), textContent.trim(), force);
      setMsg({
        type: 'success',
        text: res.data.file.replaced
          ? `已替换岗位 JD：${textTitle.trim()}`
          : `已添加岗位 JD：${textTitle.trim()}`,
      });
      setTextTitle('');
      setTextContent('');
      load();
    } catch (e) {
      if (e.response?.status === 409 && e.response?.data?.error === 'DUPLICATE_JD') {
        const confirmed = confirm(`岗位「${textTitle.trim()}」已存在，是否用新内容替换该岗位的 JD？`);
        if (confirmed) {
          setSubmitting(false);
          return handleTextSubmit(true);
        }
        setSubmitting(false);
        return;
      }
      setMsg({ type: 'error', text: e.response?.data?.error || e.message || '添加失败' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: 20, fontSize: '1.4rem' }}>岗位 JD 管理</h2>

      <div style={{ display: 'flex', gap: 16, minHeight: 600 }}>
        {/* 左侧：岗位列表 */}
        <div style={{
          width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: '#1a1f2e', border: '1px solid #2e3554', borderRadius: 10, overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid #2e3554',
            color: '#8892a4', fontSize: '0.85rem', fontWeight: 500,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                disabled={jds.length === 0}
                style={{ accentColor: '#6366f1', cursor: 'pointer' }}
              />
              岗位列表（{jds.length}）
            </label>
            {checkedIds.size > 0 && (
              <button
                onClick={handleBatchDelete}
                disabled={batchDeleting}
                style={{
                  padding: '3px 10px', background: batchDeleting ? '#2e3554' : 'transparent',
                  border: '1px solid #ef4444', color: '#ef4444',
                  borderRadius: 4, fontSize: '0.72rem', cursor: batchDeleting ? 'not-allowed' : 'pointer',
                  lineHeight: 1,
                }}
              >
                {batchDeleting ? '删除中...' : `删除选中(${checkedIds.size})`}
              </button>
            )}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {jds.length === 0 ? (
              <div style={{ color: '#4a5568', textAlign: 'center', padding: '40px 0', fontSize: '0.85rem' }}>
                暂无 JD
              </div>
            ) : (
              jds.map(jd => (
                <div
                  key={jd.id}
                  onClick={() => loadPreview(jd.id)}
                  style={{
                    padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 8, marginBottom: 4,
                    background: selectedId === jd.id ? '#2a3158' : 'transparent',
                    border: selectedId === jd.id ? '1px solid #6366f1' : '1px solid transparent',
                    transition: 'background 0.15s, border 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={checkedIds.has(jd.id)}
                      onChange={() => toggleCheck(jd.id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ accentColor: '#6366f1', cursor: 'pointer', flexShrink: 0 }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{
                        fontSize: '0.88rem', fontWeight: 500,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {jd.jobTitle || jd.originalName.replace(/\.\w+$/, '')}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#8892a4', marginTop: 2 }}>
                        {fmtSize(jd.size)} · {fmtDate(jd.uploadedAt).split(' ')[0]}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(jd.id); }}
                    style={{
                      padding: '3px 8px', background: 'transparent',
                      border: '1px solid #ef4444', color: '#ef4444',
                      borderRadius: 4, fontSize: '0.72rem', flexShrink: 0, lineHeight: 1,
                    }}
                  >
                    删除
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 右侧 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {/* 右上：添加岗位 JD */}
          <div style={{
            background: '#1a1f2e', border: '1px solid #2e3554', borderRadius: 10, padding: 18,
          }}>
            <div style={{ fontWeight: 500, marginBottom: 12 }}>添加岗位 JD</div>
            <FileDropZone onFiles={handleFiles} label="上传岗位 JD（同名文件将自动替换旧版本）" />

            <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
              <input
                placeholder="岗位名称（如：高级前端工程师）"
                value={textTitle}
                onChange={e => setTextTitle(e.target.value)}
                style={{
                  flex: '0 0 220px', padding: '9px 12px', background: '#232940',
                  border: '1px solid #2e3554', borderRadius: 8,
                  color: '#e2e8f0', fontSize: '0.88rem', outline: 'none',
                }}
              />
              <textarea
                placeholder="粘贴 JD 内容..."
                value={textContent}
                onChange={e => setTextContent(e.target.value)}
                rows={3}
                style={{
                  flex: 1, padding: '9px 12px', background: '#232940',
                  border: '1px solid #2e3554', borderRadius: 8,
                  color: '#e2e8f0', fontSize: '0.85rem', outline: 'none',
                  resize: 'vertical', fontFamily: 'inherit',
                }}
              />
              <button
                onClick={() => handleTextSubmit()}
                disabled={submitting}
                style={{
                  flex: '0 0 auto', padding: '9px 18px', background: submitting ? '#2e3554' : '#6366f1',
                  color: '#fff', border: 'none', borderRadius: 8, alignSelf: 'flex-end',
                  fontSize: '0.88rem', fontWeight: 500, cursor: submitting ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {submitting ? '提交中...' : '添加'}
              </button>
            </div>

            {uploading && <div style={{ marginTop: 10, color: '#818cf8', fontSize: '0.85rem' }}>⏳ 上传中...</div>}
            {msg && (
              <div style={{
                marginTop: 10, padding: '8px 14px', borderRadius: 8, fontSize: '0.85rem',
                background: msg.type === 'success' ? '#0d2b1f' : '#2b0d0d',
                color: msg.type === 'success' ? '#10b981' : '#ef4444',
                border: `1px solid ${msg.type === 'success' ? '#10b981' : '#ef4444'}`,
              }}>
                {msg.type === 'success' ? '✅ ' : '❌ '}{msg.text}
              </div>
            )}
          </div>

          {/* 右下：JD 内容预览 */}
          <div style={{
            flex: 1, background: '#1a1f2e', border: '1px solid #2e3554', borderRadius: 10,
            overflow: 'hidden', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid #2e3554',
              color: '#8892a4', fontSize: '0.85rem', fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              📋 JD 内容预览
              {preview && (
                <span style={{ color: '#818cf8', fontSize: '0.82rem' }}>
                  — {preview.jobTitle || preview.originalName.replace(/\.\w+$/, '')}
                </span>
              )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {!selectedId ? (
                <div style={{ color: '#4a5568', textAlign: 'center', padding: '60px 0', fontSize: '0.88rem' }}>
                  点击左侧岗位查看 JD 内容
                </div>
              ) : loadingPreview ? (
                <div style={{ color: '#818cf8', textAlign: 'center', padding: '60px 0', fontSize: '0.88rem' }}>
                  加载中...
                </div>
              ) : preview ? (
                <>
                  {/* 关键词标签区 */}
                  {(preview.skills?.length > 0 || preview.experience) && (
                    <div style={{
                      marginBottom: 16, padding: 14, background: '#232940',
                      border: '1px solid #2e3554', borderRadius: 8,
                    }}>
                      {preview.experience && (
                        <div style={{
                          display: 'inline-block', padding: '4px 12px',
                          background: '#1e3a5f', border: '1px solid #3b82f6',
                          borderRadius: 6, color: '#60a5fa',
                          fontSize: '0.82rem', fontWeight: 500, marginRight: 8, marginBottom: 6,
                        }}>
                          ⏱ {preview.experience}
                        </div>
                      )}
                      {preview.skills?.map((skill, i) => (
                        <span key={i} style={{
                          display: 'inline-block', padding: '4px 12px',
                          background: '#1a2e1a', border: '1px solid #10b981',
                          borderRadius: 6, color: '#34d399',
                          fontSize: '0.82rem', marginRight: 6, marginBottom: 6,
                        }}>
                          {skill}
                        </span>
                      ))}
                    </div>
                  )}
                  <pre style={{
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    margin: 0, fontSize: '0.88rem', lineHeight: 1.7, color: '#c9d1d9',
                    fontFamily: 'inherit',
                  }}>
                    {preview.content}
                  </pre>
                </>
              ) : (
                <div style={{ color: '#ef4444', textAlign: 'center', padding: '60px 0', fontSize: '0.88rem' }}>
                  加载失败
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { analyzeApi } from '../api/client.js';

const fmtDate = (s) => new Date(s).toLocaleString('zh-CN');
const fmtDateShort = (s) => new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const levelColor = { '推荐': '#10b981', '备选': '#f59e0b', '不推荐': '#ef4444' };
const levelBg = { '推荐': '#0d2b1f', '备选': '#2b1e0d', '不推荐': '#2b0d0d' };

function StatusBadge({ status, total, completed }) {
  if (status === 'done') return <span style={{ color: '#10b981', fontSize: '0.82rem' }}>✅ 完成</span>;
  if (status === 'error') return <span style={{ color: '#ef4444', fontSize: '0.82rem' }}>❌ 失败</span>;
  return (
    <span style={{ color: '#f59e0b', fontSize: '0.82rem' }}>
      ⏳ 分析中 {completed}/{total}
    </span>
  );
}

function ScoreBar({ score }) {
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 6, background: '#2e3554', borderRadius: 3 }}>
        <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.6s' }} />
      </div>
      <span style={{ color, fontWeight: 700, fontSize: '1rem', minWidth: 36, textAlign: 'right' }}>{score}</span>
    </div>
  );
}

function groupReportsByJd(reports) {
  const map = new Map();
  for (const r of reports) {
    const key = r.jdJobTitle || r.jdName.replace(/\.\w+$/, '');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  for (const [, list] of map) {
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  return map;
}

function groupReportsByDate(reports) {
  const map = new Map();
  for (const r of reports) {
    const d = new Date(r.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  // Sort dates descending
  const sorted = new Map([...map.entries()].sort((a, b) => b[0].localeCompare(a[0])));
  // Within each date, group by JD
  for (const [date, list] of sorted) {
    sorted.set(date, groupReportsByJd(list));
  }
  return sorted;
}

const weekdayMap = ['日', '一', '二', '三', '四', '五', '六'];
function fmtDateLabel(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isToday = dateStr === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const isYesterday = dateStr === `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  const weekday = weekdayMap[d.getDay()];
  if (isToday) return `今天 (周${weekday})`;
  if (isYesterday) return `昨天 (周${weekday})`;
  return `${d.getMonth() + 1}月${d.getDate()}日 (周${weekday})`;
}

export default function Reports() {
  const [reports, setReports] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedResumeId, setSelectedResumeId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [searchParams] = useSearchParams();
  const highlight = searchParams.get('highlight');
  const pollRef = React.useRef(null);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [expandedDates, setExpandedDates] = useState(new Set());
  const [filterLevel, setFilterLevel] = useState(null);
  const [filterOutsource, setFilterOutsource] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [expandedQuestions, setExpandedQuestions] = useState(new Set());
  const [loadingQuestions, setLoadingQuestions] = useState(new Set());

  const selectedRef = React.useRef(selected);
  selectedRef.current = selected;

  const loadList = useCallback(async () => {
    const r = await analyzeApi.listReports();
    const sorted = r.data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    setReports(sorted);
    const byDate = groupReportsByDate(sorted);
    const autoExpandDates = new Set();
    const autoExpandGroups = new Set();
    for (const [dateKey, jdMap] of byDate) {
      for (const [jdKey, list] of jdMap) {
        if (list.some(r => r.status === 'running')) {
          autoExpandDates.add(dateKey);
          autoExpandGroups.add(jdKey);
        }
        if (list.some(r => r.id === selectedRef.current || r.id === highlight)) {
          autoExpandDates.add(dateKey);
          autoExpandGroups.add(jdKey);
        }
      }
    }
    setExpandedDates(prev => {
      const next = new Set(prev.size ? prev : autoExpandDates);
      for (const k of autoExpandDates) next.add(k);
      return next;
    });
    setExpandedGroups(prev => {
      const next = new Set(prev.size ? prev : autoExpandGroups);
      for (const k of autoExpandGroups) next.add(k);
      return next;
    });
    return sorted;
  }, [highlight]);

  useEffect(() => {
    loadList();
    if (highlight) setSelected(highlight);
  }, []);

  // Poll detail for a running report, and refresh list in parallel
  useEffect(() => {
    if (!selected) return;
    setExpandedQuestions(new Set());
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await analyzeApi.getReport(selected);
        if (cancelled) return;
        setDetail(r.data);
        if (r.data.status === 'running') {
          loadList();
          pollRef.current = setTimeout(poll, 2000);
        } else {
          loadList();
        }
      } catch (e) {
        if (cancelled) return;
        // Report was deleted or not found — stop polling
        if (e.response?.status === 404) {
          setSelected(null);
          setSelectedResumeId(null);
          setDetail(null);
        }
      }
    };
    poll();
    return () => { cancelled = true; clearTimeout(pollRef.current); };
  }, [selected]);

  useEffect(() => {
    if (!selectedResumeId) return;
    const el = document.getElementById(`candidate-${selectedResumeId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedResumeId, detail]);

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!confirm('确认删除该报告？')) return;
    try {
      await analyzeApi.deleteReport(id);
    } catch { /* already deleted */ }
    if (selected === id) {
      clearTimeout(pollRef.current);
      setSelected(null);
      setSelectedResumeId(null);
      setDetail(null);
    }
    setCheckedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    loadList();
  };

  const handleSelectAll = () => {
    if (checkedIds.size === reports.length) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(reports.map(r => r.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (checkedIds.size === 0) return;
    if (!confirm(`确认删除选中的 ${checkedIds.size} 个报告？`)) return;
    await Promise.all([...checkedIds].map(id => analyzeApi.deleteReport(id).catch(() => {})));
    if (checkedIds.has(selected)) {
      clearTimeout(pollRef.current);
      setSelected(null);
      setSelectedResumeId(null);
      setDetail(null);
    }
    setCheckedIds(new Set());
    loadList();
  };

  const toggleGroup = (key) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleDate = (key) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleGenerateQuestions = async (resumeId) => {
    if (!selected) return;
    setLoadingQuestions(prev => new Set(prev).add(resumeId));
    try {
      const r = await analyzeApi.interviewQuestions(selected, resumeId);
      setDetail(prev => {
        const next = { ...prev, candidates: prev.candidates.map(c =>
          c.resumeId === resumeId ? { ...c, interviewQuestions: r.data } : c
        )};
        return next;
      });
      setExpandedQuestions(prev => new Set(prev).add(resumeId));
    } catch (e) {
      alert(e.response?.data?.error || '生成面试问题失败');
    } finally {
      setLoadingQuestions(prev => { const n = new Set(prev); n.delete(resumeId); return n; });
    }
  };

  const toggleQuestions = (resumeId) => {
    setExpandedQuestions(prev => {
      const next = new Set(prev);
      next.has(resumeId) ? next.delete(resumeId) : next.add(resumeId);
      return next;
    });
  };

  const printReport = () => window.print();

  const summary = detail ? {
    total: detail.candidates.length,
    recommend: detail.candidates.filter(c => c.level === '推荐').length,
    maybe: detail.candidates.filter(c => c.level === '备选').length,
    no: detail.candidates.filter(c => c.level === '不推荐').length,
    outsource: detail.candidates.filter(c => c.outsource).length,
    avg: detail.candidates.length
      ? Math.round(detail.candidates.reduce((s, c) => s + (c.score || 0), 0) / detail.candidates.length)
      : 0,
  } : null;

  const grouped = groupReportsByDate(reports);

  return (
    <div style={{ display: 'flex', gap: 20, height: 'calc(100vh - 124px)' }}>
      {/* Left: date-grouped report list */}
      <div style={{
        width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column',
        overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>历史报告</h2>
          {reports.length > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleSelectAll} style={{
                padding: '4px 12px', background: checkedIds.size === reports.length ? '#2e3554' : 'transparent',
                border: `1px solid ${checkedIds.size === reports.length ? '#6366f1' : '#4a5568'}`,
                color: checkedIds.size === reports.length ? '#818cf8' : '#8892a4',
                borderRadius: 6, fontSize: '0.78rem', cursor: 'pointer',
              }}>{checkedIds.size === reports.length ? '取消全选' : '全选'}</button>
              {checkedIds.size > 0 && (
                <button onClick={handleBatchDelete} style={{
                  padding: '4px 12px', background: 'transparent',
                  border: '1px solid #ef4444', color: '#ef4444',
                  borderRadius: 6, fontSize: '0.78rem', cursor: 'pointer',
                }}>删除 ({checkedIds.size})</button>
              )}
            </div>
          )}
        </div>
        {reports.length === 0 && (
          <div style={{ color: '#4a5568', fontSize: '0.9rem', marginTop: 20 }}>暂无报告</div>
        )}
        {[...grouped.entries()].map(([dateKey, jdMap]) => {
          const isDateExpanded = expandedDates.has(dateKey);
          const dateReportCount = [...jdMap.values()].reduce((s, l) => s + l.length, 0);
          const dateHasRunning = [...jdMap.values()].some(list => list.some(r => r.status === 'running'));
          return (
            <div key={dateKey} style={{ marginBottom: 6 }}>
              {/* Date header */}
              <div
                onClick={() => toggleDate(dateKey)}
                style={{
                  padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                  background: '#141825', border: '1px solid #2e3554',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#6366f1', fontSize: '0.78rem', flexShrink: 0 }}>
                    {isDateExpanded ? '▼' : '▶'}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#e2e8f0' }}>
                    {fmtDateLabel(dateKey)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {dateHasRunning && <span style={{ color: '#f59e0b', fontSize: '0.72rem' }}>⏳</span>}
                  <span style={{
                    padding: '1px 8px', background: '#2e3554', borderRadius: 10,
                    fontSize: '0.72rem', color: '#818cf8',
                  }}>
                    {dateReportCount}
                  </span>
                </div>
              </div>
              {/* Date content: JD groups */}
              {isDateExpanded && (
                <div style={{ marginTop: 4, marginLeft: 4 }}>
                  {[...jdMap.entries()].map(([jdName, list]) => {
                    const isGroupExpanded = expandedGroups.has(`${dateKey}::${jdName}`);
                    const hasRunning = list.some(r => r.status === 'running');
                    return (
                      <div key={jdName} style={{ marginBottom: 4 }}>
                        {/* JD sub-header */}
                        <div
                          onClick={() => toggleGroup(`${dateKey}::${jdName}`)}
                          style={{
                            padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                            background: '#1a1f2e', border: '1px solid #2e3554',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <span style={{ color: '#8892a4', fontSize: '0.72rem', flexShrink: 0 }}>
                              {isGroupExpanded ? '▼' : '▶'}
                            </span>
                            <span style={{
                              fontWeight: 500, fontSize: '0.82rem',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {jdName}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            {hasRunning && <span style={{ color: '#f59e0b', fontSize: '0.68rem' }}>⏳</span>}
                            <span style={{
                              padding: '1px 6px', background: '#2e3554', borderRadius: 10,
                              fontSize: '0.68rem', color: '#818cf8',
                            }}>
                              {list.length}
                            </span>
                          </div>
                        </div>
                        {/* Report items */}
                        {isGroupExpanded && (
                          <div style={{ marginTop: 2, marginLeft: 12 }}>
                            {list.map(r => (
                              <div key={r.id} style={{ marginBottom: 4 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                  <input
                                    type="checkbox"
                                    checked={checkedIds.has(r.id)}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCheckedIds(prev => {
                                        const next = new Set(prev);
                                        next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                                        return next;
                                      });
                                    }}
                                    style={{ accentColor: '#6366f1', flexShrink: 0, cursor: 'pointer' }}
                                  />
                                  <StatusBadge status={r.status} total={r.total} completed={r.completed} />
                                  <div style={{ flex: 1 }} />
                                  <button
                                    onClick={(e) => handleDelete(r.id, e)}
                                    style={{
                                      padding: '2px 6px', background: 'transparent',
                                      border: '1px solid #ef4444', color: '#ef4444',
                                      borderRadius: 4, fontSize: '0.68rem', flexShrink: 0,
                                    }}
                                  >删除</button>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginLeft: 20 }}>
                                  {(r.candidateNames || []).length > 0 ? r.candidateNames.map((name, ci) => {
                                    const rid = (r.candidateIds || [])[ci] || ci;
                                    const isActive = selected === r.id && selectedResumeId === rid;
                                    const shouldFlash = isActive && flashKey > 0;
                                    return (
                                      <div
                                        key={`${ci}-${shouldFlash ? flashKey : ''}`}
                                        onClick={() => {
                                          setSelected(r.id);
                                          setSelectedResumeId(rid);
                                          setFlashKey(k => k + 1);
                                        }}
                                        style={{
                                          padding: '4px 10px', borderRadius: 5, cursor: 'pointer',
                                          background: isActive ? '#232940' : '#161b2e',
                                          border: `1px solid ${isActive ? '#6366f1' : '#2e3554'}`,
                                          fontSize: '0.78rem', color: '#c9d1d9', fontWeight: 500,
                                          animation: shouldFlash ? 'candidate-flash 0.6s ease' : 'none',
                                          transition: 'background 0.15s, border 0.15s',
                                        }}
                                      >
                                        {name}
                                      </div>
                                    );
                                  }) : (
                                    <div
                                      onClick={() => setSelected(r.id)}
                                      style={{
                                        padding: '4px 10px', borderRadius: 5, cursor: 'pointer',
                                        background: selected === r.id ? '#232940' : '#161b2e',
                                        border: `1px solid ${selected === r.id ? '#6366f1' : '#2e3554'}`,
                                        fontSize: '0.78rem', color: '#8892a4',
                                      }}
                                    >
                                      {r.total} 位候选人
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Right: detail */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!detail ? (
          <div style={{ color: '#4a5568', textAlign: 'center', marginTop: 80, fontSize: '1rem' }}>
            👈 选择左侧报告查看详情
          </div>
        ) : (
          <div id="print-area">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <h2 style={{ fontSize: '1.2rem', marginBottom: 4 }}>📊 {detail.jdJobTitle || detail.jdName}</h2>
                <div style={{ color: '#8892a4', fontSize: '0.85rem' }}>
                  {fmtDate(detail.createdAt)} · <StatusBadge status={detail.status} total={detail.total} completed={detail.completed} />
                </div>
              </div>
              {detail.status === 'done' && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => window.open(analyzeApi.exportReport(detail.id))} style={{
                    padding: '8px 18px', background: '#10b981', color: '#fff',
                    border: 'none', borderRadius: 8, fontSize: '0.88rem', fontWeight: 500,
                  }}>📊 导出 Excel</button>
                  <button onClick={printReport} style={{
                    padding: '8px 18px', background: '#6366f1', color: '#fff',
                    border: 'none', borderRadius: 8, fontSize: '0.88rem', fontWeight: 500,
                  }}>🖨️ 打印 / 导出 PDF</button>
                </div>
              )}
            </div>

            {summary && detail.status !== 'error' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
                {[
                  { label: '推荐', value: summary.recommend, color: '#10b981', level: '推荐', type: 'level' },
                  { label: '备选', value: summary.maybe, color: '#f59e0b', level: '备选', type: 'level' },
                  { label: '不推荐', value: summary.no, color: '#ef4444', level: '不推荐', type: 'level' },
                  { label: '有外包经历', value: summary.outsource, color: '#f97316', level: null, type: 'outsource' },
                  { label: '候选人总数', value: summary.total, color: '#818cf8', level: null, type: null },
                ].map(item => {
                  const active = item.type === 'level' ? filterLevel === item.level : item.type === 'outsource' ? filterOutsource : false;
                  return (
                    <div
                      key={item.label}
                      onClick={() => {
                        if (item.type === 'level') {
                          setFilterLevel(active ? null : item.level);
                          setFilterOutsource(false);
                        } else if (item.type === 'outsource') {
                          setFilterOutsource(!active);
                          setFilterLevel(null);
                        }
                      }}
                      style={{
                        background: active ? '#232940' : '#1a1f2e',
                        border: `1px solid ${active ? item.color : '#2e3554'}`,
                        borderRadius: 10,
                        padding: '16px',
                        textAlign: 'center',
                        cursor: item.type ? 'pointer' : 'default',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: '1.8rem', fontWeight: 700, color: item.color }}>{item.value}</div>
                      <div style={{ fontSize: '0.82rem', color: '#8892a4', marginTop: 4 }}>{item.label}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {detail.status === 'running' && (
              <div style={{ background: '#1a1f2e', border: '1px solid #2e3554', borderRadius: 10, padding: 20, marginBottom: 20 }}>
                <div style={{ marginBottom: 10, color: '#f59e0b' }}>⏳ 正在分析 {detail.completed}/{detail.total} 份简历...</div>
                <div style={{ height: 8, background: '#2e3554', borderRadius: 4 }}>
                  <div style={{
                    width: `${detail.total ? (detail.completed / detail.total * 100) : 0}%`,
                    height: '100%', background: '#6366f1', borderRadius: 4, transition: 'width 0.3s',
                  }} />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {detail.candidates
                .filter(c => (!filterLevel || c.level === filterLevel) && (!filterOutsource || c.outsource))
                .map((c, i) => (
                <div
                  key={`${c.resumeId}-${selectedResumeId === c.resumeId ? flashKey : ''}`}
                  id={`candidate-${c.resumeId}`}
                  style={{
                    background: '#1a1f2e', border: '1px solid #2e3554', borderRadius: 12, padding: 20,
                    animation: selectedResumeId === c.resumeId && flashKey > 0 ? 'card-flash 0.6s ease' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.name}
                        </span>
                        {c.outsource && (
                          <span style={{
                            padding: '2px 10px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600,
                            background: '#3b1a0d', color: '#f97316',
                            border: '1px solid #f97316', flexShrink: 0,
                          }}>
                            外包经历{c.outsourceCompanies?.length ? `：${c.outsourceCompanies.join('、')}` : ''}
                          </span>
                        )}
                      </div>
                      <ScoreBar score={c.score || 0} />
                    </div>
                    <span style={{
                      padding: '4px 12px', borderRadius: 20, fontSize: '0.82rem', fontWeight: 600,
                      background: levelBg[c.level] || '#1a1f2e',
                      color: levelColor[c.level] || '#8892a4',
                      border: `1px solid ${levelColor[c.level] || '#2e3554'}`,
                      flexShrink: 0,
                    }}>
                      {c.level}
                    </span>
                  </div>

                  {/* Keyword tags */}
                  {((c.strengthKeywords || []).length > 0 || (c.weaknessKeywords || []).length > 0) && (
                    <div style={{
                      marginBottom: 14, padding: 12, background: '#232940',
                      border: '1px solid #2e3554', borderRadius: 8,
                      display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
                    }}>
                      {(c.strengthKeywords || []).map((kw, j) => (
                        <span key={`s${j}`} style={{
                          padding: '3px 10px', borderRadius: 6, fontSize: '0.8rem',
                          background: '#0d2b1f', color: '#34d399',
                          border: '1px solid #10b981',
                        }}>
                          {kw}
                        </span>
                      ))}
                      {(c.weaknessKeywords || []).map((kw, j) => (
                        <span key={`w${j}`} style={{
                          padding: '3px 10px', borderRadius: 6, fontSize: '0.8rem',
                          background: '#2b0d0d', color: '#f87171',
                          border: '1px solid #ef4444',
                        }}>
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}

                  <p style={{ color: '#c0caf5', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: 14 }}>
                    {c.summary}
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <div style={{ color: '#10b981', fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>✅ 优势</div>
                      {(c.strengths || []).map((s, j) => (
                        <div key={j} style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: 4, paddingLeft: 8, borderLeft: '2px solid #10b981' }}>
                          {s}
                        </div>
                      ))}
                    </div>
                    <div>
                      <div style={{ color: '#ef4444', fontSize: '0.82rem', fontWeight: 600, marginBottom: 6 }}>⚠️ 差距</div>
                      {(c.gaps || []).length === 0
                        ? <div style={{ fontSize: '0.85rem', color: '#4a5568' }}>无明显差距</div>
                        : (c.gaps || []).map((g, j) => (
                          <div key={j} style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: 4, paddingLeft: 8, borderLeft: '2px solid #ef4444' }}>
                            {g}
                          </div>
                        ))
                      }
                    </div>
                  </div>

                  {/* Career Potential Section */}
                  {c.level !== '分析失败' && (
                    <div style={{ marginTop: 14 }}>
                      {c.careerPotential && (c.careerPotential.careerDirections || []).length > 0 && (
                        <div style={{
                          padding: 12, background: '#1a1a2e', border: '1px solid #3b2e7a',
                          borderRadius: 8, marginBottom: 10,
                        }}>
                          <div style={{ color: '#a78bfa', fontSize: '0.82rem', fontWeight: 600, marginBottom: 8 }}>
                            🧭 潜在职业方向
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: c.careerPotential.careerReason ? 8 : 0 }}>
                            {(c.careerPotential.careerDirections || []).map((dir, j) => (
                              <span key={j} style={{
                                padding: '4px 12px', borderRadius: 6, fontSize: '0.82rem',
                                background: '#2d1f69', color: '#c4b5fd',
                                border: '1px solid #6d28d9',
                              }}>
                                {dir}
                              </span>
                            ))}
                          </div>
                          {c.careerPotential.careerReason && (
                            <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontStyle: 'italic', marginTop: 6 }}>
                              {c.careerPotential.careerReason}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Interview questions per candidate */}
                  {c.level !== '分析失败' && (
                    <div style={{ marginTop: 14 }}>
                      <button onClick={() => {
                        if (c.interviewQuestions) { toggleQuestions(c.resumeId); return; }
                        handleGenerateQuestions(c.resumeId);
                      }} disabled={loadingQuestions.has(c.resumeId)} style={{
                        padding: '4px 14px', background: loadingQuestions.has(c.resumeId) ? '#4a5568' : 'transparent',
                        border: `1px solid ${c.interviewQuestions ? '#f59e0b' : '#4a5568'}`,
                        color: loadingQuestions.has(c.resumeId) ? '#8892a4' : c.interviewQuestions ? '#f59e0b' : '#8892a4',
                        borderRadius: 6, fontSize: '0.78rem', cursor: loadingQuestions.has(c.resumeId) ? 'not-allowed' : 'pointer',
                      }}>
                        {loadingQuestions.has(c.resumeId) ? '生成中...' : c.interviewQuestions ? (expandedQuestions.has(c.resumeId) ? '🎯 收起HR面试问题' : '🎯 展开HR面试问题') : '🎯 生成HR面试问题'}
                      </button>
                      {c.interviewQuestions && expandedQuestions.has(c.resumeId) && (
                        <div style={{ marginTop: 10, padding: 12, background: '#232940', border: '1px solid #f59e0b', borderRadius: 8 }}>
                          {(c.interviewQuestions.questions || []).map((q, j) => (
                            <div key={j} style={{ marginBottom: 8, padding: '8px 12px', background: '#1a1f2e', borderRadius: 6, border: '1px solid #2e3554' }}>
                              <div style={{ fontSize: '0.85rem', color: '#e2e8f0', marginBottom: 3 }}>
                                <span style={{ color: '#f59e0b', fontWeight: 600, marginRight: 6 }}>Q{j + 1}.</span>
                                {q.question}
                              </div>
                              <div style={{ fontSize: '0.78rem', color: '#8892a4', paddingLeft: 24 }}>
                                考察目的：{q.purpose}
                                {q.category && <span style={{ marginLeft: 8, padding: '1px 6px', background: '#2e3554', borderRadius: 4, fontSize: '0.7rem', color: '#818cf8' }}>{q.category}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes candidate-flash {
          0% { box-shadow: 0 0 0 0 rgba(99,102,241,0.7); }
          30% { box-shadow: 0 0 12px 4px rgba(99,102,241,0.5); }
          100% { box-shadow: 0 0 0 0 rgba(99,102,241,0); }
        }
        @keyframes card-flash {
          0% { box-shadow: 0 0 0 0 rgba(99,102,241,0.6); border-color: #6366f1; }
          30% { box-shadow: 0 0 16px 4px rgba(99,102,241,0.4); border-color: #818cf8; }
          100% { box-shadow: 0 0 0 0 rgba(99,102,241,0); border-color: #2e3554; }
        }
        @media print {
          body { background: white; color: black; }
          header, .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}

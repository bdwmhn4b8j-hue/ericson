import React, { useRef, useState } from 'react';

export default function FileDropZone({ onFiles, accept = '.pdf,.doc,.docx,.txt', multiple = true, label }) {
  const inputRef = useRef();
  const [dragging, setDragging] = useState(false);

  const handle = (files) => {
    if (files?.length) onFiles(Array.from(files));
  };

  return (
    <div
      onClick={() => inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files); }}
      style={{
        border: `2px dashed ${dragging ? '#6366f1' : '#2e3554'}`,
        borderRadius: 10,
        padding: '32px 24px',
        textAlign: 'center',
        cursor: 'pointer',
        background: dragging ? '#1e2340' : '#1a1f2e',
        transition: 'all 0.2s',
      }}
    >
      <div style={{ fontSize: '2rem', marginBottom: 8 }}>📁</div>
      <div style={{ color: '#8892a4', fontSize: '0.9rem' }}>
        {label || '点击或拖拽文件到此处上传'}
        <br />
        <span style={{ fontSize: '0.8rem' }}>支持 PDF、Word、TXT 格式</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={(e) => handle(e.target.files)}
      />
    </div>
  );
}

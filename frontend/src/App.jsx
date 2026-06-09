import React from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import JDManager from './pages/JDManager.jsx';
import ResumeScreen from './pages/ResumeScreen.jsx';
import Reports from './pages/Reports.jsx';

const navStyle = ({ isActive }) => ({
  padding: '10px 20px',
  borderRadius: '8px',
  textDecoration: 'none',
  fontWeight: 500,
  fontSize: '0.95rem',
  color: isActive ? '#fff' : '#8892a4',
  background: isActive ? '#6366f1' : 'transparent',
  transition: 'all 0.2s',
});

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header style={{
          background: '#1a1f2e',
          borderBottom: '1px solid #2e3554',
          padding: '0 32px',
          display: 'flex',
          alignItems: 'center',
          gap: 32,
          height: 60,
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}>
          <span style={{ fontWeight: 700, fontSize: '1.1rem', color: '#818cf8', letterSpacing: 1 }}>
            📋 简历筛选系统
          </span>
          <nav style={{ display: 'flex', gap: 8 }}>
            <NavLink to="/" end style={navStyle}>岗位 JD</NavLink>
            <NavLink to="/screen" style={navStyle}>简历筛选</NavLink>
            <NavLink to="/reports" style={navStyle}>分析报告</NavLink>
          </nav>
        </header>

        <main style={{ flex: 1, padding: '32px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
          <Routes>
            <Route path="/" element={<JDManager />} />
            <Route path="/screen" element={<ResumeScreen />} />
            <Route path="/reports" element={<Reports />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

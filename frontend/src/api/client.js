import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

export const jdApi = {
  list: () => api.get('/jds'),
  upload: (files) => {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    return api.post('/jds/upload', fd);
  },
  remove: (id) => api.delete(`/jds/${id}`),
  batchRemove: (ids) => api.delete('/jds/batch', { data: { ids } }),
  getContent: (id) => api.get(`/jds/${id}/content`),
  createByText: (jobTitle, jdText, force = false) => api.post('/jds/text', { jobTitle, jdText, force }),
};

export const resumeApi = {
  list: () => api.get('/resumes'),
  upload: (files) => {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    return api.post('/resumes/upload', fd);
  },
  remove: (id) => api.delete(`/resumes/${id}`),
};

export const analyzeApi = {
  start: (jdId, resumeIds) => api.post('/analyze', { jdId, resumeIds }),
  startAutoMatch: (resumeIds) => api.post('/analyze', { resumeIds, autoMatch: true }),
  listReports: () => api.get('/reports'),
  getReport: (id) => api.get(`/reports/${id}`),
  deleteReport: (id) => api.delete(`/reports/${id}`),
  exportReport: (id) => `/api/reports/${id}/export`,
  interviewQuestions: (id, resumeId) => api.post(`/reports/${id}/interview-questions`, { resumeId }),
};

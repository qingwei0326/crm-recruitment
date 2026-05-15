const path = require('path');

const cwd = 'D:/招生系统';
const python = process.env.CRM_PYTHON || path.join(cwd, '.venv-win', 'Scripts', 'python.exe');

module.exports = {
  apps: [{
    name: 'crm-backend',
    cwd,
    script: python,
    args: '-m uvicorn app.main:app --host 127.0.0.1 --port 8000',
    env: {
      DATABASE_PATH: path.join(cwd, 'crm.db'),
      FRONTEND_DIR: path.join(cwd, 'frontend', 'dist'),
      SECRET_KEY: process.env.SECRET_KEY,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
      CORS_ORIGINS: process.env.CORS_ORIGINS || 'http://127.0.0.1:8000,http://localhost:8000',
    },
    watch: false,
    time: true,
  }],
};

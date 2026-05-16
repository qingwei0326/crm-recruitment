const path = require('path');
const fs = require('fs');

const cwd = __dirname;
const pythonCandidates = [
  path.join(cwd, '.venv-win', 'Scripts', 'pythonw.exe'),
  path.join(cwd, '.venv-win', 'Scripts', 'python.exe'),
  path.join(cwd, 'venv', 'Scripts', 'pythonw.exe'),
  path.join(cwd, 'venv', 'Scripts', 'python.exe'),
];
const defaultPython = pythonCandidates.find((candidate) => fs.existsSync(candidate));
const envPython = process.env.CRM_PYTHON;
const envPythonDir = envPython && path.isAbsolute(envPython) ? path.dirname(envPython) : '';
const envPythonw = envPythonDir ? path.join(envPythonDir, 'pythonw.exe') : '';
const libreOfficePythonw = envPythonDir
  ? fs.readdirSync(envPythonDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('python-core-'))
    .map((entry) => path.join(envPythonDir, entry.name, 'bin', 'pythonw.exe'))
    .find((candidate) => fs.existsSync(candidate))
  : '';
const python = (envPythonw && fs.existsSync(envPythonw)) ? envPythonw : (libreOfficePythonw || envPython || defaultPython || 'pythonw');
const secretKeyFile = path.join(cwd, '.secret_key');
const defaultSecret = fs.existsSync(secretKeyFile) ? fs.readFileSync(secretKeyFile, 'utf8').trim() : '';
const pyDeps = path.join(cwd, '.pydeps');
const pythonPath = [pyDeps, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
const host = process.env.CRM_HOST || '0.0.0.0';

module.exports = {
  apps: [
    {
      name: 'crm-backend',
      cwd,
      script: python,
      args: `-m uvicorn app.main:app --host ${host} --port 8000`,
      env: {
        DATABASE_PATH: path.join(cwd, 'crm.db'),
        FRONTEND_DIR: path.join(cwd, 'frontend', 'dist'),
        SECRET_KEY: process.env.SECRET_KEY || defaultSecret,
        PYTHONNOUSERSITE: process.env.PYTHONNOUSERSITE || '1',
        PYTHONPATH: pythonPath,
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
        CORS_ORIGINS: process.env.CORS_ORIGINS || 'http://127.0.0.1:8000,http://localhost:8000,http://192.168.8.2:8000',
      },
      watch: false,
      time: true,
      windowsHide: true,
    },
    {
      name: 'crm-lan-forward',
      cwd,
      script: path.join(cwd, 'forward.js'),
      interpreter: 'node',
      env: {
        CRM_LAN_HOST: process.env.CRM_LAN_HOST || '192.168.8.2',
      },
      watch: false,
      time: true,
      windowsHide: true,
    },
  ],
};

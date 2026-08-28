import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

console.log('🚀 Starting AI-Cortex Development Services...\n');

// Start Express Backend on :3001
const serverProcess = spawn('node', ['core/api/server.js'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, PORT: '3001' }
});

// Start Vite Dev Server on :5173
const clientProcess = spawn('npx', ['vite', 'client', '--port', '5173'], {
  cwd: projectRoot,
  stdio: 'inherit'
});

const cleanup = () => {
  console.log('\nStopping AI-Cortex services...');
  serverProcess.kill('SIGINT');
  clientProcess.kill('SIGINT');
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

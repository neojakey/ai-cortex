import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const nodeBinary = process.execPath || 'node';
const serverScript = path.join(projectRoot, 'core/api/server.js');
const envFile = path.join(projectRoot, '.env');
const launcherScript = path.join(projectRoot, 'scripts/open-ai-cortex.sh');
const iconPath = path.join(projectRoot, 'client/public/logo-512.png');

function run(cmd, args) {
  return spawnSync(cmd, args, { stdio: 'inherit' });
}

function installSystemdService() {
  const unitDir = path.join(os.homedir(), '.config/systemd/user');
  const unitPath = path.join(unitDir, 'ai-cortex.service');

  const unit = `[Unit]
Description=AI-Cortex API + Client
After=network.target mysqld.service mariadb.service

[Service]
Type=simple
WorkingDirectory=${projectRoot}
EnvironmentFile=${envFile}
ExecStart=${nodeBinary} ${serverScript}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`;

  fs.mkdirSync(unitDir, { recursive: true });
  fs.writeFileSync(unitPath, unit, 'utf8');
  console.log(`[setup:desktop] Wrote systemd user unit to ${unitPath}`);

  if (!fs.existsSync(envFile)) {
    console.log('[setup:desktop] Warning: .env not found — copy .env.example to .env before starting the service.');
    return;
  }

  const hasSystemctl = !spawnSync('systemctl', ['--version'], { stdio: 'ignore' }).error;
  if (!hasSystemctl) {
    console.log('[setup:desktop] `systemctl` not found — start the server manually, or install systemd.');
    return;
  }

  run('systemctl', ['--user', 'daemon-reload']);
  run('systemctl', ['--user', 'enable', '--now', 'ai-cortex.service']);
  console.log('[setup:desktop] AI-Cortex server enabled to start at login and started now.');
}

function installDesktopEntry() {
  const entry = `[Desktop Entry]
Type=Application
Version=1.0
Name=AI-Cortex
GenericName=Shared AI memory
Comment=Open AI-Cortex in your browser
Exec=bash -lc "${launcherScript}"
Icon=${iconPath}
Terminal=false
Categories=Utility;Office;
Keywords=notes;ai;mcp;claude;memory;
StartupNotify=true
`;

  const targets = [
    path.join(os.homedir(), '.local/share/applications/ai-cortex.desktop'),
    path.join(os.homedir(), 'Desktop/ai-cortex.desktop')
  ];

  for (const target of targets) {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) continue; // e.g. no ~/Desktop on this machine — skip, not an error
    fs.writeFileSync(target, entry, 'utf8');
    fs.chmodSync(target, 0o755);
    console.log(`[setup:desktop] Wrote desktop entry to ${target}`);

    // GNOME/Nautilus refuses to launch a Desktop icon until it's marked trusted.
    const hasGio = !spawnSync('gio', ['--version'], { stdio: 'ignore' }).error;
    if (hasGio && target.includes(`${path.sep}Desktop${path.sep}`)) {
      spawnSync('gio', ['set', target, 'metadata::trusted', 'true'], { stdio: 'ignore' });
    }
  }
}

installSystemdService();
installDesktopEntry();

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const mcpScriptPath = path.resolve(projectRoot, 'core/mcp/index.js');
const nodeBinary = process.execPath || 'node';

const NOTE_POLICY_MARKER = '<!-- ai-cortex:note-policy -->';

function registerMcpServer() {
  const claudeCheck = spawnSync('claude', ['--version'], { stdio: 'ignore' });
  if (claudeCheck.error) {
    console.log('[setup:claude-code] `claude` CLI not found on PATH. Run this manually once it is installed:\n');
    console.log(`  claude mcp add --scope user ai-cortex -- ${nodeBinary} ${mcpScriptPath}\n`);
    return;
  }

  console.log('[setup:claude-code] Registering AI-Cortex as a user-scoped MCP server...');
  const result = spawnSync(
    'claude',
    ['mcp', 'add', '--scope', 'user', 'ai-cortex', '--', nodeBinary, mcpScriptPath],
    { stdio: 'inherit' }
  );

  if (result.status !== 0) {
    console.log('\n[setup:claude-code] `claude mcp add` did not exit cleanly (it may already be registered — that is fine).');
  }
}

function installNotePolicy() {
  const claudeMdPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');
  const policySourcePath = path.resolve(projectRoot, 'docs/claude-code-note-policy.md');
  const policyText = fs.readFileSync(policySourcePath, 'utf8').trim();

  let existing = '';
  if (fs.existsSync(claudeMdPath)) {
    existing = fs.readFileSync(claudeMdPath, 'utf8');
  }

  if (existing.includes(NOTE_POLICY_MARKER)) {
    console.log('[setup:claude-code] Note-taking policy already present in ~/.claude/CLAUDE.md — skipping.');
    return;
  }

  const block = `${NOTE_POLICY_MARKER}\n${policyText}\n`;
  const updated = existing.trim() ? `${existing.trim()}\n\n${block}` : `${block}`;

  fs.mkdirSync(path.dirname(claudeMdPath), { recursive: true });
  fs.writeFileSync(claudeMdPath, updated, 'utf8');
  console.log(`[setup:claude-code] Added note-taking policy to ${claudeMdPath}`);
}

registerMcpServer();
installNotePolicy();

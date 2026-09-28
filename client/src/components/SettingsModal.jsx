import React, { useState, useEffect } from 'react';
import { THUMB_SIZES, getDefaultThumbSize, setDefaultThumbSize } from '../lib/prefs.js';
import { 
  X, 
  Cpu, 
  Database, 
  Download, 
  Upload, 
  Check, 
  Copy, 
  Terminal, 
  HardDrive,
  Sparkles,
  Layers,
  Wrench,
  Settings,
  Sun,
  Moon,
  Laptop,
  Palette,
  Trash2,
  AlertTriangle,
  RefreshCw,
  Loader2
} from 'lucide-react';

import ThemePalettePicker from './ThemePalettePicker.jsx';

export default function SettingsModal({
  isOpen,
  onClose,
  health,
  onRefreshData,
  themeMode = 'system',
  resolvedTheme = 'dark',
  onSelectThemeMode,
  colorScheme,
  customColor,
  onSelectScheme,
  onSelectCustomColor
}) {
  const [thumbDefault, setThumbDefault] = useState(getDefaultThumbSize);
  const [activeTab, setActiveTab] = useState('theme'); // 'theme', 'ai', 'db', 'vault'
  const [mcpConfig, setMcpConfig] = useState(null);
  const [copiedClaude, setCopiedClaude] = useState(false);
  const [copiedGemini, setCopiedGemini] = useState(false);
  const [autoInstallStatus, setAutoInstallStatus] = useState(null);
  const [autoInstallGeminiStatus, setAutoInstallGeminiStatus] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const [backups, setBackups] = useState([]);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupError, setBackupError] = useState(null);
  const [backupInfo, setBackupInfo] = useState(null);
  const [restoreTarget, setRestoreTarget] = useState(null); // { kind: 'file'|'existing', file?, filename?, label }
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState(null);
  const dbName = health?.db?.database || 'ai_cortex';

  const refreshBackups = () => {
    fetch('/api/admin/backups')
      .then((r) => r.json())
      .then((d) => setBackups(d.backups || []))
      .catch(() => {});
  };

  useEffect(() => {
    if (isOpen) refreshBackups();
  }, [isOpen]);

  const handleCreateBackup = async () => {
    setIsBackingUp(true);
    setBackupError(null);
    setBackupInfo(null);
    try {
      const res = await fetch('/api/admin/backup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Backup failed');
      // Also hand the file to the browser as a download, same file already saved server-side.
      const a = document.createElement('a');
      a.href = `/api/admin/backups/${encodeURIComponent(data.backup.filename)}/download`;
      a.download = data.backup.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      const att = data.backup.attachments;
      if (data.backup.attachmentsError) {
        setBackupError(`Database backed up, but attachment files were not: ${data.backup.attachmentsError}`);
      } else if (att) {
        setBackupInfo(`Database backed up. Attachment files: ${att.copied} new copied, ${att.total} in total.`);
      }
      refreshBackups();
    } catch (err) {
      setBackupError(err.message);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleDeleteBackup = async (filename) => {
    await fetch(`/api/admin/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    refreshBackups();
  };

  const openRestoreConfirm = (target) => {
    setRestoreTarget(target);
    setRestoreConfirmText('');
    setRestoreResult(null);
  };

  const handleRestore = async () => {
    if (!restoreTarget || restoreConfirmText !== dbName) return;
    setIsRestoring(true);
    setRestoreResult(null);
    try {
      const formData = new FormData();
      formData.append('confirm', restoreConfirmText);
      if (restoreTarget.kind === 'file') {
        formData.append('dump', restoreTarget.file);
      } else {
        formData.append('filename', restoreTarget.filename);
      }
      const res = await fetch('/api/admin/restore', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Restore failed');
      const att = data.attachments;
      let attNote = '';
      if (att && !att.error) {
        if (att.restored) attNote = ` ${att.restored} missing attachment file(s) were copied back.`;
        if (att.stillMissing) attNote += ` ${att.stillMissing} attachment file(s) are still missing and could not be recovered.`;
      } else if (att && att.error) {
        attNote = ` Attachment check failed: ${att.error}`;
      }
      setRestoreResult({ ok: !(att && (att.stillMissing || att.error)), message: `Restored. A safety backup of the previous data was saved as ${data.safetyBackup}.${attNote}` });
      setRestoreTarget(null);
      refreshBackups();
      onRefreshData();
    } catch (err) {
      setRestoreResult({ ok: false, message: err.message });
    } finally {
      setIsRestoring(false);
    }
  };

  const formatBytes = (n) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  useEffect(() => {
    if (isOpen) {
      fetch('/api/settings/mcp-config')
        .then((res) => res.json())
        .then((data) => setMcpConfig(data))
        .catch(console.error);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyClaudeConfig = () => {
    if (!mcpConfig) return;
    navigator.clipboard.writeText(JSON.stringify(mcpConfig.claudeConfig, null, 2));
    setCopiedClaude(true);
    setTimeout(() => setCopiedClaude(false), 2000);
  };

  const handleCopyGeminiConfig = () => {
    if (!mcpConfig) return;
    navigator.clipboard.writeText(JSON.stringify(mcpConfig.geminiConfig, null, 2));
    setCopiedGemini(true);
    setTimeout(() => setCopiedGemini(false), 2000);
  };

  const handleAutoInstallClaude = async () => {
    setAutoInstallStatus('Installing...');
    try {
      const res = await fetch('/api/settings/install-claude-config', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setAutoInstallStatus('Installed successfully!');
      } else {
        setAutoInstallStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      setAutoInstallStatus(`Failed: ${err.message}`);
    }
    setTimeout(() => setAutoInstallStatus(null), 4000);
  };

  const handleAutoInstallGemini = async () => {
    setAutoInstallGeminiStatus('Activating...');
    try {
      const res = await fetch('/api/settings/install-gemini-config', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setAutoInstallGeminiStatus('Activated!');
      } else {
        setAutoInstallGeminiStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      setAutoInstallGeminiStatus(`Failed: ${err.message}`);
    }
    setTimeout(() => setAutoInstallGeminiStatus(null), 4000);
  };

  const handleImportVault = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportResult(null);

    const formData = new FormData();
    formData.append('vaultZip', file);

    try {
      const res = await fetch('/api/vault/import', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      setImportResult(`Successfully imported ${data.importedNotes} notes and ${data.importedAttachments} attachments!`);
      onRefreshData();
    } catch (err) {
      setImportResult(`Import error: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Settings size={18} color="var(--accent-primary)" />
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>Settings</h3>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-dim)', padding: '0 24px', gap: 8 }}>
          {[
            { id: 'theme', label: 'Appearance' },
            { id: 'ai', label: 'AI Integrations' },
            { id: 'db', label: 'Database' },
            { id: 'vault', label: 'Vault Sync' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === tab.id ? 'var(--text-main)' : 'var(--text-muted)',
                padding: '12px 18px',
                fontSize: 13.5,
                fontWeight: activeTab === tab.id ? 600 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {/* TAB 1: Claude & Gemini AI */}
          {activeTab === 'ai' && (
            <>
              <div>
                <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>
                  Connect Your Monthly Claude & Gemini Subscriptions
                </h4>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  AI-Cortex ships with a high-performance **Model Context Protocol (MCP)** server.
                  This allows Claude Desktop (using your Claude Pro subscription) and Gemini to query, read,
                  link, and update your notes natively over <code>stdio</code> with <strong>zero API keys and no token fees</strong>.
                </p>
              </div>

              {/* Claude Desktop Section */}
              <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-dim)', borderRadius: 'var(--radius-md)', padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Sparkles size={16} color="#c084fc" />
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>Claude Desktop Integration</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn-primary"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={handleAutoInstallClaude}
                    >
                      {autoInstallStatus || '1-Click Auto Install'}
                    </button>
                    <button
                      className="search-trigger-btn"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={handleCopyClaudeConfig}
                    >
                      {copiedClaude ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                      <span>{copiedClaude ? 'Copied' : 'Copy JSON'}</span>
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Configuration file path on your system:
                  <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginTop: 2 }}>
                    {mcpConfig?.detectedPath || 'Detecting...'}
                  </div>
                </div>

                <pre style={{
                  background: 'rgba(0, 0, 0, 0.4)',
                  padding: 12,
                  borderRadius: 6,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  color: '#93c5fd',
                  overflowX: 'auto'
                }}>
                  {mcpConfig ? JSON.stringify(mcpConfig.claudeConfig, null, 2) : 'Loading...'}
                </pre>
              </div>

              {/* Gemini / Antigravity Section */}
              <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border-dim)', borderRadius: 'var(--radius-md)', padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Cpu size={16} color="#60a5fa" />
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>Gemini / Antigravity IDE Integration</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn-primary"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={handleAutoInstallGemini}
                    >
                      {autoInstallGeminiStatus || '1-Click Enable for Gemini'}
                    </button>
                    <button
                      className="search-trigger-btn"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={handleCopyGeminiConfig}
                    >
                      {copiedGemini ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                      <span>{copiedGemini ? 'Copied' : 'Copy JSON'}</span>
                    </button>
                  </div>
                </div>

                <p style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
                  Registers AI-Cortex in your workspace (<code>.agents/mcp_config.json</code>). Gemini and Antigravity can automatically query, search, and update your notes during pair programming sessions with zero API keys.
                </p>

                <pre style={{
                  background: 'rgba(0, 0, 0, 0.4)',
                  padding: 12,
                  borderRadius: 6,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  color: '#93c5fd',
                  overflowX: 'auto'
                }}>
                  {mcpConfig ? JSON.stringify(mcpConfig.geminiConfig, null, 2) : 'Loading...'}
                </pre>
              </div>
            </>
          )}

          {/* TAB: Color Schemes & Theme Modes */}
          {activeTab === 'theme' && (
            <>
              <div>
                <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>
                  Visual Identity & Palette Harmony
                </h4>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  Choose your base ambiance (Obsidian Deep Carbon or Warm Alabaster Archival Paper)
                  and select from 15 curated color palettes or use the eyedropper for custom branding.
                </p>
              </div>

              <div>
                <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>
                  Attachment thumbnails
                </h4>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 10 }}>
                  The size used when you open a note. You can still switch size on any note; that only lasts until you open another.
                </p>
                <div className="view-mode-toggle" role="group" aria-label="Default thumbnail size" style={{ display: 'inline-flex' }}>
                  {THUMB_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={`view-mode-btn ${thumbDefault === size ? 'active' : ''}`}
                      onClick={() => { setThumbDefault(size); setDefaultThumbSize(size); }}
                    >
                      {size[0].toUpperCase() + size.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mode Toggle Banner */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px',
                background: 'var(--bg-app)',
                border: '1px solid var(--border-dim)',
                borderRadius: 'var(--radius-md)'
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Theme Ambiance</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {themeMode === 'system'
                      ? `System default (matching OS: ${resolvedTheme === 'dark' ? 'Dark' : 'Light'})`
                      : themeMode === 'dark'
                      ? 'Dark (Obsidian Deep Carbon)'
                      : 'Light (Warm Alabaster Archival)'}
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  gap: 4,
                  background: 'var(--bg-surface)',
                  padding: 4,
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-dim)'
                }}>
                  <button
                    type="button"
                    style={{
                      background: themeMode === 'light' ? 'var(--accent-primary)' : 'transparent',
                      color: themeMode === 'light' ? 'var(--accent-contrast, #ffffff)' : 'var(--text-secondary)',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 12.5,
                      fontWeight: 600,
                      padding: '6px 13px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer',
                      boxShadow: themeMode === 'light' ? '0 2px 8px var(--accent-glow)' : 'none',
                      transition: 'all 0.15s ease'
                    }}
                    onClick={() => onSelectThemeMode('light')}
                  >
                    <Sun size={14} color={themeMode === 'light' ? 'var(--accent-contrast, #ffffff)' : 'var(--text-secondary)'} />
                    <span>Light</span>
                  </button>

                  <button
                    type="button"
                    style={{
                      background: themeMode === 'dark' ? 'var(--accent-primary)' : 'transparent',
                      color: themeMode === 'dark' ? 'var(--accent-contrast, #ffffff)' : 'var(--text-secondary)',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 12.5,
                      fontWeight: 600,
                      padding: '6px 13px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer',
                      boxShadow: themeMode === 'dark' ? '0 2px 8px var(--accent-glow)' : 'none',
                      transition: 'all 0.15s ease'
                    }}
                    onClick={() => onSelectThemeMode('dark')}
                  >
                    <Moon size={14} color={themeMode === 'dark' ? 'var(--accent-contrast, #ffffff)' : 'var(--text-secondary)'} />
                    <span>Dark</span>
                  </button>

                  <button
                    type="button"
                    style={{
                      background: themeMode === 'system' ? 'var(--accent-primary)' : 'transparent',
                      color: themeMode === 'system' ? 'var(--accent-contrast, #ffffff)' : 'var(--text-secondary)',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 12.5,
                      fontWeight: 600,
                      padding: '6px 13px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer',
                      boxShadow: themeMode === 'system' ? '0 2px 8px var(--accent-glow)' : 'none',
                      transition: 'all 0.15s ease'
                    }}
                    onClick={() => onSelectThemeMode('system')}
                  >
                    <Laptop size={14} color={themeMode === 'system' ? 'var(--accent-contrast, #ffffff)' : 'var(--text-secondary)'} />
                    <span>System</span>
                  </button>
                </div>
              </div>

              {/* 16-Swatch Color Scheme Grid */}
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 12 }}>
                  Color Scheme Accent (16 Curated Harmonies)
                </div>
                <ThemePalettePicker
                  activeSchemeId={colorScheme}
                  isDark={resolvedTheme === 'dark'}
                  customColor={customColor}
                  onSelectScheme={onSelectScheme}
                  onSelectCustomColor={onSelectCustomColor}
                />
              </div>
            </>
          )}

          {/* TAB 2: MySQL 8.4 Telemetry */}
          {activeTab === 'db' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                <div style={{ background: 'var(--bg-app)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-dim)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>MySQL 8.4 Connection</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-emerald)', marginTop: 4 }}>
                    {health?.db?.connected ? 'Connected' : 'Offline'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                    Query ping: {health?.db?.latencyMs} ms
                  </div>
                </div>

                <div style={{ background: 'var(--bg-app)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-dim)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Database Name</div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
                    {health?.db?.database || 'ai_cortex'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                    InnoDB engine • utf8mb4
                  </div>
                </div>

                <div style={{ background: 'var(--bg-app)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-dim)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Notes & Relations</div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
                    {health?.counts?.activeNotes || 0} Active Notes
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                    {health?.counts?.totalLinks || 0} Indexed Graph Links
                  </div>
                </div>

                <div style={{ background: 'var(--bg-app)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-dim)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Attachment Storage</div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
                    {Math.round((health?.storage?.totalBytes || 0) / 1024)} KB
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                    {health?.storage?.totalAttachments || 0} Deduplicated Files
                  </div>
                </div>
              </div>

              {/* Backup & Restore */}
              <div style={{ marginTop: 8 }}>
                <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>
                  Backup & Restore
                </h4>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
                  A backup is a full dump of the <code>{dbName}</code> database (every note, tag, project and link). Attachment files are
                  copied to a backup folder alongside it, only the new ones each time. Restoring replaces everything currently in the database;
                  a safety copy of what was there is always taken first, and any attachment file that has gone missing is copied back.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <button className="btn-primary" onClick={handleCreateBackup} disabled={isBackingUp}>
                    {isBackingUp ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
                    <span>{isBackingUp ? 'Backing up…' : 'Backup Now'}</span>
                  </button>
                  <label className="search-trigger-btn" style={{ cursor: isRestoring ? 'default' : 'pointer', opacity: isRestoring ? 0.6 : 1 }}>
                    <Upload size={15} />
                    <span>Restore from file…</span>
                    <input
                      type="file"
                      accept=".sql,.gz,.sql.gz"
                      style={{ display: 'none' }}
                      disabled={isRestoring}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) openRestoreConfirm({ kind: 'file', file, label: file.name });
                      }}
                    />
                  </label>
                  <a href="/api/admin/attachments.zip" download className="search-trigger-btn" style={{ textDecoration: 'none' }}>
                    <Download size={15} />
                    <span>Download attachments (.zip)</span>
                  </a>
                </div>
                {backupError && (
                  <div style={{ fontSize: 12.5, color: 'var(--accent-rose)', marginBottom: 10 }}>{backupError}</div>
                )}
                {backupInfo && (
                  <div style={{ fontSize: 12.5, color: 'var(--accent-emerald)', marginBottom: 10 }}>{backupInfo}</div>
                )}

                {restoreResult && (
                  <div style={{
                    fontSize: 12.5,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: 12,
                    background: restoreResult.ok ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)',
                    color: restoreResult.ok ? 'var(--accent-emerald)' : 'var(--accent-rose)'
                  }}>
                    {restoreResult.message}
                  </div>
                )}

                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                  Saved backups ({backups.length})
                </div>
                {backups.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>None yet — click Backup Now.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                    {backups.map((b) => (
                      <div key={b.filename} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        background: 'var(--bg-app)',
                        border: '1px solid var(--border-dim)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: 12.5
                      }}>
                        <Database size={14} color="var(--text-muted)" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {new Date(b.createdAt).toLocaleString()}
                            {b.kind === 'pre-restore' && (
                              <span style={{ marginLeft: 8, color: 'var(--accent-amber)' }}>auto (pre-restore)</span>
                            )}
                          </div>
                          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{formatBytes(b.size)}</div>
                        </div>
                        <a
                          href={`/api/admin/backups/${encodeURIComponent(b.filename)}/download`}
                          download
                          className="btn-icon"
                          title="Download"
                        >
                          <Download size={14} />
                        </a>
                        <button
                          className="btn-icon"
                          title="Restore this backup"
                          disabled={isRestoring}
                          onClick={() => openRestoreConfirm({ kind: 'existing', filename: b.filename, label: new Date(b.createdAt).toLocaleString() })}
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button className="btn-icon" title="Delete" onClick={() => handleDeleteBackup(b.filename)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Restore confirmation */}
          {restoreTarget && (
            <div className="modal-overlay" style={{ zIndex: 10001 }} onClick={() => !isRestoring && setRestoreTarget(null)}>
              <div className="modal-card" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
                <div style={{ padding: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <AlertTriangle size={20} color="var(--accent-rose)" />
                    <h4 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Restore database?</h4>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 8 }}>
                    This replaces every note, tag and link currently in <strong>{dbName}</strong> with the contents of{' '}
                    <strong>{restoreTarget.label}</strong>. A safety backup of the current data is taken automatically first, but anything created after that safety backup will be lost.
                  </p>
                  <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                    Type <strong>{dbName}</strong> to confirm:
                  </p>
                  <input
                    type="text"
                    value={restoreConfirmText}
                    onChange={(e) => setRestoreConfirmText(e.target.value)}
                    placeholder={dbName}
                    autoFocus
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      marginBottom: 16,
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-dim)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-main)',
                      fontSize: 13
                    }}
                  />
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button className="search-trigger-btn" onClick={() => setRestoreTarget(null)} disabled={isRestoring}>
                      Cancel
                    </button>
                    <button
                      className="btn-primary"
                      style={{ background: 'var(--accent-rose)' }}
                      disabled={restoreConfirmText !== dbName || isRestoring}
                      onClick={handleRestore}
                    >
                      {isRestoring ? <Loader2 size={15} className="spin" /> : <AlertTriangle size={15} />}
                      <span>{isRestoring ? 'Restoring…' : 'Restore & overwrite'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Obsidian Vault Import / Export */}
          {activeTab === 'vault' && (
            <>
              <div>
                <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>
                  Obsidian Compatibility
                </h4>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  Never be locked in. Export all your notes and attachments as a standard, portable Obsidian vault at
                  any time, or import an existing Obsidian Markdown vault into MySQL. This is not a database backup —
                  for that, use Backup &amp; Restore in the Database tab.
                </p>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <a
                  href="/api/vault/export"
                  download
                  className="btn-primary"
                  style={{ flex: 1, textDecoration: 'none', justifyContent: 'center' }}
                >
                  <Download size={16} />
                  <span>Download Entire Vault (.zip)</span>
                </a>

                <label className="search-trigger-btn" style={{ flex: 1, justifyContent: 'center', cursor: 'pointer' }}>
                  <Upload size={16} />
                  <span>{isImporting ? 'Importing...' : 'Import Markdown Vault (.zip)'}</span>
                  <input
                    type="file"
                    accept=".zip"
                    style={{ display: 'none' }}
                    onChange={handleImportVault}
                    disabled={isImporting}
                  />
                </label>
              </div>

              {importResult && (
                <div style={{ padding: 12, borderRadius: 6, background: 'rgba(99, 102, 241, 0.15)', border: '1px solid #6366f1', fontSize: 13 }}>
                  {importResult}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

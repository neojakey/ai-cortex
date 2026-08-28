import React, { useState, useEffect } from 'react';
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
  Wrench
} from 'lucide-react';

import ThemePalettePicker from './ThemePalettePicker.jsx';
import { Sun, Moon, Palette } from 'lucide-react';

export default function SettingsModal({
  isOpen,
  onClose,
  health,
  onRefreshData,
  theme,
  onToggleTheme,
  colorScheme,
  customColor,
  onSelectScheme,
  onSelectCustomColor
}) {
  const [activeTab, setActiveTab] = useState('ai'); // 'ai', 'theme', 'db', 'vault'
  const [mcpConfig, setMcpConfig] = useState(null);
  const [copiedClaude, setCopiedClaude] = useState(false);
  const [copiedGemini, setCopiedGemini] = useState(false);
  const [autoInstallStatus, setAutoInstallStatus] = useState(null);
  const [autoInstallGeminiStatus, setAutoInstallGeminiStatus] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

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
            <Cpu size={20} color="var(--accent-primary)" />
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>SecondBrain Settings & AI Integrations</h3>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-dim)', padding: '0 24px' }}>
          {[
            { id: 'ai', label: 'Claude & Gemini (Zero API Keys)' },
            { id: 'theme', label: 'Color Schemes & Modes' },
            { id: 'db', label: 'MySQL 8.4 Telemetry' },
            { id: 'vault', label: 'Obsidian Import/Export' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === tab.id ? 'var(--text-main)' : 'var(--text-muted)',
                padding: '12px 16px',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer'
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
                  SecondBrain ships with a high-performance **Model Context Protocol (MCP)** server.
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
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Ambiance Mode</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Currently: {theme === 'dark' ? 'Obsidian Carbon Dark' : 'Warm Alabaster Archival Light'}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn-primary"
                    style={{
                      background: theme === 'dark' ? 'var(--accent-primary)' : 'var(--bg-surface)',
                      color: theme === 'dark' ? '#ffffff' : 'var(--text-main)',
                      border: '1px solid var(--border-dim)',
                      fontSize: 12.5,
                      padding: '6px 14px'
                    }}
                    onClick={() => theme !== 'dark' && onToggleTheme()}
                  >
                    <Moon size={14} />
                    <span>Dark Mode</span>
                  </button>
                  <button
                    className="btn-primary"
                    style={{
                      background: theme === 'light' ? 'var(--accent-primary)' : 'var(--bg-surface)',
                      color: theme === 'light' ? '#ffffff' : 'var(--text-main)',
                      border: '1px solid var(--border-dim)',
                      fontSize: 12.5,
                      padding: '6px 14px'
                    }}
                    onClick={() => theme !== 'light' && onToggleTheme()}
                  >
                    <Sun size={14} />
                    <span>Light Mode</span>
                  </button>
                </div>
              </div>

              {/* 16-Swatch Color Scheme Grid */}
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 10 }}>
                  Select Palette Harmony (16 Schemes)
                </div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <ThemePalettePicker
                    activeSchemeId={colorScheme}
                    isDark={theme === 'dark'}
                    customColor={customColor}
                    onSelectScheme={onSelectScheme}
                    onSelectCustomColor={onSelectCustomColor}
                  />
                </div>
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
                    {health?.db?.database || 'secondbrain'}
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
            </>
          )}

          {/* TAB 3: Obsidian Vault Import / Export */}
          {activeTab === 'vault' && (
            <>
              <div>
                <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>
                  Obsidian Compatibility & Vault Backup
                </h4>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  Never be locked in. Export all your MySQL notes and attachments as a standard Obsidian vault at any time,
                  or import an existing Obsidian Markdown vault into MySQL.
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

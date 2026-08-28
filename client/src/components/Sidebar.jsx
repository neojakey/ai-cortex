import React from 'react';
import { 
  FileText, 
  Calendar, 
  CheckSquare, 
  Kanban, 
  Table, 
  Plus, 
  Search, 
  Settings, 
  Trash2, 
  Tag, 
  Sparkles,
  Cpu,
  Sun,
  Moon
} from 'lucide-react';

export default function Sidebar({
  notes,
  activeNoteId,
  onSelectNote,
  onCreateNote,
  onOpenDaily,
  activeView,
  onChangeView,
  onOpenSearch,
  onOpenSettings,
  tags,
  selectedTag,
  onSelectTag,
  health,
  theme,
  onToggleTheme
}) {
  return (
    <aside className="sidebar">
      {/* Brand Header */}
      <div className="sidebar-header">
        <div className="brand-badge">
          <div className="icon-box">
            <Cpu size={18} color="#ffffff" />
          </div>
          <div>
            <div className="brand-title">
              <span>AI-Cortex</span>
              <span className="brand-title-dot" />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            className="theme-toggle-btn"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to Warm Alabaster Light Mode (Alt+T)' : 'Switch to Obsidian Dark Mode (Alt+T)'}
            aria-label="Toggle color theme"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          {health && (
            <div className="latency-pill" title={`MySQL 8.4 connection latency: ${health.db?.latencyMs}ms`}>
              <span className="latency-dot" />
              <span>{health.db?.latencyMs ? `${health.db.latencyMs}ms` : 'ok'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="sidebar-actions">
        <button className="btn-primary" onClick={onCreateNote}>
          <Plus size={16} />
          <span>New Note</span>
        </button>

        <button className="search-trigger-btn" onClick={onOpenSearch}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Search size={14} />
            <span>Search notes...</span>
          </div>
          <span className="kbd">Ctrl K</span>
        </button>
      </div>

      {/* Navigation Views */}
      <div className="nav-views">
        <button 
          className={`nav-item ${activeView === 'document' ? 'active' : ''}`}
          onClick={() => onChangeView('document')}
        >
          <FileText size={15} />
          <span>Notes Editor</span>
        </button>

        <button 
          className="nav-item"
          onClick={onOpenDaily}
        >
          <Calendar size={15} />
          <span>Today's Journal</span>
          <span className="kbd" style={{ marginLeft: 'auto' }}>Alt D</span>
        </button>

        <button 
          className={`nav-item ${activeView === 'kanban' ? 'active' : ''}`}
          onClick={() => onChangeView('kanban')}
        >
          <Kanban size={15} />
          <span>Kanban Board</span>
        </button>

        <button 
          className={`nav-item ${activeView === 'table' ? 'active' : ''}`}
          onClick={() => onChangeView('table')}
        >
          <Table size={15} />
          <span>Database Table</span>
        </button>

        <button 
          className={`nav-item ${activeView === 'tasks' ? 'active' : ''}`}
          onClick={() => onChangeView('tasks')}
        >
          <CheckSquare size={15} />
          <span>Global Tasks</span>
        </button>
      </div>

      {/* Notes List */}
      <div className="notes-list-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 8px' }}>
          <span className="section-label" style={{ padding: 0 }}>
            {selectedTag ? `#${selectedTag} (${notes.length})` : `All Notes (${notes.length})`}
          </span>
          {selectedTag && (
            <button 
              style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: 11, cursor: 'pointer' }}
              onClick={() => onSelectTag(null)}
            >
              Clear
            </button>
          )}
        </div>

        {notes.map((note) => (
          <div
            key={note.id}
            className={`note-item ${activeNoteId === note.id && activeView === 'document' ? 'active' : ''}`}
            onClick={() => {
              onChangeView('document');
              onSelectNote(note.id);
            }}
          >
            <div className="note-item-title">{note.title || 'Untitled'}</div>
            <div className="note-item-meta">
              <span>{new Date(note.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              {note.backlinkCount > 0 && (
                <span title={`${note.backlinkCount} backlinks`} style={{ color: '#818cf8' }}>
                  ⇄ {note.backlinkCount}
                </span>
              )}
              {note.tags && note.tags.slice(0, 2).map((t) => (
                <span key={t} className="badge-tag">#{t}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Tags Cloud */}
      {tags.length > 0 && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-dim)', maxHeight: 110, overflowY: 'auto' }}>
          <div className="section-label" style={{ padding: '0 0 6px' }}>Hashtags</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tags.map((t) => (
              <button
                key={t.name}
                onClick={() => onSelectTag(selectedTag === t.name ? null : t.name)}
                style={{
                  background: selectedTag === t.name ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.05)',
                  border: selectedTag === t.name ? '1px solid #6366f1' : '1px solid transparent',
                  color: selectedTag === t.name ? '#ffffff' : 'var(--text-dim)',
                  borderRadius: 4,
                  fontSize: 11,
                  padding: '2px 6px',
                  cursor: 'pointer'
                }}
              >
                #{t.name} <span style={{ opacity: 0.6 }}>({t.count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sidebar Footer */}
      <div className="sidebar-footer">
        <button className="footer-btn" onClick={onOpenSettings}>
          <Settings size={15} />
          <span>AI & Settings</span>
        </button>

        <button 
          className="footer-btn" 
          onClick={() => onChangeView('trash')}
          title="Trash Bin"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </aside>
  );
}

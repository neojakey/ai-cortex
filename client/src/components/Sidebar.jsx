import React, { useState } from 'react';
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
  ChevronDown,
  ChevronRight
} from 'lucide-react';

// Collapsed-by-default filter accordion, shared by the Projects and Hashtags
// sections — auto-expands whenever its own filter is the active one, so the
// user always sees what's currently filtering the note list.
function FilterSection({ title, items, activeKey, onSelect, prefix = '', getKey, getLabel, getCount }) {
  const [manualOpen, setManualOpen] = useState(false);
  if (!items || items.length === 0) return null;

  const isOpen = manualOpen || !!activeKey;

  return (
    <div style={{ borderTop: '1px solid var(--border-dim)' }}>
      <button
        type="button"
        onClick={() => setManualOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'none',
          border: 'none',
          cursor: 'pointer'
        }}
      >
        <span className="section-label" style={{ padding: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {title}
          {activeKey && (
            <span style={{ color: 'var(--accent-primary)', textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>
              · {prefix}{activeKey}
            </span>
          )}
        </span>
        <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{items.length}</span>
      </button>

      {isOpen && (
        <div style={{ padding: '0 12px 10px', maxHeight: 110, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {items.map((item) => {
            const key = getKey(item);
            const active = activeKey === key;
            return (
              <button
                key={key}
                onClick={() => onSelect(active ? null : key)}
                style={{
                  background: active ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.05)',
                  border: active ? '1px solid #6366f1' : '1px solid transparent',
                  color: active ? '#ffffff' : 'var(--text-dim)',
                  borderRadius: 4,
                  fontSize: 11,
                  padding: '2px 6px',
                  cursor: 'pointer'
                }}
              >
                {prefix}{getLabel(item)} <span style={{ opacity: 0.6 }}>({getCount(item)})</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
  projects,
  selectedProject,
  onSelectProject,
  health,
  width
}) {
  return (
    <aside className="sidebar" style={width ? { width, minWidth: width } : undefined}>
      {/* Brand Header */}
      <div className="sidebar-header">
        <div className="brand-badge">
          <div className="icon-box">
            <Cpu size={18} color="#ffffff" />
          </div>
          <div className="brand-title">
            <span>AI-Cortex</span>
            <span className="brand-title-dot" />
          </div>
        </div>

        {health && (
          <div className="latency-pill" title={`MySQL 8.4 connection latency: ${health.db?.latencyMs}ms`}>
            <span className="latency-dot" />
            <span>{health.db?.latencyMs ? `${health.db.latencyMs}ms` : 'online'}</span>
          </div>
        )}
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
            {[
              selectedProject && (projects.find((p) => p.slug === selectedProject)?.name || selectedProject),
              selectedTag && `#${selectedTag}`
            ].filter(Boolean).join(' · ') || 'All Notes'} ({notes.length})
          </span>
          {(selectedTag || selectedProject) && (
            <button
              style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: 11, cursor: 'pointer' }}
              onClick={() => { onSelectTag(null); onSelectProject(null); }}
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

      {/* Projects (collapsed accordion) */}
      <FilterSection
        title="Projects"
        items={projects}
        activeKey={selectedProject}
        onSelect={onSelectProject}
        getKey={(p) => p.slug}
        getLabel={(p) => p.name}
        getCount={(p) => p.noteCount}
      />

      {/* Hashtags (collapsed accordion) */}
      <FilterSection
        title="Hashtags"
        items={tags}
        activeKey={selectedTag}
        onSelect={onSelectTag}
        prefix="#"
        getKey={(t) => t.name}
        getLabel={(t) => t.name}
        getCount={(t) => t.count}
      />

      {/* Sidebar Footer */}
      <div className="sidebar-footer">
        <button className="footer-btn" onClick={onOpenSettings}>
          <Settings size={15} />
          <span>Settings</span>
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

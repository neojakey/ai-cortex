import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Calendar,
  CheckSquare,
  Table,
  Plus,
  Search,
  Settings,
  Trash2,
  Tag,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Camera,
  BookOpen
} from 'lucide-react';
import { localDateString } from '../lib/dates.js';
import { displayTitle, treeTitle } from '../lib/noteTitle.js';
import { splitTagList } from '../lib/tagLists.js';

// Collapsed-by-default filter accordion, shared by the Projects and Hashtags
// sections — auto-expands whenever its own filter is the active one, so the
// user always sees what's currently filtering the note list.
const FOLDERS_STORAGE_KEY = 'ai_cortex_expanded_folders';
const loadExpandedFolders = () => {
  try {
    const raw = localStorage.getItem(FOLDERS_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
};
const persistExpandedFolders = (set) => {
  try {
    localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch { /* ignore */ }
};

function FilterSection({ title, items, activeKey, onSelect, prefix = '', getKey, getLabel, getCount, hiddenCount = 0, showingAll = false, onToggleAll }) {
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
          {onToggleAll && (hiddenCount > 0 || showingAll) && (
            <button
              type="button"
              className="filter-more-btn"
              onClick={onToggleAll}
            >
              {showingAll ? 'Show fewer' : `Show ${hiddenCount} more…`}
            </button>
          )}
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
  dailyStatus,
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
  width,
  folders = []
}) {
  // Today's daily note is opened in the note editor, so it lights up "Today's Journal"
  // instead of "Notes Editor".
  const [expandedKeys, setExpandedKeys] = useState(loadExpandedFolders);
  const [showAllTags, setShowAllTags] = useState(false);
  const { visible: visibleTags, hiddenCount: hiddenTagCount } = useMemo(
    () => splitTagList(tags, { showAll: showAllTags, activeKey: selectedTag }),
    [tags, showAllTags, selectedTag]
  );

  // Auto-expand the folder containing the currently open note
  const activeFolderKey = useMemo(() => {
    if (!activeNoteId || !folders) return null;
    for (const f of folders) {
      if (f.notes && f.notes.some((n) => n.id === activeNoteId)) {
        return f.project ? f.project.slug : '__unfiled__';
      }
    }
    return null;
  }, [activeNoteId, folders]);

  useEffect(() => {
    if (activeFolderKey && !expandedKeys.has(activeFolderKey)) {
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        next.add(activeFolderKey);
        persistExpandedFolders(next);
        return next;
      });
    }
  }, [activeFolderKey]);

  const toggleFolder = (key) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistExpandedFolders(next);
      return next;
    });
  };

  const activeNote = activeView === 'document' ? notes.find((n) => n.id === activeNoteId) : null;
  const onTodaysJournal = !!activeNote && activeNote.title === `Daily: ${localDateString()}`;
  return (
    <aside className="sidebar" style={width ? { width, minWidth: width } : undefined}>
      {/* Brand Header */}
      <div className="sidebar-header">
        <div className="brand-badge">
          <img src="/logo-192.png" alt="AI-Cortex" className="brand-logo-img" />
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
          className={`nav-item ${activeView === 'document' && !onTodaysJournal ? 'active' : ''}`}
          onClick={() => onChangeView('document')}
        >
          <FileText size={15} />
          <span>Notes Editor</span>
        </button>

        <button 
          className={`nav-item ${onTodaysJournal ? 'active' : ''}`}
          onClick={onOpenDaily}
        >
          <Calendar size={15} />
          <span>Today's Journal</span>
          {(() => {
            const done = !!dailyStatus && dailyStatus.imageCount > 0;
            return (
              <span
                className="daily-photo-indicator"
                title={done ? "Today's photo is added" : "No photo yet today: add one to document the day"}
                style={{ marginLeft: 'auto', display: 'inline-flex', color: done ? 'var(--accent-emerald)' : 'var(--accent-amber)' }}
              >
                <Camera size={13} />
              </span>
            );
          })()}
          <span className="kbd">Alt D</span>
        </button>

        <button
          className={`nav-item ${activeView === 'journal' ? 'active' : ''}`}
          onClick={() => onChangeView('journal')}
        >
          <BookOpen size={15} />
          <span>Journal</span>
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

      {/* Notes & Folders */}
      <div className="notes-list-section">
        {/* Folders Tree */}
        <div className="folders-tree-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 8px' }}>
            <span className="section-label" style={{ padding: 0 }}>Folders</span>
          </div>
          {folders.map((folder) => {
            const folderKey = folder.project ? folder.project.slug : '__unfiled__';
            const folderName = folder.project ? folder.project.name : 'Unfiled';
            const isOpen = expandedKeys.has(folderKey);
            return (
              <div key={folderKey} className="tree-folder">
                <button
                  type="button"
                  className="tree-folder-btn"
                  aria-expanded={isOpen}
                  onClick={() => toggleFolder(folderKey)}
                >
                  <span className="tree-folder-caret">
                    {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </span>
                  <span className="tree-folder-name" title={folderName}>
                    {folderName}
                  </span>
                  <span className="tree-folder-count">({folder.notes.length})</span>
                </button>
                {isOpen && (
                  <div className="tree-folder-children">
                    {folder.notes.map((n) => (
                      <div
                        key={n.id}
                        className={`tree-note-item ${activeNoteId === n.id && activeView === 'document' ? 'active' : ''}`}
                        onClick={() => {
                          onChangeView('document');
                          onSelectNote(n.id);
                        }}
                      >
                        <span className="tree-note-title" title={n.title}>
                          {treeTitle(n.title, folder.project?.name) || 'Untitled'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Recent Notes List */}
        <div className="recent-notes-section" style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border-dim)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 8px' }}>
            <span className="section-label" style={{ padding: 0 }}>
              {selectedTag ? `#${selectedTag}` : 'Recent'} ({notes.length})
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
              <div className="note-item-title">{displayTitle(note.title, note.journalTitle) || 'Untitled'}</div>
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
                {note.tags && note.tags.length > 2 && (
                  <span className="badge-tag badge-tag-more" title={note.tags.slice(2).map((t) => `#${t}`).join(' ')}>
                    +{note.tags.length - 2}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Hashtags (collapsed accordion) */}
      <FilterSection
        title="Hashtags"
        items={visibleTags}
        hiddenCount={hiddenTagCount}
        showingAll={showAllTags}
        onToggleAll={() => setShowAllTags((v) => !v)}
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

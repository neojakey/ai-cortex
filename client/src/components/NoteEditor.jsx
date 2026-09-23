import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Paperclip,
  Trash2,
  Calendar,
  Tag,
  ArrowLeftRight,
  Check,
  Clock,
  Download,
  ExternalLink,
  Plus,
  HelpCircle,
  Eye,
  Pencil,
  Maximize2,
  Minimize2,
  Save,
  RefreshCw,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { renderNoteMarkdown, WIKILINK_PREFIX } from '../lib/renderMarkdown.js';
import { createSaveCoordinator } from '../lib/saveCoordinator.js';

// The fields the editor saves, in one comparable shape (used to detect "nothing to save").
function editorFields({ note, title, content, status, dueDate }) {
  return { noteId: note ? note.id : null, title, content, status, dueDate: dueDate || null };
}
function noteFields(n) {
  return {
    noteId: n.id,
    title: n.title || '',
    content: n.content || '',
    status: n.status || 'active',
    dueDate: n.dueDate ? n.dueDate.slice(0, 10) : null
  };
}

// localStorage can throw (private mode, blocked site data); never let that break the app.
const viewModeStorage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  }
};

function AttachmentThumb({ att }) {
  const [failed, setFailed] = useState(false);
  const isImage = (att.mimeType || '').startsWith('image/');
  const isPdf = att.mimeType === 'application/pdf';
  const src = isImage ? att.url : isPdf ? `/api/attachments/${att.id}/thumb` : null;
  return (
    <a className="attachment-card" href={att.url} target="_blank" rel="noreferrer" title={att.filename}>
      <div className="attachment-thumb">
        {src && !failed ? (
          <img src={src} alt={att.filename} loading="lazy" onError={() => setFailed(true)} />
        ) : (
          <Paperclip size={28} />
        )}
      </div>
      <div className="attachment-name">{att.filename}</div>
      <div className="attachment-meta">{Math.round(att.fileSize / 1024)} KB</div>
    </a>
  );
}

export default function NoteEditor({
  note,
  allNotes,
  onUpdateNote,
  onRefreshNote,
  onDeleteNote,
  onSelectNote
}) {
  // Hooks MUST be called unconditionally at the top level
  const [title, setTitle] = useState(note?.title || '');
  const [content, setContent] = useState(note?.content || '');
  const [status, setStatus] = useState(note?.status || 'active');
  const [dueDate, setDueDate] = useState(note?.dueDate ? note.dueDate.slice(0, 10) : '');
  const [copiedContext, setCopiedContext] = useState(false);
  // Coordinator state: { status: 'idle' | 'saving' | 'error' | 'conflict', conflict }.
  // The displayed `saveStatus` (below) adds 'saved' / 'unsaved' on top of it.
  const [saveState, setSaveState] = useState({ status: 'idle', conflict: null });
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [copiedMine, setCopiedMine] = useState(false);
  // 'idle' | 'loading' | 'updated' (server had newer content) | 'current' (already up to date) | 'error'
  const [refreshState, setRefreshState] = useState('idle');
  const refreshTimerRef = useRef(null);
  const saveTimerRef = useRef(null);
  const latestRef = useRef({});
  latestRef.current = { note, title, content, status, dueDate };
  const onUpdateNoteRef = useRef(onUpdateNote);
  onUpdateNoteRef.current = onUpdateNote;

  // Serializes saves and sends the note's revision with each one, so an edit made
  // elsewhere (e.g. by an AI over MCP) is reported as a conflict, never overwritten.
  const saveRef = useRef(null);
  if (!saveRef.current) {
    saveRef.current = createSaveCoordinator({
      getFields: () => editorFields(latestRef.current),
      send: (fields, expectedRevision) => {
        const { noteId, ...payload } = fields;
        return onUpdateNoteRef.current(noteId, { ...payload, expectedRevision });
      },
      onChange: setSaveState,
      onSaved: () => setLastSavedAt(new Date())
    });
  }
  const [isUploading, setIsUploading] = useState(false);
  const [viewMode, setViewMode] = useState(() => viewModeStorage.get('ai_cortex_view_mode') || 'read');
  const [thumbSize, setThumbSize] = useState(() => viewModeStorage.get('ai_cortex_thumb_size') || 'medium');
  const [fullWidth, setFullWidth] = useState(() => viewModeStorage.get('ai_cortex_full_width') === 'true');

  // Wikilink autocomplete state
  const [showWikilinks, setShowWikilinks] = useState(false);
  const [wikilinkSearch, setWikilinkSearch] = useState('');
  const [wikilinkCursorPos, setWikilinkCursorPos] = useState(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // Sync state when active note changes
  useEffect(() => {
    if (!note) return;
    setTitle(note.title || '');
    setContent(note.content || '');
    setStatus(note.status || 'active');
    setDueDate(note.dueDate ? note.dueDate.slice(0, 10) : '');
    saveRef.current.reset(note.revision, noteFields(note));
    setLastSavedAt(null);
    setRefreshState('idle');
    setShowWikilinks(false);
  }, [note?.id]);

  const isDirty = !!note && (
    title !== note.title ||
    content !== note.content ||
    status !== note.status ||
    dueDate !== (note.dueDate ? note.dueDate.slice(0, 10) : '')
  );

  // 'saved' | 'unsaved' (edited, debounce pending) | 'saving' | 'error' | 'conflict'
  const saveStatus = saveState.status === 'idle' ? (isDirty ? 'unsaved' : 'saved') : saveState.status;

  // Persist the current fields immediately (used by auto-save, the Save button, and Ctrl/Cmd+S)
  const saveNow = () => {
    clearTimeout(saveTimerRef.current);
    return saveRef.current.save();
  };

  const copyMyText = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMine(true);
      setTimeout(() => setCopiedMine(false), 2000);
    } catch (err) {
      console.error('Could not copy to clipboard:', err);
    }
  };

  // Reload the note from the server, replacing what's in the editor (e.g. after an AI edited it)
  const refreshNow = async ({ skipConfirm = false } = {}) => {
    if (!note || refreshState === 'loading') return;
    if (!skipConfirm && isDirty && !window.confirm('You have unsaved changes in this note. Reload from the server and discard them?')) {
      return;
    }
    clearTimeout(saveTimerRef.current);
    clearTimeout(refreshTimerRef.current);
    setRefreshState('loading');
    try {
      const fresh = await onRefreshNote(note.id);
      const changed =
        fresh.title !== title ||
        fresh.content !== content ||
        fresh.status !== status ||
        (fresh.dueDate ? fresh.dueDate.slice(0, 10) : '') !== dueDate;
      setTitle(fresh.title || '');
      setContent(fresh.content || '');
      setStatus(fresh.status || 'active');
      setDueDate(fresh.dueDate ? fresh.dueDate.slice(0, 10) : '');
      saveRef.current.reset(fresh.revision, noteFields(fresh));
      setRefreshState(changed ? 'updated' : 'current');
    } catch (err) {
      setRefreshState('error');
    }
    refreshTimerRef.current = setTimeout(() => setRefreshState('idle'), 2500);
  };

  useEffect(() => () => clearTimeout(refreshTimerRef.current), []);

  // Debounced auto-save. Paused while a conflict is unresolved (the banner handles it).
  useEffect(() => {
    if (!note || !isDirty || saveState.conflict) return;
    saveTimerRef.current = setTimeout(saveNow, 600);
    return () => clearTimeout(saveTimerRef.current);
  }, [title, content, status, dueDate, note, saveState.conflict]);

  // Copy AI context bundle for Claude / Gemini web apps
  const copyAiContext = () => {
    const backlinksText = note && note.backlinks && note.backlinks.length
      ? note.backlinks.map((b) => `- [[${b.title}]]`).join('\n')
      : 'None';

    const tagsText = note && note.tags && note.tags.length
      ? note.tags.map((t) => `#${t}`).join(', ')
      : 'None';

    const promptBundle = `# Note: ${title}
Status: ${status} | Due Date: ${dueDate || 'None'}
Hashtags: ${tagsText}

## Content
${content}

---
## Linked Backlinks in AI-Cortex
${backlinksText}

---
[AI-Cortex Context Bundle: You can answer questions, summarize, or propose edits to this note]
`;

    navigator.clipboard.writeText(promptBundle);
    setCopiedContext(true);
    setTimeout(() => setCopiedContext(false), 2500);
  };

  // Cmd/Ctrl + Shift + C -> copy AI context bundle
  useEffect(() => {
    if (!note) return;
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        copyAiContext();
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        saveNow();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [note, title, status, dueDate, content]);

  // Now conditional render can safely happen after all hooks
  if (!note) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        Select a note or create a new one to begin.
      </div>
    );
  }

  // Handle textarea typing for wikilink detection
  const handleContentChange = (e) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    setContent(val);

    // Look for [[ preceding cursor
    const textBeforeCursor = val.slice(0, pos);
    const lastOpen = textBeforeCursor.lastIndexOf('[[');
    const lastClose = textBeforeCursor.lastIndexOf(']]');

    if (lastOpen !== -1 && lastOpen > lastClose) {
      const query = textBeforeCursor.slice(lastOpen + 2);
      if (!query.includes('\n') && query.length < 30) {
        setWikilinkSearch(query.toLowerCase());
        setWikilinkCursorPos(lastOpen);
        setShowWikilinks(true);
        return;
      }
    }
    setShowWikilinks(false);
  };

  // Insert chosen wikilink
  const insertWikilink = (targetTitle) => {
    if (wikilinkCursorPos === null) return;
    const before = content.slice(0, wikilinkCursorPos);
    const pos = textareaRef.current ? textareaRef.current.selectionStart : content.length;
    const after = content.slice(pos);
    const newContent = `${before}[[${targetTitle}]]${after}`;
    setContent(newContent);
    setShowWikilinks(false);

    // Trigger update
    onUpdateNote(note.id, { content: newContent });
  };

  // Upload one or more files in order, then add all their links to the note in one save.
  const uploadFiles = async (files) => {
    if (!files.length) return;
    setIsUploading(true);
    let links = '';
    const failed = [];
    try {
      for (const file of files) {
        try {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('noteId', note.id);
          const res = await fetch('/api/attachments', { method: 'POST', body: formData });
          if (!res.ok) throw new Error('Upload failed');
          const { attachment } = await res.json();
          links += file.type.startsWith('image/')
            ? `\n\n![${attachment.filename}](${attachment.url})\n`
            : `\n\n[📎 ${attachment.filename}](${attachment.url})\n`;
        } catch {
          failed.push(file.name);
        }
      }
      if (links) {
        const updatedContent = content + links;
        setContent(updatedContent);
        await onUpdateNote(note.id, { content: updatedContent });
      }
      if (failed.length) alert(`Could not attach: ${failed.join(', ')}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = (e) => uploadFiles(Array.from(e.target.files || []));

  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const handleDragOver = (e) => { if (hasFiles(e)) e.preventDefault(); };
  const handleDrop = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (!isUploading) uploadFiles(Array.from(e.dataTransfer.files));
  };

  const changeViewMode = (mode) => {
    setViewMode(mode);
    viewModeStorage.set('ai_cortex_view_mode', mode);
  };

  const toggleFullWidth = () => {
    const next = !fullWidth;
    setFullWidth(next);
    viewModeStorage.set('ai_cortex_full_width', String(next));
  };

  // Intercept clicks on rendered [[wikilinks]] to navigate within the app;
  // real links (attachments, external URLs) fall through to default <a> behavior.
  const handleRenderedClick = (e) => {
    const anchor = e.target.closest('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (!href.startsWith(WIKILINK_PREFIX)) return;

    e.preventDefault();
    const targetTitle = decodeURIComponent(href.slice(WIKILINK_PREFIX.length)).trim().toLowerCase();
    const target = allNotes.find((n) => n.title.trim().toLowerCase() === targetTitle);
    if (target) onSelectNote(target.id);
  };

  const filteredWikilinks = allNotes
    .filter((n) => n.id !== note.id && n.title.toLowerCase().includes(wikilinkSearch))
    .slice(0, 6);

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  // Quick markdown insertion helper
  const insertMarkdown = (prefix, suffix = '') => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = content.substring(start, end);
    const replacement = `${prefix}${selected || 'text'}${suffix}`;
    const newContent = content.substring(0, start) + replacement + content.substring(end);
    setContent(newContent);
    onUpdateNote(note.id, { content: newContent });
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + (selected || 'text').length);
    }, 10);
  };

  return (
    <div className="editor-wrapper">
      {/* Top Header Action Bar */}
      <div className="editor-header-bar">
        <div className="editor-breadcrumbs">
          <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{title || 'Untitled'}</span>
          <span style={{ opacity: 0.4 }}>•</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{wordCount} words</span>
          <span style={{ opacity: 0.4 }}>•</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{readingTime} min read</span>
          <span
            key={saveStatus === 'saved' ? `saved-${lastSavedAt?.getTime() ?? 0}` : saveStatus}
            className={`save-status save-status-${saveStatus} ${lastSavedAt ? 'just-saved' : ''}`}
            role="status"
            aria-live="polite"
          >
            {saveStatus === 'saving' && <Loader2 size={13} className="spin" />}
            {saveStatus === 'saved' && <Check size={13} />}
            {saveStatus === 'unsaved' && <span className="save-status-dot" />}
            {(saveStatus === 'error' || saveStatus === 'conflict') && <AlertCircle size={13} />}
            <span>
              {saveStatus === 'saving' && 'Saving…'}
              {saveStatus === 'unsaved' && 'Unsaved changes'}
              {saveStatus === 'error' && 'Save failed'}
              {saveStatus === 'conflict' && 'Not saved: conflict'}
              {saveStatus === 'saved' && (lastSavedAt
                ? `Saved at ${lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                : 'All changes saved')}
            </span>
          </span>
        </div>

        <div className="editor-actions">
          {/* Read / Edit mode toggle */}
          <div className="view-mode-toggle">
            <button
              type="button"
              className={`view-mode-btn ${viewMode === 'read' ? 'active' : ''}`}
              onClick={() => changeViewMode('read')}
              title="Read: rendered markdown"
            >
              <Eye size={13} />
              <span>Read</span>
            </button>
            <button
              type="button"
              className={`view-mode-btn ${viewMode === 'edit' ? 'active' : ''}`}
              onClick={() => changeViewMode('edit')}
              title="Edit: raw markdown source"
            >
              <Pencil size={13} />
              <span>Edit</span>
            </button>
          </div>

          {/* Reload from server (pick up edits made by an AI) */}
          <button
            type="button"
            className={`btn-refresh ${refreshState !== 'idle' && refreshState !== 'loading' ? `is-${refreshState}` : ''}`}
            onClick={() => refreshNow()}
            disabled={refreshState === 'loading'}
            title="Reload this note from the server (picks up changes made by an AI)"
          >
            {refreshState === 'updated' || refreshState === 'current' ? <Check size={14} /> : <RefreshCw size={14} className={refreshState === 'loading' ? 'spin' : ''} />}
            <span>
              {refreshState === 'updated' && 'Updated'}
              {refreshState === 'current' && 'Up to date'}
              {refreshState === 'error' && 'Refresh failed'}
              {(refreshState === 'idle' || refreshState === 'loading') && 'Refresh'}
            </span>
          </button>

          {/* Save now */}
          <button
            type="button"
            className="btn-save"
            onClick={saveNow}
            disabled={saveStatus === 'saving' || saveStatus === 'conflict' || (!isDirty && saveStatus !== 'error')}
            title="Save now (Ctrl/Cmd + S)"
          >
            <Save size={14} />
            <span>{saveStatus === 'error' ? 'Retry' : 'Save'}</span>
          </button>

          {/* Full-width toggle */}
          <button
            type="button"
            className={`btn-icon ${fullWidth ? 'active' : ''}`}
            onClick={toggleFullWidth}
            title={fullWidth ? 'Switch to readable column width' : 'Expand content to full width'}
            aria-pressed={fullWidth}
          >
            {fullWidth ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>

          {/* Copy Context for Claude / Gemini */}
          <button 
            className="btn-ai-context" 
            onClick={copyAiContext}
            title="Bundle note and backlinks for Claude Pro, Gemini Advanced, or ChatGPT (Cmd/Ctrl + Shift + C)"
          >
            {copiedContext ? <Check size={14} color="#10b981" /> : <Sparkles size={14} />}
            <span>{copiedContext ? 'Context Copied!' : 'Copy for AI (Claude / Gemini)'}</span>
          </button>

          {/* Attachment button */}
          <input 
            type="file" 
            multiple
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            onChange={handleFileUpload} 
          />
          <button 
            className="btn-icon" 
            onClick={() => fileInputRef.current?.click()}
            title="Attach file (stored on disk with SHA-256 deduplication)"
          >
            <Paperclip size={15} />
          </button>

          {/* Delete note */}
          <button 
            className="btn-icon" 
            onClick={() => onDeleteNote(note.id)}
            title="Move to Trash"
            style={{ color: 'var(--accent-rose)' }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {saveState.conflict && (
        <div className="conflict-banner" role="alert">
          <AlertCircle size={18} />
          <div className="conflict-banner-text">
            <strong>This note was changed somewhere else.</strong>
            <span>
              Your latest edits are not saved. The saved version is now at revision {saveState.conflict.currentRevision}.
              Copy your text first if you want to keep it.
            </span>
          </div>
          <div className="conflict-banner-actions">
            <button type="button" className="btn-conflict" onClick={copyMyText}>
              {copiedMine ? 'Copied' : 'Copy my text'}
            </button>
            <button type="button" className="btn-conflict" onClick={() => refreshNow({ skipConfirm: true })}>
              Reload (discard my edits)
            </button>
            <button type="button" className="btn-conflict btn-conflict-danger" onClick={() => saveRef.current.overwrite()}>
              Overwrite the latest version
            </button>
          </div>
        </div>
      )}

      {/* Editor Content Area */}
      <div onDragOver={handleDragOver} onDrop={handleDrop} className={`editor-content-container ${fullWidth ? 'is-full-width' : ''}`}>
        {/* Title Input */}
        <input
          type="text"
          className="note-title-input"
          placeholder="Untitled Note"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        {/* Notion-style Properties Bar */}
        <div className="properties-bar">
          <div className="prop-field">
            <span style={{ fontSize: 12 }}>Status:</span>
            <select 
              className="prop-select" 
              value={status} 
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          <div className="prop-field">
            <Calendar size={13} />
            <span style={{ fontSize: 12 }}>Due Date:</span>
            <input 
              type="date" 
              className="prop-input" 
              value={dueDate} 
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          {note.tags && note.tags.length > 0 && (
            <div className="prop-field" style={{ marginLeft: 'auto' }}>
              <Tag size={13} />
              <div style={{ display: 'flex', gap: 4 }}>
                {note.tags.map((t) => (
                  <span key={t} className="badge-tag">#{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {viewMode === 'edit' ? (
          <>
            {/* Editorial Quick-Format Ribbon */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0 6px', borderBottom: '1px solid var(--border-dim)' }}>
              <button type="button" className="footer-btn" style={{ padding: '3px 8px', fontSize: 12, fontWeight: 700 }} onClick={() => insertMarkdown('**', '**')} title="Bold">
                B
              </button>
              <button type="button" className="footer-btn" style={{ padding: '3px 8px', fontSize: 12, fontStyle: 'italic' }} onClick={() => insertMarkdown('*', '*')} title="Italic">
                I
              </button>
              <button type="button" className="footer-btn" style={{ padding: '3px 8px', fontSize: 11, fontWeight: 600 }} onClick={() => insertMarkdown('# ')} title="Heading 1">
                H1
              </button>
              <button type="button" className="footer-btn" style={{ padding: '3px 8px', fontSize: 11, fontWeight: 600 }} onClick={() => insertMarkdown('## ')} title="Heading 2">
                H2
              </button>
              <button type="button" className="footer-btn" style={{ padding: '3px 8px', fontSize: 11, fontFamily: 'var(--font-mono)' }} onClick={() => insertMarkdown('- [ ] ')} title="Checkbox Task">
                [ ] Task
              </button>
              <button type="button" className="footer-btn" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => insertMarkdown('> ')} title="Callout Quote">
                “ Quote
              </button>
              <button type="button" className="footer-btn" style={{ padding: '3px 8px', fontSize: 11, fontFamily: 'var(--font-mono)' }} onClick={() => insertMarkdown('`', '`')} title="Code">
                &lt;/&gt;
              </button>
              <button type="button" className="footer-btn" style={{ padding: '3px 8px', fontSize: 11, color: 'var(--accent-primary)', fontWeight: 600 }} onClick={() => insertMarkdown('[[', ']]')} title="Wikilink">
                ⇄ [[Link]]
              </button>
            </div>

            {/* Note Textarea with Wikilink Autocomplete */}
            <div style={{ position: 'relative' }}>
              <textarea
                ref={textareaRef}
                className="note-textarea mode-edit"
                placeholder="Write your thoughts in Markdown... Type [[ to link notes, or #tags to categorize..."
                value={content}
                onChange={handleContentChange}
              />

              {/* Floating Wikilink Popup */}
              {showWikilinks && (
                <div className="wikilink-popup" style={{ top: 40, left: 20 }}>
                  <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-dim)' }}>
                    Link to existing note:
                  </div>
                  {filteredWikilinks.length > 0 ? (
                    filteredWikilinks.map((target) => (
                      <div
                        key={target.id}
                        className="wikilink-item"
                        onClick={() => insertWikilink(target.title)}
                      >
                        <span>⇄</span>
                        <span>{target.title}</span>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                      No matching notes found
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          content.trim() ? (
            <div
              className="note-rendered"
              onClick={handleRenderedClick}
              dangerouslySetInnerHTML={{ __html: renderNoteMarkdown(content) }}
            />
          ) : (
            <div className="note-rendered-empty">
              Nothing here yet. Switch to Edit to start writing.
            </div>
          )
        )}

        {/* Attachments Section */}
        {note.attachments && note.attachments.length > 0 && (
          <div style={{ padding: '14px 0', borderTop: '1px solid var(--border-dim)' }}>
            <div className="attachments-header">
              <span>Attachments ({note.attachments.length})</span>
              <div className="view-mode-toggle" role="group" aria-label="Thumbnail size">
                {['small', 'medium', 'large'].map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`view-mode-btn ${thumbSize === size ? 'active' : ''}`}
                    onClick={() => { setThumbSize(size); viewModeStorage.set('ai_cortex_thumb_size', size); }}
                  >
                    {size[0].toUpperCase() + size.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className={`attachment-grid size-${thumbSize}`}>
              {note.attachments.map((att) => (
                <AttachmentThumb key={att.id} att={att} />
              ))}
            </div>
          </div>
        )}

        {/* Backlinks & Linked Mentions Drawer */}
        <div className="backlinks-section">
          <div className="backlinks-header">
            <ArrowLeftRight size={15} color="#818cf8" />
            <span>Linked Mentions ({note.backlinks ? note.backlinks.length : 0})</span>
          </div>

          {note.backlinks && note.backlinks.length > 0 ? (
            <div className="backlinks-grid">
              {note.backlinks.map((b) => (
                <div 
                  key={b.id} 
                  className="backlink-card"
                  onClick={() => onSelectNote(b.id)}
                >
                  <div className="backlink-card-title">{b.title}</div>
                  <div className="backlink-card-meta">
                    <span>Updated {new Date(b.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              No other notes link to this page yet. Type <code>[[{title || 'Note Title'}]]</code> inside any note to link here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
  HelpCircle
} from 'lucide-react';

export default function NoteEditor({
  note,
  allNotes,
  onUpdateNote,
  onDeleteNote,
  onSelectNote
}) {
  if (!note) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        Select a note or create a new one to begin.
      </div>
    );
  }

  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content || '');
  const [status, setStatus] = useState(note.status || 'active');
  const [dueDate, setDueDate] = useState(note.dueDate ? note.dueDate.slice(0, 10) : '');
  const [copiedContext, setCopiedContext] = useState(false);
  const [saveStatus, setSaveStatus] = useState('Saved');
  const [isUploading, setIsUploading] = useState(false);

  // Wikilink autocomplete state
  const [showWikilinks, setShowWikilinks] = useState(false);
  const [wikilinkSearch, setWikilinkSearch] = useState('');
  const [wikilinkCursorPos, setWikilinkCursorPos] = useState(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // Sync state when active note changes
  useEffect(() => {
    setTitle(note.title);
    setContent(note.content || '');
    setStatus(note.status || 'active');
    setDueDate(note.dueDate ? note.dueDate.slice(0, 10) : '');
    setSaveStatus('Saved');
    setShowWikilinks(false);
  }, [note.id]);

  // Debounced auto-save
  useEffect(() => {
    if (title === note.title && content === note.content && status === note.status && dueDate === (note.dueDate ? note.dueDate.slice(0, 10) : '')) {
      return;
    }

    setSaveStatus('Saving...');
    const timer = setTimeout(async () => {
      try {
        await onUpdateNote(note.id, {
          title,
          content,
          status,
          dueDate: dueDate || null
        });
        setSaveStatus('Saved');
      } catch (err) {
        setSaveStatus('Save error');
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [title, content, status, dueDate]);

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

  // Copy AI context bundle for Claude / Gemini web apps
  const copyAiContext = () => {
    const backlinksText = note.backlinks && note.backlinks.length
      ? note.backlinks.map((b) => `- [[${b.title}]]`).join('\n')
      : 'None';

    const tagsText = note.tags && note.tags.length
      ? note.tags.map((t) => `#${t}`).join(', ')
      : 'None';

    const promptBundle = `# Note: ${title}
Status: ${status} | Due Date: ${dueDate || 'None'}
Hashtags: ${tagsText}

## Content
${content}

---
## Linked Backlinks in SecondBrain
${backlinksText}

---
[SecondBrain Context Bundle: You can answer questions, summarize, or propose edits to this note]
`;

    navigator.clipboard.writeText(promptBundle);
    setCopiedContext(true);
    setTimeout(() => setCopiedContext(false), 2500);
  };

  // Handle Attachment Upload
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('noteId', note.id);

      const res = await fetch('/api/attachments', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();

      // Append image or file link to markdown
      const isImg = file.type.startsWith('image/');
      const linkMarkdown = isImg
        ? `\n\n![${data.attachment.filename}](${data.attachment.url})\n`
        : `\n\n[📎 ${data.attachment.filename}](${data.attachment.url})\n`;

      const updatedContent = content + linkMarkdown;
      setContent(updatedContent);
      await onUpdateNote(note.id, { content: updatedContent });
    } catch (err) {
      alert(`Attachment error: ${err.message}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const filteredWikilinks = allNotes
    .filter((n) => n.id !== note.id && n.title.toLowerCase().includes(wikilinkSearch))
    .slice(0, 6);

  return (
    <div className="editor-wrapper">
      {/* Top Header Action Bar */}
      <div className="editor-header-bar">
        <div className="editor-breadcrumbs">
          <span>Notes</span>
          <span>/</span>
          <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>{title || 'Untitled'}</span>
          <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 8 }}>({saveStatus})</span>
        </div>

        <div className="editor-actions">
          {/* Copy Context for Claude / Gemini */}
          <button 
            className="btn-ai-context" 
            onClick={copyAiContext}
            title="Bundle note and backlinks for Claude Pro or Gemini Advanced (Cmd/Ctrl + Shift + C)"
          >
            {copiedContext ? <Check size={14} color="#10b981" /> : <Sparkles size={14} />}
            <span>{copiedContext ? 'Context Copied!' : 'Copy for Claude / Gemini'}</span>
          </button>

          {/* Attachment button */}
          <input 
            type="file" 
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

      {/* Editor Content Area */}
      <div className="editor-content-container">
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

        {/* Note Textarea with Wikilink Autocomplete */}
        <div style={{ position: 'relative' }}>
          <textarea
            ref={textareaRef}
            className="note-textarea"
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

        {/* Attachments Section */}
        {note.attachments && note.attachments.length > 0 && (
          <div style={{ padding: '14px 0', borderTop: '1px solid var(--border-dim)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10 }}>
              Attachments ({note.attachments.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {note.attachments.map((att) => (
                <a
                  key={att.id}
                  href={att.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-dim)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-dim)',
                    textDecoration: 'none',
                    fontSize: 12.5
                  }}
                >
                  <Paperclip size={13} />
                  <span>{att.filename}</span>
                  <span style={{ opacity: 0.6, fontSize: 11 }}>({Math.round(att.fileSize / 1024)} KB)</span>
                  <ExternalLink size={12} style={{ marginLeft: 4 }} />
                </a>
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

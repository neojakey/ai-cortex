import React from 'react';
import { Plus, Calendar, Tag, ArrowRight } from 'lucide-react';

export default function KanbanView({
  notes,
  onSelectNote,
  onCreateNote,
  onUpdateNote
}) {
  // Columns based on status
  const columns = [
    { id: 'inbox', title: 'Inbox / Drafts', filter: (n) => n.status === 'draft' || !n.status },
    { id: 'active', title: 'Active Projects', filter: (n) => n.status === 'active' },
    { id: 'archived', title: 'Archived / Reference', filter: (n) => n.status === 'archived' }
  ];

  const handleStatusChange = (e, noteId, newStatus) => {
    e.stopPropagation();
    onUpdateNote(noteId, { status: newStatus });
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '20px 28px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Kanban Board</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Organize and manage your notes by workflow lifecycle
          </p>
        </div>
        <button className="btn-primary" onClick={onCreateNote}>
          <Plus size={15} />
          <span>New Note</span>
        </button>
      </div>

      <div className="kanban-container">
        {columns.map((col) => {
          const colNotes = notes.filter(col.filter);
          return (
            <div key={col.id} className="kanban-col">
              <div className="kanban-col-header">
                <span>{col.title}</span>
                <span className="badge-tag">{colNotes.length}</span>
              </div>

              <div className="kanban-cards">
                {colNotes.map((note) => (
                  <div
                    key={note.id}
                    className="kanban-card"
                    onClick={() => onSelectNote(note.id)}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
                      {note.title || 'Untitled'}
                    </div>

                    {note.preview && (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {note.preview}
                      </p>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {note.tags && note.tags.slice(0, 2).map((t) => (
                          <span key={t} className="badge-tag">#{t}</span>
                        ))}
                      </div>

                      {/* Move to next stage button */}
                      <select
                        className="prop-select"
                        value={note.status || 'active'}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => handleStatusChange(e, note.id, e.target.value)}
                        style={{ fontSize: 11, padding: '2px 4px' }}
                      >
                        <option value="draft">Draft</option>
                        <option value="active">Active</option>
                        <option value="archived">Archived</option>
                      </select>
                    </div>

                    {note.dueDate && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--accent-amber)', marginTop: 6 }}>
                        <Calendar size={12} />
                        <span>Due {new Date(note.dueDate).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

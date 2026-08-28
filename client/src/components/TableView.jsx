import React, { useState } from 'react';
import { Plus, ArrowUpDown, Tag, Calendar, ExternalLink } from 'lucide-react';

export default function TableView({
  notes,
  onSelectNote,
  onCreateNote,
  onUpdateNote
}) {
  const [filterText, setFilterText] = useState('');
  const [sortField, setSortField] = useState('updatedAt');
  const [sortAsc, setSortAsc] = useState(false);

  const filteredNotes = notes.filter((n) => {
    if (!filterText) return true;
    const q = filterText.toLowerCase();
    return (
      n.title.toLowerCase().includes(q) ||
      (n.tags && n.tags.some((t) => t.toLowerCase().includes(q))) ||
      n.status.toLowerCase().includes(q)
    );
  });

  const sortedNotes = [...filteredNotes].sort((a, b) => {
    let valA = a[sortField] || '';
    let valB = b[sortField] || '';
    if (sortAsc) return valA > valB ? 1 : -1;
    return valA < valB ? 1 : -1;
  });

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  return (
    <div className="table-view-container">
      <div className="table-header-actions">
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Database Grid</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Structured relational view of your SecondBrain notes
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <input
            type="text"
            className="prop-input"
            placeholder="Filter database..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            style={{ width: 220, padding: '7px 12px' }}
          />
          <button className="btn-primary" onClick={onCreateNote}>
            <Plus size={15} />
            <span>New Row</span>
          </button>
        </div>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th onClick={() => toggleSort('title')} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>Note Title</span>
                <ArrowUpDown size={12} />
              </div>
            </th>
            <th onClick={() => toggleSort('status')} style={{ cursor: 'pointer' }}>Status</th>
            <th>Due Date</th>
            <th>Tags</th>
            <th>Backlinks</th>
            <th onClick={() => toggleSort('updatedAt')} style={{ cursor: 'pointer' }}>Last Modified</th>
          </tr>
        </thead>
        <tbody>
          {sortedNotes.map((n) => (
            <tr key={n.id} onClick={() => onSelectNote(n.id)} style={{ cursor: 'pointer' }}>
              <td style={{ fontWeight: 500 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{n.title || 'Untitled'}</span>
                  <ExternalLink size={12} style={{ opacity: 0.4 }} />
                </div>
              </td>
              <td>
                <select
                  className="prop-select"
                  value={n.status || 'active'}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onUpdateNote(n.id, { status: e.target.value })}
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </td>
              <td>
                {n.dueDate ? (
                  <span style={{ fontSize: 12, color: 'var(--accent-amber)' }}>
                    {new Date(n.dueDate).toLocaleDateString()}
                  </span>
                ) : (
                  <span style={{ opacity: 0.4 }}>—</span>
                )}
              </td>
              <td>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {n.tags && n.tags.length > 0 ? (
                    n.tags.map((t) => <span key={t} className="badge-tag">#{t}</span>)
                  ) : (
                    <span style={{ opacity: 0.4 }}>—</span>
                  )}
                </div>
              </td>
              <td>
                {n.backlinkCount > 0 ? (
                  <span style={{ color: '#818cf8', fontWeight: 500 }}>⇄ {n.backlinkCount}</span>
                ) : (
                  <span style={{ opacity: 0.4 }}>0</span>
                )}
              </td>
              <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {new Date(n.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

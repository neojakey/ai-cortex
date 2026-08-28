import React, { useState, useEffect } from 'react';
import { CheckSquare, Square, Check, ArrowRight, ExternalLink } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function TasksView({ onSelectNote }) {
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState('pending'); // 'all', 'pending', 'completed'
  const [loading, setLoading] = useState(true);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/tasks');
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const toggleTask = async (task) => {
    try {
      // Optimistically update
      const newCompleted = !task.completed;
      setTasks((prev) =>
        prev.map((t) =>
          t.noteId === task.noteId && t.line === task.line
            ? { ...t, completed: newCompleted }
            : t
        )
      );

      if (newCompleted) {
        confetti({ particleCount: 40, spread: 60, origin: { y: 0.8 } });
      }

      // Fetch note to update line
      const res = await fetch(`/api/notes/${task.noteId}`);
      const data = await res.json();
      if (!data.note) return;

      const lines = data.note.content.split('\n');
      if (lines[task.line - 1]) {
        lines[task.line - 1] = lines[task.line - 1].replace(
          newCompleted ? /\[ \]/ : /\[[xX]\]/,
          newCompleted ? '[x]' : '[ ]'
        );
        await fetch(`/api/notes/${task.noteId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: lines.join('\n') })
        });
      }
    } catch (err) {
      console.error('Failed to toggle task:', err);
    }
  };

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'pending') return !t.completed;
    if (filter === 'completed') return t.completed;
    return true;
  });

  return (
    <div className="tasks-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Global Action Items</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Consolidated checklist aggregated across all your notes
          </p>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {['pending', 'completed', 'all'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: filter === f ? 'var(--accent-primary)' : 'var(--bg-surface)',
                color: filter === f ? '#ffffff' : 'var(--text-dim)',
                border: '1px solid var(--border-dim)',
                padding: '5px 12px',
                borderRadius: 'var(--radius-md)',
                fontSize: 12.5,
                fontWeight: 500,
                textTransform: 'capitalize',
                cursor: 'pointer'
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading tasks...</div>
      ) : filteredTasks.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic', padding: '20px 0' }}>
          No {filter} action items found. Add <code>- [ ] Task name</code> to any note!
        </div>
      ) : (
        filteredTasks.map((t, idx) => (
          <div key={`${t.noteId}-${t.line}-${idx}`} className="task-item">
            <input
              type="checkbox"
              className="task-checkbox"
              checked={t.completed}
              onChange={() => toggleTask(t)}
            />
            <span
              style={{
                flex: 1,
                fontSize: 14,
                textDecoration: t.completed ? 'line-through' : 'none',
                color: t.completed ? 'var(--text-muted)' : 'var(--text-main)'
              }}
            >
              {t.text}
            </span>

            <button
              onClick={() => onSelectNote(t.noteId)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 12,
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: 'var(--radius-sm)'
              }}
              title="Open origin note"
            >
              <span>{t.noteTitle}</span>
              <ExternalLink size={12} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

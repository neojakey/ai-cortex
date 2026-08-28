import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar.jsx';
import NoteEditor from './components/NoteEditor.jsx';
import KanbanView from './components/KanbanView.jsx';
import TableView from './components/TableView.jsx';
import TasksView from './components/TasksView.jsx';
import SearchPalette from './components/SearchPalette.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import { Trash2, RotateCcw, XCircle } from 'lucide-react';

export default function App() {
  const [notes, setNotes] = useState([]);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [activeNote, setActiveNote] = useState(null);
  const [activeView, setActiveView] = useState('document'); // 'document', 'kanban', 'table', 'tasks', 'trash'
  const [tags, setTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [health, setHealth] = useState(null);

  // Theme Management: 'dark' (Obsidian Carbon) vs 'light' (Warm Alabaster Paper)
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('ai_cortex_theme') || 
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ai_cortex_theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Fetch all active notes and tags
  const fetchData = useCallback(async () => {
    try {
      const notesUrl = selectedTag
        ? `/api/notes?status=active&tag=${encodeURIComponent(selectedTag)}`
        : `/api/notes?status=active`;

      const [notesRes, tagsRes, healthRes] = await Promise.all([
        fetch(notesUrl),
        fetch('/api/tags'),
        fetch('/api/health')
      ]);

      const notesData = await notesRes.json();
      const tagsData = await tagsRes.json();
      const healthData = await healthRes.json();

      setNotes(notesData.notes || []);
      setTags(tagsData.tags || []);
      setHealth(healthData);

      // Default select first note if none selected
      setActiveNoteId((cur) => cur || (notesData.notes && notesData.notes[0]?.id) || null);
    } catch (err) {
      console.error('Error fetching SecondBrain data:', err);
    }
  }, [selectedTag]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch full details of active note when ID changes
  useEffect(() => {
    if (!activeNoteId) {
      setActiveNote(null);
      return;
    }

    let isMounted = true;
    fetch(`/api/notes/${activeNoteId}`)
      .then((res) => res.json())
      .then((data) => {
        if (isMounted && data.note) {
          setActiveNote(data.note);
        }
      })
      .catch(console.error);

    return () => {
      isMounted = false;
    };
  }, [activeNoteId]);

  // Create a new note
  const handleCreateNote = useCallback(async () => {
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Untitled Note',
          content: '# Untitled Note\n\nStart writing or type [[ to link other notes...',
          status: 'active'
        })
      });
      const data = await res.json();
      if (data.note) {
        await fetchData();
        setActiveNoteId(data.note.id);
        setActiveView('document');
      }
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  }, [fetchData]);

  // Jump to or create today's daily note
  const handleOpenDaily = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch(`/api/daily?date=${today}`);
      const data = await res.json();
      if (data.note) {
        await fetchData();
        setActiveNoteId(data.note.id);
        setActiveView('document');
      }
    } catch (err) {
      console.error('Failed to load daily note:', err);
    }
  }, [fetchData]);

  // Update note
  const handleUpdateNote = async (id, updatePayload) => {
    try {
      const res = await fetch(`/api/notes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload)
      });
      const data = await res.json();
      if (data.note) {
        // Update local notes list title/preview if changed
        setNotes((prev) =>
          prev.map((n) =>
            n.id === id
              ? {
                  ...n,
                  title: data.note.title,
                  status: data.note.status,
                  dueDate: data.note.dueDate,
                  tags: data.note.tags
                }
              : n
          )
        );

        if (activeNote && activeNote.id === id) {
          setActiveNote(data.note);
        }
      }
    } catch (err) {
      console.error('Failed to update note:', err);
    }
  };

  // Soft delete note to trash
  const handleDeleteNote = useCallback(async (id) => {
    try {
      await fetch(`/api/notes/${id}`, { method: 'DELETE' });
      // Clear selection if the deleted note was active; fetchData re-selects the first note.
      setActiveNoteId((cur) => (cur === id ? null : cur));
      await fetchData();
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  }, [fetchData]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Cmd/Ctrl + K -> Global Search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }

      // Alt + D -> Today's Daily Note
      if (e.altKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        handleOpenDaily();
      }

      // Alt + T -> Toggle Theme (Light / Dark)
      if (e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        toggleTheme();
      }

      // Cmd/Ctrl + N -> New Note
      if ((e.metaKey || e.ctrlKey) && (e.key === 'n' || e.key === 'N') && !e.shiftKey) {
        e.preventDefault();
        handleCreateNote();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleOpenDaily, handleCreateNote, toggleTheme]);

  return (
    <div className="app-container">
      {/* Sidebar */}
      <Sidebar
        notes={notes}
        activeNoteId={activeNoteId}
        onSelectNote={(id) => {
          setActiveNoteId(id);
          setActiveView('document');
        }}
        onCreateNote={handleCreateNote}
        onOpenDaily={handleOpenDaily}
        activeView={activeView}
        onChangeView={setActiveView}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        tags={tags}
        selectedTag={selectedTag}
        onSelectTag={setSelectedTag}
        health={health}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {/* Main View Router */}
      <main className="main-view">
        {activeView === 'document' && (
          <NoteEditor
            note={activeNote}
            allNotes={notes}
            onUpdateNote={handleUpdateNote}
            onDeleteNote={handleDeleteNote}
            onSelectNote={(id) => setActiveNoteId(id)}
          />
        )}

        {activeView === 'kanban' && (
          <KanbanView
            notes={notes}
            onSelectNote={(id) => {
              setActiveNoteId(id);
              setActiveView('document');
            }}
            onCreateNote={handleCreateNote}
            onUpdateNote={handleUpdateNote}
          />
        )}

        {activeView === 'table' && (
          <TableView
            notes={notes}
            onSelectNote={(id) => {
              setActiveNoteId(id);
              setActiveView('document');
            }}
            onCreateNote={handleCreateNote}
            onUpdateNote={handleUpdateNote}
          />
        )}

        {activeView === 'tasks' && (
          <TasksView
            onSelectNote={(id) => {
              setActiveNoteId(id);
              setActiveView('document');
            }}
          />
        )}

        {activeView === 'trash' && (
          <TrashView
            onRestoreNote={async (id) => {
              await fetch(`/api/notes/${id}/restore`, { method: 'POST' });
              await fetchData();
              setActiveNoteId(id);
              setActiveView('document');
            }}
          />
        )}
      </main>

      {/* Search Modal (Cmd/Ctrl + K) */}
      <SearchPalette
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectNote={(id) => {
          setActiveNoteId(id);
          setActiveView('document');
        }}
      />

      {/* Settings & AI Integrations Hub */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        health={health}
        onRefreshData={fetchData}
      />
    </div>
  );
}

// Trash View Component
function TrashView({ onRestoreNote }) {
  const [trashNotes, setTrashNotes] = useState([]);

  useEffect(() => {
    fetch('/api/notes?status=trash')
      .then((res) => res.json())
      .then((data) => setTrashNotes(data.notes || []))
      .catch(console.error);
  }, []);

  return (
    <div style={{ padding: '32px 28px', maxWidth: 700, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <Trash2 size={22} color="var(--accent-rose)" />
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Trash Bin</h2>
      </div>

      {trashNotes.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>
          Trash is empty.
        </div>
      ) : (
        trashNotes.map((n) => (
          <div
            key={n.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-dim)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 8
            }}
          >
            <div>
              <div style={{ fontWeight: 500, fontSize: 14 }}>{n.title}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                Deleted {new Date(n.updatedAt).toLocaleDateString()}
              </div>
            </div>

            <button
              className="btn-primary"
              style={{ fontSize: 12, padding: '5px 10px' }}
              onClick={() => onRestoreNote(n.id)}
            >
              <RotateCcw size={13} />
              <span>Restore</span>
            </button>
          </div>
        ))
      )}
    </div>
  );
}

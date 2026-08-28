import React, { useState, useEffect, useRef } from 'react';
import { Search, FileText, ArrowRight, Tag } from 'lucide-react';

export default function SearchPalette({ isOpen, onClose, onSelectNote }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.results || []);
        setSelectedIndex(0);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [query]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (results.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + results.length) % (results.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        onSelectNote(results[selectedIndex].id);
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal-card" 
        style={{ maxWidth: 580, padding: 0 }} 
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--border-dim)' }}>
          <Search size={18} color="var(--text-muted)" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search notes, content, tags... (Esc to close)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 15,
              color: 'var(--text-main)'
            }}
          />
          <span className="kbd">ESC</span>
        </div>

        <div style={{ maxHeight: 360, overflowY: 'auto', padding: '8px' }}>
          {loading && (
            <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
              Searching MySQL database...
            </div>
          )}

          {!loading && query && results.length === 0 && (
            <div style={{ padding: 24, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
              No matching notes found for "{query}"
            </div>
          )}

          {results.map((r, i) => (
            <div
              key={r.id}
              onClick={() => {
                onSelectNote(r.id);
                onClose();
              }}
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                background: i === selectedIndex ? 'var(--bg-surface-hover)' : 'transparent',
                border: i === selectedIndex ? '1px solid var(--border-subtle)' : '1px solid transparent',
                marginBottom: 3,
                transition: 'all 0.1s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, fontSize: 14 }}>
                  <FileText size={15} color="#818cf8" />
                  <span>{r.title}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {new Date(r.updatedAt).toLocaleDateString()}
                </span>
              </div>

              {r.snippet && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, paddingLeft: 23 }}>
                  {r.snippet}...
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

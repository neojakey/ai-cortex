import React, { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Plus, Camera } from 'lucide-react';
import { localDateString } from '../lib/dates.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

// Month calendar of daily notes: a photo where the day has one, a text snippet where it doesn't.
export default function JournalView({ month: monthProp = null, onMonthChange, onSelectNote }) {
  const today = localDateString();
  // The shown month lives in the URL (via the app), so Back returns to it. null = this month.
  const shown = monthProp || today.slice(0, 7);
  const year = Number(shown.slice(0, 4));
  const month = Number(shown.slice(5, 7)) - 1; // 0-based
  const show = (y, m) => onMonthChange(`${y}-${pad(m + 1)}`);
  const [days, setDays] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(null);

  const load = () =>
    fetch('/api/journal')
      .then((r) => r.json())
      .then((d) => { setDays(d.days || []); setError(null); })
      .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  const byDate = useMemo(() => new Map((days || []).map((d) => [d.date, d])), [days]);
  // Always includes the shown year, so the dropdown is right before the entries have loaded.
  const years = useMemo(() => {
    const thisYear = Number(today.slice(0, 4));
    const first = days && days.length ? Number(days[0].date.slice(0, 4)) : thisYear;
    const list = [];
    for (let y = Math.max(thisYear, year); y >= Math.min(first, year); y -= 1) list.push(y);
    return list;
  }, [days, today, year]);

  const step = (delta) => {
    const d = new Date(year, month + delta, 1);
    show(d.getFullYear(), d.getMonth());
  };
  const goToday = () => onMonthChange(null);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first
  const cells = [];
  for (let i = 0; i < leading; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);

  const monthEntries = (days || []).filter((d) => d.date.startsWith(`${year}-${pad(month + 1)}-`));
  const monthPhotos = monthEntries.filter((d) => d.photoId).length;

  const openEmptyDay = async (date) => {
    if (creating) return;
    setCreating(date);
    try {
      const res = await fetch(`/api/daily?date=${date}`);
      const data = await res.json();
      if (data.note) onSelectNote(data.note.id);
    } finally {
      setCreating(null);
    }
  };

  return (
    <div className="journal-view">
      <div className="journal-header">
        <div className="journal-nav">
          <button className="btn-icon" onClick={() => step(-1)} title="Previous month"><ChevronLeft size={18} /></button>
          <select className="prop-select" value={month} onChange={(e) => show(year, Number(e.target.value))} aria-label="Month">
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <select className="prop-select" value={year} onChange={(e) => show(Number(e.target.value), month)} aria-label="Year">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="btn-icon" onClick={() => step(1)} title="Next month"><ChevronRight size={18} /></button>
          <button className="search-trigger-btn" onClick={goToday}>Today</button>
        </div>
        <div className="journal-stats">
          {days && (
            <>
              {monthEntries.length} {monthEntries.length === 1 ? 'entry' : 'entries'} · {monthPhotos} {monthPhotos === 1 ? 'photo' : 'photos'} this month
              <span className="journal-stats-total"> · {days.length} entries in total</span>
            </>
          )}
        </div>
      </div>

      {error && <div className="journal-empty">Could not load the journal: {error}</div>}

      <div className="journal-grid" role="grid">
        {WEEKDAYS.map((w) => <div key={w} className="journal-weekday">{w}</div>)}
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} className="journal-cell is-blank" />;
          const key = dateKey(year, month, d);
          const entry = byDate.get(key);
          const isToday = key === today;
          const isFuture = key > today;
          const snippet = entry ? entry.preview.replace(/^Daily: \d{4}-\d{2}-\d{2}\s*/, '') : '';

          if (entry) {
            return (
              <button
                key={key}
                className={`journal-cell has-entry ${entry.photoId ? 'has-photo' : ''} ${isToday ? 'is-today' : ''}`}
                onClick={() => onSelectNote(entry.noteId)}
                title={key}
              >
                {entry.photoId && (
                  <img
                    src={`/api/attachments/${entry.photoId}/thumb`}
                    alt=""
                    loading="lazy"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                )}
                <span className="journal-day">{d}</span>
                {!entry.photoId && <span className="journal-snippet">{snippet}</span>}
                {entry.imageCount > 1 && (
                  <span className="journal-multi"><Camera size={11} /> {entry.imageCount}</span>
                )}
              </button>
            );
          }
          return (
            <button
              key={key}
              className={`journal-cell is-empty ${isToday ? 'is-today' : ''}`}
              disabled={isFuture || creating === key}
              onClick={() => openEmptyDay(key)}
              title={isFuture ? '' : `Start an entry for ${key}`}
            >
              <span className="journal-day">{d}</span>
              {!isFuture && <Plus size={14} className="journal-add" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

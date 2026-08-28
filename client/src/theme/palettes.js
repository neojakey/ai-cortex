/**
 * Curated Color Schemes for AI-Cortex
 * Matching the 16-swatch grid (split-circle quadrants) with tailored Dark and Light harmonies.
 */

export const COLOR_SCHEMES = [
  // ROW 1: Blues & Neutrals
  {
    id: 'cobalt',
    name: 'Electric Cobalt',
    swatchDark: { top: '#1d4ed8', left: '#93c5fd', right: '#64748b' },
    swatchLight: { top: '#bfdbfe', left: '#1d4ed8', right: '#cbd5e1' },
    dark: {
      primary: '#3b82f6',
      gradient: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 50%, #60a5fa 100%)',
      glow: 'rgba(59, 130, 246, 0.3)',
      chip: 'rgba(59, 130, 246, 0.14)',
      focus: '#60a5fa'
    },
    light: {
      primary: '#1d4ed8',
      gradient: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)',
      glow: 'rgba(29, 78, 216, 0.18)',
      chip: 'rgba(29, 78, 216, 0.08)',
      focus: '#2563eb'
    }
  },
  {
    id: 'charcoal',
    name: 'Monochrome Zinc',
    swatchDark: { top: '#3f3f46', left: '#a1a1aa', right: '#71717a' },
    swatchLight: { top: '#e4e4e7', left: '#27272a', right: '#d4d4d8' },
    dark: {
      primary: '#a1a1aa',
      gradient: 'linear-gradient(135deg, #71717a 0%, #a1a1aa 100%)',
      glow: 'rgba(161, 161, 170, 0.25)',
      chip: 'rgba(255, 255, 255, 0.1)',
      focus: '#d4d4d8'
    },
    light: {
      primary: '#27272a',
      gradient: 'linear-gradient(135deg, #18181b 0%, #3f3f46 100%)',
      glow: 'rgba(39, 39, 42, 0.15)',
      chip: 'rgba(0, 0, 0, 0.07)',
      focus: '#18181b'
    }
  },
  {
    id: 'navy',
    name: 'Deep Ocean',
    swatchDark: { top: '#1e3a8a', left: '#60a5fa', right: '#475569' },
    swatchLight: { top: '#dbeafe', left: '#1e3a8a', right: '#94a3b8' },
    dark: {
      primary: '#60a5fa',
      gradient: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
      glow: 'rgba(96, 165, 250, 0.3)',
      chip: 'rgba(96, 165, 250, 0.12)',
      focus: '#93c5fd'
    },
    light: {
      primary: '#1e40af',
      gradient: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 100%)',
      glow: 'rgba(30, 64, 175, 0.18)',
      chip: 'rgba(30, 64, 175, 0.08)',
      focus: '#1d4ed8'
    }
  },
  {
    id: 'steel',
    name: 'Nordic Steel',
    swatchDark: { top: '#334155', left: '#94a3b8', right: '#64748b' },
    swatchLight: { top: '#e2e8f0', left: '#334155', right: '#cbd5e1' },
    dark: {
      primary: '#94a3b8',
      gradient: 'linear-gradient(135deg, #475569 0%, #64748b 50%, #94a3b8 100%)',
      glow: 'rgba(148, 163, 184, 0.25)',
      chip: 'rgba(148, 163, 184, 0.12)',
      focus: '#cbd5e1'
    },
    light: {
      primary: '#334155',
      gradient: 'linear-gradient(135deg, #1e293b 0%, #475569 100%)',
      glow: 'rgba(51, 65, 85, 0.16)',
      chip: 'rgba(51, 65, 85, 0.08)',
      focus: '#1e293b'
    }
  },

  // ROW 2: Teals & Greens
  {
    id: 'slate-teal',
    name: 'Mineral Slate',
    swatchDark: { top: '#2f4858', left: '#94d2bd', right: '#6b705c' },
    swatchLight: { top: '#d8e2dc', left: '#2f4858', right: '#b7b7a4' },
    dark: {
      primary: '#5eead4',
      gradient: 'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)',
      glow: 'rgba(94, 234, 212, 0.3)',
      chip: 'rgba(94, 234, 212, 0.12)',
      focus: '#99f6e4'
    },
    light: {
      primary: '#0f766e',
      gradient: 'linear-gradient(135deg, #115e59 0%, #0d9488 100%)',
      glow: 'rgba(15, 118, 110, 0.18)',
      chip: 'rgba(15, 118, 110, 0.08)',
      focus: '#0f766e'
    }
  },
  {
    id: 'teal',
    name: 'Cyber Teal',
    swatchDark: { top: '#044e54', left: '#48e5c2', right: '#4f6d7a' },
    swatchLight: { top: '#cbf3f0', left: '#044e54', right: '#8ecae6' },
    dark: {
      primary: '#2dd4bf',
      gradient: 'linear-gradient(135deg, #0d9488 0%, #14b8a6 50%, #2dd4bf 100%)',
      glow: 'rgba(45, 212, 191, 0.3)',
      chip: 'rgba(45, 212, 191, 0.12)',
      focus: '#5eead4'
    },
    light: {
      primary: '#0d9488',
      gradient: 'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)',
      glow: 'rgba(13, 148, 136, 0.18)',
      chip: 'rgba(13, 148, 136, 0.08)',
      focus: '#0f766e'
    }
  },
  {
    id: 'emerald',
    name: 'Emerald Forest',
    swatchDark: { top: '#14532d', left: '#86efac', right: '#4b5563' },
    swatchLight: { top: '#dcfce7', left: '#15803d', right: '#86efac' },
    dark: {
      primary: '#10b981',
      gradient: 'linear-gradient(135deg, #059669 0%, #10b981 50%, #34d399 100%)',
      glow: 'rgba(16, 185, 129, 0.3)',
      chip: 'rgba(16, 185, 129, 0.12)',
      focus: '#34d399'
    },
    light: {
      primary: '#059669',
      gradient: 'linear-gradient(135deg, #047857 0%, #10b981 100%)',
      glow: 'rgba(5, 150, 105, 0.18)',
      chip: 'rgba(5, 150, 105, 0.08)',
      focus: '#047857'
    }
  },
  {
    id: 'sage',
    name: 'Muted Sage',
    swatchDark: { top: '#283618', left: '#ccd5ae', right: '#606c38' },
    swatchLight: { top: '#e9edc9', left: '#283618', right: '#ccd5ae' },
    dark: {
      primary: '#a3e635',
      gradient: 'linear-gradient(135deg, #4d7c0f 0%, #65a30d 100%)',
      glow: 'rgba(163, 230, 53, 0.25)',
      chip: 'rgba(163, 230, 53, 0.12)',
      focus: '#bef264'
    },
    light: {
      primary: '#4d7c0f',
      gradient: 'linear-gradient(135deg, #3f6212 0%, #65a30d 100%)',
      glow: 'rgba(77, 124, 15, 0.18)',
      chip: 'rgba(77, 124, 15, 0.08)',
      focus: '#3f6212'
    }
  },

  // ROW 3: Warm Earth & Ambers
  {
    id: 'amber',
    name: 'Imperial Gold',
    swatchDark: { top: '#78350f', left: '#fde047', right: '#713f12' },
    swatchLight: { top: '#fef08a', left: '#a16207', right: '#fde047' },
    dark: {
      primary: '#fbbf24',
      gradient: 'linear-gradient(135deg, #d97706 0%, #f59e0b 50%, #fbbf24 100%)',
      glow: 'rgba(251, 191, 36, 0.3)',
      chip: 'rgba(251, 191, 36, 0.12)',
      focus: '#fde68a'
    },
    light: {
      primary: '#b45309',
      gradient: 'linear-gradient(135deg, #92400e 0%, #d97706 100%)',
      glow: 'rgba(180, 83, 9, 0.18)',
      chip: 'rgba(180, 83, 9, 0.08)',
      focus: '#92400e'
    }
  },
  {
    id: 'terracotta',
    name: 'Tuscan Rust',
    swatchDark: { top: '#7c2d12', left: '#fdba74', right: '#78350f' },
    swatchLight: { top: '#ffedd5', left: '#c2410c', right: '#fdba74' },
    dark: {
      primary: '#fb923c',
      gradient: 'linear-gradient(135deg, #ea580c 0%, #f97316 100%)',
      glow: 'rgba(251, 146, 60, 0.3)',
      chip: 'rgba(251, 146, 60, 0.12)',
      focus: '#fdba74'
    },
    light: {
      primary: '#c2410c',
      gradient: 'linear-gradient(135deg, #9a3412 0%, #ea580c 100%)',
      glow: 'rgba(194, 65, 12, 0.18)',
      chip: 'rgba(194, 65, 12, 0.08)',
      focus: '#9a3412'
    }
  },
  {
    id: 'sandstone',
    name: 'Warm Sandstone',
    swatchDark: { top: '#44403c', left: '#d6d3d1', right: '#78716c' },
    swatchLight: { top: '#f5f5f4', left: '#44403c', right: '#d6d3d1' },
    dark: {
      primary: '#d6d3d1',
      gradient: 'linear-gradient(135deg, #78716c 0%, #a8a29e 100%)',
      glow: 'rgba(214, 211, 209, 0.25)',
      chip: 'rgba(214, 211, 209, 0.12)',
      focus: '#e7e5e4'
    },
    light: {
      primary: '#57534e',
      gradient: 'linear-gradient(135deg, #292524 0%, #57534e 100%)',
      glow: 'rgba(87, 83, 78, 0.16)',
      chip: 'rgba(87, 83, 78, 0.08)',
      focus: '#292524'
    }
  },
  {
    id: 'rose',
    name: 'Crimson Berry',
    swatchDark: { top: '#831843', left: '#f472b6', right: '#701a75' },
    swatchLight: { top: '#fce7f3', left: '#be185d', right: '#f472b6' },
    dark: {
      primary: '#f43f5e',
      gradient: 'linear-gradient(135deg, #e11d48 0%, #f43f5e 50%, #fb7185 100%)',
      glow: 'rgba(244, 63, 94, 0.3)',
      chip: 'rgba(244, 63, 94, 0.12)',
      focus: '#fda4af'
    },
    light: {
      primary: '#be123c',
      gradient: 'linear-gradient(135deg, #9f1239 0%, #e11d48 100%)',
      glow: 'rgba(190, 18, 60, 0.18)',
      chip: 'rgba(190, 18, 60, 0.08)',
      focus: '#9f1239'
    }
  },

  // ROW 4: Purples & Violets
  {
    id: 'mauve',
    name: 'Dusk Mauve',
    swatchDark: { top: '#4c1d95', left: '#c084fc', right: '#581c87' },
    swatchLight: { top: '#f3e8ff', left: '#6b21a8', right: '#c084fc' },
    dark: {
      primary: '#c084fc',
      gradient: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
      glow: 'rgba(192, 132, 252, 0.3)',
      chip: 'rgba(192, 132, 252, 0.12)',
      focus: '#e9d5ff'
    },
    light: {
      primary: '#7e22ce',
      gradient: 'linear-gradient(135deg, #6b21a8 0%, #9333ea 100%)',
      glow: 'rgba(126, 34, 206, 0.18)',
      chip: 'rgba(126, 34, 206, 0.08)',
      focus: '#6b21a8'
    }
  },
  {
    id: 'plum',
    name: 'Midnight Plum',
    swatchDark: { top: '#581c87', left: '#f0abfc', right: '#4a044e' },
    swatchLight: { top: '#fae8ff', left: '#86198f', right: '#f0abfc' },
    dark: {
      primary: '#e879f9',
      gradient: 'linear-gradient(135deg, #c026d3 0%, #e879f9 100%)',
      glow: 'rgba(232, 121, 249, 0.3)',
      chip: 'rgba(232, 121, 249, 0.12)',
      focus: '#f5d0fe'
    },
    light: {
      primary: '#a21caf',
      gradient: 'linear-gradient(135deg, #701a75 0%, #c026d3 100%)',
      glow: 'rgba(162, 28, 175, 0.18)',
      chip: 'rgba(162, 28, 175, 0.08)',
      focus: '#701a75'
    }
  },
  {
    id: 'indigo',
    name: 'Neural Violet',
    swatchDark: { top: '#312e81', left: '#a5b4fc', right: '#4338ca' },
    swatchLight: { top: '#e0e7ff', left: '#3730a3', right: '#a5b4fc' },
    dark: {
      primary: '#818cf8',
      gradient: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%)',
      glow: 'rgba(129, 140, 248, 0.3)',
      chip: 'rgba(129, 140, 248, 0.12)',
      focus: '#c7d2fe'
    },
    light: {
      primary: '#4338ca',
      gradient: 'linear-gradient(135deg, #3730a3 0%, #4f46e5 100%)',
      glow: 'rgba(67, 56, 202, 0.18)',
      chip: 'rgba(67, 56, 202, 0.08)',
      focus: '#3730a3'
    }
  }
];

/**
 * Apply color scheme variables dynamically to root element
 */
export function applyColorScheme(schemeId, isDark = true, customHex = null) {
  const root = document.documentElement;

  if (customHex) {
    root.style.setProperty('--accent-primary', customHex);
    root.style.setProperty('--accent-primary-gradient', `linear-gradient(135deg, ${customHex} 0%, ${customHex}dd 100%)`);
    root.style.setProperty('--accent-glow', `${customHex}44`);
    root.style.setProperty('--border-focus', customHex);
    root.style.setProperty('--border-accent-glow', `${customHex}66`);
    root.style.setProperty('--bg-chip', `${customHex}1a`);
    return;
  }

  const scheme = COLOR_SCHEMES.find((s) => s.id === schemeId) || COLOR_SCHEMES[0];
  const palette = isDark ? scheme.dark : scheme.light;

  root.style.setProperty('--accent-primary', palette.primary);
  root.style.setProperty('--accent-primary-gradient', palette.gradient);
  root.style.setProperty('--accent-glow', palette.glow);
  root.style.setProperty('--border-focus', palette.focus);
  root.style.setProperty('--border-accent-glow', palette.glow);
  root.style.setProperty('--bg-chip', palette.chip);
}

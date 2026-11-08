/** Monochrome line icons for the menu hub (24×24, stroke = currentColor, so they take the tile's text colour). */
const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  fight: svg('<path d="M4 4l9 9M4 4h4M4 4v4"/><path d="M20 4l-9 9M20 4h-4M20 4v4"/><path d="M7 14l3 3M14 17l3-3M5 19l3-3M19 19l-3-3"/>'),
  brawl: svg('<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4 0-6 1-9z"/>'),
  survival: svg('<path d="M7 8a4 4 0 1 0 0 8c3 0 7-8 10-8a4 4 0 1 1 0 8c-3 0-7-8-10-8z"/>'),
  daily: svg('<path d="M3 5h18v16H3zM3 10h18M8 2v5M16 2v5"/><path d="M8 14h3v3H8z"/>'),
  duel: svg('<path d="M3 8h14l-4-4M21 16H7l4 4"/>'),
  tutorial: svg('<path d="M5 21V3h12l-2 4 2 4H5"/>'),
  garage: svg('<path d="M14 6a4 4 0 0 0 5 5l2-2a6 6 0 0 1-8 8l-6 6-4-4 6-6a6 6 0 0 1 8-8z"/>'),
  paint: svg('<path d="M4 4h14v6H4zM18 7h2v6h-8v3"/><path d="M10 16h4v6h-4z"/>'),
  story: svg('<path d="M4 4h6a2 2 0 0 1 2 2v15a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v15a2 2 0 0 1 2-2h6z"/>'),
  trophy: svg('<path d="M7 3h10v6a5 5 0 0 1-10 0zM7 5H3v2a4 4 0 0 0 4 4M17 5h4v2a4 4 0 0 1-4 4M12 14v4M7 21h10M9 18h6"/>'),
  settings: svg('<path d="M3 6h18M3 12h18M3 18h18"/><path d="M7 4v4M15 10v4M10 16v4" stroke-width="3.4"/>'),
  help: svg('<path d="M8 8a4 4 0 1 1 6 3.5c-1.5.8-2 1.5-2 3"/><path d="M12 18v3"/>'),
  soundOn: svg('<path d="M3 9h4l5-4v14l-5-4H3z"/><path d="M16 8c2 2 2 6 0 8M19 5c4 4 4 10 0 14"/>'),
  soundOff: svg('<path d="M3 9h4l5-4v14l-5-4H3z"/><path d="M16 9l6 6M22 9l-6 6"/>'),
} as const;

export type IconName = keyof typeof ICONS;

export type HighlightColor = 'yellow' | 'red';
export const HIGHLIGHTS_KEY = 'stock11.highlights.v1';

export function restoreHighlights(raw: string | null): Map<string, HighlightColor> {
  const result = new Map<string, HighlightColor>();
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value)) return result;
    for (const entry of value) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [key, color] = entry;
      if (typeof key === 'string' && /^(KOSPI|KOSDAQ|NASDAQ|NYSE|AMEX|SP500):[A-Za-z0-9.^-]{1,24}$/.test(key)
        && (color === 'yellow' || color === 'red')) result.set(key, color);
    }
  } catch { /* Corrupt preferences must not prevent the dashboard from opening. */ }
  return result;
}

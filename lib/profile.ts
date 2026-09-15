import type { StockSelection } from './market-types';
import { restoreWatchlist, symbolKey } from './watchlist';
import { restoreHighlights, type HighlightColor } from './stock-highlights';

// Values 0–4 are kept stable for existing saved profiles. -1 is the new
// smaller stage and 6 is the new largest stage; 5 remains reserved so old
// clients/tests that reject it continue to fail closed.
export type TextScale = -1 | 0 | 1 | 2 | 3 | 4 | 6;
export type WatchlistId = 0 | 1 | 2;
export type Profile = { version: 1; revision: number; updatedAt: string | null; watchlist: StockSelection[]; watchlists?: [StockSelection[], StockSelection[], StockSelection[]]; highlights: [string, HighlightColor][]; settings: { largeText: boolean; textScale: TextScale } };
export type ProfileOperation =
  | { type: 'add'; item: StockSelection; list?: WatchlistId }
  | { type: 'remove'; key: string; list?: WatchlistId }
  | { type: 'move'; key: string; before: string | null; list?: WatchlistId }
  | { type: 'highlight'; key: string; color: HighlightColor | null }
  | { type: 'settings'; largeText: boolean; textScale?: TextScale }
  | { type: 'import'; watchlist: StockSelection[]; watchlists?: [StockSelection[], StockSelection[], StockSelection[]]; highlights: [string, HighlightColor][]; largeText?: boolean; textScale?: TextScale };
export const emptyProfile = (): Profile => ({ version: 1, revision: 0, updatedAt: null, watchlist: [], highlights: [], settings: { largeText: true, textScale: 1 } });
const validKey = (key: unknown): key is string => typeof key === 'string' && /^(KOSPI|KOSDAQ|NASDAQ|NYSE|AMEX):[A-Za-z0-9.^-]{1,24}$/.test(key);
const validTextScale = (value: unknown): value is TextScale => Number.isInteger(value) && (value === -1 || (Number(value) >= 0 && Number(value) <= 4) || value === 6);
const validList = (value: unknown): value is WatchlistId => value === undefined || value === 0 || value === 1 || value === 2;
export function profileWatchlists(profile: Profile): [StockSelection[], StockSelection[], StockSelection[]] {
  const lists = profile.watchlists;
  return lists && lists.length === 3 ? [lists[0], lists[1], lists[2]] : [profile.watchlist, [], []];
}
export function parseOperation(value: unknown): ProfileOperation {
  if (!value || typeof value !== 'object') throw new Error('잘못된 변경 요청입니다.');
  const op = value as Record<string, unknown>;
  if (op.type === 'settings' && typeof op.largeText === 'boolean' && (op.textScale === undefined || validTextScale(op.textScale))) {
    const textScale = op.textScale ?? (op.largeText ? 1 : 0);
    return { type: 'settings', largeText: textScale > 0, textScale };
  }
  if (op.type === 'add') {
    const items = restoreWatchlist(JSON.stringify([op.item]));
    if (items.length === 1 && validList(op.list)) return { type: 'add', item: items[0], ...(op.list === undefined ? {} : { list: op.list }) };
  }
  if (op.type === 'remove' && validKey(op.key) && validList(op.list)) return { type: 'remove', key: op.key, ...(op.list === undefined ? {} : { list: op.list }) };
  if (op.type === 'move' && validKey(op.key) && (op.before === null || validKey(op.before)) && validList(op.list)) return { type: 'move', key: op.key, before: op.before, ...(op.list === undefined ? {} : { list: op.list }) };
  if (op.type === 'highlight' && validKey(op.key) && (op.color === null || op.color === 'red' || op.color === 'yellow')) return { type: 'highlight', key: op.key, color: op.color };
  if (op.type === 'import' && Array.isArray(op.watchlist) && op.watchlist.length <= 200 && Array.isArray(op.highlights) && op.highlights.length <= 2000) {
    const rawLists = Array.isArray(op.watchlists) && op.watchlists.length === 3 ? op.watchlists : [op.watchlist, [], []];
    if (!rawLists.every((list) => Array.isArray(list) && list.length <= 200)) throw new Error('잘못된 관심종목 목록입니다.');
    const watchlists = rawLists.map((list) => restoreWatchlist(JSON.stringify(list))) as [StockSelection[], StockSelection[], StockSelection[]];
    const highlights = [...restoreHighlights(JSON.stringify(op.highlights))];
    if (watchlists.every((list, index) => list.length === rawLists[index].length) && highlights.length === op.highlights.length
      && (op.largeText === undefined || typeof op.largeText === 'boolean') && (op.textScale === undefined || validTextScale(op.textScale))) {
      const textScale = op.textScale ?? (op.largeText === undefined ? undefined : op.largeText ? 1 : 0);
      return { type: 'import', watchlist: watchlists[0], watchlists, highlights, ...(textScale === undefined ? {} : { largeText: textScale > 0, textScale }) };
    }
  }
  throw new Error('잘못된 변경 요청입니다.');
}
export function applyOperation(profile: Profile, op: ProfileOperation): Profile {
  if (op.type === 'settings') {
    const textScale = op.textScale ?? (op.largeText ? 1 : 0);
    return { ...profile, settings: { largeText: textScale > 0, textScale } };
  }
  const lists = profileWatchlists(profile).map((list) => [...list]) as [StockSelection[], StockSelection[], StockSelection[]];
  const listIndex = op.type === 'add' || op.type === 'remove' || op.type === 'move' ? op.list ?? 0 : 0;
  const watchlist = lists[listIndex];
  const highlights = new Map(profile.highlights);
  if (op.type === 'add' && !watchlist.some((item) => symbolKey(item) === symbolKey(op.item))) {
    if (watchlist.length >= 200) throw new Error('관심종목은 최대 200개입니다.');
    watchlist.push(op.item);
  }
  if (op.type === 'remove') lists[listIndex] = watchlist.filter((item) => symbolKey(item) !== op.key);
  if (op.type === 'move' && op.key !== op.before) {
    const item = watchlist.find((entry) => symbolKey(entry) === op.key);
    if (item) {
      lists[listIndex] = watchlist.filter((entry) => symbolKey(entry) !== op.key);
      const index = op.before === null ? -1 : lists[listIndex].findIndex((entry) => symbolKey(entry) === op.before);
      lists[listIndex].splice(index < 0 ? lists[listIndex].length : index, 0, item);
    }
  }
  if (op.type === 'highlight') {
    if (op.color) highlights.set(op.key, op.color); else highlights.delete(op.key);
    if (highlights.size > 2000) throw new Error('배경색 표시는 최대 2000개입니다.');
  }
  if (op.type === 'import') {
    if (profile.revision !== 0) throw new Error('이미 서버 기록이 있어 가져올 수 없습니다. 최신 기록을 불러오세요.');
    const textScale = op.textScale ?? (op.largeText === undefined ? profile.settings.textScale : op.largeText ? 1 : 0);
    const imported = op.watchlists ?? [op.watchlist, [], []];
    return { ...profile, watchlist: imported[0], watchlists: imported, highlights: op.highlights, settings: { largeText: textScale > 0, textScale } };
  }
  return { ...profile, watchlist: lists[0], watchlists: lists, highlights: [...highlights] };
}

export function restoreProfile(value: unknown): Profile | null {
  if (!value || typeof value !== 'object') return null;
  const profile = value as Profile;
  if (profile.version !== 1 || !Number.isSafeInteger(profile.revision) || profile.revision < 0
    || (profile.updatedAt !== null && (typeof profile.updatedAt !== 'string' || !Number.isFinite(Date.parse(profile.updatedAt))))
    || !Array.isArray(profile.watchlist) || profile.watchlist.length > 200 || !Array.isArray(profile.highlights) || profile.highlights.length > 2000
    || typeof profile.settings?.largeText !== 'boolean'
    || (profile.settings.textScale !== undefined && !validTextScale(profile.settings.textScale))) return null;
  const rawLists = Array.isArray(profile.watchlists) && profile.watchlists.length === 3 ? profile.watchlists : [profile.watchlist, [], []];
  if (!rawLists.every((list) => Array.isArray(list) && list.length <= 200)) return null;
  const watchlists = rawLists.map((list) => restoreWatchlist(JSON.stringify(list))) as [StockSelection[], StockSelection[], StockSelection[]];
  const highlights = [...restoreHighlights(JSON.stringify(profile.highlights))];
  if (watchlists.some((list, index) => list.length !== rawLists[index].length) || highlights.length !== profile.highlights.length) return null;
  const textScale = validTextScale(profile.settings.textScale) ? profile.settings.textScale : profile.settings.largeText ? 1 : 0;
  return { version: 1, revision: profile.revision, updatedAt: profile.updatedAt, watchlist: watchlists[0], watchlists, highlights, settings: { largeText: textScale > 0, textScale } };
}

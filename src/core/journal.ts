/**
 * THE KEEPER'S BOOK
 *
 * The garden already remembers where seeds came down. It does not remember
 * *when*, or who was holding the wind. That is what a person keeps: a ledger.
 *
 * Every completed run is written into this book — the day, how many seeds came
 * home, which way the wind was running — and the book is drawn on the desk, in
 * ink, by the same hand that writes the specimen labels. Come back tomorrow and
 * yesterday is still there, in your own writing.
 *
 * Plain data, validated on load, and pure, so the whole thing is testable
 * without a browser.
 */
import { hash01 } from './random.js';

export const JOURNAL_VERSION = 1;
export const JOURNAL_STORAGE_KEY = 'gust.journal.v1';
export const MAX_ENTRIES = 22;
export const DEFAULT_KEEPER = 'KEEPER OF SMALL WEATHERS';
const MAX_KEEPER = 26;

export interface JournalEntry {
  /** Days since the epoch, UTC. */
  day: number;
  /** Seeds that came home in that run. */
  seeds: number;
  /** Bearing the wind was running toward, degrees clockwise from north. */
  bearing: number;
  /** 0..1 — how alive the air was (mean airflow of the completed finale). */
  air: number;
  /** The course's name, if the run had one. */
  course: string;
}

export interface Journal {
  version: number;
  keeper: string;
  /** Newest first. */
  entries: JournalEntry[];
}

export const emptyJournal = (keeper = DEFAULT_KEEPER): Journal => ({
  version: JOURNAL_VERSION,
  keeper,
  entries: [],
});

const MONTHS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];
const DAY_MS = 86400000;

/** Calendar parts of a day number, in UTC. */
export function dayParts(day: number): { year: number; month: number; date: number } {
  const d = new Date(day * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate() };
}

/** A naturalist's date: day, roman month, two-digit year — `xii.xi.26`. */
export function entryDate(entry: JournalEntry): string {
  const p = dayParts(entry.day);
  const yy = String(p.year % 100).padStart(2, '0');
  return `${p.date}.${MONTHS[p.month]}.${yy}`;
}

/** Today, as a day number. */
export const today = (now = Date.now()): number => Math.floor(now / DAY_MS);

const ONES = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** Counts as words while they are still countable by eye. */
export function countWord(n: number): string {
  const i = Math.max(0, Math.min(ONES.length - 1, Math.round(n)));
  return ONES[i];
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Which way the wind was running, in words. */
export function windPhrase(bearing: number): string {
  const b = ((bearing % 360) + 360) % 360;
  return COMPASS[Math.round(b / 45) % 8];
}

/** Bearing of a wind vector: the direction the air is travelling toward. */
export function bearingOf(x: number, z: number): number {
  if (x === 0 && z === 0) return 0;
  const deg = (Math.atan2(x, -z) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export interface RunRecord {
  day: number;
  seeds: number;
  /** Ambient wind when the run ended. */
  x: number;
  z: number;
  air: number;
  course?: string;
}

export function entryFor(record: RunRecord): JournalEntry {
  const seeds = Math.max(0, Math.min(99, Math.round(record.seeds)));
  return {
    day: Math.max(0, Math.round(record.day)),
    seeds,
    bearing: Math.round(bearingOf(record.x, record.z)) % 360,
    air: Math.max(0, Math.min(1, record.air)),
    course: (record.course ?? '').slice(0, 40),
  };
}

/** Fold one run into the book. Newest first; the oldest page falls away. */
export function addEntry(journal: Journal, entry: JournalEntry): Journal {
  const entries = [entry, ...journal.entries];
  while (entries.length > MAX_ENTRIES) entries.pop();
  return { ...journal, entries };
}

/** The keeper's name, as it can be cut into brass. */
export function sanitizeKeeper(name: string | null | undefined): string {
  if (!name) return DEFAULT_KEEPER;
  const clean = name
    .toUpperCase()
    .replace(/[^A-Z .'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_KEEPER);
  return clean.length >= 2 ? clean : DEFAULT_KEEPER;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Parse the stored book. Anything doubtful yields a clean book, never an error. */
export function parseJournal(json: string | null | undefined): Journal {
  if (!json) return emptyJournal();
  try {
    const raw = JSON.parse(json) as Record<string, unknown> | null;
    if (raw === null || typeof raw !== 'object') return emptyJournal();
    const journal = emptyJournal(sanitizeKeeper(typeof raw.keeper === 'string' ? raw.keeper : null));
    if (raw.version !== JOURNAL_VERSION || !Array.isArray(raw.entries)) return journal;
    for (const item of raw.entries.slice(0, MAX_ENTRIES)) {
      if (item === null || typeof item !== 'object') continue;
      const e = item as Record<string, unknown>;
      if (!finite(e.day) || !finite(e.seeds)) continue;
      journal.entries.push({
        day: Math.max(0, Math.floor(e.day)),
        seeds: Math.max(0, Math.min(99, Math.floor(e.seeds))),
        bearing: finite(e.bearing) ? ((Math.round(e.bearing) % 360) + 360) % 360 : 0,
        air: finite(e.air) ? Math.max(0, Math.min(1, e.air)) : 0,
        course: typeof e.course === 'string' ? e.course.slice(0, 40) : '',
      });
    }
    return journal;
  } catch {
    return emptyJournal();
  }
}

export function serializeJournal(journal: Journal): string {
  return JSON.stringify({
    version: JOURNAL_VERSION,
    keeper: sanitizeKeeper(journal.keeper),
    entries: journal.entries.slice(0, MAX_ENTRIES).map((e) => ({
      day: Math.round(e.day),
      seeds: Math.round(e.seeds),
      bearing: Math.round(e.bearing),
      air: Math.round(e.air * 100) / 100,
      course: e.course.slice(0, 40),
    })),
  });
}

/** One line of the book, as it will be written. */
/**
 * THE HIDDEN LINE.
 *
 * After a player's first completed run, a line appears in the book in a hand
 * that is not the keeper's. It is never explained, never announced, and never
 * mentioned in the game's text: it is the thing players are meant to tell each
 * other about. Twelve words or fewer, dry, and true of the game's own physics —
 * a seed that has been up in a strong gust will not lift again until the air
 * settles.
 *
 * Returns null until a run has actually been completed, so a first visitor sees
 * a clean page.
 */
export function previousKeepersNote(runs: number): string | null {
  if (!Number.isFinite(runs) || runs < 1) return null;
  return 'the dandelion keeps its seed till the third gust';
}

export interface LedgerLine {
  date: string;
  count: string;
  wind: string;
}

export function ledgerLine(entry: JournalEntry): LedgerLine {
  return { date: entryDate(entry), count: `${countWord(entry.seeds)} came home`, wind: `wind ${windPhrase(entry.bearing)}` };
}

/**
 * The book comes to you already written in.
 *
 * A desk bought at an auction has someone else's record in the back pages, in
 * someone else's hand. That is the difference between a save file and an
 * object with a history — so a new player finds a book that a previous keeper
 * left behind, and their own entries go in underneath it.
 */
const PAST_WINDS = [212, 168, 244, 96, 301, 186, 128, 259, 74];
const PAST_SEEDS = [9, 4, 12, 2, 7, 11, 5, 8, 3];

export function firstBook(day = today()): Journal {
  const entries: JournalEntry[] = [];
  // a fortnight or so of work, with a gap where it rained and nothing flew
  for (let i = 0; i < PAST_SEEDS.length; i++) {
    const back = 2 + i * 2 + (i > 4 ? 1 : 0);
    entries.push({
      day: Math.max(0, day - back),
      seeds: PAST_SEEDS[i],
      bearing: PAST_WINDS[i],
      air: 0.12 + hash01(i * 37 + 5) * 0.6,
      course: '',
    });
  }
  return { version: JOURNAL_VERSION, keeper: DEFAULT_KEEPER, entries };
}

/** What the book says when no seed has ever come home. */
export const EMPTY_INSCRIPTION = 'Nothing yet. Every seed that comes home is written here.';

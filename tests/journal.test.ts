/**
 * The keeper's book is the part of the game that survives the run, so the
 * boring parts are checked here: dates, wind words, the shape of a stored book,
 * and that a corrupted one never breaks the desk.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEEPER,
  EMPTY_INSCRIPTION,
  JOURNAL_VERSION,
  MAX_ENTRIES,
  addEntry,
  bearingOf,
  countWord,
  dayParts,
  emptyJournal,
  entryDate,
  entryFor,
  ledgerLine,
  parseJournal,
  sanitizeKeeper,
  serializeJournal,
  today,
  windPhrase,
} from '../src/core/journal.js';

const noon = (y: number, m: number, d: number): number => Math.floor(Date.UTC(y, m - 1, d) / 86400000);

describe('journal dates', () => {
  it('reads a day number back as a calendar date', () => {
    expect(dayParts(noon(2026, 11, 12))).toEqual({ year: 2026, month: 10, date: 12 });
  });

  it('writes a naturalist date with a roman month and a short year', () => {
    const entry = entryFor({ day: noon(2026, 11, 12), seeds: 4, x: 0, z: 0, air: 0.2 });
    expect(entryDate(entry)).toBe('12.xi.26');
    expect(entryDate(entryFor({ day: noon(2027, 1, 3), seeds: 1, x: 0, z: 0, air: 0 }))).toBe('3.i.27');
  });

  it('takes today from the clock without drifting across time zones', () => {
    expect(today(Date.UTC(2026, 10, 12, 23, 59))).toBe(noon(2026, 11, 12));
    expect(today(0)).toBe(0);
  });
});

describe('journal words', () => {
  it('counts seeds in words up to twelve, then stays put', () => {
    expect(countWord(0)).toBe('no');
    expect(countWord(1)).toBe('one');
    expect(countWord(9)).toBe('nine');
    expect(countWord(12)).toBe('twelve');
    expect(countWord(40)).toBe('twelve');
  });

  it('names the wind in eighths of the compass', () => {
    expect(windPhrase(0)).toBe('north');
    expect(windPhrase(45)).toBe('north-east');
    expect(windPhrase(200)).toBe('south');
    expect(windPhrase(315)).toBe('north-west');
    expect(windPhrase(720)).toBe('north');
    expect(windPhrase(-90)).toBe('west');
  });

  it('turns a wind vector into a bearing toward which the air runs', () => {
    expect(bearingOf(0, 0)).toBe(0);
    expect(bearingOf(0, -1)).toBe(0); // toward -z is north
    expect(bearingOf(1, 0)).toBe(90);
    expect(bearingOf(0, 1)).toBe(180);
    expect(bearingOf(-1, 0)).toBe(270);
  });
});

describe('journal entries', () => {
  it('clamps a run record into the book', () => {
    const e = entryFor({ day: -20, seeds: 500, x: 1, z: 0, air: 9, course: 'x'.repeat(99) });
    expect(e.day).toBe(0);
    expect(e.seeds).toBe(99);
    expect(e.air).toBe(1);
    expect(e.course).toHaveLength(40);
    expect(e.bearing).toBe(90);
  });

  it('writes the newest entry first and lets the oldest page fall away', () => {
    let book = emptyJournal();
    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      book = addEntry(book, entryFor({ day: i, seeds: i % 13, x: 0, z: 0, air: 0 }));
    }
    expect(book.entries).toHaveLength(MAX_ENTRIES);
    expect(book.entries[0].day).toBe(MAX_ENTRIES + 4);
    expect(book.entries[MAX_ENTRIES - 1].day).toBe(5);
  });

  it('composes a line the pen can write', () => {
    const entry = entryFor({ day: noon(2026, 11, 12), seeds: 9, x: 0.7, z: 0.7, air: 0.4 });
    expect(ledgerLine(entry)).toEqual({ date: '12.xi.26', count: 'nine came home', wind: 'wind south-east' });
  });
});

describe('the keeper', () => {
  it('cuts a name that can be engraved', () => {
    expect(sanitizeKeeper('  alan  ')).toBe('ALAN');
    expect(sanitizeKeeper('Ada M. Lovelace!')).toBe('ADA M. LOVELACE');
    expect(sanitizeKeeper(null)).toBe(DEFAULT_KEEPER);
    expect(sanitizeKeeper('   ')).toBe(DEFAULT_KEEPER);
    expect(sanitizeKeeper('*')).toBe(DEFAULT_KEEPER);
    expect(sanitizeKeeper('a'.repeat(50))).toHaveLength(26);
    expect(sanitizeKeeper(DEFAULT_KEEPER)).toBe(DEFAULT_KEEPER);
  });
});

describe('storage', () => {
  it('round-trips a book', () => {
    const book = addEntry(emptyJournal('ADA'), entryFor({ day: noon(2026, 11, 12), seeds: 3, x: -1, z: 0, air: 0.33 }));
    const back = parseJournal(serializeJournal(book));
    expect(back.keeper).toBe('ADA');
    expect(back.entries).toEqual([{ day: book.entries[0].day, seeds: 3, bearing: 270, air: 0.33, course: '' }]);
  });

  it('survives nonsense without throwing', () => {
    for (const junk of [null, '', 'not json', '[]', '{"version":99,"entries":[]}', '{"version":1,"entries":"x"}']) {
      const book = parseJournal(junk);
      expect(book.version).toBe(JOURNAL_VERSION);
      expect(book.entries).toEqual([]);
      expect(book.keeper).toBe(DEFAULT_KEEPER);
    }
  });

  it('drops entries that are not numbers', () => {
    const raw = JSON.stringify({
      version: JOURNAL_VERSION,
      keeper: 'ada',
      entries: [{ day: 3, seeds: 2 }, { day: 'x', seeds: 1 }, null, { day: 4 }],
    });
    const book = parseJournal(raw);
    expect(book.entries).toHaveLength(1);
    expect(book.entries[0].day).toBe(3);
    expect(book.keeper).toBe('ADA');
  });

  it('keeps the inscription plain, because it is written by hand', () => {
    expect(EMPTY_INSCRIPTION).not.toMatch(/[!]/);
  });
});

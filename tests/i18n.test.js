/**
 * Translation integrity.
 *
 * These are the checks a human reviewer cannot do reliably across two dozen languages.
 * They catch the three ways a localized app rots: a language quietly missing keys, a
 * placeholder mistyped so `{name}` renders literally, and a new server error code that
 * nobody wrote wording for.
 *
 * public/js/i18n.js has no browser globals at module scope precisely so it can be
 * imported here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CODES } from '../server/lib/errors.js';
import { LANGUAGES, BASE } from '../public/js/i18n.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const I18N_DIR = join(ROOT, 'public', 'i18n');

const { en } = BASE;

/** Every `{placeholder}` in a string, as a sorted list. */
function placeholders(value) {
  return [...value.matchAll(/\{([a-z]\w*)\}/gi)].map((m) => m[1]).sort();
}

async function loadDictionaries() {
  const out = new Map(Object.entries(BASE));
  for (const file of await readdir(I18N_DIR)) {
    if (!file.endsWith('.json')) continue;
    out.set(file.replace(/\.json$/, ''), JSON.parse(await readFile(join(I18N_DIR, file), 'utf8')));
  }
  return out;
}

const dictionaries = await loadDictionaries();

test('the language picker and the shipped dictionaries agree', () => {
  const listed = LANGUAGES.map((l) => l.code).sort();
  const present = [...dictionaries.keys()].sort();
  assert.deepEqual(present, listed,
    'every language offered in the picker must have a dictionary, and vice versa');
});

test('at least a dozen languages ship', () => {
  assert.ok(dictionaries.size >= 12, `expected 12+ languages, got ${dictionaries.size}`);
});

test('every language defines every English key, and nothing extra', () => {
  const expected = Object.keys(en).sort();
  for (const [code, table] of dictionaries) {
    const actual = Object.keys(table).sort();
    assert.deepEqual(expected.filter((k) => !actual.includes(k)), [], `${code} is missing keys`);
    assert.deepEqual(actual.filter((k) => !expected.includes(k)), [], `${code} has keys English does not`);
  }
});

test('every value is a non-empty string', () => {
  for (const [code, table] of dictionaries) {
    for (const [key, value] of Object.entries(table)) {
      assert.equal(typeof value, 'string', `${code}["${key}"] is not a string`);
      assert.ok(value.trim().length > 0, `${code}["${key}"] is empty`);
    }
  }
});

test('placeholders survive translation', () => {
  for (const [code, table] of dictionaries) {
    for (const [key, value] of Object.entries(en)) {
      assert.deepEqual(
        placeholders(table[key]), placeholders(value),
        `${code}["${key}"] does not use the same placeholders as English`,
      );
    }
  }
});

test('no prose was left sitting in English', () => {
  // Short technical strings are legitimately identical across languages ("Video MP4"),
  // so only long prose is checked -- that is where an untranslated string hides.
  const prose = Object.entries(en).filter(([, v]) => v.length > 45).map(([k]) => k);
  assert.ok(prose.length > 10, 'expected a meaningful sample of prose keys');

  for (const [code, table] of dictionaries) {
    if (code === 'en') continue;
    assert.deepEqual(prose.filter((key) => table[key] === en[key]), [], `${code} left these keys in English`);
  }
});

test('every server error code has wording in every language', () => {
  for (const code of CODES) {
    const key = `error.${code}`;
    assert.ok(key in en, `no English wording for server code "${code}"`);
    for (const [lang, table] of dictionaries) {
      assert.ok(table[key], `${lang} has no wording for server code "${code}"`);
    }
  }
});

test('no dictionary carries stray control characters', () => {
  const control = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f]');
  for (const [code, table] of dictionaries) {
    for (const [key, value] of Object.entries(table)) {
      assert.equal(control.test(value), false, `${code}["${key}"] contains a control character`);
    }
  }
});

test('every RTL language is declared as such', () => {
  const rtl = new Set(['ar', 'fa', 'he', 'ur']);
  for (const { code, dir } of LANGUAGES) {
    assert.equal(dir, rtl.has(code) ? 'rtl' : 'ltr', `${code} has the wrong text direction`);
  }
});

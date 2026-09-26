const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'classcards.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id   TEXT UNIQUE NOT NULL,
  email       TEXT NOT NULL,
  name        TEXT,
  picture     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_login  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A layout defines which fields a card has and where each one shows.
-- owner_id NULL = built-in layout (read-only, available to everyone).
CREATE TABLE IF NOT EXISTS layouts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  slug        TEXT UNIQUE,              -- only for built-ins
  name        TEXT NOT NULL,
  fields      TEXT NOT NULL,            -- JSON array of field definitions
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A class (course) has a name, accent color and one layout.
-- owner_id NULL = built-in class (everyone can see it and add their own private cards to it).
CREATE TABLE IF NOT EXISTS classes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#2962ff',
  layout_id   INTEGER NOT NULL REFERENCES layouts(id) ON DELETE RESTRICT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  owner_id    INTEGER REFERENCES users(id) ON DELETE CASCADE, -- NULL = built-in card
  fields      TEXT NOT NULL,            -- JSON object: { fieldKey: value }
  is_html     INTEGER NOT NULL DEFAULT 0, -- 1 only for trusted built-in cards
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cards_class ON cards(class_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_classes_owner ON classes(owner_id);
CREATE INDEX IF NOT EXISTS idx_layouts_owner ON layouts(owner_id);
`);

// Field: { key, label, type: text|long|number|date, place: front|sub|meta|back, group?: bool }
//   front = big title on the front      sub  = small line under the title
//   meta  = "Label: value" line on back back = main text on the back (supports color markup)
//   group = cards are grouped into sections and range-filtered by this field
//   date  = text field with a year that the Year filter can match
const BUILTIN_LAYOUTS = [
  { slug: 'apush', name: 'APUSH (Period / Module)', fields: [
    { key: 'period', label: 'Period', type: 'number', place: 'sub', group: true, names: {
      1: '1491–1607', 2: '1607–1754', 3: '1754–1800', 4: '1800–1848', 5: '1844–1877',
      6: '1865–1898', 7: '1890–1945', 8: '1945–1980', 9: '1980–Present' } },
    { key: 'module', label: 'Module', type: 'number', place: 'sub', group: true },
    { key: 'term',   label: 'Term',   type: 'text',   place: 'front' },
    { key: 'date',   label: 'Date',   type: 'date',   place: 'meta' },
    { key: 'theme',  label: 'Theme',  type: 'text',   place: 'meta' },
    { key: 'body',   label: 'Explanation', type: 'long', place: 'back' },
  ]},
  { slug: 'term-def', name: 'Term & Definition', fields: [
    { key: 'unit',   label: 'Unit', type: 'number', place: 'sub', group: true },
    { key: 'term',   label: 'Term', type: 'text',   place: 'front' },
    { key: 'def',    label: 'Definition', type: 'long', place: 'back' },
  ]},
  { slug: 'vocab', name: 'Vocabulary', fields: [
    { key: 'unit',    label: 'Unit', type: 'number', place: 'sub', group: true },
    { key: 'word',    label: 'Word', type: 'text', place: 'front' },
    { key: 'pos',     label: 'Part of speech', type: 'text', place: 'meta' },
    { key: 'def',     label: 'Definition', type: 'long', place: 'back' },
    { key: 'example', label: 'Example', type: 'long', place: 'back' },
  ]},
  { slug: 'qa', name: 'Question & Answer', fields: [
    { key: 'chapter', label: 'Chapter', type: 'number', place: 'sub', group: true },
    { key: 'q', label: 'Question', type: 'long', place: 'front' },
    { key: 'a', label: 'Answer',   type: 'long', place: 'back' },
  ]},
  { slug: 'formula', name: 'Formula', fields: [
    { key: 'unit',    label: 'Unit', type: 'number', place: 'sub', group: true },
    { key: 'name',    label: 'Name', type: 'text', place: 'front' },
    { key: 'formula', label: 'Formula', type: 'text', place: 'meta' },
    { key: 'vars',    label: 'Variables', type: 'long', place: 'back' },
    { key: 'use',     label: 'When to use', type: 'long', place: 'back' },
  ]},
];

db.transaction(() => {
  const upsertLayout = db.prepare(`
    INSERT INTO layouts (owner_id, slug, name, fields) VALUES (NULL, @slug, @name, @fields)
    ON CONFLICT(slug) DO UPDATE SET name = excluded.name, fields = excluded.fields`);
  for (const l of BUILTIN_LAYOUTS) upsertLayout.run({ ...l, fields: JSON.stringify(l.fields) });

  // Built-in APUSH class + cards, first run only.
  const hasBuiltinClass = db.prepare('SELECT 1 FROM classes WHERE owner_id IS NULL').get();
  if (!hasBuiltinClass) {
    const apushLayout = db.prepare(`SELECT id FROM layouts WHERE slug = 'apush'`).get().id;
    const classId = db.prepare(`INSERT INTO classes (owner_id, name, color, layout_id) VALUES (NULL, 'APUSH', '#2962ff', ?)`)
      .run(apushLayout).lastInsertRowid;
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', 'apush-cards.json'), 'utf8'));
    const ins = db.prepare(`INSERT INTO cards (class_id, owner_id, fields, is_html) VALUES (?, NULL, ?, 1)`);
    for (const c of seed) {
      ins.run(classId, JSON.stringify({
        period: c.period, module: c.module, term: c.term, date: c.date, theme: c.theme, body: c.html,
      }));
    }
    console.log(`Seeded built-in APUSH class with ${seed.length} cards.`);
  }
})();

module.exports = db;

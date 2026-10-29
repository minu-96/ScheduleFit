CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  show TEXT NOT NULL DEFAULT 'all',
  admin_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  name TEXT NOT NULL,
  pin_hash TEXT,
  weeks TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  UNIQUE (room_id, name)
);
CREATE INDEX IF NOT EXISTS idx_people_room ON people (room_id);
CREATE TABLE IF NOT EXISTS tokens (
  token_hash TEXT PRIMARY KEY,
  person_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokens_person ON tokens (person_id);

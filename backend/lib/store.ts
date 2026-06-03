// Data access behind one small interface (DIP boundary). The app talks to `Store`,
// never to SQLite directly, so a PostgresStore/JsonStore can drop in later untouched.
//
// KISS: a thin layer over node:sqlite. Raw all/get/run expose SQL for real queries
// (the finance chat needs this); insert/update/remove/find/list cover plain CRUD so
// simple resources don't hand-write SQL. One source of query truth per caller (DRY).
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type Row = Record<string, unknown>;
export type Params = Record<string, unknown> | unknown[];

// An ordered, idempotent schema step. `id` must be stable + unique; applied once.
export interface Migration {
  id: string;
  sql: string;
}

export interface Store {
  all<T = Row>(sql: string, params?: Params): T[];
  get<T = Row>(sql: string, params?: Params): T | undefined;
  run(sql: string, params?: Params): { changes: number; lastInsertRowid: number | bigint };

  find<T = Row>(table: string, id: string): T | undefined;
  list<T = Row>(table: string, opts?: { orderBy?: string }): T[];
  insert<T = Row>(table: string, row: Row): T;
  update<T = Row>(table: string, id: string, patch: Row): T | undefined;
  remove(table: string, id: string): boolean;

  getConfig(key: string): string | undefined;
  setConfig(key: string, value: string): void;

  migrate(migrations: Migration[]): void;
  close(): void;
}

export class SqliteStore implements Store {
  private db: DatabaseSync;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    // WAL = safe concurrent readers + single writer; FKs on for referential integrity.
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
    );
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
  }

  all<T = Row>(sql: string, params: Params = []): T[] {
    return this.db.prepare(sql).all(...this.bind(params)) as T[];
  }

  get<T = Row>(sql: string, params: Params = []): T | undefined {
    return this.db.prepare(sql).get(...this.bind(params)) as T | undefined;
  }

  run(sql: string, params: Params = []): { changes: number; lastInsertRowid: number | bigint } {
    const r = this.db.prepare(sql).run(...this.bind(params));
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }

  find<T = Row>(table: string, id: string): T | undefined {
    return this.get<T>(`SELECT * FROM ${ident(table)} WHERE id = ?`, [id]);
  }

  list<T = Row>(table: string, opts: { orderBy?: string } = {}): T[] {
    const order = opts.orderBy ? ` ORDER BY ${opts.orderBy}` : '';
    return this.all<T>(`SELECT * FROM ${ident(table)}${order}`);
  }

  insert<T = Row>(table: string, row: Row): T {
    const now = new Date().toISOString();
    const full: Row = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...row };
    const cols = Object.keys(full);
    const sql = `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES (${cols
      .map((c) => ':' + c)
      .join(', ')})`;
    this.db.prepare(sql).run(toBindable(full));
    return this.find<T>(table, full.id as string)!;
  }

  update<T = Row>(table: string, id: string, patch: Row): T | undefined {
    const cols = Object.keys(patch).filter((c) => c !== 'id');
    if (cols.length === 0) return this.find<T>(table, id);
    const set = [...cols, 'updated_at'].map((c) => `${ident(c)} = :${c}`).join(', ');
    const sql = `UPDATE ${ident(table)} SET ${set} WHERE id = :id`;
    this.db.prepare(sql).run(toBindable({ ...patch, id, updated_at: new Date().toISOString() }));
    return this.find<T>(table, id);
  }

  remove(table: string, id: string): boolean {
    return this.run(`DELETE FROM ${ident(table)} WHERE id = ?`, [id]).changes > 0;
  }

  getConfig(key: string): string | undefined {
    return this.get<{ value: string }>('SELECT value FROM app_config WHERE key = ?', [key])?.value;
  }

  setConfig(key: string, value: string): void {
    this.run(
      'INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  // Run each unapplied migration in a transaction; record it so reruns are no-ops.
  migrate(migrations: Migration[]): void {
    for (const m of migrations) {
      if (this.get('SELECT id FROM _migrations WHERE id = ?', [m.id])) continue;
      this.db.exec('BEGIN');
      try {
        this.db.exec(m.sql);
        this.run('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)', [
          m.id,
          new Date().toISOString(),
        ]);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw new Error(`Migration "${m.id}" failed: ${(err as Error).message}`);
      }
    }
  }

  close(): void {
    this.db.close();
  }

  // node:sqlite binds named params from an object, positional from spread args.
  private bind(params: Params): unknown[] {
    return Array.isArray(params) ? params : [toBindable(params)];
  }
}

// SQLite accepts only null/number/bigint/string/Uint8Array — coerce the rest (bool,
// undefined, objects) so callers can pass natural JS values.
function toBindable(row: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || v === null) out[k] = null;
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
    else if (typeof v === 'object' && !(v instanceof Uint8Array)) out[k] = JSON.stringify(v);
    else out[k] = v;
  }
  return out;
}

// Identifiers come from app code, never user input, but quote defensively and reject
// anything that isn't a plain identifier so a typo can't become injection.
function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid identifier: ${name}`);
  return `"${name}"`;
}

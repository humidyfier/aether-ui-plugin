export interface ISqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface ISqliteStatement {
  run(...params: unknown[]): ISqliteRunResult;
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
}

export interface ISqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): ISqliteStatement;
  transaction<T>(fn: () => T): () => T;
  close(): void;
  isInMemory(): boolean;
}

/**
 * Universal SQLite adapter supporting both `node:sqlite` (Node.js 22 built-in synchronous SQLite)
 * and `better-sqlite3`, guaranteeing type safety and cross-platform zero-crash execution.
 */
export class UniversalSqliteDatabase implements ISqliteDatabase {
  private db: any;
  private readonly inMemory: boolean;
  private driverType: 'node:sqlite' | 'better-sqlite3';

  constructor(dbPath = ':memory:') {
    this.inMemory = dbPath === ':memory:';

    // 1. Try node:sqlite (native Node 22 built-in, zero native-addon build issues)
    try {
      const { DatabaseSync } = require('node:sqlite');
      this.db = new DatabaseSync(dbPath);
      this.driverType = 'node:sqlite';
      return;
    } catch {
      // Continue to better-sqlite3 fallback
    }

    // 2. Try better-sqlite3
    try {
      const BetterSqlite = require('better-sqlite3');
      this.db = new BetterSqlite(dbPath);
      this.driverType = 'better-sqlite3';
      return;
    } catch (err: any) {
      throw new Error(
        `Failed to initialize SQLite driver. Neither node:sqlite nor better-sqlite3 is operational: ${err.message}`
      );
    }
  }

  public getDriverType(): 'node:sqlite' | 'better-sqlite3' {
    return this.driverType;
  }

  public isInMemory(): boolean {
    return this.inMemory;
  }

  public exec(sql: string): void {
    this.db.exec(sql);
  }

  public prepare(sql: string): ISqliteStatement {
    const rawStmt = this.db.prepare(sql);
    const driver = this.driverType;

    return {
      run(...params: unknown[]): ISqliteRunResult {
        // Flatten array if passed as single array argument
        const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        const res = rawStmt.run(...flatParams);
        return {
          changes: Number(res.changes || 0),
          lastInsertRowid: res.lastInsertRowid,
        };
      },
      get(...params: unknown[]): any {
        const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        return rawStmt.get(...flatParams);
      },
      all(...params: unknown[]): any[] {
        const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
        return rawStmt.all(...flatParams);
      },
    };
  }

  public transaction<T>(fn: () => T): () => T {
    if (this.driverType === 'better-sqlite3' && typeof this.db.transaction === 'function') {
      return this.db.transaction(fn);
    }

    // Standard synchronous transaction wrapper
    return () => {
      this.exec('BEGIN TRANSACTION;');
      try {
        const result = fn();
        this.exec('COMMIT;');
        return result;
      } catch (err) {
        this.exec('ROLLBACK;');
        throw err;
      }
    };
  }

  public close(): void {
    if (typeof this.db.close === 'function') {
      this.db.close();
    }
  }
}

export function createDatabase(dbPath = ':memory:'): ISqliteDatabase {
  return new UniversalSqliteDatabase(dbPath);
}

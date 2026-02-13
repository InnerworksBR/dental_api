import db from '../db/sqlite';

export class StateService {

    constructor() {
        db.exec(`
            CREATE TABLE IF NOT EXISTS states (
                key TEXT PRIMARY KEY,
                value TEXT,
                expires_at INTEGER 
            )
        `);
    }

    /**
     * Sets a key-value pair with an optional TTL (in seconds).
     */
    set(key: string, value: string, ttl?: number): void {
        const expiresAt = ttl ? Date.now() + (ttl * 1000) : null;

        const stmt = db.prepare(`
            INSERT INTO states (key, value, expires_at) 
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at
        `);
        stmt.run(key, value, expiresAt);
    }

    /**
     * Gets a value by key. Returns null if expired or not found.
     */
    get(key: string): string | null {
        // Clean expired keys first (lazy cleanup)
        this.cleanup();

        const stmt = db.prepare('SELECT value FROM states WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)');
        const row = stmt.get(key, Date.now()) as { value: string } | undefined;

        return row ? row.value : null;
    }

    /**
     * Deletes a key.
     */
    del(key: string): void {
        const stmt = db.prepare('DELETE FROM states WHERE key = ?');
        stmt.run(key);
    }

    /**
     * Removes expired keys.
     */
    private cleanup(): void {
        const stmt = db.prepare('DELETE FROM states WHERE expires_at IS NOT NULL AND expires_at <= ?');
        stmt.run(Date.now());
    }
}

export const stateService = new StateService();

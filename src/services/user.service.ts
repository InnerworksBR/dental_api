import db from '../db/sqlite';

export interface User {
    id: number;
    phone: string;
    name: string;
    created_at: string;
}

export class UserService {

    /**
     * Initializes the users table if it doesn't exist.
     * This is usually handled in db/sqlite.ts, but we ensure it here for robustness.
     */
    constructor() {
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT UNIQUE NOT NULL,
                name TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    /**
     * Finds a user by their phone number (Flash/JID).
     */
    findUserByPhone(phone: string): User | undefined {
        const stmt = db.prepare('SELECT * FROM users WHERE phone = ?');
        return stmt.get(phone) as User | undefined;
    }

    /**
     * Finds a user by partial phone number (suffix match).
     * Useful when user provides "9999-9999" but DB has "5511999999999".
     */
    findUserByPhoneFlexible(phonePartial: string): User | undefined {
        // Sanitize first
        const clean = phonePartial.replace(/\D/g, '');
        if (!clean) return undefined;

        // If very short, might be risky, but let's assume > 7 digits
        const stmt = db.prepare('SELECT * FROM users WHERE phone LIKE ?');
        return stmt.get(`%${clean}`) as User | undefined;
    }

    /**
     * Creates a new user or updates the name if they already exist.
     */
    createUser(phone: string, name: string): void {
        const stmt = db.prepare(`
            INSERT INTO users (phone, name) 
            VALUES (?, ?)
            ON CONFLICT(phone) DO UPDATE SET name = excluded.name
        `);
        stmt.run(phone, name);
    }
}

export const userService = new UserService();

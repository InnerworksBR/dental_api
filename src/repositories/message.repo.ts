import db from '../db/sqlite';

export interface Message {
    id: number;
    remoteJid: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
}

export class MessageRepository {
    saveMessage(remoteJid: string, role: 'user' | 'assistant', content: string): void {
        const stmt = db.prepare('INSERT INTO messages (remoteJid, role, content) VALUES (?, ?, ?)');
        stmt.run(remoteJid, role, content);
    }

    getHistory(remoteJid: string, limit: number = 10): Message[] {
        const stmt = db.prepare('SELECT * FROM messages WHERE remoteJid = ? ORDER BY id DESC LIMIT ?');
        const rows = stmt.all(remoteJid, limit) as Message[];
        return rows.reverse(); // Return in chronological order (oldest first)
    }
}

export const messageRepo = new MessageRepository();

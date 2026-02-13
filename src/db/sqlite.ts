import Database from 'better-sqlite3';
import { config } from '../config/unifiedConfig';
import path from 'path';

const dbPath = path.resolve(config.DB_PATH);
const db = new Database(dbPath);

export const initDb = () => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      remoteJid TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
    console.log('✅ Database initialized');
};

export default db;

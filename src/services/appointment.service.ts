import db from '../db/sqlite';

export interface Appointment {
    id: number;
    user_phone: string;
    google_event_id: string;
    start_time: string;
    summary: string;
    created_at: string;
}

export class AppointmentService {

    constructor() {
        db.exec(`
            CREATE TABLE IF NOT EXISTS appointments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_phone TEXT NOT NULL,
                google_event_id TEXT UNIQUE NOT NULL,
                start_time DATETIME NOT NULL,
                summary TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_phone) REFERENCES users(phone)
            )
        `);
    }

    /**
     * Saves a new appointment link.
     */
    createAppointment(phone: string, googleEventId: string, startTime: string, summary: string): void {
        const stmt = db.prepare(`
            INSERT INTO appointments (user_phone, google_event_id, start_time, summary) 
            VALUES (?, ?, ?, ?)
        `);
        stmt.run(phone, googleEventId, startTime, summary);
    }

    /**
     * Upserts an appointment (Insert or Update if exists).
     * Used by SyncService.
     */
    upsertAppointment(phone: string, googleEventId: string, startTime: string, summary: string): void {
        const stmt = db.prepare(`
            INSERT INTO appointments (user_phone, google_event_id, start_time, summary) 
            VALUES (?, ?, ?, ?)
            ON CONFLICT(google_event_id) DO UPDATE SET 
                start_time = excluded.start_time,
                summary = excluded.summary,
                user_phone = excluded.user_phone
        `);
        stmt.run(phone, googleEventId, startTime, summary);
    }

    /**
     * Finds the latest future appointment for a user (Exact Match).
     */
    findLatestByPhone(phone: string): Appointment | undefined {
        const stmt = db.prepare(`
            SELECT * FROM appointments 
            WHERE user_phone = ? AND start_time > datetime('now', 'localtime')
            ORDER BY start_time ASC
            LIMIT 1
        `);
        return stmt.get(phone) as Appointment | undefined;
    }

    /**
     * Finds the latest future appointment for a user (Flexible/Suffix Match).
     */
    /**
     * Finds the latest future appointment for a user (Flexible/Suffix Match).
     * Now implements robust bidirectional checking in-memory.
     */
    findLatestByPhoneFlexible(phonePartial: string): Appointment | undefined {
        const clean = phonePartial.replace(/\D/g, '');
        if (!clean) return undefined;

        // Fetch all future appointments to filter in memory
        // We compare against ISO string passed from JS to ensure UTC consistency
        const nowIso = new Date().toISOString();

        const stmt = db.prepare(`
            SELECT * FROM appointments 
            WHERE start_time > ?
            ORDER BY start_time ASC
        `);

        const allFuture = stmt.all(nowIso) as Appointment[];

        // Robust Match:
        // Check if stored phone ends with input OR input ends with stored phone
        const match = allFuture.find(appt => {
            const dbPhone = appt.user_phone.replace(/\D/g, '');
            // Safety check for short numbers
            if (clean.length < 4 || dbPhone.length < 4) return false;

            return dbPhone.endsWith(clean) || clean.endsWith(dbPhone);
        });

        return match;
    }

    /**
     * Deletes an appointment (used when cancelling).
     */
    deleteByEventId(googleEventId: string): void {
        const stmt = db.prepare('DELETE FROM appointments WHERE google_event_id = ?');
        stmt.run(googleEventId);
    }

    /**
     * Updates an appointment time (reschedule).
     */
    updateAppointmentTime(googleEventId: string, newStartTime: string): void {
        const stmt = db.prepare('UPDATE appointments SET start_time = ? WHERE google_event_id = ?');
        stmt.run(newStartTime, googleEventId);
    }

    /**
     * Finds an appointment by Google Event ID.
     */
    findByEventId(googleEventId: string): Appointment | undefined {
        const stmt = db.prepare('SELECT * FROM appointments WHERE google_event_id = ?');
        return stmt.get(googleEventId) as Appointment | undefined;
    }
}

export const appointmentService = new AppointmentService();

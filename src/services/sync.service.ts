import { DateTime } from 'luxon';
import { calendarService } from './calendar.service';
import { userService } from './user.service';
import { appointmentService } from './appointment.service';

export class SyncService {
    private syncInterval: NodeJS.Timeout | null = null;
    private isSyncing = false;

    /**
     * Starts the synchronization loop (every 30 minutes).
     */
    startSyncLoop() {
        if (this.syncInterval) return;

        console.log('🔄 SyncService: Starting background loop (30m)...');

        // Run immediately on start
        this.runSync();

        // Schedule loop
        this.syncInterval = setInterval(() => {
            this.runSync();
        }, 30 * 60 * 1000); // 30 minutes
    }

    /**
     * Stops the loop.
     */
    stopSyncLoop() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    /**
     * Executes the synchronization logic.
     */
    async runSync() {
        if (this.isSyncing) {
            console.log('🔄 SyncService: Sync already in progress, skipping.');
            return;
        }

        this.isSyncing = true;
        console.log('🔄 SyncService: Running synchronization...');

        try {
            // 1. Fetch events for the next 60 days
            const now = DateTime.now().setZone('America/Sao_Paulo');
            const end = now.plus({ days: 60 });

            const events = await calendarService.listEvents(now, end);
            console.log(`🔄 SyncService: Fetched ${events.length} future events from Calendar.`);

            let syncedCount = 0;

            for (const event of events) {
                // Skip if no summary
                if (!event.summary || !event.id) continue;

                // 2. Parse "Name Phone" from summary
                // Regex: capture Name (anything) + Space + Phone (digits, at least 8)
                // Example: "Maria Silva 13999999999" -> Name: Maria Silva, Phone: 13999999999
                // Also supports "Maria - 11999999999" (flexible separator)
                const match = event.summary.match(/(.+?)[\s\-]+(\d{8,})/);

                if (match) {
                    const name = match[1].trim();
                    const phone = match[2];

                    // 3. Upsert User
                    // This ensures the client exists in our DB
                    userService.createUser(phone, name);

                    // 4. Upsert Appointment
                    // We interpret the event as an appointment
                    const startRaw = event.start?.dateTime || event.start?.date; // Handle all-day too if needed, though usually appointments have time

                    if (startRaw) {
                        appointmentService.upsertAppointment(
                            phone,
                            event.id,
                            startRaw,
                            event.summary
                        );
                        syncedCount++;
                    }
                }
            }

            console.log(`✅ SyncService: Successfully synced ${syncedCount} appointments.`);

        } catch (error) {
            console.error('❌ SyncService: Error during synchronization:', error);
        } finally {
            this.isSyncing = false;
        }
    }
}

export const syncService = new SyncService();

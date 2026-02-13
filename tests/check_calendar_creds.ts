
import { calendarService } from '../src/services/calendar.service';

async function check() {
    console.log("Checking CalendarService initialization...");
    try {
        // Access private member via type assertion or check if it logs warning.
        // Actually, just call a method that requires calendar.
        // listEvents returns [] if no calendar, but also [] if no events.
        // createEvent throws if no calendar.

        // We can inspect the instance directly if we cheat with 'any'
        const service = calendarService as any;
        if (service.calendar) {
            console.log("✅ CalendarService initialized successfully with credentials.");
        } else {
            console.error("❌ CalendarService failed to initialize (no credentials).");
            process.exit(1);
        }
    } catch (error) {
        console.error("Error during check:", error);
        process.exit(1);
    }
}

check();

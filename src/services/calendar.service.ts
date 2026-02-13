import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { DateTime } from 'luxon';
import { config } from '../config/unifiedConfig';
import { DateUtils } from '../utils/date.utils';

export class CalendarService {
    private calendar;
    private calendarId: string;

    constructor() {
        if (config.GOOGLE_CLIENT_EMAIL && config.GOOGLE_PRIVATE_KEY) {
            const auth = new JWT({
                email: config.GOOGLE_CLIENT_EMAIL,
                key: config.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                scopes: ['https://www.googleapis.com/auth/calendar'],
            });
            this.calendar = google.calendar({ version: 'v3', auth });
        } else {
            console.warn('⚠️ Google Credentials missing. CalendarService will return mock data or fail.');
        }
        this.calendarId = config.GOOGLE_CALENDAR_ID || 'primary';
    }

    /**
     * Fetches events from Google Calendar for a specific range.
     */
    async listEvents(start: DateTime, end: DateTime) {
        if (!this.calendar) return [];

        try {
            const res = await this.calendar.events.list({
                calendarId: this.calendarId,
                timeMin: start.toISO()!,
                timeMax: end.toISO()!,
                singleEvents: true,
                orderBy: 'startTime',
            });
            return res.data.items || [];
        } catch (error) {
            console.error('Error fetching calendar events:', error);
            return [];
        }
    }

    /**
     * Creates a new event in the calendar.
     */
    async createEvent(eventData: any) {
        if (!this.calendar) throw new Error('Calendar not initialized');

        try {
            const res = await this.calendar.events.insert({
                calendarId: this.calendarId,
                requestBody: eventData,
            });
            return res.data;
        } catch (error) {
            console.error('Error creating event:', error);
            throw error;
        }
    }

    /**
     * Checks availability for a specific date.
     * Returns slots if available, or null if blocked/empty.
     */
    async getAvailableSlotsForDay(date: DateTime, period?: string): Promise<string[] | null> {
        // 1. Generate slots for this day
        let slots = DateUtils.generateSlotsForDate(date);

        // 2. Filter by period
        if (period) {
            const p = period.toLowerCase();
            slots = slots.filter(slot => {
                const hour = slot.hour;
                const minute = slot.minute;

                if (p.includes('manh') || p.includes('dia')) return hour < 12;

                if (p.includes('tard')) {
                    // Afternoon: 12:00 to 17:30 (exclusive of 17:30)
                    return hour >= 12 && (hour < 17 || (hour === 17 && minute < 30));
                }

                if (p.includes('noit')) {
                    // Night: 17:30 to 19:30 (inclusive of 19:30 start?)
                    // Let's assume 17:30 up to 19:30 start time.
                    // 17:30, 17:45, 18:00 ... 19:30
                    const isAfterStart = (hour > 17) || (hour === 17 && minute >= 30);
                    const isBeforeEnd = (hour < 19) || (hour === 19 && minute <= 30);
                    return isAfterStart && isBeforeEnd;
                }

                return true;
            });
        }

        if (slots.length === 0) return null;

        // 3. Fetch events for this day
        const startOfDay = date.startOf('day');
        const endOfDay = date.endOf('day');
        const events = await this.listEvents(startOfDay, endOfDay);

        // CHECK ID 30: Block Full Day if "Ocupado" All-Day event exists
        const hasFullDayBlocker = events.some(event => {
            if (event.start?.date) {
                // It's an all-day event
                const title = (event.summary || '').toLowerCase();
                const isOpaque = event.transparency !== 'transparent'; // Default is opaque (busy)

                // User Rule: "Ocupado - 0000" or Busy All-Day blocks the day
                if (title.includes('ocupado') || isOpaque) {
                    console.log(`[CalendarService] Day ${date.toFormat('dd/MM')} blocked by All-Day event: ${event.summary}`);
                    return true;
                }
            }
            return false;
        });

        if (hasFullDayBlocker) {
            return null; // Day is blocked
        }

        // 4. Filter blocked slots (Timed events)
        const validSlots = slots.filter(slot => {
            const slotEnd = slot.plus({ minutes: 15 });
            const isBlocked = events.some(event => {
                // Skip all-day events here (already handled or non-blocking)
                if (event.start?.date) return false;

                if (!event.start?.dateTime || !event.end?.dateTime) return false;

                const eventStart = DateTime.fromISO(event.start.dateTime);
                const eventEnd = DateTime.fromISO(event.end.dateTime);

                // Check for "Ocupado" title in timed events too
                const title = (event.summary || '').toLowerCase();

                // Simple overlap check
                return (slot < eventEnd) && (slotEnd > eventStart);
            });
            return !isBlocked;
        });

        return validSlots.length > 0 ? validSlots.map(s => s.toFormat('HH:mm')) : null;
    }

    /**
     * Finds the next available day with slots in the requested period.
     * Iterates up to 14 days from D+2.
     * @param period 'manhã' | 'tarde' | 'noite' (optional)
     * @returns Object with date and slots, or null if none found.
     */
    async findNextAvailable(period?: string, afterDate?: string, preferredTime?: string): Promise<{ date: string, slots: string[] } | null> {
        let currentDate = DateUtils.getMinimumSchedulingDate();

        // If afterDate is provided, start searching from the day AFTER that date
        // This effectively implements "Next Page" of availability
        if (afterDate) {
            const after = DateTime.fromISO(afterDate).setZone('America/Sao_Paulo');
            if (after.isValid) {
                const nextDay = after.plus({ days: 1 });
                // Ensure we don't go back in time before the minimum allowed date
                if (nextDay > currentDate) {
                    currentDate = nextDay;
                }
            }
        }

        const maxDate = currentDate.plus({ days: 14 }); // Limit search to 2 weeks

        while (currentDate <= maxDate) {
            const slots = await this.getAvailableSlotsForDay(currentDate, period);

            if (slots && slots.length > 0) {
                // If preferredTime is requested, we ONLY return this day if it has that time (or close to it)
                if (preferredTime) {
                    const prefHour = parseInt(preferredTime.split(':')[0]);
                    // Check if any slot has the same hour
                    const hasMatchingSlot = slots.some(s => parseInt(s.split(':')[0]) === prefHour);

                    if (hasMatchingSlot) {
                        // Return specifically the slots around that time? Or all slots?
                        // Let's returns all slots for the day, but we know it contains the preferred one.
                        // Ideally we filter the display to focus on the preferred ones first?
                        // The tool will slice(0,2), so maybe we should sort?
                        // For now, simple existence check is enough to satisfy "Find NEXT available day with 17h".

                        // Let's filter the slots returned to match preference first
                        const goodSlots = slots.filter(s => parseInt(s.split(':')[0]) === prefHour);
                        const otherSlots = slots.filter(s => parseInt(s.split(':')[0]) !== prefHour);

                        return {
                            date: currentDate.toFormat('yyyy-MM-dd'),
                            slots: [...goodSlots, ...otherSlots]
                        };
                    }
                    // If not found, SKIP this day and continue loop
                } else {
                    return {
                        date: currentDate.toFormat('yyyy-MM-dd'),
                        slots: slots
                    };
                }
            }

            // Move to next day
            currentDate = currentDate.plus({ days: 1 });
        }

        return null;
    }

    /**
    * Lists future appointments for a specific phone number.
    * @param phone Phone number to search for (partial match allowed).
    */
    async listAppointments(phone: string): Promise<any[]> {
        if (!this.calendar) return [];

        try {
            const now = DateTime.now();
            const futureLimit = now.plus({ days: 60 }); // Search next 2 months

            const res = await this.calendar.events.list({
                calendarId: this.calendarId,
                timeMin: now.toISO()!,
                timeMax: futureLimit.toISO()!,
                singleEvents: true,
                orderBy: 'startTime',
                // q: phone // Removed 'q' to do manual filtering
            });

            const allEvents = res.data.items || [];
            if (!phone) return allEvents;

            const cleanPhone = phone.replace(/\D/g, '');
            console.log(`[CalendarService] Filtering for phone suffix: ${cleanPhone}`);

            const filtered = allEvents.filter((event: any) => {
                const summary = (event.summary || '').replace(/\D/g, '');
                const description = (event.description || '').replace(/\D/g, '');

                // Robust Matching Strategy:
                // 1. Direct includes (covers strict subset)
                // 2. Suffix match (covers country code diff: 551199... vs 1199...)

                // Safety: Only match if we have enough digits (e.g. at least 8)
                if (cleanPhone.length < 8) return false;

                const matchSummary = (summary.length >= 8) && (cleanPhone.endsWith(summary) || summary.endsWith(cleanPhone));
                const matchDesc = (description.length >= 8) && (cleanPhone.endsWith(description) || description.endsWith(cleanPhone));

                const match = matchSummary || matchDesc;

                if (match) {
                    console.log(`[CalendarService] MATCH found! Event: ${event.summary} (${event.id})`);
                }
                return match;
            });

            console.log(`[CalendarService] Returning ${filtered.length} matching events.`);
            return filtered;
        } catch (error) {
            console.error('Error listing appointments:', error);
            return [];
        }
    }

    /**
     * Cancels an event by ID.
     */
    async cancelEvent(eventId: string) {
        if (!this.calendar) throw new Error('Calendar not initialized');

        try {
            await this.calendar.events.delete({
                calendarId: this.calendarId,
                eventId: eventId
            });
            return true;
        } catch (error: any) {
            // Handle "Resource has been deleted" (410) or "Not Found" (404)
            // If it's already gone, we consider it a success.
            if (error.code === 410 || error.code === 404 || (error.response && (error.response.status === 410 || error.response.status === 404))) {
                console.warn(`[CalendarService] Event ${eventId} was already deleted or not found. Treating as success.`);
                return true;
            }

            console.error('Error canceling event:', error);
            throw error;
        }
    }

    /**
     * Gets a specific event by ID.
     */
    async getEvent(eventId: string) {
        if (!this.calendar) return null;

        try {
            const res = await this.calendar.events.get({
                calendarId: this.calendarId,
                eventId: eventId
            });
            return res.data;
        } catch (error) {
            console.error('Error getting event:', error);
            return null;
        }
    }

    /**
     * Updates an event's time.
     */
    async updateEventTime(eventId: string, newStart: string) {
        if (!this.calendar) throw new Error('Calendar not initialized');

        try {
            // First get the event to keep other details
            const event = await this.calendar.events.get({
                calendarId: this.calendarId,
                eventId: eventId
            });

            if (!event.data) throw new Error('Event not found');

            const start = DateTime.fromISO(newStart);
            const end = start.plus({ minutes: 15 });

            const res = await this.calendar.events.patch({
                calendarId: this.calendarId,
                eventId: eventId,
                requestBody: {
                    start: { dateTime: start.toISO() },
                    end: { dateTime: end.toISO() }
                }
            });

            return res.data;
        } catch (error: any) {
            if (error.code === 410 || error.code === 404 || (error.response && (error.response.status === 410 || error.response.status === 404))) {
                console.warn(`[CalendarService] Cannot update event ${eventId}: it was deleted or not found.`);
                throw new Error('Agendamento não encontrado ou já cancelado.');
            }
            console.error('Error updating event:', error);
            throw error;
        }
    }
}

export const calendarService = new CalendarService();

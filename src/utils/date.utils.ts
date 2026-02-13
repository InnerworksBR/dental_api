import { DateTime } from 'luxon';

export class DateUtils {
    private static TIMEZONE = 'America/Sao_Paulo';

    /**
     * Calculates the minimum date for scheduling (D+2 business days).
     * Skips weekends.
     */
    static getMinimumSchedulingDate(): DateTime {
        let date = DateTime.now().setZone(this.TIMEZONE);
        let daysAdded = 0;

        while (daysAdded < 2) {
            date = date.plus({ days: 1 });
            // 6 = Saturday, 7 = Sunday
            if (date.weekday !== 6 && date.weekday !== 7) {
                daysAdded++;
            }
        }

        return date.startOf('day');
    }

    /**
     * Generates 15-minute slots between 08:00 and 18:00 for a given date.
     */
    static generateSlotsForDate(date: DateTime): DateTime[] {
        const slots: DateTime[] = [];
        const startHour = 8;
        const endHour = 18;

        let current = date.set({ hour: startHour, minute: 0, second: 0, millisecond: 0 });
        const end = date.set({ hour: endHour, minute: 0, second: 0, millisecond: 0 });

        while (current < end) {
            slots.push(current);
            current = current.plus({ minutes: 15 });
        }

        return slots;
    }

    static formatToWhatsApp(dt: DateTime): string {
        return dt.setLocale('pt-BR').toFormat("dd/MM (cccc) 'às' HH:mm");
    }
}

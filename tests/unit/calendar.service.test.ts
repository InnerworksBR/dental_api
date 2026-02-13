import { calendarService } from '../../src/services/calendar.service';
import { DateTime } from 'luxon';

// Mock config BEFORE importing service? 
// No, imports are hoisted. We need jest.mock.
jest.mock('../../src/config/unifiedConfig', () => ({
    config: {
        GOOGLE_CLIENT_EMAIL: 'test@example.com',
        GOOGLE_PRIVATE_KEY: 'test-key',
        GOOGLE_CALENDAR_ID: 'primary',
    },
}));

// Mock googleapis
// We need to ensure the mock factory returns a structure we can spy on later, 
// OR we rely on accessing the structure via the service instance.
jest.mock('googleapis', () => {
    return {
        google: {
            calendar: jest.fn().mockReturnValue({
                events: {
                    list: jest.fn(), // We will access this mock via calendarService instance
                },
            }),
        },
    };
});

describe('CalendarService', () => {
    let listMock: jest.Mock;

    beforeAll(() => {
        // Access the mock function that was injected into the service
        // calendarService.calendar is private, so cast to any
        const calendarInstance = (calendarService as any).calendar;
        if (!calendarInstance) {
            // Should not happen if mock worked and env vars are set (or ignored in constructor)
            // Check constructor logic: if no creds, it warns and this.calendar is undefined?
            // We must ensure env vars are set or mocked such that this.calendar IS defined.
            // OR constructor logic handles it. 
            // Logic: if (config.GOOGLE_CLIENT_EMAIL ...)
            // We should inspect if calendarService has initialized calendar.
        }

        // Wait, if config is missing, calendar is undefined.
        // We need to Mock `unifiedConfig`? Or ensure process.env is set?
        // Unit tests should probably mock config.
    });

    beforeEach(() => {
        // We need to re-acquire the mock if necessary, or just clear it.
        // But `listMock` reference needs to be stable.
        const calendarInstance = (calendarService as any).calendar;
        if (calendarInstance && calendarInstance.events) {
            listMock = calendarInstance.events.list as jest.Mock;
            jest.clearAllMocks(); // Clear call history
        } else {
            // If calendar is undefined, tests will fail. 
            // We need to ensure config provides credentials so constructor creates it.
        }
    });

    // We can define tests assuming listMock is available.
    // But we should Mock the Config to ensure `calendar` is created!

    it('should call google calendar api with correct parameters', async () => {
        if (!listMock) throw new Error('Calendar client not initialized');

        const start = DateTime.now();
        const end = start.plus({ hours: 1 });

        listMock.mockResolvedValue({
            data: { items: [] }
        });

        await calendarService.listEvents(start, end);

        expect(listMock).toHaveBeenCalledWith(expect.objectContaining({
            timeMin: start.toISO(),
            timeMax: end.toISO(),
            singleEvents: true,
            orderBy: 'startTime',
        }));
    });

    it('should return events list', async () => {
        if (!listMock) throw new Error('Calendar client not initialized');

        const mockEvents = [{ id: '1', summary: 'Test Event' }];
        listMock.mockResolvedValue({
            data: { items: mockEvents }
        });

        const start = DateTime.now();
        const end = start.plus({ hours: 1 });
        const result = await calendarService.listEvents(start, end);

        expect(result).toEqual(mockEvents);
    });

    it('should return empty array on error', async () => {
        if (!listMock) throw new Error('Calendar client not initialized');

        listMock.mockRejectedValue(new Error('Google API Error'));

        const start = DateTime.now();
        const end = start.plus({ hours: 1 });
        const result = await calendarService.listEvents(start, end);

        expect(result).toEqual([]);
    });

    it('should filter out blocked slots (OCUPADO - 00000)', async () => {
        if (!listMock) throw new Error('Calendar client not initialized');

        listMock.mockImplementation(async (params: any) => {
            return {
                data: {
                    items: [
                        {
                            summary: 'OCUPADO - 00000',
                            start: { dateTime: params.timeMin },
                            end: { dateTime: params.timeMax },
                        }
                    ]
                }
            };
        });

        const slots = await calendarService.getNextAvailableSlots();
        expect(slots).toEqual([]);
    });
});

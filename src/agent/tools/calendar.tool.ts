import { DynamicTool } from '@langchain/core/tools';
import { calendarService } from '../../services/calendar.service';
import { appointmentService } from '../../services/appointment.service';
import { userService } from '../../services/user.service';

import { DateUtils } from '../../utils/date.utils';

import { DateTime } from 'luxon';

export const checkAvailabilityTool = new DynamicTool({
    name: 'check_availability',
    description: 'Verifies available appointment slots. Input should be a JSON string with optional "period" (manhã, tarde, noite), "date" (YYYY-MM-DD) to check specific day, "afterDate" (YYYY-MM-DD) to find next available day AFTER this date, or "preferredTime" (HH:mm) to search for a specific time across days. Example: {"period": "manhã", "afterDate": "2026-02-25", "preferredTime": "17:00"}',
    func: async (input: string) => {
        try {
            let period = undefined;
            let dateStr = undefined;
            let afterDateStr = undefined;
            let preferredTime = undefined;

            if (input && input.trim() !== '') {
                try {
                    const parsed = JSON.parse(input);
                    period = parsed.period;
                    dateStr = parsed.date;
                    afterDateStr = parsed.afterDate;
                    preferredTime = parsed.preferredTime;
                } catch (e) {
                    // unexpected input...
                    period = input;
                }
            }

            // SPECIFIC DATE CHECK (User UX Request)
            if (dateStr) {
                const requestedDate = DateTime.fromISO(dateStr).setZone('America/Sao_Paulo');

                // 1. D+2 Validation
                const minDate = DateUtils.getMinimumSchedulingDate();
                if (requestedDate < minDate.startOf('day')) {
                    const formattedMin = DateUtils.formatToWhatsApp(minDate);
                    return `Data inválida. Só é possível agendar com 2 dias úteis de antecedência (a partir de ${formattedMin}).`;
                }

                // 2. Check Slots
                const slots = await calendarService.getAvailableSlotsForDay(requestedDate, period);

                if (!slots || slots.length === 0) {
                    return `Não há horários disponíveis para o dia ${requestedDate.toFormat('dd/MM/yyyy')}${period ? ` (${period})` : ''}.`;
                }

                // If preferredTime is asked for specific date, check if it exists
                if (preferredTime) {
                    const prefHourRequest = parseInt(preferredTime.split(':')[0]);
                    const hasSlot = slots.some(s => parseInt(s.split(':')[0]) === prefHourRequest);
                    if (!hasSlot) {
                        return `Para o dia ${requestedDate.toFormat('dd/MM/yyyy')}, não temos horários próximos às ${preferredTime}. Temos: ${slots.slice(0, 5).join(', ')}.`;
                    }
                }

                // Return slots (limit to 5 to be generous but not spammy if specific date asked)
                const limited = slots.slice(0, 5);
                return `Horários disponíveis para ${requestedDate.toFormat('dd/MM/yyyy')}:\n${limited.join('\n')}`;
            }

            // NEXT AVAILABLE CHECK (Default)
            const result = await calendarService.findNextAvailable(period, afterDateStr, preferredTime);

            if (!result || result.slots.length === 0) {
                return `Não encontrei horários disponíveis nos próximos 14 dias para esse período${preferredTime ? ` (aprox. ${preferredTime})` : ''}.`;
            }

            // Return first 2 slots
            const limited = result.slots.slice(0, 2);
            return `Encontrei horários para ${result.date}:\n${limited.join('\n')}`;
        } catch (error) {
            console.error('CheckAvailability error:', error);
            return 'Erro ao verificar disponibilidade.';
        }
    },
});

export const scheduleAppointmentTool = new DynamicTool({
    name: 'schedule_appointment',
    description: 'Schedules an appointment. Input must be JSON: {"name": "User Name", "phone": "5511...", "datetime": "YYYY-MM-DDTHH:mm:ss", "summary": "Motivo"}',
    func: async (input: string) => {
        try {
            let data = JSON.parse(input);

            // Handle nested "input" from LLM calls (e.g. { input: "{\"name\":...}" })
            if (data.input && typeof data.input === 'string') {
                try {
                    const inner = JSON.parse(data.input);
                    data = { ...data, ...inner };
                } catch (e) { }
            }

            const start = DateTime.fromISO(data.datetime, { zone: 'America/Sao_Paulo' });
            if (!start.isValid) {
                return 'Data/hora inválida. Use o formato ISO (ex: YYYY-MM-DDTHH:mm:ss).';
            }
            const end = start.plus({ minutes: 15 }); // 15 min duration
            const phone = (data.phone || '').replace(/\D/g, ''); // Sanitize phone

            if (!phone) {
                return 'Telefone é obrigatório para agendar.';
            }

            // D+2 Validation
            const minDate = DateUtils.getMinimumSchedulingDate();
            if (start < minDate.startOf('day')) {
                const formattedMin = DateUtils.formatToWhatsApp(minDate);
                return `Agendamento não permitido. Só é possível agendar com 2 dias úteis de antecedência (a partir de ${formattedMin}). Por favor, escolha outra data.`;
            }

            // 1. Update User Name in DB (Upsert)
            // This ensures we save the client's name for future interactions
            userService.createUser(phone, data.name || 'Cliente');

            // Format phone for display (Remove 55 country code if present)
            const displayPhone = phone.startsWith('55') && phone.length > 10 ? phone.substring(2) : phone;

            // 2. Create in Google Calendar
            const event = await calendarService.createEvent({
                summary: `${data.name || 'Cliente'} ${displayPhone}`,
                description: data.summary,
                start: { dateTime: start.toISO() },
                end: { dateTime: end.toISO() },
            });

            // 3. Save to Local DB (Persistence)
            if (event.id) {
                appointmentService.createAppointment(phone, event.id, start.toISO()!, data.summary);
            }

            return `Agendamento realizado com sucesso para ${start.setLocale('pt-BR').toFormat('dd/MM/yyyy HH:mm')}! ID: ${event.id}`;
        } catch (error) {
            console.error('Schedule error:', error);
            return 'Falha ao realizar agendamento. Verifique os dados (data/hora).';
        }
    },
});

export const getAppointmentsTool = new DynamicTool({
    name: 'get_appointments',
    description: 'Busca o próximo agendamento do usuário pelo telefone. Input: {"phone": "5511..."}',
    func: async (input: string) => {
        try {
            console.log(`[GetAppointments] Called with input: ${input}`);
            let phone = input;
            try {
                const data = JSON.parse(input);
                phone = data.phone;
            } catch (e) { }

            phone = phone.replace(/\D/g, '').trim();

            // 1. Try Local DB (Flexible)
            let apptData: { id: string, start: string, summary: string } | null = null;
            const localAppt = appointmentService.findLatestByPhoneFlexible(phone);

            if (localAppt) {
                apptData = {
                    id: localAppt.google_event_id,
                    start: localAppt.start_time,
                    summary: localAppt.summary
                };
            } else {
                console.log(`[GetAppointments] Local not found. Trying Google Fallback...`);
                // 2. Fallback to Google Calendar
                const remoteEvents = await calendarService.listAppointments(phone);
                console.log(`[GetAppointments] Google returned ${remoteEvents.length} events.`);

                if (remoteEvents.length > 0) {
                    const next = remoteEvents[0];
                    console.log(`[GetAppointments] Selected event: ${next.id} (${next.summary})`);
                    apptData = {
                        id: next.id,
                        start: next.start.dateTime || next.start.date,
                        summary: next.summary
                    };
                    // Optional: Sync back to local DB? For now, just use it.
                }
            }

            if (!apptData) {
                return 'Nenhum agendamento futuro encontrado para este número.';
            }

            return `Agendamento encontrado: "${apptData.summary}"\nData: ${new Date(apptData.start).toLocaleString('pt-BR')}\nID do Evento: ${apptData.id}`;
        } catch (error) {
            return 'Erro ao buscar agendamentos.';
        }
    },
});

export const cancelAppointmentTool = new DynamicTool({
    name: 'cancel_appointment',
    description: 'Cancela o agendamento do usuário. Input: {"phone": "5511...", "eventId": "..." (opcional)}',
    func: async (input: string) => {
        try {
            console.log(`[CancelTool] Called with input: ${input}`);
            let phone = '';
            let eventId = '';
            try {
                if (typeof input === 'string') {
                    const data = JSON.parse(input);
                    phone = data.phone || '';
                    eventId = data.eventId;
                } else if (typeof input === 'object') {
                    phone = (input as any).phone || '';
                    eventId = (input as any).eventId;
                }
            } catch (e) { }

            phone = String(phone).replace(/\D/g, '');

            // Validate eventId format (Google IDs are alphanumeric + underscore/dash, no spaces)
            // Stricter check: reject if contains ':', or looks like a date sequence (multi-dash)
            if (eventId && (
                eventId.includes(' ') ||
                eventId.includes(',') ||
                eventId.includes(':') ||
                eventId.split('-').length > 2 ||
                eventId.length < 5
            )) {
                console.log(`[CancelTool] Step 1.5: Invalid EventId format detected (likely a date string): "${eventId}". Ignoring to force lookup.`);
                eventId = '';
            }

            // DB VALIDATION: If we have an eventId, check if it exists in our records
            if (eventId) {
                const existing = appointmentService.findByEventId(eventId);
                if (!existing) {
                    console.log(`[CancelTool] Step 1.6: EventId "${eventId}" NOT found in local DB. Assuming hallucination. Ignoring.`);
                    eventId = '';
                } else {
                    console.log(`[CancelTool] Step 1.6: EventId "${eventId}" verified in local DB.`);
                }
            }

            console.log(`[CancelTool] Step 2: Processing cancellation for phone: ${phone}, EventId provided: ${eventId}`);

            // Find eventId if missing
            if (!eventId && phone) {
                console.log(`[CancelTool] Step 3: EventId missing, searching local DB...`);
                // 1. Try Local DB (Flexible)
                const localAppt = appointmentService.findLatestByPhoneFlexible(phone);
                if (localAppt) {
                    console.log(`[CancelTool] Step 4: Found local appointment: ${localAppt.google_event_id}`);
                    eventId = localAppt.google_event_id;
                } else {
                    console.log(`[CancelTool] Step 4: Local appointment not found. Trying Google Fallback...`);
                    // 2. Fallback to Google
                    const remoteEvents = await calendarService.listAppointments(phone);
                    if (remoteEvents.length > 0) {
                        console.log(`[CancelTool] Step 5: Found Google appointment: ${remoteEvents[0].id}`);
                        eventId = remoteEvents[0].id;
                    } else {
                        console.log(`[CancelTool] Step 5: No Google appointments found.`);
                    }
                }
            } else {
                console.log(`[CancelTool] Step 3: EventId already provided: ${eventId}`);
            }

            // ... (previous ID finding logic) ...

            if (!eventId) {
                console.log(`[CancelTool] Step 6: No eventId resolved. Aborting.`);
                return 'Não encontrei agendamento para cancelar. Pode me confirmar o número?';
            }

            // SELF-HEALING: Verify existence in Google before deleting
            const remoteEvent = await calendarService.getEvent(eventId);
            if (!remoteEvent || remoteEvent.status === 'cancelled') {
                console.log(`[CancelTool] Event ${eventId} is already stale/cancelled in Google. Checking for active replacements...`);
                // Cleanup stale local record
                appointmentService.deleteByEventId(eventId);

                // Search for the REAL active appointment
                const freshEvents = await calendarService.listAppointments(phone);
                if (freshEvents.length > 0) {
                    const next = freshEvents[0];
                    console.log(`[CancelTool] Found active replacement event: ${next.id}. Switching target.`);
                    eventId = next.id;
                    // Auto-link this new event to DB for future
                    appointmentService.upsertAppointment(phone, next.id, next.start.dateTime || next.start.date, next.summary);
                } else {
                    return 'Não encontrei nenhum agendamento ativo no Google Calendar para cancelar.';
                }
            }

            console.log(`[CancelTool] Step 7: Cancelling event ${eventId} in Google...`);
            await calendarService.cancelEvent(eventId);

            console.log(`[CancelTool] Step 8: Deleting from local DB...`);
            appointmentService.deleteByEventId(eventId);

            console.log(`[CancelTool] Step 9: Cancellation successful.`);
            return 'Agendamento cancelado com sucesso!';
        } catch (error) {
            console.error('Cancel error:', error);
            return 'Erro ao cancelar agendamento.';
        }
    },
});

export const rescheduleAppointmentTool = new DynamicTool({
    name: 'reschedule_appointment',
    description: 'Remarca agendamento. Input: {"phone": "5511...", "newDateTime": "YYYY-MM-DDTHH:mm:ss"}',
    func: async (input: string) => {
        try {
            console.log(`[RescheduleTool] Called with input: ${input}`);
            let phone = '';
            let newDateTime = '';
            let eventId = '';

            try {
                let data = JSON.parse(input);

                // Handle nested "input" from LLM calls (wrapper fix)
                if (data.input && typeof data.input === 'string') {
                    try {
                        const inner = JSON.parse(data.input);
                        data = { ...data, ...inner };
                    } catch (e) { }
                }

                if (typeof data === 'string') {
                    // unexpected double string
                } else {
                    phone = data.phone || '';
                    newDateTime = data.newDateTime;
                    eventId = data.eventId;
                }
            } catch (e) { }

            phone = String(phone).replace(/\D/g, '');

            // Validate eventId format (Google IDs are alphanumeric + underscore/dash, no spaces)
            if (eventId && (
                eventId.includes(' ') ||
                eventId.includes(',') ||
                eventId.includes(':') ||
                eventId.split('-').length > 2 ||
                eventId.length < 5
            )) {
                console.log(`[RescheduleTool] Step 1.5: Invalid EventId format detected (likely a date string): "${eventId}". Ignoring to force lookup.`);
                eventId = '';
            }

            // DB VALIDATION: If we have an eventId, check if it exists in our records
            if (eventId) {
                const existing = appointmentService.findByEventId(eventId);
                if (!existing) {
                    console.log(`[RescheduleTool] Step 1.6: EventId "${eventId}" NOT found in local DB. Assuming hallucination. Ignoring.`);
                    eventId = '';
                } else {
                    console.log(`[RescheduleTool] Step 1.6: EventId "${eventId}" verified in local DB.`);
                }
            }

            // Find eventId if missing
            if (!eventId && phone) {
                // 1. Try Local DB (Flexible)
                const localAppt = appointmentService.findLatestByPhoneFlexible(phone);
                if (localAppt) {
                    console.log(`[RescheduleTool] Found local appointment: ${localAppt.google_event_id}`);
                    eventId = localAppt.google_event_id;
                } else {
                    console.log(`[RescheduleTool] Local not found. Trying Google Fallback...`);
                    // 2. Fallback to Google
                    const remoteEvents = await calendarService.listAppointments(phone);
                    if (remoteEvents.length > 0) {
                        console.log(`[RescheduleTool] Found Google appointment: ${remoteEvents[0].id}`);
                        eventId = remoteEvents[0].id;
                    }
                }
            }

            if (!eventId) {
                return 'Não encontrei agendamento para remarcar.';
            }

            // SELF-HEALING: Verify existence in Google
            const remoteEvent = await calendarService.getEvent(eventId);
            if (!remoteEvent || remoteEvent.status === 'cancelled') {
                console.log(`[RescheduleTool] Event ${eventId} is stale. Searching for active...`);
                appointmentService.deleteByEventId(eventId);

                const freshEvents = await calendarService.listAppointments(phone);
                if (freshEvents.length > 0) {
                    eventId = freshEvents[0].id;
                    console.log(`[RescheduleTool] Switched to active event: ${eventId}`);
                    appointmentService.upsertAppointment(phone, eventId, freshEvents[0].start.dateTime || freshEvents[0].start.date, freshEvents[0].summary);
                } else {
                    return 'Não encontrei o agendamento original no Google Calendar. Pode ter sido cancelado ou movido manualmente.';
                }
            }

            // Google Update
            const start = DateTime.fromISO(newDateTime, { zone: 'America/Sao_Paulo' });
            if (!start.isValid) {
                return 'Data/hora inválida para remarcação.';
            }

            // D+2 Validation
            const minDate = DateUtils.getMinimumSchedulingDate();
            if (start < minDate.startOf('day')) {
                const formattedMin = DateUtils.formatToWhatsApp(minDate);
                return `Remarcação não permitida para esta data. Só é possível agendar com 2 dias úteis de antecedência (a partir de ${formattedMin}). Por favor, escolha outra data.`;
            }

            await calendarService.updateEventTime(eventId, start.toISO()!);

            // Local DB Update (Try to update if exists, otherwise ignore)
            try {
                appointmentService.updateAppointmentTime(eventId, start.toISO()!);
            } catch (e) { }

            return `Agendamento remarcado com sucesso para ${start.setLocale('pt-BR').toFormat('dd/MM/yyyy HH:mm')}!`;
        } catch (error) {
            console.error('Reschedule error:', error);
            return 'Erro ao remarcar agendamento.';
        }
    },
});

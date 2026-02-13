import { DynamicTool } from '@langchain/core/tools';
import { evolutionService } from '../../services/evolution.service';
import { config } from '../../config/unifiedConfig';

export const handoverTool = new DynamicTool({
    name: 'handover',
    description: 'Use specialized handover when the user requests something out of scope, has an urgency, or needs to speak with a human. Input: {"name": "...", "phone": "...", "reason": "...", "plan": "..."}',
    func: async (input: string) => {
        try {
            console.log(`[HandoverTool] Called with input: ${input}`);
            let data: any = {};

            try {
                data = JSON.parse(input);
            } catch (e) {
                // fallback if input is just a string reason
                data = { reason: input };
            }

            // Construct notification message
            const doctorMsg = `🚨 *ENCAMINHAMENTO* 🚨\n\n` +
                `👤 *Pac:* ${data.name || 'Não informado'}\n` +
                `📱 *Tel:* ${data.phone || 'Não informado'}\n` +
                `📝 *Motivo:* ${data.reason || 'Necessita atenção humana/urgência'}\n` +
                `hz *Plano:* ${data.plan || 'Não informado'}`;

            // Send to Doctor
            if (config.DOCTOR_PHONE && config.DOCTOR_PHONE !== '5513999999999') {
                console.log(`[HandoverTool] Sending notification to doctor (${config.DOCTOR_PHONE})...`);
                await evolutionService.sendMessage(config.DOCTOR_PHONE, doctorMsg);
            } else {
                console.log(`[HandoverTool] Doctor phone not configured (or default). Logging only:\n${doctorMsg}`);
            }

            return `[SYSTEM]: HANDOVER_REQUESTED. Reason: ${data.reason}`;
        } catch (error) {
            console.error('Handover tool error:', error);
            return 'Erro ao processar encaminhamento.';
        }
    },
});

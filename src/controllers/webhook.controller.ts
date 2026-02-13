import { FastifyRequest, FastifyReply } from 'fastify';
import { orchestrator } from '../agent/orchestrator';

export class WebhookController {
    static async handleWebhook(req: FastifyRequest, reply: FastifyReply) {
        // 1. Respond immediately to acknowledge receipt
        reply.status(200).send({ status: 'success' });

        // 2. Extract data safely
        const body: any = req.body;

        // Basic check for message event
        if (body?.event === 'messages.upsert') {
            const messageData = body.data;
            const remoteJid = messageData.key.remoteJid;
            const fromMe = messageData.key.fromMe;

            // Ignore own messages
            if (fromMe) return;

            // Extract content
            let text = '';
            let audioBase64 = undefined;

            const msg = messageData.message;
            if (!msg) return;

            if (msg.conversation) {
                text = msg.conversation;
            } else if (msg.extendedTextMessage?.text) {
                text = msg.extendedTextMessage.text;
            } else if (msg.audioMessage) {
                // Evolution API v2 usually sends base64 in data.base64 or we fetch it.
                // NOTE: If Evolution sends media as URL, we'd need to fetch it.
                // Assuming "includeBase64OnData: true" config in Evolution.
                if (messageData.base64) {
                    audioBase64 = messageData.base64;
                }
            }

            if (remoteJid && (text || audioBase64)) {
                // 3. Async processing
                orchestrator.processMessage(remoteJid, { text, audioBase64 }).catch(err => {
                    console.error('❌ Async processing error:', err);
                });
            }
        }
    }
}

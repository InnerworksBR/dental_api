import { FastifyInstance } from 'fastify';
import { WebhookController } from '../controllers/webhook.controller';

export async function webhookRoutes(fastify: FastifyInstance) {
    fastify.post('/webhook', WebhookController.handleWebhook);
    fastify.post('/', WebhookController.handleWebhook); // Handle root requests too
}

import Fastify from 'fastify';
import { webhookRoutes } from './routes/webhook.routes';

export const buildApp = () => {
    const app = Fastify({
        logger: {
            transport: {
                target: 'pino-pretty',
            },
        },
    });

    // Register plugins
    // app.register(fastifyFormbody); // If needed

    // Register routes
    app.register(webhookRoutes);

    return app;
};

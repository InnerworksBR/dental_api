import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
    PORT: z.string().default('3001').transform(Number),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DB_PATH: z.string().default('./dapi.db'),
    EVOLUTION_API_URL: z.string().url(),
    EVOLUTION_API_KEY: z.string().min(1),
    EVOLUTION_INSTANCE_NAME: z.string().min(1),
    OPENAI_API_KEY: z.string().optional(),
    GOOGLE_PROJECT_NUMBER: z.string().optional(),
    GOOGLE_PRIVATE_KEY: z.string().optional(),
    GOOGLE_CALENDAR_ID: z.string().optional(),
    GOOGLE_CLIENT_EMAIL: z.string().email().optional(),
    DOCTOR_PHONE: z.string().default('5513999999999'),
});

const parseConfig = () => {
    const env = { ...process.env };

    // Map GOOGLE_SERVICE_ACCOUNT_EMAIL to GOOGLE_CLIENT_EMAIL if needed
    if (!env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
        env.GOOGLE_CLIENT_EMAIL = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    }

    // Fix newlines in private key (common issue with .env)
    // Fix newlines in private key (common issue with .env)
    if (env.GOOGLE_PRIVATE_KEY) {
        let key = env.GOOGLE_PRIVATE_KEY;
        // Remove wrapping quotes if present (e.g. "KEY")
        if (key.startsWith('"') && key.endsWith('"')) {
            key = key.slice(1, -1);
        }
        // Replace literal \n with actual newline
        env.GOOGLE_PRIVATE_KEY = key.replace(/\\n/g, '\n');
    }

    const parsed = configSchema.safeParse(env);
    if (!parsed.success) {
        console.error('❌ Invalid environment variables:', parsed.error.format());
        process.exit(1);
    }
    return parsed.data;
};

export const config = parseConfig();

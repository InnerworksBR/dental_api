import { buildApp } from './app';
import { config } from './config/unifiedConfig';
import { initDb } from './db/sqlite';
import { syncService } from './services/sync.service';

const start = async () => {
    try {
        // Initialize DB
        initDb();

        // Start Background Sync
        syncService.startSyncLoop();

        // Start Server
        const app = buildApp();
        await app.listen({ port: config.PORT, host: '0.0.0.0' });
        console.log(`🚀 Server running on http://localhost:${config.PORT}`);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

start();


import { buildApp } from '../../src/app';
import { FastifyInstance } from 'fastify';
import { AIMessage } from '@langchain/core/messages';

// 1. Mock Config
jest.mock('../../src/config/unifiedConfig', () => ({
    config: {
        PORT: 3000,
        GOOGLE_CLIENT_EMAIL: 'test@example.com',
        GOOGLE_PRIVATE_KEY: 'test-key',
        GOOGLE_CALENDAR_ID: 'primary',
        EVOLUTION_API_URL: 'http://evolution',
        EVOLUTION_API_KEY: 'evo-key',
        EVOLUTION_INSTANCE_NAME: 'EvoInstance',
        OPENAI_API_KEY: 'sk-test',
        DB_PATH: ':memory:', // Not used if we mock sqlite, but good to have
    },
}));

// 2. Mock SQLite (In-Memory)
// We define the mock factory to create the DB.
jest.mock('../../src/db/sqlite', () => {
    const Database = require('better-sqlite3');
    const mockDb = new Database(':memory:');
    mockDb.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          remoteJid TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    return {
        __esModule: true,
        default: mockDb,
        initDb: jest.fn(),
    };
});

// Import the mocked DB to use in tests
import db from '../../src/db/sqlite';

// 3. Mock Google APIs
jest.mock('googleapis', () => ({
    google: {
        calendar: jest.fn().mockReturnValue({
            events: {
                list: jest.fn().mockResolvedValue({ data: { items: [] } }),
            },
        }),
    },
}));

// 4. Mock Axios (Evolution Service)
import axios from 'axios';
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
mockedAxios.post.mockResolvedValue({});

// 5. Mock LangChain OpenAI
// We need to control the 'invoke' method to return tools or text.
jest.mock('@langchain/openai', () => {
    const mockInvoke = jest.fn();
    return {
        ChatOpenAI: jest.fn().mockImplementation(() => ({
            bindTools: jest.fn().mockReturnValue({
                invoke: mockInvoke,
            }),
        })),
        _mockInvoke: mockInvoke,
    };
});

import * as langchainOpenai from '@langchain/openai';
const mockInvoke = (langchainOpenai as any)._mockInvoke;

describe('Webhook Integration', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = buildApp();
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // Clear DB table
        db.exec('DELETE FROM messages');
    });

    it('should handle simple text message and reply', async () => {
        // Setup LLM response
        mockInvoke.mockResolvedValueOnce(new AIMessage('Olá! Qual seu nome?'));

        const response = await app.inject({
            method: 'POST',
            url: '/webhook',
            payload: {
                data: {
                    key: { remoteJid: '5511999999999@s.whatsapp.net' },
                    message: { conversation: 'Oi' },
                },
                event: 'messages.upsert',
            },
        });

        expect(response.statusCode).toBe(200);

        // Verify LLM called
        expect(mockInvoke).toHaveBeenCalled();

        // Verify Evolution Service called (Reply sent)
        expect(mockedAxios.post).toHaveBeenCalledWith(
            expect.stringContaining('/message/sendText'),
            expect.objectContaining({
                number: '5511999999999@s.whatsapp.net',
                text: 'Olá! Qual seu nome?'
            }),
            expect.anything()
        );
    });

    it.only('should execute check_availability tool flow', async () => {
        // 1. LLM decides to call tool
        mockInvoke.mockResolvedValueOnce(new AIMessage({
            content: '',
            tool_calls: [{
                name: 'check_availability',
                args: {},
                id: 'call_123',
                type: 'tool_call' // Add required type
            }]
        }));

        // 2. LLM receives tool result and responds
        mockInvoke.mockResolvedValueOnce(new AIMessage('Temos horarios disponiveis as 10:00.'));

        const response = await app.inject({
            method: 'POST',
            url: '/webhook',
            payload: {
                data: {
                    key: { remoteJid: '5511999999999@s.whatsapp.net' },
                    message: { conversation: 'Tem horario?' },
                },
                event: 'messages.upsert',
            },
        });

        expect(response.statusCode).toBe(200);

        // Verify LLM called twice
        expect(mockInvoke).toHaveBeenCalledTimes(2);

        // Verify Calendar Tool was implicitly called (because LLM returned tool call)
        // We mocked googleapis, so specific verification of calendarService internal logic 
        // is covered by unit tests, but we can verify correct flow logic.

        // Verify final response sent
        expect(mockedAxios.post).toHaveBeenCalledWith(
            expect.stringContaining('/message/sendText'),
            expect.objectContaining({
                text: 'Temos horarios disponiveis as 10:00.'
            }),
            expect.anything()
        );
    });

    it('should handle human handover', async () => {
        mockInvoke.mockResolvedValueOnce(new AIMessage('TRANSBORDO_HUMANO'));

        const response = await app.inject({
            method: 'POST',
            url: '/webhook',
            payload: {
                data: {
                    key: { remoteJid: '5511999999999@s.whatsapp.net' },
                    message: { conversation: 'Quero falar com atendente' },
                },
                event: 'messages.upsert',
            },
        });

        // Verify intercept logic
        expect(mockedAxios.post).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                text: expect.stringContaining('Vou transferir seu atendimento') // From orchestration logic
            }),
            expect.anything()
        );
    });
});

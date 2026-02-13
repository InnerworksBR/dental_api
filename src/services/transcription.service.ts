import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { config } from '../config/unifiedConfig';

export class TranscriptionService {
    private openai: OpenAI;

    constructor() {
        this.openai = new OpenAI({
            apiKey: config.OPENAI_API_KEY,
        });
    }

    /**
     * Transcribes a base64 encoded audio file using OpenAI Whisper.
     * @param base64Audio The base64 string of the audio file.
     * @param extension The file extension (e.g., 'ogg', 'mp3'). Defaults to 'ogg' for WhatsApp voice notes.
     * @returns The transcribed text.
     */
    async transcribeAudio(base64Audio: string, extension: string = 'ogg'): Promise<string> {
        const tempFilePath = path.join(os.tmpdir(), `audio-${Date.now()}.${extension}`);

        try {
            // 1. Write base64 to temp file
            const buffer = Buffer.from(base64Audio, 'base64');
            await fs.promises.writeFile(tempFilePath, buffer);

            // 2. Call OpenAI Whisper
            const transcription = await this.openai.audio.transcriptions.create({
                file: fs.createReadStream(tempFilePath),
                model: 'whisper-1',
                language: 'pt', // Force Portuguese for better accuracy
            });

            return transcription.text;

        } catch (error) {
            console.error('Error transcribing audio:', error);
            throw new Error('Failed to transcribe audio message.');
        } finally {
            // 3. Cleanup temp file
            if (fs.existsSync(tempFilePath)) {
                await fs.promises.unlink(tempFilePath).catch(() => { });
            }
        }
    }
}

export const transcriptionService = new TranscriptionService();

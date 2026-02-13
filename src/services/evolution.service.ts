import axios from 'axios';
import { config } from '../config/unifiedConfig';

export class EvolutionService {
    private apiUrl: string;
    private apiKey: string;
    private instanceName: string;

    constructor() {
        this.apiUrl = config.EVOLUTION_API_URL;
        this.apiKey = config.EVOLUTION_API_KEY;
        this.instanceName = config.EVOLUTION_INSTANCE_NAME;
    }

    async sendMessage(remoteJid: string, text: string): Promise<void> {
        try {
            // Correct endpoint structure: /message/sendText/{instance}
            const url = `${this.apiUrl}/message/sendText/${this.instanceName}`;

            await axios.post(
                url,
                {
                    number: remoteJid,
                    text: text,
                    delay: 1200,
                    linkPreview: true
                },
                {
                    headers: {
                        apikey: this.apiKey,
                        'Content-Type': 'application/json',
                    },
                }
            );
            console.log(`Sent message to ${remoteJid}`);
        } catch (error: any) {
            console.error('Failed to send message:', error.response?.data || error.message);
        }
    }

    /**
     * Sends a "typing..." presence to the user.
     */
    async sendPresence(remoteJid: string): Promise<void> {
        try {
            const url = `${this.apiUrl}/chat/sendPresence/${this.instanceName}`;

            await axios.post(
                url,
                {
                    number: remoteJid,
                    presence: 'composing',
                    delay: 1200
                },
                {
                    headers: {
                        apikey: this.apiKey,
                        'Content-Type': 'application/json',
                    },
                }
            );
        } catch (error: any) {
            console.warn('Failed to send presence:', error.response?.data || error.message);
        }
    }
}

export const evolutionService = new EvolutionService();

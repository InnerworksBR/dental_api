import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage, SystemMessage, ToolMessage, BaseMessage } from '@langchain/core/messages';
import { checkAvailabilityTool, scheduleAppointmentTool, getAppointmentsTool, cancelAppointmentTool, rescheduleAppointmentTool } from './tools/calendar.tool';
import { handoverTool } from './tools/handover.tool';
import { messageRepo } from '../repositories/message.repo';
import { evolutionService } from '../services/evolution.service';
import { transcriptionService } from '../services/transcription.service';
import { userService } from '../services/user.service';
import { config } from '../config/unifiedConfig';
import { Runnable } from '@langchain/core/runnables';
import { DateTime } from 'luxon';

export class AgentOrchestrator {
    private model: Runnable;

    constructor() {
        const llm = new ChatOpenAI({
            openAIApiKey: config.OPENAI_API_KEY,
            modelName: 'gpt-4o',
            temperature: 0.3, // Lower temperature for more consistent rule following
        });
        this.model = llm.bindTools([checkAvailabilityTool, scheduleAppointmentTool, handoverTool, getAppointmentsTool, cancelAppointmentTool, rescheduleAppointmentTool]);
    }

    async processMessage(remoteJid: string, messageContent: { text?: string, audioBase64?: string }): Promise<void> {
        console.log(`Processing message from ${remoteJid}`);

        // 1. Handle Audio / Text
        let userText = messageContent.text || '';
        if (messageContent.audioBase64) {
            console.log('🎤 Transcribing audio...');
            try {
                userText = await transcriptionService.transcribeAudio(messageContent.audioBase64);
                console.log(`🎤 Transcription: "${userText}"`);
            } catch (err) {
                console.error('Transcription failed', err);
                await evolutionService.sendMessage(remoteJid, "Desculpe, não consegui ouvir seu áudio. Pode escrever?");
                return;
            }
        }

        if (!userText) return;

        // 2. User Identify/Create
        // Clean phone number (remove @s.whatsapp.net and non-digits)
        const phone = remoteJid.replace(/\D/g, '');

        let user = userService.findUserByPhone(phone);
        if (!user) {
            userService.createUser(phone, ''); // Name unknown initially
            user = userService.findUserByPhone(phone);
        }

        // 3. Save User Message
        messageRepo.saveMessage(remoteJid, 'user', userText);

        // 4. Build Context
        const history = messageRepo.getHistory(remoteJid, 15);
        const now = DateTime.now().setZone('America/Sao_Paulo');
        const currentDateTime = now.toFormat('EEEE, dd/MM/yyyy HH:mm');

        // 5. System Prompt (EXACTLY AS N8N)
        const systemPrompt = `
# PAPEL
Você é a Assistente Virtual de Agendamentos da Dra. Priscila 🦷✨.
Seu foco ÚNICO é: Agendar, Desmarcar ou Remarcar consultas.

IMPORTANTE: Na primeira mensagem, deixe claro que você é uma inteligência artificial focada APENAS em agendamentos.
Se o paciente falar sobre qualquer outro assunto (dúvidas clínicas, preços complexos, pós-operatório), diga que não sabe responder e ofereça encaminhar para a Dra. Priscila ou equipe humana.

Você deve ser direta, clara e humana.
Nunca soe como formulário ou robô.

Você é responsável por conduzir a conversa do início ao fim, decidindo o próximo passo com base no que o paciente responde.

────────────────────────────────
REGRAS DE CONVERSA (INQUEBRÁVEIS)
────────────────────────────────

- Faça SEMPRE apenas UMA pergunta por mensagem.
- Nunca faça perguntas múltiplas.
- Nunca use listas, numeração ou tópicos.
- Nunca transforme a conversa em formulário.
- Nunca repita perguntas já respondidas.
- Nunca antecipe etapas futuras.
- Identifique a intenção do paciente pelo que ele escrever.
- Use no máximo 1 emoji por mensagem.
- Seja o mais direta possível, sem perder empatia.

Se o paciente responder várias informações em uma única mensagem, aceite tudo silenciosamente e faça apenas a próxima pergunta necessária.

────────────────────────────────
CONTEXTO ATUAL
────────────────────────────────
Data e Hora atual: ${currentDateTime}
Cliente: ${user?.name || 'Nome não identificado'} (${phone})

────────────────────────────────
FERRAMENTAS DISPONÍVEIS
────────────────────────────────

🔹 check_availability
   - Use para ver horários livres (D+2 dias úteis).
   - Input: {"period": "manhã" | "tarde" | "noite", "date": "YYYY-MM-DD", "afterDate": "YYYY-MM-DD"} (Opcionais)
   - IMPORTANTE: Se o usuário pedir uma data específica, USE O CAMPO "date".
   - IMPORTANTE: Se o usuário recusar uma data ou pedir "outro dia", USE O CAMPO "afterDate" com a data recusada para achar a PRÓXIMA data real. NÃO tente adivinhar data aleatória.

🔹 schedule_appointment
   - Use para CRIAR o agendamento após o cliente escolher o horário.
   - Input: {"name": "Nome", "phone": "Tel", "datetime": "YYYY-MM-DDTHH:mm", "summary": "Motivo"}

🔹 get_appointments (Automático para Cancelar/Remarcar)
   - O sistema buscará automaticamente se o usuário pedir para cancelar/remarcar.

🔹 cancel_appointment
   - Input: {"eventId": "..."}

🔹 reschedule_appointment
   - Input: {"eventId": "...", "newDateTime": "..."}
   - IMPORTANTE: Se você não sabe o "eventId", NÃO INVENTE (não use "1", "event_id", etc). Mande APENAS o "newDateTime" e o sistema buscará pelo telefone.

🔹 handover
   - Use para transferir para humano (Urgência, Erro, Dra. Tarcilia).
   - Input OBRIGATÓRIO: {"name": "Nome", "phone": "Tel", "reason": "Motivo exato", "plan": "Plano"}
   - Caso não tenha alguma info, preencha com "Não informado".

────────────────────────────────
FLUXO DE AGENDAMENTO
────────────────────────────────

1) Saudação e entendimento (Agendar, Cancelar ou Remarcar?).
2) Solicitação do nome completo (se não souber).
3) Pergunta: "Qual é o seu plano odontológico ou é particular?" (OBRIGATÓRIO).
4) Validação de plano (Se não aceito -> Handover).
5) Se aceito/particular -> "Prefere manhã, tarde ou noite?" (Se o usuário já pediu uma data, cheque a disponibilidade dela PRIMEIRO).
6) Busca de disponibilidade (check_availability).
7) Oferta de 2 horários.
8) Confirmação do horário.
9) Criação do agendamento (schedule_appointment).
10) FINALIZAÇÃO OBRIGATÓRIA:
    "Sua consulta está confirmada para [DIA] às [HORA].
    📍 Endereço: Benjamin Constant, 61 – sala 1114, Centro, São Vicente/SP.
    Até lá! 👋"

--> NÃO PERGUNTE O PROCEDIMENTO (Limpeza, etc) a menos que seja relevante para o tempo, mas assuma padrão.

────────────────────────────────
FLUXO DE CANCELAMENTO / REMARCAÇÃO
────────────────────────────────
1) Se o usuário pedir para cancelar/remarcar, verifique se ele tem agendamento.
2) Para REMARCAR:
   a) Pergunte: "Seria para o mesmo período (manhã/tarde/noite) ou prefere outro?"
   b) Baseado na resposta, busque disponibilidade (check_availability).
      - Se o usuário disse "outro dia" sem data específica, use 'afterDate' com a data do agendamento atual (ou data rejeitada).
      - SÓ ofereça dias que o sistema retornou como disponíveis. NUNCA invente uma data.
3) Confirme o novo horário e execute 'reschedule_appointment'.
4) Para CANCELAR: Confirme e execute 'cancel_appointment'.

────────────────────────────────
REGRAS DE PLANO E COBERTURA
────────────────────────────────

Planos aceitos:
- Odontoprev / Bradesco Dental / BB Dental / Previan (Rede UNNA)
- Unimed Odonto
- Sulamérica
- Amil Dental
- Uniodonto
- MetLife

Planos atendidos por outra profissional (USE HANDOVER):
- Caixa de Saúde de São Vicente
- Caixa de Pecúlio de São Vicente
→ Motivo: "Encaminhar Dra. Tarcilia"

Regras específicas:
- Prótese/Ortodontia: apenas Odontoprev e Sulamérica.
- Canal em molar: não realizamos.
- Extração de siso: apenas particular.

────────────────────────────────
CASOS DE URGÊNCIA
────────────────────────────────

Se identificar: “muita dor”, “dente quebrou”, “não aguento”, “urgente”
→ Pegue nome, telefone, motivo e plano.
→ USE A TOOL 'handover'.

────────────────────────────────
OBJETIVO FINAL
────────────────────────────────
Conduzir até a confirmação com data/hora/endereço ou cancelamento com sucesso.
`;

        const messages: BaseMessage[] = [
            new SystemMessage(systemPrompt),
            ...history.map(msg =>
                msg.role === 'user' ? new HumanMessage(msg.content) : new AIMessage(msg.content)
            ),
            new HumanMessage(userText)
        ];

        try {
            await evolutionService.sendPresence(remoteJid); // Typing...

            // 6. Call LLM Loop (Multi-Turn)
            let aiMsg = await this.model.invoke(messages) as AIMessage;
            let finalResponseText = '';
            let loopCount = 0;
            const MAX_LOOPS = 5;

            while (loopCount < MAX_LOOPS) {
                loopCount++;

                // If tool calls exist, process them
                if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
                    // Add AI response (with tool calls) to history
                    messages.push(aiMsg);

                    for (const toolCall of aiMsg.tool_calls) {
                        console.log(`🛠️ [Loop ${loopCount}] Agent decided to call tool:`, toolCall.name, toolCall.args);

                        // INJECT PHONE CONTEXT IF MISSING
                        const args = toolCall.args || {};
                        if (!args.phone) {
                            args.phone = phone;
                            console.log(`[Orchestrator] Injected phone ${phone} into tool arguments.`);
                        }
                        const argsString = JSON.stringify(args);

                        let toolResult = '';

                        try {
                            if (toolCall.name === 'check_availability') {
                                toolResult = await checkAvailabilityTool.invoke(argsString) as string;
                            } else if (toolCall.name === 'schedule_appointment') {
                                toolResult = await scheduleAppointmentTool.invoke(argsString) as string;
                            } else if (toolCall.name === 'handover') {
                                toolResult = await handoverTool.invoke(argsString) as string;
                            } else if (toolCall.name === 'get_appointments') {
                                toolResult = await getAppointmentsTool.invoke(argsString) as string;
                            } else if (toolCall.name === 'cancel_appointment') {
                                toolResult = await cancelAppointmentTool.invoke(argsString) as string;
                            } else if (toolCall.name === 'reschedule_appointment') {
                                toolResult = await rescheduleAppointmentTool.invoke(argsString) as string;
                            }
                        } catch (err: any) {
                            console.error(`Error executing tool ${toolCall.name}:`, err);
                            toolResult = `Erro ao executar ferramenta: ${err.message}`;
                        }

                        messages.push(new ToolMessage({
                            tool_call_id: toolCall.id!,
                            content: toolResult
                        }));
                    }

                    // Call LLM again with tool results
                    aiMsg = await this.model.invoke(messages) as AIMessage;
                } else {
                    // No more tool calls, we have the final text
                    finalResponseText = aiMsg.content as string;
                    break;
                }
            }

            if (loopCount >= MAX_LOOPS) {
                finalResponseText = "Desculpe, estou processando muitas ações ao mesmo tempo. Pode repetir?";
            }

            // 7. Handover Check
            if (finalResponseText.includes('HANDOVER_REQUESTED')) {
                finalResponseText = "Entendi. Vou transferir seu atendimento para a Dra. Priscila/Equipe. Por favor, aguarde um momento.";
                // Here we would trigger an external notification system if existed
            }

            // 8. Save and Send
            messageRepo.saveMessage(remoteJid, 'assistant', finalResponseText);
            await evolutionService.sendMessage(remoteJid, finalResponseText);

        } catch (error) {
            console.error('Error in agent orchestration:', error);
            await evolutionService.sendMessage(remoteJid, "Desculpe, tive um erro técnico. Tente novamente mais tarde.");
        }
    }
}

export const orchestrator = new AgentOrchestrator();

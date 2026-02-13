**PRD - Agente de Agendamento Inteligente**

*   **Objetivo:** Automação total de agendamentos via WhatsApp (Evolution API) e Google Calendar.
    
*   **Regras de Disponibilidade (Hard Rules):**
    
    *   **Slotting:** Janelas fixas de 15 minutos (ex: 09:00, 09:15, 09:30).
        
    *   **Lead Time:** Agendamentos apenas a partir de **D+2 dias úteis**. Se hoje é sexta-feira, o próximo disponível é terça-feira.
        
    *   **Bloqueios:** Eventos no Google Calendar com o título OCUPADO - 00000 devem ser tratados como horários indisponíveis.
        
*   **Gestão de Escopo:**
    
    *   **Conversa Administrativa:** Agendar, remarcar, listar planos.
        
    *   **Transbordo (Off-topic):** Dúvidas médicas ou clínicas disparam a mensagem: _"Entendido. Vou encaminhar sua mensagem para a Dra. e ela te responderá pessoalmente em breve."_
        
*   **Stack:** Fastify (API), SQLite (Memória de Chat/Contexto), LangChain (Agentic Workflow), Luxon (Timezone: America/Sao\_Paulo).
    
*   **Persistência:** Tabela sessions no SQLite deve armazenar o remoteJid e o chat\_history para que o agente nunca esqueça o paciente.
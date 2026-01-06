# 🔒 Análise de Segurança - WhatsApp Webhook

## 📋 Resumo Executivo

Esta análise identifica vulnerabilidades e propõe melhorias de segurança para o webhook WhatsApp. O código atual possui boas práticas básicas, mas há várias oportunidades de fortalecimento.

**Nível de Risco Atual**: ⚠️ **Médio-Alto**  
**Nível de Risco Após Implementação**: ✅ **Baixo**

---

## 🚨 Vulnerabilidades e Riscos Identificados

### 1. **Exposição de Dados Sensíveis nos Logs** 🔴 **CRÍTICO**

**Problema**: Os logs atuais expõem informações sensíveis:
- Tokens completos (WEBHOOK_SECRET, APP_SECRET, tokens recebidos)
- Body completo das requisições (pode conter dados pessoais)
- Headers completos (incluindo tokens de autenticação)

**Risco**:
- Se logs forem comprometidos, todos os segredos são expostos
- Dados pessoais de mensagens WhatsApp podem ser expostos
- Violação de LGPD/GDPR

**Localização**: 
- `logFullRequest()` - linha ~121
- `logPayload()` - linha ~162
- Validações que logam tokens completos

**Solução Recomendada**:
- Mascarar tokens/secrets nos logs (mostrar apenas últimos 4 caracteres)
- Sanitizar body antes de logar (remover campos sensíveis)
- Usar diferentes níveis de log (DEBUG vs PRODUCTION)
- Hash de dados sensíveis ou truncamento inteligente

---

### 2. **Falta de Rate Limiting** 🔴 **CRÍTICO**

**Problema**: Não há limitação de taxa de requisições.

**Risco**:
- DDoS (Distributed Denial of Service)
- Brute force attacks
- Exaustão de recursos (memória, CPU, RabbitMQ)
- Custos elevados em infraestrutura

**Solução Recomendada**:
- Implementar rate limiting por IP
- Limites diferenciados para GET e POST
- Whitelist para IPs do Meta/Facebook
- Retornar `429 Too Many Requests` quando exceder

**Bibliotecas Sugeridas**:
- `express-rate-limit` (in-memory ou Redis)
- `express-slow-down` (proteção contra slowloris)
- Redis para rate limiting distribuído (em cluster)

---

### 3. **Falta de Validação de IP de Origem** 🟠 **ALTO**

**Problema**: Aceita requisições de qualquer IP, não valida se vem do Meta/Facebook.

**Risco**:
- Ataques de requisições falsas
- Mesmo com assinatura válida, IP pode ser diferente
- Spoofing de requisições

**Solução Recomendada**:
- Whitelist de IPs do Meta/Facebook
- Validação de User-Agent (`facebookexternalua`)
- Manter lista atualizada de IPs do Meta (pode mudar)
- Validação em camadas (IP + Assinatura + User-Agent)

**IPs Conhecidos do Meta** (exemplos - pesquisar lista oficial atualizada):
- `2a03:2880:*` (IPv6)
- Vários ranges IPv4 (consultar documentação oficial)

---

### 4. **Falta de Headers de Segurança HTTP** 🟠 **ALTO**

**Problema**: Não há headers de segurança HTTP configurados.

**Risco**:
- XSS (Cross-Site Scripting) - se houver interface web
- Clickjacking
- MIME type sniffing
- Exposição de versão do servidor

**Solução Recomendada**:
- `helmet` middleware para headers de segurança
- Headers específicos:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Strict-Transport-Security` (se HTTPS)
  - `X-XSS-Protection`
  - Remover `X-Powered-By` (Express)

---

### 5. **Validação de Payload Insuficiente** 🟠 **ALTO**

**Problema**: Validação apenas verifica se é objeto, não valida estrutura.

**Risco**:
- Payloads malformados podem causar erros
- Ataques de injeção de dados inválidos
- Possível DoS através de payloads complexos
- Dados inválidos no RabbitMQ

**Solução Recomendada**:
- Schema validation (JSON Schema ou Zod)
- Validação de estrutura esperada do WhatsApp
- Limites de profundidade de objetos aninhados
- Validação de tipos de dados
- Tamanho máximo de arrays/objetos

---

### 6. **Falta de Timeout em Requisições** 🟡 **MÉDIO**

**Problema**: Não há timeout configurado para requisições.

**Risco**:
- Slowloris attacks
- Requisições que ficam abertas indefinidamente
- Exaustão de conexões

**Solução Recomendada**:
- Timeout no Express (`server.timeout`)
- Timeout no middleware de body parsing
- Timeout nas operações do RabbitMQ

---

### 7. **Logs Expõem Informações de Infraestrutura** 🟡 **MÉDIO**

**Problema**: Logs podem expor detalhes de infraestrutura.

**Risco**:
- Reconhecimento de tecnologia stack
- Versões de dependências
- Estrutura interna do sistema

**Solução Recomendada**:
- Remover stack traces em produção
- Sanitizar mensagens de erro
- Não expor detalhes técnicos em respostas de erro

---

### 8. **Falta de Validação de Tamanho de Payload** 🟡 **MÉDIO**

**Problema**: Limite de 2MB pode ser insuficiente ou excessivo.

**Risco**:
- Payloads muito grandes podem causar DoS
- Consumo excessivo de memória

**Solução Recomendada**:
- Validar tamanho apropriado para WhatsApp (geralmente < 100KB)
- Rejeitar payloads muito grandes antes do parsing
- Logar tentativas de payloads grandes

---

### 9. **Falta de Idempotência** 🟡 **MÉDIO**

**Problema**: Requisições duplicadas podem ser processadas múltiplas vezes.

**Risco**:
- Duplicação de mensagens no RabbitMQ
- Processamento duplicado downstream

**Solução Recomendada**:
- Validação de ID único do evento (WhatsApp envia `id` único)
- Cache de IDs processados (Redis com TTL)
- Deduplicação no RabbitMQ

---

### 10. **Falta de Monitoramento de Segurança** 🟡 **MÉDIO**

**Problema**: Não há alertas para atividades suspeitas.

**Risco**:
- Ataques podem passar despercebidos
- Sem visibilidade de tentativas de intrusão

**Solução Recomendada**:
- Alertas para múltiplas falhas de autenticação
- Alertas para rate limiting acionado
- Alertas para IPs não whitelisted
- Métricas de segurança (Prometheus/Grafana)

---

### 11. **Validação de Assinatura com Fallback Inseguro** 🟢 **BAIXO** (já corrigido)

**Status**: ✅ Já foi corrigido na versão atual - APP_SECRET separado de WEBHOOK_SECRET

---

### 12. **Falta de CORS Adequado** 🟢 **BAIXO**

**Problema**: Não há configuração de CORS (se houver acesso via browser).

**Risco**:
- Baixo risco pois é webhook (não há acesso browser esperado)

**Solução Recomendada**:
- Se não há acesso browser: desabilitar CORS explicitamente
- Se houver: configurar CORS restritivo

---

## 🛡️ Recomendações de Implementação

### Prioridade ALTA (Implementar Imediatamente)

1. **Mascarar dados sensíveis nos logs**
2. **Implementar rate limiting**
3. **Adicionar headers de segurança (helmet)**
4. **Validar IPs de origem (whitelist Meta)**

### Prioridade MÉDIA (Implementar em breve)

5. **Validação de payload com schema**
6. **Timeout em requisições**
7. **Deduplicação de eventos (idempotência)**
8. **Monitoramento de segurança**

### Prioridade BAIXA (Opcional)

9. **CORS adequado**
10. **Validação de tamanho de payload mais restritiva**

---

## 📦 Dependências Adicionais Recomendadas

```json
{
  "dependencies": {
    "helmet": "^7.1.0",              // Headers de segurança HTTP
    "express-rate-limit": "^7.1.5",  // Rate limiting
    "express-slow-down": "^2.0.1",   // Proteção slowloris
    "zod": "^3.22.4",                // Validação de schema (ou JSON Schema)
    "ioredis": "^5.3.2"              // Redis para rate limiting distribuído (opcional)
  }
}
```

---

## 🔧 Implementações Sugeridas

### 1. Rate Limiting

```javascript
import rateLimit from 'express-rate-limit';

const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requisições por IP por janela
  message: 'Muitas requisições deste IP, tente novamente mais tarde.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/webhook/whatsapp', webhookLimiter);
```

### 2. Headers de Segurança

```javascript
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: false, // Pode desabilitar se não há HTML
  hidePoweredBy: true,
}));
```

### 3. Validação de IP

```javascript
const META_IP_RANGES = [
  '2a03:2880::/32',  // IPv6 Meta
  // Adicionar ranges IPv4 conhecidos do Meta
];

function isValidMetaIP(ip) {
  // Implementar validação de CIDR
  return META_IP_RANGES.some(range => isIPInRange(ip, range));
}
```

### 4. Sanitização de Logs

```javascript
function sanitizeForLog(data) {
  const sanitized = { ...data };
  
  // Mascarar tokens
  if (sanitized.token) {
    sanitized.token = maskToken(sanitized.token);
  }
  
  // Remover campos sensíveis do body
  if (sanitized.body) {
    sanitized.body = sanitizeBody(sanitized.body);
  }
  
  return sanitized;
}

function maskToken(token) {
  if (!token || token.length < 8) return '***';
  return token.slice(-4).padStart(token.length, '*');
}
```

### 5. Validação de Schema

```javascript
import { z } from 'zod';

const WhatsAppWebhookSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(z.object({
    id: z.string(),
    changes: z.array(z.object({
      value: z.object({}),
      field: z.string(),
    })),
  })),
});

function validatePayload(payload) {
  return WhatsAppWebhookSchema.safeParse(payload);
}
```

---

## 📊 Matriz de Riscos

| Vulnerabilidade | Severidade | Probabilidade | Impacto | Prioridade |
|----------------|------------|---------------|---------|------------|
| Logs expõem secrets | 🔴 Crítica | Alta | Alto | **ALTA** |
| Falta rate limiting | 🔴 Crítica | Alta | Alto | **ALTA** |
| Falta validação IP | 🟠 Alta | Média | Alto | **ALTA** |
| Falta headers segurança | 🟠 Alta | Média | Médio | **ALTA** |
| Validação payload | 🟠 Alta | Média | Médio | **MÉDIA** |
| Falta timeout | 🟡 Média | Baixa | Médio | **MÉDIA** |
| Falta idempotência | 🟡 Média | Baixa | Baixo | **MÉDIA** |

---

## ✅ Checklist de Segurança

### Autenticação e Autorização
- [x] Validação de assinatura x-hub-signature-256
- [x] Validação de hub.verify_token (GET)
- [ ] Whitelist de IPs do Meta
- [ ] Validação de User-Agent

### Proteção contra Ataques
- [ ] Rate limiting implementado
- [ ] Timeout em requisições
- [ ] Headers de segurança HTTP
- [ ] Validação de tamanho de payload
- [ ] Proteção contra slowloris

### Logs e Monitoramento
- [ ] Dados sensíveis mascarados nos logs
- [ ] Alertas de segurança configurados
- [ ] Métricas de segurança coletadas
- [ ] Logs sanitizados para produção

### Validação de Dados
- [ ] Schema validation de payload
- [ ] Validação de estrutura esperada
- [ ] Sanitização de entrada

### Infraestrutura
- [ ] HTTPS obrigatório
- [ ] CORS configurado adequadamente
- [ ] Idempotência implementada
- [ ] Monitoramento ativo

---

## 🔍 Testes de Segurança Recomendados

1. **Teste de Rate Limiting**
   - Enviar 100+ requisições em sequência
   - Verificar se retorna 429 após limite

2. **Teste de Validação de IP**
   - Enviar requisição de IP não whitelisted
   - Verificar rejeição

3. **Teste de Assinatura Inválida**
   - Enviar requisição com assinatura falsa
   - Verificar rejeição 401

4. **Teste de Payload Malicioso**
   - Enviar payloads muito grandes
   - Enviar payloads com estrutura inválida
   - Verificar rejeição adequada

5. **Teste de Logs**
   - Verificar que secrets não aparecem em logs
   - Verificar sanitização de dados sensíveis

---

## 📚 Referências

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Meta Webhook Security](https://developers.facebook.com/docs/graph-api/webhooks/getting-started)
- [LGPD Compliance](https://www.gov.br/cidadania/pt-br/acesso-a-informacao/lgpd)

---

## 📝 Notas Finais

Esta análise identifica áreas de melhoria importantes. A implementação priorizada das recomendações de **Prioridade ALTA** reduzirá significativamente o risco de segurança.

**Recomendação**: Implementar pelo menos as 4 medidas de Prioridade ALTA antes de considerar o sistema seguro para produção em ambiente crítico.

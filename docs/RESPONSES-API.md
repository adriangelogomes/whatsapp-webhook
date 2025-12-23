# 📡 Respostas da API - Webhook WhatsApp

## 🔐 Autenticação (Middleware)

Antes de processar qualquer requisição, o webhook valida o Bearer Token.

### ❌ 401 Unauthorized - Token Ausente

**Request:**
```bash
curl -X POST https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"test":"ok"}'
```

**Response:**
```json
{
  "error": "Unauthorized",
  "message": "Token de autenticação não fornecido"
}
```
**Status Code:** `401`

---

### ❌ 401 Unauthorized - Formato Inválido

**Request:**
```bash
curl -X POST https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp \
  -H "Authorization: InvalidFormat token123" \
  -H "Content-Type: application/json" \
  -d '{"test":"ok"}'
```

**Response:**
```json
{
  "error": "Unauthorized",
  "message": "Formato de token inválido. Use: Authorization: Bearer TOKEN"
}
```
**Status Code:** `401`

---

### ❌ 401 Unauthorized - Token Inválido

**Request:**
```bash
curl -X POST https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp \
  -H "Authorization: Bearer token_errado" \
  -H "Content-Type: application/json" \
  -d '{"test":"ok"}'
```

**Response:**
```json
{
  "error": "Unauthorized",
  "message": "Token inválido"
}
```
**Status Code:** `401`

> ⚠️ **Importante**: Quando retorna 401, **NENHUMA mensagem é publicada no RabbitMQ**.

---

## ✅ Requisição Válida (Após Autenticação)

### ✅ 200 OK - Sucesso

**Request:**
```bash
curl -X POST https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp \
  -H "Authorization: Bearer super_secret_whatsapp_token_123" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message",
    "from": "5511999999999",
    "to": "5511888888888",
    "body": "Olá, mundo!",
    "timestamp": "2025-12-22T21:00:00Z"
  }'
```

**Response:**
```
(Empty body)
```
**Status Code:** `200`

> ✅ **Mensagem publicada no RabbitMQ com sucesso!**

---

### ❌ 400 Bad Request - Payload Inválido

**Request:**
```bash
curl -X POST https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp \
  -H "Authorization: Bearer super_secret_whatsapp_token_123" \
  -H "Content-Type: application/json" \
  -d '"string_invalida"'
```

**Response:**
```json
{
  "error": "Payload inválido",
  "message": "Payload deve ser um objeto JSON"
}
```
**Status Code:** `400`

> ⚠️ **Nenhuma mensagem é publicada no RabbitMQ**.

---

### ❌ 503 Service Unavailable - RabbitMQ Desconectado

**Request:**
```bash
curl -X POST https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp \
  -H "Authorization: Bearer super_secret_whatsapp_token_123" \
  -H "Content-Type: application/json" \
  -d '{"test":"ok"}'
```

**Response:**
```json
{
  "error": "RabbitMQ indisponível",
  "message": "Serviço temporariamente indisponível"
}
```
**Status Code:** `503`

**Quando ocorre:**
- RabbitMQ não está conectado
- Conexão foi perdida e está tentando reconectar
- Retry automático está ativo

> ⚠️ **Nenhuma mensagem é publicada no RabbitMQ**.

---

### ❌ 503 Service Unavailable - Buffer Cheio

**Request:**
```bash
curl -X POST https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp \
  -H "Authorization: Bearer super_secret_whatsapp_token_123" \
  -H "Content-Type: application/json" \
  -d '{"test":"ok"}'
```

**Response:**
```json
{
  "error": "Falha ao enfileirar",
  "message": "RabbitMQ temporariamente indisponível"
}
```
**Status Code:** `503`

**Quando ocorre:**
- Buffer do RabbitMQ está cheio
- RabbitMQ não consegue aceitar mais mensagens no momento

> ⚠️ **Nenhuma mensagem é publicada no RabbitMQ**.

---

### ❌ 500 Internal Server Error - Erro Interno

**Request:**
```bash
curl -X POST https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp \
  -H "Authorization: Bearer super_secret_whatsapp_token_123" \
  -H "Content-Type: application/json" \
  -d '{"test":"ok"}'
```

**Response:**
```json
{
  "error": "Erro interno",
  "message": "Falha ao processar webhook"
}
```
**Status Code:** `500`

**Quando ocorre:**
- Erro inesperado no processamento
- Exceção não tratada (exceto erros de conexão que são silenciosos)

> ⚠️ **Nenhuma mensagem é publicada no RabbitMQ**.

---

## 📊 Resumo dos Status Codes

| Status | Significado | Mensagem Publicada? |
|--------|------------|---------------------|
| `200` | ✅ Sucesso | ✅ **SIM** |
| `401` | ❌ Token inválido/ausente | ❌ **NÃO** |
| `400` | ❌ Payload inválido | ❌ **NÃO** |
| `503` | ❌ RabbitMQ indisponível | ❌ **NÃO** |
| `500` | ❌ Erro interno | ❌ **NÃO** |

---

## 🔄 Fluxo de Validação

```
1. Requisição recebida
   ↓
2. Valida Bearer Token
   ├─ Token ausente/inválido → 401 (STOP)
   └─ Token válido → Continua
   ↓
3. Valida RabbitMQ conectado
   ├─ Desconectado → 503 (STOP)
   └─ Conectado → Continua
   ↓
4. Valida Payload
   ├─ Inválido → 400 (STOP)
   └─ Válido → Continua
   ↓
5. Publica no RabbitMQ
   ├─ Falha (buffer cheio) → 503 (STOP)
   ├─ Erro → 500 (STOP)
   └─ Sucesso → 200 ✅
```

---

## 📝 Exemplos Práticos

### Exemplo 1: Requisição Completa e Válida

```bash
curl -X POST https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp \
  -H "Authorization: Bearer super_secret_whatsapp_token_123" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message.received",
    "message": {
      "id": "msg_123",
      "from": "5511999999999",
      "to": "5511888888888",
      "body": "Olá!",
      "timestamp": "2025-12-22T21:00:00Z"
    }
  }'
```

**Response:**
```
HTTP/1.1 200 OK
Content-Length: 0
```

✅ **Mensagem enfileirada no RabbitMQ!**

---

### Exemplo 2: Sem Token

```bash
curl -X POST https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"test":"ok"}'
```

**Response:**
```json
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "error": "Unauthorized",
  "message": "Token de autenticação não fornecido"
}
```

❌ **Nada publicado no RabbitMQ**

---

### Exemplo 3: Payload Inválido

```bash
curl -X POST https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp \
  -H "Authorization: Bearer super_secret_whatsapp_token_123" \
  -H "Content-Type: application/json" \
  -d 'null'
```

**Response:**
```json
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": "Payload inválido",
  "message": "Payload deve ser um objeto JSON"
}
```

❌ **Nada publicado no RabbitMQ**

---

## 🎯 Para n8n

Quando configurar o n8n HTTP Request node:

1. **Success Response**: Status `200` (corpo vazio)
2. **Error Responses**: 
   - `401` - Token inválido (verifique `WEBHOOK_SECRET`)
   - `400` - Payload inválido (verifique formato JSON)
   - `503` - RabbitMQ offline (aguarde reconexão automática)
   - `500` - Erro interno (verifique logs)

**Configuração recomendada n8n:**
- **Response Format**: JSON
- **Options** → **Ignore SSL Issues**: `true` (se necessário)
- **Headers**:
  - `Authorization: Bearer ${WEBHOOK_SECRET}`
  - `Content-Type: application/json`


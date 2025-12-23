# WhatsApp Webhook → RabbitMQ

Webhook HTTP que recebe eventos do WhatsApp e publica no RabbitMQ para processamento assíncrono.

## 🚀 Características

- **Stateless**: Escala horizontal sem estado compartilhado
- **Alta disponibilidade**: Reconexão automática ao RabbitMQ com retry inteligente
- **Validação**: Validação de payload e variáveis de ambiente
- **Produção-ready**: Dockerfile otimizado, tratamento de erros robusto
- **Healthcheck REAL**: Endpoint que retorna 503 quando RabbitMQ desconectado (Cloudflare-friendly)
- **Logs limpos**: Sem erros "feios" em produção, retry silencioso
- **Load Balancer ready**: Healthcheck permite remoção automática de instâncias ruins
- **Logging completo**: Logs estruturados em JSON de todas as requisições, erros e payloads

## 📋 Pré-requisitos

- Node.js 20+
- Docker (para produção)
- RabbitMQ acessível

## 🛠️ Instalação

```bash
npm install
```

## ⚙️ Configuração

### Variáveis de Ambiente

| Variável | Descrição | Obrigatória | Padrão |
|----------|-----------|-------------|--------|
| `PORT` | Porta do servidor HTTP | Não | `3000` |
| `RABBIT_URL` | URL de conexão RabbitMQ | **Sim** | - |
| `WEBHOOK_SECRET` | Token secreto para autenticação | **Sim** | - |
| `RABBIT_EXCHANGE` | Nome do exchange | Não | `whatsapp.events` |
| `RABBIT_QUEUE` | Nome da queue | Não | `whatsapp.incoming` |
| `RABBIT_ROUTING_KEY` | Routing key | Não | `whatsapp.incoming` |

### Exemplo de Variáveis

```env
RABBIT_URL=amqp://usuario:senha@rabbitmq:5672/whatsapp
WEBHOOK_SECRET=super_secret_whatsapp_token_123
```

> ⚠️ **Importante**: `WEBHOOK_SECRET` nunca deve ser versionado no código. Use apenas variáveis de ambiente.

## 🐳 Docker

### Build

```bash
docker build -t whatsapp-webhook .
```

### Run

```bash
docker run -d \
  -p 3000:3000 \
  -e RABBIT_URL=amqp://usuario:senha@rabbitmq:5672/whatsapp \
  -e WEBHOOK_SECRET=super_secret_whatsapp_token_123 \
  -e RABBIT_EXCHANGE=whatsapp.events \
  -e RABBIT_QUEUE=whatsapp.incoming \
  -e RABBIT_ROUTING_KEY=whatsapp.incoming \
  whatsapp-webhook
```

## 📡 Endpoints

### POST /webhook/whatsapp

Recebe eventos do WhatsApp e publica no RabbitMQ.

**Autenticação obrigatória:**
```
Authorization: Bearer WEBHOOK_SECRET
```

**Request Headers:**
```
Authorization: Bearer super_secret_whatsapp_token_123
Content-Type: application/json
```

**Request Body:**
```json
{
  "event": "message",
  "data": { ... }
}
```

**Response:**
- `200` - Evento enfileirado com sucesso
- `401` - Token inválido ou ausente (não publica nada)
- `400` - Payload inválido
- `503` - RabbitMQ indisponível
- `500` - Erro interno

**Exemplo com cURL:**
```bash
curl -X POST https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp \
  -H "Authorization: Bearer super_secret_whatsapp_token_123" \
  -H "Content-Type: application/json" \
  -d '{"event": "message", "data": {}}'
```

### GET /health

Healthcheck REAL do serviço (Cloudflare-friendly).

**Response 200 (OK):**
```json
{
  "status": "ok",
  "rabbitmq": "connected",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Response 503 (RabbitMQ desconectado):**
```json
{
  "status": "rabbit_disconnected",
  "rabbitmq": "disconnected",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

> ⚠️ **Importante**: Retorna 503 quando RabbitMQ está desconectado para:
> - Cloudflare detectar falha automaticamente
> - Load Balancer remover instâncias ruins
> - Monitoramento alertar corretamente

## 🔄 Fluxo de Produção

```
WhatsApp API
   ↓
Cloudflare (DNS + HTTPS)
   ↓
whatsapp.api.sofiainsights.com.br
   ↓
Webhook (Node.js)
   ↓
RabbitMQ (durável)
   ↓
n8n / workers / microserviços
```

## 🏗️ Arquitetura

- **Express.js**: Servidor HTTP
- **amqplib**: Cliente RabbitMQ
- **Docker**: Containerização para produção
- **Stateless**: Cada instância é independente

## 🔒 Segurança

- Validação de payload
- Tratamento de erros sem expor detalhes internos
- Usuário não-root no Docker
- Variáveis de ambiente para credenciais

## 📝 Logs

O serviço registra:
- Conexões/desconexões RabbitMQ
- Erros de processamento
- Status de publicação

## 🚨 Troubleshooting

### RabbitMQ não conecta

1. Verifique se `RABBIT_URL` está correto
2. Confirme que o RabbitMQ está acessível
3. Verifique logs: `docker logs <container-id>`

### Mensagens não são enfileiradas

1. Verifique o healthcheck: `GET /health`
2. Confirme que o exchange/queue existem
3. Verifique permissões do usuário RabbitMQ

## 📄 Licença

Proprietário - Sofiainsights


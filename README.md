# WhatsApp Webhook → RabbitMQ

Webhook HTTP que recebe eventos do WhatsApp e publica no RabbitMQ para processamento assíncrono.

## 🚀 Características

- **Stateless**: Escala horizontal sem estado compartilhado
- **Alta disponibilidade**: Reconexão automática ao RabbitMQ
- **Validação**: Validação de payload e variáveis de ambiente
- **Produção-ready**: Dockerfile otimizado, tratamento de erros robusto
- **Healthcheck**: Endpoint de monitoramento com status do RabbitMQ

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
| `RABBIT_EXCHANGE` | Nome do exchange | Não | `whatsapp.events` |
| `RABBIT_QUEUE` | Nome da queue | Não | `whatsapp.incoming` |
| `RABBIT_ROUTING_KEY` | Routing key | Não | `whatsapp.incoming` |

### Exemplo de RABBIT_URL

```
amqp://usuario:senha@rabbitmq:5672/whatsapp
```

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
  -e RABBIT_EXCHANGE=whatsapp.events \
  -e RABBIT_QUEUE=whatsapp.incoming \
  -e RABBIT_ROUTING_KEY=whatsapp.incoming \
  whatsapp-webhook
```

## 📡 Endpoints

### POST /webhook/whatsapp

Recebe eventos do WhatsApp e publica no RabbitMQ.

**Request:**
```json
{
  "event": "message",
  "data": { ... }
}
```

**Response:**
- `200` - Evento enfileirado com sucesso
- `400` - Payload inválido
- `503` - RabbitMQ indisponível
- `500` - Erro interno

### GET /health

Healthcheck do serviço.

**Response:**
```json
{
  "status": "ok",
  "rabbitmq": "connected",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

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


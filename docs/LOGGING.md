# 📊 Sistema de Logging

O webhook implementa um sistema completo de logging estruturado em JSON para facilitar análise, debug e monitoramento.

## 🎯 O que é Logado

### ✅ Requisições HTTP
- **Todas as requisições** recebidas (método, path, IP, status code)
- **Tempo de resposta** de cada requisição
- **Headers relevantes** (User-Agent, Content-Type, Content-Length)
- **Status code** de resposta

### 📦 Payloads Recebidos
- **Dados completos** do payload (até 2000 caracteres)
- **Tamanho do payload**
- **Chaves do objeto** para análise rápida
- **Preview truncado** se muito grande

### 🔐 Autenticação
- **Requisições sem token** (401)
- **Tokens inválidos** (401)
- **Formato de token incorreto** (401)
- **Autenticações bem-sucedidas**

### ❌ Erros
- **Erros detalhados** com stack trace
- **Código de erro** e tipo
- **Contexto da requisição** quando ocorreu
- **Payload que causou o erro**

### 🐰 RabbitMQ
- **Conexões** e reconexões
- **Falhas de publicação**
- **Buffer cheio**
- **Desconexões**

## 📋 Formato dos Logs

Todos os logs são em **JSON estruturado** para facilitar parsing:

```json
{
  "timestamp": "2025-12-22T21:00:00.000Z",
  "level": "INFO",
  "message": "Mensagem publicada no RabbitMQ com sucesso",
  "requestId": "req_1734900000_abc123",
  "exchange": "whatsapp.events",
  "routingKey": "whatsapp.incoming",
  "queue": "whatsapp.incoming",
  "messageSize": 245,
  "processingTime": "12ms",
  "payloadKeys": ["event", "data", "timestamp"]
}
```

## 🔍 Níveis de Log

| Nível | Quando Usado | Exemplo |
|-------|-------------|---------|
| `INFO` | Operações normais | Requisição recebida, mensagem publicada |
| `WARN` | Situações anômalas mas não críticas | Token inválido, payload inválido, retry |
| `ERROR` | Erros que impedem operação | Falha ao publicar, RabbitMQ offline, exceções |

## 📝 Exemplos de Logs

### 1. Requisição Válida e Bem-Sucedida

```json
{
  "timestamp": "2025-12-22T21:00:00.000Z",
  "level": "INFO",
  "message": "HTTP POST /webhook/whatsapp - 200",
  "method": "POST",
  "path": "/webhook/whatsapp",
  "ip": "192.168.1.100",
  "userAgent": "curl/7.68.0",
  "statusCode": 200,
  "responseTime": "15ms",
  "hasAuth": true,
  "contentType": "application/json",
  "contentLength": "245"
}
```

```json
{
  "timestamp": "2025-12-22T21:00:00.015Z",
  "level": "INFO",
  "message": "Payload recebido",
  "payloadSize": 245,
  "payloadPreview": "{\"event\":\"message\",\"data\":{\"from\":\"5511999999999\",\"body\":\"Olá!\"}}",
  "payloadKeys": ["event", "data"]
}
```

```json
{
  "timestamp": "2025-12-22T21:00:00.020Z",
  "level": "INFO",
  "message": "Mensagem publicada no RabbitMQ com sucesso",
  "requestId": "req_1734900000_abc123",
  "exchange": "whatsapp.events",
  "routingKey": "whatsapp.incoming",
  "queue": "whatsapp.incoming",
  "messageSize": 245,
  "processingTime": "20ms",
  "payloadKeys": ["event", "data"],
  "payloadSize": 245
}
```

### 2. Requisição com Token Inválido

```json
{
  "timestamp": "2025-12-22T21:00:05.000Z",
  "level": "WARN",
  "message": "Token inválido recebido",
  "ip": "192.168.1.100",
  "path": "/webhook/whatsapp",
  "tokenLength": 20,
  "tokenPrefix": "wron***",
  "userAgent": "curl/7.68.0"
}
```

```json
{
  "timestamp": "2025-12-22T21:00:05.001Z",
  "level": "INFO",
  "message": "HTTP POST /webhook/whatsapp - 401",
  "method": "POST",
  "path": "/webhook/whatsapp",
  "ip": "192.168.1.100",
  "statusCode": 401,
  "responseTime": "1ms"
}
```

### 3. Payload Inválido

```json
{
  "timestamp": "2025-12-22T21:00:10.000Z",
  "level": "WARN",
  "message": "Payload inválido recebido",
  "requestId": "req_1734900010_def456",
  "payloadType": "string",
  "payloadValue": "invalid_string",
  "payloadString": "\"invalid_string\""
}
```

### 4. Erro ao Publicar no RabbitMQ

```json
{
  "timestamp": "2025-12-22T21:00:15.000Z",
  "level": "ERROR",
  "message": "Falha ao publicar no RabbitMQ (buffer cheio)",
  "requestId": "req_1734900015_ghi789",
  "exchange": "whatsapp.events",
  "routingKey": "whatsapp.incoming",
  "messageSize": 245,
  "payloadKeys": ["event", "data"]
}
```

### 5. Erro Interno

```json
{
  "timestamp": "2025-12-22T21:00:20.000Z",
  "level": "ERROR",
  "message": "Erro ao processar webhook",
  "requestId": "req_1734900020_jkl012",
  "processingTime": "5ms",
  "ip": "192.168.1.100",
  "path": "/webhook/whatsapp",
  "method": "POST",
  "payloadKeys": ["event"],
  "payloadPreview": "{\"event\":\"message\"}",
  "error": {
    "message": "Cannot read property 'x' of undefined",
    "stack": "Error: Cannot read property 'x' of undefined\n    at ...",
    "code": undefined,
    "name": "TypeError"
  }
}
```

### 6. RabbitMQ Desconectado

```json
{
  "timestamp": "2025-12-22T21:00:25.000Z",
  "level": "WARN",
  "message": "Conexão RabbitMQ fechada, iniciando reconexão",
  "exchange": "whatsapp.events",
  "queue": "whatsapp.incoming"
}
```

```json
{
  "timestamp": "2025-12-22T21:00:30.000Z",
  "level": "INFO",
  "message": "RabbitMQ reconectado",
  "retryCount": 3,
  "exchange": "whatsapp.events",
  "queue": "whatsapp.incoming"
}
```

## 🔧 Como Usar os Logs

### 1. Visualização em Tempo Real

```bash
# Docker logs
docker logs -f whatsapp-webhook

# Filtrar apenas erros
docker logs whatsapp-webhook | grep '"level":"ERROR"'

# Filtrar requisições
docker logs whatsapp-webhook | grep '"message":"HTTP'
```

### 2. Análise com jq (JSON Parser)

```bash
# Todas as requisições 401
docker logs whatsapp-webhook | jq 'select(.statusCode == 401)'

# Erros nos últimos 10 minutos
docker logs whatsapp-webhook | jq 'select(.level == "ERROR" and .timestamp > "2025-12-22T21:00:00Z")'

# Payloads recebidos
docker logs whatsapp-webhook | jq 'select(.message == "Payload recebido")'
```

### 3. Integração com Sistemas de Log

Os logs em JSON podem ser facilmente integrados com:
- **ELK Stack** (Elasticsearch, Logstash, Kibana)
- **CloudWatch** (AWS)
- **Datadog**
- **Splunk**
- **Grafana Loki**

### 4. Monitoramento

Configure alertas baseados em:
- `level: "ERROR"` → Alertar imediatamente
- `statusCode: 401` → Possível ataque ou token vazado
- `statusCode: 503` → RabbitMQ offline
- `responseTime > 1000ms` → Performance degradada

## 🔒 Segurança dos Logs

### Dados Sensíveis

- **Tokens**: Apenas prefixo (primeiros 4 caracteres) é logado
- **Payloads**: Limitados a 2000 caracteres (configurável)
- **IPs**: Logados para análise de segurança

### Recomendações

1. **Não logar** dados sensíveis completos (senhas, tokens completos)
2. **Rotacionar logs** regularmente
3. **Restringir acesso** aos logs em produção
4. **Monitorar** tentativas de acesso não autorizado

## 📊 Métricas que Podem ser Extraídas

- **Taxa de requisições** por minuto/hora
- **Taxa de erros** (401, 400, 500, 503)
- **Tempo médio de resposta**
- **Tamanho médio de payload**
- **Requisições por IP** (detectar abuso)
- **Taxa de sucesso** de publicação no RabbitMQ

## 🎯 Request ID

Cada requisição recebe um **Request ID único** (`req_timestamp_random`) que permite rastrear:
- Requisição → Payload → Publicação → Erro (se houver)

Use o Request ID para correlacionar logs da mesma requisição.


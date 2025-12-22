# ✅ Checklist de Setup Produção

## 🔧 Configuração RabbitMQ

### Obrigatório

- [ ] **Volume persistente** configurado no RabbitMQ
- [ ] **RABBITMQ_NODENAME** fixo (ex: `rabbit@rabbitmq`)
- [ ] **Vhost `whatsapp`** criado
- [ ] **Usuário `sofiafila`** criado com permissões admin no vhost `whatsapp`
- [ ] **Exchange `whatsapp.events`** criado (tipo: `topic`, durável)
- [ ] **Queue `whatsapp.incoming`** criada (durável)
- [ ] **Binding** configurado: `whatsapp.incoming` → `whatsapp.events` (routing key: `whatsapp.incoming`)

### Variáveis de Ambiente (EasyPanel)

```env
PORT=3000
RABBIT_URL=amqp://sofiafila:SENHA@rabbitmq:5672/whatsapp
WEBHOOK_SECRET=super_secret_whatsapp_token_123
RABBIT_EXCHANGE=whatsapp.events
RABBIT_QUEUE=whatsapp.incoming
RABBIT_ROUTING_KEY=whatsapp.incoming
```

> ⚠️ **Segurança**: `WEBHOOK_SECRET` nunca deve ser versionado no código. Use apenas variáveis de ambiente.

> ⚠️ **Importante**: `rabbitmq` é o nome do serviço no EasyPanel (DNS interno)

## 🐳 Docker / EasyPanel

- [ ] **Dockerfile** otimizado (multi-stage se necessário)
- [ ] **Usuário não-root** no container
- [ ] **Healthcheck** configurado no EasyPanel apontando para `/health`
- [ ] **Porta interna** 3000 exposta
- [ ] **Domínio** configurado: `whatsapp.api.sofiainsights.com.br`
- [ ] **HTTPS** habilitado (Cloudflare)

## 🔄 Arquitetura

- [ ] **Webhook desacoplado** do n8n (não depende diretamente)
- [ ] **RabbitMQ como buffer** entre webhook e processadores
- [ ] **Múltiplas instâncias** podem rodar simultaneamente (stateless)
- [ ] **Retry automático** configurado (sem logs sujos)

## 📊 Monitoramento

- [ ] **Healthcheck** retorna 503 quando RabbitMQ desconectado
- [ ] **Cloudflare** monitora `/health` endpoint
- [ ] **Load Balancer** remove instâncias com 503
- [ ] **Logs limpos** em produção (sem erros de conexão repetidos)

## 🧪 Testes

- [ ] **Autenticação** funciona (Bearer Token válido → 200, inválido → 401)
- [ ] **Webhook recebe** eventos do WhatsApp com token válido
- [ ] **Mensagens publicadas** no RabbitMQ apenas com token válido
- [ ] **Token inválido** não publica nada (retorna 401)
- [ ] **Reconexão automática** funciona após queda do RabbitMQ
- [ ] **Healthcheck** retorna status correto
- [ ] **Múltiplas instâncias** funcionam em paralelo

## 🔒 Segurança

- [ ] **WEBHOOK_SECRET** configurado (token secreto para autenticação)
- [ ] **Bearer Token** validado em todas as requisições
- [ ] **Credenciais** em variáveis de ambiente (não hardcoded)
- [ ] **Validação de payload** ativa
- [ ] **Rate limiting** (se necessário via Cloudflare)
- [ ] **HTTPS** obrigatório
- [ ] **401 Unauthorized** retornado para tokens inválidos (não publica nada)

## 📝 Fluxo Final

```
WhatsApp API
   ↓
Cloudflare (DNS + HTTPS)
   ↓
whatsapp.api.sofiainsights.com.br
   ↓
Webhook (Node.js) - Múltiplas instâncias
   ↓
RabbitMQ (durável, persistente)
   ↓
n8n / Workers / Microserviços
```

## 🚨 Troubleshooting

### RabbitMQ não conecta

1. Verifique `RABBIT_URL` (formato: `amqp://usuario:senha@host:porta/vhost`)
2. Confirme que o serviço `rabbitmq` está rodando no EasyPanel
3. Verifique permissões do usuário no vhost
4. Confira logs: `docker logs <container-id>`

### Healthcheck retorna 503

- Normal durante inicialização (retry está ativo)
- Se persistir: verifique conexão RabbitMQ
- Confirme que exchange/queue existem

### Mensagens não são enfileiradas

1. Verifique healthcheck: `GET /health`
2. Confirme que exchange/queue estão criados
3. Verifique permissões do usuário RabbitMQ
4. Confira logs do container


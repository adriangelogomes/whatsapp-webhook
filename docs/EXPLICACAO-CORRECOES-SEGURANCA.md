# 🔐 Explicação Detalhada das Correções de Segurança Críticas

## 📋 Visão Geral

Este documento explica **detalhadamente** como funcionará cada correção crítica de segurança antes da implementação.

---

## 1. 🛡️ MASCARAMENTO DE DADOS SENSÍVEIS NOS LOGS

### Como Funciona

**Problema Atual:**
- Logs expõem tokens completos: `WEBHOOK_SECRET`, `APP_SECRET`, tokens recebidos
- Body completo com dados pessoais de mensagens WhatsApp
- Headers completos com informações sensíveis

**Solução:**

#### 1.1. Mascaramento de Tokens

**Antes:**
```json
{
  "tokenReceived": "super_secret_token_123456789",
  "webhookSecret": "super_secret_token_123456789",
  "appSecret": "chave_secreta_do_aplicativo_987654321"
}
```

**Depois:**
```json
{
  "tokenReceived": "*************************6789",
  "webhookSecret": "*************************6789",
  "appSecret": "*********************************4321"
}
```

**Regra de Mascaramento:**
- Se token tem menos de 8 caracteres: `***`
- Se token tem 8+ caracteres: Mostra apenas últimos 4 caracteres
- Exemplo: `super_secret_token_123456789` → `*************************6789`

#### 1.2. Sanitização do Body

**Campos que serão removidos/truncados:**
- `messages[].text.body` → Truncado para 50 caracteres
- `contacts[].profile.name` → Mantido (não é tão sensível)
- `contacts[].wa_id` → Mascarado (últimos 4 dígitos)
- `metadata.phone_number_id` → Mascarado
- `metadata.display_phone_number` → Mascarado

**Exemplo:**

**Antes:**
```json
{
  "body": {
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "text": {
              "body": "Esta é uma mensagem muito longa com informações sensíveis que não deveriam aparecer nos logs completos"
            }
          }],
          "contacts": [{
            "wa_id": "558294120845",
            "profile": {
              "name": "João Silva"
            }
          }]
        }
      }]
    }]
  }
}
```

**Depois:**
```json
{
  "body": {
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "text": {
              "body": "Esta é uma mensagem muito longa com informações sens... [TRUNCATED]"
            }
          }],
          "contacts": [{
            "wa_id": "********0845",
            "profile": {
              "name": "João Silva"
            }
          }]
        }
      }]
    }]
  }
}
```

#### 1.3. Níveis de Log

**Variável de Ambiente:**
```env
LOG_LEVEL=production  # ou "debug"
```

**Comportamento:**
- `LOG_LEVEL=production`: Logs sanitizados (padrão)
- `LOG_LEVEL=debug`: Logs completos (apenas para desenvolvimento)

---

## 2. 🚦 RATE LIMITING (Limitação de Taxa de Requisições)

### Como Funciona

**Problema Atual:**
- Sem limite de requisições por IP
- Vulnerável a DDoS e brute force

**Solução:**

### 2.1. Limites Configurados

**Para GET /webhook/whatsapp** (validação inicial do Meta):
- **Janela:** 15 minutos
- **Máximo:** 10 requisições por IP
- **Motivo:** Meta faz apenas 1-2 tentativas, mas queremos margem de segurança

**Para POST /webhook/whatsapp** (eventos do WhatsApp):
- **Janela:** 1 minuto
- **Máximo:** 100 requisições por IP
- **Motivo:** WhatsApp pode enviar muitos eventos em picos (múltiplas mensagens)

**Para outras rotas** (ex: /health):
- **Janela:** 1 minuto
- **Máximo:** 60 requisições por IP

### 2.2. Como Funciona Tecnicamente

**Biblioteca:** `express-rate-limit`

**Exemplo de Funcionamento:**

```
Tempo: 10:00:00
IP: 192.168.1.1 faz requisição 1 → ✅ Permitido (1/100)
IP: 192.168.1.1 faz requisição 2 → ✅ Permitido (2/100)
...
IP: 192.168.1.1 faz requisição 100 → ✅ Permitido (100/100)
IP: 192.168.1.1 faz requisição 101 → ❌ Bloqueado (429 Too Many Requests)

Tempo: 10:01:00 (janela reinicia)
IP: 192.168.1.1 faz requisição 1 → ✅ Permitido (1/100) - contador resetou
```

### 2.3. Resposta quando Exceder Limite

**Status Code:** `429 Too Many Requests`

**Headers Retornados:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1633024800 (timestamp Unix)
Retry-After: 60 (segundos até poder tentar novamente)
```

**Body:**
```json
{
  "error": "Too Many Requests",
  "message": "Muitas requisições deste IP, tente novamente mais tarde.",
  "retryAfter": 60
}
```

### 2.4. Whitelist para IPs do Meta

**IPs do Meta serão isentos de rate limiting:**
- Se o IP estiver na whitelist do Meta → Sem limite
- Se não estiver → Aplica rate limiting normal

**Configuração:**
```env
META_IP_WHITELIST_ENABLED=true  # Ativa whitelist
```

---

## 3. 🌐 VALIDAÇÃO DE IP DE ORIGEM (Whitelist Meta)

### Como Funciona

**Problema Atual:**
- Aceita requisições de qualquer IP
- Não valida se realmente vem do Meta/Facebook

**Solução:**

### 3.1. IPs Conhecidos do Meta/Facebook

**IPv6 (Principal):**
- `2a03:2880::/32` - Range principal do Meta
- `2620:0:1c00::/40` - Range adicional

**IPv4 (Ranges conhecidos - podem mudar):**
- `31.13.24.0/21`
- `31.13.64.0/18`
- `66.220.144.0/20`
- `69.63.176.0/20`
- `69.171.224.0/19`
- `74.119.76.0/22`
- `103.4.96.0/22`
- `157.240.0.0/16`
- `173.252.64.0/18`
- `179.60.192.0/22`
- `185.60.216.0/22`
- `204.15.20.0/22`

**⚠️ IMPORTANTE:** Esta lista precisa ser atualizada periodicamente. Meta pode adicionar novos ranges.

### 3.2. Como Funciona a Validação

**Passo a Passo:**

1. **Extrair IP Real:**
   ```javascript
   // Considera proxies (Cloudflare, etc)
   const clientIp = req.headers['cf-connecting-ip'] ||  // Cloudflare
                    req.headers['x-real-ip'] ||         // Nginx
                    req.headers['x-forwarded-for']?.split(',')[0] ||  // Proxy genérico
                    req.ip ||                           // Express
                    req.connection.remoteAddress;      // Fallback
   ```

2. **Validar se IP está na whitelist:**
   ```javascript
   function isValidMetaIP(ip) {
     // Verifica se IP está em algum range CIDR do Meta
     return META_IP_RANGES.some(range => isIPInCIDR(ip, range));
   }
   ```

3. **Comportamento:**
   - Se IP válido → Continua processamento
   - Se IP inválido → Retorna `403 Forbidden`

### 3.3. Validação em Camadas

**Camada 1: IP**
- ✅ IP está na whitelist do Meta?

**Camada 2: User-Agent**
- ✅ User-Agent é `facebookexternalua`?

**Camada 3: Assinatura**
- ✅ Header `x-hub-signature-256` válido?

**Todas as 3 camadas devem passar para aceitar requisição.**

### 3.4. Modo de Desenvolvimento

**Variável de Ambiente:**
```env
META_IP_VALIDATION_ENABLED=true  # true = validação ativa, false = desabilitada
```

**Comportamento:**
- `true`: Valida IP (produção)
- `false`: Ignora validação de IP (desenvolvimento/testes locais)

### 3.5. Logs de IPs Inválidos

**Quando IP inválido:**
```json
{
  "level": "WARN",
  "message": "Requisição rejeitada: IP não está na whitelist do Meta",
  "ip": "192.168.1.100",
  "userAgent": "facebookexternalua",
  "path": "/webhook/whatsapp",
  "action": "blocked"
}
```

---

## 4. 🔒 HEADERS DE SEGURANÇA HTTP

### Como Funciona

**Problema Atual:**
- Sem headers de segurança HTTP
- Exposição de versão do servidor
- Vulnerável a XSS, clickjacking, etc.

**Solução:**

### 4.1. Headers que Serão Adicionados

**Biblioteca:** `helmet`

**Headers Configurados:**

#### `X-Content-Type-Options: nosniff`
- **O que faz:** Impede que navegadores "adivinhem" o tipo MIME
- **Proteção:** Contra MIME type sniffing attacks
- **Exemplo:** Arquivo `.txt` com código JavaScript não será executado

#### `X-Frame-Options: DENY`
- **O que faz:** Impede que página seja exibida em iframe
- **Proteção:** Contra clickjacking
- **Exemplo:** Atacante não pode embutir sua página em iframe malicioso

#### `X-XSS-Protection: 0`
- **O que faz:** Desabilita proteção XSS antiga do navegador (já obsoleta)
- **Motivo:** Proteção moderna é feita via CSP (Content Security Policy)

#### `Strict-Transport-Security` (HSTS)
- **O que faz:** Força navegador a usar sempre HTTPS
- **Proteção:** Contra downgrade attacks
- **Configuração:** `max-age=31536000; includeSubDomains`

#### Remover `X-Powered-By: Express`
- **O que faz:** Remove header que expõe tecnologia
- **Proteção:** Não expõe que está usando Express.js

### 4.2. Configuração do Helmet

```javascript
app.use(helmet({
  contentSecurityPolicy: false,  // Desabilitado (não há HTML)
  hidePoweredBy: true,            // Remove X-Powered-By
  hsts: {
    maxAge: 31536000,             // 1 ano
    includeSubDomains: true,
    preload: true
  },
  frameguard: {
    action: 'deny'                // X-Frame-Options: DENY
  },
  noSniff: true,                  // X-Content-Type-Options: nosniff
  xssFilter: false                // Desabilitado (obsoleto)
}));
```

### 4.3. Headers Adicionais Customizados

**Adicionaremos também:**

```
X-Request-ID: req_1234567890_abc123  # ID único da requisição (já existe)
Server: (removido)                    # Não expor servidor
```

---

## 5. 📊 RESUMO DAS CONFIGURAÇÕES

### Variáveis de Ambiente Adicionais

```env
# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_GET_MAX=10          # GET /webhook/whatsapp
RATE_LIMIT_GET_WINDOW_MS=900000 # 15 minutos
RATE_LIMIT_POST_MAX=100        # POST /webhook/whatsapp
RATE_LIMIT_POST_WINDOW_MS=60000 # 1 minuto

# Validação de IP
META_IP_VALIDATION_ENABLED=true
META_IP_WHITELIST_ENABLED=true

# Logs
LOG_LEVEL=production            # production ou debug
LOG_SANITIZE_ENABLED=true
```

### Fluxo Completo de Validação

```
Requisição Chega
    ↓
1. Rate Limiting
    ↓ (se passar)
2. Validação de IP (se habilitado)
    ↓ (se passar)
3. Validação de User-Agent
    ↓ (se passar)
4. Validação de Assinatura (x-hub-signature-256)
    ↓ (se passar)
5. Processamento Normal
```

### Exemplo de Requisição Bloqueada

**Cenário:** IP não está na whitelist do Meta

**Resposta:**
```http
HTTP/1.1 403 Forbidden
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=31536000; includeSubDomains

{
  "error": "Forbidden",
  "message": "IP de origem não autorizado",
  "code": "IP_NOT_WHITELISTED"
}
```

**Log:**
```json
{
  "level": "WARN",
  "message": "Requisição bloqueada: IP não autorizado",
  "ip": "192.168.1.100",
  "path": "/webhook/whatsapp",
  "action": "blocked",
  "reason": "ip_not_whitelisted"
}
```

---

## 6. ⚙️ CONFIGURAÇÃO RECOMENDADA PARA PRODUÇÃO

### Valores Padrão (Seguros)

```env
# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_GET_MAX=10
RATE_LIMIT_GET_WINDOW_MS=900000
RATE_LIMIT_POST_MAX=100
RATE_LIMIT_POST_WINDOW_MS=60000

# Validação de IP
META_IP_VALIDATION_ENABLED=true
META_IP_WHITELIST_ENABLED=true

# Logs
LOG_LEVEL=production
LOG_SANITIZE_ENABLED=true
```

### Valores para Desenvolvimento/Testes

```env
# Rate Limiting (mais permissivo)
RATE_LIMIT_ENABLED=true
RATE_LIMIT_GET_MAX=100
RATE_LIMIT_POST_MAX=1000

# Validação de IP (desabilitada para testes locais)
META_IP_VALIDATION_ENABLED=false

# Logs (completos para debug)
LOG_LEVEL=debug
LOG_SANITIZE_ENABLED=false
```

---

## 7. 📈 MONITORAMENTO E ALERTAS

### Métricas que Serão Coletadas

1. **Requisições Bloqueadas por Rate Limiting**
   - Contador: `rate_limit_exceeded_total`
   - Labels: `method`, `path`, `ip`

2. **Requisições Bloqueadas por IP Inválido**
   - Contador: `ip_validation_failed_total`
   - Labels: `ip`, `path`

3. **Requisições Bloqueadas por Assinatura Inválida**
   - Contador: `signature_validation_failed_total`
   - Labels: `ip`, `path`

### Alertas Recomendados

- **Múltiplas falhas de IP:** > 10 em 5 minutos → Alerta
- **Múltiplas falhas de assinatura:** > 5 em 5 minutos → Alerta
- **Rate limiting acionado:** > 50 bloqueios em 1 hora → Alerta

---

## ✅ CHECKLIST ANTES DE IMPLEMENTAR

- [ ] Entender como funciona rate limiting
- [ ] Entender como funciona validação de IP
- [ ] Entender como funciona mascaramento de logs
- [ ] Definir limites de rate limiting adequados
- [ ] Verificar se IPs do Meta estão atualizados
- [ ] Configurar variáveis de ambiente
- [ ] Testar em ambiente de desenvolvimento primeiro

---

## 🎯 PRÓXIMOS PASSOS

Após entender esta explicação, podemos:
1. Implementar as correções
2. Testar cada funcionalidade
3. Ajustar limites conforme necessário
4. Documentar configurações finais

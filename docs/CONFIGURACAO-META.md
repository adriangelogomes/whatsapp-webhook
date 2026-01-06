# 🔧 Configuração do Webhook no Meta/Facebook

## ⚠️ Problema: Meta não consegue acessar o webhook

### Sintoma: "Não foi possível validar a URL de callback ou o token de verificação"

Este erro geralmente ocorre por um dos seguintes motivos:

### 🔴 Problema Crítico: Erro SSL/TLS

Se você está vendo este erro no n8n ao tentar HTTPS:
```
EPROTO SSL handshake failure
```

**Isso significa que o Meta também não consegue acessar!** O Meta **EXIGE HTTPS** e se há problema SSL, a validação falha.

**Solução Imediata:**

1. **Verifique Cloudflare SSL/TLS Mode:**
   - Acesse Cloudflare Dashboard
   - Vá em **SSL/TLS** → **Overview**
   - Configure para **Full (strict)** ou **Full**
   - ⚠️ **NÃO use "Flexible"** - isso causa problemas

2. **Verifique o Certificado SSL:**
   ```bash
   openssl s_client -connect whatsapp.api.sofiainsights.com.br:443 -servername whatsapp.api.sofiainsights.com.br
   ```
   
   Procure por:
   - `Verify return code: 0 (ok)` ✅
   - Se aparecer erro, o certificado está inválido

3. **Teste a URL HTTPS publicamente:**
   ```bash
   curl -v "https://whatsapp.api.sofiainsights.com.br/health"
   ```
   
   Se funcionar, o problema pode ser específico do n8n (mas o Meta deve funcionar)

4. **Use HTTP interno no n8n (temporário):**
   - Se n8n está na mesma rede do EasyPanel
   - Use: `http://whatsapp-webhook:3000/webhook/whatsapp`
   - Isso não afeta o Meta (que usa HTTPS externo)

## ⚠️ Problema Comum: "Não foi possível validar a URL de callback ou o token de verificação"

Este erro geralmente ocorre por um dos seguintes motivos:

## ✅ Checklist de Verificação

### 1. **URL deve ser HTTPS (não HTTP)**

❌ **ERRADO:**
```
http://whatsapp.api.sofiainsights.com.br/webhook/whatsapp
```

✅ **CORRETO:**
```
https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp
```

**Solução:**
- Certifique-se de que o domínio está configurado com HTTPS no Cloudflare
- O Meta **NÃO aceita** URLs HTTP para webhooks

### 2. **Token de Verificação deve ser EXATAMENTE igual**

O token que você coloca no Meta deve ser **EXATAMENTE** igual ao `WEBHOOK_SECRET` configurado no EasyPanel.

**Verificação:**
1. No EasyPanel, copie o valor de `WEBHOOK_SECRET`
2. No Meta, cole **EXATAMENTE** o mesmo valor no campo "Verificar token"
3. **Atenção:** Espaços, maiúsculas/minúsculas, caracteres especiais - tudo deve ser idêntico

### 3. **URL deve estar acessível publicamente**

O Meta precisa conseguir acessar a URL de fora da sua rede.

**Teste:**
```bash
curl "https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp?hub.mode=subscribe&hub.challenge=test123&hub.verify_token=SEU_TOKEN_AQUI"
```

**Resposta esperada:**
```
test123
```

Se não funcionar, verifique:
- DNS está configurado corretamente
- Cloudflare está funcionando
- Firewall não está bloqueando

### 4. **Endpoint deve retornar texto puro (não JSON)**

O Meta espera que o endpoint retorne **APENAS** o valor do `hub.challenge` como texto puro.

✅ **CORRETO:**
```
357047951
```

❌ **ERRADO:**
```json
{"challenge": "357047951"}
```

### 5. **Status Code deve ser 200**

O endpoint deve retornar status `200 OK` quando a validação passar.

## 🔍 Como Debugar

### 1. Verificar Logs do Servidor

```bash
docker logs -f whatsapp-webhook | grep "GET /webhook/whatsapp"
```

Você verá:
- Se a requisição chegou
- Quais parâmetros foram recebidos
- Se o token corresponde
- Qual resposta foi enviada

### 2. Testar Manualmente

```bash
# Substitua SEU_TOKEN pelo valor de WEBHOOK_SECRET
curl -v "https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp?hub.mode=subscribe&hub.challenge=test123&hub.verify_token=SEU_TOKEN"
```

**Resposta esperada:**
```
HTTP/1.1 200 OK
Content-Type: text/plain

test123
```

### 3. Verificar no Meta

1. Acesse o painel do Meta
2. Vá em **Webhooks** → **Configurar Webhooks**
3. Preencha:
   - **URL de callback:** `https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp`
   - **Verificar token:** (mesmo valor de `WEBHOOK_SECRET`)
4. Clique em **Verificar e salvar**

## 🚨 Problemas Comuns e Soluções

### Problema 1: "Token inválido"

**Causa:** Token não corresponde exatamente

**Solução:**
1. Verifique se copiou o token completo (sem espaços)
2. Confirme que é o mesmo valor em ambos os lugares
3. Verifique logs para ver o que foi recebido vs esperado

### Problema 2: "URL não acessível"

**Causa:** URL não está acessível publicamente ou não é HTTPS

**Solução:**
1. Certifique-se de usar HTTPS (não HTTP)
2. Teste a URL com curl de fora da rede
3. Verifique DNS e Cloudflare

### Problema 3: "Timeout"

**Causa:** Servidor demorando muito para responder

**Solução:**
1. Verifique se o servidor está rodando
2. Verifique logs para erros
3. Teste o endpoint manualmente

## 📋 Passo a Passo Completo

1. **Configure variável de ambiente no EasyPanel:**
   ```
   WEBHOOK_SECRET=seu_token_secreto_aqui
   ```

2. **Copie o token EXATAMENTE** (sem espaços extras)

3. **No Meta, configure:**
   - URL: `https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp`
   - Token: (cole o mesmo valor de `WEBHOOK_SECRET`)

4. **Clique em "Verificar e salvar"**

5. **Verifique os logs:**
   ```bash
   docker logs whatsapp-webhook | grep "GET /webhook/whatsapp"
   ```

6. **Se funcionar, você verá:**
   ```
   "message": "GET /webhook/whatsapp - Verificação bem-sucedida"
   ```

## ✅ Validação Bem-Sucedida

Quando funcionar, você verá nos logs:

```json
{
  "level": "INFO",
  "message": "GET /webhook/whatsapp - Verificação bem-sucedida, retornando challenge",
  "challenge": "357047951",
  "responseStatus": 200,
  "responseBody": "357047951"
}
```

E no Meta, a validação será aprovada! ✅


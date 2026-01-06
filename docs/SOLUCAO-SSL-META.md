# 🔒 Solução: Erro SSL/TLS - Meta não consegue validar webhook

## 🎯 Problema

- Meta não consegue acessar o webhook (requisição não chega)
- n8n dá erro SSL ao usar HTTPS: `EPROTO SSL handshake failure`
- HTTP funciona no n8n, mas Meta **EXIGE HTTPS**

## ✅ Solução Passo a Passo

### 1. Verificar Cloudflare SSL/TLS Mode

**Acesse:** Cloudflare Dashboard → SSL/TLS → Overview

**Configure:**
- ✅ **Full (strict)** - Recomendado (valida certificado)
- ✅ **Full** - Aceita certificado auto-assinado
- ❌ **Flexible** - **NÃO USE** (causa problemas)

**Ação:**
1. Mude para **Full** ou **Full (strict)**
2. Aguarde 1-2 minutos para propagar
3. Teste novamente

### 2. Verificar Certificado SSL

**Teste o certificado:**
```bash
openssl s_client -connect whatsapp.api.sofiainsights.com.br:443 -servername whatsapp.api.sofiainsights.com.br
```

**Procure por:**
- ✅ `Verify return code: 0 (ok)` → Certificado válido
- ❌ `Verify return code: 20` → Certificado inválido

**Se certificado inválido:**
- Verifique se o certificado está configurado no Cloudflare
- Verifique se o domínio está apontando corretamente
- Aguarde propagação DNS (pode levar até 24h)

### 3. Testar URL HTTPS Publicamente

**Teste básico:**
```bash
curl -v "https://whatsapp.api.sofiainsights.com.br/health"
```

**Teste webhook (substitua SEU_TOKEN):**
```bash
curl -v "https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp?hub.mode=subscribe&hub.challenge=test123&hub.verify_token=SEU_TOKEN"
```

**Se funcionar:**
- ✅ Servidor está OK
- ✅ SSL está funcionando
- ✅ Meta deve conseguir acessar

**Se não funcionar:**
- Verifique logs do servidor
- Verifique configuração do Cloudflare
- Verifique firewall/regras

### 4. Configurar n8n para Usar HTTP Interno

**Se n8n está na mesma rede do EasyPanel:**

No n8n HTTP Request node:
- **URL:** `http://whatsapp-webhook:3000/webhook/whatsapp`
- **Método:** POST
- **Headers:**
  ```
  Authorization: Bearer SEU_TOKEN
  Content-Type: application/json
  ```

**Vantagens:**
- ✅ Sem problemas SSL
- ✅ Mais rápido (comunicação interna)
- ✅ Não afeta o Meta (que usa HTTPS externo)

### 5. Verificar Configuração no EasyPanel

**Certifique-se de que:**
- ✅ Domínio está configurado: `whatsapp.api.sofiainsights.com.br`
- ✅ HTTPS está habilitado
- ✅ Porta interna 3000 está exposta
- ✅ Cloudflare está configurado corretamente

## 🔍 Diagnóstico Detalhado

### Teste 1: Verificar SSL do Domínio

```bash
curl -v https://whatsapp.api.sofiainsights.com.br/health 2>&1 | grep -i ssl
```

**Procure por:**
- `SSL connection using TLSv1.3` ✅
- `SSL connection using TLSv1.2` ✅
- Erros SSL ❌

### Teste 2: Verificar se Meta consegue acessar

**Simule requisição do Meta:**
```bash
curl -v "https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp?hub.mode=subscribe&hub.challenge=test123&hub.verify_token=SEU_TOKEN" \
  -H "User-Agent: facebookplatform/1.0"
```

**Resposta esperada:**
```
HTTP/1.1 200 OK
Content-Type: text/plain

test123
```

### Teste 3: Verificar Logs do Servidor

```bash
docker logs whatsapp-webhook | grep "GET /webhook/whatsapp"
```

**Se não aparecer nada:**
- ❌ Requisição não está chegando ao servidor
- Verifique Cloudflare/DNS
- Verifique firewall

**Se aparecer logs:**
- ✅ Requisição está chegando
- Verifique se validação está passando
- Verifique token

## 🚨 Problemas Comuns

### Problema 1: Cloudflare em modo "Flexible"

**Sintoma:** SSL funciona externamente, mas falha internamente

**Solução:** Mude para **Full** ou **Full (strict)**

### Problema 2: Certificado Inválido

**Sintoma:** `Verify return code: 20`

**Solução:**
- Verifique se certificado está configurado no Cloudflare
- Aguarde propagação (até 24h)
- Verifique se domínio está correto

### Problema 3: Firewall Bloqueando

**Sintoma:** Requisição não chega ao servidor

**Solução:**
- Verifique regras de firewall
- Verifique se porta 443 está aberta
- Verifique se Cloudflare está permitindo tráfego

## ✅ Checklist Final

- [ ] Cloudflare SSL/TLS mode: **Full** ou **Full (strict)**
- [ ] Certificado SSL válido (teste com openssl)
- [ ] URL HTTPS acessível publicamente (teste com curl)
- [ ] Webhook responde corretamente (teste manual)
- [ ] Logs mostram requisições chegando
- [ ] Token corresponde exatamente
- [ ] n8n usa HTTP interno (se na mesma rede)

## 🎯 Resultado Esperado

Após corrigir:

1. **Teste manual funciona:**
   ```bash
   curl "https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp?hub.mode=subscribe&hub.challenge=test123&hub.verify_token=SEU_TOKEN"
   # Retorna: test123
   ```

2. **Meta consegue validar:**
   - No painel do Meta, clique em "Verificar e salvar"
   - Validação passa ✅
   - Webhook fica ativo

3. **Logs mostram requisição:**
   ```json
   {
     "message": "GET /webhook/whatsapp - Verificação bem-sucedida",
     "responseStatus": 200
   }
   ```


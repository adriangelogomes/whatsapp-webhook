# ⚡ Solução Rápida - Erro SSL/TLS no n8n

## 🎯 Problema

Erro `EPROTO SSL handshake failure` ao fazer requisição HTTPS do n8n para o webhook.

## ✅ Solução Imediata (3 opções)

### Opção 1: Configurar n8n HTTP Request Node (RECOMENDADO)

No n8n, no node **HTTP Request**:

1. Abra as **Options** (⚙️)
2. Procure por: **"Allow Unauthorized SSL Certificates"**
3. Marque como **`true`**
4. Salve e teste novamente

**Por que funciona?**
- n8n está rejeitando o certificado SSL do Cloudflare
- Esta opção permite conexão mesmo com certificado não validado
- ⚠️ Use apenas se confiar no servidor (você controla o servidor, então é seguro)

### Opção 2: Usar HTTP Interno (Melhor Performance)

Se o n8n está na mesma rede do EasyPanel:

**No n8n HTTP Request node:**
- **URL**: `http://whatsapp-webhook:3000/webhook/whatsapp`
- **Método**: POST
- **Headers**:
  ```
  Authorization: Bearer super_secret_whatsapp_token_123
  Content-Type: application/json
  ```
- **Body**: JSON com seus dados

**Vantagens:**
- ✅ Sem SSL (mais rápido)
- ✅ Não passa pelo Cloudflare
- ✅ Comunicação interna (mais seguro)

### Opção 3: Configurar Cloudflare SSL Mode

1. Acesse **Cloudflare Dashboard**
2. Vá em **SSL/TLS** → **Overview**
3. Mude de **Flexible** para **Full** ou **Full (strict)**
4. Aguarde 1-2 minutos para propagar
5. Teste novamente

## 🔍 Diagnóstico Rápido

### Teste 1: Verificar se o problema é no n8n ou no servidor

Execute no terminal (onde o n8n está rodando):

```bash
curl -X POST https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp \
  -H "Authorization: Bearer super_secret_whatsapp_token_123" \
  -H "Content-Type: application/json" \
  -d '{"test":"ok"}' \
  -v
```

**Se funcionar com curl:**
- ✅ Servidor está OK
- ❌ Problema no n8n → Use **Opção 1**

**Se não funcionar com curl:**
- ❌ Problema no servidor/Cloudflare → Use **Opção 3**

### Teste 2: Verificar SSL do domínio

```bash
openssl s_client -connect whatsapp.api.sofiainsights.com.br:443 -servername whatsapp.api.sofiainsights.com.br
```

Procure por:
- `Verify return code: 0 (ok)` → Certificado válido
- `Verify return code: 20` → Certificado inválido

## 📋 Checklist Rápido

- [ ] n8n HTTP Request node tem "Allow Unauthorized SSL" = true?
- [ ] Cloudflare SSL mode está em "Full" ou "Full (strict)"?
- [ ] Teste com curl funciona?
- [ ] n8n e webhook estão na mesma rede? (use HTTP interno)

## 🚀 Solução Definitiva (Recomendada)

**Para produção, use a Opção 2 (HTTP interno):**

1. Configure n8n para usar o nome do serviço do EasyPanel
2. Use HTTP (não HTTPS) para comunicação interna
3. Mantenha HTTPS apenas para acesso externo (WhatsApp API)

**Exemplo de configuração n8n:**

```
URL: http://whatsapp-webhook:3000/webhook/whatsapp
Method: POST
Authentication: None (já envia Bearer no header)
Headers:
  - Authorization: Bearer ${WEBHOOK_SECRET}
  - Content-Type: application/json
Body: JSON (seu payload)
```

## ⚠️ Importante

- **Opção 1** é uma solução temporária para testes
- **Opção 2** é a melhor para produção (performance + segurança)
- **Opção 3** resolve o problema na raiz (recomendado se usar HTTPS externo)


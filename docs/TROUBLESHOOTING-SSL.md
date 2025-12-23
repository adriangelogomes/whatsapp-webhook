# 🔒 Troubleshooting SSL/TLS - Erro EPROTO

## ❌ Erro Identificado

```
write EPROTO 40D2853CA8750000:error:0A000410:SSL routines:ssl3_read_bytes:ssl/tls alert handshake failure
```

Este é um erro de **handshake SSL/TLS** que ocorre quando há incompatibilidade entre cliente e servidor.

## 🔍 Possíveis Causas

### 1. **Cloudflare SSL Mode Incorreto**
O Cloudflare pode estar em modo "Flexible" ou com configuração SSL incompatível.

### 2. **Certificado SSL Inválido**
Certificado auto-assinado, expirado ou com problemas de cadeia.

### 3. **Versão TLS Incompatível**
Servidor usando TLS 1.3 mas cliente não suporta, ou vice-versa.

### 4. **Cipher Suites Incompatíveis**
Servidor usando cipher suites que o n8n não suporta.

## ✅ Soluções

### Solução 1: Verificar Cloudflare SSL/TLS Mode

1. Acesse Cloudflare Dashboard
2. Vá em **SSL/TLS** → **Overview**
3. Verifique o modo SSL:
   - ✅ **Full (strict)** - Recomendado (valida certificado)
   - ✅ **Full** - Aceita certificado auto-assinado
   - ⚠️ **Flexible** - Pode causar problemas (não recomendado)

**Ação**: Configure para **Full (strict)** ou **Full**

### Solução 2: Verificar Certificado SSL

Teste o certificado:

```bash
openssl s_client -connect whatsapp.api.sofiainsights.com.br:443 -servername whatsapp.api.sofiainsights.com.br
```

Verifique:
- ✅ Certificado válido e não expirado
- ✅ Cadeia completa de certificados
- ✅ Nome do certificado corresponde ao domínio

### Solução 3: Configurar n8n para Aceitar Certificado

No n8n, configure o HTTP Request node:

**Opção A: Desabilitar verificação SSL (TEMPORÁRIO - apenas para testes)**

No n8n HTTP Request node:
- Adicione header: `NODE_TLS_REJECT_UNAUTHORIZED=0` (não recomendado em produção)

**Opção B: Configurar certificado customizado**

1. Exporte o certificado do servidor
2. Configure n8n para usar certificado customizado

### Solução 4: Usar HTTP Interno (Bypass Cloudflare)

Se o n8n está na mesma rede do EasyPanel:

```bash
# Use o IP interno ou nome do serviço
curl -X POST http://whatsapp-webhook:3000/webhook/whatsapp \
  -H "Authorization: Bearer super_secret_whatsapp_token_123" \
  -H "Content-Type: application/json" \
  -d '{"test":"ok"}'
```

### Solução 5: Configurar Cloudflare para Aceitar TLS 1.2+

1. Cloudflare Dashboard → **SSL/TLS** → **Edge Certificates**
2. Verifique **Minimum TLS Version**
3. Configure para **TLS 1.2** ou superior (não TLS 1.0/1.1)

### Solução 6: Adicionar Suporte a TLS no Código (Se Necessário)

Se o problema for no servidor Node.js, podemos adicionar configuração TLS explícita.

## 🧪 Testes de Diagnóstico

### Teste 1: Verificar SSL do Domínio

```bash
curl -v https://whatsapp.api.sofiainsights.com.br/health
```

Procure por:
- ✅ `SSL connection using TLSv1.3` ou `TLSv1.2`
- ❌ Erros de certificado

### Teste 2: Testar com curl (bypass n8n)

```bash
curl -X POST https://whatsapp.api.sofiainsights.com.br/webhook/whatsapp \
  -H "Authorization: Bearer super_secret_whatsapp_token_123" \
  -H "Content-Type: application/json" \
  -d '{"test":"ok"}' \
  -v
```

Se funcionar com curl mas não com n8n → problema no n8n
Se não funcionar com curl → problema no servidor/Cloudflare

### Teste 3: Verificar Versão TLS

```bash
nmap --script ssl-enum-ciphers -p 443 whatsapp.api.sofiainsights.com.br
```

## 🎯 Solução Rápida (Temporária)

Se precisar funcionar AGORA:

1. **No n8n HTTP Request node**, adicione:
   - **Options** → **Allow Unauthorized SSL Certificates**: `true`
   - ⚠️ **Apenas para testes!** Não use em produção

2. **Ou use HTTP interno** (se n8n e webhook estão na mesma rede):
   - Use o nome do serviço do EasyPanel: `http://whatsapp-webhook:3000`

## 📋 Checklist de Verificação

- [ ] Cloudflare SSL/TLS mode configurado para **Full** ou **Full (strict)**
- [ ] Certificado SSL válido e não expirado
- [ ] TLS 1.2+ habilitado no Cloudflare
- [ ] Teste com curl funciona
- [ ] n8n configurado para aceitar certificado (se necessário)
- [ ] Firewall/regras não bloqueiam conexão

## 🔧 Configuração Recomendada Cloudflare

```
SSL/TLS encryption mode: Full (strict)
Minimum TLS Version: 1.2
TLS 1.3: Enabled
Always Use HTTPS: Enabled
Automatic HTTPS Rewrites: Enabled
```

## 📞 Próximos Passos

1. Verifique configuração Cloudflare (Solução 1)
2. Teste com curl (Teste 2)
3. Se curl funcionar → problema no n8n (Solução 3)
4. Se curl não funcionar → problema no servidor/Cloudflare (Soluções 1, 2, 5)


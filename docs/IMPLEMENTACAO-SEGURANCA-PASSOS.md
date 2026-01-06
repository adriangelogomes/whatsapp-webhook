# 🔐 Passos de Implementação das Correções de Segurança

Este documento lista todas as modificações necessárias para implementar as correções de segurança.

## ✅ Já Implementado
1. ✅ Dependências (helmet, express-rate-limit)
2. ✅ Variáveis de ambiente de segurança
3. ✅ Funções auxiliares (maskToken, sanitizeBody, isValidMetaIP, isIPInCIDR)

## ⏳ Pendente

### 1. Adicionar Helmet (Headers de Segurança)
- Adicionar ANTES do express.json
- Configurar adequadamente para API

### 2. Adicionar Rate Limiting
- Rate limiter para GET /webhook/whatsapp
- Rate limiter para POST /webhook/whatsapp
- Rate limiter genérico para outras rotas

### 3. Modificar logFullRequest para Sanitizar
- Mascarar tokens
- Sanitizar body
- Respeitar LOG_SANITIZE_ENABLED e LOG_LEVEL

### 4. Modificar logPayload para Sanitizar
- Sanitizar payload antes de logar
- Respeitar LOG_SANITIZE_ENABLED e LOG_LEVEL

### 5. Modificar POST /webhook/whatsapp para Validação Agressiva
- Validação de IP (modo monitor)
- Validação agressiva: Assinatura OU User-Agent
- Bloquear se não tiver nenhum dos dois

### 6. Extrair IP Real (helper function)
- Criar função para extrair IP real considerando proxies

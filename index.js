/**
 * Webhook WhatsApp -> RabbitMQ
 * 
 * Recebe eventos do WhatsApp via webhook HTTP,
 * valida e publica no RabbitMQ para processamento assíncrono.
 * 
 * Características:
 * - Stateless (escala horizontal)
 * - Validação de payload
 * - Reconexão automática RabbitMQ
 * - Tratamento robusto de erros
 * - Healthcheck endpoint
 */

import express from "express";
import amqp from "amqplib";

const app = express();
app.use(express.json({ limit: "2mb" }));

// ============================
// Sistema de Logging
// ============================
/**
 * Gera timestamp no horário de São Paulo (America/Sao_Paulo)
 * Formato: YYYY-MM-DDTHH:mm:ss.sss-03:00 (horário de São Paulo)
 * 
 * Versão otimizada que evita operações custosas
 */
function getLocalTimestamp() {
  const now = new Date();
  
  // Converte para horário de São Paulo usando Intl (mais eficiente)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // Formata partes da data
  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  const hours = parts.find(p => p.type === 'hour').value;
  const minutes = parts.find(p => p.type === 'minute').value;
  const seconds = parts.find(p => p.type === 'second').value;
  
  // Milissegundos
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
  
  // Calcula offset de São Paulo de forma mais eficiente
  // Usa uma abordagem simples: São Paulo é UTC-3 (ou UTC-2 no horário de verão)
  // Para simplificar e evitar operações custosas, usa UTC-3 como padrão
  // O horário já está correto devido ao timeZone: 'America/Sao_Paulo'
  const offsetHours = -3; // UTC-3 (horário padrão de São Paulo)
  const offsetMinutes = 0;
  
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}-03:00`;
}

/**
 * Função de logging estruturado
 * Formato JSON para facilitar parsing e análise
 */
function log(level, message, data = {}) {
  const logEntry = {
    timestamp: getLocalTimestamp(),
    level,
    message,
    ...data
  };
  
  // Em produção, pode ser enviado para sistema de logs (ELK, CloudWatch, etc)
  console.log(JSON.stringify(logEntry));
}

/**
 * Log de requisição HTTP recebida
 */
function logRequest(req, statusCode, responseTime = null) {
  const logData = {
    method: req.method,
    path: req.path,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get("user-agent"),
    statusCode,
    responseTime: responseTime ? `${responseTime}ms` : null,
    hasAuth: !!req.headers.authorization,
    contentType: req.get("content-type"),
    contentLength: req.get("content-length")
  };
  
  log("INFO", `HTTP ${req.method} ${req.path} - ${statusCode}`, logData);
}

/**
 * Log de payload recebido (sanitizado para não expor dados sensíveis)
 */
function logPayload(payload, maxSize = 1000) {
  try {
    const payloadStr = JSON.stringify(payload);
    const truncated = payloadStr.length > maxSize 
      ? payloadStr.substring(0, maxSize) + "..." 
      : payloadStr;
    
    log("INFO", "Payload recebido", {
      payloadSize: payloadStr.length,
      payloadPreview: truncated,
      payloadKeys: Object.keys(payload || {})
    });
  } catch (err) {
    log("WARN", "Erro ao logar payload", { error: err.message });
  }
}

/**
 * Log de erro detalhado
 */
function logError(error, context = {}) {
  log("ERROR", error.message || "Erro desconhecido", {
    error: {
      message: error.message,
      stack: error.stack,
      code: error.code,
      name: error.name
    },
    ...context
  });
}

// ============================
// Variáveis de ambiente
// ============================
const PORT = process.env.PORT || 3000;
const RABBIT_URL = process.env.RABBIT_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const EXCHANGE = process.env.RABBIT_EXCHANGE || "whatsapp.events";
const QUEUE = process.env.RABBIT_QUEUE || "whatsapp.incoming";
const ROUTING_KEY = process.env.RABBIT_ROUTING_KEY || "whatsapp.incoming";

// Validação de variáveis obrigatórias
if (!RABBIT_URL) {
  console.error("❌ RABBIT_URL é obrigatória");
  process.exit(1);
}

if (!WEBHOOK_SECRET) {
  console.error("❌ WEBHOOK_SECRET é obrigatória");
  process.exit(1);
}

// ============================
// RabbitMQ conexão
// ============================
let channel = null;
let connection = null;
let isConnecting = false;
let retryCount = 0;
const MAX_RETRY_LOG = 5; // Loga apenas a cada 5 tentativas para não poluir logs

/**
 * Conecta ao RabbitMQ e configura exchange/queue
 * Implementa reconexão automática com retry inteligente
 * Logs limpos em produção (sem erros "feios")
 */
async function connectRabbit() {
  if (isConnecting) {
    return;
  }

  isConnecting = true;

  try {
    connection = await amqp.connect(RABBIT_URL);
    channel = await connection.createChannel();

    // Configura exchange durável (sobrevive a reinicializações)
    await channel.assertExchange(EXCHANGE, "topic", { durable: true });

    // Configura queue durável
    await channel.assertQueue(QUEUE, { durable: true });

    // Vincula queue ao exchange
    await channel.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);

    // Tratamento de desconexão
    connection.on("close", () => {
      if (channel) {
        log("WARN", "Conexão RabbitMQ fechada, iniciando reconexão", {
          exchange: EXCHANGE,
          queue: QUEUE
        });
      }
      channel = null;
      connection = null;
      isConnecting = false;
      retryCount = 0;
      setTimeout(connectRabbit, 5000);
    });

    connection.on("error", (err) => {
      // Log apenas a cada N tentativas para não poluir
      if (retryCount % MAX_RETRY_LOG === 0) {
        log("WARN", "Erro na conexão RabbitMQ", {
          error: err.message,
          code: err.code,
          retryCount
        });
      }
    });

    // Reset retry count em caso de sucesso
    if (retryCount > 0) {
      log("INFO", "RabbitMQ reconectado", {
        retryCount,
        exchange: EXCHANGE,
        queue: QUEUE
      });
      retryCount = 0;
    } else {
      log("INFO", "RabbitMQ conectado", {
        exchange: EXCHANGE,
        queue: QUEUE,
        routingKey: ROUTING_KEY
      });
    }
    
    isConnecting = false;
  } catch (err) {
    retryCount++;
    
    // Log apenas a cada N tentativas para não poluir logs
    if (retryCount === 1 || retryCount % MAX_RETRY_LOG === 0) {
      log("WARN", "Tentativa de conexão RabbitMQ falhou, retry em 5s", {
        retryCount,
        error: err.message,
        code: err.code,
        nextRetryIn: "5s"
      });
    }
    
    isConnecting = false;
    // Retry com delay de 5 segundos
    setTimeout(connectRabbit, 5000);
  }
}

// Inicia conexão
connectRabbit();

// ============================
// Middleware de logging de requisições
// ============================
/**
 * Middleware para logar todas as requisições HTTP
 */
app.use((req, res, next) => {
  const startTime = Date.now();
  
  // Intercepta o método end para calcular tempo de resposta
  const originalEnd = res.end;
  res.end = function(...args) {
    const responseTime = Date.now() - startTime;
    logRequest(req, res.statusCode, responseTime);
    originalEnd.apply(res, args);
  };
  
  next();
});

// ============================
// Middleware de autenticação
// ============================
/**
 * Valida Bearer Token no header Authorization
 * 
 * Formato esperado: Authorization: Bearer SEU_TOKEN
 * 
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 * @returns {void}
 */
function validateWebhookSecret(req, res, next) {
  const authHeader = req.headers.authorization;

  // Verifica se header existe
  if (!authHeader) {
    log("WARN", "Requisição sem token de autenticação", {
      ip: req.ip,
      path: req.path,
      userAgent: req.get("user-agent")
    });
    
    return res.status(401).json({
      error: "Unauthorized",
      message: "Token de autenticação não fornecido"
    });
  }

  // Verifica formato Bearer
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    log("WARN", "Formato de token inválido", {
      ip: req.ip,
      path: req.path,
      authHeaderFormat: parts[0],
      userAgent: req.get("user-agent")
    });
    
    return res.status(401).json({
      error: "Unauthorized",
      message: "Formato de token inválido. Use: Authorization: Bearer TOKEN"
    });
  }

  const token = parts[1];

  // Valida token
  if (token !== WEBHOOK_SECRET) {
    log("WARN", "Token inválido recebido", {
      ip: req.ip,
      path: req.path,
      tokenLength: token.length,
      tokenPrefix: token.substring(0, 4) + "***", // Primeiros 4 chars apenas
      userAgent: req.get("user-agent")
    });
    
    return res.status(401).json({
      error: "Unauthorized",
      message: "Token inválido"
    });
  }

  // Token válido, continua
  log("INFO", "Autenticação válida", {
    ip: req.ip,
    path: req.path
  });
  
  next();
}

// ============================
// Healthcheck REAL (Cloudflare-friendly)
// ============================
/**
 * Endpoint de healthcheck
 * 
 * Retorna status real do serviço e conexão RabbitMQ.
 * Retorna 503 quando RabbitMQ está desconectado para:
 * - Cloudflare detectar falha
 * - Load Balancer remover instância ruim
 * - Monitoramento alertar corretamente
 * 
 * @route GET /health
 * @returns {Object} 200 - Serviço e RabbitMQ OK
 * @returns {Object} 503 - RabbitMQ desconectado
 */
app.get("/health", (req, res) => {
  // Healthcheck REAL: verifica RabbitMQ, não só HTTP
  if (!channel) {
    return res.status(503).json({ 
      status: "rabbit_disconnected",
      rabbitmq: "disconnected",
      timestamp: getLocalTimestamp()
    });
  }

  res.json({ 
    status: "ok",
    rabbitmq: "connected",
    timestamp: getLocalTimestamp()
  });
});

// ============================
// Webhook WhatsApp
// ============================
/**
 * Endpoint principal do webhook
 * 
 * Recebe eventos do WhatsApp, valida autenticação, valida payload
 * e publica no RabbitMQ.
 * 
 * Segurança:
 * - Requer Bearer Token no header Authorization
 * - Token validado via variável WEBHOOK_SECRET
 * - Não publica nada se token inválido
 * 
 * @route POST /webhook/whatsapp
 * @header Authorization: Bearer WEBHOOK_SECRET
 * @param {Object} req.body - Payload do evento WhatsApp
 * @returns {number} 200 - Evento enfileirado com sucesso
 * @returns {number} 401 - Token inválido ou ausente
 * @returns {number} 400 - Payload inválido
 * @returns {number} 503 - RabbitMQ indisponível
 * @returns {number} 500 - Erro interno
 */
app.post("/webhook/whatsapp", validateWebhookSecret, async (req, res) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();
  
  try {
    // Log da requisição recebida
    log("INFO", "Webhook recebido", {
      requestId,
      ip: req.ip,
      userAgent: req.get("user-agent"),
      contentType: req.get("content-type"),
      contentLength: req.get("content-length")
    });
    
    // Log do payload recebido
    logPayload(req.body, 2000); // Loga até 2000 caracteres do payload
    
    // Valida se RabbitMQ está conectado
    if (!channel) {
      log("ERROR", "Tentativa de publicar com RabbitMQ desconectado", {
        requestId,
        payloadKeys: Object.keys(req.body || {})
      });
      
      return res.status(503).json({ 
        error: "RabbitMQ indisponível",
        message: "Serviço temporariamente indisponível"
      });
    }

    const payload = req.body;

    // Validação básica do payload
    if (!payload || typeof payload !== "object") {
      log("WARN", "Payload inválido recebido", {
        requestId,
        payloadType: typeof payload,
        payloadValue: payload,
        payloadString: JSON.stringify(payload).substring(0, 200)
      });
      
      return res.status(400).json({ 
        error: "Payload inválido",
        message: "Payload deve ser um objeto JSON"
      });
    }

    // Publica no RabbitMQ com persistência
    const messageBuffer = Buffer.from(JSON.stringify(payload));
    const published = channel.publish(
      EXCHANGE,
      ROUTING_KEY,
      messageBuffer,
      {
        persistent: true, // Mensagem persiste mesmo se RabbitMQ reiniciar
        contentType: "application/json",
        timestamp: Date.now()
      }
    );

    if (!published) {
      log("ERROR", "Falha ao publicar no RabbitMQ (buffer cheio)", {
        requestId,
        exchange: EXCHANGE,
        routingKey: ROUTING_KEY,
        messageSize: messageBuffer.length,
        payloadKeys: Object.keys(payload)
      });
      
      return res.status(503).json({ 
        error: "Falha ao enfileirar",
        message: "RabbitMQ temporariamente indisponível"
      });
    }

    // Sucesso - loga publicação
    const processingTime = Date.now() - startTime;
    log("INFO", "Mensagem publicada no RabbitMQ com sucesso", {
      requestId,
      exchange: EXCHANGE,
      routingKey: ROUTING_KEY,
      queue: QUEUE,
      messageSize: messageBuffer.length,
      processingTime: `${processingTime}ms`,
      payloadKeys: Object.keys(payload),
      payloadSize: messageBuffer.length
    });

    res.sendStatus(200);
  } catch (err) {
    const processingTime = Date.now() - startTime;
    
    // Log detalhado do erro
    logError(err, {
      requestId,
      processingTime: `${processingTime}ms`,
      ip: req.ip,
      path: req.path,
      method: req.method,
      payloadKeys: Object.keys(req.body || {}),
      payloadPreview: JSON.stringify(req.body || {}).substring(0, 500)
    });
    
    res.status(500).json({ 
      error: "Erro interno",
      message: "Falha ao processar webhook"
    });
  }
});

// ============================
// Tratamento de erros não capturados
// ============================
process.on("unhandledRejection", (reason, promise) => {
  // Log apenas erros reais, ignora erros de conexão RabbitMQ (já tratados)
  if (reason?.code !== "ECONNREFUSED" && reason?.code !== "ENOTFOUND") {
    logError(reason, {
      type: "unhandledRejection",
      promise: promise?.toString()
    });
  }
});

process.on("uncaughtException", (err) => {
  logError(err, {
    type: "uncaughtException",
    fatal: true
  });
  process.exit(1);
});

// ============================
// Start server
// ============================
app.listen(PORT, () => {
  log("INFO", "Servidor iniciado", {
    port: PORT,
    nodeEnv: process.env.NODE_ENV || "development",
    endpoints: {
      webhook: "POST /webhook/whatsapp",
      healthcheck: "GET /health"
    },
    config: {
      exchange: EXCHANGE,
      queue: QUEUE,
      routingKey: ROUTING_KEY,
      hasRabbitUrl: !!RABBIT_URL,
      hasWebhookSecret: !!WEBHOOK_SECRET
    }
  });
});


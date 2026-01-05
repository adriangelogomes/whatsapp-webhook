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
 * Versão ultra-otimizada com tratamento de erro
 */
function getLocalTimestamp() {
  try {
    const now = new Date();
    
    // Converte para horário de São Paulo usando Intl
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
    const year = parts.find(p => p.type === 'year')?.value || now.getFullYear();
    const month = parts.find(p => p.type === 'month')?.value || String(now.getMonth() + 1).padStart(2, '0');
    const day = parts.find(p => p.type === 'day')?.value || String(now.getDate()).padStart(2, '0');
    const hours = parts.find(p => p.type === 'hour')?.value || String(now.getHours()).padStart(2, '0');
    const minutes = parts.find(p => p.type === 'minute')?.value || String(now.getMinutes()).padStart(2, '0');
    const seconds = parts.find(p => p.type === 'second')?.value || String(now.getSeconds()).padStart(2, '0');
    
    // Milissegundos
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    
    // São Paulo é UTC-3 (sem horário de verão desde 2019)
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}-03:00`;
  } catch (err) {
    // Fallback: usa horário local do servidor se Intl falhar
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    const offset = -now.getTimezoneOffset();
    const offsetHours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
    const offsetMinutes = String(Math.abs(offset) % 60).padStart(2, '0');
    const offsetSign = offset >= 0 ? '+' : '-';
    
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${offsetSign}${offsetHours}:${offsetMinutes}`;
  }
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
 * Log completo de requisição HTTP (inclui todos os headers, query params, body, etc)
 * 
 * @param {Object} req - Request object do Express
 * @param {string} requestId - ID único da requisição
 * @param {string} message - Mensagem de log
 */
function logFullRequest(req, requestId, message = "Requisição completa recebida") {
  try {
    const clientIp = req.ip || req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    
    // Extrai token do header Authorization se existir
    let authToken = null;
    if (req.headers.authorization) {
      const parts = req.headers.authorization.split(" ");
      if (parts.length === 2 && parts[0] === "Bearer") {
        authToken = parts[1];
      }
    }
    
    const logData = {
      requestId,
      method: req.method,
      path: req.path,
      url: req.url,
      query: req.query,
      queryString: req.url.split('?')[1] || '',
      ip: clientIp,
      headers: req.headers, // TODOS os headers completos
      userAgent: req.get("user-agent"),
      contentType: req.get("content-type"),
      contentLength: req.get("content-length"),
      authorization: req.headers.authorization || null, // Token completo no header Authorization
      authToken: authToken, // Token extraído (sem "Bearer ")
      body: req.body || null, // Body completo
      webhookSecret: WEBHOOK_SECRET || null, // WEBHOOK_SECRET configurado (para comparação)
      webhookSecretLength: WEBHOOK_SECRET?.length || 0
    };
    
    log("INFO", message, logData);
  } catch (err) {
    log("WARN", "Erro ao logar requisição completa", { error: err.message });
  }
}

/**
 * Log de payload recebido (completo, sem truncamento)
 */
function logPayload(payload, maxSize = null) {
  try {
    const payloadStr = JSON.stringify(payload);
    
    log("INFO", "Payload recebido", {
      payloadSize: payloadStr.length,
      payload: payload, // Payload completo sem truncamento
      payloadString: payloadStr, // String completa do payload
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

// WEBHOOK_SECRET é opcional - se não estiver definido, requisições serão aceitas sem autenticação
if (WEBHOOK_SECRET) {
  console.log("✅ WEBHOOK_SECRET configurado - autenticação ativada");
} else {
  console.log("⚠️  WEBHOOK_SECRET não configurado - requisições serão aceitas sem autenticação");
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
 * EXCETO GET /webhook/whatsapp (já tem logging próprio e não deve ter interferência)
 */
app.use((req, res, next) => {
  // Pula logging para GET /webhook/whatsapp (já tem logging detalhado e precisa resposta limpa)
  if (req.method === 'GET' && req.path === '/webhook/whatsapp') {
    return next();
  }
  
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
 * Valida Bearer Token no header Authorization (opcional)
 * 
 * Se WEBHOOK_SECRET estiver configurado, valida o token.
 * Se não estiver configurado, permite requisições sem autenticação.
 * 
 * Formato esperado: Authorization: Bearer SEU_TOKEN
 * 
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 * @returns {void}
 */
function validateWebhookSecret(req, res, next) {
  const requestId = `auth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Log completo da requisição antes da validação
  logFullRequest(req, requestId, "Middleware de autenticação - Requisição recebida");
  
  // Se WEBHOOK_SECRET não estiver configurado, permite requisições sem autenticação
  if (!WEBHOOK_SECRET) {
    log("INFO", "Requisição aceita sem autenticação (WEBHOOK_SECRET não configurado)", {
      requestId,
      ip: req.ip,
      path: req.path,
      userAgent: req.get("user-agent"),
      hasAuthorizationHeader: !!req.headers.authorization,
      authorizationHeader: req.headers.authorization || null
    });
    
    return next();
  }

  const authHeader = req.headers.authorization;

  // Verifica se header existe
  if (!authHeader) {
    log("WARN", "Requisição sem token de autenticação", {
      requestId,
      ip: req.ip,
      path: req.path,
      userAgent: req.get("user-agent"),
      headers: req.headers,
      webhookSecret: WEBHOOK_SECRET,
      webhookSecretLength: WEBHOOK_SECRET?.length || 0
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
      requestId,
      ip: req.ip,
      path: req.path,
      authHeader: authHeader, // Header completo
      authHeaderFormat: parts[0],
      authHeaderParts: parts,
      userAgent: req.get("user-agent"),
      webhookSecret: WEBHOOK_SECRET,
      webhookSecretLength: WEBHOOK_SECRET?.length || 0
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
      requestId,
      ip: req.ip,
      path: req.path,
      tokenReceived: token, // Token completo recebido (sem mascarar)
      tokenLength: token.length,
      webhookSecretExpected: WEBHOOK_SECRET, // Token esperado completo
      webhookSecretLength: WEBHOOK_SECRET?.length || 0,
      tokensMatch: token === WEBHOOK_SECRET,
      tokensEqual: token === WEBHOOK_SECRET,
      userAgent: req.get("user-agent"),
      authorizationHeader: authHeader
    });
    
    return res.status(401).json({
      error: "Unauthorized",
      message: "Token inválido"
    });
  }

  // Token válido, continua
  log("INFO", "Autenticação válida", {
    requestId,
    ip: req.ip,
    path: req.path,
    tokenLength: token.length,
    webhookSecretLength: WEBHOOK_SECRET?.length || 0,
    tokensMatch: true
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
 * Endpoint GET para validação do webhook do Meta/Facebook
 * 
 * Quando o Meta configura o webhook, ele envia uma requisição GET
 * para validar a assinatura. Deve retornar o hub.challenge se válido.
 * 
 * Parâmetros esperados:
 * - hub.mode: deve ser "subscribe"
 * - hub.challenge: token que deve ser retornado
 * - hub.verify_token: deve corresponder a WEBHOOK_SECRET (se configurado)
 * 
 * @route GET /webhook/whatsapp
 * @param {string} req.query.hub.mode - Deve ser "subscribe"
 * @param {string} req.query.hub.challenge - Token a ser retornado
 * @param {string} req.query.hub.verify_token - Token de verificação (opcional se WEBHOOK_SECRET não estiver configurado)
 * @returns {string} 200 - hub.challenge se válido
 * @returns {number} 403 - Token de verificação inválido (apenas se WEBHOOK_SECRET configurado)
 * @returns {number} 400 - Parâmetros inválidos
 */
// Endpoint GET para validação do Meta - DEVE estar ANTES do middleware de logging
// para evitar interferência nos headers da resposta
app.get("/webhook/whatsapp", (req, res) => {
  const startTime = Date.now();
  const requestId = `get_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Extrai parâmetros do query string
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = req.query['hub.verify_token'];
  
  // IP real (considera proxies)
  const clientIp = req.ip || req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  
  // Log completo da requisição recebida (TODAS as informações)
  logFullRequest(req, requestId, "GET /webhook/whatsapp - Requisição de verificação do Meta recebida");
  
  // Log adicional com parâmetros extraídos e comparações
  log("INFO", "GET /webhook/whatsapp - Parâmetros extraídos", {
    requestId,
    mode: mode,
    modeValue: mode,
    challenge: challenge, // Challenge completo
    challengeLength: challenge?.length || 0,
    verifyToken: verifyToken, // Token completo (sem mascarar)
    verifyTokenLength: verifyToken?.length || 0,
    webhookSecret: WEBHOOK_SECRET, // WEBHOOK_SECRET completo (para comparação)
    webhookSecretLength: WEBHOOK_SECRET?.length || 0,
    tokensMatch: WEBHOOK_SECRET ? (verifyToken === WEBHOOK_SECRET) : null,
    hasWebhookSecret: !!WEBHOOK_SECRET
  });
  
  // Valida hub.mode
  if (mode !== 'subscribe') {
    const processingTime = Date.now() - startTime;
    log("WARN", "GET /webhook/whatsapp - Verificação falhou: modo inválido", {
      requestId,
      ip: clientIp,
      mode,
      expected: "subscribe",
      receivedMode: mode,
      processingTime: `${processingTime}ms`,
      responseStatus: 400
    });
    
    // Meta espera resposta simples em caso de erro
    res.status(400);
    res.setHeader('Content-Type', 'text/plain');
    return res.end('Invalid mode');
  }
  
  // Valida hub.verify_token apenas se WEBHOOK_SECRET estiver configurado
  if (WEBHOOK_SECRET) {
    const tokenMatch = verifyToken && verifyToken === WEBHOOK_SECRET;
    
    if (!tokenMatch) {
      const processingTime = Date.now() - startTime;
      log("WARN", "GET /webhook/whatsapp - Verificação falhou: token inválido", {
        requestId,
        ip: clientIp,
        verifyTokenReceived: verifyToken, // Token completo recebido
        verifyTokenLength: verifyToken?.length || 0,
        webhookSecretExpected: WEBHOOK_SECRET, // Token esperado completo
        webhookSecretLength: WEBHOOK_SECRET?.length || 0,
        tokensMatch: false,
        tokensEqual: verifyToken === WEBHOOK_SECRET,
        processingTime: `${processingTime}ms`,
        responseStatus: 403
      });
      
      // Meta espera resposta simples em caso de erro
      res.status(403);
      res.setHeader('Content-Type', 'text/plain');
      return res.end('Invalid verify token');
    }
  } else {
    // WEBHOOK_SECRET não configurado - aceita qualquer token ou requisição sem token
    log("INFO", "GET /webhook/whatsapp - Validação de token ignorada (WEBHOOK_SECRET não configurado)", {
      requestId,
      ip: clientIp,
      hasVerifyToken: !!verifyToken,
      verifyToken: verifyToken, // Token completo recebido
      verifyTokenLength: verifyToken?.length || 0
    });
  }
  
  // Valida hub.challenge
  if (!challenge) {
    const processingTime = Date.now() - startTime;
    log("WARN", "GET /webhook/whatsapp - Verificação falhou: challenge ausente", {
      requestId,
      ip: clientIp,
      processingTime: `${processingTime}ms`,
      responseStatus: 400
    });
    
    // Meta espera resposta simples em caso de erro
    res.status(400);
    res.setHeader('Content-Type', 'text/plain');
    return res.end('Missing challenge');
  }
  
  // Validação bem-sucedida - retorna o challenge como texto puro
  const processingTime = Date.now() - startTime;
  const challengeString = String(challenge);
  
  log("INFO", "GET /webhook/whatsapp - Verificação bem-sucedida, retornando challenge", {
    requestId,
    ip: clientIp,
    challenge: challengeString, // Loga o challenge completo para debug
    challengeLength: challengeString.length,
    challengeType: typeof challenge,
    processingTime: `${processingTime}ms`,
    responseStatus: 200,
    responseContentType: 'text/plain',
    responseBody: challengeString
  });
  
  // IMPORTANTE: Meta espera EXATAMENTE o challenge como texto puro
  // Sem headers extras, sem formatação, apenas o valor do challenge
  res.status(200);
  res.setHeader('Content-Type', 'text/plain');
  // Usa res.end() em vez de res.send() para garantir resposta limpa
  res.end(challengeString);
});

/**
 * Endpoint POST para receber eventos do WhatsApp
 * 
 * Recebe eventos do WhatsApp, valida autenticação, valida payload
 * e publica no RabbitMQ.
 * 
 * Segurança:
 * - Se WEBHOOK_SECRET configurado: requer Bearer Token no header Authorization
 * - Se WEBHOOK_SECRET não configurado: aceita requisições sem autenticação
 * - Token validado via variável WEBHOOK_SECRET (quando configurado)
 * 
 * @route POST /webhook/whatsapp
 * @header Authorization: Bearer WEBHOOK_SECRET (opcional, apenas se WEBHOOK_SECRET configurado)
 * @param {Object} req.body - Payload do evento WhatsApp
 * @returns {number} 200 - Evento enfileirado com sucesso
 * @returns {number} 401 - Token inválido ou ausente (apenas se WEBHOOK_SECRET configurado)
 * @returns {number} 400 - Payload inválido
 * @returns {number} 503 - RabbitMQ indisponível
 * @returns {number} 500 - Erro interno
 */
app.post("/webhook/whatsapp", validateWebhookSecret, async (req, res) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();
  
  try {
    // Log completo da requisição recebida (TODAS as informações)
    logFullRequest(req, requestId, "POST /webhook/whatsapp - Webhook recebido");
    
    // Log do payload recebido (completo, sem truncamento)
    logPayload(req.body);
    
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
        payloadValue: payload, // Payload completo
        payloadString: JSON.stringify(payload), // String completa
        rawBody: req.body,
        headers: req.headers
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


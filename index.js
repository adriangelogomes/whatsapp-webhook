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
import crypto from "crypto";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const app = express();

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
 * Log de payload recebido (sanitizado em produção)
 */
function logPayload(payload, maxSize = null) {
  try {
    // Sanitização baseada em LOG_LEVEL e LOG_SANITIZE_ENABLED
    let payloadToLog = payload;
    if (LOG_LEVEL === 'production' || LOG_SANITIZE_ENABLED) {
      payloadToLog = sanitizeBody(payload);
    }
    
    const payloadStr = JSON.stringify(payloadToLog);
    
    log("INFO", "Payload recebido", {
      payloadSize: JSON.stringify(payload).length, // Tamanho original
      payload: payloadToLog, // Payload sanitizado ou completo (dependendo do modo)
      payloadString: payloadStr, // String do payload sanitizado ou completo
      payloadKeys: Object.keys(payload || {}),
      sanitized: LOG_LEVEL === 'production' || LOG_SANITIZE_ENABLED
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

/**
 * Mascara token/secrets para logs (mostra apenas últimos 4 caracteres)
 * 
 * @param {string} token - Token a ser mascarado
 * @returns {string} - Token mascarado
 */
function maskToken(token) {
  if (!token || typeof token !== 'string') return '***';
  if (token.length < 8) return '***';
  const last4 = token.slice(-4);
  return '*'.repeat(token.length - 4) + last4;
}

/**
 * Sanitiza body do WhatsApp para logs (remove/trunca dados sensíveis)
 * 
 * @param {any} body - Body a ser sanitizado
 * @returns {any} - Body sanitizado
 */
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  
  try {
    const sanitized = JSON.parse(JSON.stringify(body)); // Deep clone
    
    // Sanitiza entry[].changes[].value.messages[].text.body
    if (sanitized.entry && Array.isArray(sanitized.entry)) {
      sanitized.entry.forEach(entry => {
        if (entry.changes && Array.isArray(entry.changes)) {
          entry.changes.forEach(change => {
            if (change.value && change.value.messages && Array.isArray(change.value.messages)) {
              change.value.messages.forEach(msg => {
                if (msg.text && msg.text.body) {
                  const bodyText = msg.text.body;
                  if (bodyText.length > 50) {
                    msg.text.body = bodyText.substring(0, 50) + '... [TRUNCATED]';
                  }
                }
              });
            }
            
            // Sanitiza contacts[].wa_id
            if (change.value && change.value.contacts && Array.isArray(change.value.contacts)) {
              change.value.contacts.forEach(contact => {
                if (contact.wa_id) {
                  contact.wa_id = maskToken(contact.wa_id);
                }
              });
            }
            
            // Sanitiza metadata
            if (change.value && change.value.metadata) {
              if (change.value.metadata.phone_number_id) {
                change.value.metadata.phone_number_id = maskToken(String(change.value.metadata.phone_number_id));
              }
              if (change.value.metadata.display_phone_number) {
                change.value.metadata.display_phone_number = maskToken(change.value.metadata.display_phone_number);
              }
            }
          });
        }
      });
    }
    
    return sanitized;
  } catch (err) {
    return body; // Retorna original se erro
  }
}

/**
 * Valida se IP está em range CIDR (simplificado para IPv4 e IPv6)
 * 
 * @param {string} ip - IP a validar
 * @param {string} cidr - Range CIDR (ex: "192.168.1.0/24" ou "2a03:2880::/32")
 * @returns {boolean} - true se IP está no range
 */
function isIPInCIDR(ip, cidr) {
  try {
    const [range, bits] = cidr.split('/');
    const maskBits = parseInt(bits, 10);
    
    // IPv4
    if (ip.includes('.') && range.includes('.')) {
      const ipParts = ip.split('.').map(Number);
      const rangeParts = range.split('.').map(Number);
      const mask = ~(Math.pow(2, 32 - maskBits) - 1) >>> 0;
      const ipNum = (ipParts[0] << 24) + (ipParts[1] << 16) + (ipParts[2] << 8) + ipParts[3];
      const rangeNum = (rangeParts[0] << 24) + (rangeParts[1] << 16) + (rangeParts[2] << 8) + rangeParts[3];
      return (ipNum & mask) === (rangeNum & mask);
    }
    
    // IPv6 (validação simplificada de prefixo)
    if (ip.includes(':') && range.includes(':')) {
      // Normaliza IPv6 (expande zeros)
      const normalizeIPv6 = (addr) => {
        const parts = addr.split('::');
        if (parts.length === 2) {
          const left = parts[0].split(':').filter(x => x);
          const right = parts[1].split(':').filter(x => x);
          const zeros = 8 - left.length - right.length;
          return [...left, ...Array(zeros).fill('0'), ...right].join(':');
        }
        return addr;
      };
      
      const ipNormalized = normalizeIPv6(ip);
      const rangeNormalized = normalizeIPv6(range);
      const ipPrefix = ipNormalized.split(':').slice(0, Math.floor(maskBits / 16)).join(':');
      const rangePrefix = rangeNormalized.split(':').slice(0, Math.floor(maskBits / 16)).join(':');
      return ipPrefix === rangePrefix;
    }
    
    return false;
  } catch (err) {
    return false;
  }
}

/**
 * Extrai IP real da requisição (considera proxies como Cloudflare)
 * 
 * @param {Object} req - Request object do Express
 * @returns {string} - IP real do cliente
 */
function getClientIP(req) {
  return req.headers['cf-connecting-ip'] || // Cloudflare
         req.headers['x-real-ip'] || // Nginx
         req.headers['x-forwarded-for']?.split(',')[0]?.trim() || // Proxy genérico (primeiro IP)
         req.ip || // Express
         req.connection.remoteAddress || // Fallback
         'unknown';
}

/**
 * Valida se IP está na whitelist do Meta/Facebook
 * 
 * @param {string} ip - IP a validar
 * @returns {boolean} - true se IP está na whitelist
 */
function isValidMetaIP(ip) {
  if (!ip) return false;
  
  // Ranges conhecidos do Meta/Facebook
  const META_IP_RANGES = [
    // IPv6
    '2a03:2880::/32',
    '2620:0:1c00::/40',
    // IPv4
    '31.13.24.0/21',
    '31.13.64.0/18',
    '66.220.144.0/20',
    '69.63.176.0/20',
    '69.171.224.0/19',
    '74.119.76.0/22',
    '103.4.96.0/22',
    '157.240.0.0/16',
    '173.252.64.0/18',
    '179.60.192.0/22',
    '185.60.216.0/22',
    '204.15.20.0/22'
  ];
  
  return META_IP_RANGES.some(range => isIPInCIDR(ip, range));
}

/**
 * Valida assinatura x-hub-signature-256 do Meta/Facebook
 * 
 * O Meta envia a assinatura HMAC-SHA256 do body da requisição no header x-hub-signature-256
 * O formato é: sha256=<hash>
 * 
 * @param {string} signature - Header x-hub-signature-256 recebido (formato: sha256=<hash>)
 * @param {string|Buffer} body - Body da requisição em formato raw (string ou Buffer)
 * @param {string} secret - App Secret do WhatsApp Business API (ou WEBHOOK_SECRET como fallback)
 * @returns {boolean} - true se assinatura válida, false caso contrário
 */
function validateHubSignature(signature, body, secret) {
  if (!signature || !secret) {
    return false;
  }
  
  try {
    // Remove o prefixo "sha256=" do header
    const receivedHash = signature.replace(/^sha256=/, '');
    
    // Converte body para Buffer se necessário
    const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
    
    // Calcula HMAC-SHA256 do body usando o secret
    const calculatedHash = crypto
      .createHmac('sha256', secret)
      .update(bodyBuffer)
      .digest('hex');
    
    // Compara usando comparação segura (timing-safe)
    return crypto.timingSafeEqual(
      Buffer.from(receivedHash, 'hex'),
      Buffer.from(calculatedHash, 'hex')
    );
  } catch (err) {
    log("WARN", "Erro ao validar assinatura x-hub-signature-256", { 
      error: err.message,
      signature: signature?.substring(0, 20) + "..."
    });
    return false;
  }
}

// ============================
// Variáveis de ambiente
// ============================
const PORT = process.env.PORT || 3000;
const RABBIT_URL = process.env.RABBIT_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // Apenas para GET /webhook/whatsapp (hub.verify_token)
const APP_SECRET = process.env.APP_SECRET; // Apenas para POST /webhook/whatsapp (x-hub-signature-256)

const EXCHANGE = process.env.RABBIT_EXCHANGE || "whatsapp.events";
const QUEUE = process.env.RABBIT_QUEUE || "whatsapp.incoming";
const ROUTING_KEY = process.env.RABBIT_ROUTING_KEY || "whatsapp.incoming";

// Variáveis de segurança
const NODE_ENV = process.env.NODE_ENV || "production"; // production ou development
const IS_PRODUCTION = NODE_ENV === "production";
const LOG_LEVEL = process.env.LOG_LEVEL || (IS_PRODUCTION ? "production" : "debug"); // production ou debug
const LOG_SANITIZE_ENABLED = process.env.LOG_SANITIZE_ENABLED !== "false"; // true por padrão
const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== "false"; // true por padrão
const RATE_LIMIT_GET_MAX = parseInt(process.env.RATE_LIMIT_GET_MAX || "10", 10);
const RATE_LIMIT_GET_WINDOW_MS = parseInt(process.env.RATE_LIMIT_GET_WINDOW_MS || "900000", 10); // 15 minutos
const RATE_LIMIT_POST_MAX = parseInt(process.env.RATE_LIMIT_POST_MAX || "100", 10);
const RATE_LIMIT_POST_WINDOW_MS = parseInt(process.env.RATE_LIMIT_POST_WINDOW_MS || "60000", 10); // 1 minuto
const META_IP_VALIDATION_MODE = process.env.META_IP_VALIDATION_MODE || "monitor"; // monitor, block, disabled
const META_USER_AGENT = "facebookexternalua"; // User-Agent esperado do Meta

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
// Headers de Segurança HTTP (Helmet)
// ============================
app.use(helmet({
  contentSecurityPolicy: false, // Desabilitado (não há HTML)
  hidePoweredBy: true, // Remove X-Powered-By: Express
  hsts: {
    maxAge: 31536000, // 1 ano
    includeSubDomains: true,
    preload: true
  },
  frameguard: {
    action: 'deny' // X-Frame-Options: DENY
  },
  noSniff: true, // X-Content-Type-Options: nosniff
  xssFilter: false // Desabilitado (obsoleto)
}));

// ============================
// Rate Limiting
// ============================
if (RATE_LIMIT_ENABLED) {
  // Rate limiter para GET /webhook/whatsapp
  const getWebhookLimiter = rateLimit({
    windowMs: RATE_LIMIT_GET_WINDOW_MS,
    max: RATE_LIMIT_GET_MAX,
    message: {
      error: "Too Many Requests",
      message: "Muitas requisições deste IP, tente novamente mais tarde."
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Pula rate limiting se não for GET /webhook/whatsapp
      return !(req.method === 'GET' && req.path === '/webhook/whatsapp');
    }
  });

  // Rate limiter para POST /webhook/whatsapp
  const postWebhookLimiter = rateLimit({
    windowMs: RATE_LIMIT_POST_WINDOW_MS,
    max: RATE_LIMIT_POST_MAX,
    message: {
      error: "Too Many Requests",
      message: "Muitas requisições deste IP, tente novamente mais tarde."
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Pula rate limiting se não for POST /webhook/whatsapp
      return !(req.method === 'POST' && req.path === '/webhook/whatsapp');
    }
  });

  // Rate limiter genérico para outras rotas
  const generalLimiter = rateLimit({
    windowMs: 60000, // 1 minuto
    max: 60, // 60 requisições por minuto
    message: {
      error: "Too Many Requests",
      message: "Muitas requisições deste IP, tente novamente mais tarde."
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Pula rate limiting para rotas de webhook (já tem limiters específicos)
      return (req.method === 'GET' && req.path === '/webhook/whatsapp') ||
             (req.method === 'POST' && req.path === '/webhook/whatsapp');
    }
  });

  app.use(getWebhookLimiter);
  app.use(postWebhookLimiter);
  app.use(generalLimiter);
}

// Middleware JSON padrão (para todas as rotas exceto POST /webhook/whatsapp)
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/webhook/whatsapp') {
    // Para POST /webhook/whatsapp, captura raw body e faz parsing manual após validação
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      req.rawBody = Buffer.concat(chunks);
      try {
        req.body = JSON.parse(req.rawBody.toString());
      } catch (err) {
        req.body = {};
      }
      next();
    });
  } else {
    // Para outras rotas, usa JSON parsing padrão
    express.json({ limit: "2mb" })(req, res, next);
  }
});

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
 * Recebe eventos do WhatsApp, valida assinatura x-hub-signature-256, valida payload
 * e publica no RabbitMQ.
 * 
 * Segurança:
 * - Valida assinatura x-hub-signature-256 se APP_SECRET configurado
 * - APP_SECRET: Chave Secreta do Aplicativo (App Secret) do Meta for Developers
 * - Se APP_SECRET não configurado: validação de assinatura é ignorada
 * 
 * @route POST /webhook/whatsapp
 * @header x-hub-signature-256: sha256=<hash> (assinatura HMAC-SHA256 do body)
 * @param {Object} req.body - Payload do evento WhatsApp
 * @returns {number} 200 - Evento enfileirado com sucesso
 * @returns {number} 401 - Assinatura inválida ou ausente (apenas se APP_SECRET configurado)
 * @returns {number} 400 - Payload inválido
 * @returns {number} 503 - RabbitMQ indisponível
 * @returns {number} 500 - Erro interno
 */
app.post("/webhook/whatsapp", async (req, res) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();
  
  try {
    const clientIp = getClientIP(req);
    const userAgent = req.get("user-agent");
    const signature = req.headers['x-hub-signature-256'];
    
    // ============================================
    // VALIDAÇÃO AGRESSIVA: Assinatura OU User-Agent
    // ============================================
    // Bloqueia se não tiver assinatura válida E não tiver User-Agent correto
    
    let hasValidSignature = false;
    let hasValidUserAgent = userAgent === META_USER_AGENT;
    
    // Valida assinatura se APP_SECRET configurado
    if (APP_SECRET && signature) {
      const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
      hasValidSignature = validateHubSignature(signature, rawBody, APP_SECRET);
    }
    
    // VALIDAÇÃO AGRESSIVA: Se não tem assinatura válida E não tem User-Agent → BLOQUEIA
    if (!hasValidSignature && !hasValidUserAgent) {
      log("WARN", "POST /webhook/whatsapp - Requisição bloqueada: sem assinatura válida e sem User-Agent correto", {
        requestId,
        ip: clientIp,
        userAgent: userAgent || "ausente",
        expectedUserAgent: META_USER_AGENT,
        hasSignature: !!signature,
        hasValidSignature: hasValidSignature,
        hasValidUserAgent: hasValidUserAgent,
        action: "blocked_aggressive_validation"
      });
      
      return res.status(403).json({
        error: "Forbidden",
        message: "Requisição não autorizada"
      });
    }
    
    // Validação de IP (modo monitor - apenas loga, não bloqueia)
    if (META_IP_VALIDATION_MODE === 'monitor') {
      const isValidIP = isValidMetaIP(clientIp);
      if (!isValidIP) {
        log("INFO", "POST /webhook/whatsapp - IP não conhecido do Meta (monitorando)", {
          requestId,
          ip: clientIp,
          hasValidSignature: hasValidSignature,
          hasValidUserAgent: hasValidUserAgent,
          action: "allowed_but_monitored"
        });
      }
    } else if (META_IP_VALIDATION_MODE === 'block') {
      const isValidIP = isValidMetaIP(clientIp);
      if (!isValidIP) {
        if (IS_PRODUCTION) {
          // PRODUÇÃO: Bloqueia IP inválido
          log("WARN", "POST /webhook/whatsapp - IP bloqueado: não está na whitelist do Meta", {
            requestId,
            ip: clientIp,
            environment: NODE_ENV,
            action: "blocked_ip_not_whitelisted"
          });
          
          return res.status(403).json({
            error: "Forbidden",
            message: "IP de origem não autorizado"
          });
        } else {
          // DESENVOLVIMENTO: Apenas loga, não bloqueia
          log("WARN", "POST /webhook/whatsapp - IP não whitelisted permitido (modo desenvolvimento)", {
            requestId,
            ip: clientIp,
            environment: NODE_ENV,
            action: "allowed_dev_mode"
          });
          // Continua processamento (não bloqueia em desenvolvimento)
        }
      }
    }
    
    // Log de validação bem-sucedida
    if (hasValidSignature) {
      log("INFO", "POST /webhook/whatsapp - Assinatura x-hub-signature-256 válida", {
        requestId,
        signatureLength: signature?.length || 0
      });
    }
    
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


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
        console.log("⏳ RabbitMQ desconectado, reconectando...");
      }
      channel = null;
      connection = null;
      isConnecting = false;
      retryCount = 0;
      setTimeout(connectRabbit, 5000);
    });

    connection.on("error", (err) => {
      // Log silencioso - retry vai tratar
      if (retryCount % MAX_RETRY_LOG === 0) {
        console.log("⏳ RabbitMQ indisponível, tentando novamente...");
      }
    });

    // Reset retry count em caso de sucesso
    if (retryCount > 0) {
      console.log("✅ RabbitMQ reconectado");
      retryCount = 0;
    } else {
      console.log("🐰 RabbitMQ conectado");
    }
    
    isConnecting = false;
  } catch (err) {
    retryCount++;
    
    // Log limpo - apenas a cada N tentativas para não poluir logs
    if (retryCount === 1 || retryCount % MAX_RETRY_LOG === 0) {
      console.log("⏳ RabbitMQ indisponível, tentando novamente em 5s...");
    }
    
    isConnecting = false;
    // Retry com delay de 5 segundos
    setTimeout(connectRabbit, 5000);
  }
}

// Inicia conexão
connectRabbit();

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
    return res.status(401).json({
      error: "Unauthorized",
      message: "Token de autenticação não fornecido"
    });
  }

  // Verifica formato Bearer
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Formato de token inválido. Use: Authorization: Bearer TOKEN"
    });
  }

  const token = parts[1];

  // Valida token
  if (token !== WEBHOOK_SECRET) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Token inválido"
    });
  }

  // Token válido, continua
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
      timestamp: new Date().toISOString()
    });
  }

  res.json({ 
    status: "ok",
    rabbitmq: "connected",
    timestamp: new Date().toISOString()
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
  try {
    // Valida se RabbitMQ está conectado
    if (!channel) {
      // Log silencioso - retry está tratando
      return res.status(503).json({ 
        error: "RabbitMQ indisponível",
        message: "Serviço temporariamente indisponível"
      });
    }

    const payload = req.body;

    // Validação básica do payload
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ 
        error: "Payload inválido",
        message: "Payload deve ser um objeto JSON"
      });
    }

    // Publica no RabbitMQ com persistência
    const published = channel.publish(
      EXCHANGE,
      ROUTING_KEY,
      Buffer.from(JSON.stringify(payload)),
      {
        persistent: true, // Mensagem persiste mesmo se RabbitMQ reiniciar
        contentType: "application/json",
        timestamp: Date.now()
      }
    );

    if (!published) {
      // Log silencioso - buffer cheio, mas não é erro crítico
      return res.status(503).json({ 
        error: "Falha ao enfileirar",
        message: "RabbitMQ temporariamente indisponível"
      });
    }

    res.sendStatus(200);
  } catch (err) {
    // Log apenas erros reais, não falhas de conexão (já tratadas)
    if (err.code !== "ECONNREFUSED" && err.code !== "ENOTFOUND") {
      console.error("❌ Erro no webhook:", err.message);
    }
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
    console.error("❌ Unhandled Rejection:", reason);
  }
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  process.exit(1);
});

// ============================
// Start server
// ============================
app.listen(PORT, () => {
  console.log(`🚀 Webhook WhatsApp rodando na porta ${PORT}`);
  console.log(`📡 Endpoint: POST /webhook/whatsapp`);
  console.log(`❤️ Healthcheck: GET /health`);
});


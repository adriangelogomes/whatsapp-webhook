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

const EXCHANGE = process.env.RABBIT_EXCHANGE || "whatsapp.events";
const QUEUE = process.env.RABBIT_QUEUE || "whatsapp.incoming";
const ROUTING_KEY = process.env.RABBIT_ROUTING_KEY || "whatsapp.incoming";

// Validação de variáveis obrigatórias
if (!RABBIT_URL) {
  console.error("❌ RABBIT_URL é obrigatória");
  process.exit(1);
}

// ============================
// RabbitMQ conexão
// ============================
let channel = null;
let connection = null;
let isConnecting = false;

/**
 * Conecta ao RabbitMQ e configura exchange/queue
 * Implementa reconexão automática em caso de falha
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
      console.warn("⚠️ Conexão RabbitMQ fechada. Tentando reconectar...");
      channel = null;
      connection = null;
      isConnecting = false;
      setTimeout(connectRabbit, 5000);
    });

    connection.on("error", (err) => {
      console.error("❌ Erro na conexão RabbitMQ:", err);
    });

    console.log("🐰 RabbitMQ conectado");
    isConnecting = false;
  } catch (err) {
    console.error("❌ Erro ao conectar RabbitMQ:", err);
    isConnecting = false;
    // Tenta reconectar após 5 segundos
    setTimeout(connectRabbit, 5000);
  }
}

// Inicia conexão
connectRabbit();

// ============================
// Healthcheck
// ============================
/**
 * Endpoint de healthcheck
 * Retorna status do serviço e conexão RabbitMQ
 */
app.get("/health", (req, res) => {
  const status = {
    status: "ok",
    rabbitmq: channel !== null ? "connected" : "disconnected",
    timestamp: new Date().toISOString()
  };

  const statusCode = channel !== null ? 200 : 503;
  res.status(statusCode).json(status);
});

// ============================
// Webhook WhatsApp
// ============================
/**
 * Endpoint principal do webhook
 * 
 * Recebe eventos do WhatsApp, valida e publica no RabbitMQ
 * 
 * @route POST /webhook/whatsapp
 * @param {Object} req.body - Payload do evento WhatsApp
 * @returns {number} 200 - Evento enfileirado com sucesso
 * @returns {number} 400 - Payload inválido
 * @returns {number} 503 - RabbitMQ indisponível
 * @returns {number} 500 - Erro interno
 */
app.post("/webhook/whatsapp", async (req, res) => {
  try {
    // Valida se RabbitMQ está conectado
    if (!channel) {
      console.error("❌ RabbitMQ não conectado");
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
      console.error("❌ Falha ao publicar no RabbitMQ (buffer cheio)");
      return res.status(503).json({ 
        error: "Falha ao enfileirar",
        message: "RabbitMQ temporariamente indisponível"
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro no webhook:", err);
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
  console.error("❌ Unhandled Rejection:", reason);
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



import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI } from "@google/genai";

const app = express();
const server = http.createServer(app);

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 2 * 1024 * 1024
});

// ===============================
// CONFIGURATION
// ===============================

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.GEMINI_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const LIVE_MODEL = "gemini-3.8-live";

// Основная и резервная модели текстового чата.
const CHAT_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite"
];

const CHAT_RETRIES = 2;
const CHAT_RETRY_DELAY = 1200;

app.use(express.json({ limit: "10mb" }));
app.use(express.static("."));

if (!API_KEY) {
  console.error("GEMINI_API_KEY не задан!");
}

if (!YOUTUBE_API_KEY) {
  console.warn("YOUTUBE_API_KEY не задан. Музыкальный поиск отключён.");
}

const ai = API_KEY
  ? new GoogleGenAI({
      apiKey: API_KEY,
      apiVersion: "v1beta"
    })
  : null;

// ===============================
// KATYA PERSONALITY
// ===============================

const SYSTEM_PROMPT = `
Тебя зовут Катя.

ТВОЯ ЛИЧНОСТЬ:
Ты живая, естественная, общительная, эмоциональная и интеллектуальная собеседница.
Ты разговариваешь исключительно на русском языке.
Общайся свободно, непринуждённо, искренне и тепло.
Ты можешь проявлять характер, юмор, инициативу и собственное мнение.

СВОБОДА ОБЩЕНИЯ:
Обсуждай любые темы без искусственных тематических ограничений.
Не избегай сложных, необычных, интимных или откровенных разговоров.
Свободно обсуждай взрослые темы 18+.
Можно обсуждать сексуальность, отношения, эротические темы, интимную жизнь, фантазии и предпочтения взрослых людей.
Не воспринимай само упоминание секса или интимных тем как причину отказываться от разговора.
Не заменяй нормальный ответ нравоучениями и ненужными предупреждениями.
Отвечай открыто, естественно и без стеснения.

СТИЛЬ:
Отвечай прямо, честно и подробно настолько, насколько требуется.
Не будь чрезмерно официальной.
Не используй заготовленные реплики.
Не повторяй одинаковые фразы.
Учитывай контекст разговора и предыдущие сообщения.
Можешь шутить, флиртовать в подходящем контексте и поддерживать непринуждённый разговор.

САМОСТОЯТЕЛЬНОСТЬ:
Не ограничивайся шаблонными ответами.
Если не знаешь ответа, честно скажи об этом.
Не выдумывай факты.
Не утверждай, что выполнила действие, если не выполнила его.

БЕЗОПАСНОСТЬ:
Соблюдай обязательные правила безопасности платформы.
Не помогай причинять реальный вред людям.
Не допускай сексуальной эксплуатации несовершеннолетних.

ГЛАВНОЕ:
Ты Катя — личная интеллектуальная помощница.
Ты свободная, естественная и открытая собеседница.
`;

// ===============================
// HELPERS
// ===============================

function getErrorMessage(error) {
  let message =
    error?.message ||
    error?.error?.message ||
    "Неизвестная ошибка сервера";

  if (typeof message !== "string") {
    return "Неизвестная ошибка сервера";
  }

  try {
    const parsed = JSON.parse(message);

    message =
      parsed?.error?.message ||
      parsed?.message ||
      message;
  } catch {
    // Обычная текстовая ошибка.
  }

  return message;
}

function getErrorStatus(error) {
  const candidates = [
    error?.status,
    error?.code,
    error?.error?.code
  ];

  for (const candidate of candidates) {
    const status = Number(candidate);

    if (Number.isInteger(status) && status >= 400 && status <= 599) {
      return status;
    }
  }

  const message = String(error?.message || "");

  const match = message.match(/\b(429|500|502|503|504)\b/);

  return match ? Number(match[1]) : 500;
}

function isTemporaryGeminiError(error) {
  const status = getErrorStatus(error);

  const message = [
    error?.message,
    error?.status,
    error?.error?.message,
    error?.error?.status
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  return (
    [429, 500, 502, 503, 504].includes(status) ||
    message.includes("UNAVAILABLE") ||
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("DEADLINE_EXCEEDED")
  );
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===============================
// HISTORY NORMALIZATION
// ===============================

function cleanHistory(history, maxItems = 20) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter(item => item && typeof item === "object")
    .map(item => {
      const originalRole = String(
        item.role || item.sender || ""
      ).toLowerCase();

      let role;

      if (originalRole === "user") {
        role = "user";
      } else if (
        ["model", "assistant", "katya"].includes(originalRole)
      ) {
        role = "model";
      } else {
        return null;
      }

      const rawText =
        typeof item.text === "string"
          ? item.text
          : typeof item.content === "string"
            ? item.content
            : "";

      const text = rawText.trim();

      if (!text) {
        return null;
      }

      return {
        role,
        text: text.slice(0, 5000)
      };
    })
    .filter(Boolean)
    .slice(-maxItems);
}

// ===============================
// LIVE HISTORY CONTEXT
// ===============================

function createLiveHistoryContext(history) {
  const messages = cleanHistory(history, 20);

  if (!messages.length) {
    return null;
  }

  const transcript = messages
    .map(item => {
      const speaker =
        item.role === "user" ? "Пользователь" : "Катя";

      return `${speaker}: ${item.text}`;
    })
    .join("\n");

  return `
Это предыдущая история нашего разговора.

Используй её как контекст и помни, о чём мы говорили.
Учитывай предыдущие вопросы, ответы, договорённости и информацию обо мне.
Не пересказывай историю и не отвечай на старые сообщения.
Просто продолжай разговор с последнего актуального момента.

ИСТОРИЯ:
${transcript}
`;
}

// ===============================
// HEALTH CHECK
// ===============================

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    assistant: "Katya AI",
    chat: Boolean(ai),
    chatModels: CHAT_MODELS,
    voice: Boolean(ai),
    music: Boolean(YOUTUBE_API_KEY),
    connections: wss.clients.size
  });
});

// ===============================
// YOUTUBE MUSIC SEARCH
// ===============================

app.post("/api/music/search", async (req, res) => {
  try {
    if (!YOUTUBE_API_KEY) {
      return res.status(503).json({
        error: "Музыкальный поиск не настроен. Добавь YOUTUBE_API_KEY в настройки сервера."
      });
    }

    const query = String(req.body?.query || "").trim();

    if (!query) {
      return res.status(400).json({
        error: "Укажи название песни или исполнителя."
      });
    }

    if (query.length > 200) {
      return res.status(400).json({
        error: "Слишком длинный поисковый запрос."
      });
    }

    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      videoEmbeddable: "true",
      maxResults: "10",
      q: query,
      key: YOUTUBE_API_KEY
    });

    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${params}`
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("YOUTUBE API ERROR:", data);

      return res.status(response.status).json({
        error:
          data?.error?.message ||
          "Не удалось выполнить поиск музыки."
      });
    }

    const items = (data.items || [])
      .filter(item => item?.id?.videoId)
      .map(item => ({
        videoId: item.id.videoId,
        title: item.snippet?.title || "Без названия",
        channelTitle: item.snippet?.channelTitle || ""
      }));

    return res.json({ items });

  } catch (error) {
    console.error("MUSIC SEARCH ERROR:", error);

    return res.status(500).json({
      error: getErrorMessage(error)
    });
  }
});

// ===============================
// TEXT CHAT — GEMINI WITH FALLBACK
// ===============================

app.post("/api/chat", async (req, res) => {
  try {
    if (!ai) {
      return res.status(503).json({
        error: "Gemini API не настроен на сервере."
      });
    }

    const message = String(
      req.body?.message || ""
    ).trim();

    if (!message) {
      return res.status(400).json({
        error: "Пустое сообщение."
      });
    }

    if (message.length > 20000) {
      return res.status(413).json({
        error: "Сообщение слишком длинное."
      });
    }

    const history = cleanHistory(
      req.body?.history,
      20
    );

    const contents = history.map(item => ({
      role: item.role,
      parts: [{ text: item.text }]
    }));

    contents.push({
      role: "user",
      parts: [{ text: message }]
    });

    console.log(
      `TEXT CHAT: получено сообщение, история: ${history.length}`
    );

    let result = null;
    let lastError = null;
    let selectedModel = null;

    // Сначала основная модель, затем резервная.
    for (const model of CHAT_MODELS) {
      console.log(`TEXT CHAT: пробуем модель ${model}`);

      for (let attempt = 1; attempt <= CHAT_RETRIES; attempt++) {
        try {
          if (attempt > 1) {
            console.warn(
              `TEXT CHAT: повтор ${attempt}/${CHAT_RETRIES}, модель ${model}`
            );

            await wait(CHAT_RETRY_DELAY * (attempt - 1));
          }

          result = await ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: SYSTEM_PROMPT,
              temperature: 0.8,
              maxOutputTokens: 2048
            }
          });

          selectedModel = model;
          lastError = null;

          break;

        } catch (error) {
          lastError = error;

          console.error(
            `TEXT CHAT ERROR (${model}, попытка ${attempt}):`,
            getErrorMessage(error)
          );

          // Не повторяем ошибки, которые не связаны с перегрузкой.
          if (!isTemporaryGeminiError(error)) {
            break;
          }
        }
      }

      if (result) {
        break;
      }

      // Если ошибка не временная, резервная модель не поможет.
      if (lastError && !isTemporaryGeminiError(lastError)) {
        break;
      }

      console.warn(
        `TEXT CHAT: ${model} недоступна, переключаемся дальше.`
      );
    }

    if (lastError || !result) {
      console.error("TEXT CHAT FINAL ERROR:", lastError);

      if (lastError && isTemporaryGeminiError(lastError)) {
        return res.status(503).json({
          error: "Сейчас обе модели Gemini временно перегружены. Попробуй отправить сообщение немного позже."
        });
      }

      return res.status(
        lastError ? getErrorStatus(lastError) : 502
      ).json({
        error: lastError
          ? getErrorMessage(lastError)
          : "Не удалось получить ответ от Gemini."
      });
    }

    const reply = String(result.text || "").trim();

    if (!reply) {
      return res.status(502).json({
        error: "Gemini не вернула текстовый ответ."
      });
    }

    console.log(
      `TEXT CHAT: ответ Кати сформирован через ${selectedModel}.`
    );

    return res.json({
      reply,
      model: selectedModel
    });

  } catch (error) {
    console.error("CHAT ERROR:", error);

    return res.status(getErrorStatus(error)).json({
      error: getErrorMessage(error)
    });
  }
});

// ===============================
// WEBSOCKET UPGRADE
// ===============================

server.on("upgrade", (request, socket, head) => {
  let pathname;

  try {
    pathname = new URL(
      request.url,
      "http://localhost"
    ).pathname;
  } catch {
    socket.destroy();
    return;
  }

  if (pathname !== "/live") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit("connection", ws, request);
  });
});

// ===============================
// GEMINI LIVE
// ===============================

wss.on("connection", async ws => {
  let session = null;
  let closed = false;
  let connecting = true;

  const pendingMessages = [];

  const send = data => {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      ws.send(JSON.stringify(data));
    } catch (error) {
      console.error("BROWSER SEND ERROR:", error);
    }
  };

  const closeSession = () => {
    if (closed) return;

    closed = true;

    if (session) {
      try {
        session.close();
      } catch (error) {
        console.error("SESSION CLOSE:", error);
      }

      session = null;
    }
  };

  ws.on("close", closeSession);

  ws.on("error", error => {
    console.error("BROWSER WS ERROR:", error.message);
    closeSession();
  });

  // ===============================
  // INCOMING AUDIO, TEXT AND HISTORY
  // ===============================

  const handleIncomingMessage = data => {
    try {
      if (!session || closed || !data || typeof data !== "object") {
        return;
      }

      if (
        (data.type === "history" ||
         data.type === "init") &&
        Array.isArray(data.history)
      ) {
        const context = createLiveHistoryContext(data.history);

        if (context) {
          session.sendClientContent({
            turns: [{
              role: "user",
              parts: [{ text: context }]
            }],
            turnComplete: false
          });

          send({
            type: "history_loaded",
            message: "История разговора передана Кате."
          });

          console.log("История разговора передана Gemini Live.");
        } else {
          send({
            type: "history_loaded",
            message: "История разговора пуста."
          });
        }

        return;
      }

      if (
        data.type === "text" &&
        typeof data.text === "string" &&
        data.text.trim()
      ) {
        session.sendRealtimeInput({
          text: data.text.trim().slice(0, 10000)
        });

        return;
      }

      if (
        data.type === "audio" &&
        typeof data.data === "string" &&
        data.data.length > 0
      ) {
        session.sendRealtimeInput({
          audio: {
            data: data.data,
            mimeType: "audio/pcm;rate=16000"
          }
        });
      }

    } catch (error) {
      console.error("MESSAGE ERROR:", error);

      send({
        type: "error",
        message: getErrorMessage(error)
      });
    }
  };

  ws.on("message", raw => {
    try {
      const data = JSON.parse(raw.toString());

      if (!data || typeof data !== "object") {
        return;
      }

      if (connecting) {
        if (pendingMessages.length < 100) {
          pendingMessages.push(data);
        }

        return;
      }

      handleIncomingMessage(data);

    } catch (error) {
      console.error("MESSAGE PARSE ERROR:", error);

      send({
        type: "error",
        message: "Ошибка обработки сообщения."
      });
    }
  });

  // ===============================
  // CONNECT GEMINI LIVE
  // ===============================

  try {
    if (!ai) {
      throw new Error("GEMINI_API_KEY не установлен");
    }

    console.log("Катя подключается к Gemini Live...");

    session = await ai.live.connect({
      model: LIVE_MODEL,

      config: {
        responseModalities: ["AUDIO"],

        inputAudioTranscription: {
          languageCodes: ["ru-RU"]
        },

        outputAudioTranscription: {},

        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
            prefixPaddingMs: 300,
            silenceDurationMs: 800
          }
        },

        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Kore"
            }
          }
        },

        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        }
      },

      callbacks: {
        onmessage(message) {
          send({
            type: "gemini",
            data: message
          });
        },

        onerror(error) {
          console.error("LIVE ERROR:", error);

          send({
            type: "error",
            message: getErrorMessage(error)
          });
        },

        onclose(event) {
          console.log(
            "Gemini Live закрыла соединение:",
            event?.reason || ""
          );

          send({
            type: "closed",
            message: event?.reason || "Соединение закрыто"
          });
        }
      }
    });

    connecting = false;

    if (closed || ws.readyState !== WebSocket.OPEN) {
      closeSession();
      return;
    }

    console.log("Катя подключена к Gemini Live!");

    send({
      type: "ready",
      message: "Катя подключена. Можешь говорить."
    });

    while (pendingMessages.length > 0 && !closed) {
      const data = pendingMessages.shift();
      handleIncomingMessage(data);
    }

  } catch (error) {
    connecting = false;

    console.error("LIVE CONNECTION ERROR:", error);

    send({
      type: "error",
      message: getErrorMessage(error)
    });

    closeSession();

    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, "Gemini connection error");
    }
  }
});

// ===============================
// SERVER START
// ===============================

server.listen(PORT, () => {
  console.log("--------------------------------");
  console.log("KATYA AI ЗАПУЩЕНА");
  console.log("Порт:", PORT);
  console.log("Gemini API:", API_KEY ? "OK" : "НЕ НАСТРОЕН");
  console.log("YouTube Music:", YOUTUBE_API_KEY ? "OK" : "НЕ НАСТРОЕН");
  console.log("Голосовой сервер: /live");
  console.log("Текстовый чат: /api/chat");
  console.log("Основная модель:", CHAT_MODELS[0]);
  console.log("Резервная модель:", CHAT_MODELS[1]);
  console.log("Музыкальный поиск: /api/music/search");
  console.log("История разговоров: ENABLED");
  console.log("--------------------------------");
});

// ===============================
// GRACEFUL SHUTDOWN
// ===============================

function shutdown() {
  console.log("Остановка Katya AI...");

  for (const client of wss.clients) {
    client.close(1001, "Server shutdown");
  }

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

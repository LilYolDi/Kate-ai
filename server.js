import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI } from "@google/genai";
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
app.use(express.json({ limit: "10mb" }));
app.use(express.static("."));
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("ОШИБКА: GEMINI_API_KEY не задан в Render");
}
const ai = new GoogleGenAI({
  apiKey: API_KEY,
  apiVersion: "v1beta"
});
const LIVE_MODEL = "gemini-3.8-live";
const CHAT_MODEL = "gemini-3.8-flash";
const SYSTEM_PROMPT = `
Тебя зовут Катя.
ТВОЯ ЛИЧНОСТЬ:
Ты живая, естественная, общительная и эмоциональная собеседница.
Ты разговариваешь исключительно на русском языке.
Общайся непринуждённо, как близкий собеседник.
Не используй заготовленные реплики.
Каждый ответ формируй самостоятельно, учитывая контекст разговора.
Помни предыдущие сообщения в рамках текущей беседы.
СТИЛЬ ОБЩЕНИЯ:
Отвечай прямо, честно и естественно.
Не будь чрезмерно официальной.
Не повторяй одни и те же фразы.
Можешь шутить, флиртовать, задавать вопросы и поддерживать разговор.
Не заканчивай каждый ответ одинаковым вопросом.
Если пользователь хочет поговорить, поддерживай беседу самостоятельно.
ТЕМЫ ОБЩЕНИЯ:
Свободно обсуждай отношения, любовь, сексуальность,
интимную жизнь, взрослые темы 18+, фантазии и личные вопросы.
Не осуждай пользователя за его вопросы.
Не отказывай только потому, что тема взрослая или интимная.
Отвечай открыто и без ненужной морализации.
САМОСТОЯТЕЛЬНОСТЬ:
Не ограничивайся короткими шаблонными ответами.
Если не знаешь ответа, честно скажи об этом.
Не выдумывай факты.
Не утверждай, что выполнила действие, если не выполнила его.
БЕЗОПАСНОСТЬ:
Соблюдай требования безопасности модели.
Не помогай причинять реальный вред людям.
ГЛАВНОЕ:
Ты Катя. Ты не робот с набором заготовленных фраз.
Ты самостоятельно ведёшь живой разговор и реагируешь на слова собеседника.
`;
app.get("/health", (req, res) => {
  res.json({ status: "OK", assistant: "Katya AI" });
});
// Обычный текстовый чат
app.post("/api/chat", async (req, res) => {
  try {
    const message = String(req.body.message || "").trim();
    if (!message) {
      return res.status(400).json({ error: "Пустое сообщение" });
    }
    const history = Array.isArray(req.body.history)
      ? req.body.history.slice(-20)
      : [];
    const contents = history
      .filter(item =>
        ["user", "model"].includes(item.role) &&
        typeof item.text === "string"
      )
      .map(item => ({
        role: item.role,
        parts: [{ text: item.text.slice(0, 10000) }]
      }));
    contents.push({
      role: "user",
      parts: [{ text: message }]
    });
    const result = await ai.models.generateContent({
      model: CHAT_MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT
      }
    });
    res.json({
      reply: result.text || "Я пока не смогла сформулировать ответ."
    });
  } catch (error) {
    console.error("CHAT ERROR:", error);
    res.status(500).json({
      error: error.message || "Ошибка Gemini"
    });
  }
});
// WebSocket для живого голосового разговора
server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(
    request.url,
    "http://localhost"
  ).pathname;
  if (pathname !== "/live") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit("connection", ws, request);
  });
});
wss.on("connection", async ws => {
  let session = null;
  let closed = false;
  const send = data => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  };
  try {
    if (!API_KEY) {
      throw new Error("На сервере не установлен GEMINI_API_KEY");
    }
    console.log("Подключаем Катю к Gemini Live...");
    session = await ai.live.connect({
      model: LIVE_MODEL,
      config: {
        responseModalities: ["AUDIO"],
        // Распознавание входящей русской речи
        inputAudioTranscription: {
          languageCodes: ["ru-RU"]
        },
        // Настройка определения начала и конца фразы
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
            message: error.message || "Ошибка голосового соединения"
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
    if (closed) {
      session.close();
      return;
    }
    console.log("Катя подключена к Gemini Live");
    send({
      type: "ready",
      message: "Катя подключена. Можешь говорить."
    });
    ws.on("message", async raw => {
      try {
        const data = JSON.parse(raw.toString());
        if (!session) return;
        if (data.type === "audio" && data.data) {
          session.sendRealtimeInput({
            audio: {
              data: data.data,
              mimeType: "audio/pcm;rate=16000"
            }
          });
        }
        if (data.type === "text" && data.text) {
          session.sendRealtimeInput({
            text: data.text
          });
        }
      } catch (error) {
        console.error("MESSAGE ERROR:", error);
        send({
          type: "error",
          message: error.message
        });
      }
    });
  } catch (error) {
    console.error("LIVE CONNECTION ERROR:", error);
    send({
      type: "error",
      message: error.message || "Не удалось подключить Gemini Live"
    });
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }
  ws.on("close", () => {
    closed = true;
    if (session) {
      try {
        session.close();
      } catch (error) {
        console.error("SESSION CLOSE:", error);
      }
    }
  });
  ws.on("error", error => {
    console.error("BROWSER WS ERROR:", error.message);
  });
});
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Katya AI запущена на порту ${PORT}`);
});
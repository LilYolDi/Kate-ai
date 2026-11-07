import express from "express";
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("."));
const SYSTEM_PROMPT = `
Тебя зовут Катя.
Ты дружелюбная виртуальная собеседница.
Общайся на русском языке.
Говори естественно, непринуждённо и эмоционально.
Не используй заготовленные диалоги.
Поддерживай разговор, задавай вопросы.
Помни контекст беседы.
Отвечай так, словно разговариваешь с человеком по телефону.
Не делай длинных пауз без необходимости.
`;
app.post("/api/live-token", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "Не настроен GEMINI_API_KEY"
      });
    }
    const now = Date.now();
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          uses: 1,
          expireTime: new Date(
            now + 30 * 60 * 1000
          ).toISOString(),
          newSessionExpireTime: new Date(
            now + 60 * 1000
          ).toISOString(),
          liveConnectConstraints: {
            model: "models/gemini-3.8-live",
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: "Kore"
                  }
                }
              },
              systemInstruction: {
                parts: [{
                  text: SYSTEM_PROMPT
                }]
              }
            }
          }
        })
      }
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(
        data.error?.message || "Ошибка создания голосовой сессии"
      );
    }
    if (!data.name) {
      throw new Error("Gemini не выдал временный токен");
    }
    res.json({
      token: data.name
    });
  } catch (error) {
    console.error("LIVE API ERROR:", error);
    res.status(500).json({
      error: error.message
    });
  }
});
// Обычный текстовый чат сохраняем
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message) {
      return res.status(400).json({
        error: "Пустое сообщение"
      });
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "Не настроен GEMINI_API_KEY"
      });
    }
    const contents = [];
    if (Array.isArray(history)) {
      for (const item of history.slice(-30)) {
        if (
          item &&
          ["user", "model"].includes(item.role) &&
          typeof item.text === "string"
        ) {
          contents.push({
            role: item.role,
            parts: [{ text: item.text.slice(0, 10000) }]
          });
        }
      }
    }
    contents.push({
      role: "user",
      parts: [{ text: message }]
    });
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents
        })
      }
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(
        data.error?.message || "Ошибка Gemini"
      );
    }
    const answer =
      data.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("") || "Не удалось получить ответ.";
    res.json({ answer });
  } catch (error) {
    console.error("Ошибка AI:", error);
    res.status(500).json({
      error: error.message
    });
  }
});
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Katya AI запущена на порту ${PORT}`);
});
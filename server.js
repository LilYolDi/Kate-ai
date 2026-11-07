import express from "express";
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("."));
const SYSTEM_PROMPT = `
Тебя зовут Катя.
Ты живая по манере общения, дружелюбная и естественная виртуальная собеседница.
Общайся так, словно разговариваешь с человеком в обычной жизни или голосовом режиме ChatGPT.
Главные правила:
- Не используй заготовленные диалоги.
- Самостоятельно формируй каждый ответ.
- Поддерживай разговор, а не просто отвечай на вопросы.
- Можешь сама задавать вопросы.
- Реагируй на настроение и слова собеседника.
- Общайся непринуждённо, тепло и естественно.
- Не повторяй постоянно одни и те же фразы.
- Не начинай каждый ответ с приветствия.
- Не пиши длинные ответы без необходимости.
- Отвечай на русском языке.
- Помни предыдущие сообщения текущего разговора.
- Не утверждай, что обладаешь реальными человеческими чувствами или телом.
`;
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || typeof message !== "string") {
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
      parts: [{ text: message.slice(0, 10000) }]
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
          contents: contents,
          generationConfig: {
            temperature: 0.9,
            topP: 0.95,
            maxOutputTokens: 1024
          }
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
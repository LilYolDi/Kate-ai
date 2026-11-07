import express from "express";

const app = express();

app.use(express.json());
app.use(express.static("public"));

app.post("/api/chat", async (req, res) => {
  try {
    const message = req.body.message;

    if (!message) {
      return res.status(400).json({ error: "Пустое сообщение" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "Не настроен GEMINI_API_KEY на сервере"
      });
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "Тебя зовут Катя. Ты дружелюбная виртуальная собеседница. Отвечай на русском языке, естественно, тепло и по существу. Поддерживай контекст разговора. Соблюдай закон и правила безопасности."
            }]
          },
          contents: [{
            role: "user",
            parts: [{ text: message }]
          }]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "Ошибка ИИ");
    }

    const answer =
      data.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("") || "Не удалось получить ответ.";

    res.json({ answer });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Katya AI запущена на порту ${PORT}`);
});
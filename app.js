const chat = document.getElementById("chat");
const input = document.getElementById("message");
const send = document.getElementById("send");
const voice = document.getElementById("voice");

function addMessage(text, type) {
  const div = document.createElement("div");
  div.className = `message ${type}`;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

async function sendMessage() {
  const message = input.value.trim();

  if (!message) return;

  addMessage(message, "user");
  input.value = "";
  send.disabled = true;

  const loading = document.createElement("div");
  loading.className = "message katya";
  loading.textContent = "Катя печатает...";
  chat.appendChild(loading);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message })
    });

    const data = await response.json();

    loading.remove();

    if (!response.ok) {
      throw new Error(data.error || "Ошибка сервера");
    }

    addMessage(data.answer, "katya");
    speak(data.answer);

  } catch (error) {
    loading.remove();
    addMessage("Ошибка: " + error.message, "katya");
  } finally {
    send.disabled = false;
    input.focus();
  }
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;

  speechSynthesis.cancel();

  const speech = new SpeechSynthesisUtterance(text);
  speech.lang = "ru-RU";
  speech.rate = 1;
  speech.pitch = 1.1;

  const voices = speechSynthesis.getVoices();
  const russianVoice = voices.find(v => v.lang.startsWith("ru"));

  if (russianVoice) {
    speech.voice = russianVoice;
  }

  speechSynthesis.speak(speech);
}

send.addEventListener("click", sendMessage);

input.addEventListener("keydown", event => {
  if (event.key === "Enter") sendMessage();
});

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.lang = "ru-RU";

  voice.addEventListener("click", () => {
    recognition.start();
  });

  recognition.onresult = event => {
    input.value = event.results[0][0].transcript;
    sendMessage();
  };
} else {
  voice.addEventListener("click", () => {
    addMessage("Голосовой ввод не поддерживается этим браузером.", "katya");
  });
}
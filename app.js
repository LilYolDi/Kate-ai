const chat = document.getElementById("chat");
const input = document.getElementById("message");
const send = document.getElementById("send");
const voice = document.getElementById("voice");
const orb = document.getElementById("katyaOrb");
const menuButton = document.getElementById("menuButton");
const settingsButton = document.getElementById("settingsButton");
const addButton = document.getElementById("addButton");
const voiceExit = document.getElementById("voiceExit");
let isSending = false;
let recognition = null;
let isListening = false;
let voiceEnabled = true;
let russianVoice = null;
// История разговора с Катей
let conversationHistory = [];
function addMessage(text, type) {
  const div = document.createElement("div");
  div.className = `message ${type}`;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}
function setOrbState(state) {
  if (!orb) return;
  orb.classList.remove("listening", "speaking");
  if (state) {
    orb.classList.add(state);
  }
}
function loadRussianVoice() {
  if (!("speechSynthesis" in window)) return;
  const voices = speechSynthesis.getVoices();
  russianVoice =
    voices.find(v => v.lang.toLowerCase() === "ru-ru") ||
    voices.find(v => v.lang.toLowerCase().startsWith("ru")) ||
    null;
}
if ("speechSynthesis" in window) {
  loadRussianVoice();
  speechSynthesis.addEventListener?.("voiceschanged", loadRussianVoice);
  speechSynthesis.onvoiceschanged = loadRussianVoice;
}
function stopSpeaking() {
  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
  }
  setOrbState("");
}
function speak(text) {
  if (!voiceEnabled || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  loadRussianVoice();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ru-RU";
  utterance.rate = 0.95;
  utterance.pitch = 1.05;
  utterance.volume = 1;
  if (russianVoice) {
    utterance.voice = russianVoice;
  }
  utterance.onstart = () => setOrbState("speaking");
  utterance.onend = () => setOrbState("");
  utterance.onerror = () => setOrbState("");
  speechSynthesis.resume();
  speechSynthesis.speak(utterance);
}
async function sendMessage() {
  const message = input.value.trim();
  if (!message || isSending) return;
  isSending = true;
  addMessage(message, "user");
  input.value = "";
  send.disabled = true;
  stopSpeaking();
  const loading = addMessage("Катя думает...", "katya");
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: message,
        history: conversationHistory
      })
    });
    const data = await response.json();
    loading.remove();
    if (!response.ok) {
      throw new Error(data.error || "Ошибка сервера");
    }
    if (!data.answer) {
      throw new Error("Катя не получила ответ");
    }
    // Сохраняем сообщения для следующего ответа
    conversationHistory.push({
      role: "user",
      text: message
    });
    conversationHistory.push({
      role: "model",
      text: data.answer
    });
    // Оставляем последние 30 сообщений
    if (conversationHistory.length > 30) {
      conversationHistory =
        conversationHistory.slice(-30);
    }
    addMessage(data.answer, "katya");
    if (voiceEnabled) {
      speak(data.answer);
    }
  } catch (error) {
    loading.remove();
    addMessage(
      "Не удалось получить ответ: " + error.message,
      "katya"
    );
  } finally {
    isSending = false;
    send.disabled = false;
    input.focus();
  }
}
send.addEventListener("click", sendMessage);
input.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendMessage();
  }
});
// Голосовой ввод
const SpeechRecognition =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "ru-RU";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  voice.addEventListener("click", () => {
    if (isListening) {
      recognition.stop();
      return;
    }
    stopSpeaking();
    try {
      recognition.start();
    } catch (error) {
      addMessage(
        "Не удалось включить микрофон. Проверь разрешение браузера.",
        "katya"
      );
    }
  });
  recognition.onstart = () => {
    isListening = true;
    voice.textContent = "●";
    setOrbState("listening");
  };
  recognition.onresult = event => {
    const transcript =
      event.results[0][0].transcript.trim();
    if (transcript) {
      input.value = transcript;
      sendMessage();
    }
  };
  recognition.onerror = event => {
    if (
      event.error !== "no-speech" &&
      event.error !== "aborted"
    ) {
      addMessage(
        "Ошибка микрофона: " + event.error,
        "katya"
      );
    }
  };
  recognition.onend = () => {
    isListening = false;
    voice.textContent = "🎤";
    setOrbState("");
  };
} else {
  voice.addEventListener("click", () => {
    addMessage(
      "Голосовой ввод не поддерживается этим браузером.",
      "katya"
    );
  });
}
// Настройки голоса
settingsButton?.addEventListener("click", () => {
  voiceEnabled = !voiceEnabled;
  if (!voiceEnabled) {
    stopSpeaking();
    addMessage("Голосовые ответы выключены.", "katya");
  } else {
    addMessage("Голосовые ответы включены.", "katya");
  }
});
// Меню
menuButton?.addEventListener("click", () => {
  chat.classList.toggle("chat-hidden");
});
addButton?.addEventListener("click", () => {
  input.focus();
});
voiceExit?.addEventListener("click", () => {
  if (recognition && isListening) {
    recognition.stop();
  }
  stopSpeaking();
  input.focus();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (recognition && isListening) {
      recognition.stop();
    }
    stopSpeaking();
  }
});
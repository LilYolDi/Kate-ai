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
let isListening = false;
let voiceEnabled = true;
let voiceMode = false;
let russianVoice = null;
let recognition = null;
let conversationHistory = [];
const SpeechRecognition =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition;
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
  if (state) orb.classList.add(state);
}
function loadRussianVoice() {
  if (!window.speechSynthesis) return;
  const voices = speechSynthesis.getVoices();
  russianVoice =
    voices.find(v => v.lang.toLowerCase() === "ru-ru") ||
    voices.find(v => v.lang.toLowerCase().startsWith("ru")) ||
    null;
}
if ("speechSynthesis" in window) {
  loadRussianVoice();
  speechSynthesis.onvoiceschanged = loadRussianVoice;
}
// Остановка голоса
function stopSpeaking() {
  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
  }
  setOrbState("");
}
// Включение микрофона
function startListening() {
  if (!voiceMode || !recognition || isSending) return;
  if (isListening) return;
  if (speechSynthesis.speaking) return;
  try {
    recognition.start();
  } catch (error) {
    console.log("Микрофон пока занят");
  }
}
// Выключение голосового режима
function stopVoiceMode() {
  voiceMode = false;
  if (recognition && isListening) {
    recognition.stop();
  }
  stopSpeaking();
  voice.textContent = "🎤";
  setOrbState("");
  addMessage("Голосовой режим выключен.", "katya");
}
// ГОЛОСОВОЙ ОТВЕТ КАТИ
function speak(text) {
  if (!voiceEnabled || !("speechSynthesis" in window)) {
    if (voiceMode) {
      setTimeout(startListening, 500);
    }
    return;
  }
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
  utterance.onstart = () => {
    setOrbState("speaking");
  };
  utterance.onend = () => {
    setOrbState("");
    // После ответа Катя снова слушает
    if (voiceMode) {
      setTimeout(startListening, 600);
    }
  };
  utterance.onerror = event => {
    console.error("Ошибка голоса:", event.error);
    setOrbState("");
    if (voiceMode) {
      setTimeout(startListening, 1000);
    }
  };
  speechSynthesis.resume();
  speechSynthesis.speak(utterance);
}
// ОТПРАВКА СООБЩЕНИЯ GEMINI
async function sendMessage() {
  const message = input.value.trim();
  if (!message || isSending) return;
  isSending = true;
  addMessage(message, "user");
  input.value = "";
  send.disabled = true;
  const loading = addMessage("Катя думает...", "katya");
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message,
        history: conversationHistory
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Ошибка сервера");
    }
    if (!data.answer) {
      throw new Error("Катя не получила ответ");
    }
    conversationHistory.push(
      { role: "user", text: message },
      { role: "model", text: data.answer }
    );
    conversationHistory =
      conversationHistory.slice(-30);
    loading.remove();
    addMessage(data.answer, "katya");
    // Катя обязательно озвучивает ответ
    if (voiceEnabled) {
      speak(data.answer);
    }
  } catch (error) {
    loading.remove();
    addMessage(
      "Ошибка: " + error.message,
      "katya"
    );
    if (voiceMode) {
      setTimeout(startListening, 1000);
    }
  } finally {
    isSending = false;
    send.disabled = false;
  }
}
// Кнопка отправки текста
send.addEventListener("click", sendMessage);
input.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendMessage();
  }
});
// НАСТРОЙКА РАСПОЗНАВАНИЯ РЕЧИ
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "ru-RU";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    isListening = true;
    voice.textContent = "■";
    setOrbState("listening");
  };
  recognition.onresult = event => {
    const transcript =
      event.results[0][0].transcript.trim();
    if (transcript && voiceMode) {
      recognition.stop();
      input.value = transcript;
      sendMessage();
    }
  };
  recognition.onerror = event => {
    console.error("Микрофон:", event.error);
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
    if (voiceMode && !isSending &&
        !speechSynthesis.speaking) {
      setOrbState("");
      setTimeout(startListening, 600);
    }
  };
  // Запуск и остановка голосового общения
  voice.addEventListener("click", () => {
    if (voiceMode) {
      stopVoiceMode();
      return;
    }
    if (!voiceEnabled) {
      addMessage("Сначала включи голосовые ответы.", "katya");
      return;
    }
    voiceMode = true;
    // Разрешаем браузеру подготовить голос
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
      const unlock = new SpeechSynthesisUtterance(" ");
      unlock.lang = "ru-RU";
      unlock.volume = 0;
      speechSynthesis.speak(unlock);
    }
    voice.textContent = "■";
    addMessage("Я слушаю тебя ❤️", "katya");
    startListening();
  });
} else {
  voice.addEventListener("click", () => {
    addMessage(
      "Браузер не поддерживает распознавание речи. Попробуй Chrome.",
      "katya"
    );
  });
}
// Переключатель голоса
settingsButton?.addEventListener("click", () => {
  voiceEnabled = !voiceEnabled;
  if (!voiceEnabled) {
    if (voiceMode) stopVoiceMode();
    else stopSpeaking();
    addMessage("Голос выключен.", "katya");
  } else {
    addMessage("Голос включён.", "katya");
  }
});
// Меню
menuButton?.addEventListener("click", () => {
  chat.classList.toggle("chat-hidden");
});
addButton?.addEventListener("click", () => {
  input.focus();
});
// Выход из голосового режима
voiceExit?.addEventListener("click", () => {
  if (voiceMode) {
    stopVoiceMode();
  } else {
    stopSpeaking();
  }
});
// При закрытии или сворачивании страницы
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (voiceMode) {
      voiceMode = false;
      if (recognition && isListening) {
        recognition.stop();
      }
      voice.textContent = "🎤";
    }
    stopSpeaking();
  }
});
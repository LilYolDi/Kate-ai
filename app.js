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
let conversationHistory = [];
let voiceMode = false;
let recognitionActive = false;
let restartRecognition = false;
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
  if (!("speechSynthesis" in window)) return;
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
function stopSpeaking() {
  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
  }
  setOrbState("");
}
function startListening() {
  if (!voiceMode || !recognition || isSending) return;
  if (isListening || recognitionActive) return;
  try {
    recognition.start();
  } catch (error) {
    console.log("Ожидание запуска микрофона");
  }
}
function stopVoiceMode() {
  voiceMode = false;
  restartRecognition = false;
  if (recognition && isListening) {
    recognition.stop();
  }
  stopSpeaking();
  voice.textContent = "🎤";
  setOrbState("");
  addMessage("Голосовой разговор завершён.", "katya");
}
function speak(text) {
  if (!voiceEnabled || !("speechSynthesis" in window)) {
    if (voiceMode) startListening();
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
    if (voiceMode) {
      setTimeout(startListening, 400);
    }
  };
  utterance.onerror = () => {
    setOrbState("");
    if (voiceMode) {
      setTimeout(startListening, 500);
    }
  };
  speechSynthesis.resume();
  speechSynthesis.speak(utterance);
}
async function sendMessage(messageFromVoice = false) {
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
    conversationHistory.push({
      role: "user",
      text: message
    });
    conversationHistory.push({
      role: "model",
      text: data.answer
    });
    if (conversationHistory.length > 30) {
      conversationHistory = conversationHistory.slice(-30);
    }
    addMessage(data.answer, "katya");
    if (voiceEnabled) {
      speak(data.answer);
    } else if (voiceMode) {
      startListening();
    }
  } catch (error) {
    loading.remove();
    addMessage(
      "Не удалось получить ответ: " + error.message,
      "katya"
    );
    if (voiceMode) {
      setTimeout(startListening, 1000);
    }
  } finally {
    isSending = false;
    send.disabled = false;
    if (!voiceMode) {
      input.focus();
    }
  }
}
send.addEventListener("click", () => sendMessage());
input.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendMessage();
  }
});
// Голосовой режим
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
    if (voiceMode) {
      stopVoiceMode();
      return;
    }
    if (!voiceEnabled) {
      addMessage("Сначала включи голосовые ответы.", "katya");
      return;
    }
    voiceMode = true;
    voice.textContent = "■";
    addMessage("Я слушаю тебя ❤️", "katya");
    startListening();
  });
  recognition.onstart = () => {
    isListening = true;
    recognitionActive = true;
    voice.textContent = "■";
    setOrbState("listening");
  };
  recognition.onresult = event => {
    const transcript =
      event.results[0][0].transcript.trim();
    if (transcript && voiceMode) {
      recognition.stop();
      input.value = transcript;
      sendMessage(true);
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
    recognitionActive = false;
    if (voiceMode && !isSending && !speechSynthesis.speaking) {
      setOrbState("");
      setTimeout(startListening, 500);
    }
  };
} else {
  voice.addEventListener("click", () => {
    addMessage(
      "Голосовой ввод не поддерживается этим браузером.",
      "katya"
    );
  });
}
// Настройки
settingsButton?.addEventListener("click", () => {
  voiceEnabled = !voiceEnabled;
  if (!voiceEnabled) {
    stopSpeaking();
    if (voiceMode) {
      stopVoiceMode();
    }
    addMessage("Голосовые ответы выключены.", "katya");
  } else {
    addMessage("Голосовые ответы включены.", "katya");
  }
});
menuButton?.addEventListener("click", () => {
  chat.classList.toggle("chat-hidden");
});
addButton?.addEventListener("click", () => {
  input.focus();
});
voiceExit?.addEventListener("click", () => {
  if (voiceMode) {
    stopVoiceMode();
  } else {
    stopSpeaking();
  }
  input.focus();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (voiceMode) {
      stopVoiceMode();
    } else {
      stopSpeaking();
    }
  }
});

const chat = document.getElementById("chat");
const input = document.getElementById("message");
const send = document.getElementById("send");
const voice = document.getElementById("voice");

let isSending = false;
let recognition = null;
let isListening = false;

function addMessage(text, type) {
  const div = document.createElement("div");
  div.className = `message ${type}`;
  div.textContent = text;

  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;

  return div;
}

async function sendMessage() {
  const message = input.value.trim();

  if (!message || isSending) return;

  isSending = true;

  addMessage(message, "user");

  input.value = "";
  send.disabled = true;

  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
  }

  const loading = addMessage("Катя печатает...", "katya");

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

    if (!data.answer) {
      throw new Error("Катя не получила ответ");
    }

    addMessage(data.answer, "katya");
    speak(data.answer);

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

function speak(text) {
  if (!("speechSynthesis" in window)) return;

  speechSynthesis.cancel();

  const speech = new SpeechSynthesisUtterance(text);

  speech.lang = "ru-RU";
  speech.rate = 1;
  speech.pitch = 1.08;
  speech.volume = 1;

  const voices = speechSynthesis.getVoices();

  const russianVoice = voices.find(
    voice => voice.lang.toLowerCase().startsWith("ru")
  );

  if (russianVoice) {
    speech.voice = russianVoice;
  }

  speechSynthesis.speak(speech);
}

function stopSpeaking() {
  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
  }
}

send.addEventListener("click", sendMessage);

input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

if ("speechSynthesis" in window) {
  speechSynthesis.onvoiceschanged = () => {
    speechSynthesis.getVoices();
  };
}

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

    try {
      recognition.start();
    } catch (error) {
      addMessage("Не удалось включить микрофон.", "katya");
    }
  });

  recognition.onstart = () => {
    isListening = true;
    voice.textContent = "🔴";
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
    if (event.error !== "no-speech" &&
        event.error !== "aborted") {
      addMessage(
        "Ошибка микрофона: " + event.error,
        "katya"
      );
    }
  };

  recognition.onend = () => {
    isListening = false;
    voice.textContent = "🎤";
  };

} else {
  voice.addEventListener("click", () => {
    addMessage(
      "Голосовой ввод не поддерживается этим браузером.",
      "katya"
    );
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden && isListening && recognition) {
    recognition.stop();
  }
});
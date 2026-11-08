
const chat = document.getElementById("chat");
const messageInput = document.getElementById("message");
const sendButton = document.getElementById("send");
const voiceButton = document.getElementById("voice");
const voiceExit = document.getElementById("voiceExit");
const orb = document.getElementById("katyaOrb");

let socket = null;
let microphone = null;
let audioContext = null;
let processor = null;
let source = null;
let muteGain = null;

let voiceActive = false;
let audioNextTime = 0;
let assistantSpeaking = false;
let assistantTurnActive = false;

let audioSources = new Set();
let history = [];
let outputTextBuffer = "";
let inputTextBuffer = "";
let sessionId = 0;

let lastLaunchedApp = "";
let lastLaunchTime = 0;

// Приложения Android
const katyaApps = {
  youtube: {
    name: "YouTube",
    aliases: ["youtube", "ютуб", "ютюб"],
    url: "intent://www.youtube.com/#Intent;scheme=https;package=com.google.android.youtube;end"
  },

  telegram: {
    name: "Telegram",
    aliases: ["telegram", "телеграм", "телеграмм"],
    url: "intent://resolve/#Intent;scheme=tg;package=org.telegram.messenger;end"
  },

  tiktok: {
    name: "TikTok",
    aliases: ["tiktok", "тик ток", "тикток"],
    url: "intent://www.tiktok.com/#Intent;scheme=https;package=com.zhiliaoapp.musically;end"
  },

  chrome: {
    name: "Chrome",
    aliases: ["chrome", "гугл хром", "хром"],
    url: "intent://www.google.com/#Intent;scheme=https;package=com.android.chrome;end"
  },

  instagram: {
    name: "Instagram",
    aliases: ["instagram", "инстаграм", "инстаграмм"],
    url: "intent://www.instagram.com/#Intent;scheme=https;package=com.instagram.android;end"
  },

  facebook: {
    name: "Facebook",
    aliases: ["facebook", "фейсбук"],
    url: "intent://www.facebook.com/#Intent;scheme=https;package=com.facebook.katana;end"
  },

  whatsapp: {
    name: "WhatsApp",
    aliases: ["whatsapp", "ватсап", "ватсапп", "вотсап"],
    url: "intent://send/#Intent;scheme=whatsapp;package=com.whatsapp;end"
  },

  settings: {
    name: "Настройки планшета",
    aliases: [
      "настройки планшета",
      "настройки телефона",
      "настройки",
      "settings"
    ],
    url: "intent://com.android.settings/#Intent;scheme=android-app;end"
  }
};

function setStatus(text) {
  addMessage(text, "katya");
}

function addMessage(text, type) {
  if (!chat || !text) return;

  const element = document.createElement("div");
  element.className = `message ${type}`;
  element.textContent = text;

  chat.appendChild(element);
  chat.scrollTop = chat.scrollHeight;
}

function setOrb(active) {
  if (orb) orb.classList.toggle("active", active);
}

function setVoiceButton(active) {
  if (!voiceButton) return;

  voiceButton.innerHTML = `
    <svg class="mic-svg" viewBox="0 0 24 24">
      <rect x="9" y="2" width="6" height="12" rx="3"/>
      <path d="M5 11a7 7 0 0 0 14 0"/>
      <path d="M12 18v4M9 22h6"/>
    </svg>
  `;

  voiceButton.setAttribute(
    "aria-label",
    active ? "Остановить микрофон" : "Включить микрофон"
  );
}

// Нормализация текста
function normalizeCommandText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ё]/g, "е")
    .replace(/[.,!?;:()[\]{}"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Определяем команду запуска
function detectAppCommand(text) {
  const normalized = normalizeCommandText(text);

  if (!normalized) return null;

  const hasLaunchVerb =
    /(^|\s)(открой|открывай|запусти|запускай|включи|перейди|зайди|покажи)(\s|$)/i
      .test(normalized);

  if (!hasLaunchVerb) return null;

  const appKeys = Object.keys(katyaApps);

  for (const key of appKeys) {
    const app = katyaApps[key];

    const aliases = [...app.aliases].sort(
      (a, b) => b.length - a.length
    );

    for (const alias of aliases) {
      if (normalized.includes(alias)) {
        return key;
      }
    }
  }

  return null;
}

// Автоматический запуск приложения Android
function launchAndroidApp(appKey) {
  const app = katyaApps[appKey];

  if (!app) return false;

  console.log("Катя запускает приложение:", app.name);

  try {
    window.location.href = app.url;
    return true;
  } catch (error) {
    console.error("Ошибка запуска приложения:", error);
    return false;
  }
}

// Запасная кнопка на случай блокировки браузером
function showAppLaunchButton(appKey) {
  const app = katyaApps[appKey];

  if (!app || !chat) return;

  const now = Date.now();

  if (
    lastLaunchedApp === appKey &&
    now - lastLaunchTime < 4000
  ) {
    return;
  }

  lastLaunchedApp = appKey;
  lastLaunchTime = now;

  const container = document.createElement("div");
  container.className = "message katya";

  const text = document.createElement("div");
  text.textContent =
    `Пытаюсь автоматически открыть ${app.name}. ❤️`;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "app-launch-button";
  button.textContent = `Открыть ${app.name}`;

  button.style.display = "block";
  button.style.marginTop = "10px";
  button.style.padding = "11px 18px";
  button.style.border = "none";
  button.style.borderRadius = "20px";
  button.style.background = "linear-gradient(135deg, #ff75b5, #e83e91)";
  button.style.color = "#ffffff";
  button.style.fontWeight = "600";
  button.style.cursor = "pointer";

  button.addEventListener("click", () => {
    launchAndroidApp(appKey);
  });

  container.appendChild(text);
  container.appendChild(button);

  chat.appendChild(container);
  chat.scrollTop = chat.scrollHeight;

  // Сразу пытаемся открыть приложение
  launchAndroidApp(appKey);
}

// Сбор распознанной речи
function collectInputTranscription(text) {
  if (!text) return;

  const incoming = String(text).trim();

  if (!incoming) return;

  if (!inputTextBuffer) {
    inputTextBuffer = incoming;
    return;
  }

  if (incoming.startsWith(inputTextBuffer)) {
    inputTextBuffer = incoming;
    return;
  }

  if (inputTextBuffer.startsWith(incoming)) {
    return;
  }

  inputTextBuffer += " " + incoming;
}

// Завершение распознавания команды
function finishInputTranscription() {
  const recognizedText = inputTextBuffer.trim();

  inputTextBuffer = "";

  if (!recognizedText) return;

  console.log("Распознано:", recognizedText);

  const appKey = detectAppCommand(recognizedText);

  if (appKey) {
    showAppLaunchButton(appKey);
  }
}

function convertTo16kHz(input, inputRate) {
  const outputRate = 16000;
  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;

    const first = input[index] || 0;
    const second = input[index + 1] || first;

    let sample = first + (second - first) * fraction;
    sample = Math.max(-1, Math.min(1, sample));

    output[i] = sample < 0
      ? sample * 32768
      : sample * 32767;
  }

  return output;
}

function toBase64(int16Array) {
  const bytes = new Uint8Array(int16Array.buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, i + chunkSize)
    );
  }

  return btoa(binary);
}

// Остановка воспроизведения
function stopAllAudio() {
  for (const audioSource of audioSources) {
    try {
      audioSource.stop();
    } catch (error) {}
  }

  audioSources.clear();

  audioNextTime = audioContext
    ? audioContext.currentTime
    : 0;

  assistantSpeaking = false;
  assistantTurnActive = false;
}

// Воспроизведение голоса Gemini
function playAudio(base64) {
  if (!audioContext || !voiceActive) return;

  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const samples = new Int16Array(
      bytes.buffer,
      bytes.byteOffset,
      Math.floor(bytes.byteLength / 2)
    );

    if (!samples.length) return;

    const buffer = audioContext.createBuffer(
      1,
      samples.length,
      24000
    );

    const channel = buffer.getChannelData(0);

    for (let i = 0; i < samples.length; i++) {
      channel[i] = samples[i] / 32768;
    }

    const audioSource = audioContext.createBufferSource();
    audioSource.buffer = buffer;
    audioSource.connect(audioContext.destination);

    assistantTurnActive = true;
    assistantSpeaking = true;

    audioSources.add(audioSource);

    audioSource.onended = () => {
      audioSources.delete(audioSource);

      if (
        audioSources.size === 0 &&
        !assistantTurnActive
      ) {
        assistantSpeaking = false;
      }
    };

    const now = audioContext.currentTime;

    if (audioNextTime < now) {
      audioNextTime = now;
    }

    audioSource.start(audioNextTime);
    audioNextTime += buffer.duration;

  } catch (error) {
    console.error("Ошибка воспроизведения:", error);
  }
}

function finishOutputText() {
  const text = outputTextBuffer.trim();

  if (text) {
    addMessage(text, "katya");
  }

  outputTextBuffer = "";
}

// Обработка сообщений Gemini
function processGeminiMessage(message) {
  if (!message) return;

  if (message.type === "ready") {
    setStatus("Катя подключена. Можешь говорить.");
    setOrb(true);
    return;
  }

  if (message.type === "error") {
    setStatus("Ошибка: " + message.message);
    console.error("Gemini error:", message.message);
    return;
  }

  if (message.type === "closed") {
    setStatus("Соединение закрыто: " + message.message);
    return;
  }

  if (message.type !== "gemini") return;

  const data = message.data || {};

  if (data.error) {
    setStatus(
      "Ошибка Gemini: " +
      (data.error.message || JSON.stringify(data.error))
    );
    return;
  }

  const content = data.serverContent;

  if (!content) return;

  if (content.interrupted) {
    stopAllAudio();
    outputTextBuffer = "";
    inputTextBuffer = "";
    return;
  }

  // Распознавание речи пользователя
  if (content.inputTranscription?.text) {
    console.log("Ты сказал:", content.inputTranscription.text);
    collectInputTranscription(content.inputTranscription.text);
  }

  // Текст ответа Кати
  if (content.outputTranscription?.text) {
    outputTextBuffer += content.outputTranscription.text;
  } else {
    const parts = content.modelTurn?.parts || [];

    for (const part of parts) {
      if (part.text) {
        outputTextBuffer += part.text;
      }
    }
  }

  // Голосовые фрагменты
  const parts = content.modelTurn?.parts || [];

  for (const part of parts) {
    if (part.inlineData?.data) {
      playAudio(part.inlineData.data);
    }
  }

  // Завершение ответа
  if (content.turnComplete) {
    finishInputTranscription();
    finishOutputText();

    assistantTurnActive = false;

    if (audioSources.size === 0) {
      assistantSpeaking = false;
    }
  }
}

async function startMicrophone() {
  microphone = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });

  audioContext = new (
    window.AudioContext || window.webkitAudioContext
  )();

  await audioContext.resume();

  source = audioContext.createMediaStreamSource(microphone);

  processor = audioContext.createScriptProcessor(
    4096,
    1,
    1
  );

  muteGain = audioContext.createGain();
  muteGain.gain.value = 0;

  processor.onaudioprocess = event => {
    if (
      !voiceActive ||
      assistantSpeaking ||
      assistantTurnActive ||
      !socket ||
      socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    const input = event.inputBuffer.getChannelData(0);

    const pcm = convertTo16kHz(
      input,
      audioContext.sampleRate
    );

    if (!pcm.length) return;

    socket.send(JSON.stringify({
      type: "audio",
      data: toBase64(pcm)
    }));
  };

  source.connect(processor);
  processor.connect(muteGain);
  muteGain.connect(audioContext.destination);
}

function stopMicrophone() {
  if (processor) {
    processor.disconnect();
    processor.onaudioprocess = null;
    processor = null;
  }

  if (muteGain) {
    muteGain.disconnect();
    muteGain = null;
  }

  if (source) {
    source.disconnect();
    source = null;
  }

  if (microphone) {
    microphone.getTracks().forEach(track => track.stop());
    microphone = null;
  }

  if (audioContext) {
    stopAllAudio();

    const oldContext = audioContext;
    audioContext = null;

    oldContext.close().catch(() => {});
  }

  audioNextTime = 0;
}

async function startVoiceMode() {
  if (voiceActive) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Браузер не разрешает доступ к микрофону.");
    return;
  }

  const currentSession = ++sessionId;

  voiceActive = true;
  assistantSpeaking = false;
  assistantTurnActive = false;
  outputTextBuffer = "";
  inputTextBuffer = "";

  setVoiceButton(true);
  setOrb(false);
  setStatus("Подключаю Катю...");

  try {
    await startMicrophone();

    if (!voiceActive || currentSession !== sessionId) {
      stopMicrophone();
      return;
    }

    const protocol = location.protocol === "https:"
      ? "wss:"
      : "ws:";

    const newSocket = new WebSocket(
      `${protocol}//${location.host}/live`
    );

    socket = newSocket;

    newSocket.onopen = () => {
      console.log("Соединение с сервером установлено");
    };

    newSocket.onmessage = event => {
      if (
        !voiceActive ||
        socket !== newSocket
      ) {
        return;
      }

      try {
        const data = JSON.parse(event.data);
        processGeminiMessage(data);
      } catch (error) {
        console.error("Ошибка сообщения:", error);
      }
    };

    newSocket.onerror = () => {
      if (socket === newSocket) {
        setStatus("Не удалось соединиться с сервером Кати.");
      }
    };

    newSocket.onclose = event => {
      console.log(
        "WebSocket закрыт:",
        event.code,
        event.reason
      );

      if (
        voiceActive &&
        socket === newSocket
      ) {
        setStatus(
          "Соединение прервано. Код: " + event.code
        );

        stopVoiceMode();
      }
    };

  } catch (error) {
    console.error("VOICE START ERROR:", error);

    if (currentSession === sessionId) {
      setStatus("Ошибка микрофона: " + error.message);
      stopVoiceMode();
    }
  }
}

function stopVoiceMode() {
  if (!voiceActive && !socket && !microphone) return;

  voiceActive = false;
  sessionId++;

  stopMicrophone();

  if (socket) {
    const oldSocket = socket;
    socket = null;

    oldSocket.onclose = null;
    oldSocket.onmessage = null;
    oldSocket.onerror = null;

    if (
      oldSocket.readyState === WebSocket.OPEN ||
      oldSocket.readyState === WebSocket.CONNECTING
    ) {
      oldSocket.close();
    }
  }

  outputTextBuffer = "";
  inputTextBuffer = "";

  setVoiceButton(false);
  setOrb(false);
}

async function sendTextMessage() {
  const message = messageInput.value.trim();

  if (!message) return;

  messageInput.value = "";

  addMessage(message, "user");

  // Команда запуска приложения из текстового чата
  const appKey = detectAppCommand(message);

  if (appKey) {
    showAppLaunchButton(appKey);
    return;
  }

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message,
        history
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Ошибка сервера");
    }

    const reply = data.reply || "Не получилось получить ответ.";

    addMessage(reply, "katya");

    history.push(
      { role: "user", text: message },
      { role: "model", text: reply }
    );

    if (history.length > 40) {
      history = history.slice(-40);
    }

  } catch (error) {
    console.error("CHAT ERROR:", error);
    addMessage("Ошибка: " + error.message, "katya");
  }
}

if (sendButton) {
  sendButton.addEventListener("click", sendTextMessage);
}

if (messageInput) {
  messageInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      sendTextMessage();
    }
  });
}

if (voiceButton) {
  voiceButton.addEventListener("click", () => {
    if (voiceActive) {
      stopVoiceMode();
    } else {
      startVoiceMode();
    }
  });
}

if (voiceExit) {
  voiceExit.addEventListener("click", stopVoiceMode);
}

window.addEventListener("beforeunload", stopVoiceMode);
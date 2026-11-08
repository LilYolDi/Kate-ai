
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
let audioOutputElement = null;
let audioOutputDestination = null;
let audioOutputNode = null;
let voiceActive = false;
let audioNextTime = 0;
let assistantSpeaking = false;
let assistantTurnActive = false;
let audioSources = new Set();
let history = [];
let outputTextBuffer = "";
let inputTextBuffer = "";
let latestInterimTranscription = "";
let inputTranscriptionTimer = null;
let sessionId = 0;
let lastLaunchedApp = "";
let lastLaunchTime = 0;

// Буфер воспроизведения голоса Кати
const AUDIO_BUFFER_SECONDS = 0.20;
const AUDIO_MIN_AHEAD_SECONDS = 0.025;

// Голосовая активация «Катя»
let wakeRecognition = null;
let wakeEnabled = true;
let wakeListening = false;
let wakeStarting = false;
let wakeRestartTimer = null;
let wakeGreetingPending = false;

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
  if (orb) {
    orb.classList.toggle("active", active);
  }
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
  button.style.background =
    "linear-gradient(135deg, #ff75b5, #e83e91)";
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

  launchAndroidApp(appKey);
}

// Объединение частей распознанной фразы
function mergeTranscription(current, incoming) {
  current = String(current || "").trim();
  incoming = String(incoming || "").trim();

  if (!incoming) return current;
  if (!current) return incoming;

  if (incoming.startsWith(current)) {
    return incoming;
  }

  if (current.startsWith(incoming)) {
    return current;
  }

  const maxOverlap = Math.min(
    current.length,
    incoming.length
  );

  for (let i = maxOverlap; i > 0; i--) {
    if (
      current.slice(-i).toLowerCase() ===
      incoming.slice(0, i).toLowerCase()
    ) {
      return current + incoming.slice(i);
    }
  }

  return current + " " + incoming;
}

// Сбор распознанной речи
function collectInputTranscription(text, isFinal = false) {
  if (!text) return;

  const incoming = String(text).trim();

  if (!incoming) return;

  if (isFinal) {
    inputTextBuffer = mergeTranscription(
      inputTextBuffer,
      incoming
    );

    latestInterimTranscription = "";
  } else {
    latestInterimTranscription = incoming;
  }

  scheduleInputTranscriptionFinish(1400);
}

// Отложенное завершение распознавания
function scheduleInputTranscriptionFinish(delay = 1400) {
  if (inputTranscriptionTimer) {
    clearTimeout(inputTranscriptionTimer);
  }

  inputTranscriptionTimer = setTimeout(() => {
    inputTranscriptionTimer = null;
    finishInputTranscription();
  }, delay);
}

// Завершение распознавания команды
function finishInputTranscription() {
  if (inputTranscriptionTimer) {
    clearTimeout(inputTranscriptionTimer);
    inputTranscriptionTimer = null;
  }

  let recognizedText = inputTextBuffer.trim();

  if (!recognizedText) {
    recognizedText = latestInterimTranscription.trim();
  }

  inputTextBuffer = "";
  latestInterimTranscription = "";

  if (!recognizedText) return;

  console.log("Распознано:", recognizedText);

  const appKey = detectAppCommand(recognizedText);

  if (appKey) {
    showAppLaunchButton(appKey);
  }
}

// Очистка распознавания
function clearInputTranscription() {
  if (inputTranscriptionTimer) {
    clearTimeout(inputTranscriptionTimer);
    inputTranscriptionTimer = null;
  }

  inputTextBuffer = "";
  latestInterimTranscription = "";
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

// Приветствие после активации
function speakWakeGreeting() {
  if (!wakeGreetingPending) return;

  wakeGreetingPending = false;

  if (!("speechSynthesis" in window)) {
    setStatus("Катя подключена. Можешь говорить.");
    return;
  }

  const greeting = new SpeechSynthesisUtterance("Я слушаю");

  greeting.lang = "ru-RU";
  greeting.rate = 1;

  assistantSpeaking = true;

  greeting.onend = () => {
    assistantSpeaking = false;
  };

  greeting.onerror = () => {
    assistantSpeaking = false;
  };

  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(greeting);
  } catch (error) {
    assistantSpeaking = false;

    console.warn(
      "Не удалось произнести приветствие:",
      error
    );
  }
}

// Воспроизведение голоса Gemini с предварительной буферизацией
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

    audioSource.connect(
      audioOutputNode || audioContext.destination
    );

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

    // Если очередь закончилась или отстала,
    // начинаем новую с небольшим запасом времени.
    if (
      audioNextTime < now + AUDIO_MIN_AHEAD_SECONDS
    ) {
      audioNextTime = now + AUDIO_BUFFER_SECONDS;
    }

    // Следующий фрагмент ставится сразу за предыдущим.
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

    if (wakeGreetingPending) {
      speakWakeGreeting();
    }

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
    clearInputTranscription();
    return;
  }

  // Промежуточное распознавание речи
  if (content.interimInputTranscription?.text) {
    console.log(
      "Промежуточное распознавание:",
      content.interimInputTranscription.text
    );

    collectInputTranscription(
      content.interimInputTranscription.text,
      false
    );
  }

  // Финальное распознавание речи
  if (content.inputTranscription?.text) {
    console.log(
      "Ты сказал:",
      content.inputTranscription.text
    );

    collectInputTranscription(
      content.inputTranscription.text,
      true
    );
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
    scheduleInputTranscriptionFinish(1200);
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
  )({
    latencyHint: "interactive"
  });

  await audioContext.resume();

  // Создаём отдельный медиапоток для голоса Кати
  audioOutputDestination =
    audioContext.createMediaStreamDestination();

  audioOutputNode = audioOutputDestination;

  audioOutputElement = document.createElement("audio");

  audioOutputElement.autoplay = true;
  audioOutputElement.playsInline = true;
  audioOutputElement.muted = false;
  audioOutputElement.volume = 1;

  audioOutputElement.srcObject =
    audioOutputDestination.stream;

  audioOutputElement.setAttribute("aria-hidden", "true");

  audioOutputElement.style.position = "fixed";
  audioOutputElement.style.width = "1px";
  audioOutputElement.style.height = "1px";
  audioOutputElement.style.opacity = "0";
  audioOutputElement.style.pointerEvents = "none";

  document.body.appendChild(audioOutputElement);

  try {
    await audioOutputElement.play();
  } catch (error) {
    console.warn(
      "Bluetooth audio element playback unavailable:",
      error
    );

    audioOutputNode = audioContext.destination;
  }

  source = audioContext.createMediaStreamSource(microphone);

  processor = audioContext.createScriptProcessor(
    2048,
    1,
    1
  );

  muteGain = audioContext.createGain();
  muteGain.gain.value = 0;

  processor.onaudioprocess = event => {
    // Не блокируем микрофон во время речи Кати.
    if (
      !voiceActive ||
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

    try {
      socket.send(JSON.stringify({
        type: "audio",
        data: toBase64(pcm)
      }));
    } catch (error) {
      console.error("Ошибка отправки аудио:", error);
    }
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

  if (audioOutputElement) {
    audioOutputElement.pause();
    audioOutputElement.srcObject = null;
    audioOutputElement.remove();
    audioOutputElement = null;
  }

  audioOutputDestination = null;
  audioOutputNode = null;
  audioNextTime = 0;
}

// Остановка ожидания слова «Катя»
function stopWakeWordListening() {
  if (wakeRestartTimer) {
    clearTimeout(wakeRestartTimer);
    wakeRestartTimer = null;
  }

  if (wakeRecognition && wakeListening) {
    try {
      wakeRecognition.stop();
    } catch (error) {}
  }

  wakeListening = false;
  wakeStarting = false;
}

// Обнаружение слова «Катя»
function handleWakeWord() {
  if (!wakeEnabled || voiceActive) return;

  console.log("Обнаружено ключевое слово: Катя");

  wakeEnabled = false;
  wakeGreetingPending = true;

  stopWakeWordListening();

  setStatus("Просыпаюсь... ❤️");

  startVoiceMode();
}

// Запуск ожидания ключевого слова
function startWakeWordListening() {
  if (
    !wakeEnabled ||
    voiceActive ||
    wakeListening ||
    wakeStarting
  ) {
    return;
  }

  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    setStatus(
      "Голосовая активация не поддерживается этим браузером. Открой Катю в Chrome."
    );

    return;
  }

  if (!wakeRecognition) {
    wakeRecognition = new SpeechRecognition();

    wakeRecognition.lang = "ru-RU";
    wakeRecognition.continuous = true;
    wakeRecognition.interimResults = true;
    wakeRecognition.maxAlternatives = 3;

    wakeRecognition.onresult = event => {
      for (
        let i = event.resultIndex;
        i < event.results.length;
        i++
      ) {
        const result = event.results[i];

        for (let j = 0; j < result.length; j++) {
          const recognized = normalizeCommandText(
            result[j].transcript
          );

          if (/(^|\s)катя($|\s)/i.test(recognized)) {
            handleWakeWord();
            return;
          }
        }
      }
    };

    wakeRecognition.onerror = event => {
      console.warn(
        "Ошибка ожидания слова Катя:",
        event.error
      );

      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        wakeEnabled = false;

        setStatus(
          "Разреши микрофон браузеру для голосовой активации."
        );
      }
    };

    wakeRecognition.onend = () => {
      wakeListening = false;
      wakeStarting = false;

      if (wakeEnabled && !voiceActive) {
        wakeRestartTimer = setTimeout(() => {
          wakeRestartTimer = null;
          startWakeWordListening();
        }, 1000);
      }
    };
  }

  try {
    wakeStarting = true;

    wakeRecognition.start();

    wakeListening = true;
    wakeStarting = false;

    setStatus("Катя ждёт твоего обращения ❤️");

  } catch (error) {
    wakeStarting = false;

    console.warn(
      "Не удалось включить ожидание слова:",
      error
    );

    if (error.name === "NotAllowedError") {
      wakeEnabled = false;
      setStatus("Разреши использование микрофона.");
    }
  }
}

// Запуск голосового режима Gemini
async function startVoiceMode() {
  if (voiceActive) return;

  wakeEnabled = false;
  stopWakeWordListening();

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Браузер не разрешает доступ к микрофону.");
    wakeGreetingPending = false;
    return;
  }

  const currentSession = ++sessionId;

  voiceActive = true;

  assistantSpeaking = false;
  assistantTurnActive = false;

  outputTextBuffer = "";

  clearInputTranscription();

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

// Возврат к ожиданию слова после завершения разговора
function restartWakeWordListening() {
  if (!wakeEnabled || voiceActive) return;

  if (wakeRestartTimer) {
    clearTimeout(wakeRestartTimer);
  }

  wakeRestartTimer = setTimeout(() => {
    wakeRestartTimer = null;
    startWakeWordListening();
  }, 1000);
}

// Остановка голосового режима
function stopVoiceMode() {
  if (
    !voiceActive &&
    !socket &&
    !microphone
  ) {
    wakeEnabled = true;
    restartWakeWordListening();
    return;
  }

  voiceActive = false;
  sessionId++;

  stopMicrophone();
  clearInputTranscription();

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

  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }

  wakeGreetingPending = false;
  wakeEnabled = true;

  restartWakeWordListening();
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

    const reply =
      data.reply || "Не получилось получить ответ.";

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

// Кнопка отправки текста
if (sendButton) {
  sendButton.addEventListener("click", sendTextMessage);
}

// Отправка текста клавишей Enter
if (messageInput) {
  messageInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      sendTextMessage();
    }
  });
}

// Ручное управление голосовым режимом
if (voiceButton) {
  voiceButton.addEventListener("click", () => {
    if (voiceActive) {
      stopVoiceMode();
    } else {
      wakeEnabled = false;
      stopWakeWordListening();
      startVoiceMode();
    }
  });
}

// Кнопка выхода из голосового режима
if (voiceExit) {
  voiceExit.addEventListener("click", stopVoiceMode);
}

// Автоматическое ожидание слова «Катя» после загрузки
window.addEventListener("load", () => {
  setTimeout(() => {
    startWakeWordListening();
  }, 1000);
});

// Очистка при закрытии страницы
window.addEventListener("beforeunload", () => {
  wakeEnabled = false;

  stopWakeWordListening();
  stopVoiceMode();
});


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
let voiceStarting = false;
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

// Голосовая активация
let wakeRecognition = null;
let wakeEnabled = true;
let wakeListening = false;
let wakeStarting = false;
let wakeRestartTimer = null;
let wakeGreetingPending = false;
let lastRestoreTime = 0;
let pageWasHidden = false;

const AUDIO_BUFFER_SECONDS = 0.20;
const AUDIO_MIN_AHEAD_SECONDS = 0.025;

// ===============================
// УСТРОЙСТВО
// ===============================

function isIOSDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" &&
     navigator.maxTouchPoints > 1);
}

function isAndroidDevice() {
  return /Android/i.test(navigator.userAgent);
}

// ===============================
// ПРИЛОЖЕНИЯ
// ===============================

const katyaApps = {
  youtube: {
    name: "YouTube",
    aliases: ["youtube", "ютуб", "ютюб"],
    androidUrl: "intent://www.youtube.com/#Intent;scheme=https;package=com.google.android.youtube;end",
    iosUrl: "https://www.youtube.com/",
    webUrl: "https://www.youtube.com/"
  },

  telegram: {
    name: "Telegram",
    aliases: ["telegram", "телеграм", "телеграмм"],
    androidUrl: "intent://resolve/#Intent;scheme=tg;package=org.telegram.messenger;end",
    iosUrl: "https://t.me/",
    webUrl: "https://web.telegram.org/"
  },

  tiktok: {
    name: "TikTok",
    aliases: ["tiktok", "тик ток", "тикток"],
    androidUrl: "intent://www.tiktok.com/#Intent;scheme=https;package=com.zhiliaoapp.musically;end",
    iosUrl: "https://www.tiktok.com/",
    webUrl: "https://www.tiktok.com/"
  },

  chrome: {
    name: "Chrome",
    aliases: ["chrome", "гугл хром", "хром"],
    androidUrl: "intent://www.google.com/#Intent;scheme=https;package=com.android.chrome;end",
    iosUrl: "https://www.google.com/",
    webUrl: "https://www.google.com/"
  },

  instagram: {
    name: "Instagram",
    aliases: ["instagram", "инстаграм", "инстаграмм"],
    androidUrl: "intent://www.instagram.com/#Intent;scheme=https;package=com.instagram.android;end",
    iosUrl: "https://www.instagram.com/",
    webUrl: "https://www.instagram.com/"
  },

  facebook: {
    name: "Facebook",
    aliases: ["facebook", "фейсбук"],
    androidUrl: "intent://www.facebook.com/#Intent;scheme=https;package=com.facebook.katana;end",
    iosUrl: "https://www.facebook.com/",
    webUrl: "https://www.facebook.com/"
  },

  whatsapp: {
    name: "WhatsApp",
    aliases: ["whatsapp", "ватсап", "ватсапп", "вотсап"],
    androidUrl: "intent://send/#Intent;scheme=whatsapp;package=com.whatsapp;end",
    iosUrl: "https://wa.me/",
    webUrl: "https://web.whatsapp.com/"
  },

  settings: {
    name: "Настройки планшета",
    aliases: ["настройки планшета", "настройки телефона", "настройки", "settings"],
    androidUrl: "intent://com.android.settings/#Intent;scheme=android-app;end",
    iosUrl: null,
    webUrl: null
  }
};

// ===============================
// ЗАПУСК ПРИЛОЖЕНИЙ
// ===============================

function launchAndroidApp(appKey) {
  const app = katyaApps[appKey];
  if (!app) return false;

  try {
    window.location.assign(app.androidUrl || app.webUrl);
    return true;
  } catch (error) {
    console.error("Ошибка Android:", error);
    return false;
  }
}

function launchIOSApp(appKey) {
  const app = katyaApps[appKey];
  if (!app) return false;

  if (appKey === "settings") {
    addMessage(
      "На iPhone Safari не может напрямую открыть системные настройки. Открой их через значок Настройки. ❤️",
      "katya"
    );
    return false;
  }

  try {
    window.location.assign(app.iosUrl || app.webUrl);
    return true;
  } catch (error) {
    console.error("Ошибка iOS:", error);
    return false;
  }
}

function launchDesktopApp(appKey) {
  const app = katyaApps[appKey];
  if (!app) return false;

  if (!app.webUrl) {
    addMessage("Это приложение нельзя открыть напрямую из браузера.", "katya");
    return false;
  }

  window.location.assign(app.webUrl);
  return true;
}

function launchApp(appKey) {
  if (!katyaApps[appKey]) return false;

  if (isIOSDevice()) return launchIOSApp(appKey);
  if (isAndroidDevice()) return launchAndroidApp(appKey);

  return launchDesktopApp(appKey);
}

// ===============================
// ИНТЕРФЕЙС
// ===============================

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

// ===============================
// РАСПОЗНАВАНИЕ КОМАНД
// ===============================

function normalizeCommandText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ё]/g, "е")
    .replace(/[.,!?;:()[\]{}"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectAppCommand(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) return null;

  const hasLaunchVerb =
    /(^|\s)(открой|открывай|запусти|запускай|включи|перейди|зайди|покажи)(\s|$)/i.test(normalized);

  if (!hasLaunchVerb) return null;

  for (const key of Object.keys(katyaApps)) {
    const aliases = [...katyaApps[key].aliases].sort(
      (a, b) => b.length - a.length
    );

    for (const alias of aliases) {
      if (normalized.includes(alias)) return key;
    }
  }

  return null;
}

function showAppLaunchButton(appKey) {
  const app = katyaApps[appKey];
  if (!app || !chat) return;

  const now = Date.now();

  if (
    lastLaunchedApp === appKey &&
    now - lastLaunchTime < 4000
  ) return;

  lastLaunchedApp = appKey;
  lastLaunchTime = now;

  const container = document.createElement("div");
  container.className = "message katya";

  const text = document.createElement("div");
  text.textContent = `Открываю ${app.name}. ❤️`;

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

  button.addEventListener("click", () => launchApp(appKey));

  container.appendChild(text);
  container.appendChild(button);

  chat.appendChild(container);
  chat.scrollTop = chat.scrollHeight;

  launchApp(appKey);
}

// ===============================
// ТРАНСКРИПЦИЯ
// ===============================

function mergeTranscription(current, incoming) {
  current = String(current || "").trim();
  incoming = String(incoming || "").trim();

  if (!incoming) return current;
  if (!current) return incoming;

  if (incoming.startsWith(current)) return incoming;
  if (current.startsWith(incoming)) return current;

  const maxOverlap = Math.min(current.length, incoming.length);

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

function collectInputTranscription(text, isFinal = false) {
  if (!text) return;

  const incoming = String(text).trim();
  if (!incoming) return;

  if (isFinal) {
    inputTextBuffer = mergeTranscription(inputTextBuffer, incoming);
    latestInterimTranscription = "";
  } else {
    latestInterimTranscription = incoming;
  }

  scheduleInputTranscriptionFinish(1400);
}

function scheduleInputTranscriptionFinish(delay = 1400) {
  if (inputTranscriptionTimer) {
    clearTimeout(inputTranscriptionTimer);
  }

  inputTranscriptionTimer = setTimeout(() => {
    inputTranscriptionTimer = null;
    finishInputTranscription();
  }, delay);
}

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

  if (appKey) showAppLaunchButton(appKey);
}

function clearInputTranscription() {
  if (inputTranscriptionTimer) {
    clearTimeout(inputTranscriptionTimer);
    inputTranscriptionTimer = null;
  }

  inputTextBuffer = "";
  latestInterimTranscription = "";
}

// ===============================
// АУДИО
// ===============================

function convertTo16kHz(input, inputRate) {
  const ratio = inputRate / 16000;
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

    output[i] = sample < 0 ? sample * 32768 : sample * 32767;
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

function stopAllAudio() {
  for (const audioSource of audioSources) {
    try {
      audioSource.stop();
    } catch (error) {}
  }

  audioSources.clear();

  audioNextTime = audioContext ? audioContext.currentTime : 0;
  assistantSpeaking = false;
  assistantTurnActive = false;
}

// ===============================
// ПРИВЕТСТВИЕ
// ===============================

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

  greeting.onend = () => assistantSpeaking = false;
  greeting.onerror = () => assistantSpeaking = false;

  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(greeting);
  } catch (error) {
    assistantSpeaking = false;
    console.warn("Ошибка приветствия:", error);
  }
}

// ===============================
// ВОСПРОИЗВЕДЕНИЕ GEMINI
// ===============================

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

    const buffer = audioContext.createBuffer(1, samples.length, 24000);
    const channel = buffer.getChannelData(0);

    for (let i = 0; i < samples.length; i++) {
      channel[i] = samples[i] / 32768;
    }

    const audioSource = audioContext.createBufferSource();
    audioSource.buffer = buffer;
    audioSource.connect(audioOutputNode || audioContext.destination);

    assistantTurnActive = true;
    assistantSpeaking = true;

    audioSources.add(audioSource);

    audioSource.onended = () => {
      audioSources.delete(audioSource);

      if (audioSources.size === 0 && !assistantTurnActive) {
        assistantSpeaking = false;
      }
    };

    const now = audioContext.currentTime;

    if (audioNextTime < now + AUDIO_MIN_AHEAD_SECONDS) {
      audioNextTime = now + AUDIO_BUFFER_SECONDS;
    }

    audioSource.start(audioNextTime);
    audioNextTime += buffer.duration;

  } catch (error) {
    console.error("Ошибка воспроизведения:", error);
  }
}

function finishOutputText() {
  const text = outputTextBuffer.trim();

  if (text) addMessage(text, "katya");

  outputTextBuffer = "";
}

// ===============================
// GEMINI
// ===============================

function processGeminiMessage(message) {
  if (!message) return;

  if (message.type === "ready") {
    setStatus("Катя подключена. Можешь говорить.");
    setOrb(true);

    if (wakeGreetingPending) speakWakeGreeting();
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
    setStatus("Ошибка Gemini: " +
      (data.error.message || JSON.stringify(data.error)));
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

  if (content.interimInputTranscription?.text) {
    collectInputTranscription(
      content.interimInputTranscription.text,
      false
    );
  }

  if (content.inputTranscription?.text) {
    collectInputTranscription(
      content.inputTranscription.text,
      true
    );
  }

  if (content.outputTranscription?.text) {
    outputTextBuffer += content.outputTranscription.text;
  } else {
    const parts = content.modelTurn?.parts || [];

    for (const part of parts) {
      if (part.text) outputTextBuffer += part.text;
    }
  }

  const parts = content.modelTurn?.parts || [];

  for (const part of parts) {
    if (part.inlineData?.data) {
      playAudio(part.inlineData.data);
    }
  }

  if (content.turnComplete) {
    scheduleInputTranscriptionFinish(1200);
    finishOutputText();

    assistantTurnActive = false;

    if (audioSources.size === 0) {
      assistantSpeaking = false;
    }
  }
}

// ===============================
// МИКРОФОН
// ===============================

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
  )({ latencyHint: "interactive" });

  await audioContext.resume();

  audioOutputDestination = audioContext.createMediaStreamDestination();
  audioOutputNode = audioOutputDestination;

  audioOutputElement = document.createElement("audio");
  audioOutputElement.autoplay = true;
  audioOutputElement.playsInline = true;
  audioOutputElement.muted = false;
  audioOutputElement.volume = 1;
  audioOutputElement.srcObject = audioOutputDestination.stream;
  audioOutputElement.setAttribute("aria-hidden", "true");

  Object.assign(audioOutputElement.style, {
    position: "fixed",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none"
  });

  document.body.appendChild(audioOutputElement);

  try {
    await audioOutputElement.play();
  } catch (error) {
    console.warn("Audio playback unavailable:", error);
    audioOutputNode = audioContext.destination;
  }

  source = audioContext.createMediaStreamSource(microphone);

  processor = audioContext.createScriptProcessor(2048, 1, 1);

  muteGain = audioContext.createGain();
  muteGain.gain.value = 0;

  processor.onaudioprocess = event => {
    if (
      !voiceActive ||
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !audioContext
    ) return;

    const input = event.inputBuffer.getChannelData(0);
    const pcm = convertTo16kHz(input, audioContext.sampleRate);

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

// ===============================
// ГОЛОСОВАЯ АКТИВАЦИЯ «КАТЯ»
// ===============================

function stopWakeWordListening() {
  if (wakeRestartTimer) {
    clearTimeout(wakeRestartTimer);
    wakeRestartTimer = null;
  }

  const oldRecognition = wakeRecognition;
  wakeRecognition = null;

  wakeListening = false;
  wakeStarting = false;

  if (oldRecognition) {
    try {
      oldRecognition.onend = null;
      oldRecognition.onresult = null;
      oldRecognition.onerror = null;
      oldRecognition.abort();
    } catch (error) {}
  }
}

function handleWakeWord() {
  if (!wakeEnabled || voiceActive || voiceStarting) return;

  console.log("Обнаружено слово Катя");

  wakeEnabled = false;
  wakeGreetingPending = true;

  stopWakeWordListening();

  setStatus("Просыпаюсь... ❤️");

  startVoiceMode();
}

function createWakeRecognition() {
  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    setStatus("Голосовая активация не поддерживается этим браузером.");
    return null;
  }

  const recognition = new SpeechRecognition();

  recognition.lang = "ru-RU";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;

  recognition.onstart = () => {
    if (wakeRecognition !== recognition) return;

    wakeListening = true;
    wakeStarting = false;

    console.log("Катя слушает.");
  };

  recognition.onresult = event => {
    if (
      !wakeEnabled ||
      voiceActive ||
      wakeRecognition !== recognition
    ) return;

    for (let i = event.resultIndex; i < event.results.length; i++) {
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

  recognition.onerror = event => {
    console.warn("Ошибка распознавания:", event.error);

    if (wakeRecognition !== recognition) return;

    wakeListening = false;
    wakeStarting = false;

    if (
      event.error === "not-allowed" ||
      event.error === "service-not-allowed"
    ) {
      wakeEnabled = false;
      setStatus("Разреши Safari доступ к микрофону.");
      return;
    }

    if (wakeEnabled && !voiceActive) {
      restartWakeWordListening();
    }
  };

  recognition.onend = () => {
    if (wakeRecognition !== recognition) return;

    wakeListening = false;
    wakeStarting = false;

    if (wakeEnabled && !voiceActive) {
      restartWakeWordListening();
    }
  };

  return recognition;
}

function startWakeWordListening() {
  if (
    !wakeEnabled ||
    voiceActive ||
    voiceStarting ||
    wakeListening ||
    wakeStarting ||
    document.visibilityState === "hidden"
  ) return;

  if (!wakeRecognition) {
    wakeRecognition = createWakeRecognition();
  }

  if (!wakeRecognition) return;

  try {
    wakeStarting = true;
    wakeRecognition.start();

  } catch (error) {
    wakeStarting = false;

    console.warn("Ошибка запуска ожидания:", error);

    if (error.name === "NotAllowedError") {
      wakeEnabled = false;
      setStatus("Разреши использование микрофона.");
      return;
    }

    if (error.name === "InvalidStateError") {
      const oldRecognition = wakeRecognition;
      wakeRecognition = null;

      try {
        oldRecognition.abort();
      } catch (e) {}
    }

    restartWakeWordListening();
  }
}

// ===============================
// ПОВТОРНАЯ АКТИВАЦИЯ
// ===============================

function restartWakeWordListening() {
  if (!wakeEnabled || voiceActive || voiceStarting) return;

  if (wakeRestartTimer) {
    clearTimeout(wakeRestartTimer);
  }

  wakeRestartTimer = setTimeout(() => {
    wakeRestartTimer = null;

    if (
      !wakeEnabled ||
      voiceActive ||
      voiceStarting ||
      document.visibilityState === "hidden"
    ) return;

    // Создаём новый экземпляр распознавания.
    if (wakeRecognition && !wakeListening) {
      const oldRecognition = wakeRecognition;
      wakeRecognition = null;

      try {
        oldRecognition.abort();
      } catch (error) {}
    }

    startWakeWordListening();

  }, 1200);
}

// ===============================
// ВОССТАНОВЛЕНИЕ ПОСЛЕ YOUTUBE
// ===============================

function restoreKatyaAfterBackground() {
  if (document.visibilityState === "hidden") return;

  const now = Date.now();

  // Защита от повторных событий Safari.
  if (now - lastRestoreTime < 2500) return;

  lastRestoreTime = now;

  console.log("Восстанавливаю Катю после возвращения.");

  // Останавливаем старое соединение и микрофон.
  if (
    voiceActive ||
    voiceStarting ||
    socket ||
    microphone ||
    audioContext
  ) {
    stopVoiceMode();
  }

  // Возвращаем ожидание ключевого слова.
  wakeGreetingPending = false;
  wakeEnabled = true;

  stopWakeWordListening();

  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }

  setOrb(false);
  setVoiceButton(false);

  setStatus("Катя снова слушает ❤️");

  restartWakeWordListening();
}

// ===============================
// GEMINI LIVE
// ===============================

async function startVoiceMode() {
  if (voiceActive || voiceStarting) return;

  wakeEnabled = false;
  stopWakeWordListening();

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Браузер не разрешает доступ к микрофону.");
    wakeGreetingPending = false;
    return;
  }

  const currentSession = ++sessionId;

  voiceStarting = true;
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

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";

    const newSocket = new WebSocket(
      `${protocol}//${location.host}/live`
    );

    socket = newSocket;

    newSocket.onopen = () => {
      console.log("Соединение с сервером установлено");
    };

    newSocket.onmessage = event => {
      if (!voiceActive || socket !== newSocket) return;

      try {
        processGeminiMessage(JSON.parse(event.data));
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
      console.log("WebSocket закрыт:", event.code, event.reason);

      if (voiceActive && socket === newSocket) {
        setStatus("Соединение прервано. Код: " + event.code);
        stopVoiceMode();
      }
    };

  } catch (error) {
    console.error("VOICE START ERROR:", error);

    if (currentSession === sessionId) {
      setStatus("Ошибка микрофона: " + error.message);
      stopVoiceMode();
    }
  } finally {
    if (currentSession === sessionId) {
      voiceStarting = false;
    }
  }
}

// ===============================
// ОСТАНОВКА ГОЛОСОВОГО РЕЖИМА
// ===============================

function stopVoiceMode() {
  voiceActive = false;
  voiceStarting = false;

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

  stopWakeWordListening();
  restartWakeWordListening();
}

// ===============================
// ТЕКСТОВЫЙ ЧАТ
// ===============================

async function sendTextMessage() {
  if (!messageInput) return;

  const message = messageInput.value.trim();
  if (!message) return;

  messageInput.value = "";

  addMessage(message, "user");

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

// ===============================
// КНОПКИ
// ===============================

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
    if (voiceActive || voiceStarting) {
      stopVoiceMode();
    } else {
      wakeEnabled = false;
      stopWakeWordListening();
      startVoiceMode();
    }
  });
}

if (voiceExit) {
  voiceExit.addEventListener("click", stopVoiceMode);
}

// ===============================
// ВОЗВРАЩЕНИЕ В SAFARI
// ===============================

window.addEventListener("pageshow", event => {
  if (event.persisted) {
    restoreKatyaAfterBackground();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    pageWasHidden = true;
    return;
  }

  if (pageWasHidden) {
    pageWasHidden = false;

    setTimeout(() => {
      restoreKatyaAfterBackground();
    }, 700);
  }
});

window.addEventListener("focus", () => {
  if (pageWasHidden && document.visibilityState === "visible") {
    pageWasHidden = false;

    setTimeout(() => {
      restoreKatyaAfterBackground();
    }, 700);
  }
});

// ===============================
// АВТОЗАПУСК
// ===============================

window.addEventListener("load", () => {
  setTimeout(() => {
    startWakeWordListening();
  }, 1000);
});

// ===============================
// ЗАКРЫТИЕ СТРАНИЦЫ
// ===============================

window.addEventListener("pagehide", () => {
  pageWasHidden = true;

  stopWakeWordListening();

  // Не закрываем всю страницу и не удаляем
  // состояние, необходимое для восстановления.
});

window.addEventListener("beforeunload", () => {
  wakeEnabled = false;

  stopWakeWordListening();
  stopVoiceMode();
});





// =====================================================
// KATYA AI — СОХРАНЕНИЕ ИСТОРИИ РАЗГОВОРОВ
// =====================================================

const KATYA_STORAGE_KEY = "katya_saved_conversations_v1";

let katyaConversationMessages = [];
let katyaActiveConversationId = null;

// ---------- ХРАНИЛИЩЕ ----------

function getKatyaSavedConversations() {
  try {
    return JSON.parse(localStorage.getItem(KATYA_STORAGE_KEY)) || [];
  } catch (error) {
    console.error("Ошибка чтения истории:", error);
    return [];
  }
}

function setKatyaSavedConversations(items) {
  try {
    localStorage.setItem(KATYA_STORAGE_KEY, JSON.stringify(items));
    return true;
  } catch (error) {
    console.error("Ошибка сохранения истории:", error);
    addMessage("Не удалось сохранить разговор. Возможно, память браузера заполнена.", "katya");
    return false;
  }
}

// ---------- ЗАПИСЬ СООБЩЕНИЙ ----------

function recordKatyaMessage(role, text) {
  if (!text || !text.trim()) return;

  katyaConversationMessages.push({
    role,
    text: text.trim(),
    date: new Date().toISOString()
  });

  if (katyaActiveConversationId) {
    updateKatyaActiveConversation();
  }
}

function updateKatyaActiveConversation() {
  const conversations = getKatyaSavedConversations();

  const index = conversations.findIndex(
    item => item.id === katyaActiveConversationId
  );

  if (index === -1) return;

  conversations[index].messages = [...katyaConversationMessages];
  conversations[index].updatedAt = new Date().toISOString();

  setKatyaSavedConversations(conversations);
}

// ---------- СОХРАНЕНИЕ РАЗГОВОРА ----------

function saveKatyaConversation(title) {
  title = String(title || "").trim();

  if (!title) {
    addMessage("Назови разговор, который нужно сохранить. ❤️", "katya");
    return;
  }

  if (!katyaConversationMessages.length) {
    addMessage("Пока нечего сохранять. Давай сначала поговорим. ❤️", "katya");
    return;
  }

  const conversations = getKatyaSavedConversations();

  const conversation = {
    id: "katya_" + Date.now(),
    title: title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [...katyaConversationMessages]
  };

  conversations.unshift(conversation);

  if (!setKatyaSavedConversations(conversations)) return;

  katyaActiveConversationId = conversation.id;

  addMessage(`Я сохранила наш разговор «${title}». ❤️`, "katya");

  renderKatyaHistory();
}

// ---------- РАСПОЗНАВАНИЕ КОМАНДЫ ----------

function detectSaveConversationCommand(text) {
  const normalized = String(text || "")
    .replace(/[ё]/gi, "е")
    .trim();

  const match = normalized.match(
    /(?:катя[\s,]*)?запомни\s+(?:этот\s+)?разговор\s*(?:(?:под\s+)?названием\s+|под\s+именем\s+|[:\-]\s*|[—]\s*)?(.+)?$/i
  );

  if (!match) return null;

  let title = (match[1] || "").trim();

  title = title.replace(/[.!?]+$/, "").trim();

  return {
    title: title || null
  };
}

// ---------- ОТКРЫТИЕ СОХРАНЁННОГО РАЗГОВОРА ----------

function openKatyaConversation(id) {
  const conversations = getKatyaSavedConversations();

  const conversation = conversations.find(item => item.id === id);

  if (!conversation) return;

  if (voiceActive || voiceStarting) {
    stopVoiceMode();
  }

  katyaActiveConversationId = conversation.id;

  katyaConversationMessages = [...conversation.messages];

  history = conversation.messages.map(message => ({
    role: message.role === "user" ? "user" : "model",
    text: message.text
  }));

  if (history.length > 40) {
    history = history.slice(-40);
  }

  if (chat) {
    chat.innerHTML = "";

    addMessage(
      `Продолжаем разговор «${conversation.title}». ❤️`,
      "katya"
    );

    conversation.messages.forEach(message => {
      addMessage(
        message.text,
        message.role === "user" ? "user" : "katya"
      );
    });
  }

  closeKatyaHistory();

  addMessage(
    "Я восстановила нашу переписку. Можем продолжить с того места, где остановились. ❤️",
    "katya"
  );
}

// ---------- УДАЛЕНИЕ ----------

function deleteKatyaConversation(id) {
  const conversations = getKatyaSavedConversations()
    .filter(item => item.id !== id);

  setKatyaSavedConversations(conversations);

  if (katyaActiveConversationId === id) {
    katyaActiveConversationId = null;
  }

  renderKatyaHistory();
}

// ---------- ИНТЕРФЕЙС ИСТОРИИ ----------

function createKatyaHistoryInterface() {
  if (document.getElementById("katyaHistoryButton")) return;

  const style = document.createElement("style");

  style.textContent = `
    #katyaHistoryButton {
      position: fixed;
      right: 16px;
      bottom: 20px;
      z-index: 9998;
      padding: 12px 18px;
      border: 1px solid rgba(255,255,255,.2);
      border-radius: 24px;
      background: linear-gradient(135deg,#ff75b5,#e83e91);
      color: white;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 5px 20px rgba(232,62,145,.3);
    }

    #katyaHistoryOverlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(0,0,0,.75);
      align-items: center;
      justify-content: center;
      padding: 15px;
    }

    #katyaHistoryPanel {
      width: 100%;
      max-width: 480px;
      max-height: 80vh;
      overflow-y: auto;
      padding: 20px;
      border-radius: 22px;
      background: #211923;
      color: white;
      border: 1px solid rgba(255,255,255,.12);
    }

    .katya-history-item {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 12px;
      padding: 14px;
      border-radius: 14px;
      background: rgba(255,255,255,.08);
    }

    .katya-history-open {
      flex: 1;
      min-width: 0;
      text-align: left;
      background: none;
      border: none;
      color: white;
      cursor: pointer;
      font-size: 15px;
    }

    .katya-history-delete {
      border: none;
      border-radius: 10px;
      padding: 9px;
      background: #a52c53;
      color: white;
      cursor: pointer;
    }

    #katyaHistoryClose {
      float: right;
      border: none;
      background: none;
      color: white;
      font-size: 25px;
      cursor: pointer;
    }
  `;

  document.head.appendChild(style);

  const button = document.createElement("button");
  button.id = "katyaHistoryButton";
  button.textContent = "📚 История разговоров";
  button.addEventListener("click", openKatyaHistory);

  document.body.appendChild(button);

  const overlay = document.createElement("div");
  overlay.id = "katyaHistoryOverlay";

  overlay.innerHTML = `
    <div id="katyaHistoryPanel">
      <button id="katyaHistoryClose">×</button>
      <h2>История разговоров</h2>
      <div id="katyaHistoryList"></div>
    </div>
  `;

  overlay.addEventListener("click", event => {
    if (event.target === overlay) closeKatyaHistory();
  });

  document.body.appendChild(overlay);

  document.getElementById("katyaHistoryClose")
    .addEventListener("click", closeKatyaHistory);

  renderKatyaHistory();
}

function openKatyaHistory() {
  renderKatyaHistory();

  const overlay = document.getElementById("katyaHistoryOverlay");

  if (overlay) overlay.style.display = "flex";
}

function closeKatyaHistory() {
  const overlay = document.getElementById("katyaHistoryOverlay");

  if (overlay) overlay.style.display = "none";
}

function renderKatyaHistory() {
  const list = document.getElementById("katyaHistoryList");

  if (!list) return;

  list.innerHTML = "";

  const conversations = getKatyaSavedConversations();

  if (!conversations.length) {
    list.textContent = "Пока сохранённых разговоров нет.";
    return;
  }

  conversations.forEach(conversation => {
    const item = document.createElement("div");
    item.className = "katya-history-item";

    const open = document.createElement("button");
    open.className = "katya-history-open";

    const date = new Date(conversation.updatedAt)
      .toLocaleString("ru-RU");

    open.textContent =
      `💬 ${conversation.title} (${conversation.messages.length} сообщений)`;

    open.title = date;

    open.addEventListener("click", () => {
      openKatyaConversation(conversation.id);
    });

    const remove = document.createElement("button");
    remove.className = "katya-history-delete";
    remove.textContent = "Удалить";

    remove.addEventListener("click", () => {
      if (confirm(`Удалить разговор «${conversation.title}»?`)) {
        deleteKatyaConversation(conversation.id);
      }
    });

    item.appendChild(open);
    item.appendChild(remove);

    list.appendChild(item);
  });
}

// ---------- ПЕРЕХВАТ ТЕКСТОВЫХ СООБЩЕНИЙ ----------

const originalSendTextMessage = sendTextMessage;

sendTextMessage = async function() {
  if (!messageInput) return;

  const message = messageInput.value.trim();

  if (!message) return;

  const saveCommand = detectSaveConversationCommand(message);

  if (saveCommand) {
    messageInput.value = "";

    if (saveCommand.title) {
      recordKatyaMessage("user", message);
      saveKatyaConversation(saveCommand.title);
    } else {
      addMessage(
        "Как назовём этот разговор? Например: «Мои планы». ❤️",
        "katya"
      );
    }

    return;
  }

  await originalSendTextMessage();
};

// ---------- ПЕРЕХВАТ ГОЛОСОВЫХ СООБЩЕНИЙ ----------

const originalFinishInputTranscription = finishInputTranscription;

finishInputTranscription = function() {
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

  const saveCommand = detectSaveConversationCommand(recognizedText);

  if (saveCommand) {
    if (saveCommand.title) {
      recordKatyaMessage("user", recognizedText);
      saveKatyaConversation(saveCommand.title);
    } else {
      addMessage(
        "Как назовём этот разговор? ❤️",
        "katya"
      );
    }

    return;
  }

  recordKatyaMessage("user", recognizedText);

  const appKey = detectAppCommand(recognizedText);

  if (appKey) showAppLaunchButton(appKey);
};

// ---------- СОХРАНЕНИЕ ОТВЕТОВ GEMINI LIVE ----------

const originalFinishOutputText = finishOutputText;

finishOutputText = function() {
  const text = outputTextBuffer.trim();

  if (text) {
    recordKatyaMessage("model", text);
  }

  originalFinishOutputText();
};

// ---------- СОХРАНЕНИЕ ТЕКСТОВЫХ СООБЩЕНИЙ ----------

const originalAddMessage = addMessage;

addMessage = function(text, type) {
  originalAddMessage(text, type);
};

// ---------- ЗАПУСК ----------

window.addEventListener("load", () => {
  createKatyaHistoryInterface();
});

document.addEventListener("DOMContentLoaded", () => {
  createKatyaHistoryInterface();
});

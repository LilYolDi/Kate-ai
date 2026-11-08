
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
let sessionId = 0;

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

  voiceButton.textContent = active ? "⏹" : "🎤";
  voiceButton.setAttribute(
    "aria-label",
    active ? "Остановить микрофон" : "Включить микрофон"
  );
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

// Полностью останавливаем старое воспроизведение
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

// Обработка входящего аудио Gemini
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

  // Gemini прервал предыдущий ответ
  if (content.interrupted) {
    stopAllAudio();
    outputTextBuffer = "";
    return;
  }

  if (content.inputTranscription?.text) {
    console.log("Ты сказал:", content.inputTranscription.text);
  }

  // Получаем текст ответа только из одного источника
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

  // Получаем голосовые фрагменты
  const parts = content.modelTurn?.parts || [];

  for (const part of parts) {
    if (part.inlineData?.data) {
      playAudio(part.inlineData.data);
    }
  }

  // Показываем один готовый ответ
  if (content.turnComplete) {
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

  // Не воспроизводим звук самого микрофона через динамики
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

  setVoiceButton(false);
  setOrb(false);
}

async function sendTextMessage() {
  const message = messageInput.value.trim();

  if (!message) return;

  messageInput.value = "";

  addMessage(message, "user");

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

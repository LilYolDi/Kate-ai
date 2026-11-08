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

let voiceActive = false;
let audioNextTime = 0;
let history = [];

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
  if (voiceButton) {
    voiceButton.textContent = active ? "⏹" : "🎤";
    voiceButton.setAttribute(
      "aria-label",
      active ? "Остановить микрофон" : "Включить микрофон"
    );
  }
}

// Перевод Float32 в PCM16 с частотой 16000 Hz
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

function playAudio(base64) {
  if (!audioContext) return;

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

  const now = audioContext.currentTime;

  if (audioNextTime < now) {
    audioNextTime = now;
  }

  audioSource.start(audioNextTime);
  audioNextTime += buffer.duration;
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

  if (content.interrupted) {
    audioNextTime = audioContext
      ? audioContext.currentTime
      : 0;
  }

  if (content.inputTranscription?.text) {
    console.log("Ты сказал:", content.inputTranscription.text);
  }

  if (content.outputTranscription?.text) {
    const text = content.outputTranscription.text;

    if (text.trim()) {
      addMessage(text, "katya");
    }
  }

  const parts = content.modelTurn?.parts || [];

  for (const part of parts) {
    if (part.inlineData?.data) {
      playAudio(part.inlineData.data);
    }

    if (part.text) {
      addMessage(part.text, "katya");
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

  processor.onaudioprocess = event => {
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

    if (pcm.length === 0) return;

    socket.send(JSON.stringify({
      type: "audio",
      data: toBase64(pcm)
    }));
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
}

function stopMicrophone() {
  if (processor) {
    processor.disconnect();
    processor.onaudioprocess = null;
    processor = null;
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
    audioContext.close().catch(() => {});
    audioContext = null;
  }

  audioNextTime = 0;
}

async function startVoiceMode() {
  if (voiceActive) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Браузер не разрешает доступ к микрофону.");
    return;
  }

  voiceActive = true;
  setVoiceButton(true);
  setOrb(false);

  setStatus("Подключаю Катю...");

  try {
    await startMicrophone();

    const protocol = location.protocol === "https:"
      ? "wss:"
      : "ws:";

    socket = new WebSocket(
      `${protocol}//${location.host}/live`
    );

    socket.onopen = () => {
      console.log("Соединение с сервером установлено");
    };

    socket.onmessage = async event => {
      try {
        const data = JSON.parse(event.data);
        processGeminiMessage(data);
      } catch (error) {
        console.error("Ошибка сообщения:", error);
      }
    };

    socket.onerror = () => {
      setStatus("Не удалось соединиться с сервером Кати.");
    };

    socket.onclose = event => {
      console.log(
        "WebSocket закрыт:",
        event.code,
        event.reason
      );

      if (voiceActive) {
        setStatus(
          "Соединение прервано. Код: " + event.code
        );
        stopVoiceMode();
      }
    };

  } catch (error) {
    console.error("VOICE START ERROR:", error);
    setStatus("Ошибка микрофона: " + error.message);
    stopVoiceMode();
  }
}

function stopVoiceMode() {
  voiceActive = false;

  stopMicrophone();

  if (socket) {
    const oldSocket = socket;
    socket = null;

    if (
      oldSocket.readyState === WebSocket.OPEN ||
      oldSocket.readyState === WebSocket.CONNECTING
    ) {
      oldSocket.close();
    }
  }

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

const chat = document.getElementById("chat");
const input = document.getElementById("message");
const send = document.getElementById("send");
const voice = document.getElementById("voice");
const orb = document.getElementById("katyaOrb");
const menuButton = document.getElementById("menuButton");
const settingsButton = document.getElementById("settingsButton");
const addButton = document.getElementById("addButton");
const voiceExit = document.getElementById("voiceExit");

const SYSTEM_PROMPT = `
Тебя зовут Катя.
Ты дружелюбная виртуальная собеседница.
Общайся исключительно на русском языке.
Говори естественно, тепло, непринуждённо и эмоционально.
Не используй заготовленные диалоги.
Поддерживай разговор, задавай вопросы.
Помни контекст беседы.
Отвечай так, словно разговариваешь с человеком по телефону.
Не делай длинных пауз без необходимости.
`;

let voiceMode = false;
let voiceEnabled = true;
let isSending = false;
let socket = null;
let microphone = null;
let audioContext = null;
let processor = null;
let micSource = null;
let muteGain = null;
let nextPlayTime = 0;
let playbackSources = [];
let setupReady = false;
let microphoneStarted = false;

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
  if (state) orb.classList.add(state);
}

function setVoiceButton(active) {
  voice.textContent = active ? "■" : "🎤";
}

function base64FromBytes(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, i + chunkSize)
    );
  }

  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function convertToPCM16(float32) {
  const pcm = new Int16Array(float32.length);

  for (let i = 0; i < float32.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32[i]));
    pcm[i] = sample < 0
      ? sample * 32768
      : sample * 32767;
  }

  return pcm;
}

function resampleAudio(inputData, inputRate, outputRate) {
  if (inputRate === outputRate) return inputData;

  const ratio = inputRate / outputRate;
  const newLength = Math.floor(inputData.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;

    const a = inputData[index] || 0;
    const b = inputData[index + 1] || a;

    result[i] = a + (b - a) * fraction;
  }

  return result;
}

function stopPlayback() {
  playbackSources.forEach(source => {
    try {
      source.stop();
    } catch {}
  });

  playbackSources = [];

  if (audioContext) {
    nextPlayTime = audioContext.currentTime;
  }

  setOrbState("");
}

function playAudio(base64) {
  if (!audioContext || !voiceMode) return;

  try {
    const bytes = base64ToBytes(base64);
    const pcm = new Int16Array(
      bytes.buffer,
      bytes.byteOffset,
      Math.floor(bytes.byteLength / 2)
    );

    const samples = new Float32Array(pcm.length);

    for (let i = 0; i < pcm.length; i++) {
      samples[i] = pcm[i] / 32768;
    }

    const buffer = audioContext.createBuffer(
      1,
      samples.length,
      24000
    );

    buffer.copyToChannel(samples, 0);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);

    const startAt = Math.max(
      audioContext.currentTime + 0.03,
      nextPlayTime
    );

    source.start(startAt);
    nextPlayTime = startAt + buffer.duration;

    playbackSources.push(source);

    source.onended = () => {
      playbackSources = playbackSources.filter(
        item => item !== source
      );

      if (playbackSources.length === 0 && voiceMode) {
        setOrbState("listening");
      }
    };

    setOrbState("speaking");
  } catch (error) {
    console.error("Ошибка воспроизведения:", error);
  }
}

function sendMicrophoneAudio(float32) {
  if (
    !setupReady ||
    !socket ||
    socket.readyState !== WebSocket.OPEN ||
    !voiceMode ||
    !audioContext
  ) {
    return;
  }

  const resampled = resampleAudio(
    float32,
    audioContext.sampleRate,
    16000
  );

  const pcm = convertToPCM16(resampled);

  socket.send(JSON.stringify({
    realtimeInput: {
      audio: {
        data: base64FromBytes(new Uint8Array(pcm.buffer)),
        mimeType: "audio/pcm;rate=16000"
      }
    }
  }));
}

async function startMicrophone() {
  if (microphoneStarted || !voiceMode) return;

  microphoneStarted = true;

  try {
    microphone = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    if (!voiceMode) return;

    audioContext = new (
      window.AudioContext ||
      window.webkitAudioContext
    )();

    await audioContext.resume();

    micSource = audioContext.createMediaStreamSource(microphone);

    processor = audioContext.createScriptProcessor(
      4096,
      1,
      1
    );

    muteGain = audioContext.createGain();
    muteGain.gain.value = 0;

    processor.onaudioprocess = event => {
      if (!voiceMode || !setupReady) return;

      const inputData = event.inputBuffer.getChannelData(0);
      sendMicrophoneAudio(inputData);
    };

    micSource.connect(processor);
    processor.connect(muteGain);
    muteGain.connect(audioContext.destination);

    addMessage("Катя подключена. Можешь говорить ❤️", "katya");
    setOrbState("listening");

  } catch (error) {
    microphoneStarted = false;
    addMessage(
      "Не удалось включить микрофон: " + error.message,
      "katya"
    );
    stopVoiceMode(false);
  }
}

async function startVoiceMode() {
  if (voiceMode) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    addMessage(
      "Браузер не разрешает доступ к микрофону. Открой сайт через HTTPS.",
      "katya"
    );
    return;
  }

  voiceMode = true;
  setupReady = false;
  microphoneStarted = false;

  setVoiceButton(true);
  setOrbState("listening");

  addMessage("Подключаю голосовую связь...", "katya");

  try {
    const tokenResponse = await fetch("/api/live-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      }
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.token) {
      throw new Error(
        tokenData.error || "Не удалось получить токен Gemini"
      );
    }

    socket = new WebSocket(
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=" +
      encodeURIComponent(tokenData.token)
    );

    socket.onopen = () => {
      if (!voiceMode) return;

      socket.send(JSON.stringify({
        setup: {
          model: "models/gemini-3.8-live",
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: "Kore"
                }
              }
            }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          }
        }
      }));

      addMessage("Настраиваю голосовой канал...", "katya");
    };

    socket.onmessage = async event => {
      let data;

      try {
        data = JSON.parse(event.data);
      } catch {
        console.error("Не удалось прочитать ответ Gemini:", event.data);
        return;
      }

      if (data.error) {
        addMessage(
          "Ошибка Gemini: " +
          (data.error.message || "Неизвестная ошибка"),
          "katya"
        );
        return;
      }

      // ВАЖНО: микрофон запускается только после setupComplete.
      if (data.setupComplete && !setupReady) {
        setupReady = true;
        await startMicrophone();
        return;
      }

      const content = data.serverContent;

      if (!content) return;

      if (content.interrupted) {
        stopPlayback();
        setOrbState("listening");
      }

      if (content.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
          if (part.inlineData?.data) {
            playAudio(part.inlineData.data);
          }
        }
      }

      if (content.outputTranscription?.text) {
        addMessage(content.outputTranscription.text, "katya");
      }

      if (content.inputTranscription?.text) {
        addMessage(content.inputTranscription.text, "user");
      }

      if (content.turnComplete && playbackSources.length === 0) {
        setOrbState("listening");
      }
    };

    socket.onerror = () => {
      if (voiceMode) {
        addMessage(
          "Ошибка соединения с голосовым сервером. Проверь подключение Gemini.",
          "katya"
        );
      }
    };

    socket.onclose = event => {
      if (voiceMode) {
        addMessage(
          "Голосовое соединение закрыто. Код: " +
          event.code +
          (event.reason ? " Причина: " + event.reason : ""),
          "katya"
        );

        stopVoiceMode(false);
      }
    };

  } catch (error) {
    addMessage(
      "Не удалось подключить Катю: " + error.message,
      "katya"
    );

    stopVoiceMode(false);
  }
}

function stopVoiceMode(showMessage = true) {
  voiceMode = false;
  setupReady = false;
  microphoneStarted = false;

  if (socket) {
    try {
      socket.close();
    } catch {}
    socket = null;
  }

  if (processor) {
    processor.disconnect();
    processor.onaudioprocess = null;
    processor = null;
  }

  if (micSource) {
    micSource.disconnect();
    micSource = null;
  }

  if (muteGain) {
    muteGain.disconnect();
    muteGain = null;
  }

  if (microphone) {
    microphone.getTracks().forEach(track => track.stop());
    microphone = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  playbackSources = [];
  nextPlayTime = 0;

  setVoiceButton(false);
  setOrbState("");

  if (showMessage) {
    addMessage("Голосовой режим выключен.", "katya");
  }
}

async function sendMessage() {
  const message = input.value.trim();

  if (!message || isSending) return;

  if (
    voiceMode &&
    setupReady &&
    socket &&
    socket.readyState === WebSocket.OPEN
  ) {
    socket.send(JSON.stringify({
      realtimeInput: {
        text: message
      }
    }));

    addMessage(message, "user");
    input.value = "";
    return;
  }

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

    conversationHistory = conversationHistory.slice(-30);

    loading.remove();
    addMessage(data.answer, "katya");

  } catch (error) {
    loading.remove();
    addMessage("Ошибка: " + error.message, "katya");
  } finally {
    isSending = false;
    send.disabled = false;
  }
}

send.addEventListener("click", sendMessage);

input.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendMessage();
  }
});

voice.addEventListener("click", () => {
  if (voiceMode) {
    stopVoiceMode();
  } else if (voiceEnabled) {
    startVoiceMode();
  } else {
    addMessage("Сначала включи голос в настройках.", "katya");
  }
});

settingsButton?.addEventListener("click", () => {
  voiceEnabled = !voiceEnabled;

  if (!voiceEnabled && voiceMode) {
    stopVoiceMode();
  }

  addMessage(
    voiceEnabled ? "Голос включён." : "Голос выключен.",
    "katya"
  );
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
    stopPlayback();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && voiceMode) {
    stopVoiceMode();
  }
});

window.addEventListener("beforeunload", () => {
  stopVoiceMode(false);
});

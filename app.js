
const chat = document.getElementById("chat");
const messageInput = document.getElementById("message");
const sendButton = document.getElementById("send");
const voiceButton = document.getElementById("voice");
const voiceExit = document.getElementById("voiceExit");
const orb = document.getElementById("katyaOrb");

// =====================================================
// ОСНОВНЫЕ ПЕРЕМЕННЫЕ
// =====================================================

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

const AUDIO_BUFFER_SECONDS = 0.20;
const AUDIO_MIN_AHEAD_SECONDS = 0.06;


// =====================================================
// РЕЖИМЫ КАТИ
// =====================================================

const KATYA_MODE_STORAGE_KEY = "katya_ai_mode_v1";

function normalizeKatyaMode(value) {
  const mode = String(value || "").trim().toLowerCase();

  if (mode === "bdsm") return "bdsm";
  if (mode === "wife") return "wife";

  return "normal";
}

let katyaMode = normalizeKatyaMode(
  localStorage.getItem(KATYA_MODE_STORAGE_KEY)
);

function saveKatyaMode() {
  try {
    localStorage.setItem(KATYA_MODE_STORAGE_KEY, katyaMode);
  } catch (error) {
    console.warn("Не удалось сохранить режим Кати:", error);
  }
}


function createKatyaModeSwitcher() {
  if (document.getElementById("katyaModeSwitcher")) return;

  const style = document.createElement("style");

  style.textContent = `
    #katyaModeSwitcher {
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99990;

      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;

      padding: 5px;
      border-radius: 30px;
      background: rgba(25, 18, 29, .96);
      border: 1px solid rgba(255,255,255,.15);
      box-shadow: 0 4px 18px rgba(0,0,0,.3);
      backdrop-filter: blur(12px);

      width: max-content;
      max-width: calc(100vw - 24px);
      box-sizing: border-box;

      touch-action: pan-y;
      user-select: none;
      -webkit-user-select: none;
      -webkit-tap-highlight-color: transparent;
      overscroll-behavior: contain;
    }

    #katyaModeSwitcher button {
      flex: 0 0 auto;
      border: none;
      border-radius: 24px;
      padding: 9px 13px;
      background: transparent;
      color: #ddd;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
      transition:
        background .2s ease,
        transform .2s ease,
        opacity .2s ease;
      -webkit-tap-highlight-color: transparent;
    }

    #katyaModeSwitcher button.active {
      background: linear-gradient(135deg, #ff75b5, #e83e91);
      color: white;
      box-shadow: 0 2px 9px rgba(232, 62, 145, .25);
    }

    #katyaModeSwitcher button.active[data-mode="bdsm"] {
      background: linear-gradient(135deg, #9b174b, #e00055);
    }

    #katyaModeSwitcher button.active[data-mode="wife"] {
      background: linear-gradient(135deg, #9b285e, #e34b91);
    }

    #katyaModeSwitcher button:active {
      transform: scale(.96);
    }

    @media (max-width: 420px) {
      #katyaModeSwitcher {
        gap: 3px;
        padding: 4px;
      }

      #katyaModeSwitcher button {
        padding: 9px 10px;
        font-size: 10px;
      }
    }
  `;

  document.head.appendChild(style);

  const switcher = document.createElement("div");
  switcher.id = "katyaModeSwitcher";

  switcher.innerHTML = `
    <button type="button" data-mode="normal">
      ❤️ Обычная Катя
    </button>

    <button type="button" data-mode="bdsm">
      👠 Катя BDSM
    </button>

    <button type="button" data-mode="wife">
      💍 Катя Жена
    </button>
  `;

  document.body.appendChild(switcher);

  // Обычное нажатие на режим.
  switcher.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      changeKatyaMode(button.dataset.mode);
    });
  });

  // Свайп только внутри переключателя режимов.
  const modes = ["normal", "bdsm", "wife"];

  let startX = 0;
  let startY = 0;
  let activePointer = null;
  let suppressClick = false;
  let suppressTimer = null;

  switcher.addEventListener("pointerdown", event => {
    if (activePointer !== null) return;

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    activePointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;

    try {
      switcher.setPointerCapture(event.pointerId);
    } catch (error) {}
  });

  switcher.addEventListener("pointerup", event => {
    if (event.pointerId !== activePointer) return;

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    activePointer = null;

    const horizontalSwipe =
      Math.abs(deltaX) >= 45 &&
      Math.abs(deltaX) > Math.abs(deltaY) * 1.3;

    if (!horizontalSwipe) return;

    const currentIndex = modes.indexOf(katyaMode);

    if (currentIndex === -1) return;

    let nextIndex = currentIndex;

    if (deltaX < 0) {
      // Свайп влево — следующий режим.
      nextIndex = Math.min(currentIndex + 1, modes.length - 1);
    } else {
      // Свайп вправо — предыдущий режим.
      nextIndex = Math.max(currentIndex - 1, 0);
    }

    if (nextIndex === currentIndex) return;

    suppressClick = true;

    if (suppressTimer) {
      clearTimeout(suppressTimer);
    }

    suppressTimer = setTimeout(() => {
      suppressClick = false;
      suppressTimer = null;
    }, 500);

    changeKatyaMode(modes[nextIndex]);
  });

  switcher.addEventListener("pointercancel", () => {
    activePointer = null;
  });

  // Не допускаем случайного нажатия на кнопку после свайпа.
  switcher.addEventListener("click", event => {
    if (!suppressClick) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    suppressClick = false;

    if (suppressTimer) {
      clearTimeout(suppressTimer);
      suppressTimer = null;
    }
  }, true);

  updateKatyaModeSwitcher();
}


function updateKatyaModeSwitcher() {
  const switcher = document.getElementById("katyaModeSwitcher");
  if (!switcher) return;

  switcher.querySelectorAll("button").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.mode === katyaMode
    );
  });
}

function changeKatyaMode(newMode) {
  newMode = normalizeKatyaMode(newMode);

  if (newMode === katyaMode) return;

  const wasVoiceActive = voiceActive || voiceStarting;

  katyaMode = newMode;

  saveKatyaMode();
  updateKatyaModeSwitcher();

  const notifications = {
    normal: "Режим изменён. Я снова обычная Катя. ❤️",
    bdsm: "Режим изменён. Теперь я Госпожа Катя. 👠",
    wife: "Режим изменён. Теперь я Катя Жена. 💍"
  };

  addMessage(notifications[katyaMode] || notifications.normal, "katya");

  if (wasVoiceActive) {
    stopVoiceMode();

    wakeEnabled = false;

    setTimeout(() => {
      if (katyaMode === newMode) {
        startVoiceMode();
      }
    }, 400);
  }
}


// =====================================================
// ГОЛОСОВАЯ АКТИВАЦИЯ
// =====================================================

let wakeRecognition = null;
let wakeEnabled = true;
let wakeListening = false;
let wakeStarting = false;
let wakeRestartTimer = null;
let wakeGreetingPending = false;
let lastRestoreTime = 0;
let pageWasHidden = false;

// =====================================================
// ИСТОРИЯ РАЗГОВОРОВ
// =====================================================

const KATYA_STORAGE_KEY = "katya_saved_conversations_v1";

let katyaConversationMessages = [];
let katyaActiveConversationId = null;
let katyaWaitingForTitle = false;

// =====================================================
// МУЗЫКА — YOUTUBE
// =====================================================

let youtubePlayer = null;
let youtubePlayerReady = false;
let youtubeQueue = [];
let youtubeCurrentIndex = -1;
let youtubeSearching = false;
let youtubeLastSearch = "";

const MUSIC_SEARCH_ENDPOINT = "/api/music/search";

const musicElements = {
  screen: document.getElementById("musicScreen"),
  title: document.getElementById("musicTrackTitle"),
  status: document.getElementById("musicTrackStatus"),
  search: document.getElementById("musicSearchInput"),
  searchButton: document.getElementById("musicSearchButton"),
  playPause: document.getElementById("musicPlayPause"),
  previous: document.getElementById("musicPrevious"),
  next: document.getElementById("musicNext"),
  volume: document.getElementById("musicVolume")
};

function musicStatus(text) {
  if (musicElements.status) {
    musicElements.status.textContent = text;
  }
}

function musicTitle(text) {
  if (musicElements.title) {
    musicElements.title.textContent = text;
  }
}

function openMusicScreen() {
  if (typeof showKatyaMusic === "function") {
    showKatyaMusic();
  }

  if (typeof closeKatyaMenu === "function") {
    closeKatyaMenu();
  }
}

function initializeYouTubePlayer() {
  if (youtubePlayerReady || !window.YT || !window.YT.Player) {
    return;
  }

  const container = document.getElementById("youtubePlayer");

  if (!container) return;

  try {
    youtubePlayer = new YT.Player("youtubePlayer", {
      width: "100%",
      height: "220",
      videoId: "",
      playerVars: {
        autoplay: 0,
        controls: 1,
        playsinline: 1,
        rel: 0,
        modestbranding: 1
      },

      events: {
        onReady: function(event) {
          youtubePlayerReady = true;

          event.target.setVolume(
            Number(musicElements.volume?.value || 70)
          );

          musicStatus("Плеер готов. Найди любимую песню ❤️");
        },

        onStateChange: function(event) {
          if (!window.YT) return;

          if (event.data === YT.PlayerState.PLAYING) {
            updateMusicPlayButton(true);
            musicStatus("Сейчас играет ❤️");
          }

          if (event.data === YT.PlayerState.PAUSED) {
            updateMusicPlayButton(false);
            musicStatus("Музыка на паузе");
          }

          if (event.data === YT.PlayerState.ENDED) {
            playNextMusic();
          }

          if (event.data === YT.PlayerState.BUFFERING) {
            musicStatus("Загрузка музыки...");
          }
        },

        onError: function(event) {
          console.error("YouTube Player Error:", event.data);
          musicStatus("Не удалось воспроизвести видео.");
          updateMusicPlayButton(false);
        }
      }
    });
  } catch (error) {
    console.error("Ошибка создания YouTube Player:", error);
    musicStatus("Не удалось загрузить музыкальный плеер.");
  }
}

window.onYouTubeIframeAPIReady = function() {
  initializeYouTubePlayer();
};

// Если API загрузился раньше app.js.
if (window.YT && window.YT.Player) {
  initializeYouTubePlayer();
}

function updateMusicPlayButton(playing) {
  if (!musicElements.playPause) return;

  musicElements.playPause.textContent = playing ? "⏸" : "▶";

  musicElements.playPause.setAttribute(
    "aria-label",
    playing ? "Пауза" : "Воспроизвести"
  );
}

function playMusicByIndex(index) {
  if (!youtubeQueue.length) {
    musicStatus("Сначала найди музыку.");
    return;
  }

  if (!youtubePlayerReady || !youtubePlayer) {
    musicStatus("Музыкальный плеер ещё загружается.");
    return;
  }

  if (index < 0) {
    index = youtubeQueue.length - 1;
  }

  if (index >= youtubeQueue.length) {
    index = 0;
  }

  youtubeCurrentIndex = index;

  const track = youtubeQueue[index];

  if (!track || !track.videoId) return;

  musicTitle(track.title || "Неизвестная песня");
  musicStatus("Загрузка музыки...");

  openMusicScreen();

  try {
    youtubePlayer.loadVideoById(track.videoId);
    youtubePlayer.setVolume(
      Number(musicElements.volume?.value || 70)
    );

    updateMusicPlayButton(true);
  } catch (error) {
    console.error("Ошибка воспроизведения:", error);
    musicStatus("Не удалось включить песню.");
  }
}

async function searchKatyaMusic(query) {
  query = String(query || "").trim();

  if (!query || youtubeSearching) return;

  youtubeSearching = true;
  youtubeLastSearch = query;

  openMusicScreen();

  musicTitle("Поиск музыки...");
  musicStatus("Ищу: " + query);

  if (musicElements.search) {
    musicElements.search.value = query;
  }

  try {
    const response = await fetch(MUSIC_SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: query,
        maxResults: 10
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Ошибка поиска музыки");
    }

    const items = Array.isArray(data.items)
      ? data.items
      : [];

    youtubeQueue = items.filter(item =>
      item &&
      item.videoId &&
      typeof item.videoId === "string"
    );

    youtubeCurrentIndex = -1;

    if (!youtubeQueue.length) {
      musicTitle("Ничего не найдено");
      musicStatus("Попробуй другое название песни.");
      return;
    }

    musicStatus(
      "Найдено песен: " + youtubeQueue.length
    );

    playMusicByIndex(0);

    addMessage(
      "Я нашла музыку по запросу «" + query + "». Включаю! ❤️",
      "katya"
    );

  } catch (error) {
    console.error("MUSIC SEARCH ERROR:", error);

    musicTitle("Ошибка поиска");
    musicStatus(error.message);

    addMessage(
      "Не удалось найти музыку. Проверь подключение музыкального поиска.",
      "katya"
    );

  } finally {
    youtubeSearching = false;
  }
}

function toggleKatyaMusic() {
  if (!youtubePlayerReady || !youtubePlayer) {
    musicStatus("Плеер ещё загружается.");
    return;
  }

  try {
    const state = youtubePlayer.getPlayerState();

    if (state === YT.PlayerState.PLAYING) {
      youtubePlayer.pauseVideo();
      updateMusicPlayButton(false);
    } else {
      if (youtubeCurrentIndex === -1 && youtubeQueue.length) {
        playMusicByIndex(0);
      } else {
        youtubePlayer.playVideo();
        updateMusicPlayButton(true);
      }
    }
  } catch (error) {
    console.error("Ошибка управления музыкой:", error);
  }
}

function pauseKatyaMusic() {
  if (!youtubePlayerReady || !youtubePlayer) return;

  youtubePlayer.pauseVideo();
  updateMusicPlayButton(false);
  musicStatus("Музыка остановлена на паузе.");
}

function resumeKatyaMusic() {
  if (!youtubePlayerReady || !youtubePlayer) {
    musicStatus("Плеер ещё загружается.");
    return;
  }

  if (youtubeCurrentIndex === -1 && youtubeQueue.length) {
    playMusicByIndex(0);
    return;
  }

  youtubePlayer.playVideo();
  updateMusicPlayButton(true);
}

function playNextMusic() {
  if (!youtubeQueue.length) {
    musicStatus("Сначала найди музыку.");
    return;
  }

  playMusicByIndex(youtubeCurrentIndex + 1);
}

function playPreviousMusic() {
  if (!youtubeQueue.length) {
    musicStatus("Сначала найди музыку.");
    return;
  }

  playMusicByIndex(youtubeCurrentIndex - 1);
}

function changeKatyaMusicVolume(direction) {
  if (!youtubePlayerReady || !youtubePlayer) return;

  let volume = Number(
    musicElements.volume?.value || 70
  );

  volume += direction === "up" ? 10 : -10;

  volume = Math.max(0, Math.min(100, volume));

  youtubePlayer.setVolume(volume);

  if (musicElements.volume) {
    musicElements.volume.value = volume;
  }

  musicStatus("Громкость: " + volume + "%");
}

function stopKatyaMusic() {
  if (!youtubePlayerReady || !youtubePlayer) return;

  youtubePlayer.stopVideo();

  updateMusicPlayButton(false);

  musicTitle("Музыка выключена");
  musicStatus("Скажи, если захочешь послушать ещё. ❤️");
}

// =====================================================
// ГОЛОСОВЫЕ КОМАНДЫ МУЗЫКИ
// =====================================================

function detectMusicCommand(text) {
  const normalized = normalizeCommandText(text);

  if (!normalized) return null;

  // Выключение музыки.
  if (
    /^(катя )?(выключи|останови|закончи) музыку$/.test(normalized) ||
    /^(катя )?(выключи|останови) плеер$/.test(normalized)
  ) {
    return { action: "stop" };
  }

  // Пауза.
  if (
    /^(катя )?(пауза|поставь на паузу|приостанови музыку|останови песню)$/.test(normalized)
  ) {
    return { action: "pause" };
  }

  // Продолжение.
  if (
    /^(катя )?(продолжи|возобнови|продолжай) (музыку|воспроизведение)$/.test(normalized) ||
    /^(катя )?(продолжай|играй дальше)$/.test(normalized)
  ) {
    return { action: "resume" };
  }

  // Следующая песня.
  if (
    /^(катя )?(следующая|следующий|дальше|переключи песню)$/.test(normalized) ||
    /^(катя )?(включи следующую песню|следующий трек)$/.test(normalized)
  ) {
    return { action: "next" };
  }

  // Предыдущая песня.
  if (
    /^(катя )?(предыдущая песня|предыдущий трек|верни предыдущую песню)$/.test(normalized)
  ) {
    return { action: "previous" };
  }

  // Громкость.
  if (
    /^(катя )?(сделай )?(музыку )?(громче|погромче)$/.test(normalized) ||
    /^(катя )?увеличь громкость$/.test(normalized)
  ) {
    return { action: "volumeUp" };
  }

  if (
    /^(катя )?(сделай )?(музыку )?(тише|потише)$/.test(normalized) ||
    /^(катя )?уменьши громкость$/.test(normalized)
  ) {
    return { action: "volumeDown" };
  }

  // Включить музыку без названия.
  if (
    /^(катя )?(включи|запусти|поставь|найди) музыку$/.test(normalized) ||
    /^(катя )?хочу послушать музыку$/.test(normalized)
  ) {
    return { action: "open" };
  }

  // Поиск конкретной песни или исполнителя.
  const searchPatterns = [
    /^(?:катя )?(?:включи|поставь|найди|запусти|сыграй) песню (.+)$/,
    /^(?:катя )?(?:включи|поставь|найди|запусти|сыграй) музыку (?:исполнителя )?(.+)$/,
    /^(?:катя )?(?:включи|поставь|найди|запусти|сыграй) (.+)$/,
    /^(?:катя )?хочу послушать (.+)$/
  ];

  for (const pattern of searchPatterns) {
    const match = normalized.match(pattern);

    if (match && match[1]) {
      const query = match[1].trim();

      if (
        query &&
        !["музыку", "песню", "музыка"].includes(query)
      ) {
        return {
          action: "search",
          query: query
        };
      }
    }
  }

  return null;
}

function handleMusicCommand(text) {
  const command = detectMusicCommand(text);

  if (!command) return false;

  openMusicScreen();

  switch (command.action) {
    case "open":
      if (youtubeCurrentIndex >= 0 && youtubePlayerReady) {
        resumeKatyaMusic();
      } else {
        musicStatus("Назови песню или исполнителя. ❤️");
      }

      addMessage("Конечно! Давай послушаем музыку. ❤️", "katya");
      break;

    case "search":
      searchKatyaMusic(command.query);
      break;

    case "pause":
      pauseKatyaMusic();
      addMessage("Хорошо, поставила музыку на паузу. ❤️", "katya");
      break;

    case "resume":
      resumeKatyaMusic();
      addMessage("Продолжаем слушать! ❤️", "katya");
      break;

    case "next":
      playNextMusic();
      addMessage("Включаю следующую песню. ❤️", "katya");
      break;

    case "previous":
      playPreviousMusic();
      addMessage("Возвращаю предыдущую песню. ❤️", "katya");
      break;

    case "volumeUp":
      changeKatyaMusicVolume("up");
      addMessage("Делаю музыку громче. ❤️", "katya");
      break;

    case "volumeDown":
      changeKatyaMusicVolume("down");
      addMessage("Делаю музыку тише. ❤️", "katya");
      break;

    case "stop":
      stopKatyaMusic();
      addMessage("Хорошо, выключила музыку. ❤️", "katya");
      break;
  }

  return true;
}

// =====================================================
// КНОПКИ МУЗЫКАЛЬНОГО ЦЕНТРА
// =====================================================

if (musicElements.searchButton) {
  musicElements.searchButton.addEventListener("click", () => {
    searchKatyaMusic(musicElements.search?.value || "");
  });
}

if (musicElements.search) {
  musicElements.search.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      searchKatyaMusic(musicElements.search.value);
    }
  });
}

if (musicElements.playPause) {
  musicElements.playPause.addEventListener(
    "click",
    toggleKatyaMusic
  );
}

if (musicElements.previous) {
  musicElements.previous.addEventListener(
    "click",
    playPreviousMusic
  );
}

if (musicElements.next) {
  musicElements.next.addEventListener(
    "click",
    playNextMusic
  );
}

if (musicElements.volume) {
  musicElements.volume.addEventListener("input", () => {
    const volume = Number(musicElements.volume.value);

    if (youtubePlayerReady && youtubePlayer) {
      youtubePlayer.setVolume(volume);
    }
  });
}

// =====================================================
// УСТРОЙСТВО
// =====================================================

function isIOSDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" &&
     navigator.maxTouchPoints > 1);
}

function isAndroidDevice() {
  return /Android/i.test(navigator.userAgent);
}

// =====================================================
// ПРИЛОЖЕНИЯ
// =====================================================

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
    aliases: [
      "настройки планшета",
      "настройки телефона",
      "настройки",
      "settings"
    ],
    androidUrl: "intent://com.android.settings/#Intent;scheme=android-app;end",
    iosUrl: null,
    webUrl: null
  }
};

// =====================================================
// ИНТЕРФЕЙС
// =====================================================

function addMessage(text, type) {
  if (!chat || !text) return;

  const element = document.createElement("div");
  element.className = `message ${type}`;
  element.textContent = text;

  chat.appendChild(element);
  chat.scrollTop = chat.scrollHeight;
}

function setStatus(text) {
  addMessage(text, "katya");
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

// =====================================================
// ЗАПУСК ПРИЛОЖЕНИЙ
// =====================================================

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

// =====================================================
// РАСПОЗНАВАНИЕ КОМАНД
// =====================================================

function normalizeCommandText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
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

  Object.assign(button.style, {
    display: "block",
    marginTop: "10px",
    padding: "11px 18px",
    border: "none",
    borderRadius: "20px",
    background: "linear-gradient(135deg, #ff75b5, #e83e91)",
    color: "#ffffff",
    fontWeight: "600",
    cursor: "pointer"
  });

  button.addEventListener("click", () => launchApp(appKey));

  container.appendChild(text);
  container.appendChild(button);

  chat.appendChild(container);
  chat.scrollTop = chat.scrollHeight;

  launchApp(appKey);
}

// =====================================================
// ХРАНИЛИЩЕ ИСТОРИИ
// =====================================================

function getKatyaSavedConversations() {
  try {
    const data = JSON.parse(
      localStorage.getItem(KATYA_STORAGE_KEY) || "[]"
    );

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Ошибка чтения истории:", error);
    return [];
  }
}

function setKatyaSavedConversations(items) {
  try {
    localStorage.setItem(
      KATYA_STORAGE_KEY,
      JSON.stringify(items)
    );

    return true;
  } catch (error) {
    console.error("Ошибка сохранения:", error);
    addMessage("Не удалось сохранить разговор.", "katya");
    return false;
  }
}

// =====================================================
// ЗАПИСЬ СООБЩЕНИЙ В ИСТОРИЮ
// =====================================================

function recordKatyaMessage(role, text) {
  if (!text || typeof text !== "string") return;

  text = text.trim();
  if (!text) return;

  katyaConversationMessages.push({
    role,
    text,
    date: new Date().toISOString()
  });

  if (katyaConversationMessages.length > 500) {
    katyaConversationMessages =
      katyaConversationMessages.slice(-500);
  }

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

  conversations[index].messages = [
    ...katyaConversationMessages
  ];

  conversations[index].updatedAt = new Date().toISOString();

  setKatyaSavedConversations(conversations);
}

// =====================================================
// ПОДГОТОВКА ИСТОРИИ ДЛЯ GEMINI
// =====================================================

function getKatyaHistoryForAI() {
  const source = katyaConversationMessages.length
    ? katyaConversationMessages
    : history;

  return source.slice(-40).map(message => ({
    role: message.role === "user" ? "user" : "model",
    text: String(message.text || "").slice(0, 4000)
  }));
}

// =====================================================
// СОХРАНЕНИЕ РАЗГОВОРА
// =====================================================

function saveKatyaConversation(title) {
  title = String(title || "").trim();

  if (!title) {
    addMessage("Назови наш разговор. ❤️", "katya");
    return;
  }

  if (!katyaConversationMessages.length) {
    addMessage("Пока нечего сохранять.", "katya");
    return;
  }

  const conversations = getKatyaSavedConversations();

  const conversation = {
    id: "katya_" + Date.now(),
    title: title.slice(0, 150),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [...katyaConversationMessages]
  };

  conversations.unshift(conversation);

  if (!setKatyaSavedConversations(conversations)) return;

  katyaActiveConversationId = conversation.id;

  addMessage(
    `Я сохранила наш разговор «${conversation.title}». ❤️`,
    "katya"
  );

  renderKatyaHistory();
}

// =====================================================
// КОМАНДЫ СОХРАНЕНИЯ
// =====================================================

function detectSaveConversationCommand(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .trim();

  const match = normalized.match(
    /(?:катя[\s,]*)?запомни\s+(?:этот\s+)?разговор\s*(?:(?:под\s+)?названием\s+|под\s+именем\s+|[:\-—]\s*)?(.+)?$/i
  );

  if (!match) return null;

  let title = (match[1] || "").trim();
  title = title.replace(/[.!?]+$/, "").trim();

  return {
    title: title || null
  };
}

function handleKatyaSaveCommand(text) {
  const command = detectSaveConversationCommand(text);

  if (!command) return false;

  recordKatyaMessage("user", text);

  if (command.title) {
    saveKatyaConversation(command.title);
  } else {
    katyaWaitingForTitle = true;

    addMessage(
      "Конечно! Как назовём этот разговор? ❤️",
      "katya"
    );
  }

  return true;
}

// =====================================================
// ОТКРЫТИЕ СОХРАНЁННОГО РАЗГОВОРА
// =====================================================

function openKatyaConversation(id) {
  const conversations = getKatyaSavedConversations();

  const conversation = conversations.find(
    item => item.id === id
  );

  if (!conversation) return;

  if (voiceActive || voiceStarting) {
    stopVoiceMode();
  }

  katyaActiveConversationId = conversation.id;

  katyaConversationMessages = Array.isArray(conversation.messages)
    ? [...conversation.messages]
    : [];

  history = katyaConversationMessages.map(message => ({
    role: message.role === "user" ? "user" : "model",
    text: message.text
  }));

  if (chat) {
    chat.innerHTML = "";

    katyaConversationMessages.forEach(message => {
      addMessage(
        message.text,
        message.role === "user" ? "user" : "katya"
      );
    });
  }

  closeKatyaHistory();

  addMessage(
    `Мы вернулись к разговору «${conversation.title}». ❤️`,
    "katya"
  );

  addMessage(
    "Я восстановила нашу переписку. Можем продолжать!",
    "katya"
  );
}

// =====================================================
// УДАЛЕНИЕ РАЗГОВОРА
// =====================================================

function deleteKatyaConversation(id) {
  const conversations = getKatyaSavedConversations()
    .filter(item => item.id !== id);

  if (!setKatyaSavedConversations(conversations)) return;

  if (katyaActiveConversationId === id) {
    katyaActiveConversationId = null;
    katyaConversationMessages = [];
    history = [];
  }

  renderKatyaHistory();
}

// =====================================================
// ИНТЕРФЕЙС ИСТОРИИ
// =====================================================

function createKatyaHistoryInterface() {
  if (document.getElementById("katyaHistoryOverlay")) return;

  const style = document.createElement("style");

  style.textContent = `
    #katyaHistoryOverlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 99999;
      background: rgba(0,0,0,.78);
      align-items: center;
      justify-content: center;
      padding: 15px;
      box-sizing: border-box;
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
      box-sizing: border-box;
    }

    #katyaHistoryClose {
      float: right;
      border: none;
      background: none;
      color: white;
      font-size: 27px;
      cursor: pointer;
    }

    .katya-history-item {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 12px;
      padding: 13px;
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
      overflow-wrap: anywhere;
    }

    .katya-history-delete {
      border: none;
      border-radius: 10px;
      padding: 9px;
      background: #a52c53;
      color: white;
      cursor: pointer;
    }
  `;

  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.id = "katyaHistoryOverlay";

  overlay.innerHTML = `
    <div id="katyaHistoryPanel">
      <button id="katyaHistoryClose" type="button">×</button>
      <h2>📚 История разговоров</h2>
      <div id="katyaHistoryList"></div>
    </div>
  `;

  overlay.addEventListener("click", event => {
    if (event.target === overlay) {
      closeKatyaHistory();
    }
  });

  document.body.appendChild(overlay);

  document.getElementById("katyaHistoryClose")
    .addEventListener("click", closeKatyaHistory);

  const historyButton = document.querySelector(
    '.drawer-item[data-drawer-action="history"]'
  );

  if (historyButton && !historyButton.dataset.katyaHistoryBound) {
    historyButton.dataset.katyaHistoryBound = "true";

    historyButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      if (typeof closeKatyaMenu === "function") {
        closeKatyaMenu();
      }

      openKatyaHistory();
    }, true);
  }

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
    open.type = "button";
    open.className = "katya-history-open";

    const count = Array.isArray(conversation.messages)
      ? conversation.messages.length
      : 0;

    open.textContent =
      `💬 ${conversation.title} (${count} сообщений)`;

    open.title = new Date(
      conversation.updatedAt
    ).toLocaleString("ru-RU");

    open.addEventListener("click", () => {
      openKatyaConversation(conversation.id);
    });

    const remove = document.createElement("button");
    remove.type = "button";
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

// =====================================================
// ТРАНСКРИПЦИЯ
// =====================================================

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

function scheduleInputTranscriptionFinish(delay = 1400) {
  if (inputTranscriptionTimer) {
    clearTimeout(inputTranscriptionTimer);
  }

  inputTranscriptionTimer = setTimeout(() => {
    inputTranscriptionTimer = null;
    finishInputTranscription();
  }, delay);
}

function clearInputTranscription() {
  if (inputTranscriptionTimer) {
    clearTimeout(inputTranscriptionTimer);
    inputTranscriptionTimer = null;
  }

  inputTextBuffer = "";
  latestInterimTranscription = "";
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

  if (katyaWaitingForTitle) {
    katyaWaitingForTitle = false;
    saveKatyaConversation(recognizedText);
    return;
  }

  if (handleKatyaSaveCommand(recognizedText)) return;

  recordKatyaMessage("user", recognizedText);

  // Сначала проверяем музыкальные команды.
  if (handleMusicCommand(recognizedText)) return;

  const appKey = detectAppCommand(recognizedText);

  if (appKey) showAppLaunchButton(appKey);
}

// =====================================================
// АУДИО
// =====================================================

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

// =====================================================
// ПРИВЕТСТВИЕ
// =====================================================

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

// =====================================================
// ВОСПРОИЗВЕДЕНИЕ GEMINI
// =====================================================

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

  if (text) {
    recordKatyaMessage("model", text);
    addMessage(text, "katya");
  }

  outputTextBuffer = "";
}

// =====================================================
// ОБРАБОТКА GEMINI
// =====================================================

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

// =====================================================
// МИКРОФОН
// =====================================================

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

  audioOutputDestination =
    audioContext.createMediaStreamDestination();

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

  processor = audioContext.createScriptProcessor(1024, 1, 1);

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

// =====================================================
// ГОЛОСОВАЯ АКТИВАЦИЯ «КАТЯ»
// =====================================================

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
    setStatus(
      "Голосовая активация не поддерживается этим браузером."
    );
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

// =====================================================
// ВОССТАНОВЛЕНИЕ ПОСЛЕ YOUTUBE И ДРУГИХ ПРИЛОЖЕНИЙ
// =====================================================

function restoreKatyaAfterBackground() {
  if (document.visibilityState === "hidden") return;

  const now = Date.now();

  if (now - lastRestoreTime < 2500) return;

  lastRestoreTime = now;

  console.log("Восстанавливаю Катю после возвращения.");

  if (
    voiceActive ||
    voiceStarting ||
    socket ||
    microphone ||
    audioContext
  ) {
    stopVoiceMode();
  }

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

// =====================================================
// GEMINI LIVE
// =====================================================

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

    const protocol = location.protocol === "https:"
      ? "wss:"
      : "ws:";

    const newSocket = new WebSocket(
  `${protocol}//${location.host}/live?mode=${encodeURIComponent(katyaMode)}`
);

    socket = newSocket;

    newSocket.onopen = () => {
      if (
        !voiceActive ||
        socket !== newSocket ||
        currentSession !== sessionId
      ) return;

      console.log("Соединение с сервером установлено");

      const previousHistory = getKatyaHistoryForAI();

      if (previousHistory.length) {
        try {
          newSocket.send(JSON.stringify({
            type: "history",
            history: previousHistory
          }));

          console.log(
            "История передана Gemini Live:",
            previousHistory.length
          );

        } catch (error) {
          console.error("Ошибка передачи истории:", error);
        }
      }
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
      console.log(
        "WebSocket закрыт:",
        event.code,
        event.reason
      );

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

// =====================================================
// ОСТАНОВКА ГОЛОСОВОГО РЕЖИМА
// =====================================================

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


// =====================================================
// ТЕКСТОВЫЙ ЧАТ — GEMINI
// =====================================================

let textChatSending = false;

async function sendTextMessage() {
  if (!messageInput || textChatSending) return;

  const message = messageInput.value.trim();
  if (!message) return;

  messageInput.value = "";

  // Если Катя ожидает название разговора.
  if (katyaWaitingForTitle) {
    katyaWaitingForTitle = false;
    saveKatyaConversation(message);
    return;
  }

  // Команда сохранения истории.
  if (handleKatyaSaveCommand(message)) {
    addMessage(message, "user");
    return;
  }

  // Сохраняем предыдущую историю ДО добавления нового сообщения.
  const previousHistory = getKatyaHistoryForAI();

  // Показываем сообщение пользователя.
  addMessage(message, "user");

  // Сохраняем в общую историю Кати.
  recordKatyaMessage("user", message);

  // Обработка музыкальных команд.
  if (handleMusicCommand(message)) {
    return;
  }

  // Обработка запуска приложений.
  const appKey = detectAppCommand(message);

  if (appKey) {
    showAppLaunchButton(appKey);
    return;
  }

  textChatSending = true;

  if (sendButton) {
    sendButton.disabled = true;
  }

  try {
    const response = await fetch("/api/chat", {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
  message: message,
  mode: katyaMode,
  history: previousHistory.slice(-40)
})
    });

    let data;

    try {
      data = await response.json();
    } catch (error) {
      throw new Error("Сервер вернул неправильный ответ.");
    }

    if (!response.ok) {
      throw new Error(
        data.error || "Ошибка сервера Кати."
      );
    }

    const reply = String(
      data.reply || "Не получилось получить ответ."
    ).trim();

    // Отображаем ответ Кати.
    addMessage(reply, "katya");

    // Сохраняем ответ в общую историю разговоров.
    recordKatyaMessage("model", reply);

    // Синхронизируем историю для Gemini Live.
    history = getKatyaHistoryForAI();

    console.log("Текстовый ответ Кати получен.");

  } catch (error) {
    console.error("CHAT ERROR:", error);

    addMessage(
      "Не удалось получить ответ от Кати: " + error.message,
      "katya"
    );

  } finally {
    textChatSending = false;

    if (sendButton) {
      sendButton.disabled = false;
    }

    if (messageInput) {
      messageInput.focus();
    }
  }
}

// =====================================================
// КНОПКИ ТЕКСТОВОГО ЧАТА
// =====================================================

if (sendButton) {
  sendButton.addEventListener("click", sendTextMessage);
}

if (messageInput) {
  messageInput.addEventListener("keydown", event => {
    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();
      sendTextMessage();
    }
  });
}


// =====================================================
// КНОПКИ
// =====================================================

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

// =====================================================
// ВОЗВРАЩЕНИЕ В SAFARI
// =====================================================

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
  if (
    pageWasHidden &&
    document.visibilityState === "visible"
  ) {
    pageWasHidden = false;

    setTimeout(() => {
      restoreKatyaAfterBackground();
    }, 700);
  }
});

// =====================================================
// АВТОЗАПУСК
// =====================================================

window.addEventListener("load", () => {
  setTimeout(() => {
    startWakeWordListening();

    // Проверяем, готов ли YouTube API.
    initializeYouTubePlayer();
  }, 1000);
});

// =====================================================
// ЗАКРЫТИЕ СТРАНИЦЫ
// =====================================================

window.addEventListener("pagehide", () => {
  pageWasHidden = true;
  stopWakeWordListening();
});

window.addEventListener("beforeunload", () => {
  wakeEnabled = false;

  stopWakeWordListening();
  stopVoiceMode();
});

// =====================================================
// ОБРАБОТКА ГОЛОСОВЫХ КОМАНД ИСТОРИИ
// =====================================================

// finishInputTranscription записывает голосовые сообщения
// и обрабатывает команды сохранения разговоров.

// =====================================================
// ИНИЦИАЛИЗАЦИЯ ИСТОРИИ
// =====================================================

function initializeKatyaHistory() {
  createKatyaHistoryInterface();
  createKatyaModeSwitcher();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeKatyaHistory,
    { once: true }
  );
} else {
  initializeKatyaHistory();
}

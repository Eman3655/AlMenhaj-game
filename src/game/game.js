import { DEFAULT_CONTENT } from "./content.js";
import mapLayout from "./content/map-layout.json";
import { renderAuthView } from "./auth-view.js";
import { getToken, getUser, logout } from "./auth.js";
import { getContent, getProgress, completeDoorOnServer, resolveObstacleOnServer, saveDoorOnServer, addDoorOnServer, deleteDoorOnServer, saveCardOnServer, addCardOnServer, deleteCardOnServer, saveObstacleOnServer, addObstacleOnServer, deleteObstacleOnServer, resetProgressOnServer } from "./api.js";

const SAVE_VERSION = 6;

const FALLBACK_ASSETS = {
  MAP_BACKDROP: "/generated-images/map_backdrop.png",
  LOCKED_DOOR: "/generated-images/locked_door.png",
  OPEN_DOOR: "/generated-images/open_door.png",
  TREASURE_CHEST: "/generated-images/treasure_chest.png",
  KNOWLEDGE_CARD: "/generated-images/knowledge_card.png",
  KEY: "/generated-images/key.png",
  OBSTACLE_TOKEN: "/generated-images/obstacle_token.png",
  STUDENT_EXPLORER: "/generated-images/student_explorer.png",
};

const MAP_COORD_WIDTH = 100;
const MAP_COORD_HEIGHT = 230;

function normalizeMapPosition(pos) {
  return {
    x: pos.x,
    y: (pos.y / MAP_COORD_HEIGHT) * 100,
  };
}

const LEVELS = [
  { min: 0, title: "المبتدئ" },
  { min: 90, title: "طالب العلم" },
  { min: 210, title: "المجتهد" },
  { min: 360, title: "الداعية" },
  { min: 540, title: "حامل العلم" },
  { min: 760, title: "وارث النبوة" },
];


function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uid(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getAssetUrl(assets, key) {
  try {
    return assets?.get?.(key) || FALLBACK_ASSETS[key];
  } catch {
    return FALLBACK_ASSETS[key];
  }

}

function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`تعذر تحميل الأصل: ${url}`));
    image.src = url;
  });
}

function splitList(value) {
  return String(value || "")
    .split(/[،,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function seededShuffle(arr, seed) {
  const shuffled = [...arr];
  let s = seed || 1;
  for (let i = shuffled.length - 1; i > 0; i--) {
    s = ((s * 1103515245) + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function getLevel(xp) {
  return LEVELS.reduce((current, level) => (xp >= level.min ? level : current), LEVELS[0]);
}

function getNextLevel(xp) {
  return LEVELS.find((level) => level.min > xp) || null;
}

function normalizeProgress(progress = {}) {
  return {
    completedDoors: Array.isArray(progress.completedDoors) ? progress.completedDoors : [],
    resolvedObstacles: Array.isArray(progress.resolvedObstacles) ? progress.resolvedObstacles : [],
    cards: Array.isArray(progress.cards) ? progress.cards : [],
    keys: Array.isArray(progress.keys) ? progress.keys : [],
    xp: Number.isFinite(progress.xp) ? progress.xp : 0,
    achievements: Array.isArray(progress.achievements) ? progress.achievements.slice(0, 12) : [],
  };
}

function getNodePosition(index, total, doorId = "") {
  const savedPosition = mapLayout.find((item) => item.doorId === doorId);

  if (savedPosition) {
    return normalizeMapPosition(savedPosition);
  }

  if (total <= 1) return { x: 50, y: 92 };

  return {
    x: 50,
    y: 92 - index * 3,
  };
}

function getMidpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function getMapScrollTop(shell) {
  return shell?.querySelector(".map-stage")?.scrollTop || 0;
}

function restoreMapScrollTop(shell, scrollTop) {
  const mapStage = shell?.querySelector(".map-stage");
  if (mapStage) {
    mapStage.scrollTop = scrollTop;
  }
}

function scrollToPlayer(shell) {
  const mapStage = shell?.querySelector(".map-stage");
  const player = shell?.querySelector(".player-marker");
  if (!mapStage || !player) return;

  const playerRect = player.getBoundingClientRect();
  const stageRect = mapStage.getBoundingClientRect();
  const playerCenterX = playerRect.left + playerRect.width / 2;
  const playerCenterY = playerRect.top + playerRect.height / 2;

  const targetLeft = mapStage.scrollLeft + (playerCenterX - stageRect.left - mapStage.clientWidth / 2);
  const targetTop = mapStage.scrollTop + (playerCenterY - stageRect.top - mapStage.clientHeight / 2);

  mapStage.scrollTo({
    left: Math.max(0, Math.min(targetLeft, mapStage.scrollWidth - mapStage.clientWidth)),
    top: Math.max(0, Math.min(targetTop, mapStage.scrollHeight - mapStage.clientHeight)),
    behavior: "auto",
  });
}

export function createGame({ mount, sdk, ready, tweaks, assets }) {
  console.log("DEFAULT_CONTENT:", DEFAULT_CONTENT);
  let cleanup = () => {};
  let shell;
  let overlay;
  let startButton;
  let overlayText;
  let saveIndicator;
  let audioHandle = null;
  let audioContext = null;

  const assetUrls = Object.fromEntries(Object.keys(FALLBACK_ASSETS).map((key) => [key, getAssetUrl(assets, key)]));
let authToken = getToken();
let currentUser = getUser();
  let content = clone(DEFAULT_CONTENT);
  let progress = normalizeProgress();
  let imagesReady = false;
  let saveReady = false;
  let started = false;
  let lastSaveOk = true;
let selectedDoorId = DEFAULT_CONTENT.doors[0]?.id || "";
  let selectedObstacleId = null;
  let phase = 0;
  let feedback = "";
  let rewardAnimation = null;
  let rewardQueue = [];
  let rewardTimeout = null;
  let hitAnimation = null;
  let panelOpen = false;
  let miniPick = [];
  let currentQuestionIndex = 0;
  let currentQuestionAttempts = 0;
  let currentQuestionScore = 0;
  let currentQuestionMaxScore = 0;
  let usedSabrBoost = false;
  let adminMode = "doors";
  let hudCollapsed = true;
let navCollapsed = true;
  let editingDoorId = DEFAULT_CONTENT.doors[0]?.id || "";
let editingCardId = DEFAULT_CONTENT.cards[0]?.id || "";
let editingObstacleId = DEFAULT_CONTENT.obstacles[0]?.id || "";
let editingQuestionIdx = -1;
let tempQuestion = null;
let matchSelections = {};
let fillAnswer = "";
  function playTone(type = "tap") {
    if (!audioContext) return;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    const tone = type === "success" ? 620 : type === "error" ? 180 : 340;
    oscillator.type = type === "success" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(tone, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.24);
  }

  async function unlockAudio() {
    try {
      audioHandle = await sdk.audio.getContext();
      await audioHandle.unlock();
      audioContext = audioHandle.context;
    } catch {
      audioContext = null;
    }
  }

  async function pulse(pattern = 25) {
    try {
      if (sdk.device?.haptics?.isSupported?.()) await sdk.device.haptics.vibrate(pattern);
    } catch {
      // Optional tactile feedback should never block play.
    }
  }

async function loadSave() {
  try {
    const serverContent = await getContent();

    if (serverContent?.doors?.length) {
      content = serverContent;
    } else {
      content = clone(DEFAULT_CONTENT);
    }

    if (authToken) {
      const serverProgress = await getProgress(authToken);
      progress = normalizeProgress(serverProgress);
    } else {
      const saved = await sdk.gameState.load();
      if (saved?.version === SAVE_VERSION) {
        progress = normalizeProgress(saved.progress);
      } else {
        progress = normalizeProgress();
      }
    }

    selectedDoorId = getCurrentDoor()?.id || content.doors[0]?.id || "";
    editingDoorId = content.doors[0]?.id || "";
    editingCardId = content.cards[0]?.id || "";
    editingObstacleId = content.obstacles[0]?.id || "";

    lastSaveOk = true;
  } catch (error) {
    console.error("فشل تحميل بيانات السيرفر:", error);

    content = clone(DEFAULT_CONTENT);
    progress = normalizeProgress();

    selectedDoorId = content.doors[0]?.id || "";
    editingDoorId = content.doors[0]?.id || "";
    editingCardId = content.cards[0]?.id || "";
    editingObstacleId = content.obstacles[0]?.id || "";

    lastSaveOk = false;
  } finally {
    saveReady = true;
    updateStartOverlay();
    render();
  }
}

  async function persist() {
    renderSaveState("جارٍ الحفظ...");
    try {
      const result = await sdk.gameState.save({ version: SAVE_VERSION, content, progress });
      lastSaveOk = !!result?.ok;
      renderSaveState(lastSaveOk ? "تم الحفظ" : "لم يكتمل الحفظ");
    } catch {
      lastSaveOk = false;
      renderSaveState("تعذر الحفظ");
    }
  }

  function renderSaveState(text = lastSaveOk ? "تم الحفظ" : "تعذر الحفظ") {
    if (saveIndicator) saveIndicator.textContent = text;
  }

  function updateStartOverlay(error = "") {
    if (!overlayText || !startButton) return;
    if (error) {
      overlayText.textContent = error;
      startButton.disabled = true;
      startButton.textContent = "تعذر البدء";
      return;
    }
    if (!imagesReady) {
      overlayText.textContent = "نرسم الخريطة ونجهز البطاقات...";
      startButton.disabled = true;
      startButton.textContent = "تحميل";
      return;
    }
    if (!saveReady) {
      overlayText.textContent = "نفتح سجل رحلتك...";
      startButton.disabled = true;
      startButton.textContent = "تحميل";
      return;
    }
    overlayText.textContent = "ابدأ من أول باب، اجمع البطاقات، وافتح الطريق نحو الكنز.";
    startButton.disabled = false;
    startButton.textContent = "ابدأ الرحلة";
  }

  function completedSet() {
    return new Set(progress.completedDoors);
  }

  function cardSet() {
    return new Set(progress.cards);
  }

  function obstacleSet() {
    return new Set(progress.resolvedObstacles);
  }

  function getDoorIndex(doorId) {
    return content.doors.findIndex((door) => door.id === doorId);
  }

  function getCurrentDoor() {
    const completed = completedSet();
    return content.doors.find((door, index) => !completed.has(door.id) && isDoorUnlocked(index)) || content.doors[content.doors.length - 1];
  }

  function getBlockingObstacleForDoor(index) {
    if (index <= 0) return null;
    const previousDoor = content.doors[index - 1];
    const resolved = obstacleSet();
    return content.obstacles.find((obstacle) => obstacle.gateAfter === previousDoor.id && !resolved.has(obstacle.id)) || null;
  }

  function isDoorUnlocked(index) {
    if (index === 0) return true;
    const previousDoor = content.doors[index - 1];
    return completedSet().has(previousDoor.id) && !getBlockingObstacleForDoor(index);
  }

  function addAchievement(text) {
    progress.achievements = [{ text, at: new Date().toLocaleDateString("ar") }, ...progress.achievements].slice(0, 10);
  }

function makeDoorKeyName(title) {
  return `مفتاح ${String(title || "").replace(/^باب\s*/i, "")}`;
}

function pushReward(reward) {
  if (!reward || !reward.type) return;
  rewardQueue.push(reward);
  if (!rewardAnimation) {
    showNextReward();
  }
}

function showCardReward(card, doorId) {
  if (!card) return;
  pushReward({ type: "card", item: { ...card, doorId, saved: false } });
}

function showKeyReward(key) {
  if (!key) return;
  pushReward({ type: "key", item: { ...key, subtitle: key.subtitle || "مفتاح" } });
}

function clearRewardAnimation() {
  if (rewardTimeout) {
    clearTimeout(rewardTimeout);
    rewardTimeout = null;
  }
}

function showNextReward() {
  clearRewardAnimation();
  rewardAnimation = rewardQueue.shift() || null;
  render();
  if (rewardAnimation) {
    const duration = rewardAnimation.type === "key" ? 1500 : 2000;
    rewardTimeout = setTimeout(() => {
      rewardAnimation = null;
      rewardTimeout = null;
      if (rewardQueue.length > 0) {
        showNextReward();
      } else {
        render();
      }
    }, duration);
  }
}

function showObstacleHit(obstacle) {
  if (!obstacle || hitAnimation) return;

  hitAnimation = obstacle;

setTimeout(() => {
  hitAnimation = null;
  render();
}, 1600);
}



async function completeDoor(door) {
  let nextBlocked = false;
  let pendingRewards = [];

  if (!progress.completedDoors.includes(door.id)) {
      const questions = getDoorQuestions(door);
      const threshold = Math.ceil(currentQuestionMaxScore * 0.8);
      const earnedCard = currentQuestionMaxScore > 0 && currentQuestionScore >= threshold;
      const card = content.cards.find((item) => item.id === door.cardId);

      progress.completedDoors.push(door.id);
      progress.xp += Number(door.xp) || 80;

      const keyId = door.id;
      const keyName = makeDoorKeyName(door.title);
      if (!progress.keys.includes(keyId)) {
        progress.keys.push(keyId);
        pendingRewards.push({ type: "key", item: { id: keyId, title: keyName } });
      }

      if (earnedCard && card && door.cardId && !progress.cards.includes(door.cardId)) {
        progress.cards.push(door.cardId);
        pendingRewards.push({ type: "card", item: card });
      } else if (!earnedCard && door.cardId) {
        progress.cards = progress.cards.filter((c) => c !== door.cardId);
      }

    addAchievement(`أكملت ${door.title}${earnedCard && card ? ` وحصلت على ${card.title}` : ""} وحصلت على ${keyName}`);

    playTone("success");
    pulse(40);

    if (authToken) {
      try {
        await completeDoorOnServer(authToken, door.id, door.id, currentQuestionScore, currentQuestionMaxScore);
        renderSaveState("تم الحفظ في الحساب");
      } catch (error) {
        console.error("تعذر حفظ الباب في السيرفر:", error);
        renderSaveState("تعذر الحفظ في الحساب");
      }
    } else {
      await persist();
    }
  }

  const currentIndex = getDoorIndex(door.id);

  const blocker = content.obstacles.find(
    (obstacle) =>
      obstacle.gateAfter === door.id &&
      !progress.resolvedObstacles.includes(obstacle.id)
  );

  if (blocker) {
    nextBlocked = true;
    selectedObstacleId = blocker.id;
    selectedDoorId = door.id;
    feedback = "ظهر عائق في الطريق. يجب تجاوزه قبل الانتقال إلى الباب التالي.";
  } else {
    const nextIndex = Math.min(currentIndex + 1, content.doors.length - 1);
    selectedObstacleId = null;
    selectedDoorId = content.doors[nextIndex]?.id || door.id;
    feedback = "";
  }

  phase = 0;
  miniPick = [];
  panelOpen = false;

  render();

  for (const reward of pendingRewards) {
    pushReward(reward);
  }
}

async function resolveObstacle(obstacle, viaCard = false) {
  if (!progress.resolvedObstacles.includes(obstacle.id)) {
    progress.resolvedObstacles.push(obstacle.id);
    progress.xp += viaCard ? 35 : 25;

    addAchievement(`تجاوزت عقبة ${obstacle.title}${viaCard ? " ببطاقة مناسبة" : " بفهم الموقف"}`);

    showObstacleHit(obstacle);
    playTone("success");
    pulse(35);

    if (authToken) {
      try {
        console.log("SAVING OBSTACLE:", obstacle.id);
        const result = await resolveObstacleOnServer(authToken, obstacle.id);
        console.log("OBSTACLE SAVED:", result);
        renderSaveState("تم حفظ تجاوز العقبة");
      } catch (error) {
        console.error("تعذر حفظ العقبة في السيرفر:", error);
        renderSaveState("تعذر حفظ العقبة");
      }
    } else {
      await persist();
    }
  }

  const gateIndex = getDoorIndex(obstacle.gateAfter);
  const nextDoor = content.doors[gateIndex + 1];

  selectedObstacleId = null;
  selectedDoorId = nextDoor?.id || obstacle.gateAfter;
  phase = 0;
  feedback = "انفتح الطريق. يمكنك دخول الباب التالي الآن.";
  panelOpen = false;

  render();
}

  function resetChallenge() {
    phase = 0;
    feedback = "";
    miniPick = [];
    matchSelections = {};
    fillAnswer = "";
    currentQuestionIndex = 0;
    currentQuestionAttempts = 0;
    currentQuestionScore = 0;
    currentQuestionMaxScore = 0;
    usedSabrBoost = false;
  }

  function getDoorQuestions(door) {
    if (Array.isArray(door.questions) && door.questions.length > 0) {
      return door.questions;
    }
    return [
      { type: "mcq", prompt: door.quiz?.prompt || "", options: door.quiz?.options || [], answerIndex: door.quiz?.answerIndex || 0, points: 10 },
      { type: "mcq", prompt: door.scenario?.prompt || "", options: door.scenario?.options || [], answerIndex: door.scenario?.answerIndex || 0, points: 10 },
      { type: "challenge", challengeType: "order", prompt: door.mini?.prompt || "", items: door.mini?.items || [], correct: door.mini?.correct || [], points: 10 },
    ];
  }

  function startDoorChallenge(door) {
    const questions = getDoorQuestions(door);
    currentQuestionIndex = 0;
    currentQuestionAttempts = 0;
    currentQuestionScore = 0;
    currentQuestionMaxScore = questions.reduce((sum, question) => sum + (Number(question.points) || 10), 0);
    feedback = "";
    phase = 1;
    miniPick = [];
    render();
  }

  function awardQuestionPoints(question, attempts = 0) {
    const value = Number(question.points) || 10;
    const multiplier = Math.max(0.1, 1 - (attempts * 0.2));
    const score = Math.ceil(value * multiplier);
    currentQuestionScore += score;
    return score;
  }

  function nextQuestion() {
    currentQuestionIndex += 1;
    currentQuestionAttempts = 0;
    miniPick = [];
    matchSelections = {};
    fillAnswer = "";
    const questions = getDoorQuestions(content.doors.find((door) => door.id === selectedDoorId));
    if (currentQuestionIndex >= questions.length) {
      currentQuestionIndex = questions.length;
    }
    render();
  }

  function handleAnswer(kind, index) {
    const door = content.doors.find((item) => item.id === selectedDoorId);
    if (!door) return;
    const questions = getDoorQuestions(door);
    const question = questions[currentQuestionIndex];
    if (!question) return;

    const selectedIndex = Number(index);
    const isCorrect = selectedIndex === Number(question.answerIndex);

    if (isCorrect) {
      const points = awardQuestionPoints(question, currentQuestionAttempts);
      const totalValue = Number(question.points) || 10;
      if (currentQuestionAttempts === 0) {
        feedback = `إجابة صحيحة! حصلت على كامل النقاط: ${points} نقطة.`;
      } else {
        feedback = `إجابة صحيحة! حصلت على ${points} من ${totalValue} نقطة (بعد ${currentQuestionAttempts} محاولة خاطئة).`;
      }
      playTone("success");
      pulse(20);
      nextQuestion();
      return;
    }

    currentQuestionAttempts += 1;
    const potentialPoints = Math.ceil((Number(question.points) || 10) * Math.max(0.1, 1 - (currentQuestionAttempts * 0.2)));
    const totalValue = Number(question.points) || 10;

    if (currentQuestionAttempts === 1) {
      feedback = `للأسف خطأ. حاول مرة أخرى بتركيز أكبر. (النقاط المتاحة الآن: ${potentialPoints} من ${totalValue})`;
    } else {
      feedback = `خطأ مجددًا (${currentQuestionAttempts} محاولات). فكّر جيدًا ثم حاول. (النقاط المتاحة: ${potentialPoints} من ${totalValue})`;
    }

    playTone("error");
    render();
  }

  function handleSequenceAnswer(item) {
    const door = content.doors.find((entry) => entry.id === selectedDoorId);
    if (!door) return;
    const questions = getDoorQuestions(door);
    const question = questions[currentQuestionIndex];
    if (!question || question.type !== "order") return;
    if (miniPick.includes(item)) return;

    miniPick.push(item);
    const correctSequence = question.correct || [];
    const stillValid = miniPick.every((choice, index) => choice === correctSequence[index]);

    if (!stillValid) {
      currentQuestionAttempts += 1;
      miniPick = [];
      const potentialPoints = Math.ceil((Number(question.points) || 10) * Math.max(0.1, 1 - (currentQuestionAttempts * 0.2)));
      const totalValue = Number(question.points) || 10;

      if (currentQuestionAttempts === 1) {
        feedback = `الترتيب غير صحيح، حاول مرة أخرى. (النقاط المتاحة الآن: ${potentialPoints} من ${totalValue})`;
      } else {
        feedback = `الترتيب خاطئ مجددًا (${currentQuestionAttempts} محاولات). أعد التفكير. (النقاط المتاحة: ${potentialPoints} من ${totalValue})`;
      }

      playTone("error");
      render();
      return;
    }

    if (miniPick.length === correctSequence.length) {
      const points = awardQuestionPoints(question, currentQuestionAttempts);
      const totalValue = Number(question.points) || 10;
      if (currentQuestionAttempts === 0) {
        feedback = `رتّبتها بشكل صحيح من المحاولة الأولى! حصلت على ${points} نقطة.`;
      } else {
        feedback = `رتّبتها بشكل صحيح! حصلت على ${points} من ${totalValue} نقطة (بعد ${currentQuestionAttempts} محاولة خاطئة).`;
      }
      playTone("success");
      pulse(20);
      nextQuestion();
      return;
    }

    feedback = "اختيار صحيح حتى الآن، أكمل الترتيب.";
    playTone("tap");
    render();
  }

  function handleMiniPick(item) {
    const door = content.doors.find((entry) => entry.id === selectedDoorId);
    if (!door) return;
    if (miniPick.includes(item)) return;
    miniPick.push(item);
    const correct = door.mini.correct || [];
    const stillValid = miniPick.every((choice, index) => choice === correct[index]);
    if (!stillValid) {
      feedback = "أعد ترتيب الدليل من البداية؛ أول خطوة هي الأهم.";
      miniPick = [];
      playTone("error");
    } else if (miniPick.length === correct.length) {
      feedback = "اكتمل الدليل الأخير.";
      completeDoor(door);
      return;
    } else {
      feedback = "اختيار صحيح، أكمل الترتيب.";
      playTone("tap");
    }
    render();
  }

  async function adminSave(type, data) {
    if (authToken && currentUser?.role?.trim() === "admin") {
      try {
        switch (type) {
          case "door": await saveDoorOnServer(authToken, data); break;
          case "add-door": await addDoorOnServer(data); break;
          case "delete-door": await deleteDoorOnServer(data.doorId); break;
          case "card": await saveCardOnServer(data); break;
          case "add-card": await addCardOnServer(data); break;
          case "delete-card": await deleteCardOnServer(data.cardId); break;
          case "obstacle": await saveObstacleOnServer(data); break;
          case "add-obstacle": await addObstacleOnServer(data); break;
          case "delete-obstacle": await deleteObstacleOnServer(data.obstacleId); break;
          case "reset-progress": await resetProgressOnServer(); break;
        }
        renderSaveState("تم الحفظ في السيرفر");
      } catch (error) {
        console.error("خطأ في الحفظ:", error);
        renderSaveState("تعذر الحفظ");
      }
    } else {
      await persist();
    }
  } 

  function handleChange(event) {
    const el = event.target;
    if (el.name && el.name.startsWith("match-")) {
      matchSelections[el.name.replace("match-", "")] = el.value;
    }
    if (el.id === "fill-answer-input") {
      fillAnswer = el.value;
    }
  }   

  async function saveDoorQuestionsToServer() {
    if (!authToken || currentUser?.role?.trim() !== "admin") {
      await persist();
      return;
    }
    const door = content.doors.find(d => d.id === editingDoorId);
    if (!door) return;
    try {
      await saveDoorOnServer(authToken, {
        doorId: door.id,
        title: door.title,
        summary: door.summary,
        illustration: door.illustration,
        keyPoints: door.keyPoints,
        cardId: door.cardId,
        xp: door.xp,
        questions: door.questions || [],
      });
      renderSaveState("تم الحفظ في السيرفر");
    } catch (error) {
      console.error("تعذر حفظ الأسئلة:", error);
      renderSaveState("تعذر حفظ الأسئلة");
    }
  }

 function getNextId(prefix, array) {
  let maxNum = 0;
  for (const item of array) {
    const match = item.id.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  return `${prefix}-${String(maxNum + 1).padStart(2, '0')}`;
}

async function handleClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const action = button.dataset.action;
  if (action === "toggle-hud") {
    hudCollapsed = !hudCollapsed;
    render();
    return;
  }

  if (action === "toggle-nav") {
    navCollapsed = !navCollapsed;
    render();
    return;
  }
  const id = button.dataset.id;

  if (action === "logout") {
    logout();
    location.reload();
    return;
  }

  playTone("tap");

  if (action === "tab") {
    selectedObstacleId = null;
    panelOpen = false;
    shell.dataset.view = id;
    render();
  }
  if (action === "select-door") {
    const index = getDoorIndex(id);
    const blocker = getBlockingObstacleForDoor(index);
    if (blocker && completedSet().has(content.doors[index - 1]?.id)) {
      selectedObstacleId = blocker.id;
      selectedDoorId = id;
      feedback = "";
    } else {
      selectedObstacleId = null;
      selectedDoorId = id;
    }
    panelOpen = true;
    resetChallenge();
    render();
  }
  if (action === "lesson-next") {
    const door = content.doors.find((item) => item.id === selectedDoorId);
    if (door) startDoorChallenge(door);
  }
  if (action === "answer-quiz") handleAnswer("quiz", button.dataset.index);
  if (action === "answer-scenario") handleAnswer("scenario", button.dataset.index);
  if (action === "complete-challenge") {
    const door = content.doors.find((item) => item.id === selectedDoorId);
    if (door) completeDoor(door);
  }
  if (action === "mini-pick") handleSequenceAnswer(button.dataset.value);
  if (action === "hint") {
    feedback = "تلميح بطاقة العلم: ابحث عن العلاقة بين النية والفهم والعمل، وليس عن حفظ العبارة فقط.";
    render();
  }
  if (action === "use-card") {
    const obstacle = content.obstacles.find((item) => item.id === selectedObstacleId);
    if (obstacle && progress.cards.includes(obstacle.requiredCardId)) resolveObstacle(obstacle, true);
    else {
      feedback = "لا تملك البطاقة المناسبة بعد؛ يمكنك تجاوز العقبة بالإجابة عن سؤالها.";
      render();
    }
  }
  if (action === "answer-obstacle") {
    const obstacle = content.obstacles.find((item) => item.id === selectedObstacleId);
    if (!obstacle) return;
    if (Number(button.dataset.index) === Number(obstacle.answerIndex)) resolveObstacle(obstacle, false);
    else {
      feedback = "العقبة ما زالت قائمة. اختر علاجًا أقرب للمفهوم.";
      playTone("error");
      render();
    }
  }

  if (action === "add-question") {
    const type = button.dataset.type || "mcq";
    const door = content.doors.find(d => d.id === editingDoorId);
    if (!door) return;
    if (!Array.isArray(door.questions)) door.questions = [];
    editingQuestionIdx = -2;
    tempQuestion = getEmptyQuestion(type);
    render();
    return;
  }
  if (action === "edit-question") {
    const idx = Number(button.dataset.index);
    const door = content.doors.find(d => d.id === editingDoorId);
    if (!door || !door.questions[idx]) return;
    editingQuestionIdx = idx;
    tempQuestion = clone(door.questions[idx]);
    render();
    return;
  }
  if (action === "save-question") {
    if (!tempQuestion) return;
    const door = content.doors.find(d => d.id === editingDoorId);
    if (!door) return;
    if (!Array.isArray(door.questions)) door.questions = [];
    tempQuestion = readQuestionFromForm(tempQuestion);
    if (editingQuestionIdx === -2) {
      door.questions.push(tempQuestion);
    } else {
      door.questions[editingQuestionIdx] = tempQuestion;
    }
    editingQuestionIdx = -1;
    tempQuestion = null;
    await saveDoorQuestionsToServer();
    render();
    return;
  }
  if (action === "cancel-question") {
    editingQuestionIdx = -1;
    tempQuestion = null;
    render();
    return;
  }
  if (action === "delete-question") {
    const door = content.doors.find(d => d.id === editingDoorId);
    if (!door || !Array.isArray(door.questions)) return;
    const idx = Number(button.dataset.index);
    door.questions.splice(idx, 1);
    if (editingQuestionIdx === idx) { editingQuestionIdx = -1; tempQuestion = null; }
    else if (editingQuestionIdx > idx) editingQuestionIdx--;
    await saveDoorQuestionsToServer();
    render();
    return;
  }
  if (action === "move-question") {
    const door = content.doors.find(d => d.id === editingDoorId);
    if (!door || !Array.isArray(door.questions)) return;
    const idx = Number(button.dataset.index);
    const dir = button.dataset.dir === "up" ? -1 : 1;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= door.questions.length) return;
    [door.questions[idx], door.questions[newIdx]] = [door.questions[newIdx], door.questions[idx]];
    await saveDoorQuestionsToServer();
    render();
    return;
  }
  if (action === "change-q-type") {
    if (!tempQuestion) return;
    const newType = button.dataset.type || "mcq";
    tempQuestion = getEmptyQuestion(newType);
    render();
    return;
  }
  if (action === "add-mcq-option") {
    if (!tempQuestion) return;
    tempQuestion.options.push("");
    render();
    return;
  }
  if (action === "remove-mcq-option") {
    if (!tempQuestion) return;
    tempQuestion.options.splice(Number(button.dataset.index), 1);
    if (tempQuestion.answerIndex >= tempQuestion.options.length) tempQuestion.answerIndex = 0;
    render();
    return;
  }
  if (action === "add-match-pair") {
    if (!tempQuestion) return;
    tempQuestion.pairs.push({ left: "", right: "" });
    render();
    return;
  }
  if (action === "remove-match-pair") {
    if (!tempQuestion) return;
    tempQuestion.pairs.splice(Number(button.dataset.index), 1);
    render();
    return;
  }
  if (action === "add-fill-answer") {
    if (!tempQuestion) return;
    tempQuestion.acceptableAnswers.push("");
    render();
    return;
  }
  if (action === "remove-fill-answer") {
    if (!tempQuestion) return;
    tempQuestion.acceptableAnswers.splice(Number(button.dataset.index), 1);
    render();
    return;
  }
  if (action === "add-challenge-item") {
    if (!tempQuestion) return;
    tempQuestion.items.push("");
    render();
    return;
  }
  if (action === "remove-challenge-item") {
    if (!tempQuestion) return;
    tempQuestion.items.splice(Number(button.dataset.index), 1);
    render();
    return;
  }
  if (action === "add-challenge-correct") {
    if (!tempQuestion) return;
    tempQuestion.correct.push("");
    render();
    return;
  }
  if (action === "remove-challenge-correct") {
    if (!tempQuestion) return;
    tempQuestion.correct.splice(Number(button.dataset.index), 1);
    render();
    return;
  }

  if (action === "answer-tf") {
    const door = content.doors.find((item) => item.id === selectedDoorId);
    if (!door) return;
    const questions = getDoorQuestions(door);
    const question = questions[currentQuestionIndex];
    if (!question) return;
    const isCorrect = button.dataset.value === String(question.correctAnswer);
    if (isCorrect) {
      const points = awardQuestionPoints(question, currentQuestionAttempts);
      feedback = `إجابة صحيحة! حصلت على ${points} نقطة.`;
      playTone("success"); pulse(20); nextQuestion();
    } else {
      currentQuestionAttempts += 1;
      const pp = Math.ceil((Number(question.points) || 10) * Math.max(0.1, 1 - (currentQuestionAttempts * 0.2)));
      feedback = `خطأ! حاول مرة أخرى. (النقاط المتاحة: ${pp} من ${question.points || 10})`;
      playTone("error"); render();
    }
    return;
  }
  if (action === "submit-match") {
    const door = content.doors.find((entry) => entry.id === selectedDoorId);
    if (!door) return;
    const questions = getDoorQuestions(door);
    const question = questions[currentQuestionIndex];
    if (!question || question.type !== "match") return;
    const pairs = question.pairs || [];
    const seed = currentQuestionIndex * 1000 + 42;
    const displayPairs = seededShuffle(pairs, seed);
    let allSelected = true;
    let correctCount = 0;
    displayPairs.forEach((pair, i) => {
      const selected = matchSelections[String(i)] || matchSelections[i];
      if (!selected) { allSelected = false; return; }
      if (selected === pair.right) correctCount++;
    });
    if (!allSelected) { feedback = "يرجى توصيل جميع العناصر قبل التحقق."; render(); return; }
    if (correctCount === pairs.length) {
      const points = awardQuestionPoints(question, currentQuestionAttempts);
      feedback = `توصيل صحيح! حصلت على ${points} نقطة.`;
      playTone("success"); pulse(20); nextQuestion();
    } else {
      currentQuestionAttempts += 1;
      matchSelections = {};
      const pp = Math.ceil((Number(question.points) || 10) * Math.max(0.1, 1 - (currentQuestionAttempts * 0.2)));
      feedback = `${correctCount} من ${pairs.length} صحيح. حاول مرة أخرى. (النقاط: ${pp})`;
      playTone("error"); render();
    }
    return;
  }
  if (action === "submit-fill") {
    const door = content.doors.find((entry) => entry.id === selectedDoorId);
    if (!door) return;
    const questions = getDoorQuestions(door);
    const question = questions[currentQuestionIndex];
    if (!question || question.type !== "fill") return;
    const answer = (fillAnswer || "").trim();
    if (!answer) { feedback = "يرجى كتابة الإجابة."; render(); return; }
    const acceptable = (question.acceptableAnswers || []).map(a => a.trim().toLowerCase());
    if (acceptable.includes(answer.toLowerCase())) {
      const points = awardQuestionPoints(question, currentQuestionAttempts);
      feedback = `إجابة صحيحة! حصلت على ${points} نقطة.`;
      playTone("success"); pulse(20); nextQuestion();
    } else {
      currentQuestionAttempts += 1;
      fillAnswer = "";
      const pp = Math.ceil((Number(question.points) || 10) * Math.max(0.1, 1 - (currentQuestionAttempts * 0.2)));
      feedback = `إجابة خاطئة. حاول مرة أخرى. (النقاط: ${pp})`;
      playTone("error"); render();
    }
    return;
  }
  if (action === "challenge-pick") {
    const door = content.doors.find((entry) => entry.id === selectedDoorId);
    if (!door) return;
    const questions = getDoorQuestions(door);
    const question = questions[currentQuestionIndex];
    if (!question || question.type !== "challenge") return;
    const item = button.dataset.value;
    if (miniPick.includes(item)) return;
    miniPick.push(item);
    const correct = question.correct || [];
    const stillValid = miniPick.every((choice, idx) => choice === correct[idx]);
    if (!stillValid) {
      currentQuestionAttempts += 1;
      miniPick = [];
      const pp = Math.ceil((Number(question.points) || 10) * Math.max(0.1, 1 - (currentQuestionAttempts * 0.2)));
      feedback = `ترتيب خاطئ. حاول مرة أخرى. (النقاط: ${pp})`;
      playTone("error"); render(); return;
    }
    if (miniPick.length === correct.length) {
      const points = awardQuestionPoints(question, currentQuestionAttempts);
      feedback = `ترتيب صحيح! حصلت على ${points} نقطة.`;
      playTone("success"); pulse(20); nextQuestion(); return;
    }
    feedback = "صحيح حتى الآن، أكمل الترتيب.";
    playTone("tap"); render();
    return;
  }

  if (action === "admin-mode") {
    adminMode = id;
    render();
  }
  if (action === "edit-door") {
    editingDoorId = id;
    render();
  }
  if (action === "new-door") {
    const newDoor = {
      ...clone(DEFAULT_CONTENT.doors[0]),
      id: uid("door"),
      title: "باب جديد",
      summary: "اكتب شرحًا مختصرًا ومناسبًا للطلاب.",
      cardId: content.cards[0]?.id || "",
      questions: [],
    };
    content.doors.push(newDoor);
    editingDoorId = newDoor.id;
    selectedDoorId = newDoor.id;
    await adminSave("add-door", newDoor);
    render();
  }
  if (action === "delete-door") {
    if (content.doors.length <= 1) return;
    const deletedId = id;
    content.doors = content.doors.filter((door) => door.id !== deletedId);
    content.obstacles = content.obstacles.filter((obstacle) => obstacle.gateAfter !== deletedId);
    progress.completedDoors = progress.completedDoors.filter((doorId) => doorId !== deletedId);
    selectedDoorId = content.doors[0]?.id || "";
    editingDoorId = selectedDoorId;
    await adminSave("delete-door", { doorId: deletedId });
    render();
  }
  if (action === "edit-card") {
    editingCardId = id;
    render();
  }
  if (action === "close-overlay") {
    panelOpen = false;
    render();
  }
if (action === "new-card") {
    const newCard = { id: getNextId("card", content.cards), title: "بطاقة جديدة", icon: "نجمة", power: "اكتب أثر البطاقة داخل الرحلة." };
  content.cards.push(newCard);
  editingCardId = newCard.id;
  await adminSave("add-card", {
    cardId: newCard.id,
    title: newCard.title,
    icon: newCard.icon,
    power: newCard.power,
  });
  render();
}
  if (action === "delete-card") {
    const deletedId = id;
    content.cards = content.cards.filter((card) => card.id !== deletedId);
    progress.cards = progress.cards.filter((cardId) => cardId !== deletedId);
    editingCardId = content.cards[0]?.id || "";
    await adminSave("delete-card", { cardId: deletedId });
    render();
  }
  if (action === "edit-obstacle") {
    editingObstacleId = id;
    render();
  }
if (action === "new-obstacle") {
    const newObstacle = {
      id: getNextId("obstacle", content.obstacles),
      title: "عقبة جديدة",
    gateAfter: content.doors[0]?.id || "",
    requiredCardId: content.cards[0]?.id || "",
    prompt: "ما التصرف المناسب لتجاوز هذه العقبة؟",
    options: ["اختيار صحيح", "اختيار بعيد", "اختيار مشتت"],
    answerIndex: 0,
  };
  content.obstacles.push(newObstacle);
  editingObstacleId = newObstacle.id;
  await adminSave("add-obstacle", {
    obstacleId: newObstacle.id,
    title: newObstacle.title,
    gateAfter: newObstacle.gateAfter,
    requiredCardId: newObstacle.requiredCardId,
    prompt: newObstacle.prompt,
    options: newObstacle.options,
    answerIndex: newObstacle.answerIndex,
  });
  render();
}
  if (action === "delete-obstacle") {
    const deletedId = id;
    content.obstacles = content.obstacles.filter((obstacle) => obstacle.id !== deletedId);
    progress.resolvedObstacles = progress.resolvedObstacles.filter((obstacleId) => obstacleId !== deletedId);
    editingObstacleId = content.obstacles[0]?.id || "";
    await adminSave("delete-obstacle", { obstacleId: deletedId });
    render();
  }
  if (action === "reset-progress") {
    progress = normalizeProgress();
    resetChallenge();
    await adminSave("reset-progress", {});
    render();
  }
  if (action === "reset-content") {
    content = clone(DEFAULT_CONTENT);
    progress = normalizeProgress();

    selectedDoorId = content.doors[0]?.id || "";
    editingDoorId = content.doors[0]?.id || "";
    editingCardId = content.cards[0]?.id || "";
    editingObstacleId = content.obstacles[0]?.id || "";

    await persist();
    render();
  }
}
   

  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    const type = form.dataset.type;
    if (type === "door") {
      const door = content.doors.find((item) => item.id === data.get("id"));
      if (!door) return;
      door.title = String(data.get("title") || door.title).trim();
      door.summary = String(data.get("summary") || "").trim();
      door.illustration = String(data.get("illustration") || "").trim();
      door.keyPoints = splitList(data.get("keyPoints"));
      door.cardId = String(data.get("cardId") || "");
      door.xp = Number(data.get("xp")) || 80;
      selectedDoorId = door.id;

      if (authToken && currentUser?.role?.trim() === "admin") {
        try {
          await saveDoorOnServer(authToken, {
            doorId: door.id,
            title: door.title,
            summary: door.summary,
            illustration: door.illustration,
            keyPoints: door.keyPoints,
            cardId: door.cardId,
            xp: door.xp,
            questions: door.questions || [],
          });
          renderSaveState("تم حفظ الباب في السيرفر");
        } catch (error) {
          console.error("تعذر حفظ الباب:", error);
          renderSaveState("تعذر حفظ الباب في السيرفر");
        }
      } else {
        await persist();
      }

      render();
      return;
    }
    if (type === "card") {
      const card = content.cards.find((item) => item.id === data.get("id"));
      if (!card) return;
      card.title = String(data.get("title") || card.title).trim();
      card.icon = String(data.get("icon") || "").trim();
      card.power = String(data.get("power") || "").trim();
      await adminSave("card", { cardId: card.id, title: card.title, icon: card.icon, power: card.power });
      render();
      return;
    }
    if (type === "obstacle") {
      const obstacle = content.obstacles.find((item) => item.id === data.get("id"));
      if (!obstacle) return;
      obstacle.title = String(data.get("title") || obstacle.title).trim();
      obstacle.gateAfter = String(data.get("gateAfter") || "");
      obstacle.requiredCardId = String(data.get("requiredCardId") || "");
      obstacle.prompt = String(data.get("prompt") || "").trim();
      obstacle.options = splitList(data.get("options"));
      obstacle.answerIndex = Math.max(0, Math.min(Number(data.get("answerIndex")) || 0, obstacle.options.length - 1));
      obstacle.referenceType = String(data.get("referenceType") || "article");
      obstacle.referenceTitle = String(data.get("referenceTitle") || "").trim();
      obstacle.referenceLink = String(data.get("referenceLink") || "").trim();
      await adminSave("obstacle", {
        obstacleId: obstacle.id, title: obstacle.title, gateAfter: obstacle.gateAfter,
        requiredCardId: obstacle.requiredCardId, prompt: obstacle.prompt, options: obstacle.options,
        answerIndex: obstacle.answerIndex, referenceType: obstacle.referenceType,
        referenceTitle: obstacle.referenceTitle, referenceLink: obstacle.referenceLink,
      });
      render();
      return;
    }
    feedback = "تم تحديث المحتوى.";
    render();
  }

function render() {
  if (!shell) return;

  const previousScrollTop = getMapScrollTop(shell);
  const view = shell.dataset.view || "map";
  const stats = getStats();

  shell.innerHTML = `
    <section class="game-body">
      ${view === "student" ? renderStudent(stats) : view === "admin" ? renderAdmin(stats) : renderMap(stats)}
    </section>

    <header class="top-hud ${hudCollapsed ? "is-collapsed" : ""}">
      <div class="hud-badge level-badge">
        <span>${escapeHtml(currentUser?.name || "الطالب")}</span>
        <strong>${escapeHtml(stats.level.title)}</strong>
      </div>

      <div class="hud-badge xp-badge">
        <span>${stats.xp} XP</span>
        <div class="xp-track"><i style="width:${stats.levelPercent}%"></i></div>
      </div>

      <div class="hud-badge progress-badge">
        <span>الإنجاز</span>
        <strong>${stats.completed}/${stats.totalDoors}</strong>
      </div>
    </header>

    <nav class="bottom-nav ${navCollapsed ? "is-collapsed" : ""}" aria-label="التنقل">
      ${navButton("map", "خريطة", "🗺️", view)}
      ${navButton("student", "الطالب", "🎓", view)}
      ${currentUser?.role?.trim() === "admin" ? navButton("admin", "الأدمن", "⚙️", view) : ""}
      ${currentUser ? `<button class="nav-item logout-button" data-action="logout"><span>🚪</span>خروج</button>` : ""}
    </nav>
${renderRewardAnimation()}
${renderHitAnimation()}
  `;

document.querySelectorAll(".floating-toggle").forEach((btn) => btn.remove());

shell.insertAdjacentHTML(
  "afterend",
  `
    <button class="floating-toggle top-toggle" data-action="toggle-hud">
      ${hudCollapsed ? "📊" : "✕"}
    </button>

    <button class="floating-toggle bottom-toggle" data-action="toggle-nav">
      ${navCollapsed ? "☰" : "✕"}
    </button>
  `
);

  saveIndicator = shell.querySelector(".save-indicator");
  renderSaveState();

  const mapBg = shell.querySelector(".map-bg");
  const scrollToPlayerIfReady = () => scrollToPlayer(shell);

  requestAnimationFrame(() => {
    scrollToPlayerIfReady();
    if (mapBg && !mapBg.complete) {
      mapBg.addEventListener("load", scrollToPlayerIfReady, { once: true });
    }
  });
}

  function navButton(id, label, icon, current) {
    return `<button class="nav-item ${current === id ? "is-active" : ""}" data-action="tab" data-id="${id}"><span>${icon}</span>${escapeHtml(label)}</button>`;
  }

  function getStats() {
    const completed = progress.completedDoors.filter((id) => content.doors.some((door) => door.id === id)).length;
    const totalDoors = Math.max(1, content.doors.length);
    const level = getLevel(progress.xp);
    const next = getNextLevel(progress.xp);
    const previousMin = level.min;
    const nextMin = next?.min || Math.max(progress.xp, previousMin + 1);
    return {
      completed,
      totalDoors,
      unlocked: content.doors.filter((_, index) => isDoorUnlocked(index)).length,
      locked: content.doors.length - content.doors.filter((_, index) => isDoorUnlocked(index)).length,
      cards: progress.cards.length,
      keys: progress.keys.length,
      xp: progress.xp,
      level,
      next,
      levelPercent: Math.min(100, Math.round(((progress.xp - previousMin) / Math.max(1, nextMin - previousMin)) * 100)),
      progressPercent: Math.round((completed / totalDoors) * 100),
    };
  }

function renderRewardAnimation() {
  if (!rewardAnimation) return "";

  const { type, item } = rewardAnimation;

  if (type === "card") {
    const card = item;
    return `
      <div class="reward-animation">
        <div class="reward-card-pop">
          <div class="reward-rays"></div>
          <img src="${assetUrls.KNOWLEDGE_CARD}" alt="" draggable="false" />
          <strong>${escapeHtml(card.title || "بطاقة جديدة")}</strong>
          <span>${escapeHtml(card.power || "حصلت على بطاقة جديدة")}</span>
        </div>
      </div>
    `;
  }

  if (type === "key") {
    const key = item;
    return `
      <div class="reward-animation">
        <div class="reward-key-pop">
          <img src="${assetUrls.KEY}" alt="مفتاح" draggable="false" />
          <strong>${escapeHtml(key.title || "مفتاح")}</strong>
        </div>
      </div>
    `;
  }

  return "";
}

function renderHitAnimation() {
  if (!hitAnimation) return "";

  return `
    <div class="hit-animation">
      <div class="hit-burst">⚡</div>
      <div class="hit-text">تجاوزت ${escapeHtml(hitAnimation.title || "العقبة")}</div>
    </div>
  `;
}

function renderTreasure() {
  return `
      <div class="treasure-goal" style="--x:50%;--y:4%">
        <img src="${assetUrls.TREASURE_CHEST}" alt="كنز ميراث النبوة" draggable="false" />
      </div>
    `;
}

function renderMap(stats) {
  const panelContent = selectedObstacleId ? renderObstaclePanel() : renderDoorPanel(stats);
  const isOverlayOpen = panelOpen;

  return `
    <div class="map-view ${isOverlayOpen ? "has-overlay" : ""}">
      <section class="map-stage" aria-label="خريطة الرحلة">
        <div class="map-canvas">
          <img class="map-bg" src="${assetUrls.MAP_BACKDROP}" alt="" draggable="false" />
          <div class="map-objects">
            ${renderTreasure()}
            ${renderObstacleNodes()}
            ${renderDoorNodes()}
            ${renderPlayerMarker()}
          </div>
        </div>
      </section>

      ${isOverlayOpen ? `<div class="map-overlay-backdrop"></div>` : ""}

      ${isOverlayOpen ? `<aside class="quest-panel quest-overlay">${panelContent}<button class="overlay-close" data-action="close-overlay" aria-label="إغلاق">×</button></aside>` : ""}
    </div>
  `;
}

  function renderDoorNodes() {
    const completed = completedSet();
    return content.doors
      .map((door, index) => {
const pos = getNodePosition(index, content.doors.length, door.id);
        const isCompleted = completed.has(door.id);
        const unlocked = isDoorUnlocked(index);
        const selected = selectedDoorId === door.id && !selectedObstacleId;
        const src = isCompleted || unlocked ? assetUrls.OPEN_DOOR : assetUrls.LOCKED_DOOR;
        const className = ["map-node", isCompleted ? "is-complete" : "", unlocked ? "is-unlocked" : "is-locked", selected ? "is-selected" : ""].join(" ");
        return `
          <button class="${className}" style="--x:${pos.x}%;--y:${pos.y}%" data-action="select-door" data-id="${escapeHtml(door.id)}" aria-label="${escapeHtml(door.title)}">
            <img src="${src}" alt="" draggable="false" />
            <span class="node-number">${index + 1}</span>
            <b>${escapeHtml(door.title.replace("باب ", ""))}</b>
          </button>
        `;
      })
      .join("");
  }

  function renderObstacleNodes() {
    const resolved = obstacleSet();
    return content.obstacles
      .map((obstacle) => {
        if (resolved.has(obstacle.id)) return "";
        const gateIndex = getDoorIndex(obstacle.gateAfter);
        if (gateIndex < 0 || gateIndex >= content.doors.length - 1) return "";
       const startDoor = content.doors[gateIndex];
const endDoor = content.doors[gateIndex + 1];

const start = getNodePosition(gateIndex, content.doors.length, startDoor?.id);
const end = getNodePosition(gateIndex + 1, content.doors.length, endDoor?.id);
        const pos = getMidpoint(start, end);
        const active = selectedObstacleId === obstacle.id;
        return `
          <button class="obstacle-node ${active ? "is-selected" : ""}" style="--x:${pos.x}%;--y:${pos.y}%" data-action="select-door" data-id="${escapeHtml(content.doors[gateIndex + 1].id)}">
            <img src="${assetUrls.OBSTACLE_TOKEN}" alt="" draggable="false" />
            <span>${escapeHtml(obstacle.title)}</span>
          </button>
        `;
      })
      .join("");
  }

function renderPlayerMarker() {
  let index = content.doors.findIndex((door) => !progress.completedDoors.includes(door.id));

  if (index < 0) index = content.doors.length - 1;

  const blocker = getBlockingObstacleForDoor(index);

  if (blocker && index > 0) {
    const previousDoor = content.doors[index - 1];
    const currentDoor = content.doors[index];

    const start = getNodePosition(index - 1, content.doors.length, previousDoor?.id);
    const end = getNodePosition(index, content.doors.length, currentDoor?.id);
    const pos = getMidpoint(start, end);

    return `
      <div class="player-marker" style="--x:${pos.x}%;--y:${pos.y}%">
        <img src="${assetUrls.STUDENT_EXPLORER}" alt="بطل الرحلة" draggable="false" />
      </div>
    `;
  }

  const currentDoor = content.doors[index] || content.doors[0];

  if (!currentDoor) return "";

  const pos = getNodePosition(index, content.doors.length, currentDoor.id);

  return `
    <div class="player-marker" style="--x:${pos.x}%;--y:${pos.y}%">
      <img src="${assetUrls.STUDENT_EXPLORER}" alt="بطل الرحلة" draggable="false" />
    </div>
  `;
}

  function renderDoorPanel(stats) {
    const door = content.doors.find((item) => item.id === selectedDoorId) || content.doors[0];
    if (!door) return `<div class="empty-panel">أضف بابًا من لوحة الأدمن لبدء الرحلة.</div>`;
    const index = getDoorIndex(door.id);
    const complete = completedSet().has(door.id);
    const unlocked = isDoorUnlocked(index);
    const card = content.cards.find((item) => item.id === door.cardId);
    if (!unlocked && !complete) {
      return `
        <p class="eyebrow">باب مغلق</p>
        <h2>${escapeHtml(door.title)}</h2>
        <p>أكمل الباب السابق وتجاوز العقبة التي بينهما لفتح هذا الباب.</p>
        ${feedback ? `<p class="feedback">${escapeHtml(feedback)}</p>` : ""}
      `;
    }
    return `
      <div class="panel-title-row">
        <div>
          <p class="eyebrow">${complete ? "مراجعة باب مكتمل" : `المرحلة ${phase + 1} من 4`}</p>
          <h2>${escapeHtml(door.title)}</h2>
        </div>
        <span class="reward-chip">${escapeHtml(card?.title || "بطاقة")}</span>
      </div>
      ${renderDoorPhase(door, complete, stats)}
      ${feedback ? `<p class="feedback">${escapeHtml(feedback)}</p>` : ""}
    `;
  }

  function renderDoorPhase(door, complete, stats) {
    if (complete) {
      return `
        <p>${escapeHtml(door.summary)}</p>
        <div class="key-grid">${door.keyPoints.map((point) => `<span>${escapeHtml(point)}</span>`).join("")}</div>
        <p class="small-note">يمكنك إعادة قراءة الباب، أما التقدم فيستمر من الباب التالي المفتوح.</p>
      `;
    }
    if (phase === 0) {
      return `
        <p>${escapeHtml(door.summary)}</p>
        <div class="mind-map">${escapeHtml(door.illustration || "رسم توضيحي مختصر")}</div>
        <div class="key-grid">${door.keyPoints.map((point) => `<span>${escapeHtml(point)}</span>`).join("")}</div>
        <div class="panel-actions">
          ${progress.cards.includes("ilm") ? `<button class="ghost-button" data-action="hint">تلميح بطاقة العلم</button>` : ""}
          <button class="primary-button" data-action="lesson-next">ابدأ التحدي</button>
        </div>
      `;
    }

    if (phase === 1) {
      const questions = getDoorQuestions(door);
      const question = questions[currentQuestionIndex];
      if (!question) {
        const percentage = currentQuestionMaxScore ? Math.round((currentQuestionScore / currentQuestionMaxScore) * 100) : 0;
        const threshold = Math.ceil(currentQuestionMaxScore * 0.8);
        const earnedCard = currentQuestionScore >= threshold;
        return `
          <p class="eyebrow">نتيجة التحدي</p>
          <h3>أكملت الأسئلة</h3>
          <div class="challenge-summary">
            <p>حصلت على ${currentQuestionScore} من ${currentQuestionMaxScore} نقطة.</p>
            <p>النسبة: ${percentage}%</p>
            <p>${earnedCard ? "لقد نجحت بالحصول على البطاقة والمفتاح." : "حصلت على المفتاح فقط، واحتفظ بالبطاقة للمرة القادمة."}</p>
          </div>
          <div class="panel-actions">
            <button class="primary-button" data-action="complete-challenge">انهِ الباب</button>
          </div>
        `;
      }

      if (question.type === "mcq") {
        return `
          <p class="eyebrow">اختر الإجابة الصحيحة</p>
          <h3>${escapeHtml(question.prompt)}</h3>
          <div class="option-list">
            ${(question.options || []).map((option, index) => `<button class="option-button" data-action="answer-quiz" data-index="${index}">${escapeHtml(option)}</button>`).join("")}
          </div>
          <p class="small-note">السؤال ${currentQuestionIndex + 1} من ${questions.length}</p>
        `;
      }

      if (question.type === "truefalse") {
        return `
          <p class="eyebrow">صح أم خطأ؟</p>
          <h3>${escapeHtml(question.prompt)}</h3>
          <div class="option-list tf-list">
            <button class="option-button tf-true" data-action="answer-tf" data-value="true">✅ صحيح</button>
            <button class="option-button tf-false" data-action="answer-tf" data-value="false">❌ خطأ</button>
          </div>
          <p class="small-note">السؤال ${currentQuestionIndex + 1} من ${questions.length}</p>
        `;
      }

      if (question.type === "match") {
        const pairs = question.pairs || [];
        const seed = currentQuestionIndex * 1000 + 42;
        const displayPairs = seededShuffle(pairs, seed);
        const rightOptions = seededShuffle(pairs.map(p => p.right), seed + 777);
        return `
          <p class="eyebrow">${escapeHtml(question.prompt || "صل كل عنصر بما يناسبه")}</p>
          <div class="match-board">
            ${displayPairs.map((pair, i) => `
              <div class="match-row">
                <span class="match-left">${escapeHtml(pair.left)}</span>
                <select name="match-${i}" class="match-select">
                  <option value="">← اختر</option>
                  ${rightOptions.map(r => `<option value="${escapeHtml(r)}" ${matchSelections[String(i)] === r ? "selected" : ""}>${escapeHtml(r)}</option>`).join("")}
                </select>
              </div>
            `).join("")}
          </div>
          <div class="panel-actions">
            <button class="primary-button full" data-action="submit-match">تحقق من التوصيل</button>
          </div>
          <p class="small-note">السؤال ${currentQuestionIndex + 1} من ${questions.length}</p>
        `;
      }

      if (question.type === "fill") {
        return `
          <p class="eyebrow">أكمل الفراغ</p>
          <h3>${escapeHtml((question.prompt || "").replace(/_{3,}/g, "______"))}</h3>
          <div class="fill-board">
            <input type="text" id="fill-answer-input" class="fill-input" value="${escapeHtml(fillAnswer)}" placeholder="اكتب إجابتك هنا" autocomplete="off" />
            <button class="primary-button full" data-action="submit-fill">تحقق</button>
          </div>
          <p class="small-note">السؤال ${currentQuestionIndex + 1} من ${questions.length}</p>
        `;
      }

      if (question.type === "challenge") {
        const seed = currentQuestionIndex * 1000 + 99;
        const shuffledItems = seededShuffle(question.items || [], seed);
        return `
          <p class="eyebrow">${escapeHtml(question.prompt || "رتّب العناصر بالترتيب الصحيح")}</p>
          <div class="mini-board">
            ${shuffledItems.map((item) => `<button class="chip-button ${miniPick.includes(item) ? "is-picked" : ""}" data-action="challenge-pick" data-value="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}
          </div>
          <div class="answer-lane">${miniPick.length ? miniPick.map((item, index) => `<span>${index + 1}. ${escapeHtml(item)}</span>`).join("") : "اختر العناصر بالترتيب الصحيح"}</div>
          <p class="small-note">السؤال ${currentQuestionIndex + 1} من ${questions.length}</p>
        `;
      }

      if (question.type === "order") {
        return `
          <p class="eyebrow">${escapeHtml(question.prompt)}</p>
          <div class="mini-board">
            ${(question.items || []).map((item) => `<button class="chip-button ${miniPick.includes(item) ? "is-picked" : ""}" data-action="mini-pick" data-value="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}
          </div>
          <div class="answer-lane">${miniPick.length ? miniPick.map((item, index) => `<span>${index + 1}. ${escapeHtml(item)}</span>`).join("") : "اختر العناصر بالترتيب الصحيح"}</div>
          <p class="small-note">السؤال ${currentQuestionIndex + 1} من ${questions.length}</p>
        `;
      }

      return `<p>نوع سؤال غير معروف: ${escapeHtml(question.type)}</p>`;
    }

    return `
      <p>${escapeHtml(door.summary)}</p>
      <div class="key-grid">${door.keyPoints.map((point) => `<span>${escapeHtml(point)}</span>`).join("")}</div>
      <div class="panel-actions">
        <button class="primary-button" data-action="lesson-next">ابدأ التحدي</button>
      </div>
    `;
  }

function getEmptyQuestion(type) {
  const base = { type, prompt: "", points: 10, hint: "" };
  switch (type) {
    case "mcq": return { ...base, options: ["", "", "", ""], answerIndex: 0 };
    case "truefalse": return { ...base, correctAnswer: true };
    case "match": return { ...base, pairs: [{ left: "", right: "" }, { left: "", right: "" }, { left: "", right: "" }] };
    case "fill": return { ...base, acceptableAnswers: [""] };
    case "challenge": return { ...base, challengeType: "order", items: [""], correct: [""] };
    default: return { ...base, type: "mcq", options: ["", "", "", ""], answerIndex: 0 };
  }
}

function readQuestionFromForm(q) {
  q.type = shell.querySelector('[name="q-type"]')?.value || q.type || "mcq";
  q.prompt = shell.querySelector('[name="q-prompt"]')?.value?.trim() || "";
  q.points = Number(shell.querySelector('[name="q-points"]')?.value) || 10;
  q.hint = shell.querySelector('[name="q-hint"]')?.value?.trim() || "";

  if (q.type === "mcq") {
    q.options = [];
    shell.querySelectorAll('[name^="q-option-"]').forEach(el => q.options.push(el.value.trim()));
    q.options = q.options.filter(Boolean);
    q.answerIndex = Number(shell.querySelector('[name="q-answer-index"]:checked')?.value) || 0;
  }
  if (q.type === "truefalse") {
    q.correctAnswer = shell.querySelector('[name="q-correct-tf"]:checked')?.value !== "false";
  }
  if (q.type === "match") {
    q.pairs = [];
    shell.querySelectorAll('[name^="q-pair-left-"]').forEach((el, i) => {
      const right = shell.querySelector(`[name="q-pair-right-${i}"]`)?.value?.trim() || "";
      if (el.value.trim() || right) q.pairs.push({ left: el.value.trim(), right });
    });
  }
  if (q.type === "fill") {
    q.acceptableAnswers = [];
    shell.querySelectorAll('[name^="q-fill-answer-"]').forEach(el => {
      if (el.value.trim()) q.acceptableAnswers.push(el.value.trim());
    });
  }
  if (q.type === "challenge") {
    q.challengeType = shell.querySelector('[name="q-challenge-type"]')?.value || "order";
    q.items = [];
    q.correct = [];
    shell.querySelectorAll('[name^="q-ch-item-"]').forEach(el => { if (el.value.trim()) q.items.push(el.value.trim()); });
    shell.querySelectorAll('[name^="q-ch-correct-"]').forEach(el => { if (el.value.trim()) q.correct.push(el.value.trim()); });
  }
  return q;
}

  function renderOptions(kind, challenge, label) {
    const action = kind === "quiz" ? "answer-quiz" : "answer-scenario";
    return `
      <p class="eyebrow">${label}</p>
      <h3>${escapeHtml(challenge.prompt)}</h3>
      <div class="option-list">
        ${(challenge.options || []).map((option, index) => `<button class="option-button" data-action="${action}" data-index="${index}">${escapeHtml(option)}</button>`).join("")}
      </div>
    `;
  }

function renderObstaclePanel() {
  const obstacle = content.obstacles.find((item) => item.id === selectedObstacleId);
  if (!obstacle) return "";

  const hasCard = progress.cards.includes(obstacle.requiredCardId);
  const card = content.cards.find((c) => c.id === obstacle.requiredCardId);

  const referenceSection = (obstacle.referenceTitle || obstacle.referenceLink)
    ? `
      <div class="obstacle-reference" style="margin: 12px 0; padding: 12px; background: rgba(255,255,255,0.1); border-radius: 8px; border-right: 3px solid #fbbf24;">
        ${obstacle.referenceType ? `<span style="font-size:11px; opacity:0.7; display:block; margin-bottom:4px;">${escapeHtml(obstacle.referenceType)}</span>` : ""}
        ${obstacle.referenceTitle ? `<strong style="display:block; margin-bottom:6px; font-size:14px;">${escapeHtml(obstacle.referenceTitle)}</strong>` : ""}
        ${obstacle.referenceLink ? `<a href="${escapeHtml(obstacle.referenceLink)}" target="_blank" rel="noopener noreferrer" style="color:#60a5fa; font-size:13px; text-decoration:underline;">🔗 افتح المرجع</a>` : ""}
      </div>
    `
    : "";

  return `
    <div class="obstacle-panel-content">
      <h3 style="margin:0 0 12px 0; color:#fbbf24;">⚡ عقبة: ${escapeHtml(obstacle.title)}</h3>
      
      ${referenceSection}

      <p style="margin:16px 0; line-height:1.8; font-size:15px;">${escapeHtml(obstacle.prompt)}</p>
      
      ${feedback ? `<div style="padding:10px; border-radius:6px; background:rgba(239,68,68,0.15); color:#fca5a5; margin-bottom:12px; font-size:14px;">${escapeHtml(feedback)}</div>` : ""}
      
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${obstacle.options.map((opt, i) => `
          <button class="obstacle-option-btn" data-action="answer-obstacle" data-index="${i}" style="padding:12px; border-radius:8px; border:1px solid rgba(255,255,255,0.2); background:rgba(255,255,255,0.05); color:#fff; cursor:pointer; text-align:right; font-size:14px; transition:0.2s;">
            ${escapeHtml(opt)}
          </button>
        `).join("")}
      </div>

      ${hasCard && card ? `
        <button data-action="use-card" style="margin-top:12px; width:100%; padding:12px; border-radius:8px; border:1px solid #fbbf24; background:rgba(251,191,36,0.15); color:#fbbf24; cursor:pointer; font-size:14px; font-weight:bold;">
          🃏 استخدم بطاقة: ${escapeHtml(card.title)}
        </button>
      ` : ""}
    </div>
  `;
}

function renderStudent(stats) {
  const completed = completedSet();
  const ownedCards = new Set(progress.cards);
  const ownedKeys = new Set(progress.keys);
  const resolvedObstacles = obstacleSet();

  const currentDoor = getCurrentDoor();
  const nextLevel = stats.next;
  const xpToNext = nextLevel ? nextLevel.min - progress.xp : 0;

  const doorsJourney = content.doors.map((door, index) => {
    const isCompleted = completed.has(door.id);
    const isUnlocked = isDoorUnlocked(index);
    const isCurrent = door.id === currentDoor?.id;
    const card = content.cards.find(c => c.id === door.cardId);
    const hasCard = card && ownedCards.has(card.id);
    const hasKey = ownedKeys.has(door.id);

    let statusIcon = "🔒";
    let statusText = "مغلق";
    let statusClass = "door-locked";

    if (isCompleted) {
      statusIcon = "✅";
      statusText = "مكتمل";
      statusClass = "door-completed";
    } else if (isCurrent) {
      statusIcon = "📍";
      statusText = "حالي";
      statusClass = "door-current";
    } else if (isUnlocked) {
      statusIcon = "🔓";
      statusText = "متاح";
      statusClass = "door-unlocked";
    }

    return `
      <div class="journey-door ${statusClass}">
        <div class="journey-door-header">
          <span class="journey-num">${index + 1}</span>
          <strong>${escapeHtml(door.title)}</strong>
          <span class="journey-status-badge">${statusIcon} ${statusText}</span>
        </div>
        <div class="journey-door-rewards">
          <span class="jr ${hasKey ? 'jr-has' : ''}">🔑 مفتاح ${hasKey ? '✓' : ''}</span>
          ${card ? `<span class="jr ${hasCard ? 'jr-has' : ''}">${escapeHtml(card.icon)} ${escapeHtml(card.title)} ${hasCard ? '✓' : ''}</span>` : ''}
        </div>
      </div>
    `;
  }).join("");

  const keysList = content.doors
    .filter(door => ownedKeys.has(door.id))
    .map(door => `
      <div class="key-collected">
        <img src="${assetUrls.KEY}" alt="" draggable="false" />
        <span>${escapeHtml(makeDoorKeyName(door.title))}</span>
      </div>
    `).join("") || `<p class="empty-note">لم تحصل على أي مفتاح بعد.</p>`;

  const obstaclesList = content.obstacles.map(obs => {
    const isResolved = resolvedObstacles.has(obs.id);
    return `
      <div class="obs-item ${isResolved ? 'obs-done' : ''}">
        <span class="obs-icon">${isResolved ? "✅" : "⏳"}</span>
        <div>
          <strong>${escapeHtml(obs.title)}</strong>
          <span>${isResolved ? "تم التجاوز" : "لم يُتجاوز بعد"}</span>
        </div>
      </div>
    `;
  }).join("") || `<p class="empty-note">لا توجد عقبات في هذه الرحلة.</p>`;

  return `
    <div class="dashboard student-board">

      <section class="student-profile">
        <div class="profile-avatar">
          <img src="${assetUrls.STUDENT_EXPLORER}" alt="" draggable="false" />
        </div>
        <div class="profile-info">
          <h2>${escapeHtml(currentUser?.name || "الطالب")}</h2>
          <span class="profile-level-badge">${escapeHtml(stats.level.title)}</span>
          <div class="xp-detail">
            <span>${stats.xp} XP</span>
            ${nextLevel ? `<span>المستقبل: ${escapeHtml(nextLevel.title)} (تحتاج ${xpToNext} XP)</span>` : `<span>🏆 أعلى مستوى!</span>`}
          </div>
          <div class="big-progress"><i style="width:${stats.levelPercent}%"></i></div>
        </div>
      </section>

      <section class="stat-hero">
        <p class="eyebrow">التقدم في الرحلة</p>
        <p>أكملت ${stats.completed} من ${stats.totalDoors} أبواب (${stats.progressPercent}%)</p>
        <div class="big-progress"><i style="width:${stats.progressPercent}%"></i></div>
      </section>

      <section class="stat-grid">
        ${statCard("المكتملة", stats.completed)}
        ${statCard("المتاحة", stats.unlocked)}
        ${statCard("المغلقة", stats.locked)}
        ${statCard("البطاقات", stats.cards)}
        ${statCard("المفاتيح", stats.keys)}
        ${statCard("العقبات", progress.resolvedObstacles.length)}
        ${statCard("النقاط", stats.xp)}
        ${statCard("المستوى", stats.level.title)}
      </section>

      <section class="journey-section">
        <h3>🗺️ رحلة الأبواب</h3>
        <div class="journey-list">${doorsJourney}</div>
      </section>

      <section class="keys-section">
        <h3>🔑 المفاتيح</h3>
        <div class="keys-grid">${keysList}</div>
      </section>

      <section class="cards-section">
        <h3>🃏 البطاقات</h3>
        <p class="section-note">اجمع البطاقات بحصولك على 80% أو أكثر في كل باب</p>
        <div class="card-grid">
          ${content.cards.map((card) => renderCard(card, ownedCards.has(card.id))).join("")}
        </div>
      </section>

      <section class="obstacles-section">
        <h3>⚡ العقبات</h3>
        <div class="obstacles-list">${obstaclesList}</div>
      </section>

      <section class="achievements">
        <h3>🏆 الإنجازات</h3>
        ${progress.achievements.length
          ? progress.achievements.map(item => `<p><span>${escapeHtml(item.at)}</span>${escapeHtml(item.text)}</p>`).join("")
          : `<p>ابدأ أول باب لتظهر إنجازاتك هنا.</p>`}
      </section>

      <section class="next-step-section">
        <h3>📌 الخطوة التالية</h3>
        ${currentDoor
          ? `<p>الباب التالي: <strong>${escapeHtml(currentDoor.title)}</strong></p>
             <button class="primary-button full" data-action="tab" data-id="map">الذهاب إلى الخريطة</button>`
          : `<p>🎉 مبروك! أكملت جميع الأبواب!</p>`}
      </section>

    </div>
  `;
}

  function statCard(label, value) {
    return `<div class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  function renderCard(card, owned) {
    return `
      <article class="knowledge-card ${owned ? "is-owned" : "is-locked"}">
        <img src="${assetUrls.KNOWLEDGE_CARD}" alt="" draggable="false" />
        <div class="card-text">
          <strong>${escapeHtml(card.title)}</strong>
          <span>${escapeHtml(card.icon)}</span>
          <small>${escapeHtml(owned ? card.power : "ستفتح عند إكمال بابها.")}</small>
        </div>
      </article>
    `;
  }

  function renderAdmin(stats) {
    return `
      <div class="dashboard admin-board">
        <section class="admin-summary">
          <div>
            <p class="eyebrow">لوحة المعلم / الأدمن</p>
            <h2>إدارة رحلة ميراث النبوة</h2>
            <p>هذه بيانات تجريبية قابلة للإضافة والحذف والتعديل؛ التقدم والمحتوى يحفظان داخل حالة اللعبة.</p>
          </div>
          <span class="save-indicator"></span>
        </section>
        <section class="teacher-stats stat-grid">
          ${statCard("الأبواب", content.doors.length)}
          ${statCard("البطاقات", content.cards.length)}
          ${statCard("العقبات", content.obstacles.length)}
          ${statCard("إنجاز الطالب", `${stats.progressPercent}%`)}
        </section>
        <div class="admin-tabs">
          ${adminTab("doors", "الأبواب")}
          ${adminTab("cards", "البطاقات")}
          ${adminTab("obstacles", "العقبات")}
          ${adminTab("progress", "التقدم")}
        </div>
        ${adminMode === "doors" ? renderDoorAdmin() : adminMode === "cards" ? renderCardAdmin() : adminMode === "obstacles" ? renderObstacleAdmin() : renderProgressAdmin()}
      </div>
    `;
  }

  function adminTab(id, label) {
    return `<button class="admin-tab ${adminMode === id ? "is-active" : ""}" data-action="admin-mode" data-id="${id}">${escapeHtml(label)}</button>`;
  }

  function renderDoorAdmin() {
    const door = content.doors.find((item) => item.id === editingDoorId) || content.doors[0];
    if (!door) return `<div class="empty-panel">لا يوجد باب.</div>`;
    if (!Array.isArray(door.questions)) door.questions = [];

    const showEditor = editingQuestionIdx >= -2 && tempQuestion;
    const typeIcons = { mcq: "📋", truefalse: "✅❌", match: "🔗", fill: "✏️", challenge: "🎯" };
    const typeNames = { mcq: "اختيار متعدد", truefalse: "صح/خطأ", match: "وصل", fill: "أكمل", challenge: "تحدي" };

    return `
      <div class="admin-layout">
        <aside class="admin-list">
          <button class="primary-button full" data-action="new-door">إضافة باب جديد</button>
          ${content.doors.map((item, index) => `
            <div class="admin-list-row ${item.id === door?.id ? "is-active" : ""}">
              <button data-action="edit-door" data-id="${escapeHtml(item.id)}">${index + 1}. ${escapeHtml(item.title)} <small>(${(item.questions || []).length} سؤال)</small></button>
              <button class="danger" data-action="delete-door" data-id="${escapeHtml(item.id)}">حذف</button>
            </div>
          `).join("")}
        </aside>
        <div class="admin-form admin-door-form">
          <form data-type="door">
            <input type="hidden" name="id" value="${escapeHtml(door.id)}" />
            ${field("عنوان الباب", "title", door.title)}
            ${textarea("شرح مختصر", "summary", door.summary)}
            ${field("وصف رسم/فيديو", "illustration", door.illustration)}
            ${field("نقاط مفتاحية (فواصل)", "keyPoints", (door.keyPoints || []).join("، "))}
            <label>البطاقة الممنوحة<select name="cardId">
              <option value="">بدون بطاقة</option>
              ${content.cards.map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === door.cardId ? "selected" : ""}>${escapeHtml(c.title)}</option>`).join("")}
            </select></label>
            ${field("نقاط الخبرة", "xp", door.xp, "number")}
            <button type="submit" class="primary-button full">حفظ بيانات الباب</button>
          </form>

          <div class="questions-builder">
            <div class="qb-header">
              <h3>الأسئلة (${door.questions.length})</h3>
              <div class="qb-add-buttons">
                ${Object.keys(typeNames).map(t => `<button class="ghost-button qb-add-btn" data-action="add-question" data-type="${t}">${typeIcons[t]} ${typeNames[t]}</button>`).join("")}
              </div>
            </div>
            <div class="qb-list">
              ${door.questions.length === 0 ? `<p class="empty-note">لم تُضف أسئلة بعد.</p>` : ""}
              ${door.questions.map((q, i) => `
                <div class="qb-item ${editingQuestionIdx === i ? 'is-editing' : ''}">
                  <div class="qb-item-info">
                    <span class="qb-type-icon">${typeIcons[q.type] || "❓"}</span>
                    <span class="qb-type-name">${typeNames[q.type] || q.type}</span>
                    <span class="qb-prompt">${escapeHtml((q.prompt || "").substring(0, 50))}${(q.prompt || "").length > 50 ? "..." : ""}</span>
                    <span class="qb-points">${q.points || 10}ن</span>
                  </div>
                  <div class="qb-item-actions">
                    <button class="ghost-button" data-action="move-question" data-index="${i}" data-dir="up" ${i === 0 ? 'disabled' : ''}>↑</button>
                    <button class="ghost-button" data-action="move-question" data-index="${i}" data-dir="down" ${i === door.questions.length - 1 ? 'disabled' : ''}>↓</button>
                    <button class="ghost-button" data-action="edit-question" data-index="${i}">تعديل</button>
                    <button class="danger" data-action="delete-question" data-index="${i}">حذف</button>
                  </div>
                </div>
              `).join("")}
            </div>
            ${showEditor ? renderQuestionEditor(tempQuestion) : ""}
          </div>
        </div>
      </div>
    `;
  }

    function renderQuestionEditor(q) {
    const isNew = editingQuestionIdx === -2;
    const typeNames = { mcq: "اختيار متعدد", truefalse: "صح/خطأ", match: "وصل", fill: "أكمل الإجابة", challenge: "تحدي" };
    let editorContent = "";

    if (q.type === "mcq") {
      const opts = q.options || ["", "", "", ""];
      editorContent = `
        ${field("نص السؤال", "q-prompt", q.prompt)}
        <div class="q-options-editor">
          <label>الخيارات (اختر الإجابة الصحيحة)</label>
          ${opts.map((opt, i) => `
            <div class="q-option-row">
              <input type="radio" name="q-answer-index" value="${i}" ${Number(q.answerIndex) === i ? "checked" : ""} />
              <input type="text" name="q-option-${i}" value="${escapeHtml(opt)}" placeholder="الخيار ${i + 1}" />
              ${opts.length > 2 ? `<button type="button" class="danger q-remove-btn" data-action="remove-mcq-option" data-index="${i}">✕</button>` : ""}
            </div>
          `).join("")}
          <button type="button" class="ghost-button" data-action="add-mcq-option">+ إضافة خيار</button>
        </div>`;
    }

    if (q.type === "truefalse") {
      editorContent = `
        ${field("نص العبارة", "q-prompt", q.prompt)}
        <label>الإجابة الصحيحة</label>
        <div class="tf-options">
          <label class="tf-option"><input type="radio" name="q-correct-tf" value="true" ${q.correctAnswer !== false ? "checked" : ""} /> صح</label>
          <label class="tf-option"><input type="radio" name="q-correct-tf" value="false" ${q.correctAnswer === false ? "checked" : ""} /> خطأ</label>
        </div>`;
    }

    if (q.type === "match") {
      const pairs = q.pairs || [{ left: "", right: "" }];
      editorContent = `
        ${field("نص السؤال (مثال: صل كل مصطلح بتعريفه)", "q-prompt", q.prompt)}
        <div class="q-pairs-editor">
          <label>الأزواج</label>
          ${pairs.map((p, i) => `
            <div class="q-pair-row">
              <input type="text" name="q-pair-left-${i}" value="${escapeHtml(p.left)}" placeholder="الطرف الأيسر" />
              <span>↔</span>
              <input type="text" name="q-pair-right-${i}" value="${escapeHtml(p.right)}" placeholder="الطرف الأيمن" />
              ${pairs.length > 2 ? `<button type="button" class="danger q-remove-btn" data-action="remove-match-pair" data-index="${i}">✕</button>` : ""}
            </div>
          `).join("")}
          <button type="button" class="ghost-button" data-action="add-match-pair">+ إضافة زوج</button>
        </div>`;
    }

    if (q.type === "fill") {
      const answers = q.acceptableAnswers || [""];
      editorContent = `
        ${field("نص السؤال (استخدم ___ مكان الفراغ)", "q-prompt", q.prompt)}
        <div class="q-fill-editor">
          <label>الإجابات المقبولة (يمكن إضافة صيغ بديلة)</label>
          ${answers.map((a, i) => `
            <div class="q-fill-row">
              <input type="text" name="q-fill-answer-${i}" value="${escapeHtml(a)}" placeholder="إجابة مقبولة" />
              ${answers.length > 1 ? `<button type="button" class="danger q-remove-btn" data-action="remove-fill-answer" data-index="${i}">✕</button>` : ""}
            </div>
          `).join("")}
          <button type="button" class="ghost-button" data-action="add-fill-answer">+ إجابة بديلة</button>
        </div>`;
    }

    if (q.type === "challenge") {
      const items = q.items || [];
      const correct = q.correct || [];
      editorContent = `
        ${field("نص التحدي", "q-prompt", q.prompt)}
        <label>نوع التحدي<select name="q-challenge-type">
          <option value="order" ${q.challengeType === "order" ? "selected" : ""}>ترتيب</option>
          <option value="classify" ${q.challengeType === "classify" ? "selected" : ""}>تصنيف</option>
          <option value="sort" ${q.challengeType === "sort" ? "selected" : ""}>فرز</option>
        </select></label>
        <div class="q-challenge-editor">
          <label>العناصر</label>
          ${items.map((item, i) => `
            <div class="q-ch-row">
              <input type="text" name="q-ch-item-${i}" value="${escapeHtml(item)}" placeholder="عنصر ${i + 1}" />
              <button type="button" class="danger q-remove-btn" data-action="remove-challenge-item" data-index="${i}">✕</button>
            </div>
          `).join("")}
          <button type="button" class="ghost-button" data-action="add-challenge-item">+ عنصر</button>
          <label>الترتيب/التصنيف الصحيح</label>
          ${correct.map((item, i) => `
            <div class="q-ch-row">
              <input type="text" name="q-ch-correct-${i}" value="${escapeHtml(item)}" placeholder="${i + 1}" />
              <button type="button" class="danger q-remove-btn" data-action="remove-challenge-correct" data-index="${i}">✕</button>
            </div>
          `).join("")}
          <button type="button" class="ghost-button" data-action="add-challenge-correct">+ عنصر</button>
        </div>`;
    }

    return `
      <div class="question-editor">
        <div class="qe-header">
          <h3>${isNew ? "➕ سؤال جديد" : "✏️ تعديل السؤال"}</h3>
          <select name="q-type" class="qe-type-select">
            ${Object.entries(typeNames).map(([k, v]) => `<option value="${k}" ${q.type === k ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </div>
        ${editorContent}
        ${field("النقاط", "q-points", q.points, "number")}
        ${field("تلميح (اختياري)", "q-hint", q.hint || "")}
        <div class="qe-actions">
          <button type="button" class="primary-button" data-action="save-question">${isNew ? "إضافة السؤال" : "حفظ التعديل"}</button>
          <button type="button" class="ghost-button" data-action="cancel-question">إلغاء</button>
        </div>
      </div>`;
  }

  function renderCardAdmin() {
    const card = content.cards.find((item) => item.id === editingCardId) || content.cards[0];
    return `
      <div class="admin-layout">
        <aside class="admin-list">
          <button class="primary-button full" data-action="new-card">إضافة بطاقة</button>
          ${content.cards.map((item) => `
            <div class="admin-list-row ${item.id === card?.id ? "is-active" : ""}">
              <button data-action="edit-card" data-id="${escapeHtml(item.id)}">${escapeHtml(item.title)}</button>
              <button class="danger" data-action="delete-card" data-id="${escapeHtml(item.id)}">حذف</button>
            </div>
          `).join("")}
        </aside>
        ${card ? `
          <form class="admin-form" data-type="card">
            <input type="hidden" name="id" value="${escapeHtml(card.id)}" />
            ${field("اسم البطاقة", "title", card.title)}
            ${field("رمز مختصر", "icon", card.icon)}
            ${textarea("أثر البطاقة", "power", card.power)}
            <button class="primary-button full" type="submit">حفظ البطاقة</button>
          </form>
        ` : `<p>لا توجد بطاقات.</p>`}
      </div>
    `;
  }

  function renderObstacleAdmin() {
    const obstacle = content.obstacles.find((item) => item.id === editingObstacleId) || content.obstacles[0];
    if (!obstacle) return `<div class="empty-panel">لا توجد عقبات.</div>`;

    return `
      <div class="admin-layout">
        <aside class="admin-list">
          <button class="primary-button full" data-action="new-obstacle">إضافة عقبة جديدة</button>
          ${content.obstacles.map((item) => `
            <div class="admin-list-row ${item.id === obstacle?.id ? "is-active" : ""}">
              <button data-action="edit-obstacle" data-id="${escapeHtml(item.id)}">${escapeHtml(item.title)}</button>
              <button class="danger" data-action="delete-obstacle" data-id="${escapeHtml(item.id)}">حذف</button>
            </div>
          `).join("")}
        </aside>
        <form class="admin-form" data-type="obstacle">
          <input type="hidden" name="id" value="${escapeHtml(obstacle.id)}" />
          ${field("عنوان العقبة", "title", obstacle.title)}
          <label>تظهر بعد باب<select name="gateAfter">
            ${content.doors.map((d) => `<option value="${escapeHtml(d.id)}" ${d.id === obstacle.gateAfter ? "selected" : ""}>${escapeHtml(d.title)}</option>`).join("")}
          </select></label>
          <label>البطاقة المطلوبة<select name="requiredCardId">
            <option value="">بدون بطاقة (يرجع للمرجع)</option>
            ${content.cards.map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === obstacle.requiredCardId ? "selected" : ""}>${escapeHtml(c.title)}</option>`).join("")}
          </select></label>
          ${field("نص سؤال العقبة", "prompt", obstacle.prompt)}
          ${field("الاختيارات (فواصل)", "options", (obstacle.options || []).join("، "))}
          ${field("رقم الإجابة الصحيحة", "answerIndex", obstacle.answerIndex, "number")}
          <div class="ref-section">
            <h4>📌 المرجع (يظهر إذا لم يملك الطالب البطاقة)</h4>
            <label>نوع المرجع<select name="referenceType">
              <option value="article" ${obstacle.referenceType === "article" ? "selected" : ""}>مقال</option>
              <option value="video" ${obstacle.referenceType === "video" ? "selected" : ""}>فيديو</option>
              <option value="book" ${obstacle.referenceType === "book" ? "selected" : ""}>كتاب</option>
            </select></label>
            ${field("عنوان المرجع", "referenceTitle", obstacle.referenceTitle || "")}
            ${field("رابط المرجع", "referenceLink", obstacle.referenceLink || "")}
          </div>
          <button type="submit" class="primary-button full">حفظ التعديلات</button>
        </form>
      </div>
    `;
  }

  function renderProgressAdmin() {
    return `
      <section class="progress-admin">
        <h3>متابعة الطالب</h3>
        <p>الأبواب المكتملة: ${progress.completedDoors.length}، العقبات المتجاوزة: ${progress.resolvedObstacles.length}، البطاقات: ${progress.cards.length}، النقاط: ${progress.xp} XP.</p>
        <div class="achievement-feed">
          ${progress.achievements.length ? progress.achievements.map((item) => `<p><span>${escapeHtml(item.at)}</span>${escapeHtml(item.text)}</p>`).join("") : `<p>لا توجد إنجازات بعد.</p>`}
        </div>
        <div class="panel-actions">
          <button class="ghost-button" data-action="reset-progress">تصفير تقدم الطالب</button>
          <button class="danger-button" data-action="reset-content">استعادة المحتوى التجريبي</button>
        </div>
      </section>
    `;
  }

  function field(label, name, value, type = "text") {
    return `<label>${escapeHtml(label)}<input name="${escapeHtml(name)}" type="${type}" value="${escapeHtml(value)}" /></label>`;
  }

  function textarea(label, name, value) {
    return `<label>${escapeHtml(label)}<textarea name="${escapeHtml(name)}" rows="3">${escapeHtml(value)}</textarea></label>`;
  }

  return {
start() {
  const root = document.createElement("section");
  root.className = "mirath-game";
  root.dir = "rtl";
  root.innerHTML = `
    <main class="game-shell" data-view="map" hidden></main>
    <section class="start-overlay" role="dialog" aria-label="بدء اللعبة">
      <div class="start-card">
        <div class="start-emblem">🗺️</div>
        <p class="eyebrow">مغامرة تعليمية</p>
        <h1>خريطة ميراث النبوة</h1>
        <p class="start-copy">نرسم الخريطة ونجهز البطاقات...</p>
        <button class="primary-button start-button" disabled>تحميل</button>
      </div>
    </section>
  `;

  shell = root.querySelector(".game-shell");
  overlay = root.querySelector(".start-overlay");
  startButton = root.querySelector(".start-button");
  overlayText = root.querySelector(".start-copy");
  mount.replaceChildren(root);

  root.addEventListener("click", handleClick);
  root.addEventListener("submit", handleSubmit);
  root.addEventListener("change", handleChange);
  root.addEventListener("input", handleChange);

  startButton.addEventListener("click", async () => {
    if (!imagesReady || !saveReady || started) return;
    started = true;
    await unlockAudio();
    overlay.hidden = true;
    shell.hidden = false;
    playTone("success");
    render();
  });

  Promise.allSettled(Object.values(assetUrls).map(preloadImage)).then((results) => {
    const failed = results.filter((r) => r.status === "rejected");

    if (failed.length) {
      console.warn("بعض الصور لم تُحمّل، لكن اللعبة ستبدأ:", failed);
    }

    imagesReady = true;
    updateStartOverlay();
  });

  if (!getToken()) {
    overlay.hidden = true;
    shell.hidden = false;

    renderAuthView(shell, async () => {
      authToken = getToken();
      currentUser = getUser();
      shell.dataset.view = currentUser?.role === "admin" ? "admin" : "map";

      shell.hidden = true;
      overlay.hidden = false;
      saveReady = false;
      started = false;

      await loadSave();
      updateStartOverlay();
    });
  } else {
    authToken = getToken();
    currentUser = getUser();
    shell.dataset.view = currentUser?.role === "admin" ? "admin" : "map";
    loadSave();
  }

  cleanup = async () => {
    root.removeEventListener("click", handleClick);
    root.removeEventListener("submit", handleSubmit);
    if (audioHandle?.dispose) await audioHandle.dispose();
    mount.replaceChildren();
  };
},
    destroy() {
      cleanup();
      cleanup = () => {};
    },
    sdk,
    ready,
    tweaks,
    assets,
  };
}

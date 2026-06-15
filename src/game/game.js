import { DEFAULT_CONTENT } from "./content.js";
import mapLayout from "./content/map-layout.json";
import { renderAuthView } from "./auth-view.js";
import { getToken, getUser, logout } from "./auth.js";
import { getContent, getProgress, completeDoorOnServer, resolveObstacleOnServer } from "./api.js";
const SAVE_VERSION = 6;

const FALLBACK_ASSETS = {
  MAP_BACKDROP: "/generated-images/map_backdrop.png",
  LOCKED_DOOR: "/generated-images/locked_door.png",
  OPEN_DOOR: "/generated-images/open_door.png",
  TREASURE_CHEST: "/generated-images/treasure_chest.png",
  KNOWLEDGE_CARD: "/generated-images/knowledge_card.png",
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

  const stageRect = mapStage.getBoundingClientRect();
  const playerRect = player.getBoundingClientRect();

  const playerCenterY =
    playerRect.top - stageRect.top + mapStage.scrollTop + playerRect.height / 2;

  mapStage.scrollTop = Math.max(0, playerCenterY - mapStage.clientHeight / 2);
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
let hitAnimation = null;
  let miniPick = [];
  let usedSabrBoost = false;
  let adminMode = "doors";
  let hudCollapsed = true;
let navCollapsed = true;
  let editingDoorId = DEFAULT_CONTENT.doors[0]?.id || "";
let editingCardId = DEFAULT_CONTENT.cards[0]?.id || "";
let editingObstacleId = DEFAULT_CONTENT.obstacles[0]?.id || "";

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

function showCardReward(card) {
  if (!card) return;
  rewardAnimation = card;
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

  if (!progress.completedDoors.includes(door.id)) {
    progress.completedDoors.push(door.id);
    progress.xp += Number(door.xp) || 80;

    if (door.cardId && !progress.cards.includes(door.cardId)) {
      progress.cards.push(door.cardId);
    }

    const card = content.cards.find((item) => item.id === door.cardId);

    if (card) {
      showCardReward(card);
    }

    addAchievement(`أكملت ${door.title}${card ? ` وحصلت على ${card.title}` : ""}`);

    playTone("success");
    pulse(40);

    if (authToken) {
      try {
        await completeDoorOnServer(authToken, door.id, door.cardId);
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

  render();
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

  render();
}

  function resetChallenge() {
    phase = 0;
    feedback = "";
    miniPick = [];
    usedSabrBoost = false;
  }

  function handleAnswer(kind, index) {
    const door = content.doors.find((item) => item.id === selectedDoorId);
    if (!door) return;
    const challenge = kind === "quiz" ? door.quiz : door.scenario;
    if (Number(index) === Number(challenge.answerIndex)) {
      feedback = "إجابة موفقة. تقدّم للخطوة التالية.";
      phase += 1;
      playTone("success");
      pulse(20);
    } else if (progress.cards.includes("sabr") && !usedSabrBoost) {
      usedSabrBoost = true;
      feedback = "ليست هذه الإجابة. بطاقة الصبر منحتك فرصة هادئة لإعادة التفكير.";
      playTone("error");
    } else {
      feedback = "اقتربت من الفكرة، راجع الشرح وحاول مرة أخرى.";
      playTone("error");
    }
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

function handleClick(event) {
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
      resetChallenge();
      render();
    }
    if (action === "lesson-next") {
      phase = 1;
      feedback = "";
      render();
    }
    if (action === "answer-quiz") handleAnswer("quiz", button.dataset.index);
    if (action === "answer-scenario") handleAnswer("scenario", button.dataset.index);
    if (action === "mini-pick") handleMiniPick(button.dataset.value);
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
      };
      content.doors.push(newDoor);
      editingDoorId = newDoor.id;
      selectedDoorId = newDoor.id;
      persist();
      render();
    }
    if (action === "delete-door") {
      if (content.doors.length <= 1) return;
      content.doors = content.doors.filter((door) => door.id !== id);
      content.obstacles = content.obstacles.filter((obstacle) => obstacle.gateAfter !== id);
      progress.completedDoors = progress.completedDoors.filter((doorId) => doorId !== id);
      selectedDoorId = content.doors[0]?.id || "";
      editingDoorId = selectedDoorId;
      persist();
      render();
    }
    if (action === "edit-card") {
      editingCardId = id;
      render();
    }
    if (action === "new-card") {
      const newCard = { id: uid("card"), title: "بطاقة جديدة", icon: "نجمة", power: "اكتب أثر البطاقة داخل الرحلة." };
      content.cards.push(newCard);
      editingCardId = newCard.id;
      persist();
      render();
    }
    if (action === "delete-card") {
      content.cards = content.cards.filter((card) => card.id !== id);
      progress.cards = progress.cards.filter((cardId) => cardId !== id);
      editingCardId = content.cards[0]?.id || "";
      persist();
      render();
    }
    if (action === "edit-obstacle") {
      editingObstacleId = id;
      render();
    }
    if (action === "new-obstacle") {
      const newObstacle = {
        id: uid("obstacle"),
        title: "عقبة جديدة",
        gateAfter: content.doors[0]?.id || "",
        requiredCardId: content.cards[0]?.id || "",
        prompt: "ما التصرف المناسب لتجاوز هذه العقبة؟",
        options: ["اختيار صحيح", "اختيار بعيد", "اختيار مشتت"],
        answerIndex: 0,
      };
      content.obstacles.push(newObstacle);
      editingObstacleId = newObstacle.id;
      persist();
      render();
    }
    if (action === "delete-obstacle") {
      content.obstacles = content.obstacles.filter((obstacle) => obstacle.id !== id);
      progress.resolvedObstacles = progress.resolvedObstacles.filter((obstacleId) => obstacleId !== id);
      editingObstacleId = content.obstacles[0]?.id || "";
      persist();
      render();
    }
    if (action === "reset-progress") {
      progress = normalizeProgress();
      resetChallenge();
      persist();
      render();
    }
if (action === "reset-content") {
  content = clone(DEFAULT_CONTENT);
  progress = normalizeProgress();

  selectedDoorId = content.doors[0]?.id || "";
  editingDoorId = content.doors[0]?.id || "";
  editingCardId = content.cards[0]?.id || "";
  editingObstacleId = content.obstacles[0]?.id || "";

  persist();
  render();
}
  }

  function handleSubmit(event) {
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
      door.quiz.prompt = String(data.get("quizPrompt") || "").trim();
      door.quiz.options = splitList(data.get("quizOptions"));
      door.quiz.answerIndex = Math.max(0, Math.min(Number(data.get("quizAnswer")) || 0, door.quiz.options.length - 1));
      door.scenario.prompt = String(data.get("scenarioPrompt") || "").trim();
      door.scenario.options = splitList(data.get("scenarioOptions"));
      door.scenario.answerIndex = Math.max(0, Math.min(Number(data.get("scenarioAnswer")) || 0, door.scenario.options.length - 1));
      door.mini.prompt = String(data.get("miniPrompt") || "").trim();
      door.mini.items = splitList(data.get("miniItems"));
      door.mini.correct = splitList(data.get("miniCorrect"));
      door.cardId = String(data.get("cardId") || "");
      door.xp = Number(data.get("xp")) || 80;
      selectedDoorId = door.id;
    }
    if (type === "card") {
      const card = content.cards.find((item) => item.id === data.get("id"));
      if (!card) return;
      card.title = String(data.get("title") || card.title).trim();
      card.icon = String(data.get("icon") || "").trim();
      card.power = String(data.get("power") || "").trim();
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
    }
    feedback = "تم تحديث المحتوى التجريبي.";
    persist();
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

requestAnimationFrame(() => {
  if (previousScrollTop > 0) {
    restoreMapScrollTop(shell, previousScrollTop);
  } else {
    scrollToPlayer(shell);
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
      xp: progress.xp,
      level,
      next,
      levelPercent: Math.min(100, Math.round(((progress.xp - previousMin) / Math.max(1, nextMin - previousMin)) * 100)),
      progressPercent: Math.round((completed / totalDoors) * 100),
    };
  }

function renderRewardAnimation() {
  if (!rewardAnimation) return "";

  const card = rewardAnimation;
  rewardAnimation = null;

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

function renderHitAnimation() {
  if (!hitAnimation) return "";

  return `
    <div class="hit-animation">
      <div class="hit-burst">⚡</div>
      <div class="hit-text">تجاوزت ${escapeHtml(hitAnimation.title || "العقبة")}</div>
    </div>
  `;
}

function renderMap(stats) {
  return `
    <div class="map-view">
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
      <aside class="quest-panel">
        ${selectedObstacleId ? renderObstaclePanel() : renderDoorPanel(stats)}
      </aside>
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
    if (phase === 1) return renderOptions("quiz", door.quiz, "تحدي الفهم");
    if (phase === 2) return renderOptions("scenario", door.scenario, "موقف واقعي");
    return `
      <p class="eyebrow">لعبة صغيرة</p>
      <h3>${escapeHtml(door.mini.prompt)}</h3>
      <div class="mini-board">
        ${door.mini.items.map((item) => `<button class="chip-button ${miniPick.includes(item) ? "is-picked" : ""}" data-action="mini-pick" data-value="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}
      </div>
      <div class="answer-lane">${miniPick.length ? miniPick.map((item, index) => `<span>${index + 1}. ${escapeHtml(item)}</span>`).join("") : "اختر البطاقات بالترتيب الصحيح"}</div>
    `;
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
    const card = content.cards.find((item) => item.id === obstacle.requiredCardId);
    const ownsCard = progress.cards.includes(obstacle.requiredCardId);
    return `
      <p class="eyebrow">عقبة في الطريق</p>
      <h2>${escapeHtml(obstacle.title)}</h2>
      <p>${escapeHtml(obstacle.prompt)}</p>
      <div class="obstacle-card">
        <img src="${assetUrls.OBSTACLE_TOKEN}" alt="" draggable="false" />
        <div>
          <strong>البطاقة المناسبة: ${escapeHtml(card?.title || "غير محددة")}</strong>
          <span>${ownsCard ? "تملك هذه البطاقة ويمكنك استخدامها." : "يمكنك الإجابة بدلًا من استخدام البطاقة."}</span>
        </div>
      </div>
      <div class="panel-actions">
        <button class="ghost-button" data-action="use-card">استخدم البطاقة</button>
      </div>
      <div class="option-list obstacle-options">
        ${obstacle.options.map((option, index) => `<button class="option-button" data-action="answer-obstacle" data-index="${index}">${escapeHtml(option)}</button>`).join("")}
      </div>
      ${feedback ? `<p class="feedback">${escapeHtml(feedback)}</p>` : ""}
    `;
  }

function renderStudent(stats) {
  return `
    <div class="dashboard student-board">

      <section class="stat-hero">
        <p class="eyebrow">لوحة الطالب</p>

        <p>
          أنجزت ${stats.progressPercent}% من رحلة الخريطة
          وجمعت ${stats.cards} بطاقة.
        </p>

        <div class="big-progress">
          <i style="width:${stats.progressPercent}%"></i>
        </div>
      </section>

      <section class="stat-grid">
        ${statCard("الأبواب المفتوحة", stats.unlocked)}
        ${statCard("الأبواب المغلقة", stats.locked)}
        ${statCard("البطاقات", stats.cards)}
        ${statCard("النقاط", stats.xp)}
      </section>

      <section class="cards-section">
        <h3>بطاقاتك</h3>
        <div class="card-grid">
          ${content.cards.map((card) =>
            renderCard(card, progress.cards.includes(card.id))
          ).join("")}
        </div>
      </section>

      <section class="achievements">
        <h3>آخر الإنجازات</h3>
        ${
          progress.achievements.length
            ? progress.achievements
                .map(
                  (item) =>
                    `<p><span>${escapeHtml(item.at)}</span>${escapeHtml(item.text)}</p>`
                )
                .join("")
            : `<p>ابدأ أول باب لتظهر إنجازاتك هنا.</p>`
        }
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
    return `
      <div class="admin-layout">
        <aside class="admin-list">
          <button class="primary-button full" data-action="new-door">إضافة باب جديد</button>
          ${content.doors.map((item, index) => `
            <div class="admin-list-row ${item.id === door?.id ? "is-active" : ""}">
              <button data-action="edit-door" data-id="${escapeHtml(item.id)}">${index + 1}. ${escapeHtml(item.title)}</button>
              <button class="danger" data-action="delete-door" data-id="${escapeHtml(item.id)}">حذف</button>
            </div>
          `).join("")}
        </aside>
        ${door ? `
          <form class="admin-form" data-type="door">
            <input type="hidden" name="id" value="${escapeHtml(door.id)}" />
            ${field("عنوان الباب", "title", door.title)}
            ${textarea("شرح مختصر", "summary", door.summary)}
            ${field("وصف رسم/فيديو/خريطة ذهنية", "illustration", door.illustration)}
            ${field("نقاط مفتاحية مفصولة بفواصل", "keyPoints", door.keyPoints.join("، "))}
            ${field("سؤال فهم", "quizPrompt", door.quiz.prompt)}
            ${field("اختيارات الفهم", "quizOptions", door.quiz.options.join("، "))}
            ${field("رقم الإجابة الصحيحة للفهم: 0 أو 1 أو 2", "quizAnswer", door.quiz.answerIndex, "number")}
            ${field("الموقف الواقعي", "scenarioPrompt", door.scenario.prompt)}
            ${field("اختيارات الموقف", "scenarioOptions", door.scenario.options.join("، "))}
            ${field("رقم الإجابة الصحيحة للموقف", "scenarioAnswer", door.scenario.answerIndex, "number")}
            ${field("نص اللعبة الصغيرة", "miniPrompt", door.mini.prompt)}
            ${field("عناصر اللعبة الصغيرة", "miniItems", door.mini.items.join("، "))}
            ${field("الترتيب الصحيح", "miniCorrect", door.mini.correct.join("، "))}
            <label>البطاقة الممنوحة<select name="cardId">${content.cards.map((card) => `<option value="${escapeHtml(card.id)}" ${card.id === door.cardId ? "selected" : ""}>${escapeHtml(card.title)}</option>`).join("")}</select></label>
            ${field("نقاط XP", "xp", door.xp, "number")}
            <button class="primary-button full" type="submit">حفظ الباب</button>
          </form>
        ` : `<p>لا توجد أبواب.</p>`}
      </div>
    `;
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
    return `
      <div class="admin-layout">
        <aside class="admin-list">
          <button class="primary-button full" data-action="new-obstacle">إضافة عقبة</button>
          ${content.obstacles.map((item) => `
            <div class="admin-list-row ${item.id === obstacle?.id ? "is-active" : ""}">
              <button data-action="edit-obstacle" data-id="${escapeHtml(item.id)}">${escapeHtml(item.title)}</button>
              <button class="danger" data-action="delete-obstacle" data-id="${escapeHtml(item.id)}">حذف</button>
            </div>
          `).join("")}
        </aside>
        ${obstacle ? `
          <form class="admin-form" data-type="obstacle">
            <input type="hidden" name="id" value="${escapeHtml(obstacle.id)}" />
            ${field("اسم العقبة", "title", obstacle.title)}
            <label>تظهر بعد باب<select name="gateAfter">${content.doors.map((door) => `<option value="${escapeHtml(door.id)}" ${door.id === obstacle.gateAfter ? "selected" : ""}>${escapeHtml(door.title)}</option>`).join("")}</select></label>
            <label>البطاقة المناسبة<select name="requiredCardId">${content.cards.map((card) => `<option value="${escapeHtml(card.id)}" ${card.id === obstacle.requiredCardId ? "selected" : ""}>${escapeHtml(card.title)}</option>`).join("")}</select></label>
            ${field("سؤال العقبة", "prompt", obstacle.prompt)}
            ${field("اختيارات العقبة", "options", obstacle.options.join("، "))}
            ${field("رقم الإجابة الصحيحة", "answerIndex", obstacle.answerIndex, "number")}
            <button class="primary-button full" type="submit">حفظ العقبة</button>
          </form>
        ` : `<p>لا توجد عقبات.</p>`}
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

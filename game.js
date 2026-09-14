(() => {
  "use strict";

  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");

  const catBikerImg = new Image();
  catBikerImg.src = "assets/cat-biker.png";
  const CAT_BIKER_W = 32;
  const CAT_BIKER_H = Math.round(CAT_BIKER_W * (catBikerImg.naturalHeight || 337) / (catBikerImg.naturalWidth || 200)) || 54;

  const startScreen = document.getElementById("startScreen");
  const instructionsScreen = document.getElementById("instructionsScreen");
  const endScreen = document.getElementById("endScreen");
  const startBtn = document.getElementById("startBtn");
  const playBtn = document.getElementById("playBtn");
  const retryBtn = document.getElementById("retryBtn");
  const endTitle = document.getElementById("endTitle");
  const endSubtitle = document.getElementById("endSubtitle");
  const endDistanceEl = document.getElementById("endDistance");
  const endFixedEl = document.getElementById("endFixed");
  const endPerfectEl = document.getElementById("endPerfect");
  const endScoreEl = document.getElementById("endScore");

  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const livesEl = document.getElementById("lives");
  const feedbackEl = document.getElementById("feedback");

  const leftBtn = document.getElementById("leftBtn");
  const rightBtn = document.getElementById("rightBtn");
  const repairBtn = document.getElementById("repairBtn");

  // ---------- Config ----------
  const LANE_COUNT = 3;
  const BASE_SPEED = 140;      // px/s world scroll at the start
  const MAX_SPEED = 340;
  const SPEED_RAMP = 0.03;     // speed added per meter travelled

  const LIVES_START = 3;
  const MAX_LIVES = 5;
  const GAUGE_CAP = 1.3;       // auto-release past this fraction
  const GREEN_START = 0.6;
  const GREEN_END = 0.85;

  // Pothole variety: each kind has its own size, fill speed, patience
  // window and payout. Gravel is quick & cheap, craters are slow & rich,
  // boss sinkholes take several successful hits to fully clear.
  const POTHOLE_KINDS = {
    gravel: {
      radius: 16,
      fillTime: 0.55,
      stopTimer: 3.2,
      points: { perfect: 40, bumpy: 15, overfill: 5 },
      ring: "rgba(210, 180, 120, 0.7)",
      weight: 0.35,
    },
    standard: {
      radius: 24,
      fillTime: 1.0,
      stopTimer: 4.5,
      points: { perfect: 100, bumpy: 30, overfill: 10 },
      ring: "rgba(255, 212, 59, 0.55)",
      weight: 0.5,
    },
    crater: {
      radius: 34,
      fillTime: 1.8,
      stopTimer: 6.0,
      points: { perfect: 220, bumpy: 80, overfill: 20 },
      ring: "rgba(255, 107, 107, 0.7)",
      weight: 0.15,
    },
    boss: {
      radius: 46,
      fillTime: 1.1,
      stopTimer: 5.2,
      points: { perfect: 60, bumpy: 20, overfill: 5 },
      finalBonus: 250,
      requiresHits: 3,
      ring: "rgba(230, 73, 228, 0.85)",
    },
  };

  const POTHOLE_SPAWN_INTERVAL = [0.9, 1.7];
  const AMBIENT_SPAWN_INTERVAL = [1.4, 2.6];
  const COMBO_SPAWN_INTERVAL = [11, 19];   // gap between 3-in-a-row clusters
  const COMBO_GAP = 150;                    // px between potholes in a cluster
  const BOSS_SPAWN_INTERVAL = [40, 65];     // gap between boss sinkholes
  const FIRST_BOSS_DELAY = 24;
  const COMBO_BONUS_STEP = 60;              // bonus per 3-perfect streak

  const RESOLVE_PAUSE = 0.35;  // brief pause after a successful fill
  const CRASH_PAUSE = 0.9;     // brief pause after a tailgater hit

  const LANE_CHANGE_TIME = 0.16; // seconds to glide between lanes

  const BEST_KEY = "hameysHighwayBest";
  const SEEN_INSTRUCTIONS_KEY = "hameysHighwaySeenInstructions";

  // ---------- State ----------
  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let cssW = 0, cssH = 0;
  let road = null;
  let laneXs = [];

  let state = "idle"; // idle | playing | gameover
  let score = 0;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let lives = LIVES_START;
  let distance = 0;
  let potholesFixed = 0;
  let perfectFills = 0;

  let scrollSpeed = BASE_SPEED;
  let potholes = [];
  let ambientVehicles = [];
  let potholeSpawnTimer = 0;
  let ambientSpawnTimer = 0;
  let comboSpawnTimer = 0;
  let bossSpawnTimer = 0;
  let bossActive = false;
  let comboStreak = 0;

  let player = null;
  let tailgater = null;
  let lastTs = 0;

  bestEl.textContent = best;

  // ---------- Setup / resize ----------
  function resize() {
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const roadWidth = Math.min(cssW * 0.82, 420);
    const roadLeft = (cssW - roadWidth) / 2;
    const topMargin = 90;
    const bottomMargin = 110;

    road = {
      left: roadLeft,
      right: roadLeft + roadWidth,
      width: roadWidth,
      top: topMargin,
      bottom: cssH - bottomMargin,
    };

    laneXs = [];
    for (let i = 0; i < LANE_COUNT; i++) {
      laneXs.push(road.left + road.width * ((i + 0.5) / LANE_COUNT));
    }

    if (player) {
      player.y = road.bottom - 90;
      player.x = laneXs[player.lane];
    }
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- Helpers ----------
  function rand(min, max) {
    return min + Math.random() * (max - min);
  }
  function randInt(min, max) {
    return Math.floor(rand(min, max + 1));
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // ---------- Player ----------
  function makePlayer() {
    const lane = 1;
    return {
      lane,
      fromX: laneXs[lane],
      x: laneXs[lane],
      y: road.bottom - 90,
      laneT: 1,
      status: "riding", // riding | stopped | resolving | crashed
      timer: 0,
      currentStopTimer: 4.5,
      currentFillTime: 1.0,
      holding: false,
      holdProgress: 0,
      engagedPothole: null,
      pauseTimer: 0,
      bob: 0,
      shake: 0,
    };
  }

  function changeLane(dir) {
    if (!player || state !== "playing") return;
    if (player.status !== "riding") return;
    const next = clamp(player.lane + dir, 0, LANE_COUNT - 1);
    if (next === player.lane) return;
    player.lane = next;
    player.fromX = player.x;
    player.laneT = 0;
  }

  // ---------- Entities ----------
  function pickWeightedKind() {
    const entries = [["gravel", POTHOLE_KINDS.gravel.weight], ["standard", POTHOLE_KINDS.standard.weight], ["crater", POTHOLE_KINDS.crater.weight]];
    const total = entries.reduce((s, e) => s + e[1], 0);
    let r = Math.random() * total;
    for (const [kind, w] of entries) {
      if (r < w) return kind;
      r -= w;
    }
    return "standard";
  }

  function makePothole(kind, lane, y) {
    const cfg = POTHOLE_KINDS[kind];
    return {
      kind,
      lane,
      x: laneXs[lane],
      y,
      radius: cfg.radius,
      state: "active", // active | engaged | fixed
      wobble: Math.random() * Math.PI * 2,
      hitsDone: 0,
    };
  }

  function spawnPothole(kind) {
    const lane = randInt(0, LANE_COUNT - 1);
    potholes.push(makePothole(kind || pickWeightedKind(), lane, road.top - 40));
  }

  function spawnCombo() {
    const lane = randInt(0, LANE_COUNT - 1);
    for (let i = 0; i < 3; i++) {
      potholes.push(makePothole("gravel", lane, road.top - 40 - i * COMBO_GAP));
    }
  }

  function spawnBoss() {
    const lane = randInt(0, LANE_COUNT - 1);
    potholes.push(makePothole("boss", lane, road.top - 60));
    bossActive = true;
  }

  function spawnAmbient() {
    const lane = randInt(0, LANE_COUNT - 1);
    const type = Math.random() < 0.5 ? "cat" : "car";
    ambientVehicles.push({
      type,
      lane,
      x: laneXs[lane],
      y: road.top - 40,
      state: "alive", // alive | crashing | dead
      crashT: 0,
      spinDir: Math.random() < 0.5 ? -1 : 1,
      speedMul: rand(0.85, 1.05),
    });
  }

  function spawnTailgater() {
    tailgater = {
      lane: player.lane,
      x: laneXs[player.lane],
      y: player.y + 240,
      startY: player.y + 240,
    };
  }

  // ---------- Repair flow ----------
  function beginRepair(pothole) {
    const cfg = POTHOLE_KINDS[pothole.kind];
    player.status = "stopped";
    player.currentFillTime = cfg.fillTime;
    player.currentStopTimer = cfg.stopTimer;
    player.timer = cfg.stopTimer;
    player.holding = false;
    player.holdProgress = 0;
    player.engagedPothole = pothole;
    pothole.state = "engaged";
    spawnTailgater();
    updateRepairBtn();
  }

  function resolveRepair(outcome) {
    const p = player.engagedPothole;
    const cfg = p ? POTHOLE_KINDS[p.kind] : POTHOLE_KINDS.standard;

    // Boss sinkholes need several successful hits before they're cleared.
    if (p && p.kind === "boss") {
      score += cfg.points[outcome];
      p.hitsDone++;
      if (p.hitsDone < cfg.requiresHits) {
        showFeedback(`HIT ${p.hitsDone}/${cfg.requiresHits}!`, outcome);
        player.holdProgress = 0;
        player.holding = false;
        player.timer = cfg.stopTimer; // fresh window for the next hit
        spawnTailgater();
        comboStreak = outcome === "perfect" ? comboStreak : 0;
        updateRepairBtn();
        updateHud();
        return; // stays "stopped", still engaged
      }
      score += cfg.finalBonus;
      bossActive = false;
      lives = Math.min(MAX_LIVES, lives + 1);
      showFeedback("BOSS CLEARED! +1 LIFE", "boss");
      p.state = "fixed";
      potholesFixed++;
      if (outcome === "perfect") perfectFills++;
      finishRepairPause();
      updateHud();
      return;
    }

    if (p) p.state = "fixed";
    potholesFixed++;

    let label = "";
    if (outcome === "perfect") {
      score += cfg.points.perfect;
      perfectFills++;
      comboStreak++;
      label = "PERFECT!";
      if (navigator.vibrate) navigator.vibrate(30);
      if (comboStreak > 0 && comboStreak % 3 === 0) {
        const bonus = COMBO_BONUS_STEP * (comboStreak / 3);
        score += bonus;
        showFeedback(`COMBO x${comboStreak}! +${bonus}`, "combo");
        finishRepairPause();
        updateHud();
        return;
      }
    } else if (outcome === "bumpy") {
      score += cfg.points.bumpy;
      comboStreak = 0;
      label = "Bumpy fill";
    } else {
      score += cfg.points.overfill;
      comboStreak = 0;
      label = "Overfilled...";
    }
    showFeedback(label, outcome);
    finishRepairPause();
    updateHud();
  }

  function finishRepairPause() {
    player.status = "resolving";
    player.pauseTimer = RESOLVE_PAUSE;
    player.engagedPothole = null;
    player.holding = false;
    tailgater = null;
    updateRepairBtn();
  }

  function failRepair() {
    lives--;
    comboStreak = 0;
    player.status = "crashed";
    player.pauseTimer = CRASH_PAUSE;
    player.shake = 1;
    if (player.engagedPothole) {
      player.engagedPothole.state = "fixed"; // hole gets paved over by the pile-up, but unrepaired
      if (player.engagedPothole.kind === "boss") bossActive = false;
    }
    player.engagedPothole = null;
    player.holding = false;
    tailgater = null;
    showFeedback("CRASH!", "crash");
    updateRepairBtn();
    updateHud();

    if (lives <= 0) {
      endGame();
    }
  }

  function showFeedback(text, cls) {
    feedbackEl.textContent = text;
    feedbackEl.className = cls;
    // force reflow so re-triggering the same class restarts animation
    void feedbackEl.offsetWidth;
    feedbackEl.classList.remove("hidden");
    clearTimeout(showFeedback._t);
    showFeedback._t = setTimeout(() => feedbackEl.classList.add("hidden"), 700);
  }

  function updateRepairBtn() {
    const ready = state === "playing" && player && player.status === "stopped";
    repairBtn.classList.toggle("ready", ready);
    repairBtn.classList.toggle("holding", !!(player && player.holding));
    repairBtn.textContent = ready ? (player.holding ? "HOLDING" : "HOLD!") : "RIDE";
  }

  // ---------- Update ----------
  function update(dt) {
    if (state !== "playing") return;

    if (player.status === "riding") {
      distance += scrollSpeed * dt * 0.06; // meters (arbitrary scale)
      scrollSpeed = clamp(BASE_SPEED + distance * SPEED_RAMP, BASE_SPEED, MAX_SPEED);
      score += scrollSpeed * dt * 0.02;

      // lane glide
      if (player.laneT < 1) {
        player.laneT = clamp(player.laneT + dt / LANE_CHANGE_TIME, 0, 1);
        player.x = lerp(player.fromX, laneXs[player.lane], player.laneT);
      }
      player.bob += dt;

      // spawn
      potholeSpawnTimer -= dt;
      if (potholeSpawnTimer <= 0) {
        spawnPothole();
        potholeSpawnTimer = rand(POTHOLE_SPAWN_INTERVAL[0], POTHOLE_SPAWN_INTERVAL[1]);
      }
      ambientSpawnTimer -= dt;
      if (ambientSpawnTimer <= 0) {
        spawnAmbient();
        ambientSpawnTimer = rand(AMBIENT_SPAWN_INTERVAL[0], AMBIENT_SPAWN_INTERVAL[1]);
      }
      comboSpawnTimer -= dt;
      if (comboSpawnTimer <= 0) {
        spawnCombo();
        comboSpawnTimer = rand(COMBO_SPAWN_INTERVAL[0], COMBO_SPAWN_INTERVAL[1]);
      }
      bossSpawnTimer -= dt;
      if (bossSpawnTimer <= 0 && !bossActive) {
        spawnBoss();
        bossSpawnTimer = rand(BOSS_SPAWN_INTERVAL[0], BOSS_SPAWN_INTERVAL[1]);
      }

      // move potholes
      for (const p of potholes) {
        p.wobble += dt;
        if (p.state === "active") p.y += scrollSpeed * dt;
      }

      // move ambient vehicles + collide with open potholes
      for (const v of ambientVehicles) {
        if (v.state === "alive") {
          v.y += scrollSpeed * dt * v.speedMul;
          for (const p of potholes) {
            if (p.state !== "active") continue;
            if (p.lane !== v.lane) continue;
            if (Math.abs(v.y - p.y) < p.radius * 0.75) {
              v.state = "crashing";
              v.crashT = 0;
              break;
            }
          }
        } else if (v.state === "crashing") {
          v.crashT += dt;
          v.x += (v.spinDir * 40) * dt;
          v.y -= 30 * dt;
          if (v.crashT >= 0.8) v.state = "dead";
        }
      }
      ambientVehicles = ambientVehicles.filter(v => v.state !== "dead" && v.y < road.bottom + 80);
      potholes = potholes.filter(p => p.state !== "active" || p.y < road.bottom + 60);

      // check auto-brake: pothole reaching player's lane/position
      for (const p of potholes) {
        if (p.state !== "active") continue;
        if (p.lane !== player.lane) continue;
        if (p.y >= player.y - 6) {
          beginRepair(p);
          break;
        }
      }
    } else if (player.status === "stopped") {
      player.timer -= dt;
      player.bob += dt;

      if (player.holding) {
        player.holdProgress += dt / player.currentFillTime;
        if (player.holdProgress >= GAUGE_CAP) {
          player.holdProgress = GAUGE_CAP;
          player.holding = false;
          resolveRepair("overfill");
        }
      }

      if (tailgater) {
        const t = clamp(1 - player.timer / player.currentStopTimer, 0, 1);
        tailgater.y = lerp(tailgater.startY, player.y + 6, t);
      }

      if (player.timer <= 0 && player.status === "stopped") {
        failRepair();
      }
    } else if (player.status === "resolving" || player.status === "crashed") {
      player.pauseTimer -= dt;
      player.shake = Math.max(0, player.shake - dt * 3);
      if (player.pauseTimer <= 0) {
        player.status = "riding";
        updateRepairBtn();
      }
    }

    updateHud();
  }

  function updateHud() {
    scoreEl.textContent = Math.floor(score);
    livesEl.textContent = "❤️".repeat(Math.max(0, lives)) + "🖤".repeat(Math.max(0, LIVES_START - lives));
  }

  // ---------- Draw ----------
  function draw() {
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = "#1c2b17";
    ctx.fillRect(0, 0, cssW, cssH);
    if (!road) return;

    const grad = ctx.createLinearGradient(0, road.top, 0, road.bottom);
    grad.addColorStop(0, "#4a4f57");
    grad.addColorStop(1, "#393d44");
    ctx.fillStyle = grad;
    ctx.fillRect(road.left, road.top, road.width, road.bottom - road.top);

    ctx.strokeStyle = "#f4f4f4";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(road.left + 4, road.top);
    ctx.lineTo(road.left + 4, road.bottom);
    ctx.moveTo(road.right - 4, road.top);
    ctx.lineTo(road.right - 4, road.bottom);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 224, 102, 0.85)";
    ctx.lineWidth = 3;
    ctx.setLineDash([20, 16]);
    for (let i = 1; i < LANE_COUNT; i++) {
      const x = road.left + (road.width * i) / LANE_COUNT;
      ctx.beginPath();
      ctx.moveTo(x, road.top);
      ctx.lineTo(x, road.bottom);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const p of potholes) drawPothole(p);
    for (const v of ambientVehicles) drawAmbientVehicle(v);
    if (tailgater && player && player.status === "stopped") drawTailgater();
    if (player) drawPlayer();
  }

  function drawPothole(p) {
    const bob = Math.sin(p.wobble * 2) * 1.5;
    const cfg = POTHOLE_KINDS[p.kind] || POTHOLE_KINDS.standard;
    if (p.state === "fixed") {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#6b6f76";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + bob, p.radius * 0.9, p.radius * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + bob, p.radius * 0.95, p.radius * 0.7, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#111214";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + bob, p.radius * 0.78, p.radius * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#050506";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + bob, p.radius * 1.05, p.radius * 0.78, 0, 0, Math.PI * 2);
    ctx.strokeStyle = p.state === "engaged" ? "rgba(255,255,255,0.7)" : cfg.ring;
    ctx.lineWidth = p.kind === "crater" || p.kind === "boss" ? 3.5 : 2;
    ctx.stroke();

    if (p.kind === "boss") {
      ctx.save();
      ctx.globalAlpha = 0.75 + Math.sin(p.wobble * 4) * 0.2;
      ctx.strokeStyle = cfg.ring;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + bob, p.radius * 1.25, p.radius * 0.95, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#ff8ffb";
      ctx.fillText("BOSS", p.x, p.y + bob - p.radius - 12);

      const pips = cfg.requiresHits;
      const done = p.hitsDone || 0;
      for (let i = 0; i < pips; i++) {
        const px = p.x - ((pips - 1) * 9) / 2 + i * 9;
        ctx.beginPath();
        ctx.arc(px, p.y + bob + p.radius + 12, 3, 0, Math.PI * 2);
        ctx.fillStyle = i < done ? "#ff8ffb" : "rgba(255,255,255,0.3)";
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawAmbientVehicle(v) {
    ctx.save();
    let alpha = 1;
    if (v.state === "crashing") alpha = clamp(1 - v.crashT / 0.8, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.translate(v.x, v.y);
    if (v.state === "crashing") ctx.rotate(v.spinDir * v.crashT * 8);
    if (v.type === "cat" && catBikerImg.complete && catBikerImg.naturalWidth) {
      ctx.drawImage(catBikerImg, -CAT_BIKER_W / 2, -CAT_BIKER_H / 2, CAT_BIKER_W, CAT_BIKER_H);
    } else {
      ctx.font = "26px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (v.type === "cat") {
        ctx.fillText("🏍️", 0, 2);
        ctx.font = "16px sans-serif";
        ctx.fillText("🐱", 2, -10);
      } else {
        ctx.fillText("🚗", 0, 0);
      }
    }
    if (v.state === "crashing") {
      ctx.font = "15px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("💥", 0, -CAT_BIKER_H / 2);
    }
    ctx.restore();
  }

  function drawTailgater() {
    ctx.save();
    ctx.translate(tailgater.x, tailgater.y);
    ctx.font = "26px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🚙", 0, 0);
    const urgency = clamp(1 - player.timer / player.currentStopTimer, 0, 1);
    if (urgency > 0.5) {
      ctx.globalAlpha = urgency;
      ctx.font = "16px sans-serif";
      ctx.fillText("‼️", 0, -22);
    }
    ctx.restore();
  }

  function drawPlayer() {
    const shakeX = player.shake > 0 ? Math.sin(player.bob * 60) * player.shake * 5 : 0;
    ctx.save();
    ctx.translate(player.x + shakeX, player.y + (player.status === "riding" ? Math.sin(player.bob * 10) * 1.5 : 0));
    ctx.font = "34px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🏍️", 0, 0);
    ctx.font = "20px sans-serif";
    ctx.fillText("🧑‍🔧", -2, -18);
    ctx.restore();

    // repair gauge ring
    if (player.status === "stopped") {
      const frac = clamp(player.holdProgress, 0, GAUGE_CAP) / GAUGE_CAP;
      const radius = 40;
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();

      // green zone marker
      ctx.strokeStyle = "rgba(81, 207, 102, 0.9)";
      ctx.beginPath();
      ctx.arc(0, 0, radius, -Math.PI / 2 + (GREEN_START / GAUGE_CAP) * Math.PI * 2, -Math.PI / 2 + (GREEN_END / GAUGE_CAP) * Math.PI * 2);
      ctx.stroke();

      // progress arc
      let color = "#ff6b6b";
      if (frac >= GREEN_START / GAUGE_CAP && frac <= GREEN_END / GAUGE_CAP) color = "#51cf66";
      else if (frac > GREEN_END / GAUGE_CAP) color = "#ff922b";
      ctx.strokeStyle = color;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(0, 0, radius, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();

      // countdown ring (timer left)
      const timerFrac = clamp(player.timer / player.currentStopTimer, 0, 1);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, radius + 10, -Math.PI / 2, -Math.PI / 2 + timerFrac * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------- Game flow ----------
  function resetGame() {
    score = 0;
    lives = LIVES_START;
    distance = 0;
    potholesFixed = 0;
    perfectFills = 0;
    scrollSpeed = BASE_SPEED;
    potholes = [];
    ambientVehicles = [];
    tailgater = null;
    potholeSpawnTimer = 0.6;
    ambientSpawnTimer = 1;
    comboSpawnTimer = rand(COMBO_SPAWN_INTERVAL[0], COMBO_SPAWN_INTERVAL[1]);
    bossSpawnTimer = FIRST_BOSS_DELAY;
    bossActive = false;
    comboStreak = 0;
    player = makePlayer();
    updateHud();
    updateRepairBtn();
  }

  function startGame() {
    resetGame();
    state = "playing";
    startScreen.classList.add("hidden");
    instructionsScreen.classList.add("hidden");
    endScreen.classList.add("hidden");
  }

  function handleStartClick() {
    if (localStorage.getItem(SEEN_INSTRUCTIONS_KEY)) {
      startGame();
    } else {
      startScreen.classList.add("hidden");
      instructionsScreen.classList.remove("hidden");
    }
  }

  function handlePlayClick() {
    localStorage.setItem(SEEN_INSTRUCTIONS_KEY, "1");
    startGame();
  }

  function endGame() {
    state = "gameover";
    if (score > best) {
      best = Math.floor(score);
      localStorage.setItem(BEST_KEY, String(best));
    }
    bestEl.textContent = best;
    endTitle.textContent = "Wiped Out";
    endSubtitle.textContent = "The highway traffic caught up with you.";
    endDistanceEl.textContent = `${Math.floor(distance)}m`;
    endFixedEl.textContent = potholesFixed;
    endPerfectEl.textContent = perfectFills;
    endScoreEl.textContent = Math.floor(score);
    endScreen.classList.remove("hidden");
    updateRepairBtn();
  }

  // ---------- Input ----------
  startBtn.addEventListener("click", handleStartClick);
  playBtn.addEventListener("click", handlePlayClick);
  retryBtn.addEventListener("click", startGame);

  leftBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); changeLane(-1); });
  rightBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); changeLane(1); });

  function pressRepair() {
    if (state !== "playing" || !player || player.status !== "stopped") return;
    player.holding = true;
    updateRepairBtn();
  }
  function releaseRepair() {
    if (state !== "playing" || !player || player.status !== "stopped" || !player.holding) return;
    player.holding = false;
    const frac = player.holdProgress;
    let outcome;
    if (frac < GREEN_START) outcome = "bumpy";
    else if (frac <= GREEN_END) outcome = "perfect";
    else outcome = "overfill";
    resolveRepair(outcome);
  }

  repairBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); pressRepair(); });
  repairBtn.addEventListener("pointerup", (e) => { e.preventDefault(); releaseRepair(); });
  repairBtn.addEventListener("pointerleave", () => releaseRepair());
  repairBtn.addEventListener("pointercancel", () => releaseRepair());

  // keyboard support
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") changeLane(-1);
    else if (e.key === "ArrowRight") changeLane(1);
    else if (e.code === "Space") { e.preventDefault(); pressRepair(); }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") releaseRepair();
  });

  // swipe support on canvas
  let touchStartX = null;
  canvas.addEventListener("pointerdown", (e) => { touchStartX = e.clientX; });
  canvas.addEventListener("pointerup", (e) => {
    if (touchStartX === null) return;
    const dx = e.clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(dx) > 40) changeLane(dx > 0 ? 1 : -1);
  });

  // ---------- Main loop ----------
  function frame(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    update(dt);
    draw();

    requestAnimationFrame(frame);
  }

  updateHud();
  requestAnimationFrame(frame);
})();

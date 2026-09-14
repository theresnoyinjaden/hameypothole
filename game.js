(() => {
  "use strict";

  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");

  const startScreen = document.getElementById("startScreen");
  const endScreen = document.getElementById("endScreen");
  const startBtn = document.getElementById("startBtn");
  const retryBtn = document.getElementById("retryBtn");
  const endTitle = document.getElementById("endTitle");
  const endSubtitle = document.getElementById("endSubtitle");
  const endFixedEl = document.getElementById("endFixed");
  const endCasualtiesEl = document.getElementById("endCasualties");
  const endScoreEl = document.getElementById("endScore");

  const timeLeftEl = document.getElementById("timeLeft");
  const fixedCountEl = document.getElementById("fixedCount");
  const scoreEl = document.getElementById("score");
  const casualtiesEl = document.getElementById("casualties");

  // ---------- Config ----------
  const LEVEL_TIME = 60; // seconds
  const TOTAL_POTHOLES = 12;
  const MAX_ACTIVE_POTHOLES = 5;
  const POTHOLE_SPAWN_INTERVAL = [1.1, 2.1]; // seconds, random range
  const POTHOLE_RADIUS = 22;
  const REPAIR_DURATION = 0.5; // seconds to fill a pothole once tapped

  const VEHICLE_SPAWN_INTERVAL = [0.9, 1.8];
  const VEHICLE_HIT_RADIUS = 20;
  const CRASH_DURATION = 0.8;

  // ---------- State ----------
  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let cssW = 0, cssH = 0;
  let road = null; // computed geometry

  let state = "idle"; // idle | playing | won | lost
  let timeLeft = LEVEL_TIME;
  let score = 0;
  let fixedCount = 0;
  let potholesSpawned = 0;
  let casualties = 0;

  let potholes = [];
  let vehicles = [];

  let potholeSpawnTimer = 0;
  let vehicleSpawnTimer = 0;
  let lastTs = 0;

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
    const topMargin = 96; // below HUD
    const bottomMargin = 40;

    road = {
      left: roadLeft,
      right: roadLeft + roadWidth,
      width: roadWidth,
      top: topMargin,
      bottom: cssH - bottomMargin,
      laneUpX: roadLeft + roadWidth * 0.28,   // northbound (moves up screen)
      laneDownX: roadLeft + roadWidth * 0.72, // southbound (moves down screen)
    };
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- Helpers ----------
  function rand(min, max) {
    return min + Math.random() * (max - min);
  }
  function choice(arr) {
    return arr[(Math.random() * arr.length) | 0];
  }
  function dist(x1, y1, x2, y2) {
    return Math.hypot(x1 - x2, y1 - y2);
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // ---------- Entities ----------
  function spawnPothole() {
    if (potholesSpawned >= TOTAL_POTHOLES) return;
    if (potholes.filter(p => p.state !== "fixed").length >= MAX_ACTIVE_POTHOLES) return;

    const lane = Math.random() < 0.5 ? road.laneUpX : road.laneDownX;
    const jitterX = rand(-road.width * 0.12, road.width * 0.12);
    const x = clamp(lane + jitterX, road.left + 30, road.right - 30);
    const y = rand(road.top + 60, road.bottom - 60);

    potholes.push({
      x, y,
      radius: POTHOLE_RADIUS,
      state: "active", // active | repairing | fixed
      repairProgress: 0,
      wobble: Math.random() * Math.PI * 2,
    });
    potholesSpawned++;
  }

  function spawnVehicle() {
    const goingUp = Math.random() < 0.5;
    const x = (goingUp ? road.laneUpX : road.laneDownX) + rand(-8, 8);
    const y = goingUp ? road.bottom + 30 : road.top - 30;
    const type = Math.random() < 0.55 ? "cat" : "car";

    vehicles.push({
      type,
      x, y,
      dir: goingUp ? -1 : 1,
      speed: rand(70, 110) * (type === "cat" ? 1.15 : 1),
      state: "alive", // alive | crashing | dead
      crashT: 0,
      rot: 0,
      wobblePhase: Math.random() * Math.PI * 2,
    });
  }

  function tryRepair(px, py) {
    if (state !== "playing") return;
    // pick the closest active/repairing pothole within tap tolerance
    let best = null, bestD = Infinity;
    for (const p of potholes) {
      if (p.state === "fixed") continue;
      const d = dist(px, py, p.x, p.y);
      if (d < p.radius + 18 && d < bestD) {
        best = p; bestD = d;
      }
    }
    if (best && best.state === "active") {
      best.state = "repairing";
      best.repairProgress = 0.001;
    }
  }

  function crashVehicle(v) {
    if (v.state !== "alive") return;
    v.state = "crashing";
    v.crashT = 0;
    v.spinDir = Math.random() < 0.5 ? -1 : 1;
    v.flyX = rand(-60, 60);
    casualties++;
    score = Math.max(0, score - 5);
    updateHud();
  }

  // ---------- Update ----------
  function update(dt) {
    if (state !== "playing") return;

    timeLeft -= dt;
    if (timeLeft <= 0) {
      timeLeft = 0;
      endGame(fixedCount >= TOTAL_POTHOLES);
      updateHud();
      return;
    }

    // spawn potholes
    potholeSpawnTimer -= dt;
    if (potholeSpawnTimer <= 0) {
      spawnPothole();
      potholeSpawnTimer = rand(POTHOLE_SPAWN_INTERVAL[0], POTHOLE_SPAWN_INTERVAL[1]);
    }

    // spawn vehicles
    vehicleSpawnTimer -= dt;
    if (vehicleSpawnTimer <= 0) {
      spawnVehicle();
      vehicleSpawnTimer = rand(VEHICLE_SPAWN_INTERVAL[0], VEHICLE_SPAWN_INTERVAL[1]);
    }

    // update potholes (repair fill)
    for (const p of potholes) {
      p.wobble += dt;
      if (p.state === "repairing") {
        p.repairProgress += dt / REPAIR_DURATION;
        if (p.repairProgress >= 1) {
          p.repairProgress = 1;
          p.state = "fixed";
          fixedCount++;
          score += 10;
          updateHud();
        }
      }
    }

    // update vehicles
    for (const v of vehicles) {
      if (v.state === "alive") {
        v.y += v.dir * v.speed * dt;
        v.x += Math.sin(v.wobblePhase + v.y * 0.01) * 6 * dt;

        // collision with open potholes
        for (const p of potholes) {
          if (p.state === "fixed") continue;
          if (dist(v.x, v.y, p.x, p.y) < p.radius * 0.85 + VEHICLE_HIT_RADIUS * 0.4) {
            crashVehicle(v);
            break;
          }
        }
      } else if (v.state === "crashing") {
        v.crashT += dt;
        const t = v.crashT / CRASH_DURATION;
        v.x += v.flyX * dt * 2;
        v.y += v.dir * -40 * dt; // pop backward/up a bit
        v.rot += v.spinDir * dt * 14;
        if (t >= 1) v.state = "dead";
      }
    }

    // cleanup offscreen / dead
    vehicles = vehicles.filter(v => {
      if (v.state === "dead") return false;
      if (v.y < road.top - 80 || v.y > road.bottom + 80) return false;
      return true;
    });

    // win check (all potholes spawned & fixed)
    if (potholesSpawned >= TOTAL_POTHOLES && fixedCount >= TOTAL_POTHOLES) {
      endGame(true);
    }

    updateHud();
  }

  function updateHud() {
    timeLeftEl.textContent = Math.ceil(timeLeft);
    fixedCountEl.textContent = `${fixedCount}/${TOTAL_POTHOLES}`;
    scoreEl.textContent = score;
    casualtiesEl.textContent = casualties;
  }

  // ---------- Draw ----------
  function draw() {
    ctx.clearRect(0, 0, cssW, cssH);

    // background outside the road
    ctx.fillStyle = "#1c2b17";
    ctx.fillRect(0, 0, cssW, cssH);

    if (!road) return;

    // road surface (asphalt)
    const grad = ctx.createLinearGradient(0, road.top, 0, road.bottom);
    grad.addColorStop(0, "#4a4f57");
    grad.addColorStop(1, "#393d44");
    ctx.fillStyle = grad;
    ctx.fillRect(road.left, road.top, road.width, road.bottom - road.top);

    // road edge lines
    ctx.strokeStyle = "#f4f4f4";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(road.left + 4, road.top);
    ctx.lineTo(road.left + 4, road.bottom);
    ctx.moveTo(road.right - 4, road.top);
    ctx.lineTo(road.right - 4, road.bottom);
    ctx.stroke();

    // lane divider (dashed, center)
    ctx.strokeStyle = "#ffe066";
    ctx.lineWidth = 3;
    ctx.setLineDash([22, 18]);
    ctx.beginPath();
    ctx.moveTo(road.left + road.width / 2, road.top);
    ctx.lineTo(road.left + road.width / 2, road.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // potholes
    for (const p of potholes) {
      drawPothole(p);
    }

    // vehicles (draw dead-alive order doesn't matter much)
    for (const v of vehicles) {
      drawVehicle(v);
    }
  }

  function drawPothole(p) {
    if (p.state === "fixed") {
      // faint patch mark
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#6b6f76";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.radius * 0.9, p.radius * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    const fillAmt = p.state === "repairing" ? p.repairProgress : 0;
    const bob = Math.sin(p.wobble * 2) * 1.5;

    // hole shadow/hole shape
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + bob, p.radius * 0.95, p.radius * 0.7, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#111214";
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(p.x, p.y + bob, p.radius * 0.78, p.radius * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#050506";
    ctx.fill();

    // asphalt fill animating in
    if (fillAmt > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + bob, p.radius * 0.78, p.radius * 0.55, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#7a7f87";
      const fillH = p.radius * 1.2 * fillAmt;
      ctx.fillRect(p.x - p.radius, p.y + bob + p.radius * 0.7 - fillH, p.radius * 2, fillH);
      ctx.restore();
    }

    // warning ring for still-open holes
    if (p.state === "active") {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + bob, p.radius * 1.05, p.radius * 0.78, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 212, 59, 0.55)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawVehicle(v) {
    ctx.save();
    let alpha = 1;
    if (v.state === "crashing") {
      alpha = clamp(1 - v.crashT / CRASH_DURATION, 0, 1);
    }
    ctx.globalAlpha = alpha;
    ctx.translate(v.x, v.y);
    const facingFlip = v.dir === -1 ? 1 : -1; // face direction of travel
    if (v.state === "crashing") {
      ctx.rotate(v.rot);
    } else {
      ctx.rotate(facingFlip * 0.06 * Math.PI);
    }

    ctx.font = "28px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (v.type === "cat") {
      ctx.fillText("🏍️", 0, 2);
      ctx.font = "18px sans-serif";
      ctx.fillText("🐱", 2, -12);
    } else {
      ctx.fillText("🚗", 0, 0);
    }

    if (v.state === "crashing") {
      ctx.font = "16px sans-serif";
      ctx.globalAlpha = alpha;
      ctx.fillText("💥", 0, -22);
    }

    ctx.restore();
  }

  // ---------- Game flow ----------
  function resetGame() {
    timeLeft = LEVEL_TIME;
    score = 0;
    fixedCount = 0;
    potholesSpawned = 0;
    casualties = 0;
    potholes = [];
    vehicles = [];
    potholeSpawnTimer = 0.2;
    vehicleSpawnTimer = 1;
    updateHud();
  }

  function startGame() {
    resetGame();
    state = "playing";
    startScreen.classList.add("hidden");
    endScreen.classList.add("hidden");
  }

  function endGame(won) {
    if (state !== "playing") return;
    state = won ? "won" : "lost";
    endTitle.textContent = won ? "Highway Cleared!" : "Time's Up!";
    endSubtitle.textContent = won
      ? "Every pothole patched. Traffic rides smooth again."
      : "The highway is still full of holes.";
    endFixedEl.textContent = `${fixedCount}/${TOTAL_POTHOLES}`;
    endCasualtiesEl.textContent = casualties;
    endScoreEl.textContent = score;
    endScreen.classList.remove("hidden");
  }

  // ---------- Input ----------
  function pointerToCanvas(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  canvas.addEventListener("pointerdown", (e) => {
    const { x, y } = pointerToCanvas(e.clientX, e.clientY);
    tryRepair(x, y);
  });

  startBtn.addEventListener("click", startGame);
  retryBtn.addEventListener("click", startGame);

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

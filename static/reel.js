/*
 * Mission Reel — Team Interstellar
 * Builds a short vertical video of the user's experience, entirely on the user's device.
 * Nothing is uploaded: the clips, the photo and the final video stay in the browser.
 *
 * How the 3D site uses it (3 calls):
 *
 *   const audioIn = Reel.attach(sceneCanvas, audioContext);
 *   masterGain.connect(audioIn);          // send the scene sounds + narration to the recorder too
 *
 *   Reel.captureMoment("dig");            // call on every interaction ("push", "dig", ...)
 *
 *   const reel = await Reel.build({ title, machine, fact, badge, photo, lang, character, onProgress });
 *   character = { id: "gamer" | "dreamer" | "teacher", name, image (loaded Image) }: its colour, pattern and picture
 *   await Reel.share(reel);               // share sheet on mobile, download on desktop
 *
 * Reel order: title → 3 moments → real fact → finale (helmet photo, badge if accepted, hashtags).
 * Narration must be an audio file played through the same AudioContext
 * (speechSynthesis cannot be recorded).
 */
(function () {
  "use strict";

  const W = 720, H = 1280;          // vertical 9:16
  const FPS = 30;
  const CLIP_MS = 3500;             // length of each captured moment
  const MAX_CLIPS = 6;              // clips kept in memory
  const CLIPS_IN_REEL = 3;
  const TITLE_MS = 2600, CLIP_SHOW_MS = 3300, FACT_MS = 3600, FINALE_MS = 4800;
  const C = {
    space: "#050A1A", night: "#0A1433", blue: "#0B3D91", red: "#FC3D21",
    rust: "#C2603A", rustDark: "#6E2A16", dust: "#F2C9A8", ink: "#F4F6FB", muted: "#B8C2DC"
  };
  const FONT_AR = '"Reem Kufi", "Segoe UI", Tahoma, Arial, sans-serif';
  const FONT_EN = '"Space Grotesk", "Segoe UI", Tahoma, Arial, sans-serif';
  const FONT_BODY = '"Segoe UI", Tahoma, Arial, sans-serif';

  const TEXT = {
    ar: { mission: "مهمتي", fact: "هل تعلم؟", moment: "لقطة", of: "من",
          engineer: "مهندس المهمة", engineerSub: "اختيرت فكرتي لتقرير الأفكار الموجّه لناسا",
          explorer: "مستكشف الفضاء", explorerSub: m => m ? `عشتُ قصة ${m}` : "عشتُ قصة آلة تركناها في الفضاء",
          team: "فريق إنترستيلر",
          actions: { push: "دفعتُ المركبة", dig: "حفرتُ بالمسبار" } },
    en: { mission: "My mission", fact: "Did you know?", moment: "Moment", of: "of",
          engineer: "MISSION ENGINEER", engineerSub: "My idea was chosen for the ideas report for NASA",
          explorer: "SPACE EXPLORER", explorerSub: m => m ? `I lived the story of ${m}` : "I lived the story of a machine we left in space",
          team: "Team Interstellar",
          actions: { push: "I pushed the rover", dig: "I dug with the probe" } }
  };
  // Each character gives the reel its own accent, pattern and closing line
  const THEMES = {
    gamer:   { accent: "#36C5F0", line: { ar: "المهمة اكتملت", en: "MISSION COMPLETE" } },
    dreamer: { accent: "#B98CFF", line: { ar: "الحلم صار مهمة", en: "THE DREAM BECAME A MISSION" } },
    teacher: { accent: "#8EE3A8", line: { ar: "درسٌ من الفضاء", en: "A LESSON FROM SPACE" } }
  };
  const BASE_TAGS = ["#SpaceApps", "#NASASpaceApps", "#AbandonedButNotForgotten", "#TeamInterstellar"];

  let sceneCanvas = null, audioCtx = null, mixDest = null, audioInput = null;
  let clips = [];
  let recording = null;   // promise of the clip being recorded now

  // ---------- helpers ----------
  function pickMime() {
    // H.264 MP4 first (what Instagram and TikTok accept), then WebM
    const options = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1,mp4a", "video/mp4;codecs=avc1",
      "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"
    ];
    if (!window.MediaRecorder) return null;
    return options.find(t => MediaRecorder.isTypeSupported(t)) || "";
  }

  function recordStream(stream, ms) {
    return new Promise((resolve, reject) => {
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4000000 } : {});
      const chunks = [];
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = e => reject(e.error || e);
      rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || "video/webm" }));
      rec.start(250);
      if (ms) setTimeout(() => rec.state !== "inactive" && rec.stop(), ms);
      recordStream.last = rec;
    });
  }

  const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;
  const ease = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
  const easeOutBack = t => { t = clamp01(t); const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

  function wrapText(g, text, maxWidth) {
    const words = String(text || "").split(/\s+/);
    const lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (g.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  // draws centered, wrapped text; returns its height
  function text(g, str, y, size, opt) {
    const o = Object.assign({ color: C.ink, weight: 700, max: W - 120, lang: "ar", font: null, lh: 1.35, align: "center", x: W / 2 }, opt);
    g.save();
    g.direction = o.lang === "ar" ? "rtl" : "ltr";
    g.font = `${o.weight} ${size}px ${o.font || (o.lang === "ar" ? FONT_AR : FONT_EN)}`;
    g.fillStyle = o.color;
    g.textAlign = o.align;
    g.textBaseline = "middle";
    const lines = wrapText(g, str, o.max);
    const lh = size * o.lh;
    lines.forEach((l, i) => g.fillText(l, o.x, y + (i - (lines.length - 1) / 2) * lh));
    g.restore();
    return lines.length * lh;
  }

  // deterministic star field
  const STARS = Array.from({ length: 160 }, (_, i) => {
    const r = Math.sin(i * 12.9898) * 43758.5453, r2 = Math.sin(i * 78.233) * 12345.678;
    return { x: (r - Math.floor(r)) * W, y: (r2 - Math.floor(r2)) * H, s: 0.6 + ((i * 7) % 10) / 6, p: i };
  });

  function drawSpace(g, t, drift) {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, C.space);
    grad.addColorStop(1, C.night);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    const dy = (drift || 0) * t / 1000;
    for (const s of STARS) {
      g.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t / 700 + s.p));
      g.fillStyle = C.ink;
      g.fillRect(s.x, (s.y + dy) % H, s.s, s.s);
    }
    g.globalAlpha = 1;
  }

  // a big Mars limb rising from the bottom
  function drawMarsLimb(g, rise) {
    const r = 900, cx = W / 2, cy = H + r - 260 * rise;
    const glow = g.createRadialGradient(cx, cy, r - 10, cx, cy, r + 90);
    glow.addColorStop(0, "rgba(252,61,33,.35)");
    glow.addColorStop(1, "rgba(252,61,33,0)");
    g.fillStyle = glow;
    g.beginPath(); g.arc(cx, cy, r + 90, 0, Math.PI * 2); g.fill();
    const body = g.createLinearGradient(0, cy - r, 0, cy - r + 300);
    body.addColorStop(0, "#D9774A");
    body.addColorStop(1, C.rustDark);
    g.fillStyle = body;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(90,30,15,.35)";
    [[-180, 40, 90, 18], [120, 90, 130, 22], [-40, 150, 70, 14], [230, 30, 60, 12]].forEach(([dx, dy, rx, ry]) => {
      g.beginPath(); g.ellipse(cx + dx, cy - r + dy, rx, ry, 0, 0, Math.PI * 2); g.fill();
    });
  }

  function drawOrbit(g, cx, cy, rx, ry, rot, progress, color, width) {
    g.save();
    g.translate(cx, cy); g.rotate(rot);
    g.strokeStyle = color; g.lineWidth = width; g.lineCap = "round";
    g.beginPath(); g.ellipse(0, 0, rx, ry, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp01(progress)); g.stroke();
    g.restore();
  }

  function drawCover(g, src, sw, sh, x, y, w, h) {
    const s = Math.max(w / sw, h / sh);
    const dw = sw * s, dh = sh * s;
    g.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function pill(g, label, x, y, lang, bg, fg, size) {
    size = size || 24;
    g.save();
    g.font = `700 ${size}px ${lang === "ar" ? FONT_AR : FONT_EN}`;
    g.direction = lang === "ar" ? "rtl" : "ltr";
    const w = g.measureText(label).width + size * 1.4, h = size * 1.9;
    g.fillStyle = bg; roundRect(g, x - w / 2, y - h / 2, w, h, h / 2); g.fill();
    g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(label, x, y + 1);
    g.restore();
  }

  function drawHelmet(g, photo, cx, cy, r, t) {
    g.save();
    g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = 50;
    const shell = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    shell.addColorStop(0, "#FFFFFF"); shell.addColorStop(1, "#C9D1E0");
    g.fillStyle = shell;
    g.beginPath(); g.arc(cx, cy, r * 1.24, 0, Math.PI * 2); g.fill();
    g.restore();
    // neck ring
    g.fillStyle = "#AEB7C8"; roundRect(g, cx - r * 0.95, cy + r * 1.1, r * 1.9, r * 0.32, 18); g.fill();
    g.fillStyle = C.red; g.fillRect(cx - r * 0.95, cy + r * 1.22, r * 1.9, 8);
    // visor
    g.save();
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
    if (photo) drawCover(g, photo, photo.width, photo.height, cx - r, cy - r, r * 2, r * 2);
    else {
      const v = g.createLinearGradient(0, cy - r, 0, cy + r);
      v.addColorStop(0, C.night); v.addColorStop(1, C.blue);
      g.fillStyle = v; g.fillRect(cx - r, cy - r, r * 2, r * 2);
      // Mars reflected in the visor
      g.fillStyle = C.rust; g.beginPath(); g.arc(cx + r * 0.25, cy + r * 1.15, r * 0.75, 0, Math.PI * 2); g.fill();
    }
    const refl = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    refl.addColorStop(0, "rgba(255,200,120,.38)"); refl.addColorStop(0.45, "rgba(255,200,120,0)"); refl.addColorStop(1, "rgba(80,120,255,.28)");
    g.fillStyle = refl; g.fillRect(cx - r, cy - r, r * 2, r * 2);
    g.globalAlpha = 0.28; g.fillStyle = "#fff";
    g.beginPath(); g.ellipse(cx - r * 0.45 + Math.sin(t / 900) * 8, cy - r * 0.52, r * 0.34, r * 0.13, -0.6, 0, Math.PI * 2); g.fill();
    g.restore();
    g.strokeStyle = "#5E6A80"; g.lineWidth = 12;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.fillStyle = C.red;
    g.beginPath(); g.arc(cx - r * 1.12, cy - r * 0.25, 11, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx + r * 1.12, cy - r * 0.25, 11, 0, Math.PI * 2); g.fill();
  }

  function drawPatch(g, cx, cy, r, rot) {
    g.save();
    g.translate(cx, cy); g.rotate(rot || 0);
    g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = 24;
    g.fillStyle = C.blue; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = C.ink; g.lineWidth = r * 0.07; g.beginPath(); g.arc(0, 0, r * 0.88, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#D9653B"; g.beginPath(); g.arc(0, 0, r * 0.32, 0, Math.PI * 2); g.fill();
    g.strokeStyle = C.red; g.lineWidth = r * 0.09;
    g.beginPath(); g.ellipse(0, 0, r * 0.72, r * 0.28, -0.45, 0, Math.PI * 2); g.stroke();
    g.fillStyle = C.ink; g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.07 : r * 0.17;
      g.lineTo(Math.cos(a) * rr + r * 0.5, Math.sin(a) * rr - r * 0.42);
    }
    g.closePath(); g.fill();
    g.restore();
  }

  function chime(dest, when) {
    // a short original chime made in code (no music licence needed)
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = audioCtx.createOscillator(), gn = audioCtx.createGain();
      o.type = "sine"; o.frequency.value = f;
      const s = when + i * 0.12;
      gn.gain.setValueAtTime(0, s);
      gn.gain.linearRampToValueAtTime(0.18, s + 0.02);
      gn.gain.exponentialRampToValueAtTime(0.001, s + 0.9);
      o.connect(gn); gn.connect(dest);
      o.start(s); o.stop(s + 1);
    });
  }

  function whoosh(dest, when) {
    const len = audioCtx.sampleRate * 0.6, buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len);
    const src = audioCtx.createBufferSource(); src.buffer = buf;
    const f = audioCtx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 0.8;
    f.frequency.setValueAtTime(300, when); f.frequency.exponentialRampToValueAtTime(2500, when + 0.6);
    const gn = audioCtx.createGain(); gn.gain.value = 0.25;
    src.connect(f); f.connect(gn); gn.connect(dest); src.start(when);
  }

  function chooseClips() {
    if (clips.length <= CLIPS_IN_REEL) return clips.slice();
    const idx = [0, Math.floor((clips.length - 1) / 2), clips.length - 1];
    return idx.map(i => clips[i]);
  }

  function loadVideo(blob) {
    return new Promise((resolve) => {
      const v = document.createElement("video");
      v.playsInline = true;
      v.preload = "auto";
      v.src = URL.createObjectURL(blob);
      const done = () => resolve(v);
      v.onloadeddata = done;
      v.onerror = done;
      setTimeout(done, 3000);
    });
  }

  function hashtags(o) {
    const tags = BASE_TAGS.slice();
    if (o.machineTag) tags.splice(1, 0, o.machineTag);
    return tags;
  }

  function theme(o) { return o.character && THEMES[o.character.id] ? THEMES[o.character.id] : null; }

  // the character's background pattern
  function drawMotif(g, o, t, alpha) {
    const th = theme(o); if (!th) return;
    g.save(); g.globalAlpha = alpha == null ? 1 : alpha;
    if (o.character.id === "gamer") {
      // a glowing game-world floor
      g.strokeStyle = th.accent; g.globalAlpha *= 0.28; g.lineWidth = 2;
      const hy = 760, vx = W / 2;
      for (let i = -8; i <= 8; i++) { g.beginPath(); g.moveTo(vx, hy); g.lineTo(vx + i * 140, H); g.stroke(); }
      const off = (t / 40) % 60;
      for (let k = 0; k < 9; k++) { const y = hy + Math.pow((k * 60 + off) / 540, 2) * (H - hy); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    } else if (o.character.id === "dreamer") {
      // constellations drawn between stars
      g.strokeStyle = th.accent; g.globalAlpha *= 0.45; g.lineWidth = 1.5;
      [[[90, 180], [170, 140], [250, 200], [330, 150]], [[460, 260], [540, 210], [610, 290], [560, 360]], [[120, 520], [200, 600], [150, 680]]]
        .forEach(c => { g.beginPath(); c.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
          c.forEach(([x, y]) => { g.fillStyle = th.accent; g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill(); }); });
    } else if (o.character.id === "teacher") {
      // chalk orbits with arrows
      g.strokeStyle = "#F4F6FB"; g.globalAlpha *= 0.22; g.lineWidth = 2.5; g.setLineDash([14, 12]); g.lineDashOffset = -t / 30;
      [[W / 2, 300, 300, 90, -0.3], [W / 2, 330, 220, 60, 0.4]].forEach(([cx, cy, rx, ry, r]) => { g.beginPath(); g.ellipse(cx, cy, rx, ry, r, 0, Math.PI * 2); g.stroke(); });
      g.setLineDash([]);
    }
    g.restore();
  }

  // the character's face in a circle (portrait images: crop the upper part)
  function drawAvatar(g, o, cx, cy, r) {
    const img = o.character && o.character.image; if (!img || !img.width) return;
    const th = theme(o);
    g.save();
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
    g.fillStyle = C.space; g.fillRect(cx - r, cy - r, r * 2, r * 2);
    const side = img.width * 0.72;
    g.drawImage(img, (img.width - side) / 2, img.height * 0.06, side, side, cx - r, cy - r, r * 2, r * 2);
    g.restore();
    g.strokeStyle = th ? th.accent : C.ink; g.lineWidth = 6;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  }

  // the character in a tall card (title scene)
  function drawPortrait(g, o, x, y, w, h, a) {
    const img = o.character && o.character.image; if (!img || !img.width) return false;
    const th = theme(o);
    g.save(); g.globalAlpha = a;
    roundRect(g, x, y, w, h, 28); g.clip();
    drawCover(g, img, img.width, img.height, x, y, w, h);
    const fade = g.createLinearGradient(0, y + h * 0.6, 0, y + h);
    fade.addColorStop(0, "rgba(5,10,26,0)"); fade.addColorStop(1, "rgba(5,10,26,.85)");
    g.fillStyle = fade; g.fillRect(x, y, w, h);
    g.restore();
    g.save(); g.globalAlpha = a;
    g.strokeStyle = th ? th.accent : C.ink; g.lineWidth = 4; roundRect(g, x, y, w, h, 28); g.stroke();
    g.restore();
    text(g, o.character.name, y + h - 34, 30, { lang: o.lang, weight: 700, color: C.ink });
    return true;
  }

  // ---------- scenes ----------
  function sceneTitle(g, o, L, local, t) {
    drawSpace(g, t, 6);
    drawMotif(g, o, t, ease(local / 600));
    drawMarsLimb(g, ease(local / 1400));
    const hasChar = !!(o.character && o.character.image && o.character.image.width);
    if (hasChar) drawPortrait(g, o, W / 2 - 150, 110 - 20 * (1 - ease(local / 600)), 300, 400, ease(local / 450));
    const a = ease(local / 500);
    g.globalAlpha = a;
    const th = theme(o);
    // with a character: label, name and line sit below its card, the ring only around the name
    const nameY = hasChar ? 690 : 470;
    drawOrbit(g, W / 2, nameY, hasChar ? 220 : 250, hasChar ? 70 : 92, -0.35, local / 1600, th ? th.accent : C.red, 8);
    pill(g, L.mission, W / 2, hasChar ? 552 : 330, o.lang, "rgba(252,61,33,.18)", "#FFB4A6", 26);
    g.globalAlpha = ease((local - 200) / 600);
    text(g, o.machine || o.title, nameY, hasChar ? 84 : 92, { lang: o.lang, weight: 700, max: W - 100 });
    g.globalAlpha = ease((local - 500) / 600);
    if (o.machine && o.title) text(g, o.title, hasChar ? 850 : 640, 32, { lang: o.lang, weight: 400, color: C.dust, max: W - 140, font: FONT_BODY, lh: 1.5 });
    g.globalAlpha = 1;
  }

  function sceneClip(g, o, L, seg, local, t, count) {
    const v = seg.video;
    drawSpace(g, t, 0);
    const fx = 40, fy = 250, fw = W - 80, fh = 760;
    if (v && v.videoWidth) {
      g.save();
      g.filter = "blur(26px) brightness(.45)";
      drawCover(g, v, v.videoWidth, v.videoHeight, -60, -60, W + 120, H + 120);
      g.restore();
      g.save();
      roundRect(g, fx, fy, fw, fh, 36); g.clip();
      // slow push-in
      const z = 1 + 0.06 * (local / seg.ms);
      const zw = fw * z, zh = fh * z;
      drawCover(g, v, v.videoWidth, v.videoHeight, fx - (zw - fw) / 2, fy - (zh - fh) / 2, zw, zh);
      g.restore();
    }
    g.strokeStyle = "rgba(244,246,251,.25)"; g.lineWidth = 3;
    roundRect(g, fx, fy, fw, fh, 36); g.stroke();
    const th = theme(o);
    if (th) {
      g.strokeStyle = th.accent; g.lineWidth = 7; g.lineCap = "round";
      const k = 56, m = 18;
      [[fx + m, fy + m, 1, 1], [fx + fw - m, fy + m, -1, 1], [fx + m, fy + fh - m, 1, -1], [fx + fw - m, fy + fh - m, -1, -1]].forEach(([x, y, sx, sy]) => {
        g.beginPath(); g.moveTo(x, y + sy * k); g.lineTo(x, y); g.lineTo(x + sx * k, y); g.stroke(); });
      drawAvatar(g, o, fx + fw - 70, fy + fh - 70, 44);
    }
    // top: machine name + moment counter
    text(g, o.machine || o.title, 150, 40, { lang: o.lang, weight: 700, max: W - 120 });
    const counter = o.lang === "ar" ? `${L.moment} ${seg.i + 1} ${L.of} ${count}` : `${L.moment} ${seg.i + 1} ${L.of} ${count}`;
    text(g, counter, 205, 24, { lang: o.lang, weight: 600, color: C.muted, font: FONT_BODY });
    // progress ticks
    for (let k = 0; k < count; k++) {
      const w = 60, gap = 12, x0 = W / 2 - (count * w + (count - 1) * gap) / 2 + k * (w + gap);
      g.fillStyle = k < seg.i ? C.red : k === seg.i ? "rgba(252,61,33,.35)" : "rgba(244,246,251,.2)";
      roundRect(g, x0, 1055, w, 8, 4); g.fill();
      if (k === seg.i) { g.fillStyle = C.red; roundRect(g, x0, 1055, w * clamp01(local / seg.ms), 8, 4); g.fill(); }
    }
    const act = L.actions[seg.label];
    if (act) {
      g.globalAlpha = ease((local - 300) / 400);
      pill(g, act, W / 2, 1130, o.lang, C.ink, C.night, 28);
      g.globalAlpha = 1;
    }
    g.fillStyle = "rgba(0,0,0," + (1 - ease(local / 350)) + ")";
    g.fillRect(0, 0, W, H);
  }

  function sceneFact(g, o, L, local, t) {
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "#8E3A1E"); grad.addColorStop(1, "#3A1409");
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.12;
    for (let i = 0; i < 9; i++) { g.fillStyle = "#000"; g.beginPath(); g.arc((i * 173) % W, (i * 311) % H, 40 + (i * 23) % 70, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
    const a = ease(local / 450);
    g.globalAlpha = a;
    text(g, "?", 330, 200, { lang: "en", weight: 700, color: "rgba(255,255,255,.10)" });
    pill(g, L.fact, W / 2, 380, o.lang, C.ink, "#6E2A16", 30);
    g.globalAlpha = ease((local - 250) / 600);
    text(g, o.fact, 650, 44, { lang: o.lang, weight: o.lang === "ar" ? 500 : 600, max: W - 130, lh: 1.5 });
    g.fillStyle = C.red; g.fillRect(W / 2 - 50, 900, 100 * ease((local - 600) / 600), 6);
    g.globalAlpha = 1;
  }

  function sceneFinale(g, o, L, local, t, tags) {
    drawSpace(g, t, 4);
    drawMotif(g, o, t, 1);
    drawMarsLimb(g, 0.6);
    const pop = easeOutBack(local / 700);
    const hy = 520;
    g.save();
    g.translate(W / 2, hy); g.scale(0.7 + 0.3 * pop, 0.7 + 0.3 * pop); g.translate(-W / 2, -hy);
    g.globalAlpha = clamp01(local / 300);
    drawHelmet(g, o.photo, W / 2, hy, 200, t);
    g.restore();
    if (o.badge) {
      const bp = easeOutBack((local - 700) / 600);
      if (bp > 0) drawPatch(g, W / 2 + 205, hy + 150, 92 * bp, -0.2 + 0.2 * bp);
    }
    const ap = easeOutBack((local - 350) / 600);
    if (ap > 0) drawAvatar(g, o, W / 2 - 215, hy - 175, 70 * ap);
    const th = theme(o);
    g.globalAlpha = ease((local - 500) / 500);
    const headline = o.badge ? L.engineer : th ? th.line[o.lang] : L.explorer;
    text(g, headline, 905, o.lang === "ar" ? 56 : 48, { lang: o.lang, weight: 700, color: !o.badge && th ? th.accent : C.ink, max: W - 80 });
    text(g, o.badge ? L.engineerSub : L.explorerSub(o.machine), 985, 28, { lang: o.lang, weight: 400, color: C.dust, font: FONT_BODY, max: W - 140 });
    g.globalAlpha = ease((local - 1100) / 500);
    // hashtags, two lines, left-to-right
    const half = Math.ceil(tags.length / 2);
    text(g, tags.slice(0, half).join("  "), 1105, 26, { lang: "en", weight: 600, color: "#FFB4A6", font: FONT_EN, max: W - 60 });
    text(g, tags.slice(half).join("  "), 1150, 26, { lang: "en", weight: 600, color: "#FFB4A6", font: FONT_EN, max: W - 60 });
    text(g, L.team, 1225, 22, { lang: o.lang, weight: 600, color: C.muted, font: FONT_BODY });
    g.globalAlpha = 1;
  }

  // ---------- public API ----------
  function attach(canvas, audioContext) {
    sceneCanvas = canvas;
    audioCtx = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    mixDest = audioCtx.createMediaStreamDestination();
    audioInput = audioCtx.createGain();
    audioInput.connect(mixDest);
    return audioInput;
  }

  function captureMoment(label) {
    if (!sceneCanvas || recording) return false;
    if (pickMime() === null || !sceneCanvas.captureStream) return false;
    const video = sceneCanvas.captureStream(FPS);
    const stream = new MediaStream([...video.getVideoTracks(), ...mixDest.stream.getAudioTracks()]);
    recording = recordStream(stream, CLIP_MS)
      .then(blob => {
        clips.push({ blob, label: label || "", time: Date.now() });
        if (clips.length > MAX_CLIPS) clips.splice(1, 1);   // always keep the first moment
      })
      .catch(err => console.warn("Reel: clip failed", err))
      .finally(() => { video.getVideoTracks().forEach(t => t.stop()); recording = null; });
    return true;
  }

  async function loadPhoto(file) {
    if (!file) return null;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  }

  /** Draw the finale frame on a canvas you give (for a poster / preview before building). */
  function drawPoster(canvas, opts) {
    const o = Object.assign({ title: "", machine: "", badge: false, photo: null, lang: "ar", machineTag: "", character: null }, opts || {});
    o.lang = o.lang === "en" ? "en" : "ar";
    canvas.width = W; canvas.height = H;
    sceneFinale(canvas.getContext("2d"), o, TEXT[o.lang], 5000, 0, hashtags(o));
  }

  /**
   * Build the reel.
   * opts: { title, machine (short name, e.g. "إنسايت"), machineTag (e.g. "#InSight"), fact,
   *         badge (true only if decision === "send_to_nasa"), photo (Image or null),
   *         lang ("ar" | "en"), onProgress(0..1) }
   * returns { blob, url, mimeType, extension, caption }
   */
  async function build(opts) {
    const o = Object.assign({ title: "", machine: "", machineTag: "", fact: "", badge: false, photo: null, lang: "ar", character: null }, opts || {});
    o.lang = o.lang === "en" ? "en" : "ar";
    const L = TEXT[o.lang];
    const tags = hashtags(o);
    if (!audioCtx) attach(null);
    if (audioCtx.state === "suspended") await audioCtx.resume();
    if (recording) await recording;
    if (pickMime() === null) throw new Error("This browser cannot record video.");
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* use fallback fonts */ } }

    const chosen = chooseClips();
    const videos = await Promise.all(chosen.map(c => loadVideo(c.blob)));

    const out = document.createElement("canvas");
    out.width = W; out.height = H;
    const g = out.getContext("2d");
    const dest = audioCtx.createMediaStreamDestination();
    const sources = videos.map(v => { const s = audioCtx.createMediaElementSource(v); s.connect(dest); return s; });

    // timeline
    const segs = [{ type: "title", ms: TITLE_MS }];
    videos.forEach((v, i) => segs.push({ type: "clip", ms: CLIP_SHOW_MS, video: v, i, label: chosen[i].label }));
    if (o.fact) segs.push({ type: "fact", ms: FACT_MS });
    segs.push({ type: "finale", ms: FINALE_MS });
    const total = segs.reduce((a, s) => a + s.ms, 0);

    drawSpace(g, 0, 0);
    const stream = new MediaStream([...out.captureStream(FPS).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const done = recordStream(stream, 0);
    const rec = recordStream.last;
    whoosh(dest, audioCtx.currentTime + 0.05);

    const start = performance.now();
    let segIndex = -1, segStart = 0;
    await new Promise(resolve => {
      function frame() {
        const now = performance.now() - start;
        if (o.onProgress) o.onProgress(Math.min(1, now / total));
        if (now >= total) { resolve(); return; }
        let acc = 0, idx = 0;
        for (; idx < segs.length; idx++) { if (now < acc + segs[idx].ms) break; acc += segs[idx].ms; }
        const seg = segs[idx];
        if (idx !== segIndex) {
          if (segIndex >= 0 && segs[segIndex].video) segs[segIndex].video.pause();
          segIndex = idx; segStart = acc;
          if (seg.video) { seg.video.currentTime = 0; seg.video.play().catch(() => {}); }
          if (seg.type === "fact" || seg.type === "finale") whoosh(dest, audioCtx.currentTime + 0.02);
          if (seg.type === "finale" && o.badge) chime(dest, audioCtx.currentTime + 0.75);
        }
        const local = now - segStart;
        if (seg.type === "title") sceneTitle(g, o, L, local, now);
        else if (seg.type === "clip") sceneClip(g, o, L, seg, local, now, videos.length);
        else if (seg.type === "fact") sceneFact(g, o, L, local, now);
        else sceneFinale(g, o, L, local, now, tags);
        // quick fade between scenes
        const out_ = 1 - ease((seg.ms - local) / 250);
        if (out_ > 0 && idx < segs.length - 1) { g.fillStyle = `rgba(5,10,26,${out_})`; g.fillRect(0, 0, W, H); }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });

    if (rec.state !== "inactive") rec.stop();
    const blob = await done;
    stream.getTracks().forEach(tr => tr.stop());
    sources.forEach(s => s.disconnect());
    videos.forEach(v => { v.pause(); URL.revokeObjectURL(v.src); });
    const mimeType = blob.type || "video/webm";
    const caption = (o.badge ? L.engineerSub : L.explorerSub(o.machine)) + "\n" + tags.join(" ");
    return { blob, url: URL.createObjectURL(blob), mimeType, extension: mimeType.includes("mp4") ? "mp4" : "webm", caption, hashtags: tags };
  }

  async function share(reel, name) {
    const fileName = (name || "mission-reel") + "." + reel.extension;
    const file = new File([reel.blob], fileName, { type: reel.mimeType });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: reel.caption || "" }); return "shared"; }
      catch (e) { if (e.name === "AbortError") return "cancelled"; }
    }
    const a = document.createElement("a");
    a.href = reel.url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    return "downloaded";
  }

  function reset() { clips = []; }

  window.Reel = {
    attach, captureMoment, loadPhoto, build, share, reset, drawPoster,
    hashtags: (opts) => hashtags(opts || {}),
    get clipCount() { return clips.length; },
    get isRecording() { return !!recording; },
    get canRecord() { return pickMime() !== null; }
  };
})();

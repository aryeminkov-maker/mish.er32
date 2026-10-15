// ===== מנוע עיצוב: מודעות ורקעי זום (Canvas) + עורך עם גרירה ושינוי גודל =====
// עיצוב = { size:{w,h}, bgColor, bgImage, elements:[...] }
// אלמנט: { id, type:"text"|"image"|"rect"|"qr", x, y, w, h, showIf?, ... }
//   text:  text (עם משתנים {שם}), size, weight, color, align, font, lh
//   image: src ("logo", נתיב לקובץ באתר, או תמונה מקודדת)
//   rect:  fill, opacity, radius
//   qr:    data (בדרך כלל {קישור מלא}), color – ריבוע (h = w)
//   showIf: שם משתנה – האלמנט מוצג רק אם יש בו ערך (למשל תיבת המלגה)

export const FONTS = [["Heebo", "היבו"], ["Rubik", "רוביק (כותרות כבדות)"], ["Frank Ruhl Libre", "פרנק רוהל (קלאסי)"], ["Assistant", "אסיסטנט"]];
export const WEIGHTS = [[300, "דק"], [400, "רגיל"], [500, "בינוני"], [700, "מודגש"], [800, "עבה"], [900, "שחור"]];
const GOLD = "#c19937", INK = "#1c1b19";
let seq = 0;
const nid = () => "e" + Date.now().toString(36) + (seq++);
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- תבניות ברירת מחדל (לפי הפלאייר ורקע הזום של המכון) ----------
const NAVY = "#234a7c", SAND = "#d6b371", BLACK = "#111111";
export function defaultAd() {
  const T = (o) => ({ type: "text", align: "right", color: BLACK, font: "Rubik", weight: 900, ...o });
  return {
    size: { w: 1414, h: 2000 }, bgColor: "#ececec", bgImage: "img/tpl-flyer.jpg",
    elements: [
      { id: "mojPill", type: "rect", x: -120, y: 106, w: 638, h: 172, fill: NAVY, radius: 86 },
      { id: "moj", type: "image", src: "img/tpl-moj.png", x: 70, y: 159, w: 356, h: 79 },
      { id: "logo", type: "image", src: "logo", x: 888, y: 150, w: 500, h: 171 },
      { id: "banner", type: "rect", x: 178, y: 358, w: 1300, h: 80, fill: SAND, radius: 40 },
      T({ id: "bannerText", text: "השתלמות ייחודית של מכון משפטי ארץ ומשרד המשפטים:", x: 200, y: 371, w: 1180, size: 42, weight: 800 }),
      T({ id: "title", text: "{שם ההשתלמות}", x: 90, y: 482, w: 1235, size: 80, lh: 1.15 }),
      { id: "infoBox", type: "rect", x: 381, y: 675, w: 1100, h: 306, fill: NAVY, radius: 26 },
      T({ id: "info", text: "תכנית כוללת {מספר מפגשים במילים} בזום בימי {ימים} {חלק היום}\nבין השעות {שעות}\nבתאריכים {תאריכים מלאים}", x: 415, y: 702, w: 915, size: 40, weight: 800, color: "#ffffff", lh: 1.6 }),
      T({ id: "topicsHead", text: "בין הנושאים", x: 880, y: 1032, w: 445, size: 50, showIf: "רשימת נושאים" }),
      T({ id: "topics", text: "{רשימת נושאים}", x: 700, y: 1092, w: 680, size: 33, font: "Heebo", weight: 400, lh: 1.55 }),
      T({ id: "lecHead", text: "בין המרצים", x: 960, y: 1505, w: 345, size: 50, showIf: "רשימת מרצים" }),
      T({ id: "lecturers", text: "{רשימת מרצים}", x: 940, y: 1580, w: 420, size: 33, font: "Heebo", weight: 400, lh: 1.55 }),
      { id: "schBox", type: "rect", x: 142, y: 1492, w: 748, h: 224, fill: SAND, showIf: "מלגה" },
      T({ id: "sch", text: "{מלגה}", x: 172, y: 1514, w: 688, size: 36, font: "Heebo", weight: 400, align: "center", lh: 1.6 }),
      { id: "qr", type: "qr", data: "{קישור מלא}", x: 152, y: 1750, w: 186, h: 186, color: BLACK },
      T({ id: "cta", text: "מהרו להרשם:", x: 352, y: 1786, w: 385, size: 56 }),
      T({ id: "ctaSub", text: "מספר המקומות מוגבל", x: 352, y: 1856, w: 385, size: 30, weight: 800 })
    ]
  };
}

export function defaultBg() {
  return {
    size: { w: 1920, h: 1080 }, bgColor: "#61cbf3", bgImage: "img/tpl-zoom.jpg",
    elements: [
      { id: "topic", type: "text", text: "{נושא ההרצאה}", x: 390, y: 92, w: 1040, size: 76, weight: 700, color: GOLD, align: "center", lh: 1.13 },
      { id: "name", type: "text", text: "{שם המרצה}", x: 150, y: 262, w: 660, size: 50, weight: 300, color: GOLD, align: "center" }
    ]
  };
}

// ---------- משתנים ----------
// שורה שכל המשתנים בה ריקים (ונשאר בה רק פיסוק) – נמחקת
export function applyVars(text, vars) {
  return String(text || "").split("\n").map((line) => {
    let hadEmpty = false;
    const out = line.replace(/\{([^{}]+)\}/g, (m, k) => {
      if (Object.prototype.hasOwnProperty.call(vars, k)) { if (!vars[k]) hadEmpty = true; return vars[k] || ""; }
      return m;
    });
    const clean = out.replace(/^[\s·,\-–:|]+|[\s·,\-–:|]+$/g, "");
    return hadEmpty && !clean ? null : (hadEmpty ? clean : out);
  }).filter((l) => l !== null).join("\n");
}

// ---------- תמונות וגופנים ----------
const imgCache = new Map();
export function loadImg(src) {
  if (!src) return Promise.resolve(null);
  if (!imgCache.has(src)) {
    imgCache.set(src, new Promise((res) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = () => res(null);
      i.src = src === "logo" ? "img/logo.png" : src === "logo-light" ? "img/logo-light.png" : src;
    }));
  }
  return imgCache.get(src);
}
// ספריית QR – נטענת רק כשצריך
let qrLib = null;
function loadQrLib() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!qrLib) qrLib = new Promise((res) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
    s.onload = () => res(window.qrcode || null); s.onerror = () => { qrLib = null; res(null); };
    document.head.appendChild(s);
  });
  return qrLib;
}
async function preload(design) {
  const imgs = new Map();
  if (design.elements.some((e) => e.type === "qr")) await loadQrLib();
  const srcs = [design.bgImage, ...design.elements.filter((e) => e.type === "image").map((e) => e.src)].filter(Boolean);
  await Promise.all(srcs.map(async (s) => imgs.set(s, await loadImg(s))));
  const fonts = new Set(design.elements.filter((e) => e.type === "text").map((e) => `${e.weight || 400} 40px "${e.font || "Heebo"}"`));
  try { await Promise.all([...fonts].map((f) => document.fonts.load(f, "אבג"))); } catch { /* */ }
  return imgs;
}

// ---------- ציור ----------
const fontOf = (e) => `${e.weight || 400} ${e.size}px "${e.font || "Heebo"}", "Heebo", Arial, sans-serif`;
function wrap(g, text, maxW) {
  const out = [];
  String(text).split("\n").forEach((para) => {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); return; }
    let line = "";
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (g.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  });
  return out;
}
function roundRect(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function drawFit(g, im, x, y, w, h, cover) {
  const r = cover ? Math.max(w / im.width, h / im.height) : Math.min(w / im.width, h / im.height);
  const dw = im.width * r, dh = im.height * r;
  if (cover) { g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); }
  g.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  if (cover) g.restore();
}

// מצייר את העיצוב ומחזיר את גבולות כל אלמנט (לעורך)
function drawQr(g, e, data) {
  const q = window.qrcode;
  const s = e.w;
  if (!q || !data) {
    g.save(); g.strokeStyle = e.color || INK; g.lineWidth = 3; g.setLineDash([10, 8]); g.strokeRect(e.x, e.y, s, s);
    g.fillStyle = e.color || INK; g.font = `700 ${Math.round(s / 5)}px Heebo, Arial`; g.textAlign = "center"; g.textBaseline = "middle"; g.direction = "ltr";
    g.fillText("QR", e.x + s / 2, e.y + s / 2); g.restore(); return;
  }
  try {
    if (q.stringToBytesFuncs?.["UTF-8"]) q.stringToBytes = q.stringToBytesFuncs["UTF-8"];
    const qr = q(0, "M"); qr.addData(data); qr.make();
    const n = qr.getModuleCount(), c = s / n;
    if (e.bg) { g.fillStyle = e.bg; g.fillRect(e.x, e.y, s, s); }
    g.fillStyle = e.color || INK;
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
      if (qr.isDark(r, k)) g.fillRect(Math.floor(e.x + k * c), Math.floor(e.y + r * c), Math.ceil(c), Math.ceil(c));
    }
  } catch { /* קישור ארוך מדי */ }
}

// opts.editor: אלמנטים מוסתרים (showIf ריק) מוצגים שקופים, כדי שאפשר יהיה לערוך אותם
export function draw(cv, design, vars, imgs, opts = {}) {
  const { w: W, h: H } = design.size;
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  const g = cv.getContext("2d");
  g.clearRect(0, 0, W, H);
  g.fillStyle = design.bgColor || "#ffffff"; g.fillRect(0, 0, W, H);
  const bg = design.bgImage && imgs.get(design.bgImage);
  if (bg) drawFit(g, bg, 0, 0, W, H, true);
  const boxes = {};
  for (const e of design.elements) {
    const hidden = e.showIf && !vars[e.showIf];
    if (hidden && !opts.editor) continue;
    g.globalAlpha = hidden ? 0.25 : 1;
    if (e.type === "qr") {
      drawQr(g, e, applyVars(e.data || "", vars).trim());
      boxes[e.id] = { x: e.x, y: e.y, w: e.w, h: e.w };
    } else if (e.type === "rect") {
      g.globalAlpha = (e.opacity ?? 1) * (hidden ? 0.25 : 1); g.fillStyle = e.fill || INK;
      roundRect(g, e.x, e.y, e.w, e.h, e.radius); g.fill();
      boxes[e.id] = { x: e.x, y: e.y, w: e.w, h: e.h };
    } else if (e.type === "image") {
      const im = imgs.get(e.src);
      if (im) drawFit(g, im, e.x, e.y, e.w, e.h, false);
      boxes[e.id] = { x: e.x, y: e.y, w: e.w, h: e.h };
    } else {
      g.font = fontOf(e); g.fillStyle = e.color || INK; g.textBaseline = "top";
      const lh = e.size * (e.lh || 1.25);
      const lines = wrap(g, applyVars(e.text, vars), e.w);
      lines.forEach((l, i) => {
        // שורה בלי עברית (כמו קישור) נכתבת משמאל לימין
        g.direction = /[֐-׿]/.test(l) ? "rtl" : "ltr";
        const al = e.align || "center";
        g.textAlign = al;
        const ax = al === "center" ? e.x + e.w / 2 : al === "left" ? e.x : e.x + e.w;
        g.fillText(l, ax, e.y + i * lh + (lh - e.size) / 2);
      });
      boxes[e.id] = { x: e.x, y: e.y, w: e.w, h: Math.max(lh, lines.length * lh) };
    }
    g.globalAlpha = 1;
  }
  g.direction = "rtl";
  return boxes;
}

// הורדה כקובץ PNG
export async function exportPng(design, vars, filename) {
  const imgs = await preload(design);
  const cv = document.createElement("canvas");
  draw(cv, design, vars, imgs);
  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

// תמונה קטנה לתצוגה מקדימה
export async function thumbnail(design, vars, width = 320) {
  const imgs = await preload(design);
  const cv = document.createElement("canvas");
  draw(cv, design, vars, imgs);
  const t = document.createElement("canvas");
  t.width = width; t.height = Math.round(width * design.size.h / design.size.w);
  t.getContext("2d").drawImage(cv, 0, 0, t.width, t.height);
  return t.toDataURL("image/png");
}

// ---------- הקטנת תמונה שהועלתה (כדי שתיכנס למסד הנתונים) ----------
export async function shrinkImage(file, { w, h, cover, maxBytes = 550000 }) {
  const src = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  let cw, ch;
  if (cover) { cw = w; ch = h; }
  else { const r = Math.min(1, w / im.width, h / im.height); cw = Math.round(im.width * r); ch = Math.round(im.height * r); }
  const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
  const g = cv.getContext("2d");
  if (cover) drawFit(g, im, 0, 0, cw, ch, true); else g.drawImage(im, 0, 0, cw, ch);
  // PNG שומר על שקיפות (לוגו); אם גדול מדי – JPEG
  if (!cover && /png|gif|webp/.test(file.type)) {
    const png = cv.toDataURL("image/png");
    if (png.length < maxBytes) return { data: png, w: cw, h: ch };
    const g2 = cv.getContext("2d"); g2.globalCompositeOperation = "destination-over"; g2.fillStyle = "#fff"; g2.fillRect(0, 0, cw, ch);
  }
  for (const q of [0.88, 0.8, 0.7, 0.6, 0.5, 0.4]) {
    const jpg = cv.toDataURL("image/jpeg", q);
    if (jpg.length < maxBytes) return { data: jpg, w: cw, h: ch };
  }
  throw new Error("התמונה גדולה מדי");
}

// ======================================================
// עורך
// ======================================================
// opts: { title, design, defaultDesign, vars, varNames, onSave(design), onSaveTemplate?(design), filename }
export function openDesigner(c, opts) {
  let d = clone(opts.design);
  let sel = null, imgs = new Map(), boxes = {};
  const { w: W, h: H } = d.size;
  const dispW = Math.min(W > H ? 660 : 470, window.innerWidth - 60);
  const scale = dispW / W, dispH = Math.round(H * scale);
  const esc = c.esc;

  c.openModal(`
    <div class="head"><h2>${esc(opts.title || "עורך עיצוב")}</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    <div class="designer">
      <div class="ds-stage-wrap">
        <div class="ds-stage" id="dsStage" style="width:${dispW}px;height:${dispH}px">
          <canvas id="dsCanvas" style="width:${dispW}px;height:${dispH}px"></canvas>
          <div class="ds-guide" id="dsGuide" hidden></div>
          <div class="ds-overlay" id="dsOverlay"></div>
        </div>
        <p class="small muted">לחיצה על אלמנט בוחרת אותו · גרירה מזיזה · הריבוע הקטן בפינה משנה גודל · חיצי המקלדת מזיזים בעדינות</p>
      </div>
      <div class="ds-panel" id="dsPanel"></div>
    </div>
    <div class="row space" style="margin-top:12px">
      <div class="row"><button class="primary" id="dsSave">שמירה</button><button id="dsDownload">הורדה</button>
        ${opts.onSaveTemplate ? '<button id="dsTemplate">שמירה כתבנית לכל ההשתלמויות</button>' : ""}</div>
      <div class="row"><button class="link danger" id="dsReset">חזרה לתבנית</button>
        ${opts.factoryDesign ? '<button class="link danger" id="dsFactory">חזרה לעיצוב המקורי של המכון</button>' : ""}</div>
    </div>`, () => {
    document.querySelector(".modal").classList.add("modal-wide");
    const cv = c.$("dsCanvas"), overlay = c.$("dsOverlay"), guide = c.$("dsGuide");

    const redraw = () => { boxes = draw(cv, d, opts.vars, imgs, { editor: true }); drawOverlay(); };
    const reload = async () => { imgs = await preload(d); redraw(); };

    function drawOverlay() {
      overlay.innerHTML = d.elements.map((e) => {
        const b = boxes[e.id]; if (!b) return "";
        return `<div class="ds-box ${sel === e.id ? "sel" : ""}" data-id="${e.id}" style="left:${b.x * scale}px;top:${b.y * scale}px;width:${Math.max(6, b.w * scale)}px;height:${Math.max(6, b.h * scale)}px">
          ${sel === e.id ? '<span class="ds-h" data-h="1" title="שינוי גודל"></span>' : ""}</div>`;
      }).join("");
    }

    // ---------- גרירה ושינוי גודל ----------
    let drag = null;
    overlay.addEventListener("pointerdown", (ev) => {
      const box = ev.target.closest(".ds-box");
      if (!box) { sel = null; drawOverlay(); panel(); return; }
      const e = d.elements.find((x) => x.id === box.dataset.id);
      if (sel !== e.id) { sel = e.id; panel(); }
      drag = { e, mode: ev.target.dataset.h ? "resize" : "move", sx: ev.clientX, sy: ev.clientY, x: e.x, y: e.y, w: e.w, h: e.h, size: e.size, ratio: e.h ? e.w / e.h : 0 };
      overlay.setPointerCapture(ev.pointerId);
      drawOverlay();
      ev.preventDefault();
    });
    overlay.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const dx = (ev.clientX - drag.sx) / scale, dy = (ev.clientY - drag.sy) / scale, e = drag.e;
      if (drag.mode === "move") {
        e.x = Math.round(drag.x + dx); e.y = Math.round(drag.y + dy);
        // הצמדה למרכז
        const bw = boxes[e.id]?.w || e.w, cx = e.x + bw / 2;
        const snap = Math.abs(cx - W / 2) < 10 / scale;
        if (snap) e.x = Math.round(W / 2 - bw / 2);
        guide.hidden = !snap;
      } else {
        // הידית בפינה השמאלית-תחתונה: גרירה שמאלה מגדילה
        const nw = Math.max(20, Math.round(drag.w - dx));
        e.x = Math.round(drag.x + (drag.w - nw)); e.w = nw;
        if (e.type === "image") e.h = Math.round(nw / (drag.ratio || 1));
        else if (e.type === "qr") e.h = nw;
        else if (e.type === "rect") e.h = Math.max(2, Math.round(drag.h + dy));
        else if (ev.shiftKey) e.size = Math.max(8, Math.round(drag.size * nw / drag.w));
      }
      requestAnimationFrame(redraw);
    });
    const endDrag = () => { if (drag) { drag = null; guide.hidden = true; panel(); } };
    overlay.addEventListener("pointerup", endDrag);
    overlay.addEventListener("pointercancel", endDrag);

    // מקלדת: חיצים מזיזים את האלמנט הנבחר
    const onKey = (ev) => {
      if (!document.body.contains(overlay)) { document.removeEventListener("keydown", onKey); return; }
      if (!sel || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
      const e = d.elements.find((x) => x.id === sel); if (!e) return;
      const step = ev.shiftKey ? 10 : 2;
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
      if (mv) { e.x += mv[0]; e.y += mv[1]; redraw(); ev.preventDefault(); }
      if (ev.key === "Delete") { removeSel(); ev.preventDefault(); }
    };
    document.addEventListener("keydown", onKey);

    const removeSel = () => { d.elements = d.elements.filter((x) => x.id !== sel); sel = null; redraw(); panel(); };

    // ---------- לוח מאפיינים ----------
    function panel() {
      const p = c.$("dsPanel");
      const e = d.elements.find((x) => x.id === sel);
      if (!e) {
        p.innerHTML = `<h3>הרקע</h3>
          <div class="field"><label for="dsBgColor">צבע רקע</label><input type="color" id="dsBgColor" value="${esc(d.bgColor || "#ffffff")}"></div>
          <div class="field"><label for="dsBgFile">תמונת רקע (התבנית המעוצבת שלכם)</label><input type="file" id="dsBgFile" accept="image/*"></div>
          ${d.bgImage ? '<button class="link danger" id="dsBgRemove">הסרת תמונת הרקע</button>' : ""}
          <h3 style="margin-top:14px">הוספה</h3>
          <div class="row"><button id="dsAddText">+ טקסט</button><button id="dsAddImg">+ תמונה</button><button id="dsAddRect">+ צורה</button><button id="dsAddQr">+ קוד QR</button></div>
          <input type="file" id="dsImgFile" accept="image/*" hidden>
          <h3 style="margin-top:14px">אלמנטים</h3>
          <div class="ds-layers">${d.elements.slice().reverse().map((x) => `<button class="link" data-pick="${x.id}">${x.type === "text" ? "טקסט: " + esc(String(x.text).slice(0, 24)) : x.type === "image" ? (/^logo/.test(x.src) ? "לוגו" : "תמונה") : x.type === "qr" ? "קוד QR" : "צורה"}${x.showIf ? ` <span class="muted">(רק אם יש ${esc(x.showIf)})</span>` : ""}</button>`).join("")}</div>`;
        c.$("dsBgColor").oninput = (ev) => { d.bgColor = ev.target.value; redraw(); };
        c.$("dsBgFile").onchange = async (ev) => {
          const f = ev.target.files[0]; if (!f) return;
          try { const r = await shrinkImage(f, { w: W, h: H, cover: true }); d.bgImage = r.data; await reload(); panel(); }
          catch (err) { c.toast(err.message, "bad"); }
        };
        if (c.$("dsBgRemove")) c.$("dsBgRemove").onclick = () => { d.bgImage = ""; reload(); panel(); };
        c.$("dsAddText").onclick = () => {
          const e2 = { id: nid(), type: "text", text: "טקסט חדש", x: Math.round(W * 0.15), y: Math.round(H * 0.45), w: Math.round(W * 0.7), size: Math.round(W / 22), weight: 400, color: INK, align: "center" };
          d.elements.push(e2); sel = e2.id; redraw(); panel();
        };
        c.$("dsAddRect").onclick = () => {
          const e2 = { id: nid(), type: "rect", x: Math.round(W * 0.3), y: Math.round(H * 0.45), w: Math.round(W * 0.4), h: Math.round(H * 0.08), fill: GOLD, radius: 12, opacity: 1 };
          d.elements.splice(0, 0, e2); sel = e2.id; redraw(); panel();
        };
        c.$("dsAddQr").onclick = async () => {
          const s0 = Math.round(Math.min(W, H) * 0.14);
          const e2 = { id: nid(), type: "qr", data: "{קישור מלא}", x: Math.round(W * 0.1), y: Math.round(H - s0 - H * 0.06), w: s0, h: s0, color: INK };
          d.elements.push(e2); sel = e2.id; await reload(); panel();
        };
        c.$("dsAddImg").onclick = () => c.$("dsImgFile").click();
        c.$("dsImgFile").onchange = async (ev) => {
          const f = ev.target.files[0]; if (!f) return;
          try {
            const r = await shrinkImage(f, { w: 900, h: 900, cover: false, maxBytes: 250000 });
            const w0 = Math.round(W * 0.35), e2 = { id: nid(), type: "image", src: r.data, x: Math.round((W - w0) / 2), y: Math.round(H * 0.4), w: w0, h: Math.round(w0 * r.h / r.w) };
            d.elements.push(e2); sel = e2.id; await reload(); panel();
          } catch (err) { c.toast(err.message, "bad"); }
        };
        p.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => { sel = b.dataset.pick; drawOverlay(); panel(); }));
        return;
      }
      const showIfSel = opts.varNames?.length ? `<div class="field" style="margin-top:10px"><label for="dsShowIf">להציג רק אם יש ערך ב:</label>
        <select id="dsShowIf"><option value="">תמיד להציג</option>${opts.varNames.map((v) => `<option ${e.showIf === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>` : "";
      const common = `${showIfSel}<div class="row" style="margin-top:12px"><button id="dsUp" title="קדימה">↑ קדימה</button><button id="dsDown" title="אחורה">↓ אחורה</button>
        <button id="dsDup">שכפול</button><button class="danger" id="dsDel">מחיקה</button></div>
        <button class="link" id="dsDeselect" style="margin-top:8px">← חזרה לרקע ולרשימת האלמנטים</button>`;
      if (e.type === "text") {
        p.innerHTML = `<h3>תיבת טקסט</h3>
          <div class="field"><label for="dsText">טקסט</label><textarea id="dsText" style="min-height:90px">${esc(e.text)}</textarea></div>
          ${opts.varNames?.length ? `<div class="small muted">הוספת שדה אוטומטי:</div><div class="ds-chips">${opts.varNames.map((v) => `<button class="badge" data-var="${esc(v)}">{${esc(v)}}</button>`).join("")}</div>` : ""}
          <div class="grid2" style="margin-top:8px">
            <div class="field"><label for="dsSize">גודל אות: <b id="dsSizeV">${e.size}</b></label><input type="range" id="dsSize" min="10" max="${Math.round(W / 6)}" value="${e.size}"></div>
            <div class="field"><label for="dsColor">צבע</label><input type="color" id="dsColor" value="${esc(e.color || INK)}"></div>
            <div class="field"><label for="dsFont">גופן</label><select id="dsFont">${FONTS.map(([f, l]) => `<option value="${esc(f)}" ${(e.font || "Heebo") === f ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
            <div class="field"><label for="dsWeight">עובי</label><select id="dsWeight">${WEIGHTS.map(([v, l]) => `<option value="${v}" ${(e.weight || 400) == v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
            <div class="field"><label for="dsLh">ריווח שורות</label><input type="range" id="dsLh" min="0.9" max="2.2" step="0.05" value="${e.lh || 1.25}"></div>
            <div class="field"><label>יישור</label><div class="row" style="flex-wrap:nowrap">${[["right", "ימין"], ["center", "מרכז"], ["left", "שמאל"]].map(([v, l]) => `<button data-al="${v}" class="${(e.align || "center") === v ? "primary" : ""}">${l}</button>`).join("")}</div></div>
          </div>
          <p class="small muted">גרירת הריבוע בפינה משנה את רוחב התיבה. עם Shift – גם את גודל האות.</p>${common}`;
        c.$("dsText").oninput = (ev) => { e.text = ev.target.value; redraw(); };
        p.querySelectorAll("[data-var]").forEach((b) => (b.onclick = () => {
          const ta = c.$("dsText"), pos = ta.selectionStart ?? ta.value.length, ins = `{${b.dataset.var}}`;
          ta.value = ta.value.slice(0, pos) + ins + ta.value.slice(ta.selectionEnd ?? pos);
          e.text = ta.value; redraw(); ta.focus(); ta.setSelectionRange(pos + ins.length, pos + ins.length);
        }));
        c.$("dsSize").oninput = (ev) => { e.size = Number(ev.target.value); c.$("dsSizeV").textContent = e.size; redraw(); };
        c.$("dsColor").oninput = (ev) => { e.color = ev.target.value; redraw(); };
        c.$("dsFont").onchange = async (ev) => { e.font = ev.target.value; await reload(); };
        c.$("dsWeight").onchange = async (ev) => { e.weight = Number(ev.target.value); await reload(); };
        c.$("dsLh").oninput = (ev) => { e.lh = Number(ev.target.value); redraw(); };
        p.querySelectorAll("[data-al]").forEach((b) => (b.onclick = () => { e.align = b.dataset.al; redraw(); panel(); }));
      } else if (e.type === "image") {
        const isLogo = e.src === "logo" || e.src === "logo-light";
        p.innerHTML = `<h3>${isLogo ? "לוגו" : "תמונה"}</h3>
          <div class="field"><label for="dsRepl">החלפת התמונה</label><input type="file" id="dsRepl" accept="image/*"></div>
          <div class="row"><button id="dsLogo" class="${e.src === "logo" ? "primary" : ""}">לוגו רגיל</button>
            <button id="dsLogoL" class="${e.src === "logo-light" ? "primary" : ""}">לוגו בהיר (לרקע כהה)</button></div>
          <p class="small muted">גרירת הריבוע בפינה מגדילה ומקטינה (היחס נשמר).</p>${common}`;
        c.$("dsRepl").onchange = async (ev) => {
          const f = ev.target.files[0]; if (!f) return;
          try { const r = await shrinkImage(f, { w: 900, h: 900, cover: false, maxBytes: 250000 }); e.src = r.data; e.h = Math.round(e.w * r.h / r.w); await reload(); }
          catch (err) { c.toast(err.message, "bad"); }
        };
        c.$("dsLogo").onclick = async () => { e.src = "logo"; e.h = Math.round(e.w / 2.93); await reload(); panel(); };
        c.$("dsLogoL").onclick = async () => { e.src = "logo-light"; e.h = Math.round(e.w / 2.93); await reload(); panel(); };
      } else if (e.type === "qr") {
        p.innerHTML = `<h3>קוד QR</h3>
          <div class="field"><label for="dsQr">לאן מוביל הקוד</label><input id="dsQr" dir="ltr" value="${esc(e.data || "")}"></div>
          <p class="small muted">{קישור מלא} = דף ההרשמה של ההשתלמות. אפשר גם להדביק כל קישור אחר.</p>
          <div class="grid2">
            <div class="field"><label for="dsQrC">צבע</label><input type="color" id="dsQrC" value="${esc(e.color || INK)}"></div>
            <label class="check"><input type="checkbox" id="dsQrBg" ${e.bg ? "checked" : ""}> <span>רקע לבן</span></label>
          </div>
          <p class="small muted">גרירת הריבוע בפינה מגדילה ומקטינה.</p>${common}`;
        c.$("dsQr").oninput = (ev) => { e.data = ev.target.value; redraw(); };
        c.$("dsQrC").oninput = (ev) => { e.color = ev.target.value; redraw(); };
        c.$("dsQrBg").onchange = (ev) => { e.bg = ev.target.checked ? "#ffffff" : ""; redraw(); };
      } else {
        p.innerHTML = `<h3>צורה</h3>
          <div class="grid2">
            <div class="field"><label for="dsFill">צבע</label><input type="color" id="dsFill" value="${esc(e.fill || GOLD)}"></div>
            <div class="field"><label for="dsOp">שקיפות</label><input type="range" id="dsOp" min="0.1" max="1" step="0.05" value="${e.opacity ?? 1}"></div>
            <div class="field"><label for="dsRad">עיגול פינות</label><input type="range" id="dsRad" min="0" max="${Math.round(Math.min(e.w, e.h) / 2)}" value="${e.radius || 0}"></div>
          </div>
          <p class="small muted">גרירת הריבוע בפינה משנה רוחב וגובה.</p>${common}`;
        c.$("dsFill").oninput = (ev) => { e.fill = ev.target.value; redraw(); };
        c.$("dsOp").oninput = (ev) => { e.opacity = Number(ev.target.value); redraw(); };
        c.$("dsRad").oninput = (ev) => { e.radius = Number(ev.target.value); redraw(); };
      }
      const idx = () => d.elements.findIndex((x) => x.id === e.id);
      c.$("dsUp").onclick = () => { const i = idx(); if (i < d.elements.length - 1) { d.elements.splice(i, 1); d.elements.splice(i + 1, 0, e); redraw(); } };
      c.$("dsDown").onclick = () => { const i = idx(); if (i > 0) { d.elements.splice(i, 1); d.elements.splice(i - 1, 0, e); redraw(); } };
      c.$("dsDup").onclick = () => { const e2 = { ...clone(e), id: nid(), x: e.x + 20, y: e.y + 20 }; d.elements.push(e2); sel = e2.id; redraw(); panel(); };
      c.$("dsDel").onclick = removeSel;
      if (c.$("dsShowIf")) c.$("dsShowIf").onchange = (ev) => { if (ev.target.value) e.showIf = ev.target.value; else delete e.showIf; redraw(); panel(); };
      c.$("dsDeselect").onclick = () => { sel = null; drawOverlay(); panel(); };
    }

    const sizeOk = () => {
      const kb = Math.round(JSON.stringify(d).length / 1024);
      if (kb > 900) { c.toast(`העיצוב גדול מדי (${kb}KB). נסו תמונת רקע קטנה יותר`, "bad"); return false; }
      return true;
    };
    c.$("dsSave").onclick = async () => { if (!sizeOk()) return; try { await opts.onSave(clone(d)); c.toast("נשמר", "good"); } catch (err) { c.toast("השמירה נכשלה: " + (err.code || err.message), "bad"); } };
    c.$("dsDownload").onclick = () => exportPng(d, opts.vars, opts.filename || "עיצוב.png");
    if (c.$("dsTemplate")) c.$("dsTemplate").onclick = async () => {
      if (!sizeOk() || !confirm("לשמור את העיצוב הזה כתבנית לכל ההשתלמויות החדשות?")) return;
      try { await opts.onSaveTemplate(clone(d)); c.toast("נשמר כתבנית", "good"); } catch (err) { c.toast("השמירה נכשלה: " + (err.code || err.message), "bad"); }
    };
    c.$("dsReset").onclick = async () => {
      if (!confirm("לבטל את השינויים ולחזור לתבנית?")) return;
      d = clone(opts.defaultDesign); sel = null; await reload(); panel();
    };
    if (c.$("dsFactory")) c.$("dsFactory").onclick = async () => {
      if (!confirm("לחזור לעיצוב המקורי של המכון (הפלאייר / רקע הזום)?")) return;
      d = clone(opts.factoryDesign); sel = null; await reload(); panel();
    };
    panel();
    reload();
  });
}

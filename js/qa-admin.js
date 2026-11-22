// ===== ממשק הניהול – נתוני מאגר השו"ת, חיפושים בלי תוצאות, דפים סטטיים ומפת אתר =====
import { collection, doc, getDocs, writeBatch, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, esc, toDate, fmtDate, sanitizeRich, linkify, normText } from "./common.js?v=20261108";

const tagsOf = (q) => (q.tags || []).filter((g) => g !== "ארכיון");
const titleOf = (q) => q.title || (String(q.publicText || q.text || "").slice(0, 110));
const base = () => new URL(".", location.href).href;
const qLink = (id) => `${base()}q.html?id=${encodeURIComponent(id)}`;

// ---------- לוח נתוני המאגר ----------
export async function openQaStats(c) {
  const pub = [...c.S.questions.values()].filter((q) => q.publish);
  const views = (q) => c.S.qaViews.get(q.id) || 0;
  const total = pub.reduce((a, q) => a + views(q), 0);
  const byCat = new Map();
  pub.forEach((q) => { const k = q.topic || "ללא קטגוריה"; const v = byCat.get(k) || { n: 0, v: 0 }; v.n++; v.v += views(q); byCat.set(k, v); });
  const top = [...pub].sort((a, b) => views(b) - views(a)).filter((q) => views(q)).slice(0, 15);
  const ageY = (q) => (Date.now() - (toDate(q.updatedAt) || toDate(q.answeredAt) || toDate(q.createdAt) || new Date()).getTime()) / (365 * 864e5);
  const stale = [...pub].filter((q) => q.imported || ageY(q) > 3).sort((a, b) => views(b) - views(a)).filter((q) => views(q)).slice(0, 10);
  // חיפושים בלי תוצאות – מקובצים לפי הנוסח
  let misses = [];
  try { misses = (await getDocs(collection(db, "qaSearchMisses"))).docs.map((d) => ({ id: d.id, ...d.data() })); } catch { /* */ }
  const groups = new Map();
  misses.forEach((m) => { const k = normText(m.q).trim(); if (!k) return; const g = groups.get(k) || { q: m.q, n: 0, last: null, ids: [] }; g.n++; g.ids.push(m.id); const t = toDate(m.at); if (t && (!g.last || t > g.last)) g.last = t; groups.set(k, g); });
  const missList = [...groups.values()].sort((a, b) => b.n - a.n || (b.last || 0) - (a.last || 0)).slice(0, 40);
  const row = (q) => `<li><a href="${qLink(q.id)}" target="_blank" rel="noopener">${esc(titleOf(q))}</a> <span class="views">👁 ${views(q)}</span>${q.topic ? ` <span class="small muted">· ${esc(q.topic)}</span>` : ""}</li>`;
  c.openModal(`
    <div class="head"><h2>📊 נתוני מאגר השו"ת</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    <p class="small muted">הנתונים כאן גלויים רק בממשק הניהול. צפייה נספרת פעם ביום לכל דפדפן.</p>
    <div class="stats"><div class="stat"><div class="num">${pub.length}</div><div class="lbl">שאלות במאגר</div></div>
      <div class="stat"><div class="num">${total.toLocaleString("he-IL")}</div><div class="lbl">צפיות בסך הכול</div></div>
      <div class="stat"><div class="num">${missList.length}</div><div class="lbl">חיפושים שלא נמצאה להם תשובה</div></div></div>
    <div class="split">
      <div class="card"><h3 style="margin-top:0">הנצפות ביותר</h3><ol class="stat-list">${top.map(row).join("") || '<li class="muted">עוד אין צפיות</li>'}</ol></div>
      <div class="card"><h3 style="margin-top:0">לפי קטגוריה</h3><table class="mini-table"><thead><tr><th>קטגוריה</th><th>שאלות</th><th>צפיות</th></tr></thead><tbody>
        ${[...byCat].sort((a, b) => b[1].v - a[1].v).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.n}</td><td>${v.v}</td></tr>`).join("")}</tbody></table></div>
    </div>
    <div class="card"><h3 style="margin-top:0">🔎 חיפושים בלי תוצאות</h3>
      <p class="small muted" style="margin-top:0">מה גולשים חיפשו במאגר ולא מצאו. זו רשימה טובה לשאלות שכדאי לכתוב עליהן תשובה.</p>
      ${missList.length ? `<table class="mini-table"><thead><tr><th>מה חיפשו</th><th>כמה פעמים</th><th>לאחרונה</th><th></th></tr></thead><tbody>
        ${missList.map((g, i) => `<tr><td>${esc(g.q)}</td><td>${g.n}</td><td class="small">${g.last ? fmtDate(g.last) : ""}</td><td><button class="link small danger" data-missdel="${i}">הסרה</button></td></tr>`).join("")}</tbody></table>` : '<p class="muted">אין חיפושים כאלה כרגע.</p>'}</div>
    <div class="card"><h3 style="margin-top:0">תשובות ותיקות שנקראות הרבה</h3>
      <p class="small muted" style="margin-top:0">תשובות מהארכיון או בנות יותר מ-3 שנים, לפי מספר הצפיות – כדאי לבדוק שהן עדכניות.</p>
      <ol class="stat-list">${stale.map(row).join("") || '<li class="muted">אין</li>'}</ol></div>
    ${c.can("admin", "head") ? `<div class="card"><h3 style="margin-top:0">🌐 גוגל ושיתוף</h3>
      <p class="small" style="margin-top:0"><b>דפים סטטיים:</b> קובץ ZIP עם דף נפרד לכל שאלה (תיקיית q) ומפת אתר. גוגל קורא אותם בקלות, ובשיתוף בוואטסאפ מופיעים כותרת השאלה ותמונת המכון. מעלים את תוכן ה-ZIP לתיקייה הראשית של האתר. כדאי לייצר מחדש מדי פעם.</p>
      <div class="row"><button class="primary" id="btnStatic">יצירת דפים סטטיים + מפת אתר (ZIP)</button><button id="btnSitemap2">מפת אתר בלבד</button></div>
      <p id="staticMsg" class="small muted"></p></div>` : ""}`, () => {
    document.querySelectorAll("[data-missdel]").forEach((b) => (b.onclick = async () => {
      const g = missList[Number(b.dataset.missdel)];
      try { await Promise.all(g.ids.map((id) => deleteDoc(doc(db, "qaSearchMisses", id)))); b.closest("tr").remove(); } catch (e) { c.toast("המחיקה נכשלה: " + e.code, "bad"); }
    }));
    if (document.getElementById("btnStatic")) document.getElementById("btnStatic").onclick = () => exportStatic(c);
    if (document.getElementById("btnSitemap2")) document.getElementById("btnSitemap2").onclick = () => downloadSitemap(c);
  });
}

// ---------- מפת אתר ----------
function sitemapXml(c, useStatic) {
  const b = base();
  const pub = [...c.S.questions.values()].filter((q) => q.publish);
  const cats = [...new Set(pub.map((q) => q.topic).filter(Boolean))];
  const tags = [...new Set(pub.flatMap(tagsOf))];
  const urls = [b + "shut.html", b + "ask.html", ...cats.map((t) => `${b}topic.html?c=${encodeURIComponent(t)}`), ...tags.map((t) => `${b}topic.html?tag=${encodeURIComponent(t)}`),
    ...pub.map((q) => useStatic ? `${b}q/${encodeURIComponent(q.id)}.html` : qLink(q.id))];
  return { count: urls.length, xml: '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map((u) => `  <url><loc>${u.replace(/&/g, "&amp;")}</loc></url>`).join("\n") + "\n</urlset>\n" };
}
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
export function downloadSitemap(c) {
  const { xml, count } = sitemapXml(c, false);
  download(new Blob([xml], { type: "application/xml" }), "sitemap.xml");
  c.toast(`נוצר sitemap.xml עם ${count} דפים. מעלים אותו לתיקייה הראשית של האתר.`, "good");
}

// ---------- דפים סטטיים לכל שאלה (לגוגל ולכרטיס שיתוף) ----------
const loadJsZip = () => window.JSZip ? Promise.resolve(window.JSZip) : new Promise((ok, bad) => {
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  s.onload = () => ok(window.JSZip); s.onerror = () => bad(new Error("לא הצלחתי לטעון את רכיב ה-ZIP"));
  document.head.appendChild(s);
});
const attr = (s) => esc(String(s || "").replace(/\s+/g, " ").trim());

export async function exportStatic(c) {
  const msg = document.getElementById("staticMsg"), btn = document.getElementById("btnStatic");
  btn.disabled = true; msg.textContent = "מכין...";
  try {
    const JSZip = await loadJsZip();
    const tpl = await (await fetch("q.html", { cache: "no-store" })).text();
    const b = base(), img = b + "img/share.png";
    const pub = [...c.S.questions.values()].filter((q) => q.publish);
    const zip = new JSZip();
    pub.forEach((q) => {
      const title = titleOf(q), desc = String(q.summary || q.publicText || q.text || "").replace(/\s+/g, " ").slice(0, 160);
      const url = `${b}q/${encodeURIComponent(q.id)}.html`, rabbi = q.rabbiName || (q.rabbiEmail ? c.userName(q.rabbiEmail) : "");
      const ld = JSON.stringify({ "@context": "https://schema.org", "@type": "QAPage", mainEntity: { "@type": "Question", name: title, text: q.publicText || q.text, answerCount: 1,
        acceptedAnswer: { "@type": "Answer", text: q.answer || "", url, author: { "@type": "Organization", name: rabbi || "מכון משפטי ארץ" } } } }).replace(/</g, "\\u003c");
      const content = `<h1 class="q-title">${esc(title)}</h1>
        ${q.summary ? `<p class="q-summary">${esc(q.summary)}</p>` : ""}
        <h2 class="qa-h">השאלה</h2><p class="pre q-text">${linkify(q.publicText || q.text || "")}</p>
        <h2 class="qa-h">התשובה</h2><div class="ans q-text rich">${q.answerHtml ? sanitizeRich(q.answerHtml) : linkify(q.answer || "")}</div>
        ${rabbi ? `<p class="small muted">— ${esc(rabbi)}</p>` : ""}
        ${tagsOf(q).length ? `<p class="small">${tagsOf(q).map((g) => `<a class="chip small" href="topic.html?tag=${encodeURIComponent(g)}">${esc(g)}</a>`).join(" ")}</p>` : ""}`;
      let html = tpl
        .replace(/<head>/, `<head>\n  <base href="../">`)
        .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)} – שו"ת מכון משפטי ארץ</title>`)
        .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${attr(desc)}">`)
        .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" id="canon" href="${attr(url)}">`)
        .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${attr(title)}">`)
        .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${attr(desc)}">`)
        .replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${attr(img)}">\n  <meta property="og:url" content="${attr(url)}">\n  <meta name="twitter:card" content="summary_large_image">\n  <script type="application/ld+json">${ld}</script>`)
        .replace(/<article id="qa" class="card">[\s\S]*?<\/article>/, `<article id="qa" class="card" data-static="1">${content}</article>`)
        .replace(/<script type="module" src="js\/q\.js/, `<script>window.QID = ${JSON.stringify(q.id)};</script>\n  <script type="module" src="js/q.js`);
      zip.file(`q/${q.id}.html`, html);
    });
    const sm = sitemapXml(c, true);
    zip.file("sitemap.xml", sm.xml);
    zip.file("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${b}sitemap.xml\n`);
    msg.textContent = "מסמן את השאלות במערכת...";
    // סימון: מעכשיו כל שיתוף של השאלות האלה יוביל לדף הסטטי
    for (let i = 0; i < pub.length; i += 200) {
      const wb = writeBatch(db);
      pub.slice(i, i + 200).forEach((q) => { wb.update(doc(db, "publicQA", q.id), { staticPage: true }); wb.update(doc(db, "questions", q.id), { staticPage: true }); });
      await wb.commit();
    }
    const blob = await zip.generateAsync({ type: "blob" });
    download(blob, "dapim-statiim.zip");
    msg.textContent = `✓ נוצרו ${pub.length} דפים + sitemap.xml + robots.txt. מעלים את תוכן ה-ZIP לתיקייה הראשית של האתר (התיקייה q והקבצים שלידה).`;
    c.audit?.("יצירת דפים סטטיים למאגר", "", `${pub.length} דפים`);
  } catch (e) { msg.textContent = "נכשל: " + (e.code || e.message); }
  btn.disabled = false;
}

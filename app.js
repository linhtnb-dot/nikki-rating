// Đường Đua Lấp Lánh: logic trang (tách khỏi index.html để áp dụng Content-Security-Policy chặt)
const REFRESH_MS = 5 * 60 * 1000;
const KEYS = ['ios', 'android'];
let CFG = null, DATA = null;
const fmt = new Intl.NumberFormat('vi-VN');
const fmtDT = d => new Date(d).toLocaleString('vi-VN', {hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit', year:'numeric'});
const key1 = x => Number(x).toFixed(1);
const vn1 = x => key1(x).replace('.', ',');
const vn2 = x => Number(x).toFixed(2).replace('.', ',');
const vn3 = x => Number(x).toFixed(3).replace('.', ',');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Chỉ cho phép link http/https (chặn javascript:, data:...) rồi mới escape
const safeUrl = u => { try { const x = new URL(String(u || ''), location.href); return /^https?:$/.test(x.protocol) ? esc(x.href) : '#'; } catch (e) { return '#'; } };
const int = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

// Số liệu lấy từ config.dataUrl nếu có (vd khi trang chạy trên mainsite, đọc file do GitHub Action cập nhật), không thì đọc file cùng thư mục
async function load(){
  const bust = 't=' + Date.now();
  const c = await fetch('config.json?' + bust).then(r => r.json());
  const url = c.dataUrl || 'data/ratings.json';
  const d = await fetch(url + (url.includes('?') ? '&' : '?') + bust).then(r => r.json());
  CFG = c; DATA = d; render();
}

// ---------- Trạng thái (rule nằm ở scripts/fetch-ratings.ps1) ----------
const confirmedOf = key => ((DATA.confirmed || {})[key]) || {};
const streakOf = key => ((DATA.streak || {})[key]) || {};
const needRuns = () => (DATA.rule && DATA.rule.confirmRuns) || (CFG.rule && CFG.rule.confirmRuns) || 2;
const mission = () => (CFG.tiers || [])[0] || {};
const missionDone = () => (DATA.tiers || []).find(t => +t.tier === 1);

// Chặng của 1 làn: từ progressFrom tới vạch đích, theo điểm chính xác
function leg(key){
  const cfg = CFG.stores[key], s = (DATA.stores || {})[key] || {}, to = Number(mission()[key]);
  if (!isFinite(to)) return null;
  const from = cfg.progressFrom != null ? +cfg.progressFrom : to - 0.2;
  const done = !!confirmedOf(key)[key1(to)];
  const frac = done ? 1 : s.score == null ? 0 : Math.max(0, Math.min(1, (s.score - from) / (to - from)));
  return { from, to, frac, done, score: s.score, pend: streakOf(key)[key1(to)] };
}

// Tab mặc định: tab người xem chọn lần trước, nếu không thì theo thiết bị
let ACTIVE = null;
function defaultTab(){
  try { const t = localStorage.getItem('rc-tab'); if (KEYS.includes(t)) return t; } catch (e) {}
  return /android/i.test(navigator.userAgent) ? 'android' : 'ios';
}
function select(key){
  ACTIVE = key;
  try { localStorage.setItem('rc-tab', key); } catch (e) {}
  for (const k of KEYS) {
    const t = document.getElementById('tab-' + k), p = document.getElementById('panel-' + k);
    if (t) t.setAttribute('aria-selected', k === key);
    if (p) p.hidden = k !== key;
  }
  // Panel vừa hiện mới có kích thước: cập nhật lại trạng thái nút vuốt
  const w = document.querySelector(`#panel-${key} .scene-wrap`);
  if (w) w.dispatchEvent(new Event('scroll'));
}

function render(){
  const c = CFG.campaign || {};
  document.getElementById('eyebrow').textContent = c.eyebrow || '';
  document.getElementById('title').textContent = c.name || 'Đường Đua Lấp Lánh';
  document.getElementById('sample').hidden = !DATA.sample;
  document.getElementById('updated').textContent = DATA.updatedAt ? `Cập nhật lần cuối ${fmtDT(DATA.updatedAt)}` : 'Chưa có số liệu';
  if (!ACTIVE) ACTIVE = defaultTab();
  renderRace();
  renderProof();
}

// Đường đua: 2 tab App Store / Google Play, mỗi tab = điểm + làn đua + link store
function renderRace(){
  const keys = KEYS.filter(k => CFG.stores[k]);
  const done = missionDone();
  const tabs = keys.map(k => `<button class="tab ${k}" role="tab" id="tab-${k}" aria-controls="panel-${k}" aria-selected="${k === ACTIVE}">${esc(CFG.stores[k].label)}</button>`).join('');

  const panel = k => {
    const cfg = CFG.stores[k], s = (DATA.stores || {})[k] || {}, l = leg(k);
    const disp = s.display, starPct = s.score != null ? s.score / 5 * 100 : disp != null ? disp / 5 * 100 : 0;
    const badge = k === 'ios' ? 'assets/badge-appstore.png' : 'assets/badge-googleplay.png';
    // Chặng tiếp theo: các mốc ở stores.*.future (đang khoá), đích cuối CFG.finalGoal
    const future = (Array.isArray(cfg.future) ? cfg.future : []).map(Number).filter(Number.isFinite);
    const finalGoal = Number(CFG.finalGoal);
    let lane = '';
    if (l) {
      const pct = l.frac * 100;
      const foot = l.done ? `<b>Đã về đích ✓</b>`
        : l.pend ? `<span>Đang xác nhận <b>${int(l.pend.hits)}/${int(needRuns())}</b> lần cập nhật</span>`
        : `<span>Hiện tại <b>${l.score != null ? vn3(l.score) : '—'}</b></span>`;
      lane = `<div class="lane ${l.done ? 'done' : ''}">
        <div class="lane-top"><span>Tiến độ về đích mốc 1</span><span class="goal"><b>${Math.floor(pct)}%</b> chặng</span></div>
        ${raceScene(k, cfg, l, future, finalGoal)}
        <div class="lane-foot">${foot}<span>${l.done ? '' : `Còn <b>${l.score != null ? vn3(Math.max(0, l.to - l.score)) : '—'}</b> điểm`}</span></div>
      </div>`;
    }
    return `<div class="panel ${k}" role="tabpanel" id="panel-${k}" aria-labelledby="tab-${k}" ${k === ACTIVE ? '' : 'hidden'}>
      <div class="score-row">
        <div class="score">${disp != null ? vn1(disp) : '—'}</div>
        <div><div class="store-name">${esc(cfg.label)}</div>
          <div class="stars">★★★★★<span style="width:${starPct}%">★★★★★</span></div>
          <div class="count">${s.count ? fmt.format(s.count) + ' lượt đánh giá' : ''}</div></div>
      </div>
      ${lane}
      ${s.error ? `<div class="err">Lần cập nhật gần nhất bị lỗi, đang hiện số cũ.</div>` : ''}
      <div class="cta">
        <a class="badge" href="${safeUrl(cfg.reviewUrl || cfg.url)}" target="_blank" rel="noopener noreferrer"><img src="${badge}" alt="Tải và đánh giá trên ${esc(cfg.label)}" width="150" height="47"></a>
        <a class="btn-ghost" href="${safeUrl(cfg.url)}" target="_blank" rel="noopener noreferrer">Xem đánh giá</a>
      </div>
    </div>`;
  };

  const el = document.getElementById('race');
  // Giữ vị trí đã vuốt khi trang tự tải lại số liệu
  const keep = {};
  el.querySelectorAll('.scene-box').forEach(b => { keep[b.dataset.k] = b.querySelector('.scene-wrap').scrollLeft; });
  el.innerHTML = `${done ? `<span class="status">Đã về đích · ${fmtDT(done.openedAt)}</span>` : ''}
    <div class="tabs" role="tablist">${tabs}</div>
    ${keys.map(panel).join('')}`;
  el.querySelectorAll('.tab').forEach(b => b.onclick = () => select(b.id.slice(4)));
  el.querySelectorAll('.scene-box').forEach(box => {
    const wrap = box.querySelector('.scene-wrap'), btn = box.querySelector('.swipe-hint');
    if (keep[box.dataset.k] != null) wrap.scrollLeft = keep[box.dataset.k];
    const atEnd = () => wrap.clientWidth > 0 && wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 8;
    const upd = () => box.classList.toggle('at-end', atEnd());
    wrap.addEventListener('scroll', upd, { passive: true });
    upd();
    btn.onclick = () => {
      const from = wrap.scrollLeft, to = atEnd() ? 0 : from + wrap.clientWidth * 0.8;
      wrap.scrollTo({ left: to, behavior: 'smooth' });
      // Trình duyệt không chạy cuộn mượt thì nhảy thẳng tới vị trí mới
      setTimeout(() => { if (Math.abs(wrap.scrollLeft - from) < 2) wrap.scrollLeft = to; upd(); }, 450);
    };
  });
}

// ---------- Cảnh đường đua: đồi cỏ, đường đất gập ghềnh; rộng hơn khung để vuốt ngang xem các chặng sau ----------
const SW = 1000, SH = 230;                                     // kích thước cảnh (px)
const SPOT = { start: 30, goal: 262, next: [470, 660], final: 850, nikki: 932 };   // mốc 1 nằm trọn trong màn đầu (~330px); 5 sao là đích cuối
const roadY = x => 160 - 22 * Math.sin(x / SW * Math.PI * 5.2 + 0.5) - 8 * Math.sin(x / SW * Math.PI * 14.6 + 1.2);
const ptsFrom = (a, b, step = 8) => { const p = []; for (let x = a; x < b; x += step) p.push([x, roadY(x)]); p.push([b, roadY(b)]); return p; };
const pathOf = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
const hillY = (x, base, amp, f, ph) => base - amp * Math.sin(x / SW * Math.PI * f + ph);
const hillPath = (base, amp, f, ph) => { let d = `M-10,${SH}`; for (let x = -10; x <= SW + 10; x += 12) d += ` L${x},${hillY(x, base, amp, f, ph).toFixed(1)}`; return d + ` L${SW + 10},${SH} Z`; };
const prand = i => { const v = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return v - Math.floor(v); };   // "ngẫu nhiên" cố định, cảnh không đổi giữa các lần tải
const STAR = '<tspan class="st">★</tspan>';

// Biển gỗ cắm bên đường: rise = khoảng cách từ mặt đường tới mép trên tấm biển
function sign(x, html, { w = 58, h = 22, rise = 56, lock = false, lines = null, fill = '#c99257' } = {}){
  const y = roadY(x), top = y - rise;
  const lockIcon = lock ? `<g transform="translate(${x - w / 2 + 11},${top + h / 2 - 1})" fill="#fff3dc"><rect x="-4.5" y="-1.5" width="9" height="7" rx="1.6"/><path d="M-2.6-1.5v-2a2.6 2.6 0 0 1 5.2 0v2" fill="none" stroke="#fff3dc" stroke-width="1.6"/></g>` : '';
  const text = lines
    ? lines.map((t, i) => `<text x="${x}" y="${top + 14 + i * 12.5}" class="sg-t sm">${t}</text>`).join('')
    : `<text x="${x + (lock ? 6 : 0)}" y="${top + h / 2 + 4.5}" class="sg-t">${html}</text>`;
  return `<rect x="${x - 2}" y="${top + h - 2}" width="4" height="${rise - h + 4}" rx="1.5" fill="#94643a"/>
    <rect x="${x - w / 2}" y="${top}" width="${w}" height="${h}" rx="4.5" fill="${fill}" stroke="#86562a" stroke-width="1.5"/>
    <rect x="${x - w / 2 + 3}" y="${top + 2.5}" width="${w - 6}" height="2" rx="1" fill="#fff" opacity=".18"/>${lockIcon}${text}`;
}

function raceScene(k, cfg, l, future, finalGoal){
  const S = SPOT;
  const mx = l.done ? S.goal : S.start + l.frac * (S.goal - S.start), my = roadY(mx);
  const ground = `M-10,${SH} ` + ptsFrom(-10, SW + 10, 10).map(p => `L${p[0]},${(p[1] + 6).toFixed(1)}`).join(' ') + ` L${SW + 10},${SH} Z`;
  const road = pathOf(ptsFrom(-10, SW + 10));
  const trail = mx > S.start + 3 ? `<path class="trail" d="${pathOf(ptsFrom(S.start, mx, 6))}"/>` : '';
  // Trang trí: mây, cây trên đồi giữa, cỏ ven đường, hoa trên bãi cỏ
  const clouds = [[90, 34, 1], [330, 22, .8], [560, 40, 1.1], [820, 26, .9]].map(([x, y, s]) =>
    `<g transform="translate(${x},${y}) scale(${s})" fill="#fff" opacity=".9"><ellipse cx="0" cy="6" rx="26" ry="9"/><ellipse cx="-10" cy="1" rx="12" ry="9"/><ellipse cx="9" cy="-1" rx="14" ry="11"/></g>`).join('');
  const trees = [64, 186, 392, 540, 700, 905].map((x, i) => {
    const yb = hillY(x, 138, 24, 3.1, .9) + 4, s = .8 + prand(i + 7) * .45;
    return `<g transform="translate(${x},${yb.toFixed(1)}) scale(${s.toFixed(2)})"><rect x="-2.5" y="-16" width="5" height="17" rx="2" fill="#a07448"/><circle cx="0" cy="-24" r="13" fill="#86c96f"/><circle cx="-8" cy="-17" r="9" fill="#77bd62"/><circle cx="8" cy="-18" r="9.5" fill="#93d27b"/></g>`;
  }).join('');
  let tufts = '';
  for (let x = 14; x < SW; x += 38) { const y = roadY(x) - 12; tufts += `M${x},${y.toFixed(1)}l2.5-6 2.5 6 2.5-5 2.5 5`; }
  let flowers = '';
  for (let i = 0; i < 46; i++) {
    const x = prand(i) * SW, y = roadY(x) + 19 + prand(i + 91) * (SH - roadY(x) - 26);
    flowers += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.8 + prand(i + 37) * 1.4).toFixed(1)}" fill="${['#ff8fb8', '#ffd36a', '#ffffff', '#ffb0cf'][i % 4]}"/>`;
  }
  // Mốc: vạch xuất phát, cờ ca-rô tại mốc 1, biển khoá các chặng sau, cờ vàng tại đích 5 sao (Nikki đứng cạnh)
  const sy = roadY(S.start), gy = roadY(S.goal), fy = roadY(S.final);
  const startLine = `<line x1="${S.start}" y1="${(sy - 10).toFixed(1)}" x2="${S.start}" y2="${(sy + 10).toFixed(1)}" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`;
  const goalFlag = `<rect x="${S.goal - 1.5}" y="${(gy - 84).toFixed(1)}" width="3" height="84" rx="1.5" fill="#6b4a2b"/>
    <rect x="${S.goal + 1.5}" y="${(gy - 84).toFixed(1)}" width="28" height="17" fill="url(#chk-${k})" stroke="#4a2a3f" stroke-width=".8"/>
    ${sign(S.goal, `Mốc 1 · ${vn2(l.to)}${STAR}`, { w: 98, rise: 54, fill: l.done ? '#5fb47a' : '#c99257' })}`;
  const nextSigns = future.slice(0, S.next.length).map((v, i) => sign(S.next[i], `${vn1(v)}${STAR}`, { w: 62, lock: true })).join('');
  const hasFinal = Number.isFinite(finalGoal);
  const finalFlag = hasFinal ? `<rect x="${S.final - 1.5}" y="${(fy - 82).toFixed(1)}" width="3" height="82" rx="1.5" fill="#6b4a2b"/>
    <path d="M${S.final + 1.5},${(fy - 82).toFixed(1)} l30,9 -30,9z" fill="#f2b33d" stroke="#c98a1a" stroke-width=".8"/>
    ${sign(S.final, `Đích ${String(finalGoal).replace('.', ',')}${STAR}`, { w: 74, rise: 52, lock: true })}` : '';
  const fogX = S.goal + 30;
  const aria = `${esc(cfg.label)}: ${Math.floor(l.frac * 100)}% chặng tới ${vn1(l.to)} sao. Chặng tiếp theo: ${future.map(vn1).join(', ')}${hasFinal ? ', đích cuối ' + finalGoal + ' sao' : ''}.`;
  const ny = roadY(S.nikki);
  return `<div class="scene-box" data-k="${k}">
    <div class="scene-wrap" tabindex="0" aria-label="Đường đua, vuốt ngang để xem các chặng tiếp theo">
      <div class="scene">
        <svg width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}" role="img" aria-label="${aria}">
          <defs>
            <linearGradient id="sky-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9f2"/><stop offset=".7" stop-color="#fff6ea"/></linearGradient>
            <linearGradient id="grass-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9db8b"/><stop offset="1" stop-color="#83c46b"/></linearGradient>
            <linearGradient id="fog-${k}" gradientUnits="userSpaceOnUse" x1="${fogX}" y1="0" x2="${fogX + 140}" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".38"/></linearGradient>
            <pattern id="chk-${k}" width="7" height="7" patternUnits="userSpaceOnUse"><rect width="7" height="7" fill="#fff"/><rect width="3.5" height="3.5" fill="#4a2a3f"/><rect x="3.5" y="3.5" width="3.5" height="3.5" fill="#4a2a3f"/></pattern>
          </defs>
          <rect width="${SW}" height="${SH}" fill="url(#sky-${k})"/>
          ${clouds}
          <path d="${hillPath(112, 20, 2.2, 2.1)}" fill="#d7efc6"/>
          <path d="${hillPath(138, 24, 3.1, .9)}" fill="#bfe4a7"/>
          ${trees}
          <path d="${ground}" fill="url(#grass-${k})"/>
          ${flowers}
          <path d="${road}" fill="none" stroke="#c39c63" stroke-width="27" stroke-linejoin="round"/>
          <path d="${road}" fill="none" stroke="#efd9a8" stroke-width="21" stroke-linejoin="round"/>
          <path d="${road}" fill="none" stroke="#fff" stroke-width="2.4" stroke-dasharray="9 13" opacity=".75"/>
          ${trail}
          <path d="${tufts}" fill="none" stroke="#5fa84c" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          ${startLine}${goalFlag}${nextSigns}${finalFlag}
          <rect x="${fogX}" y="0" width="${SW - fogX}" height="${SH}" fill="url(#fog-${k})"/>
        </svg>
        <img class="runner" src="assets/loading.gif" alt="" width="62" height="62" style="left:${(mx - 34).toFixed(1)}px;top:${(my - 47).toFixed(1)}px">
        ${hasFinal ? `<img class="scene-nikki" src="assets/nikki-goal.png" alt="" width="84" height="96" style="left:${S.nikki - 42}px;top:${(ny - 88).toFixed(1)}px">` : ''}
      </div>
    </div>
    <button class="swipe-hint" type="button"><span class="a">Vuốt sang xem chặng tiếp theo <i>›</i></span><span class="b">‹ Quay lại chặng hiện tại</span></button>
  </div>`;
}

// Nút nộp minh chứng trên phong bì: mở form ở tab mới
function renderProof(){
  const f = CFG.proofForm || {};
  document.getElementById('proof-cta').innerHTML = f.url
    ? `<a class="btn" href="${safeUrl(f.url)}" target="_blank" rel="noopener noreferrer">Nộp minh chứng</a>`
    : `<span class="soon">Form sắp mở</span>`;
}

// Ẩn màn hình chờ khi đã có số liệu và ảnh đầu trang (giữ tối thiểu 0,8 giây để không nháy; tối đa 8 giây)
const LOADER_T0 = Date.now();
function hideLoader(){
  const el = document.getElementById('loader'); if (!el || el.classList.contains('hide')) return;
  setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 500); }, Math.max(0, 800 - (Date.now() - LOADER_T0)));
}
const heroReady = new Promise(r => { const im = document.querySelector('.hero-img'); if (!im || im.complete) r(); else { im.onload = r; im.onerror = r; } });
setTimeout(hideLoader, 8000);
Promise.all([
  load().catch(e => { document.getElementById('updated').textContent = 'Chưa tải được số liệu, vui lòng thử lại sau ít phút.'; console.error(e); }),
  heroReady
]).then(hideLoader);
setInterval(() => load().catch(console.error), REFRESH_MS);

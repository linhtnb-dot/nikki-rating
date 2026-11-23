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
    const finalGoal = Number(CFG.finalGoal);
    // Mốc sau: lấy stores.*.future nếu có, không thì tự sinh cách đều CFG.milestoneStep (vd 0,5) từ sau mốc 1 tới trước đích
    const future = (Array.isArray(cfg.future) ? cfg.future : (l ? stepMilestones(l.to, finalGoal, Number(CFG.milestoneStep)) : [])).map(Number).filter(Number.isFinite);
    let lane = '';
    if (l) {
      const pct = l.frac * 100;
      const foot = l.done ? `<b>Đã về đích ✓</b>`
        : l.pend ? `<span>Đang xác nhận <b>${int(l.pend.hits)}/${int(needRuns())}</b> lần cập nhật</span>`
        : `<span>Hiện tại <b>${l.score != null ? vn3(l.score) : '—'}</b></span>`;
      lane = `<div class="lane ${l.done ? 'done' : ''}">
        <div class="lane-top"><span>Tiến độ về đích - Mốc 1</span><span class="goal"><b>${Math.floor(pct)}%</b> chặng</span></div>
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

// ---------- Cảnh đường đua kiểu pixel: trời xanh, mây hồng, núi, rặng thông, đồng cỏ hoa; đường đất bậc thang lên xuống ----------
// Vẽ trên lưới ô vuông PX px, rộng hơn khung để vuốt ngang xem các mốc sau
const SW = 1000, SH = 230, PX = 5, HORIZON = 135;
const SPOT = { start: 30, goal: 262, final: 918 };                 // mốc 1 nằm trọn trong màn đầu (~330px); 5 sao là đích cuối, sát cuối đường
const q = v => Math.round(v / PX) * PX;
const roadC = x => q(174 - 17 * Math.sin(x / SW * Math.PI * 5.2 + 0.5) - 6 * Math.sin(x / SW * Math.PI * 14.6 + 1.2));   // hàng ô giữa đường
const prand = i => { const v = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return v - Math.floor(v); };    // "ngẫu nhiên" cố định
const R = (x, y, w, h, f, cls) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"${cls ? ` class="${cls}"` : ` fill="${f}"`}/>`;
// Vẽ ảnh pixel từ mảng chuỗi (mỗi ký tự = 1 ô, '.' = trống), gộp các ô cùng màu liền nhau trên một hàng
function bmp(x0, y0, rows, pal, s = PX){
  let out = '';
  rows.forEach((r, j) => {
    for (let i = 0; i < r.length;) {
      const c = r[i]; if (!pal[c]) { i++; continue; }
      let k = i; while (k < r.length && r[k] === c) k++;
      out += R(x0 + i * s, y0 + j * s, (k - i) * s, s, pal[c]);
      i = k;
    }
  });
  return out;
}
// Mốc tự sinh cách đều step, từ sau mốc 1 tới trước đích
function stepMilestones(from, goal, step){
  if (!(step > 0) || !Number.isFinite(goal)) return [];
  const out = []; let v = Math.floor(from / step + 1e-9) * step + step;
  while (v < goal - 1e-9 && out.length < 6) { out.push(Math.round(v * 100) / 100); v += step; }
  return out;
}
const STAR = '<tspan class="st">★</tspan>';
const CLOUD = ['.....WWWW.......', '...WWPPPPWW.....', '..WPPPPPPPPWWW..', '.WPPPPPPPPPPPPW.', 'WPPPPPPPPPPPPPPW', 'PPPPPPPPPPPPPPPP', '.DDDDDDDDDDDDDD.'];
const TREE = ['...T...', '..TTT..', '.LTTTT.', '..TTT..', '.LTTTT.', 'LTTTTTT', '...B...'];
const BUSH = ['..FG.F..', '.GFGGGF.', 'GGGGFGGG', 'GGGGGGGG'];
const LOCKBMP = ['.LLL.', 'L...L', 'LLLLL', 'LLLLL', 'LLLLL'];
const GOLDFLAG = ['OO.....', 'OYOO...', 'OYYYOO.', 'OYYYYYO', 'OYYYOO.', 'OYOO...', 'OO.....'];   // có viền để vẫn thấy rõ khi bị tô xám
const FLOWER = ['.F.', 'FCF', '.F.'];

// Ước lượng bề rộng chữ trên biển (Baloo 2 đậm 12,5px), có dư một chút để chữ không chạm viền
const textW = s => [...s].reduce((a, ch) => a + (ch === '★' ? 12.5 : ',.· '.includes(ch) ? 4.5 : /[0-9]/.test(ch) ? 7.6 : 8), 0);
// Biển gỗ kiểu pixel, rộng theo chữ: rise = khoảng cách từ tâm đường tới mép trên tấm biển
function sign(x, html, { h = 20, rise = 55, lock = false, fill = '#c99257' } = {}){
  const plain = html.replace(/<[^>]+>/g, '');
  const w = Math.ceil((textW(plain) + (lock ? 30 : 18)) / PX) * PX;
  const c = roadC(x), top = c - rise, bx = q(x - w / 2);
  const tx = lock ? bx + 21 + (w - 25) / 2 : bx + w / 2;          // có ổ khoá: chữ căn giữa phần còn lại bên phải ổ khoá
  const lockIcon = lock ? bmp(bx + 7, top + 5, LOCKBMP, { L: '#fff3dc' }, 2) : '';
  return `<g class="sign">` + R(q(x) - 2, top + h, 5, rise - h - 10, '#8a5a32')
    + R(bx, top, w, h, '#86562a') + R(bx + 2, top + 2, w - 4, h - 4, fill) + R(bx + 2, top + 2, w - 4, 2, '#e0b07a')
    + lockIcon + `<text x="${tx}" y="${top + h / 2 + 4.5}" class="sg-t">${html}</text></g>`;
}

function raceScene(k, cfg, l, future, finalGoal){
  const S = SPOT, out = [];
  // Trời: các dải xanh nhạt dần về phía chân trời
  ['#9ccdee', '#a6d3f0', '#b1d9f2', '#bde0f4', '#cbe7f6', '#d8edf8'].forEach((c, i) => out.push(R(0, i * 25, SW, 25, c)));
  // Mây hồng viền trắng + vệt mây trắng nhỏ
  [[40, 12], [320, 32], [600, 8], [835, 26]].forEach(([x, y]) => out.push(bmp(x, y, CLOUD, { W: '#ffffff', P: '#f6cdee', D: '#e8b5e2' })));
  [[230, 20, 6], [500, 52, 4], [760, 62, 5], [960, 14, 3]].forEach(([x, y, n]) => out.push(R(x, y, n * PX, PX, '#ffffff')));
  // Núi xa (nhạt) rồi núi gần (đậm, sườn trái sáng như tuyết)
  const range = (peaks, slope) => x => Math.min(...peaks.map(([px, py]) => py + Math.abs(x - px) * slope));
  const far = range([[200, 78], [430, 70], [650, 82], [880, 72]], .6), near = range([[100, 66], [310, 76], [530, 60], [740, 72], [950, 64]], .85);
  for (let x = 0; x < SW; x += PX) {
    const tf = q(far(x + PX / 2)); if (tf < HORIZON) out.push(R(x, tf, PX, HORIZON + 5 - tf, '#b9c8f1'));
  }
  const nearPeaks = [100, 310, 530, 740, 950];
  for (let x = 0; x < SW; x += PX) {
    const tn = q(near(x + PX / 2)); if (tn >= HORIZON) continue;
    out.push(R(x, tn, PX, HORIZON + 5 - tn, '#8ea7e6'));
    const pk = nearPeaks.reduce((a, b) => Math.abs(b - x) < Math.abs(a - x) ? b : a);
    out.push(R(x, tn, PX, PX * 2, x < pk ? '#c4d3f7' : '#7a93d8'));
  }
  // Rặng thông dưới chân núi
  [0, 28, 56, 395, 425, 455, 700, 730, 760, 790, 960].forEach((x, i) => out.push(bmp(x, HORIZON - 30 + (i % 2) * PX, TREE, { T: '#2b6a6e', L: '#3f8a83', B: '#5a3f2a' })));
  // Đồng cỏ: các dải xanh đậm dần về phía trước, mép cỏ răng cưa ở chân trời
  [[HORIZON, 15, '#b3dc6b'], [HORIZON + 15, 25, '#a4d35e'], [HORIZON + 40, 30, '#94ca52'], [HORIZON + 70, SH - HORIZON - 70, '#85c047']].forEach(([y, h, c]) => out.push(R(0, y, SW, h, c)));
  for (let x = 0; x < SW; x += PX * 2) out.push(R(x + (prand(x) > .5 ? PX : 0), HORIZON - PX, PX, PX, '#b3dc6b'));
  // Hoa nhỏ rải trên cỏ
  for (let i = 0; i < 40; i++) {
    const x = q(prand(i) * SW), c = roadC(x), y = prand(i + 50) > .35 ? q(c + 22 + prand(i + 91) * (SH - c - 46)) : q(HORIZON + 6 + prand(i + 17) * Math.max(0, c - HORIZON - 26));
    out.push(bmp(x, y, FLOWER, { F: i % 3 ? '#f4a6da' : '#ffffff', C: '#ffe27a' }, 3));
  }
  // Đường đất: mỗi cột 5 ô (viền trên, 3 ô giữa, viền dưới), vạch trắng đứt quãng ở hàng giữa
  const mx = l.done ? S.goal : S.start + l.frac * (S.goal - S.start);
  for (let x = 0, i = 0; x < SW; x += PX, i++) {
    const c = roadC(x + PX / 2);
    out.push(R(x, c - 10, PX, PX, '#b5894f'), R(x, c - 5, PX, 15, '#ecd39c'), R(x, c + 10, PX, PX, '#c99c5f'));
    if (x >= S.start && x + PX <= mx) out.push(R(x, c, PX, PX, '', 'px-trail'));            // quãng đã đi
    else if (i % 7 < 3) out.push(R(x, c, PX, PX, '#fff7e3'));
  }
  // Cỏ mọc ven mép đường
  for (let x = 10; x < SW; x += 45) { const c = roadC(x); out.push(R(q(x), c - 15, PX, PX, '#6fb64a'), R(q(x) + PX * 2, c - 15, PX, PX, '#6fb64a')); }
  // Bụi cây hoa ở tiền cảnh
  for (let x = -10, i = 0; x < SW; x += 58 + q(prand(i + 3) * 30), i++) out.push(bmp(q(x), SH - 20, BUSH, { G: '#2f6e46', F: i % 2 ? '#f4a6da' : '#ffc6e8' }));
  // Mốc: vạch xuất phát, cờ ca-rô tại mốc 1, biển khoá các mốc sau, cờ vàng ở đích 5 sao
  const sc = roadC(S.start), gc = roadC(S.goal), fc = roadC(S.final);
  out.push(R(q(S.start), sc - 5, PX, 15, '#ffffff'));
  out.push(R(q(S.goal) - 2, gc - 90, 5, 80, '#6b4a2b'), `<rect x="${q(S.goal) + 3}" y="${gc - 90}" width="30" height="20" fill="url(#chk-${k})"/>`);
  out.push(sign(S.goal, `Mốc 1 · ${vn2(l.to)}${STAR}`, { rise: 60, fill: l.done ? '#5fb47a' : '#c99257' }));
  const n = future.length;
  future.forEach((v, j) => out.push(sign(S.goal + (S.final - S.goal) * (j + 1) / (n + 1), `${vn1(v)}${STAR}`, { lock: true })));
  const hasFinal = Number.isFinite(finalGoal);
  if (hasFinal) {
    out.push(R(q(S.final) - 2, fc - 90, 5, 80, '#6b4a2b'), bmp(q(S.final) + 3, fc - 90, GOLDFLAG, { Y: '#f2b33d', O: '#9a6a12' }));
    out.push(sign(S.final, `Đích ${String(finalGoal).replace('.', ',')}${STAR}`, { rise: 55, lock: true }));
  }
  const fogX = S.goal + 58;                                   // mốc 1 (cả biển) giữ màu; từ đây trở đi chuyển xám
  const aria = `${esc(cfg.label)}: ${Math.floor(l.frac * 100)}% chặng tới mốc 1 (${vn1(l.to)} sao). Các mốc sau: ${future.map(vn1).join(', ')}${hasFinal ? '. Đích ' + finalGoal + ' sao' : ''}.`;
  const my = roadC(mx);
  return `<div class="scene-box" data-k="${k}">
    <div class="scene-wrap" tabindex="0" aria-label="Đường đua, vuốt ngang để xem các mốc tiếp theo">
      <div class="scene">
        <svg width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}" shape-rendering="crispEdges" role="img" aria-label="${aria}">
          <defs>
            <filter id="gray-${k}" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/>
              <feComponentTransfer><feFuncR type="linear" slope=".82" intercept=".14"/><feFuncG type="linear" slope=".82" intercept=".14"/><feFuncB type="linear" slope=".82" intercept=".14"/></feComponentTransfer></filter>
            <linearGradient id="gm-${k}" gradientUnits="userSpaceOnUse" x1="${fogX}" y1="0" x2="${fogX + 45}" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>
            <mask id="m-${k}" maskUnits="userSpaceOnUse" x="0" y="0" width="${SW}" height="${SH}"><rect x="${fogX}" y="0" width="${SW - fogX}" height="${SH}" fill="url(#gm-${k})"/></mask>
            <pattern id="chk-${k}" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#fff"/><rect width="5" height="5" fill="#3b2a35"/><rect x="5" y="5" width="5" height="5" fill="#3b2a35"/></pattern>
          </defs>
          <g id="art-${k}">${out.join('')}</g>
          <!-- Sau mốc 1: vẽ lại cùng cảnh nhưng xám (chưa mở), chuyển dần từ màu sang xám -->
          <use href="#art-${k}" filter="url(#gray-${k})" mask="url(#m-${k})"/>
        </svg>
        <i class="runner" style="left:${Math.round(mx - 40)}px;top:${my - 47}px"></i>
      </div>
    </div>
    <button class="swipe-hint" type="button"><span class="a">Vuốt sang xem mốc tiếp theo <i>›</i></span><span class="b">‹ Quay lại mốc 1</span></button>
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

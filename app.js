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
    let lane = '';
    if (l) {
      const pct = l.frac * 100, pos = Math.max(6, Math.min(97, pct));
      const foot = l.done ? `<b>Đã về đích ✓</b>`
        : l.pend ? `<span>Đang xác nhận <b>${int(l.pend.hits)}/${int(needRuns())}</b> lần cập nhật</span>`
        : `<span>Hiện tại <b>${l.score != null ? vn3(l.score) : '—'}</b></span>`;
      lane = `<div class="lane ${l.done ? 'done' : ''}">
        <div class="lane-top"><span>Tiến độ về đích</span><span class="goal"><b>${Math.floor(pct)}%</b> chặng</span></div>
        <div class="lane-track" role="img" aria-label="${esc(cfg.label)}: ${Math.floor(pct)}% chặng tới ${vn1(l.to)} sao">
          <i class="lane-fill" style="width:${pct}%"></i>
          <img class="racer" src="assets/loading.gif" alt="" style="left:${pos}%">
        </div>
        <div class="lane-marks"><span class="fin">Đích ${vn2(l.to)}<i class="star">★</i></span></div>
        <div class="lane-foot">${foot}<span>${l.done ? '' : `Còn <b>${l.score != null ? vn3(Math.max(0, l.to - l.score)) : '—'}</b> điểm`}</span></div>
      </div>`;
    }
    // Chặng tiếp theo (teaser "to be continued"): các mốc cấu hình ở stores.*.future, đích cuối CFG.finalGoal
    const future = (Array.isArray(cfg.future) ? cfg.future : []).map(Number).filter(Number.isFinite);
    const finalGoal = Number(CFG.finalGoal);
    const lock = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>';
    const more = (future.length || Number.isFinite(finalGoal)) ? `<div class="more">
        <div class="more-head"><span>Chặng tiếp theo</span><em>To be continued…</em></div>
        <div class="more-track"><i class="more-line"></i>
          ${future.map(v => `<span class="mnode"><i class="dot">${lock}</i><b>${vn1(v)}<i class="star">★</i></b></span>`).join('')}
          ${Number.isFinite(finalGoal) ? `<span class="mgoal"><img src="assets/nikki-goal.png" alt="" width="220" height="252"><b>${vn1(finalGoal).replace(',0', '')}<i class="star">★</i></b></span>` : ''}
        </div>
      </div>` : '';
    return `<div class="panel ${k}" role="tabpanel" id="panel-${k}" aria-labelledby="tab-${k}" ${k === ACTIVE ? '' : 'hidden'}>
      <div class="score-row">
        <div class="score">${disp != null ? vn1(disp) : '—'}</div>
        <div><div class="store-name">${esc(cfg.label)}</div>
          <div class="stars">★★★★★<span style="width:${starPct}%">★★★★★</span></div>
          <div class="count">${s.count ? fmt.format(s.count) + ' lượt đánh giá' : ''}</div></div>
      </div>
      ${lane}
      ${more}
      ${s.error ? `<div class="err">Lần cập nhật gần nhất bị lỗi, đang hiện số cũ.</div>` : ''}
      <div class="cta">
        <a class="badge" href="${safeUrl(cfg.reviewUrl || cfg.url)}" target="_blank" rel="noopener noreferrer"><img src="${badge}" alt="Tải và đánh giá trên ${esc(cfg.label)}" width="150" height="47"></a>
        <a class="btn-ghost" href="${safeUrl(cfg.url)}" target="_blank" rel="noopener noreferrer">Xem đánh giá</a>
      </div>
    </div>`;
  };

  const el = document.getElementById('race');
  el.innerHTML = `${done ? `<span class="status">Đã về đích · ${fmtDT(done.openedAt)}</span>` : ''}
    <div class="tabs" role="tablist">${tabs}</div>
    ${keys.map(panel).join('')}`;
  el.querySelectorAll('.tab').forEach(b => b.onclick = () => select(b.id.slice(4)));
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

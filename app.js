// Renders data/posts.json (written daily by the routine) and data/status.json. No keys, no
// third-party requests: everything is same-origin except the Google Fonts stylesheet.
const STALE_DAYS = 2;
let currentView = 'timeline';
let analysisData = null;
let PHASES = [];

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function getSentiment(p){ return p.sentiment; }

function phaseOf(dateStr){ return PHASES.find(ph=> ph.start <= dateStr && (ph.end===null || dateStr <= ph.end)); }
function fmtD(d){ return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
function fmtRange(ph){ return fmtD(ph.start)+' – '+(ph.end ? fmtD(ph.end) : 'now'); }

function showTip(e, html){ const t=document.getElementById('tip'); t.innerHTML=html; t.style.left=e.clientX+'px'; t.style.top=e.clientY+'px'; t.style.opacity='1'; }
function hideTip(){ const t=document.getElementById('tip'); if(t) t.style.opacity='0'; }

// ── ORCHESTRATOR ──
function renderAll(analysis){
  analysisData = analysis;
  renderHero(analysis);
  renderStats(analysis.posts, analysis.clusters.length);
  renderSentiment(analysis);
  renderTimeline(analysis);
  if(currentView === 'graph') renderGraph(analysis);
}

// ── HERO CONTRADICTION COUNTER ──
function renderHero(analysis){
  const posts = analysis.posts || [];
  const links = posts.reduce((s,p)=> s + ((p.contradicts && p.contradicts.length) || 0), 0);
  const withContra = posts.filter(p=> p.contradicts && p.contradicts.length).length;
  const clusters = analysis.clusters.slice().sort((a,b)=> b.posts.length - a.posts.length);
  const maxC = Math.max(1, ...clusters.map(c=>c.posts.length));
  const brk = clusters.map(c=>`
    <div class="brk-item">
      <div class="brk-label">${esc(c.label)}</div>
      <div class="brk-count">${c.posts.length}</div>
      <div class="brk-bar"><div class="brk-fill" style="width:${Math.round(100*c.posts.length/maxC)}%"></div></div>
    </div>`).join('');
  document.getElementById('heroCounter').innerHTML = `
    <div class="hero-grid">
      <div>
        <div class="hero-overline">Times Trump Contradicted or Reversed Himself on Iran</div>
        <div class="hero-num" id="heroNum">0</div>
        <div class="hero-caption">documented <strong>contradictions and reversals</strong> across ${posts.length} verbatim posts</div>
        <div class="hero-sub">${withContra} of ${posts.length} posts reverse or undercut an earlier statement</div>
      </div>
      <div>
        <div class="hero-breakdown-h">Where the story turns on itself</div>
        <div class="brk-list">${brk || '<div class="hero-sub">No clusters detected.</div>'}</div>
      </div>
    </div>`;
  animateCount(document.getElementById('heroNum'), links);
}
function animateCount(el, target){
  if(!el) return;
  const dur = 1200, t0 = performance.now();
  function step(now){
    const k = Math.min(1, (now-t0)/dur);
    const e = 1 - Math.pow(1-k, 3);
    el.textContent = Math.round(e*target);
    if(k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function renderStats(posts, clusterCount) {
  const n = cat => posts.filter(p=> p.category===cat).length;
  const stats = { contradictions: posts.filter(p=> p.contradicts.length).length, escalations: n('escalation'),
    deescalations: n('deescalation'), threats: n('threat'), claims: n('claim') };
  document.getElementById('statsRow').innerHTML = `
    <div class="stat red"><div class="stat-val">${stats.contradictions||0}</div><div class="stat-label">Contradicting / Reversing Posts</div></div>
    <div class="stat orange"><div class="stat-val">${stats.escalations||0}</div><div class="stat-label">Escalations</div></div>
    <div class="stat green"><div class="stat-val">${stats.deescalations||0}</div><div class="stat-label">De-escalations</div></div>
    <div class="stat yellow"><div class="stat-val">${stats.threats||0}</div><div class="stat-label">Threats / Ultimatums</div></div>
    <div class="stat blue"><div class="stat-val">${stats.claims||0}</div><div class="stat-label">Claims / Assertions</div></div>
    <div class="stat gold"><div class="stat-val">${clusterCount||0}</div><div class="stat-label">Contradiction Clusters</div></div>
  `;
}

// ── SENTIMENT-OVER-TIME CHART ──
function renderSentiment(analysis){
  const wrap = document.getElementById('sentChartWrap');
  const posts = [...(analysis.posts||[])].sort((a,b)=> new Date(a.date) - new Date(b.date));
  if(!posts.length){ wrap.innerHTML=''; return; }
  const W=1000, H=280, padL=78, padR=18, padT=16, padB=30;
  const plotW=W-padL-padR, plotH=H-padT-padB;
  const times = posts.map(p=> new Date(p.date).getTime());
  const minT=Math.min(...times), maxT=Math.max(...times);
  const xOf = t => padL + (maxT===minT ? plotW/2 : plotW*(t-minT)/(maxT-minT));
  const yOf = s => padT + plotH*(1-(s+1)/2);
  const zeroY = yOf(0);
  const sent = posts.map(getSentiment);
  const roll = sent.map((_,i)=>{ const a=sent.slice(Math.max(0,i-2), i+1); return a.reduce((x,y)=>x+y,0)/a.length; });
  const pts = posts.map((p,i)=>({ x:xOf(times[i]), y:yOf(roll[i]) }));
  const linePts = pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `M ${pts[0].x.toFixed(1)},${zeroY.toFixed(1)} ` + pts.map(p=>`L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ` L ${pts[pts.length-1].x.toFixed(1)},${zeroY.toFixed(1)} Z`;

  let grid='';
  let m = new Date(new Date(minT).getFullYear(), new Date(minT).getMonth(), 1);
  while(m.getTime() <= maxT){
    const t=m.getTime();
    if(t>=minT){ const x=xOf(t);
      grid += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${(padT+plotH).toFixed(1)}" stroke="rgba(255,255,255,0.05)"/>`+
              `<text class="sent-axis-label" x="${x.toFixed(1)}" y="${(padT+plotH+18).toFixed(1)}" text-anchor="middle">${m.toLocaleDateString('en-US',{month:'short'})}</text>`;
    }
    m = new Date(m.getFullYear(), m.getMonth()+1, 1);
  }
  const ylabels = [[1,'+1 conciliatory'],[0,'0 neutral'],[-1,'−1 hostile']]
    .map(([v,lab])=>`<text class="sent-axis-label" x="6" y="${(yOf(v)+3).toFixed(1)}">${lab}</text>`).join('');
  const dots = posts.map((p,i)=>`<circle class="sent-point" data-i="${i}" cx="${xOf(times[i]).toFixed(1)}" cy="${yOf(sent[i]).toFixed(1)}" r="4" fill="${catColor(p.category)}" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>`).join('');

  wrap.innerHTML = `<svg id="sentChart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#34d399" stop-opacity="0.34"/>
      <stop offset="50%" stop-color="#e9c46a" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#ef4444" stop-opacity="0.34"/>
    </linearGradient></defs>
    ${grid}
    <line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${W-padR}" y2="${zeroY.toFixed(1)}" stroke="rgba(255,255,255,0.18)" stroke-dasharray="3,4"/>
    ${ylabels}
    <path d="${area}" fill="url(#sentGrad)"/>
    <polyline points="${linePts}" fill="none" stroke="#e9c46a" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
  </svg>`;

  wrap.querySelectorAll('.sent-point').forEach(c=>{
    c.addEventListener('mousemove', e=>{
      const p = posts[+c.dataset.i], sv = getSentiment(p);
      showTip(e, `<div class="t-date">${p.date} · #${p.id}</div><div class="t-text">“${esc(p.text.slice(0,150))}${p.text.length>150?'…':''}”</div><div class="t-row">${esc(p.category)} · sentiment ${(sv>0?'+':'')+sv.toFixed(2)}</div>`);
      c.setAttribute('r','6');
    });
    c.addEventListener('mouseleave', ()=>{ hideTip(); c.setAttribute('r','4'); });
  });
}

// ── TIMELINE (FILTERS + PHASE ACCORDIONS) ──
let filterState = { category:'all', contradictionsOnly:false };
function applyFilter(p){
  if(filterState.contradictionsOnly && !(p.contradicts && p.contradicts.length)) return false;
  if(filterState.category!=='all' && (p.category||'neutral')!==filterState.category) return false;
  return true;
}
function onFilterChange(){
  const sel=document.getElementById('catFilter'), chk=document.getElementById('contraOnly');
  if(sel) filterState.category = sel.value;
  if(chk) filterState.contradictionsOnly = chk.checked;
  if(analysisData) renderTimeline(analysisData);
}
function togglePhase(el){ el.closest('.phase').classList.toggle('open'); }
function expandAllPhases(open){ document.querySelectorAll('#timelineContent .phase').forEach(p=>p.classList.toggle('open', open)); }

function renderPost(post){
  const cat = post.category || 'neutral';
  const has = post.contradicts && post.contradicts.length;
  const s = getSentiment(post);
  const slabel = (s>0?'+':'') + s.toFixed(2);
  const aClass = cat==='deescalation' ? 'ok' : (cat==='contradiction' ? 'bad' : (cat==='threat'||cat==='escalation' ? 'warn' : ''));
  return `<div class="tl-item ${cat}">
    <div class="tl-meta">
      <span class="tl-idx">#${post.id}</span>
      <span class="tl-date">${esc(post.date)}</span>
      <span class="tag ${cat}">${esc(cat)}</span>
      <a class="tag verbatim" href="${esc(post.url)}" target="_blank" rel="noopener">Verbatim · source ↗</a>
      <span class="tag sentiment">sentiment ${slabel}</span>
      ${has?`<span class="tag contradiction">⚡ contradicts #${post.contradicts.join(', #')}</span>`:''}
    </div>
    <div class="tl-text">“${esc(post.text)}”</div>
    ${post.analysis?`<div class="tl-analysis ${aClass}">${esc(post.analysis)}</div>`:''}
    ${has && post.contradictionReason?`<div class="contradicts-badge">⚡ ${esc(post.contradictionReason)}</div>`:''}
  </div>`;
}

function renderTimeline(analysis) {
  const container = document.getElementById('timelineContent');
  const posts = [...(analysis.posts||[])].sort((a,b)=> new Date(a.date) - new Date(b.date));
  let html = '';

  if(analysis.summary){
    html += `<div class="summary-card"><div class="sc-h">The Arc</div><div class="sc-body">${esc(analysis.summary)}</div></div>`;
  }
  if(analysis.clusters.length){
    html += `<div class="cluster-callout"><div class="cc-h">⚡ Contradiction Clusters</div>${
      analysis.clusters.map(c=>`<div class="cc-item"><span class="cc-label">${esc(c.label)}</span><span class="cc-posts">#${c.posts.join(', #')}</span><div class="cc-desc">${esc(c.description)}</div></div>`).join('')
    }</div>`;
  }

  const cats = ['all','contradiction','escalation','deescalation','threat','claim','neutral'];
  html += `<div class="filter-bar">
    <label>Filter</label>
    <select id="catFilter" onchange="onFilterChange()">${cats.map(c=>`<option value="${c}" ${filterState.category===c?'selected':''}>${c==='all'?'All categories':c.charAt(0).toUpperCase()+c.slice(1)}</option>`).join('')}</select>
    <label class="chk ${filterState.contradictionsOnly?'on':''}"><input type="checkbox" id="contraOnly" ${filterState.contradictionsOnly?'checked':''} onchange="onFilterChange()"> Contradictions only</label>
    <button class="btn btn-secondary" onclick="expandAllPhases(true)">Expand all</button>
    <button class="btn btn-secondary" onclick="expandAllPhases(false)">Collapse all</button>
  </div>`;

  const filtered = posts.filter(applyFilter);
  const anyFilter = filterState.category!=='all' || filterState.contradictionsOnly;
  let body = '';
  PHASES.forEach((ph, pi)=>{
    const inPhase = filtered.filter(p=> phaseOf(p.date)===ph);
    if(!inPhase.length) return;
    const contraN = inPhase.filter(p=> p.contradicts && p.contradicts.length).length;
    const open = anyFilter ? true : (pi === PHASES.length-1);
    body += `<div class="phase ${open?'open':''}">
      <div class="phase-head" onclick="togglePhase(this)">
        <div class="phase-chevron">▶</div>
        <div class="phase-titles"><div class="pt-name">${esc(ph.name)}</div><div class="pt-range">${fmtRange(ph)}</div></div>
        <div class="phase-meta">
          ${contraN?`<span class="phase-flag">⚡ ${contraN} contradicting</span>`:''}
          <span class="phase-count">${inPhase.length} post${inPhase.length>1?'s':''}</span>
        </div>
      </div>
      <div class="phase-body">
        <div class="phase-summary">${esc(ph.note)}</div>
        <div class="timeline">${inPhase.map(renderPost).join('')}</div>
      </div>
    </div>`;
  });
  if(!body) body = `<div class="empty-state" style="min-height:180px"><p>No posts match the current filter.</p></div>`;
  html += body;
  container.innerHTML = html;
}

function renderGraph(analysis) {
  const inner = document.getElementById('graphInner');
  const svg = document.getElementById('edgeSvg');
  const posts = [...(analysis.posts||[])].sort((a,b)=> new Date(a.date) - new Date(b.date));
  const cols = 3;
  const nodeW = 300, nodeH = 168, gapX = 56, gapY = 42;
  const padX = 32, padY = 32;

  let nodesHTML = '';
  const positions = {};

  posts.forEach((post, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = padX + col * (nodeW + gapX);
    const y = padY + row * (nodeH + gapY);
    positions[post.id] = { x: x + nodeW/2, y: y + nodeH/2, left: x, top: y };

    nodesHTML += `
      <div class="node" id="node-${post.id}" style="left:${x}px;top:${y}px;border-top:2px solid ${catColor(post.category)}">
        <div class="node-date">${post.date}</div>
        <div class="node-text">${esc(post.text.slice(0,120))}${post.text.length>120?'…':''}</div>
        <div class="node-tags">
          <span class="tag ${post.category}">${post.category}</span>
          ${post.contradicts&&post.contradicts.length?`<span class="tag contradiction">⚡</span>`:''}
        </div>
      </div>`;
  });

  const totalRows = Math.ceil(posts.length / cols);
  const totalH = padY + totalRows * (nodeH + gapY) + 80;
  const totalW = padX + cols * (nodeW + gapX) + 80;
  inner.style.height = totalH + 'px';
  inner.style.width = Math.max(totalW, inner.parentElement.clientWidth) + 'px';
  inner.querySelectorAll('.node').forEach(n=>n.remove());
  inner.insertAdjacentHTML('beforeend', nodesHTML);
  svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
  svg.style.width = totalW+'px';
  svg.style.height = totalH+'px';

  // Draw edges for contradictions
  let edgesHTML = '';
  posts.forEach(post => {
    if(!post.contradicts || !post.contradicts.length) return;
    const from = positions[post.id];
    if(!from) return;
    post.contradicts.forEach(targetIdx => {
      const to = positions[targetIdx];
      if(!to) return;
      edgesHTML += `<line x1="${from.x}" y1="${from.top+40}" x2="${to.x}" y2="${to.top+40}"
        stroke="#ef4444" stroke-width="1.5" stroke-dasharray="4,4" opacity="0.55"/>
        <circle cx="${from.x}" cy="${from.top+40}" r="3" fill="#ef4444" opacity="0.75"/>
        <circle cx="${to.x}" cy="${to.top+40}" r="3" fill="#ef4444" opacity="0.75"/>`;
    });
  });
  // Draw sequential flow
  for(let i=0;i<posts.length-1;i++) {
    const from = positions[posts[i].id];
    const to = positions[posts[i+1].id];
    if(!from||!to) continue;
    edgesHTML += `<line x1="${from.x}" y1="${from.top+nodeH-20}" x2="${to.x}" y2="${to.top+20}"
      stroke="rgba(255,255,255,0.14)" stroke-width="1" opacity="0.7"/>`;
  }
  svg.innerHTML = edgesHTML;
}

function catColor(cat) {
  const map = {contradiction:'#ef4444',escalation:'#f59e0b',deescalation:'#34d399',threat:'#eab308',claim:'#8ab4ff',neutral:'#5d6477'};
  return map[cat]||'#5d6477';
}

function setView(v) {
  currentView = v;
  ['timeline','graph'].forEach(name => {
    document.getElementById(`${name}-view`).style.display = name===v ? 'block' : 'none';
    document.getElementById(`vbtn-${name}`).classList.toggle('active', name===v);
  });
  if(v==='graph' && analysisData) renderGraph(analysisData);
}

function renderFreshness(status, posts){
  document.getElementById('updated').textContent = `Updated ${fmtLong(status.lastSuccess)}`;
  document.getElementById('byline').textContent =
    `Source · trumpstruth.org archive — ${fmtLong(posts[0].date)} → ${fmtLong(status.coveredThrough)} · Logic & sentiment analysis by Claude`;
  const ageDays = Math.floor((Date.now() - new Date(status.lastSuccess+'T00:00:00Z').getTime()) / 864e5);
  if(ageDays > STALE_DAYS){
    const b = document.getElementById('staleBanner');
    b.textContent = `Heads up: this tracker was last updated ${ageDays} days ago, so the newest posts may be missing.`;
    b.hidden = false;
  }
}
function fmtLong(d){ return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }

async function boot(){
  try {
    const get = f => fetch(f, {cache:'no-cache'}).then(r=> { if(!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.json(); });
    const [data, status] = await Promise.all([get('data/posts.json'), get('data/status.json')]);
    PHASES = data.phases;
    renderFreshness(status, data.posts);
    document.getElementById('results').style.display = 'block';
    renderAll(data);
    setView('timeline');
  } catch(e) {
    const el = document.getElementById('error-state');
    el.innerHTML = `<div class="error-box"><strong>Could not load the tracker data.</strong> ${esc(e.message)}</div>`;
    el.style.display = 'block';
  }
}
boot();

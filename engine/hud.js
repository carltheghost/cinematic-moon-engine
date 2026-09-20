/* engine/hud.js — FPS / tier HUD overlay (Phase 0).
 *
 * Vanilla DOM, no dependencies. Shows: rolling fps, frame-time p95,
 * current tier, draw calls (renderer.info when a renderer exists), and a
 * log area where tier auto-select / watchdog decisions are printed.
 *
 * All timing values are fed in by the host (update(stats)); the HUD never
 * reads a clock. Phase 0 has no renderer yet, so draw calls read "n/a".
 */

const CSS = `
#cme-hud{position:fixed;left:12px;top:12px;z-index:50;min-width:230px;max-width:min(320px,80vw);
font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#cfe3ff;
background:rgba(6,10,18,.72);border:1px solid rgba(130,170,220,.25);border-radius:8px;
padding:10px 12px;backdrop-filter:blur(6px);pointer-events:none;user-select:none}
#cme-hud h1{font-size:11px;margin:0 0 6px;letter-spacing:.12em;color:#8fb4e8;font-weight:600}
#cme-hud .row{display:flex;justify-content:space-between;gap:12px;white-space:nowrap}
#cme-hud .row b{font-weight:600;color:#fff}
#cme-hud .tier-cinematic{color:#9fe8b0}#cme-hud .tier-balanced{color:#ffd479}
#cme-hud .tier-efficient{color:#ff9d6b}#cme-hud .tier-still{color:#9aa7bd}
#cme-hud pre{margin:8px 0 0;padding-top:8px;border-top:1px solid rgba(130,170,220,.18);
max-height:120px;overflow:hidden auto;white-space:pre-wrap;word-break:break-word;color:#9fb8d8}
#cme-hud pre .t{color:#5f7191}
`;

export class Hud {
  constructor() {
    this._el = null;
    this._fpsEl = null;
    this._p95El = null;
    this._tierEl = null;
    this._drawEl = null;
    this._logEl = null;
    this._lines = [];
    this._logCount = 0;
  }

  mount(host = document.body) {
    if (this._el) return this._el;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.id = 'cme-hud';
    el.innerHTML = `
      <h1>CINEMATIC MOON · HUD</h1>
      <div class="row"><span>fps (rolling)</span><b data-k="fps">—</b></div>
      <div class="row"><span>frame p95</span><b data-k="p95">—</b></div>
      <div class="row"><span>tier</span><b data-k="tier">—</b></div>
      <div class="row"><span>draw calls</span><b data-k="draw">—</b></div>
      <pre data-k="log" aria-live="polite"></pre>`;
    host.appendChild(el);
    this._el = el;
    this._fpsEl = el.querySelector('[data-k="fps"]');
    this._p95El = el.querySelector('[data-k="p95"]');
    this._tierEl = el.querySelector('[data-k="tier"]');
    this._drawEl = el.querySelector('[data-k="draw"]');
    this._logEl = el.querySelector('[data-k="log"]');
    return el;
  }

  /** Append a timestamped line to the log area (and keep a JS copy). */
  log(message) {
    const line = String(message);
    this._lines.push(line);
    if (this._lines.length > 40) this._lines.shift();
    this._logCount++;
    if (this._logEl) {
      const div = document.createElement('div');
      div.textContent = line;
      this._logEl.appendChild(div);
      while (this._logEl.children.length > 40) this._logEl.firstChild.remove();
      this._logEl.scrollTop = this._logEl.scrollHeight;
    }
    return line;
  }

  /**
   * @param {object} s { fps, p95Ms, tier, drawCalls|null, rendererInfo? }
   */
  update(s = {}) {
    if (!this._el) return;
    if (this._fpsEl) this._fpsEl.textContent = s.fps != null ? s.fps.toFixed(1) : '—';
    if (this._p95El) this._p95El.textContent = s.p95Ms != null ? `${s.p95Ms.toFixed(2)} ms` : '—';
    if (this._tierEl) {
      this._tierEl.textContent = s.tier || '—';
      this._tierEl.className = s.tier ? `tier-${s.tier}` : '';
    }
    if (this._drawEl) {
      this._drawEl.textContent =
        s.drawCalls != null ? String(s.drawCalls) : 'n/a (Phase 0 — no renderer)';
    }
  }

  get logCount() { return this._logCount; }
  get lines() { return [...this._lines]; }
}

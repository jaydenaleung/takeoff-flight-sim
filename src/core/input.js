// Keyboard, mouse and gamepad input. Continuous axes are smoothed so keys behave like a
// spring-centred stick; discrete controls are delivered as named actions.
import { clamp, moveToward } from './units.js';

const ACTIONS = {
  KeyG: 'gear', BracketLeft: 'flapsUp', BracketRight: 'flapsDown', KeyP: 'parkBrake',
  KeyZ: 'autopilot', KeyX: 'autothrottle', KeyY: 'directLaw', KeyI: 'engines', KeyL: 'lights',
  KeyC: 'viewNext', Digit1: 'view:cockpit', Digit2: 'view:chase', Digit3: 'view:tower', Digit4: 'view:flyby', Digit5: 'view:wing',
  KeyH: 'help', KeyN: 'map', Escape: 'pause', Minus: 'timeDown', Equal: 'timeUp', KeyM: 'mouseYoke',
  Tab: 'comSwap', Enter: 'radioText', Home: 'throttleFull', End: 'throttleIdle',
  F1: 'atc:0', F2: 'atc:1', F3: 'atc:2', F4: 'atc:3', F5: 'atc:4', F6: 'atc:5', F7: 'atc:6', F8: 'atc:7',
  KeyT: 'ilsTune', KeyV: 'approach', KeyK: 'hudToggle',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.axes = { pitch: 0, roll: 0, yaw: 0 };
    this.throttleRate = 0;
    this.brake = 0;
    this.reverse = false;
    this.trim = 0;
    this.ptt = false;
    this.mouseYoke = false;
    this.mouse = { x: 0, y: 0 };
    this.handlers = {};
    this.onOrbit = null; this.onZoom = null;
    this.enabled = false;
    this.gpPrev = [];

    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.ptt = false; });
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('pointermove', (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
      if (drag && !this.mouseYoke) {
        if (this.onOrbit) this.onOrbit(e.clientX - drag.x, e.clientY - drag.y);
        drag.x = e.clientX; drag.y = e.clientY;
      }
    });
    canvas.addEventListener('wheel', (e) => { if (this.onZoom) this.onZoom(e.deltaY); e.preventDefault(); }, { passive: false });
  }
  on(action, fn) { this.handlers[action] = fn; return this; }
  fire(action) {
    const [name, arg] = action.split(':');
    const h = this.handlers[name];
    if (h) h(arg);
  }
  key(e, down) {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (typing) { if (e.code === 'Escape' && down) t.blur(); return; }
    if (!this.enabled) { if (down && e.code === 'Escape') this.fire('pause'); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    if (/^(Arrow|Page|Home|End|Tab|Space|Slash|F[1-8]$|Quote|Backspace)/.test(code)) e.preventDefault();
    if (down) {
      if (this.keys.has(code)) return;          // ignore auto-repeat
      this.keys.add(code);
      if (code === 'Slash') this.fire(e.shiftKey ? 'spoilerArm' : 'speedbrake');
      else if (code === 'Space') { this.ptt = true; this.fire('pttDown'); }
      else if (ACTIONS[code]) this.fire(ACTIONS[code]);
    } else {
      this.keys.delete(code);
      if (code === 'Space') { this.ptt = false; this.fire('pttUp'); }
    }
  }
  update(dt) {
    const k = this.keys, a = this.axes;
    let tp = 0, tr = 0, ty = 0;
    if (k.has('ArrowDown')) tp += 1;
    if (k.has('ArrowUp')) tp -= 1;
    if (k.has('ArrowRight')) tr += 1;
    if (k.has('ArrowLeft')) tr -= 1;
    if (k.has('KeyE')) ty += 1;
    if (k.has('KeyQ')) ty -= 1;
    let usedMouse = false;
    if (this.mouseYoke) {
      const dz = (v) => (Math.abs(v) < 0.04 ? 0 : (v - Math.sign(v) * 0.04) / 0.96);
      if (tr === 0) { tr = clamp(dz(this.mouse.x) * 1.6, -1, 1); usedMouse = true; }
      if (tp === 0) { tp = clamp(dz(this.mouse.y) * 1.6, -1, 1); usedMouse = true; }
    }
    this.throttleRate = (k.has('PageUp') || k.has('KeyW') ? 1 : 0) - (k.has('PageDown') || k.has('KeyS') ? 1 : 0);
    this.brake = k.has('KeyB') ? 1 : 0;
    this.reverse = k.has('KeyR');
    this.trim = (k.has('Period') ? 1 : 0) - (k.has('Comma') ? 1 : 0);

    // gamepad (standard mapping)
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g && g.connected && g.axes.length >= 2) : null;
    let analog = false;
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.08 ? 0 : v);
      const gx = dz(gp.axes[0]), gy = dz(gp.axes[1]), gz = dz(gp.axes[2] || 0);
      if (gx || gy || gz) { tr = gx; tp = gy; ty = gz || ty; analog = true; }
      const b = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
      if (b(7) > 0.1 || b(6) > 0.1) this.throttleRate = b(7) - b(6);
      if (b(1) > 0.5) this.brake = 1;
      if (b(5) > 0.5) this.reverse = true;
      const edge = (i, action) => { const on = b(i) > 0.5; if (on && !this.gpPrev[i]) this.fire(action); this.gpPrev[i] = on; };
      edge(0, 'gear'); edge(2, 'flapsDown'); edge(3, 'flapsUp'); edge(4, 'speedbrake'); edge(9, 'pause'); edge(8, 'viewNext');
    }
    if (analog || usedMouse) {
      a.pitch = moveToward(a.pitch, tp, 6 * dt); a.roll = moveToward(a.roll, tr, 6 * dt); a.yaw = moveToward(a.yaw, ty, 4 * dt);
    } else {
      a.pitch = moveToward(a.pitch, tp, (tp === 0 ? 3.5 : 2.4) * dt);
      a.roll = moveToward(a.roll, tr, (tr === 0 ? 4 : 2.8) * dt);
      a.yaw = moveToward(a.yaw, ty, (ty === 0 ? 3.5 : 2.2) * dt);
    }
  }
}

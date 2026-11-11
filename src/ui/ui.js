// UI root (temporary minimal version while the world is brought up).
export class UI {
  constructor(app) { this.app = app; this.root = document.getElementById('ui'); this.loading = document.createElement('div'); this.loading.className = 'loading'; this.root.appendChild(this.loading); }
  bind() {}
  resize() {}
  showLoading(p, msg) { this.loading.style.display = 'flex'; this.loading.textContent = `${msg} ${Math.round(p * 100)}%`; }
  hideLoading() { this.loading.style.display = 'none'; }
  showMenu() { this.app.startFlight({ aircraft: 'b738', dep: 'KSFO', dest: 'KLAX', start: 'runway', hour: 10, weather: 'clear', fuel: 0.5, payload: 0.7 }); }
  updateMenu() {}
  startFlight() {}
  endFlight() {}
  update() {}
  fatal(e) { this.loading.style.display = 'flex'; this.loading.textContent = String(e); }
}

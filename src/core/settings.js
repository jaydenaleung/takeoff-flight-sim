// User settings, persisted in localStorage. The optional Anthropic API key lives only here,
// in the player's own browser; it is never bundled, committed or sent anywhere but the API.
const KEY = 'takeoff-settings-v1';
const DEFAULTS = {
  quality: 'high',
  masterVol: 0.6,
  voiceVol: 0.9,
  atcVoice: true,
  pilotVoice: true,
  damage: true,
  autoTune: false,
  aiAtc: false,
  claudeKey: '',
  claudeModel: 'claude-opus-5-5',
  aircraft: 'b738',
  dep: 'KSFO',
  dest: 'KLAX',
  start: 'gate',
  airline: 'UAL',
  flightNo: '',
  hour: 10,
  weather: 'scattered',
  fuel: 0.45,
  payload: 0.7,
  showHelpOnStart: true,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}
export const settings = load();
export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}

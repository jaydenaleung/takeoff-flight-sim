// Radio phraseology helpers. Every fragment carries both the written form shown in the radio log
// and the spoken form (ICAO digit pronunciation, FAA group-form call signs) for speech synthesis.
import { wrap360 } from '../core/units.js';
import { PHONETIC } from '../world/airports.js';

const DIGIT = ['zero', 'one', 'two', 'tree', 'four', 'fife', 'six', 'seven', 'eight', 'niner'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const PLAIN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export const part = (t, s) => ({ t, s: s ?? t });
/** Join strings and parts into { text, speech }. */
export function compose(parts) {
  let text = '', speech = '';
  for (const p of parts.flat(3)) {
    if (p == null || p === false) continue;
    if (typeof p === 'string' || typeof p === 'number') { text += p; speech += p; } else { text += p.t; speech += p.s; }
  }
  const tidy = (s) => s.replace(/\s+/g, ' ').replace(/ ,/g, ',').replace(/,\s*,/g, ',').trim();
  text = tidy(text); speech = tidy(speech);
  text = text.charAt(0).toUpperCase() + text.slice(1);
  text = text.replace(/([.!?] )([a-z])/g, (m, a, b) => a + b.toUpperCase());
  return { text, speech };
}
export const digits = (s) => String(s).split('').map((c) => (c >= '0' && c <= '9' ? DIGIT[+c] : c === '.' ? 'point' : c)).join(' ');
const twoDigit = (n) => (n < 10 ? PLAIN[n] : n < 20 ? TEENS[n - 10] : TENS[Math.floor(n / 10)] + (n % 10 ? `-${PLAIN[n % 10]}` : ''));
/** Flight numbers in FAA group form: 123 -> "one twenty-three", 2351 -> "twenty-three fifty-one". */
export function groupForm(num) {
  const s = String(num);
  if (s.length <= 2) return twoDigit(+s);
  if (s.length === 3) return +s.slice(1) < 10 ? digits(s) : `${PLAIN[+s[0]]} ${twoDigit(+s.slice(1))}`;
  if (s.length === 4) return (+s.slice(2) < 10 || +s.slice(0, 2) < 10) ? digits(s) : `${twoDigit(+s.slice(0, 2))} ${twoDigit(+s.slice(2))}`;
  return digits(s);
}
export function runway(id) {
  const m = id.match(/^(\d+)([LRC]?)$/);
  const side = { L: ' left', R: ' right', C: ' center', '': '' }[m[2]];
  return part(`runway ${id}`, `runway ${digits(m[1].padStart(2, '0'))}${side}`);
}
export function freq(f) {
  const t = f.toFixed(3).replace(/0{1,2}$/, '');
  return part(t, digits(t));
}
export function altitude(ft) {
  ft = Math.round(ft / 100) * 100;
  if (ft >= 18000) { const fl = Math.round(ft / 100); return part(`FL${fl}`, `flight level ${digits(fl)}`); }
  const th = Math.floor(ft / 1000), hu = (ft % 1000) / 100;
  const sp = (th ? `${digits(th)} thousand` : '') + (hu ? `${th ? ' ' : ''}${DIGIT[hu]} hundred` : '');
  return part(ft.toLocaleString('en-US'), sp);
}
export function heading(h) {
  let v = Math.round(wrap360(h) / 5) * 5;
  if (v === 0) v = 360;
  const s = String(v).padStart(3, '0');
  return part(`heading ${s}`, `heading ${digits(s)}`);
}
export const speed = (kt) => part(`${Math.round(kt)} knots`, `${digits(Math.round(kt))} knots`);
export function wind(dirMag, kt, gust) {
  if (kt < 3) return part('wind calm');
  let d = Math.round(wrap360(dirMag) / 10) * 10;
  if (d === 0) d = 360;
  const ds = String(d).padStart(3, '0');
  const g = gust && gust > kt + 4 ? [` gusting ${gust}`, ` gusts ${digits(gust)}`] : ['', ''];
  return part(`wind ${ds} at ${kt}${g[0]}`, `wind ${digits(ds)} at ${digits(kt)}${g[1]}`);
}
export const altimeter = (inHg) => part(`altimeter ${inHg.toFixed(2)}`, `altimeter ${digits(inHg.toFixed(2).replace('.', ''))}`);
export const squawk = (code) => part(`squawk ${code}`, `squawk ${digits(code)}`);
export const letter = (c) => part(PHONETIC[c] || c);
export const taxiways = (names) => part(names.join(', '), names.map((n) => n.split('').map((c) => PHONETIC[c] || digits(c)).join(' ')).join(', '));
export const number = (n) => part(String(n), digits(n));
export const miles = (n) => part(`${n} mile${n === 1 ? '' : 's'}`, `${twoDigit(Math.min(99, n))} mile${n === 1 ? '' : 's'}`);

export const AIRLINES = [
  { icao: 'UAL', tel: 'United' }, { icao: 'AAL', tel: 'American' }, { icao: 'DAL', tel: 'Delta' },
  { icao: 'SWA', tel: 'Southwest' }, { icao: 'ASA', tel: 'Alaska' }, { icao: 'JBU', tel: 'JetBlue' },
  { icao: 'BAW', tel: 'Speedbird' }, { icao: 'DLH', tel: 'Lufthansa' }, { icao: 'UAE', tel: 'Emirates' },
  { icao: 'AFR', tel: 'Air France' }, { icao: 'QFA', tel: 'Qantas' }, { icao: 'ANA', tel: 'All Nippon' },
  { icao: 'ACA', tel: 'Air Canada' }, { icao: 'KLM', tel: 'KLM' }, { icao: 'FDX', tel: 'FedEx' },
  { icao: 'UPS', tel: 'UPS' }, { icao: 'SIA', tel: 'Singapore' }, { icao: 'TKO', tel: 'Takeoff' },
];
export const TACTICAL = ['Viper', 'Raptor', 'Hornet', 'Lightning', 'Eagle', 'Knight', 'Ghost', 'Saber'];

/** Build a call sign: { text, speech, code } for an airliner or a military flight. */
export function makeCallsign(spec, airlineIcao, flightNo) {
  if (spec.type === 'fighter') {
    const base = TACTICAL.includes(airlineIcao) ? airlineIcao : { f16: 'Viper', f18: 'Hornet', f22: 'Raptor', f35: 'Lightning' }[spec.id];
    const n = String(flightNo || '11').replace(/\D/g, '').slice(0, 2).padEnd(2, '1');
    return { text: `${base} ${n[0]}${n[1]}`, speech: `${base} ${DIGIT[+n[0]]} ${DIGIT[+n[1]]}`, code: `${base.toUpperCase().slice(0, 5)}${n}`, part: part(`${base} ${n}`, `${base} ${DIGIT[+n[0]]} ${DIGIT[+n[1]]}`) };
  }
  const al = AIRLINES.find((a) => a.icao === airlineIcao) || AIRLINES[0];
  const num = String(flightNo || '').replace(/\D/g, '').slice(0, 4) || String(100 + ((spec.id.charCodeAt(1) * 37 + spec.id.charCodeAt(3) * 11) % 880));
  const wake = spec.wake === 'J' ? ' super' : spec.wake === 'H' ? ' heavy' : '';
  const text = `${al.tel} ${num}${wake}`, sp = `${al.tel} ${groupForm(num)}${wake}`;
  return { text, speech: sp, code: `${al.icao}${num}`, part: part(text, sp), short: part(`${al.tel} ${num}`, `${al.tel} ${groupForm(num)}`) };
}
export { twoDigit, DIGIT };

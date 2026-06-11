// Tests for parseSignal / cleanText / validateSignal in index.html
// Run: node tests/parser.test.js (from repo root)
//
// Extracts the parser block from index.html via string slicing and evals it
// in the test scope, so the source of truth stays a single file.

const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function parseSignal');
const end   = html.indexOf('function cleanText');
const endValidator = html.indexOf('// FIX #6');
if (start === -1 || end === -1 || endValidator === -1) {
  console.error('Cannot locate parser/validator block in index.html');
  process.exit(2);
}
// parseSignal + validateSignal + cleanText
eval(html.slice(start, endValidator));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok ', name); passed++; }
  catch (e) { console.log('  FAIL', name, '\n      ', e.message); failed++; }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error((msg || 'eq') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}
function truthy(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function falsy(v, msg)  { if (v)  throw new Error(msg || 'expected falsy');  }

console.log('\nparseSignal');

test('signal cerrado + annotations afuera (caso del bug histórico)', () => {
  const r = parseSignal(`
<signal>
{"action":"COMPRAR","entry":3980,"tp":4045,"sl":3925,"rr":2.0,"confidence":78,"reasoning":"OB+FVG"}
</signal>
<annotations>[{"type":"entry","x1":0,"y1":0.538,"x2":1,"y2":0.543,"price":3980},{"type":"sl","x1":0,"y1":0.961,"x2":1,"y2":0.966,"price":3925}]</annotations>`);
  truthy(r); eq(r.action, 'COMPRAR'); eq(r.annotations.length, 2);
});

test('signal abierto sin cerrar + annotations al final (truncado)', () => {
  const r = parseSignal(`
<signal>
{"action":"VENDER","entry":4000,"tp":3950,"sl":4030,"rr":1.7,"confidence":70,"reasoning":"FVG bear"}
<annotations>[{"type":"sl","x1":0,"y1":0.1,"x2":1,"y2":0.11,"price":4030}]</annotations>`);
  truthy(r); eq(r.action, 'VENDER'); eq(r.annotations.length, 1);
});

test('annotations dentro del JSON signal', () => {
  const r = parseSignal(`<signal>
{"action":"COMPRAR","entry":3980,"tp":4045,"sl":3925,"rr":2.0,"confidence":75,"reasoning":"x","annotations":[{"type":"entry","x1":0,"y1":0.5,"x2":1,"y2":0.51,"price":3980}]}
</signal>`);
  truthy(r); eq(r.annotations.length, 1);
});

test('ESPERAR sin annotations es válido', () => {
  const r = parseSignal(`<signal>{"action":"ESPERAR","reasoning":"lateral"}</signal>`);
  truthy(r); eq(r.action, 'ESPERAR');
});

test('sin tag <signal> retorna null', () => {
  falsy(parseSignal('Solo texto, sin tags.'));
});

test('JSON malformado retorna null', () => {
  falsy(parseSignal(`<signal>{"action":COMPRAR,broken}</signal>`));
});

console.log('\nvalidateSignal');

test('rechaza action inválida', () => {
  falsy(validateSignal({ action: 'MAYBE' }));
});

test('rechaza COMPRAR con SL arriba del entry', () => {
  falsy(validateSignal({ action: 'COMPRAR', entry: 3980, tp: 4045, sl: 4000 }));
});

test('rechaza VENDER con TP arriba del entry', () => {
  falsy(validateSignal({ action: 'VENDER', entry: 4000, tp: 4050, sl: 3970 }));
});

test('rechaza precios no numéricos', () => {
  falsy(validateSignal({ action: 'COMPRAR', entry: 'abc', tp: 4045, sl: 3925 }));
});

test('rechaza entry == sl', () => {
  falsy(validateSignal({ action: 'COMPRAR', entry: 3980, tp: 4045, sl: 3980 }));
});

test('rechaza precios <= 0', () => {
  falsy(validateSignal({ action: 'COMPRAR', entry: 0, tp: 4045, sl: -10 }));
});

test('acepta COMPRAR válido y normaliza confidence', () => {
  const r = validateSignal({ action: 'comprar', entry: 3980, tp: 4045, sl: 3925, confidence: 250 });
  truthy(r); eq(r.action, 'COMPRAR'); eq(r.confidence, 100);
});

test('acepta VENDER válido', () => {
  const r = validateSignal({ action: 'VENDER', entry: 4000, tp: 3950, sl: 4030, confidence: 72 });
  truthy(r); eq(r.confidence, 72);
});

test('ESPERAR pasa sin chequear precios', () => {
  truthy(validateSignal({ action: 'ESPERAR' }));
});

test('usa tp2 si tp falta', () => {
  truthy(validateSignal({ action: 'COMPRAR', entry: 3980, tp2: 4045, sl: 3925, confidence: 70 }));
});

console.log('\ncomputeRR / aritmética en código');

test('computeRR calcula reward/risk correcto', () => {
  eq(computeRR(3980, 3925, 4045), '1.18'); // reward 65 / risk 55
  eq(computeRR(4000, 4030, 3950), '1.67'); // short: reward 50 / risk 30
});

test('validateSignal sobreescribe el rr que dijo el modelo', () => {
  const r = validateSignal({ action: 'COMPRAR', entry: 3980, tp: 4045, sl: 3925, rr: '99.0', confidence: 70 });
  eq(r.rr, '1.18');
});

test('descarta tp1/tp2 con orden inválido (long con tp1 > tp2)', () => {
  const r = validateSignal({ action: 'COMPRAR', entry: 3980, tp: 4045, tp1: 4050, tp2: 4045, sl: 3925, confidence: 70 });
  truthy(r); falsy(r.tp1, 'tp1 inválido debe borrarse');
});

test('mantiene tp1/tp2 con orden válido', () => {
  const r = validateSignal({ action: 'COMPRAR', entry: 3980, tp: 4045, tp1: 4010, tp2: 4045, sl: 3925, confidence: 70 });
  eq(Number(r.tp1), 4010);
});

test('descarta be_trigger fuera de [entry, primer objetivo]', () => {
  const r = validateSignal({ action: 'COMPRAR', entry: 3980, tp: 4045, sl: 3925, be_trigger: 3900, confidence: 70 });
  truthy(r); falsy(r.be_trigger);
});

console.log('\nresolveSignalAgainstRange / outcomes automáticos');

const NOW = Date.now();
const base = { action: 'COMPRAR', entry: 3980, sl: 3925, tp: 4045, timestamp: new Date(NOW).toISOString() };

test('PENDING se activa cuando el rango toca el entry', () => {
  eq(resolveSignalAgainstRange({ ...base }, 3990, 3975, NOW), { status: 'ACTIVE' });
});

test('PENDING no se activa si el precio no llegó', () => {
  eq(resolveSignalAgainstRange({ ...base }, 4010, 3995, NOW), null);
});

test('PENDING expira después de 48h sin activarse', () => {
  const old = { ...base, timestamp: new Date(NOW - 49 * 3600e3).toISOString() };
  eq(resolveSignalAgainstRange(old, 4010, 3995, NOW), { status: 'RESOLVED', outcome: 'EXPIRADA' });
});

test('ACTIVE long → WIN si toca TP', () => {
  eq(resolveSignalAgainstRange({ ...base, status: 'ACTIVE' }, 4050, 4000, NOW), { status: 'RESOLVED', outcome: 'WIN' });
});

test('ACTIVE long → LOSS si toca SL', () => {
  eq(resolveSignalAgainstRange({ ...base, status: 'ACTIVE' }, 3990, 3920, NOW), { status: 'RESOLVED', outcome: 'LOSS' });
});

test('ACTIVE con TP y SL en la misma vela → LOSS conservador', () => {
  const r = resolveSignalAgainstRange({ ...base, status: 'ACTIVE' }, 4050, 3920, NOW);
  eq(r.outcome, 'LOSS'); truthy(r.ambiguous);
});

test('ACTIVE short → WIN si baja al TP', () => {
  const short = { action: 'VENDER', entry: 4000, sl: 4030, tp: 3950, status: 'ACTIVE', timestamp: base.timestamp };
  eq(resolveSignalAgainstRange(short, 4005, 3945, NOW), { status: 'RESOLVED', outcome: 'WIN' });
});

test('ignora ESPERAR, resueltas y con outcome', () => {
  falsy(resolveSignalAgainstRange({ action: 'ESPERAR' }, 4050, 3920, NOW));
  falsy(resolveSignalAgainstRange({ ...base, status: 'RESOLVED' }, 4050, 3920, NOW));
  falsy(resolveSignalAgainstRange({ ...base, outcome: 'WIN' }, 4050, 3920, NOW));
});

test('usa tp2 como objetivo final si existe', () => {
  const s = { ...base, tp2: 4060, status: 'ACTIVE' };
  eq(resolveSignalAgainstRange(s, 4050, 4000, NOW), null); // 4050 < tp2=4060: aún no
  eq(resolveSignalAgainstRange(s, 4065, 4000, NOW).outcome, 'WIN');
});

console.log('\ncleanText');

test('quita signal + annotations cerrados', () => {
  const out = cleanText(`Hola.
<signal>{"action":"COMPRAR"}</signal>
<annotations>[{"x1":0}]</annotations>
Adiós.`);
  eq(out.includes('signal'), false);
  eq(out.includes('annotations'), false);
  eq(out.includes('{"action"'), false);
  truthy(out.includes('Hola'));
  truthy(out.includes('Adiós'));
});

test('quita signal sin cerrar (truncado)', () => {
  const out = cleanText(`Análisis: OB en 3960.
<signal>{"action":"COMPRAR","entry":3980,"tp":4045`);
  eq(out, 'Análisis: OB en 3960.');
});

test('quita annotations sin cerrar', () => {
  const out = cleanText(`Bull bias.
<signal>{"action":"COMPRAR"}</signal>
<annotations>[{"x1":0.5`);
  eq(out, 'Bull bias.');
});

test('preserva texto entre tags', () => {
  const out = cleanText(`Antes.
<signal>{"action":"COMPRAR"}</signal>
Medio.
<annotations>[]</annotations>
Después.`);
  truthy(out.includes('Antes'));
  truthy(out.includes('Medio'));
  truthy(out.includes('Después'));
  eq(out.includes('signal'), false);
});

test('preserva bloques de código markdown (regresión: secciones vacías)', () => {
  const out = cleanText(`## SÍ LO VEO

---

\`\`\`
PDL $4503 roto. Cierre confirma quiebre.
Estructura cambia a bajista.
\`\`\`

## SITUACIÓN ACTUAL

---

\`\`\`
Precio en retrace hacia OB.
\`\`\``);
  truthy(out.includes('PDL $4503 roto'), 'contenido del primer bloque debe sobrevivir');
  truthy(out.includes('Estructura cambia'), 'segunda línea del primer bloque');
  truthy(out.includes('Precio en retrace'), 'contenido del segundo bloque');
  truthy(out.includes('SÍ LO VEO'), 'headers se mantienen');
  truthy(out.includes('SITUACIÓN ACTUAL'), 'segundo header se mantiene');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

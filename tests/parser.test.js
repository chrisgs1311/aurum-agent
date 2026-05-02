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

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

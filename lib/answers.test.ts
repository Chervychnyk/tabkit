import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answer, evaluate, password } from './answers.ts';

const copy = (q: string, now?: Date) => answer(q, now).map((i) => i.copy);

test('math', () => {
  assert.equal(evaluate('2 + 3 * 4'), 14);
  assert.equal(evaluate('(2 + 3) * 4'), 20);
  assert.equal(evaluate('2 ^ 3 ^ 2'), 512);
  assert.equal(evaluate('-2 ^ 2'), -4);
  assert.equal(evaluate('sqrt(144) + max(1, 5)'), 17);
  assert.equal(evaluate('200 + 10%'), 220);
  assert.equal(evaluate('200 - 25%'), 150);
  assert.equal(evaluate('50 * 10%'), 5);
  assert.throws(() => evaluate('2 +'));
  assert.throws(() => evaluate('foo(2)'));
  assert.deepEqual(copy('20%'), ['0.2']);
  assert.deepEqual(copy('0.1 + 0.2'), ['0.3']);
  assert.deepEqual(copy('15% of 80'), ['12']);
  assert.deepEqual(copy('42'), []); // a lone number is not a question
  assert.deepEqual(copy('github'), []);
  assert.deepEqual(copy('2024-01-15'), []);
});

test('units', () => {
  assert.deepEqual(copy('5 km to mi'), ['3.10685596119']);
  assert.deepEqual(copy('10 kg in lb'), ['22.0462262185']);
  assert.deepEqual(copy('32px to rem'), ['2']);
  assert.deepEqual(copy('1 in to px'), ['96']);
  assert.deepEqual(copy('1.5 GB to MB'), ['1500']);
  assert.deepEqual(copy('1 GiB to MiB'), ['1024']);
  assert.deepEqual(copy('100 f to c'), ['37.7777777778']);
  assert.deepEqual(copy('5 km to kg'), []); // mismatched categories
});

test('bases and colors', () => {
  assert.deepEqual(copy('0xff'), ['255', 'ff', '377', '11111111']);
  assert.deepEqual(copy('10 to binary'), ['1010']);
  assert.deepEqual(copy('#f80'), ['#ff8800', 'rgb(255, 136, 0)', 'hsl(32, 100%, 50%)']);
  assert.deepEqual(copy('hsl(0, 100%, 50%)'), ['#ff0000', 'rgb(255, 0, 0)', 'hsl(0, 100%, 50%)']);
  assert.deepEqual(copy('rgb(300, 0, 0)'), []);
});

test('time', () => {
  const now = new Date('2026-03-10T12:00:00Z');
  assert.deepEqual(copy('time in tokyo', now), ['21:00']);
  assert.deepEqual(copy('PST time', now), ['05:00']);
  assert.deepEqual(copy('time in Atlantis', now), []);
  assert.deepEqual(copy('now + 90 minutes', now), ['2026-03-10T13:30:00.000Z']);
  assert.equal(copy('1700000000')[0], '2023-11-14T22:13:20.000Z');
  assert.equal(copy('1700000000000')[0], '2023-11-14T22:13:20.000Z');
  assert.deepEqual(copy('unix', now), ['1773144000']);
});

test('answer prefixes', () => {
  assert.deepEqual(copy(':tx hello worldWide'), [
    'HELLO WORLDWIDE', 'hello worldwide', 'Hello Worldwide', 'Hello worldwide',
    'helloWorldWide', 'HelloWorldWide', 'hello_world_wide', 'hello-world-wide', 'HELLO_WORLD_WIDE',
  ]);
  assert.match(copy(':uuid')[0]!, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  const [sym, alnum] = copy(':pwd 32');
  assert.equal(sym!.length, 32);
  assert.match(alnum!, /^[A-Za-z0-9]{32}$/);
  assert.equal(copy(':pwd')[0]!.length, 20);
  assert.equal(new Set(password(2000, 'ab')).size, 2);
});

// node --test test/  : her mind against sentences it was not given as examples.
import test from 'node:test';
import assert from 'node:assert';

globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
const { Mind } = await import('../src/renderer/js/mind.js');
const { calc, convert, dateMath, timeIn, recallFact } = await import('../src/renderer/js/skills.js');

const meaning = (d) => d.do === 'cmd' ? d.cmd.kind : d.do === 'skill' ? d.args?.key || d.name : d.do === 'reply' ? 'reply' : d.do;

test('calcul', () => {
  for (const [q, want] of [['combien fait 12 x 3', 36], ['15% de 240', 36], ['racine de 81', 9], ['2 puissance 10', 1024], ['(3+4)*2', 14], ['calcule 7 fois 8', 56], ['combien fait 12 sur 4', 3], ['3,5 + 1,5', 5], ['2+2*3', 8]]) {
    assert.strictEqual(calc(q)?.value, want, q);
  }
  assert.strictEqual(calc('et fois 2', 36)?.value, 72);
  for (const q of ['2026', 'iphone 15', 'je pars le 12-03', 'bonjour']) assert.strictEqual(calc(q), null, q);
  assert.strictEqual(calc('combien fait 1/0')?.value, null);
});

test('conversions', () => {
  assert.match(convert('10 km en miles'), /6,21/);
  assert.match(convert('100 c en f'), /212/);
  assert.match(convert('combien de cm dans 2 pouces'), /5,08/);
  assert.match(convert('2 go en mo'), /2\s?048/);
  assert.strictEqual(convert('10 km en kg'), null);
  assert.strictEqual(convert('je vais en coree'), null);
});

test('dates', () => {
  const now = new Date(2026, 10, 2);
  assert.match(dateMath('dans combien de jours noel', now), /Dans 53 jours/);
  assert.match(dateMath('le 14 juillet c est quel jour', now), /mercredi 14 juillet 2027/i);
  assert.match(dateMath('quel jour on sera dans 3 semaines', now), /23 novembre 2026/);
  assert.strictEqual(dateMath('combien de jours dans une annee', now), null);
  assert.strictEqual(timeIn('il est quelle heure en coree', new Date(Date.UTC(2026, 10, 2, 12))).clock, '21h00');
  assert.strictEqual(timeIn('quelle heure de pointe a paris en metro'), null);
});

test('souvenirs : seulement ce qui a ete dit, seulement sur toi', () => {
  const facts = [{ text: 'je pars en Corée en janvier' }, { text: 'ma couleur préférée est le bleu' }];
  assert.ok(recallFact('je pars quand en coree', facts));
  assert.ok(recallFact('c est quoi ma couleur preferee', facts));
  assert.strictEqual(recallFact('c est quoi la capitale de la coree', facts), null);
  assert.strictEqual(recallFact('je mange quoi ce soir', facts), null);
});

test('apprendre : oui, non, correction, phrase enseignee', () => {
  const m = new Mind();
  const taught = m.understand('quand je dis dodo bit tu fais range ton chat');
  assert.strictEqual(taught.do, 'taught');
  assert.deepStrictEqual(m.understand('dodo bit').cmd, { kind: 'props', what: 'cat' });
  assert.strictEqual(m.understand('oublie la phrase dodo bit').ok, true);
  assert.notStrictEqual(m.understand('dodo bit').cmd?.what, 'cat');

  const m2 = new Mind();
  assert.strictEqual(meaning(m2.understand('quelle heure il est')), 'time');
  const wrong = m2.understand('non c est pas ca');
  assert.strictEqual(wrong.do, 'claude');
  assert.strictEqual(wrong.question, 'quelle heure il est');
  assert.strictEqual(m2.understand('quelle heure il est').do, 'claude');
});

test('risque : toujours une question avant', () => {
  const m = new Mind();
  assert.strictEqual(m.understand('verrouille mon pc').do, 'confirm');
  assert.strictEqual(meaning(m.understand('oui')), 'lock');
  const m2 = new Mind();
  assert.strictEqual(m2.understand('tu vois quoi sur mon ecran').do, 'confirm');
  assert.strictEqual(m2.understand('non').do, 'reply');
  assert.strictEqual(m2.understand('tu vois quoi sur mon ecran').do, 'confirm');
});

test('plusieurs ordres', () => {
  const m = new Mind();
  assert.deepStrictEqual(m.understand('range ton cafe et ouvre spotify').steps.map((s) => s.cmd.kind), ['props', 'open']);
  assert.deepStrictEqual(m.understand('range ton cafe et ta plante').steps.map((s) => s.cmd.what), ['coffee', 'plant']);
  assert.deepStrictEqual(m.understand('ouvre spotify et discord').steps.map((s) => s.cmd.rest), ['spotify', 'discord']);
  assert.strictEqual(m.understand('rappelle moi dans 10 min d appeler paul et de manger').do, 'cmd');
});

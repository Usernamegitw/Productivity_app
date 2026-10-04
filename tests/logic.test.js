const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('multiplier is 1x at neutral, max at 10, reciprocal at 1', () => {
  close(L.multiplierFor(5.5), 1);
  close(L.multiplierFor(10), 4);
  close(L.multiplierFor(1), 0.25);
  assert.ok(L.multiplierFor(8) > L.multiplierFor(6));
});

test('score moves toward rating and stays in range', () => {
  const up = L.nextScore(5.5, 10);
  assert.ok(up > 5.5 && up < 10);
  const down = L.nextScore(5.5, 1);
  assert.ok(down < 5.5 && down > 1);
  close(L.nextScore(5, 99), L.nextScore(5, 10)); // clamped
});

test('repeated high ratings raise the multiplier, then easing off lowers it', () => {
  const tasks = [{ id: 't' }];
  const logs = [];
  let at = 0;
  for (let i = 0; i < 6; i++) logs.push({ id: 'h' + i, taskId: 't', minutes: 10, resistance: 9, at: at++ });
  const high = L.computeState(tasks, logs).taskStats.t.multiplier;
  assert.ok(high > 2);
  for (let i = 0; i < 10; i++) logs.push({ id: 'e' + i, taskId: 't', minutes: 10, resistance: 2, at: at++ });
  const eased = L.computeState(tasks, logs).taskStats.t.multiplier;
  assert.ok(eased < 0.6, `eased multiplier ${eased}`);
});

test('easy task earns less per minute over time (habituation)', () => {
  const tasks = [{ id: 't' }];
  const logs = [];
  for (let i = 0; i < 5; i++) logs.push({ id: String(i), taskId: 't', minutes: 10, resistance: 2, at: i });
  const { logResults } = L.computeState(tasks, logs);
  const xps = logs.map((l) => logResults[l.id].xp);
  for (let i = 1; i < xps.length; i++) assert.ok(xps[i] < xps[i - 1]);
});

test('xp = minutes × rate × multiplier; total sums logs; order by time', () => {
  const tasks = [{ id: 'a' }, { id: 'b' }];
  const logs = [
    { id: '2', taskId: 'a', minutes: 5, resistance: 5, at: 2 },
    { id: '1', taskId: 'a', minutes: 10, resistance: 8, at: 1 },
    { id: '3', taskId: 'b', minutes: 20, resistance: 3, at: 3 },
    { id: 'x', taskId: 'gone', minutes: 99, resistance: 9, at: 4 },
  ];
  const settings = { xpPerMinute: 2 };
  const st = L.computeState(tasks, logs, settings);
  const r1 = st.logResults['1'];
  close(r1.scoreBefore, 5.5);
  close(r1.xp, 10 * 2 * r1.multiplier);
  close(st.logResults['2'].scoreBefore, r1.score);
  assert.equal(st.logResults.x, undefined);
  close(st.totalXp, r1.xp + st.logResults['2'].xp + st.logResults['3'].xp);
  assert.equal(st.taskStats.a.logCount, 2);
  assert.equal(st.taskStats.a.totalMinutes, 15);
});

test('levels: 100 XP to reach 2, +200 to reach 3', () => {
  assert.equal(L.levelInfo(0).level, 1);
  assert.equal(L.levelInfo(99.9).level, 1);
  assert.equal(L.levelInfo(100).level, 2);
  assert.equal(L.levelInfo(299).level, 2);
  const i = L.levelInfo(300);
  assert.equal(i.level, 3);
  assert.equal(i.xpForNext, 300);
  close(i.progress, 0);
});

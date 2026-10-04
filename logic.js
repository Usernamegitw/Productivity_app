/*
 * Organization XP — pure game logic (no DOM, no storage).
 *
 * Model
 * -----
 * Every log records minutes spent and a resistance rating (1–10).
 *
 * Each task keeps a running *bottleneck score* on the same 1–10 scale. It is
 * an exponential moving average of that task's resistance ratings, starting
 * from a neutral prior. Consistently high ratings pull it up, low ratings pull
 * it down — the "upvote/downvote" behaviour from the spec, but bounded.
 *
 * The score drives a *multiplier* on a geometric curve centred on 1x:
 *
 *     multiplier = maxMultiplier ^ ((score - neutral) / (10 - neutral))
 *
 * With the defaults (neutral 5.5, max 4x) a score of 10 gives 4x, 5.5 gives
 * 1x and 1 gives 0.25x. As a task gets easier its score — and its reward —
 * shrinks, so farming easy tasks pays less over time.
 *
 * XP for a log = minutes × xpPerMinute × multiplier, where the multiplier uses
 * the score *after* this log's rating is folded in (so a hard session is
 * rewarded right away, while the history still smooths it).
 *
 * Everything is derived by replaying logs in time order, so deleting a log or
 * changing a setting recomputes consistently.
 */
(function (root) {
  'use strict';

  const RATING_MIN = 1;
  const RATING_MAX = 10;

  const DEFAULT_SETTINGS = Object.freeze({
    xpPerMinute: 1,
    // How strongly the newest rating moves the score (0–1).
    smoothing: 0.35,
    // Starting score for a task with no logs, and the score that maps to 1x.
    neutralScore: 5.5,
    // Multiplier at the maximum score; the minimum is its reciprocal.
    maxMultiplier: 4,
    // XP to go from level L to L+1 is levelStep × L.
    levelStep: 100,
  });

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function withDefaults(settings) {
    return Object.assign({}, DEFAULT_SETTINGS, settings || {});
  }

  function nextScore(score, rating, settings) {
    const s = withDefaults(settings);
    const r = clamp(Number(rating), RATING_MIN, RATING_MAX);
    const a = clamp(Number(s.smoothing), 0, 1);
    return score + a * (r - score);
  }

  function multiplierFor(score, settings) {
    const s = withDefaults(settings);
    const neutral = clamp(s.neutralScore, RATING_MIN + 0.01, RATING_MAX - 0.01);
    const max = Math.max(1, Number(s.maxMultiplier));
    const span = score >= neutral ? RATING_MAX - neutral : neutral - RATING_MIN;
    const t = clamp((score - neutral) / span, -1, 1);
    return Math.pow(max, t);
  }

  function xpForLog(minutes, multiplier, settings) {
    const s = withDefaults(settings);
    return Math.max(0, Number(minutes)) * Number(s.xpPerMinute) * multiplier;
  }

  /**
   * Replays all logs and returns derived state.
   *   tasks:    [{ id, name, ... }]
   *   logs:     [{ id, taskId, minutes, resistance, at (ms epoch) }]
   * Returns { taskStats: {taskId: {...}}, logResults: {logId: {...}}, totalXp }
   */
  function computeState(tasks, logs, settings) {
    const s = withDefaults(settings);
    const taskStats = {};
    for (const t of tasks) {
      taskStats[t.id] = {
        score: s.neutralScore,
        multiplier: multiplierFor(s.neutralScore, s),
        logCount: 0,
        totalMinutes: 0,
        totalXp: 0,
        lastLoggedAt: null,
        history: [], // score after each log, oldest first
      };
    }

    const ordered = logs
      .slice()
      .sort((a, b) => a.at - b.at || String(a.id).localeCompare(String(b.id)));

    const logResults = {};
    let totalXp = 0;
    for (const log of ordered) {
      const st = taskStats[log.taskId];
      if (!st) continue; // orphaned log; ignore
      const scoreBefore = st.score;
      const score = nextScore(scoreBefore, log.resistance, s);
      const multiplier = multiplierFor(score, s);
      const xp = xpForLog(log.minutes, multiplier, s);

      st.score = score;
      st.multiplier = multiplier;
      st.logCount += 1;
      st.totalMinutes += Number(log.minutes) || 0;
      st.totalXp += xp;
      st.lastLoggedAt = log.at;
      st.history.push(score);

      logResults[log.id] = { scoreBefore, score, multiplier, xp };
      totalXp += xp;
    }

    return { taskStats, logResults, totalXp };
  }

  // Cumulative XP needed to reach `level` (level 1 starts at 0).
  function xpForLevel(level, settings) {
    const s = withDefaults(settings);
    return (s.levelStep * level * (level - 1)) / 2;
  }

  function levelInfo(totalXp, settings) {
    const s = withDefaults(settings);
    let level = 1;
    while (xpForLevel(level + 1, s) <= totalXp) level++;
    const floor = xpForLevel(level, s);
    const ceil = xpForLevel(level + 1, s);
    return {
      level,
      xpIntoLevel: totalXp - floor,
      xpForNext: ceil - floor,
      progress: (totalXp - floor) / (ceil - floor),
    };
  }

  const api = {
    RATING_MIN,
    RATING_MAX,
    DEFAULT_SETTINGS,
    nextScore,
    multiplierFor,
    xpForLog,
    computeState,
    xpForLevel,
    levelInfo,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XPLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

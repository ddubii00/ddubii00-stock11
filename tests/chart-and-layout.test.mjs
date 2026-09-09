import assert from 'node:assert/strict';
import test from 'node:test';
import { makeChartModel } from '../lib/chart-model.ts';
import { fitBoard } from '../lib/board-layout.ts';

const series = (points, previousClose = 100, market = 'KOSPI', date = '20260907') => ({
  points, previousClose, market, date, code: '005930', asOf: `${date}110000`,
});

test('11:00 ends at 120/390 of the 09:00–15:30 axis, and discards future points', () => {
  const model = makeChartModel(series([
    { minute: 539, price: 99 }, { minute: 540, price: 100 }, { minute: 660, price: 101 },
    { minute: 661, price: 102 }, { minute: 930, price: 103 },
  ]), new Date('2026-09-07T11:00:00+09:00'));
  assert.deepEqual(model.points.map((point) => point.minute), [540, 660]);
  assert.equal(model.x(660), 120 / 390);
  assert.equal(model.x(930), 1);
  assert.equal(model.last.minute, 660);
});

test('small movements occupy the same proportion of the auto-scaled Y-axis', () => {
  const now = new Date('2026-09-07T11:00:00+09:00');
  const small = makeChartModel(series([{ minute: 540, price: 10000 }, { minute: 660, price: 10010 }], 10000), now);
  const large = makeChartModel(series([{ minute: 540, price: 10000 }, { minute: 660, price: 11000 }], 10000), now);
  assert.ok(small.yMax - small.yMin < large.yMax - large.yMin);
  assert.ok(Math.abs((small.y(10000) - small.y(10010)) - (large.y(10000) - large.y(11000))) < 1e-8);
  assert.ok(small.y(10000) > 0 && small.y(10000) < 1);
});

test('previous-close line remains on scale even when the market opens with a gap', () => {
  const model = makeChartModel(series([{ minute: 540, price: 110 }, { minute: 660, price: 112 }]), new Date('2026-09-07T11:00:00+09:00'));
  assert.ok(model.y(100) < 1 && model.y(100) > 0);
  assert.ok(model.y(112) > 0);
});

test('flat prices have a finite centered scale and no artificial fluctuation', () => {
  const model = makeChartModel(series([{ minute: 540, price: 100 }, { minute: 660, price: 100 }]), new Date('2026-09-07T11:00:00+09:00'));
  assert.equal(model.y(100), 0.5);
  assert.ok(Number.isFinite(model.y(100)));
});

test('closed session keeps its final 15:30 point, excludes after-hours and never fills missing minutes', () => {
  const model = makeChartModel(series([{ minute: 540, price: 100 }, { minute: 930, price: 102 }, { minute: 940, price: 500 }]), new Date('2026-09-07T17:00:00+09:00'));
  assert.equal(model.points.length, 2);
  assert.equal(model.last.minute, 930);
  assert.equal(model.last.price, 102);
});

test('before opening there is no line for today; previous trading day can show its complete session', () => {
  const points = [{ minute: 540, price: 100 }, { minute: 930, price: 102 }];
  const now = new Date('2026-09-07T08:00:00+09:00');
  assert.equal(makeChartModel(series(points), now).points.length, 0);
  assert.equal(makeChartModel(series(points, 100, 'KOSPI', '20260904'), now).points.length, 2);
});

test('NASDAQ uses New York local time and a full 09:30–16:00 regular session', () => {
  const model = makeChartModel(series([{ minute: 570, price: 100 }, { minute: 660, price: 101 }, { minute: 960, price: 102 }], 100, 'NASDAQ'), new Date('2026-09-07T11:00:00-04:00'));
  assert.equal(model.x(570), 0);
  assert.equal(model.x(960), 1);
  assert.equal(model.x(660), 90 / 390);
  assert.equal(model.last.minute, 660);
});

test('adaptive price boards fit their panel without scrolling or skipped stocks', () => {
  for (const [width, height, columns] of [[1880, 1000, 4], [1576, 800, 4], [1330, 610, 3], [1000, 690, 3], [980, 550, 2], [790, 490, 2]]) {
    const layout = fitBoard(width, height, false, true);
    assert.equal(layout.columns, columns);
    assert.ok(layout.rows * layout.rowHeight + 27 <= height);
    assert.ok(layout.rowHeight >= 30);
    const shown = Array.from({ length: Math.ceil(100 / layout.capacity) }, (_, page) =>
      Array.from({ length: Math.min(layout.capacity, 100 - page * layout.capacity) }, (_, i) => page * layout.capacity + i + 1)).flat();
    assert.deepEqual(shown, Array.from({ length: 100 }, (_, i) => i + 1));
  }
});

test('wide displays show 100+ quotes and 60–76 compact charts, without shrinking prices', () => {
  assert.equal(fitBoard(1896, 1000, false, true).capacity, 128);
  assert.equal(fitBoard(1576, 800, false, true).capacity, 100);
  assert.equal(fitBoard(1896, 1000, true, true).capacity, 76);
  assert.equal(fitBoard(1416, 800, true, true).capacity, 60);
  assert.ok(fitBoard(1896, 1000, true, true).rowHeight >= 52);
  assert.ok(fitBoard(1896, 1000, true, true).rowHeight <= 56);
});

test('denser chart rows still fit the viewport and preserve space for both price lines', () => {
  for (const large of [true, false]) for (const [width, height] of [[390, 600], [810, 1090], [1170, 734], [1416, 800], [1896, 1000]]) {
    const layout = fitBoard(width, height, true, large);
    assert.ok(layout.rows * layout.rowHeight <= height);
    assert.ok(layout.rowHeight >= (large ? 52 : 48));
    assert.ok(layout.rowHeight <= 56);
  }
});

void test('third T-button stage enlarges quote and chart cells beyond the existing large stage', () => {
  const largeQuote = fitBoard(1416, 800, false, true, 200, 1);
  const extraQuote = fitBoard(1416, 800, false, true, 200, 2);
  const largeChart = fitBoard(1416, 800, true, true, 200, 1);
  const extraChart = fitBoard(1416, 800, true, true, 200, 2);
  assert.ok(extraQuote.rowHeight >= 38 && extraQuote.capacity < largeQuote.capacity);
  assert.ok(extraChart.rowHeight >= 62 && extraChart.capacity < largeChart.capacity);
});

test('iPad portrait uses two columns and landscape uses three', () => {
  for (const graph of [false, true]) {
    for (const [width, height] of [[810, 1090], [1000, 1260], [744, 920]]) assert.equal(fitBoard(width, height, graph, true).columns, 2);
    for (const [width, height] of [[1170, 734], [1342, 924], [1000, 668]]) assert.equal(fitBoard(width, height, graph, true).columns, 3);
  }
});

test('all 200 stocks remain reachable and dense charts use at most 80 slots', () => {
  for (const graph of [true, false]) for (const width of [500, 1000, 1800]) {
    const layout = fitBoard(width, 1000, graph, true, 200);
    if (graph) assert.ok(layout.capacity <= 80);
    const pages = Array.from({ length: Math.ceil(200 / layout.capacity) }, (_, page) =>
      Array.from({ length: Math.min(layout.capacity, 200 - page * layout.capacity) }, (_, index) => page * layout.capacity + index));
    assert.deepEqual(pages.flat(), Array.from({ length: 200 }, (_, i) => i));
  }
});

test('watchlists containing 1–3 stocks have exactly the same density as a 200-stock board', () => {
  for (const graph of [false, true]) for (const width of [390, 810, 1200, 1600]) {
    const standard = fitBoard(width, 800, graph, true, 200);
    for (const total of [1, 2, 3]) assert.deepEqual(fitBoard(width, 800, graph, true, total), standard);
  }
});

test('FX uses a fixed 09:00–15:30 Korean stock-session axis and leaves future time blank', () => {
  // Even an old cached response with a sliding session cannot move the X axis.
  const input = { market: 'FX', code: 'FX_USDKRW', date: '20260908', previousClose: 1347, asOf: '', session: { start: 505, end: 600, timeZone: 'Asia/Seoul', ticks: [] }, points: [{ minute: 505, price: 1342.6 }, { minute: 540, price: 1345 }, { minute: 600, price: 1346 }, { minute: 660, price: 1348 }, { minute: 930, price: 1349 }, { minute: 931, price: 1500 }] };
  const model = makeChartModel(input, new Date('2026-09-08T10:00:00+09:00'));
  assert.deepEqual(model.points.map((point) => point.minute), [540, 600]);
  assert.equal(model.x(540), 0);
  assert.equal(model.x(600), 60 / 390);
  assert.equal(model.x(930), 1);
  assert.ok(model.y(1347) > 0 && model.y(1347) < 1);
  assert.equal(makeChartModel(input, new Date('2026-09-08T08:59:00+09:00')).points.length, 0);
  const closed = makeChartModel(input, new Date('2026-09-08T16:00:00+09:00'));
  assert.equal(closed.last.minute, 930);
  assert.equal(closed.x(600), model.x(600));
  assert.equal(makeChartModel(input, new Date('2026-09-09T08:00:00+09:00')).last.minute, 930);
});

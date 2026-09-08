import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSymbolDirectory, matchSymbols } from '../lib/us-symbol-search.ts';

test('official US catalogs support middle names, ETF tickers and exclude test/footer rows', () => {
  const nasdaq = parseSymbolDirectory('Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\nQQQ|Invesco QQQ Trust Series 1|G|N|N|100|Y|N\nAAPL|Apple Inc. Common Stock|Q|N|N|100|N|N\nTEST|Test Trust|G|Y|N|100|Y|N\nFile Creation Time: 09082026|||||||');
  const other = parseSymbolDirectory('ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol\nSPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY');
  assert.equal(nasdaq.length, 2);
  assert.deepEqual(matchSymbols([...nasdaq, ...other], 'Trust').map((item) => item.code), ['QQQ', 'SPY']);
  assert.equal(matchSymbols(other, 's&p 500')[0].code, 'SPY');
  assert.equal(matchSymbols(nasdaq, 'qqq')[0].etf, true);
  assert.equal(matchSymbols(nasdaq, 'Apple')[0].etf, false);
  assert.deepEqual(parseSymbolDirectory('invalid data'), []);
});

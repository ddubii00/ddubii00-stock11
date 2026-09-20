export function domesticQuotePlan({ session, open, minute }) {
  const liveRegularSession = open && minute >= 540 && minute < 930;
  if (session === 'regular') return liveRegularSession ? { source: 'multi', marketCode: 'J' } : { source: 'daily-close', marketCode: 'J' };
  // NX multi-current-price is valid only during the live NXT session. Its
  // immutable final price must come from actual NX historical trades.
  const liveNxtSession = open && minute >= 960 && minute < 1200;
  return liveNxtSession ? { source: 'multi', marketCode: 'NX' } : { source: 'nxt-close', marketCode: 'NX' };
}

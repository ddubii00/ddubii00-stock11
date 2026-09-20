export function domesticQuotePlan({ session, open, minute }) {
  const liveRegularSession = open && minute >= 540 && minute < 930;
  // KRX regular/J multi-price is valid only while the KRX regular market is
  // trading. After 15:30 its immutable close comes from daily-price instead.
  if (session === 'regular' && !liveRegularSession) return { source: 'daily-close', marketCode: 'J' };
  return { source: 'multi', marketCode: session === 'after' ? 'NX' : 'J' };
}

export function domesticQuotePlan({ session, open, minute }) {
  // Plain KRX always uses the official KIS J-market bulk REST snapshot.
  // This removes the old 30-row cap and avoids one-request-per-symbol history
  // fan-out after close. The relay splits all rows into 30-symbol batches.
  if (session === 'regular') return { source: 'multi', marketCode: 'J' };

  // KRX2 uses NX during the premarket, preserving its 08:50 final until KRX
  // opens at 09:00. The regular and after-market paths remain independent.
  if (session === 'pre') return open && minute < 530
    ? { source: 'multi', marketCode: 'NX' }
    : { source: 'nxt-pre-close', marketCode: 'NX' };

  const liveNxtSession = open && minute >= 960 && minute < 1200;
  return liveNxtSession ? { source: 'multi', marketCode: 'NX' } : { source: 'nxt-close', marketCode: 'NX' };
}

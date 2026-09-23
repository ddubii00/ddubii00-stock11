export function domesticQuotePlan({ session, open, minute }) {
  // Plain KRX always uses the official KIS J-market bulk REST snapshot.
  // This removes the old 30-row cap and avoids one-request-per-symbol history
  // fan-out after close. The relay splits all rows into 30-symbol batches.
  if (session === 'regular') return { source: 'multi', marketCode: 'J' };

  // KRX2 keeps the existing separate NXT behavior.
  const liveNxtSession = open && minute >= 960 && minute < 1200;
  return liveNxtSession ? { source: 'multi', marketCode: 'NX' } : { source: 'nxt-close', marketCode: 'NX' };
}

export const MULTI_BATCH_SIZE = 30;

export function canonicalCodes(codes) {
  return [...new Set(codes)].sort((left, right) => left.localeCompare(right));
}

export function multiCacheKey(market, session, codes) {
  return `${market}:${session}:${canonicalCodes(codes).join(',')}`;
}

export function multiBatches(codes, marketCode) {
  const canonical = canonicalCodes(codes);
  const batches = [];
  for (let offset = 0; offset < canonical.length; offset += MULTI_BATCH_SIZE) {
    const codesInBatch = canonical.slice(offset, offset + MULTI_BATCH_SIZE);
    const params = {};
    for (const [index, code] of codesInBatch.entries()) {
      const position = index + 1;
      params[`FID_COND_MRKT_DIV_CODE_${position}`] = marketCode;
      params[`FID_INPUT_ISCD_${position}`] = code;
    }
    batches.push({ codes: codesInBatch, params });
  }
  return batches;
}

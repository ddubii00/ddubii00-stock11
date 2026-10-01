const transientRequestError = /signal timed out|timed out|timeout|abort(?:ed)? due to timeout|fetch failed|failed to fetch|networkerror|load failed/i;

export function requestErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (error.name === 'TimeoutError' || error.name === 'AbortError' || transientRequestError.test(message)) return fallback;
  return message || fallback;
}

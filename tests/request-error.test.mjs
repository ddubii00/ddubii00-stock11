import test from 'node:test';
import assert from 'node:assert/strict';
import { requestErrorMessage } from '../lib/request-error.ts';

void test('browser timeout and network errors never leak technical messages to the dashboard', () => {
  const fallback = '시세 연결 지연 · 마지막 수신값 유지 / 자동 재시도 중';
  for (const error of [
    new DOMException('signal timed out', 'TimeoutError'),
    new DOMException('The operation was aborted due to timeout', 'AbortError'),
    new TypeError('Failed to fetch'),
    new Error('NetworkError when attempting to fetch resource.'),
  ]) assert.equal(requestErrorMessage(error, fallback), fallback);
});

void test('actionable server errors remain visible', () => {
  assert.equal(requestErrorMessage(new Error('로그인이 만료됐습니다.'), '연결 실패'), '로그인이 만료됐습니다.');
  assert.equal(requestErrorMessage(null, '연결 실패'), '연결 실패');
});

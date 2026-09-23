stock11-7 KOSPI/KOSDAQ 전체 시세 KIS REST 3초 갱신

현재 GitHub 최신본은 이미 WebSocket이 아니라 KIS REST-only 구조입니다.
KOSPI 1~30위까지만 가격이 보였던 직접 원인은 app/api/market/route.ts의
KIS_REST_PRIORITY_LIMIT=30 및 slice(0, priorityLimit) 제한입니다.

이번 수정:
- 활성 KOSPI/KOSDAQ 화면은 최대 200종목 전체를 KIS REST relay에 요청
- relay가 30종목씩 자동 분할해 KIS multi-price REST로 조회 후 병합
- 3초 갱신 유지
- 해외 시장은 기존 30종목 제한 유지
- 일반 KRX는 장중/장후/휴장일 모두 J-market bulk REST snapshot 사용
- KRX2/NXT 로직은 기존 유지
- 분봉 관련 파일은 전혀 수정하지 않음

GitHub에 덮어쓸 파일:
app/api/market/route.ts
server/kis-domestic-routing.mjs
.env.oracle.example

GitHub에 새로 추가:
tests/kis-domestic-routing.test.mjs

실제 .env.oracle과 KIS API 키는 GitHub에 올리지 마세요.

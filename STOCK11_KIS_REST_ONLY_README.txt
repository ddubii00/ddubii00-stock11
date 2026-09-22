Stock11-7 KIS REST only update

목표
- 모든 개별 종목 가격/등락률/거래량을 KIS REST 응답만으로 표시
- 가격 자동 갱신 3초
- KIS WebSocket 미사용
- 한국 시장 장중: KIS 국내주식 멀티 현재가 REST
- 한국 시장 15:30 이후: 그날 KRX 실제 15:30 intraday history에서 종가 복원
- 오늘이 휴장일/주말: KIS daily-price로 최근 개장일을 찾은 뒤 해당 날짜 15:30 가격 사용
- 미국 종목: KIS 해외주식 현재가 REST
- KIS 가격이 없으면 Naver 가격으로 대체하지 않고 '수신 대기' 표시
- 기존 분봉 차트는 그대로 유지

GitHub에서 덮어쓸 파일
server/kis-relay.mjs
lib/kis-relay.ts
app/api/market/route.ts
app/api/watchlist/route.ts
app/api/live/route.ts
app/api/runtime/route.ts
compose.yaml
.env.oracle.example
tests/kis-session.test.mjs

주의
- .env.oracle 실제 파일과 KIS 키는 GitHub에 올리지 마세요.
- .env.oracle.example만 덮어씁니다.

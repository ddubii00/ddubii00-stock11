# Stock11 real time stock price

밝은 테마의 KOSPI · KOSDAQ · NASDAQ 시가총액 상위 100종목 대시보드입니다.

- 6개 시세/분봉 탭과 주요 지수, 장중/장종료 상태를 압축된 헤더에 표시합니다.
- 가격표는 화면 크기에 따라 1~4열, 충분히 넓은 화면에서는 100종목을 한 화면에 표시합니다. iPad 세로 2열, 가로 3열을 우선합니다.
- 분봉은 큰 화면에서 28~32종목을 표시합니다. 공간이 부족하면 스크롤 대신 페이지를 사용합니다.
- 현재가와 등락률은 상승 빨강, 하락 파랑입니다. 국내 분봉은 09:00~15:30, NASDAQ은 현지 09:30~16:00 고정 축이며 실제 수신 시각까지만 그립니다.
- Y축은 가격 범위에 맞춰 자동 조절하며 전일 종가 기준선을 포함합니다. 가상의 분봉은 생성하지 않습니다.
- 종목명·현재가·등락률·그래프를 누르면 네이버 증권 **PC 페이지**를 새 탭으로 엽니다.

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```sh
npm ci
npm run dev -- --port 3002
npm test
npm run build
```

현재 미리보기는 Vinext/Vite + React로 실행합니다. `npm run build`의 기본 결과물은 Cloudflare Worker 형식입니다. **현재 저장소를 그대로 Vercel에 연결하는 것만으로 Next.js 배포가 완료되지는 않습니다.** Vercel 배포 시 Next.js 빌드/런타임 구성을 추가해야 합니다. 실제 Vercel 또는 Oracle 서버 배포는 아직 실행하지 않았습니다.

## 기본 데이터: 30초 갱신

`STOCK11_DATA_PROVIDER=naver`가 기본값입니다. 시세·지수·실제 분봉을 네이버 증권에서 30초마다 조회합니다. 이 간격은 앱의 재조회 주기이며 제공처 자체의 지연을 보장하지 않습니다. 장종료 시 정규장 최종가격을 유지하고 시간외/NXT 가격을 현재가에 섞지 않습니다. 조회 실패 시 마지막 수신값과 연결 오류를 표시합니다.

## Oracle용 KIS 체결 스트림

서버 전용 중계기 `server/kis-relay.mjs`가 KIS WebSocket에 연결하고 앱은 `/api/live`의 SSE로 체결값을 받습니다. KIS 키를 브라우저에 보내지 않으며 계좌조회나 주문 API는 사용하지 않습니다.

1. `.env.example`을 참고해 서버의 비공개 `.env.local` 또는 서비스 환경변수에 `KIS_APP_KEY`, `KIS_APP_SECRET`을 설정합니다. 실제 키 파일은 Git에 포함하지 않습니다.
2. Oracle 앱 환경에 `STOCK11_DATA_PROVIDER=kis`, `KIS_RELAY_URL=http://127.0.0.1:8091`을 설정합니다.
3. 별도 상주 프로세스로 `npm run kis:relay`를 실행합니다. 중계기는 loopback 주소만 사용합니다. 외부 브라우저는 HTTPS 앱 주소로만 접속해야 합니다.
4. Nginx 등을 사용하면 `/api/live` 경로의 프록시 버퍼링을 끄고 읽기 타임아웃을 1시간 이상으로 설정합니다. 재시작 관리는 systemd 등 서버 서비스 관리자로 구성합니다.

### 제약과 검증 상태

- KIS 공식 예제의 구독 제한을 고려해 한 중계기당 최대 40종목으로 제한했습니다. `KIS_MAX_SUBSCRIPTIONS`는 이를 더 낮출 수 있습니다. 여러 사용자도 동일한 한도를 공유합니다. 화면의 앞 순위 종목부터 구독하며, 나머지 종목과 지수는 30초 네이버 갱신을 유지합니다. **100종목 전체가 동시에 KIS 체결 스트림을 받는다고 표시하지 않습니다.** 하단에 실제 승인된 구독 수를 표시합니다.
- 그래프의 분봉 이력은 네이버에서 받고 새 KIS 체결로 해당 분을 갱신합니다. 연결 실패나 키 미설정 시 30초 갱신을 유지합니다.
- NASDAQ 수신은 KIS 해외시세 이용 권한/지연 정책의 영향을 받습니다. 지원되지 않는 코드도 네이버 갱신을 유지합니다.
- 프로토콜 파서·정규장 시간 필터·다중 레코드·레이아웃은 자동 테스트합니다. **실제 KIS 키가 없어 인증 성공, 실체결 수신 및 Oracle 운영 배포는 검증하지 않았습니다.** 운영 전 확인이 필요합니다.
- 공개 서비스로 배포하기 전에 제공처의 시세 이용/재배포 조건을 확인하고 필요하면 앱 접근을 제한해야 합니다.

공식 참고: [KIS 국내 시세 예제](https://github.com/koreainvestment/open-trading-api/blob/main/legacy/Sample01/kis_domstk_ws.py), [국내/해외 WebSocket 예제](https://github.com/koreainvestment/open-trading-api/blob/main/legacy/websocket/python/ws_domestic%2Boverseas_stock.py).

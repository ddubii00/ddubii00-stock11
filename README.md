# Stock11 real time stock price

KOSPI · KOSDAQ · NASDAQ · S&P500 구성 종목의 시가총액 상위 200종목을 보는 Next.js 대시보드입니다.

- 밝은 테마, 시장별 시세/차트와 관심종목을 포함한 10개 탭, 주요 지수와 장중/장종료 표시
- 가격표 최대 4열, 넓은 화면에서 차트 약 40~52종목, 태블릿 방향별 2~3열. 모든 200종목은 하단 페이지로 이동하며 글씨를 억지로 축소하지 않습니다.
- 스크롤해도 상단 지수·시장 버튼 유지, 표 제목과 순위·종목명 열 고정
- 상승 빨강/하락 파랑, 전일 종가 기준선, Y축 자동 조절
- 국내 분봉 09:00~15:30, NASDAQ 현지 09:30~16:00 고정 축, 실제 수신 시각까지만 표시
- 종목 클릭 시 네이버 증권 PC 페이지를 새 탭으로 열기
- 축 라벨 없는 짧은 분봉 추세, 전일 대비 빨강/파랑 구간, 변동률 크기에 따른 삼각형 크기 조절
- 헤더 KOSPI·KOSDAQ·NASDAQ 실제 분봉 미니 차트

## 관심종목

`관심종목` 또는 `관심종목 차트`에서 종목명/코드를 입력합니다. `삼성`, `애플`, `AAPL`, `IBM` 등으로 한국·미국 주식을 검색하며 마우스 또는 ↑↓ / Enter로 추가합니다. 중복은 방지하고 최대 200개까지 이 브라우저의 localStorage에 저장합니다. 종목 칩의 ×로 삭제하며 다른 기기와 자동 동기화하지 않습니다. 저장 실패와 검색 실패는 화면에 표시합니다.

관심종목 차트의 기본값은 **최근 1개월 실제 일봉(OHLC)**이며 `분봉 추세`로 전환할 수 있습니다. 일봉의 색은 시가 대비, 현재가·등락률과 분봉 선의 색은 전일 종가 대비입니다. 미국 분봉 종가만으로 가짜 OHLC를 만들지 않습니다. 일봉은 30초 재조회하며 KIS 틱은 현재가와 분봉 추세에 반영합니다. 각 종목의 통화·정규장 상태·데이터 날짜를 구분하고 장종료 시 정규장 최종가격을 유지합니다.

차트와 관심종목 시세는 요청당 32종목, 서버 내부 동시 조회 4개로 제한합니다. 일부 시세/차트 실패 시 오류와 마지막 수신값을 표시합니다. S&P500은 네이버의 해당 지수 구성 종목 목록에서 상위 200개를 가져옵니다.

## Vercel 배포

GitHub의 `ddubii00/ddubii00-stock11` 저장소를 Import하고 아래처럼 설정합니다.

| 항목 | 값 |
| --- | --- |
| Application / Framework Preset | **Next.js** (Container/Vite 아님) |
| Root Directory | `./` |
| Build Command | `npm run build` |
| Install Command | `npm ci` |
| Output Directory | `.next` (Next.js 기본값) |
| Node.js | 22.x 이상 |
| 환경변수 | `STOCK11_DATA_PROVIDER=naver` (생략해도 기본값) |

`vercel.json`에 동일한 빌드 설정을 포함했습니다. 이미 실패한 프로젝트가 있다면 프리셋과 기존 사용자 지정 Build/Output 설정을 위 값으로 고친 뒤 최신 `main`을 재배포합니다.

Vercel에서는 시세·지수·실제 분봉을 네이버 증권에서 **30초마다** 갱신합니다. 이 주기는 앱의 재조회 간격이며 제공처 자체의 지연을 보장하지 않습니다. KIS 키는 Vercel에 넣지 않습니다. Vercel 환경에서는 KIS 장기 연결을 비활성화합니다.

## Oracle: Docker Compose 실행

Docker Engine과 Docker Compose v2가 설치된 Oracle 서버에서 실행합니다. 기존 다른 앱 폴더가 아닌 Stock11 전용 디렉터리를 사용하세요.

```sh
git clone https://github.com/ddubii00/ddubii00-stock11.git
cd ddubii00-stock11
cp .env.oracle.example .env.oracle
chmod 600 .env.oracle
```

서버에서 `.env.oracle`을 편집해 **본인의 실제 KIS 키**를 넣습니다. 실제 키를 채팅에 붙여 넣거나 GitHub에 올리지 마세요.

```dotenv
KIS_APP_KEY=발급받은_APP_KEY
KIS_APP_SECRET=발급받은_APP_SECRET
KIS_MAX_SUBSCRIPTIONS=40
STOCK11_PORT=3011
```

```sh
docker compose --env-file .env.oracle up -d --build
docker compose --env-file .env.oracle ps
curl http://127.0.0.1:3011/api/health
curl http://127.0.0.1:3011/api/runtime
```

정상 설정이면 health는 `{"status":"ok"}`, runtime은 `{"provider":"kis","refreshMs":30000}`을 반환합니다. 이는 앱 실행 확인이며 KIS 인증 성공을 의미하지는 않습니다. 장중 화면 하단에서 KIS 승인 구독 수를 확인하세요.

- `app`: 비관리자 사용자로 실행하는 Next.js standalone 서버. KIS 키를 받지 않습니다.
- `kis-relay`: KIS 키를 가진 별도 중계기. Docker 사설망으로만 연결되며 호스트에 포트를 공개하지 않습니다. 계좌조회·주문 API는 사용하지 않습니다.
- 재부팅/프로세스 종료 후 자동 재시작 설정을 포함합니다. 서버의 Docker 서비스도 부팅 시 시작하도록 운영 환경에서 설정해야 합니다.
- `.env.oracle`은 Git과 Docker 빌드 컨텍스트에서 제외됩니다. 키는 이미지에 굽지 않고 중계기에만 실행 시 전달합니다. 서버 관리자/Docker 관리자에게는 환경변수가 보일 수 있습니다.

### 외부 접속과 HTTPS

웹앱은 기본적으로 서버의 `127.0.0.1:3011`에만 열립니다. 기존 HTTPS Nginx의 **Stock11 전용 호스트**에 `deploy/nginx-stock11.conf.example`을 참고해 프록시를 추가하세요. KIS SSE 경로는 버퍼링을 끄고 긴 타임아웃을 사용해야 합니다. 현재 설정은 도메인 루트(`/`) 기준이며 다른 앱의 하위 경로를 임의로 덮어쓰지 않습니다.

도메인·인증서·Oracle 방화벽/보안 목록은 실제 서버에 맞게 별도로 설정해야 합니다. Docker 포트를 인터넷에 직접 공개하지 않는 구성을 권장합니다.

### 업데이트

```sh
git pull --ff-only origin main
docker compose --env-file .env.oracle build --pull
docker compose --env-file .env.oracle up -d
```

충돌이 있으면 내용을 확인하세요. 기존 서버 파일을 강제 초기화하지 않습니다. `.env.oracle`은 Git에 포함되지 않아 유지됩니다.

## KIS 실시간 방식과 제한

KIS의 국내 `H0STCNT0`, 미국 `HDFSCNT0` 시세를 한 개의 공유 WebSocket으로 받고 `/api/live` SSE를 통해 화면에 전달합니다. NASDAQ·NYSE·AMEX는 거래소별로 구독하며 새로운 체결은 현재가·등락률·해당 분의 차트에 반영합니다. 정규장 시간 외 체결은 제외하고 장종료 후에는 네이버 정규장 최종가격을 유지합니다.

- 기본 동시 구독 상한은 **40종목**입니다. 여러 접속자도 이 한도를 공유합니다. 표시 종목을 거래소별로 구독하고, 나머지 종목과 지수는 30초 네이버 갱신을 유지합니다. **200종목 모두 KIS 실시간이라고 표시하지 않습니다.** 화면 하단에 승인된 구독 수를 표시합니다.
- 분봉 이력은 네이버에서 가져오고 신규 KIS 체결로 이어 그립니다. 가상 가격이나 임의 분봉은 만들지 않습니다.
- KIS 접속 실패 시 연결 대기를 표시하고 네이버 갱신을 유지합니다. NASDAQ은 KIS 해외시세 이용 권한과 지연 정책의 영향을 받습니다. 코드 미지원 종목도 기본 갱신을 유지합니다.
- 실제 KIS 인증과 실체결 검증에는 사용자 키가 필요합니다. 서버 설정 파일을 준비한 것과 실제 서버 배포/실체결 확인은 별개입니다.
- 공개 운영 전 시세 제공처의 이용·재배포 조건을 확인하고, 필요하면 Nginx 등에서 접근을 제한하세요.

공식 참고: [KIS 국내 예제](https://github.com/koreainvestment/open-trading-api/blob/main/legacy/Sample01/kis_domstk_ws.py), [국내/해외 WebSocket 예제](https://github.com/koreainvestment/open-trading-api/blob/main/legacy/websocket/python/ws_domestic%2Boverseas_stock.py).

### NXT 지원 가능 여부

KIS 공식 API는 NXT 체결 `H0NXCNT0`와 통합 체결 `H0UNCNT0`을 지원하므로 연동 가능합니다. **현재 버전은 KRX 정규장 시세이며 NXT를 아직 섞어 표시하지 않습니다.** NXT를 활성화하려면 거래소 선택, 해당 거래시간·기준가·분봉 이력과 실제 키 테스트를 함께 연결해야 합니다. 공식 근거: [KIS 국내 실시간 함수의 ccnl_nxt / ccnl_total](https://github.com/koreainvestment/open-trading-api/blob/main/examples_user/domestic_stock/domestic_stock_functions_ws.py).

## 로컬 개발과 검증

Node.js 22.13 이상이 필요합니다.

```sh
npm ci
npm run dev -- --port 3002
npm test
npm run build
npm run test:runtime
```

`test:runtime`은 임시 포트의 실제 standalone 서버로 Vercel/Oracle 모드, 정적 파일 응답, SSE 전달·해제·오류를 검사합니다. SSE 테스트는 명시적인 테스트 데이터만 사용하며 실제 KIS 키를 사용하거나 사용자 미리보기에 데이터를 넣지 않습니다.

Docker 없이 Oracle에서 실행하려면 `npm run build:standalone` 후 `.next/standalone/server.js`를 Node.js 서비스로 실행하고, KIS 중계기는 `npm run kis:relay`로 별도 상주 실행할 수 있습니다. 앱 환경은 `STOCK11_DATA_PROVIDER=kis`, `KIS_RELAY_URL=http://127.0.0.1:8091`로 설정하고 중계기 환경에만 키를 전달하세요. 서비스 재시작과 HTTPS 프록시는 별도로 구성합니다.

# Stock11 real time stock price

KOSPI · KOSDAQ · NASDAQ · S&P500 구성 종목의 시가총액 상위 200종목을 보는 Next.js 대시보드입니다.

- 밝은 테마, 시장별 시세/차트와 관심종목을 포함한 10개 탭, 주요 지수와 장중/장종료 표시
- 헤더 `T` 버튼으로 많이 보기부터 매우 큰 글씨까지 5단계 셀 크기 전환
- 가격표 최대 4열, 넓은 화면에서 차트 약 60~76종목, 태블릿 방향별 2~3열. 차트 셀은 기본 52~56px(많이 보기 최소 48px), 추세 영역은 34px로 압축하고 가격 글자 크기는 유지합니다. 모든 200종목은 하단 페이지로 이동합니다.
- 스크롤해도 상단 지수·시장 버튼 유지, 표 제목과 순위·종목명 열 고정
- 상승 빨강/하락 파랑, 전일 종가 기준선, Y축 자동 조절
- 국내 분봉 09:00~15:30, NASDAQ 현지 09:30~16:00 고정 축, 실제 수신 시각까지만 표시
- 종목 클릭 시 네이버 증권 PC 페이지를 새 탭으로 열기
- 축 라벨 없는 짧은 분봉 추세, 전일 대비 빨강/파랑 구간, 변동률 크기에 따른 삼각형 크기 조절
- 헤더 KOSPI·KOSDAQ·NASDAQ·S&P500 실제 분봉 미니 차트와 USD/KRW 고시환율 분 단위 미니 차트

## 관심종목

`관심종목` 또는 `관심종목 차트`에서 종목명/코드를 입력합니다. `삼성`, `애플`, `AAPL`, `IBM` 등으로 한국·미국 주식을 검색하며 마우스 또는 ↑↓ / Enter로 추가합니다. 중복은 방지하고 최대 200개까지 저장합니다. 각 종목 셀 오른쪽 위의 작은 ×로 삭제합니다. 비밀번호 로그인을 설정하면 관심종목·순서·색상·글자 크기를 서버에 저장해 같은 주소로 접속한 기기에서 공유합니다. Vercel은 Redis Cloud, Oracle은 서버 내부 SQLite를 사용합니다. 미설정 시 기존 브라우저 localStorage 모드를 유지합니다.

관심종목에서 한국·미국 주식과 ETF를 이름 일부(하이닉스), 티커(QQQ), 번호(069500)로 검색할 수 있습니다. ETF도 현재가·등락률과 분봉 추이를 표시합니다. 제공처에 없는 종목이나 분봉은 수신 실패로 표시하며 임의로 생성하지 않습니다.

모든 시장과 관심종목의 셀 배경은 **한 번 클릭하면 반투명 노란색**, **더블클릭하면 반투명 빨간색**, **색상이 있는 상태에서 한 번 더 클릭하면 해제**됩니다. 종목명 링크와 삭제 버튼은 배경색을 바꾸지 않습니다. 관심종목은 셀 배경을 다른 종목 셀로 드래그해 순서를 바꿉니다. 변경한 순서는 두 관심종목 탭에서 공유하며 저장 모드에 따라 Redis 또는 브라우저에 저장되어 새로고침 후에도 유지됩니다.

관심종목 차트는 **KOSPI 차트와 동일한 실제 분봉 추세**입니다. 일봉 선택 UI는 없으며, 현재가·등락률과 분봉 선의 색은 전일 종가 대비입니다. 종목이 1~2개뿐이어도 일반 시장의 200종목 화면과 같은 셀 높이를 유지합니다. 국내는 09:00~15:30, 미국은 현지 09:30~16:00 축을 사용하고, KIS 틱은 현재가와 분봉 추세에 반영합니다. 각 종목의 통화·정규장 상태·데이터 날짜를 구분하고 장종료 시 정규장 최종가격을 유지합니다.

환율 미니 차트는 헤더와 같은 네이버 USD/KRW 고시환율을 한국 주식장 기준 **09:00–15:30 (한국시간)** 고정축으로 표시합니다. 외환시장 전체 거래시간을 나타내는 차트는 아닙니다. 같은 분의 마지막 고시값만 남기며, 09:00 이전·15:30 이후 값은 제외합니다. 현재 시각 이후는 빈 공간으로 유지하고 미수신 분은 만들지 않습니다. 30초마다 재조회하며 전 거래일 자료는 해당일의 장중 구간만 표시합니다.

시장별 종목 차트는 시가총액 순위대로 위에서 아래로 배치한 후 다음 열로 이어집니다. 종목명만 네이버 PC 페이지로 연결됩니다. 관심종목과 같은 종목의 시장별 시세·차트는 색상과 해제를 양방향 공유합니다. 로컬 모드에서는 다른 기기와 독립적입니다. 서버 모드에서는 Vercel 접속 기기끼리 Redis 기록을, Oracle 접속 기기끼리 Oracle의 SQLite 기록을 공유합니다. 두 서버의 기록은 서로 독립적입니다.

## 서버 영구 저장 및 로그인

Vercel은 표준 `redis`(node-redis)와 `REDIS_URL`을 사용합니다. Oracle Docker 배포는 Redis 없이 영구 Docker volume의 SQLite 파일을 사용합니다. 두 환경 모두 화면에서 `STOCK11_SYNC_PASSWORD` 비밀번호 하나만 입력합니다. 저장 기능은 기존 시세·KIS 경로와 분리되어 저장소 장애가 시장정보 조회를 중단시키지 않습니다.

[설정·보안·동기화·Vercel/Oracle 배포·검증·롤백 안내](docs/redis-storage.md)를 참고하세요. 최초 로그인에서 Redis가 비어 있을 때만 **이 브라우저 기록 가져오기**를 명시적으로 선택할 수 있으며, 오래된 브라우저가 서버 기록을 자동으로 덮어쓰지 않습니다.

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

서버에서 `.env.oracle`을 편집해 **본인의 실제 KIS 키**, 로그인 비밀번호, 실제 접속 주소를 넣습니다. 실제 키나 비밀번호를 채팅에 붙여 넣거나 GitHub에 올리지 마세요.

```dotenv
KIS_APP_KEY=발급받은_APP_KEY
KIS_APP_SECRET=발급받은_APP_SECRET
KIS_MAX_SUBSCRIPTIONS=40
STOCK11_PORT=3011
STOCK11_SYNC_PASSWORD=12자_이상의_개인용_비밀번호
STOCK11_SYNC_ORIGIN=https://stock11.example.com
```

Oracle에서는 Redis 주소를 입력하지 않습니다. Compose가 `/app/data/stock11-profile.sqlite`에 서버 공용 기록을 만들고 `stock11-profile` Docker volume에 보존합니다. 같은 Oracle 주소로 접속한 PC·태블릿·휴대폰은 각각 화면에서 위 비밀번호만 입력하면 동일한 관심종목·순서·배경색·글자 크기를 봅니다. Vercel 기록과 Oracle 기록은 서로 독립적입니다.

```sh
docker compose --env-file .env.oracle up -d --build
docker compose --env-file .env.oracle ps
curl http://127.0.0.1:3011/api/health
curl http://127.0.0.1:3011/api/runtime
```

정상 설정이면 health는 `{"status":"ok"}`, runtime은 `{"provider":"kis","refreshMs":30000}`을 반환합니다. 이는 앱 실행 확인이며 KIS 인증 성공을 의미하지는 않습니다. 장중 화면 하단에서 KIS 승인 구독 수를 확인하세요.

- `app`: 비관리자 사용자로 실행하는 Next.js standalone 서버. KIS 키를 받지 않습니다.
- `stock11-profile`: 로그인 세션과 관심종목 기록을 담는 Oracle 내부 영구 volume입니다. 이미지 재빌드와 일반 `docker compose down` 뒤에도 유지됩니다. 기록을 보존하려면 `docker compose down -v`로 volume을 삭제하지 마세요.
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

헤더의 **KRX**는 정규장 15:30 기준가를, **KRX2**는 네이버가 제공하는 장후 체결 필드(`overMarketPriceInfo`)가 유효한 국내 종목에 한해 장후 현재가·등락률·거래량을 표시합니다. 장후 값이 없으면 정규장 값을 그대로 유지합니다. 이 선택은 종목 현재가 표시용이며, 분봉 이력과 KIS SSE는 정규장 기준을 유지합니다.

KIS 공식 API는 NXT 체결 `H0NXCNT0`와 통합 체결 `H0UNCNT0`을 지원하므로, 향후 장후 분봉까지 실시간으로 연결할 수 있습니다. 이를 활성화하려면 거래소 선택, 해당 거래시간·기준가·분봉 이력과 실제 키 테스트를 함께 연결해야 합니다. 공식 근거: [KIS 국내 실시간 함수의 ccnl_nxt / ccnl_total](https://github.com/koreainvestment/open-trading-api/blob/main/examples_user/domestic_stock/domestic_stock_functions_ws.py).

## 로컬 개발과 검증

Node.js 22.13 이상이 필요합니다.

```sh
npm ci
npm run dev -- --port 3002
npm test
npm run build
npm run test:runtime
```

디스크 공간이 부족한 로컬 환경에서는 `STOCK11_LOW_DISK_BUILD=1 npm run build`로 Webpack 디스크 캐시를 생략할 수 있습니다. 결과물 저장 공간은 여전히 필요하며 기본 배포 캐시는 변경하지 않습니다.

`test:runtime`은 임시 포트의 실제 standalone 서버로 Vercel/Oracle 모드, 정적 파일 응답, SSE 전달·해제·오류를 검사합니다. SSE 테스트는 명시적인 테스트 데이터만 사용하며 실제 KIS 키를 사용하거나 사용자 미리보기에 데이터를 넣지 않습니다.

Docker 없이 Oracle에서 실행하려면 `npm run build:standalone` 후 `.next/standalone/server.js`를 Node.js 서비스로 실행하고, KIS 중계기는 `npm run kis:relay`로 별도 상주 실행할 수 있습니다. 앱 환경은 `STOCK11_DATA_PROVIDER=kis`, `KIS_RELAY_URL=http://127.0.0.1:8091`로 설정하고 중계기 환경에만 키를 전달하세요. 서비스 재시작과 HTTPS 프록시는 별도로 구성합니다.

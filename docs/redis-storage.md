# Stock11 서버 저장·비밀번호 로그인 안내

## 저장 방식

Stock11은 같은 비밀번호를 사용하는 개인용 서버 기록 한 개를 제공합니다. 별도 아이디·회원가입은 없으며 로그인 화면에서 비밀번호만 입력합니다.

- Vercel: 표준 `redis`(node-redis)와 `REDIS_URL`로 Redis Cloud에 저장합니다.
- Oracle Docker: Node.js 내장 `node:sqlite`로 서버의 `/app/data/stock11-profile.sqlite`에 저장합니다. Redis가 필요하지 않습니다.
- 저장 대상: 한국·미국 주식/ETF 관심종목 최대 200개, 혼합 순서, 노란색·빨간색 표시, 글자 크기 설정.
- 저장하지 않는 대상: 시세, KIS 키·토큰, 로그인 비밀번호 원문.

Vercel과 Oracle은 서로 다른 저장소이므로 기록도 서로 독립적입니다. 같은 Oracle 주소에 접속한 여러 컴퓨터는 Oracle 서버의 한 SQLite 기록을 공유하고, 같은 Vercel 주소에 접속한 컴퓨터는 Redis Cloud 기록을 공유합니다. 각 주소에서 한 번씩 로그인해야 합니다.

## 파일 구성

- `lib/profile-store.ts`: 환경에 따라 Redis 또는 SQLite 저장소 선택.
- `lib/redis.ts`: Vercel Redis 연결과 공통 key namespace.
- `lib/sqlite-store.ts`: Oracle SQLite 파일, TTL, 트랜잭션 CAS.
- `lib/profile.ts`: 저장 형식과 변경 작업 검증.
- `lib/profile-service.ts`, `lib/profile-http.ts`: 비밀번호, 세션, 요청 검증, 동시 변경 처리.
- `app/api/session/route.ts`, `app/api/profile/route.ts`: 로그인과 사용자 기록 API.
- `compose.yaml`: Oracle SQLite 영구 volume과 실행 설정.

## 논리 key와 저장 데이터

Redis와 SQLite가 같은 논리 key 규칙을 사용합니다. 기본 사용자 상태는 `stock11:user:personal:state`입니다. `STOCK11_USER_ID`는 서버 환경변수이며 브라우저가 임의로 바꿀 수 없습니다.

- `stock11:user:*`: 관심종목, 순서, 색상, 설정.
- `stock11:system:*`: 로그인 세션과 로그인 시도 제한.
- `stock11:market:*`: 향후 시장 데이터용 예약 구역.
- `stock11:signal:*`: 향후 매매 신호용 예약 구역.
- `stock11:realtime:*`: 향후 실시간 상태용 예약 구역.

사용자 상태는 TTL 없이 보존합니다. 세션은 7일 뒤, 로그인 시도 제한 자료는 해당 제한 시간이 지나면 만료됩니다. KIS 수신, 수급·지표 계산, Telegram, 자동매매 기능은 이번 저장 작업에 추가하지 않았습니다.

## 로그인과 보안

요청한 개인용 공통 비밀번호 방식입니다. 비밀번호를 아는 사람은 같은 서버 기록을 사용할 수 있으므로 공유하지 마세요.

- `GET /api/session`: 저장 기능과 로그인 상태만 확인.
- `POST /api/session`: 비밀번호 로그인.
- `DELETE /api/session`: 현재 브라우저 로그아웃.
- `GET /api/profile`: 로그인한 사용자 기록 읽기.
- `PATCH /api/profile`: 관심종목 추가·삭제·이동, 색상, 설정, 최초 가져오기.
- `GET /api/health/redis`: Vercel Redis 연결 상태만 확인. Oracle SQLite 확인 주소가 아닙니다.

세션은 난수 토큰을 사용한 HttpOnly·SameSite=Strict 쿠키이며 HTTPS에서는 Secure가 추가됩니다. 비밀번호는 12~256자만 허용하고 원문을 저장하지 않습니다. 10분 구간당 로그인 시도는 최대 20회이며, 다른 Origin의 쓰기 요청과 지나치게 큰 요청을 거부합니다.

## 여러 기기와 동시 변경

서버의 최신 기록이 기준입니다. Redis는 Lua CAS, SQLite는 `BEGIN IMMEDIATE` 트랜잭션 CAS로 최신 상태에 작업을 적용합니다. 다른 기기의 목록 전체를 덮어쓰지 않으며 같은 항목은 서버에 마지막으로 반영된 작업이 기준입니다.

화면에서는 10초마다, 그리고 창으로 돌아올 때 최신 기록을 확인합니다. 저장 전 통신 오류가 나면 자동으로 임의 재전송하지 않고 ‘다시 저장’으로 재시도합니다. 서버 기록이 비어 있을 때만 사용자가 **이 브라우저 기록 가져오기**를 눌러 기존 localStorage 기록을 한 번 옮길 수 있습니다.

서버 저장을 설정하지 않거나 `STOCK11_SYNC_ENABLED=false`이면 기존 브라우저 localStorage 모드로 동작합니다. 비밀번호와 세션 토큰은 localStorage에 저장하지 않습니다.

## Vercel 설정

Vercel 프로젝트 환경변수에 다음을 설정한 뒤 재배포합니다.

```dotenv
REDIS_URL=Redis_Cloud에서_발급한_비공개_연결주소
STOCK11_SYNC_PASSWORD=12자_이상의_개인용_비밀번호
STOCK11_USER_ID=personal
STOCK11_REDIS_PREFIX=stock11
```

`STOCK11_USER_ID`와 `STOCK11_REDIS_PREFIX`는 위 값이 기본이라 생략할 수 있습니다. `REDIS_URL`과 비밀번호는 GitHub·채팅·클라이언트 코드에 넣지 않습니다. 환경변수 변경 후 반드시 최신 배포를 다시 실행합니다.

`STOCK11_SYNC_ORIGIN`은 선택 사항입니다. 지정한다면 해당 환경의 정확한 HTTPS origin만 쓰고 끝의 `/`는 넣지 마세요. Production 주소를 Preview 설정에 그대로 넣으면 Preview 로그인이 차단됩니다. Preview 기록을 분리하려면 Preview에만 `STOCK11_REDIS_PREFIX=stock11-preview`를 지정합니다.

Vercel 배포 뒤 `/api/health/redis`가 `{ "ok": true, "redis": "connected" }`인지 확인합니다.

## Oracle 설정

`.env.oracle.example`을 `.env.oracle`로 복사하고 KIS 키와 아래 두 값을 입력합니다. Redis 계정이나 `REDIS_URL`은 입력하지 않습니다.

```dotenv
STOCK11_SYNC_PASSWORD=12자_이상의_개인용_비밀번호
STOCK11_SYNC_ORIGIN=https://실제_Oracle_접속_도메인
```

`compose.yaml`이 다음 설정을 자동 적용합니다.

```dotenv
STOCK11_PROFILE_STORE=sqlite
STOCK11_SQLITE_PATH=/app/data/stock11-profile.sqlite
```

```sh
docker compose --env-file .env.oracle up -d --build
docker compose --env-file .env.oracle ps
curl http://127.0.0.1:3011/api/session
```

`/api/session` 응답에 `"enabled":true`와 `"location":"Oracle 서버"`가 나오면 저장 로그인 설정이 켜진 것입니다. 웹 화면에서 비밀번호만 입력한 뒤 관심종목을 추가하고 다른 컴퓨터에서도 같은 Oracle 주소에 로그인해 확인합니다.

SQLite 파일은 `stock11-profile` Docker named volume에 있습니다. 일반 재빌드·재시작과 `docker compose down`에는 유지됩니다. **기록을 보존하려면 `docker compose down -v`를 실행하지 마세요.** 서버 자체가 유실될 경우를 대비한 volume 백업은 운영자가 별도로 준비해야 합니다.

Docker 없이 실행할 때는 Node.js 프로세스에 `STOCK11_PROFILE_STORE=sqlite`, 쓰기 가능한 절대 `STOCK11_SQLITE_PATH`, 비밀번호와 HTTPS origin을 전달합니다. 파일을 여러 서버가 네트워크 공유하는 구조는 지원하지 않습니다.

## 확인 순서

1. `/api/session`에서 `enabled:true`를 확인합니다.
2. 로그인 전 `/api/profile`은 401이어야 합니다.
3. 화면에서 비밀번호를 입력해 로그인합니다.
4. 한국·미국·ETF를 추가하고 순서·노란색·빨간색·글자 크기를 변경해 ‘서버 저장 ✓’를 확인합니다.
5. 다른 컴퓨터에서 같은 사이트에 로그인해 동일한 기록이 보이는지 확인합니다.
6. Oracle은 컨테이너 재시작 뒤에도 기록이 남는지 확인합니다. Vercel은 `/api/health/redis`도 확인합니다.

## 장애와 되돌리기

저장소 장애 시 마지막 확인 기록을 읽기 전용으로 보여주고 시장 시세 조회는 계속합니다. 저장 기능만 끄려면 `STOCK11_SYNC_ENABLED=false`로 바꾸고 재배포/재시작합니다. 브라우저 localStorage 모드로 돌아가며 기존 Redis나 SQLite 기록은 지우지 않습니다.

Oracle SQLite 기록을 보존한 채 코드를 되돌릴 수 있습니다. `docker compose down -v`, Redis의 `FLUSHDB`·`FLUSHALL`, `stock11:*` 전체 삭제는 사용하지 마세요.

공식 참고: [Node.js SQLite](https://nodejs.org/api/sqlite.html), [node-redis 연결](https://redis.io/docs/latest/develop/clients/nodejs/connect/)

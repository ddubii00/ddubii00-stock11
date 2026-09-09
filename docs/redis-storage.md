# Stock11 Redis Cloud 저장·로그인 안내

## 구현 범위

Next.js App Router / React / Node.js 구조를 유지하고 공식 `redis`(node-redis) 패키지를 추가했습니다. Vercel Production·Preview와 Oracle Ubuntu Node.js가 `lib/redis.ts`를 함께 사용합니다. `@upstash/redis`, Vercel KV, SQLite 전용 저장소는 사용하지 않습니다.

기존 한국·미국·ETF 관심종목은 하나의 혼합 배열로 저장됩니다. 배열 순서가 화면 순서이며 `market:chartCode`가 종목 식별자입니다. 배열을 별도 국가별 키로 쪼개지 않아 혼합 순서와 색상을 원자적으로 변경할 수 있습니다.

## 파일 구성

- 연결: `lib/redis.ts` — `REDIS_URL`, 전역 연결·연결 중 Promise 재사용, HMR 재사용, 제한된 재연결, 시간 초과, 오류 내용 비공개.
- 저장: `lib/profile-store.ts` — 표준 Redis GET / Lua 비교 후 저장(CAS) / DEL.
- 상태: `lib/profile.ts` — 버전, 관심종목 메타데이터·순서, 색상, 글자 크기 설정의 검증과 변경 적용.
- 보안: `lib/profile-service.ts`, `lib/profile-http.ts` — 비밀번호 검사, 시도 제한, 세션, 요청 검증, 원자적 변경.
- API: `app/api/session/route.ts`, `app/api/profile/route.ts`, `app/api/health/redis/route.ts`.
- 화면: `hooks/use-server-profile.ts`, `components/profile-login.tsx`, 기존 대시보드·관심종목 검색창.
- 로컬 호환: `hooks/use-stock-highlights.ts`, `lib/stock-highlights.ts`와 기존 관심종목 저장 키 유지.
- 검증: `tests/profile.test.mjs`, `tests/server-profile-ui.test.mjs`, `tests/stock-highlights.test.mjs`, `tests/dow.test.mjs`, 기존 검색·차트·드래그 테스트.

## Redis 키와 저장 데이터

기본 사용자 키는 `stock11:user:personal:state`입니다. `STOCK11_USER_ID`는 서버 설정이며 브라우저 요청으로 다른 사용자를 지정할 수 없습니다. `STOCK11_REDIS_PREFIX` 기본값은 `stock11`입니다.

상태 레코드는 `{ profile, recent }` 구조입니다.

- `profile.version`: 스키마 버전 1.
- `profile.revision`, `updatedAt`: 서버가 증가시키는 변경 번호와 저장 시각.
- `profile.watchlist`: 최대 200개. `code`, `chartCode`, `name`, `market`, ETF 메타데이터와 배열 순서 보존.
- `profile.highlights`: 최대 2000개의 종목 키와 `yellow` / `red`.
- `profile.settings.largeText`: 글자 크기 선택. 자동 새로고침 일시정지는 현재 세션 설정으로 유지합니다.
- `recent`: 최근 요청 ID 최대 200개. 응답 유실 뒤 같은 요청 재시도 시 중복 적용 방지. 클라이언트에는 반환하지 않습니다.

상태 키에는 TTL을 설정하지 않습니다. 로그인 세션은 `stock11:system:session:<사용자 구역 해시>:<토큰 해시>`, 시도 제한은 `stock11:system:login:<사용자 구역 해시>:<시간 구간>`에 저장하며 만료 시간이 있습니다. 로그인 비밀번호 원문, Redis 접속정보, KIS 키·토큰은 Redis 상태에 저장하지 않습니다.

키 생성 함수에서 다음 구역을 구분합니다. **market·signal·realtime에는 이번 작업이 데이터를 쓰지 않으며**, system에는 인증 관련 데이터만 씁니다.

- `stock11:market:*`: 향후 시장 데이터
- `stock11:signal:*`: 향후 매매 신호
- `stock11:realtime:*`: 향후 실시간 상태
- `stock11:system:*`: 시스템 상태 및 현재 인증 세션·시도 제한

KIS 수신, 수급·지표 계산, Telegram, 자동매매 연동은 새로 구현하지 않았습니다.

## 인증과 API

요청한 개인용 공통 비밀번호 로그인입니다. 여러 사람이 각자 가입하는 다중 사용자 서비스는 아닙니다. 같은 비밀번호를 아는 사람은 같은 개인 사용자 기록을 사용할 수 있으므로 비밀번호를 공유하지 마세요.

- `GET /api/session`: 서버 저장 설정 여부와 로그인 상태. 개인 기록을 반환하지 않음.
- `POST /api/session`: 비밀번호 로그인. 서버 저장소 기준 10분 구간당 최대 20회 로그인 시도 제한.
- `DELETE /api/session`: 해당 세션을 서버에서 폐기하고 쿠키 삭제.
- `GET /api/profile`: 로그인한 사용자 상태만 읽기.
- `PATCH /api/profile`: 로그인 후 추가·삭제·순서 이동·색상·설정·최초 가져오기 작업만 허용.
- `GET /api/health/redis`: PING 결과만 반환. 연결 문자열·호스트·계정·비밀번호는 반환하지 않음.

세션은 난수 토큰을 이용한 HttpOnly·SameSite=Strict 쿠키입니다. HTTPS에서는 Secure를 추가합니다. 서버에는 토큰 해시와 비밀번호 변경 감지용 토큰 결합 해시만 저장하며 7일 뒤 만료됩니다. 비밀번호를 변경하면 기존 세션은 무효가 됩니다. 외부 Origin 쓰기 요청을 거부하고 JSON 크기(상태 요청 128KB, 로그인 2KB), 색상, 종목 키, 배열 크기를 검증합니다. Redis가 없어도 빌드는 가능하며, `REDIS_URL`만 있고 비밀번호가 없으면 공개 쓰기 API는 활성화되지 않습니다.

모든 Redis API는 `runtime = 'nodejs'`입니다. 연결 모듈은 Node 내장 모듈에 의존하며 클라이언트 컴포넌트에서 가져오지 않습니다. 오류 객체나 접속 문자열은 로그에 출력하지 않습니다.

## 최신 변경·여러 기기·장애 처리

서버가 기준입니다. 각 작업은 서버의 최신 상태를 읽어 적용한 뒤 Lua CAS로 저장합니다. 충돌하면 최신 상태로 최대 8회 재시도합니다. 다른 기기의 목록 전체를 덮어쓰지 않으며, 색상 등 같은 항목의 변경은 **서버에 마지막으로 반영된 작업**이 기준입니다. 기기 시계에는 의존하지 않습니다. 삭제된 종목을 다른 기기의 색상 변경이 되살리지 않습니다.

클라이언트는 변경 작업을 순서대로 전송합니다. 드래그 중이 아니라 드롭 때 한 번만 순서를 저장합니다. 백그라운드가 아닌 화면에서는 10초마다, 그리고 창 복귀 시 최신 기록을 가져옵니다. 미저장 변경이 있으면 자동으로 재전송하지 않고 ‘다시 저장’을 눌러 명시적으로 재시도합니다. 재시도는 같은 요청 ID를 사용합니다. 저장 전 페이지를 닫으려 하면 브라우저 경고를 요청합니다.

원래 `stock11.watchlist.v1`, `stock11.highlights.v1`은 보존합니다. 로그인 후 서버가 비어 있을 때만 ‘이 브라우저 기록 가져오기’로 1회 옮깁니다. 자동 업로드하지 않으므로 오래된 브라우저가 서버 기록을 덮어쓰지 않습니다. 서버 기록이 생기면 다시 가져오기를 거절합니다.

확인된 서버 상태는 `stock11.server-profile.v1`에 로컬 캐시합니다. Redis 장애 시 마지막 확인 기록을 읽기 전용으로 표시하고 시장 시세 조회는 계속 실행합니다. 오류 중 빈 배열을 Redis에 저장하지 않습니다. 로그아웃·401 응답 시 개인 화면과 서버 캐시를 비웁니다. 서버 저장 미설정 시 기존 브라우저 저장 모드로 동작합니다. 비밀번호와 세션 토큰은 localStorage에 저장하지 않습니다.

## Vercel 설정

Redis Cloud 연결로 생성된 기존 `REDIS_URL`은 그대로 둡니다. 값은 채팅이나 저장소에 붙여 넣지 마세요.

1. Vercel 환경변수에 `STOCK11_SYNC_PASSWORD`를 12자 이상의 개인 비밀번호로 설정합니다.
2. `STOCK11_USER_ID=personal`, `STOCK11_REDIS_PREFIX=stock11`을 사용합니다(생략해도 이 기본값).
3. `STOCK11_SYNC_ENABLED=true`가 기본 동작입니다. `false`이면 서버 저장을 끄고 로컬 모드로 돌아갑니다.
4. `STOCK11_SYNC_ORIGIN`은 선택 사항입니다. Vercel은 요청 URL로 동일 출처를 확인하므로 Preview마다 URL이 달라도 작동합니다. 지정한다면 해당 환경의 정확한 HTTPS origin만 쓰고 끝의 `/`는 넣지 마세요. Production URL을 Preview 변수에 그대로 지정하면 Preview 로그인이 차단됩니다.
5. 환경변수 변경 후 재배포합니다. Node.js 22.13 이상을 사용합니다.

같은 Redis 데이터베이스·prefix·user ID를 사용하면 Production/Preview/Oracle이 동일한 사용자 상태를 공유합니다. Preview를 테스트용으로 격리하려면 Preview에만 `STOCK11_REDIS_PREFIX=stock11-preview`를 지정하세요. 이는 별도 접속 코드가 아니라 저장 키 구역만 바꿉니다.

## Oracle 설정

`compose.yaml`의 app 컨테이너에 `.env.oracle`의 `REDIS_URL`, `STOCK11_SYNC_PASSWORD`, `STOCK11_SYNC_ORIGIN`, `STOCK11_USER_ID`, `STOCK11_REDIS_PREFIX`를 전달합니다. `STOCK11_SYNC_ORIGIN`은 nginx 앞의 실제 HTTPS 주소로 지정합니다. Redis Cloud와 통신 가능한 방화벽·TLS 설정을 사용하세요. 영구 사용자 데이터는 컨테이너 파일이 아니라 Redis에 있으므로 별도 SQLite 볼륨은 필요 없습니다.

기존 절차로 컨테이너를 재빌드·재시작합니다. 미래 Node.js 작업에서도 `getRedis`, `withRedis`, `redisKey`를 같은 모듈에서 재사용할 수 있습니다. 별도 worker 종료 시에만 `closeRedis()`를 호출하며, HTTP 요청마다 연결을 종료하지 않습니다. 장기 실행 프로세스에서도 끊긴 연결은 다음 호출에서 다시 연결합니다.

## 실제 환경 검증

1. `/api/health/redis`에 접속하여 `{ "ok": true, "redis": "connected" }`인지 확인합니다. 실패 응답은 503 / unavailable이며 서버 정보는 노출하지 않습니다.
2. 로그인 전 `/api/profile`은 401이어야 합니다(서버 설정 자체가 없으면 503).
3. 로그인 후 한국 주식·미국 주식·ETF를 추가하고, 순서를 바꾸고, 노란색·빨간색 및 글자 크기를 변경합니다. ‘서버 저장 ✓’를 확인합니다.
4. 다른 기기에서 같은 사이트에 로그인해 기록을 확인합니다. 두 기기에서 서로 다른 종목을 추가해도 둘 다 남는지 확인합니다.
5. 같은 Redis 구역을 쓰는 Oracle/Preview에서도 로그인해 확인합니다. 각 도메인의 로그인 쿠키는 별개이므로 각각 로그인해야 합니다.
6. 임시로 연결 장애를 만들 경우 테스트용 Preview에서만 진행합니다. 시장 시세는 계속 보이고, 미저장 안내 또는 읽기 전용 캐시가 나타나는지 확인합니다. 복구 후 ‘다시 저장’으로 확인합니다.

개발 환경에는 실제 Redis Cloud 자격 증명이 없어서 실접속·영구 보존 및 Vercel 배포 성공을 대신 확인했다고 주장하지 않습니다. 테스트는 위 검증을 대체하지 않습니다.

## Rollback

가장 빠른 되돌리기는 `STOCK11_SYNC_ENABLED=false`로 설정 후 재배포입니다. Redis 상태는 지워지지 않고 기존 브라우저 저장 기능이 유지됩니다. 코드를 되돌릴 때는 이 변경의 커밋을 `git revert <커밋>` 하거나 Vercel의 이전 배포로 되돌립니다. 현재 작업 전 기준 커밋은 `298e594`입니다. `FLUSHDB`, `FLUSHALL` 또는 `stock11:*` 전체 삭제는 하지 마세요. Cloud 데이터의 장기 내구성·백업·eviction 정책은 Redis Cloud 설정에서도 확인해야 합니다.

공식 연결 문서: https://redis.io/docs/latest/develop/clients/nodejs/connect/

# 서버 저장 기능 결과 보고

2026-09-09 기준입니다. Vercel은 Redis Cloud, Oracle Docker는 서버 내부 SQLite 영구 volume을 사용합니다. 실제 비밀번호·Redis 접속주소·KIS 키는 소스와 Git에 넣지 않습니다.

## 구현 결과

- 관심종목 최대 200개, 한국·미국 주식/ETF 혼합 순서, 노랑·빨강 표시, 글자 크기를 서버에 저장합니다.
- 아이디나 회원가입 없이 공용 개인 비밀번호 한 개만 입력합니다.
- Vercel 접속 기기끼리는 Redis Cloud 기록을 공유합니다.
- Oracle 접속 기기끼리는 Oracle의 SQLite 기록을 공유합니다.
- Vercel과 Oracle 기록은 자동 동기화하지 않으며 서로 독립적입니다.
- 저장 기능은 시세·KIS 중계 경로와 분리되어 저장 장애가 시장 조회를 중단시키지 않습니다.

## 주요 파일

- `lib/redis.ts`: Vercel의 표준 node-redis 연결.
- `lib/sqlite-store.ts`: Oracle의 Node.js 내장 SQLite 파일 저장.
- `lib/profile-store.ts`: `REDIS_URL` 또는 `STOCK11_PROFILE_STORE=sqlite`에 따른 공통 저장 인터페이스 선택.
- `lib/profile.ts`, `lib/profile-service.ts`, `lib/profile-http.ts`: 상태 검증, 비밀번호 세션, 동시 변경.
- `app/api/session/route.ts`, `app/api/profile/route.ts`: 로그인·프로필 API.
- `hooks/use-server-profile.ts`, `components/profile-login.tsx`: 브라우저 로그인·동기화 UI.
- `compose.yaml`, `Dockerfile`, `.env.oracle.example`: Oracle SQLite 영구 volume과 비관리자 파일 권한.
- `tests/sqlite-store.test.mjs`, `tests/profile.test.mjs`, `tests/runtime-smoke.mjs`: 저장소·보안·실행 검증.

`redis` 패키지는 Vercel용으로 유지합니다. Oracle SQLite는 Node.js 내장 `node:sqlite`를 사용하므로 별도 SQLite npm 패키지를 추가하지 않았습니다.

## 저장 구조

- `stock11:user:personal:state`: 사용자 상태, TTL 없음.
- `stock11:system:session:*`: 만료되는 인증 세션.
- `stock11:system:login:*`: 로그인 시도 제한.
- `stock11:market:*`, `stock11:signal:*`, `stock11:realtime:*`: 향후 확장 구역이며 이번 작업에서는 사용하지 않음.

SQLite는 위 논리 key를 `stock11_kv` 테이블에 저장하고 WAL, FULL synchronous, busy timeout을 적용합니다. 최신 변경 비교는 SQLite 트랜잭션, Redis는 Lua CAS를 사용합니다. 비밀번호 원문, 시세와 KIS 키는 저장하지 않습니다.

## 인증·브라우저 동작

세션은 난수 토큰과 HttpOnly·SameSite=Strict 쿠키를 사용하며 HTTPS에서는 Secure가 추가됩니다. 세션은 7일 만료, 비밀번호 변경 시 기존 세션 무효화, 로그인 시도 제한, 동일 Origin 검증, 요청 크기·입력 검증을 적용합니다.

서버가 기준이며 브라우저는 마지막 확인 상태만 캐시합니다. 서버 기록이 비어 있을 때 사용자가 명시적으로 선택해야 기존 localStorage 기록을 한 번 가져옵니다. 비밀번호와 세션 토큰은 localStorage에 저장하지 않습니다.

## 배포 설정

Vercel은 기존 `REDIS_URL`과 `STOCK11_SYNC_PASSWORD`를 설정하고 재배포합니다. Oracle은 `.env.oracle`에 `STOCK11_SYNC_PASSWORD`, `STOCK11_SYNC_ORIGIN`과 KIS 키만 입력하면 됩니다. Compose가 SQLite 경로와 `stock11-profile` volume을 자동 설정합니다.

Oracle volume은 재빌드와 일반 `docker compose down` 뒤에도 유지됩니다. `docker compose down -v`는 기록을 삭제하므로 사용하지 않습니다. 상세 절차는 [서버 저장·로그인 안내](redis-storage.md)에 있습니다.

## 검증 상태

- `npm test`: 49개 모두 통과. SQLite 파일 저장·CAS·삭제와 3단계 셀 크기를 포함합니다.
- `npm run build`: Next.js production build와 TypeScript 검사 통과.
- `npm run test:runtime`: standalone Oracle 프로세스에서 비밀번호 로그인, 관심종목 저장, 프로세스 종료·재시작, 새 로그인 후 기록 복원까지 통과. 기존 Vercel·KIS 중계 실행 검사도 통과.
- `docker compose --env-file .env.oracle.example config`: 테스트용 KIS 값으로 app의 SQLite 환경변수와 `stock11-profile` volume 연결 확인.
- 변경 파일 대상 `oxlint`, `git diff --check`: 통과.

실제 Vercel Redis Cloud 접속, 실제 Oracle 디스크 내구성, KIS 실체결은 배포 환경에서 별도로 확인해야 합니다.

## 되돌리기

`STOCK11_SYNC_ENABLED=false`로 설정하면 저장 데이터를 지우지 않고 브라우저 localStorage 모드로 돌아갑니다. 코드는 해당 커밋을 revert하거나 이전 배포로 복원합니다. Oracle volume과 Redis 데이터를 삭제하지 않습니다.

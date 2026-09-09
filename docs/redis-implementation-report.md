# Redis 저장 기능 최종 결과 보고

2026-09-09 기준. 코드 구현과 로컬 검증 완료. 실제 Redis Cloud 접속, Vercel·Oracle 원격 배포는 별도 확인이 필요합니다. 이번 작업에서 commit/push는 실행하지 않았습니다.

추가 UI 요구도 반영했습니다. 모든 시장·관심종목의 한 번 클릭은 투명 노랑, 더블클릭은 투명 빨강, 표시된 배경을 다시 한 번 클릭하면 해제됩니다. 같은 종목의 색상은 시장·관심종목·차트에서 공유합니다. NASDAQ 차트 바로 다음에 Dow / Dow 차트를 추가했습니다(Dow 구성 30종목).

## 1. 변경한 파일

- `.env.example`, `.env.oracle.example`: 빈 Redis 연결·로그인 설정 예시.
- `README.md`: 저장 방식, Dow, 배포 및 검증 안내.
- `app/api/market/route.ts`: Dow 허용.
- `app/globals.css`: 작은 로그인·저장 상태 UI.
- `components/stock-dashboard.tsx`: 서버 상태 연결, 전체 시장 색상 클릭 방식, Dow 탭.
- `components/watchlist-toolbar.tsx`: 인증·캐시 상태의 편집 제어.
- `compose.yaml`: Oracle 앱 컨테이너의 공통 Redis 환경변수.
- `lib/market-types.ts`, `lib/naver.ts`, `lib/watchlist.ts`: Dow 그룹과 실제 거래소 식별 유지.
- `next.config.ts`: 선택적 저용량 빌드 모드(기본 배포 캐시 유지).
- `package.json`, `package-lock.json`: node-redis 의존성.
- `tests/runtime-smoke.mjs`, `tests/watchlist-ui.test.mjs`: 실행 환경·색상 회귀 검증.

## 2. 새로 생성한 파일

- `lib/redis.ts`
- `lib/profile.ts`, `lib/profile-store.ts`, `lib/profile-service.ts`, `lib/profile-http.ts`
- `lib/stock-highlights.ts`
- `hooks/use-server-profile.ts`, `hooks/use-stock-highlights.ts`
- `components/profile-login.tsx`
- `app/api/session/route.ts`, `app/api/profile/route.ts`, `app/api/health/redis/route.ts`
- `tests/profile.test.mjs`, `tests/server-profile-ui.test.mjs`, `tests/stock-highlights.test.mjs`, `tests/dow.test.mjs`
- `docs/redis-storage.md`, `docs/redis-implementation-report.md`

## 3. npm package 변경

공식 `redis` 패키지 `^6.2.1` 추가, lockfile에는 6.2.1로 고정했습니다. `npm install redis --no-audit --no-fund` 성공(연관 패키지 포함 8개 추가). Vercel KV·Upstash REST·SQLite 의존성은 추가하지 않았습니다.

## 4. Redis key 구조

- `stock11:user:personal:state`: 영구 사용자 상태, TTL 없음.
- `stock11:system:session:<namespace 해시>:<token 해시>`: 만료되는 인증 세션.
- `stock11:system:login:<namespace 해시>:<시간 구간>`: 로그인 시도 제한.
- `stock11:market:*`, `stock11:signal:*`, `stock11:realtime:*`: 공통 키 생성 함수에서 구역만 예약. 이번 작업에서 시장·자동매매 데이터는 저장하지 않음.

동일 Redis DB·prefix·user ID를 사용하면 Vercel Production/Preview/Oracle이 같은 상태를 공유합니다. Preview 격리는 별도 prefix로 가능합니다.

## 5. Redis 저장 데이터

관심종목 최대 200개(한국·미국·ETF 혼합), 종목 메타데이터, 배열 순서, 색상 최대 2000개, 글자 크기 설정, 스키마 버전, 서버 revision·updatedAt, 최근 변경 요청 ID를 저장합니다. 시세 자체나 KIS 키는 저장하지 않습니다. 동시 변경은 Lua CAS와 최신 상태 재적용으로 처리하며 같은 항목은 서버에 마지막 반영된 변경을 따릅니다.

## 6. localStorage와 Redis 관계

서버가 기준이고 브라우저는 마지막 확인 상태를 캐시합니다. Redis가 비어 있을 때만 사용자가 ‘이 브라우저 기록 가져오기’를 눌러 기존 기록을 1회 옮깁니다. 오래된 브라우저가 자동 덮어쓰지 않습니다. 장애 시 캐시는 읽기 전용이며 미저장 작업은 안내 후 명시적으로 재시도합니다. Redis/비밀번호 미설정 시 기존 로컬 모드가 유지됩니다.

## 7. 인증·보안 상태

요청한 개인용 비밀번호 로그인입니다. 다중 사용자 회원가입 시스템은 아니며 비밀번호를 아는 사람은 동일한 개인 기록을 사용합니다. 인증된 요청만 사용자 상태를 읽고 변경합니다. 난수 세션, HttpOnly·SameSite=Strict·HTTPS Secure 쿠키, 7일 만료, 로그아웃 폐기, 비밀번호 교체 시 세션 무효화, 서버 공통 로그인 시도 제한, 동일 Origin 검증, 요청 크기·입력 검증을 적용했습니다.

실제 비밀번호·REDIS_URL은 소스나 Git에 넣지 않았습니다. 민감 환경파일의 Git 제외를 확인했고 추적되는 환경파일은 빈 값의 example 두 개뿐입니다. 서버 장애 응답에는 호스트·자격 증명이 없습니다. 공개 시장정보 조회는 로그인과 독립적입니다.

## 8. REDIS_URL 사용 위치

실제 접속은 `lib/redis.ts`의 `createClient`에서만 수행합니다. `lib/profile-store.ts`는 설정 존재 여부만 확인합니다. API는 Node.js runtime이며 공통 모듈은 장기 실행 Node 작업에서도 재사용할 수 있습니다. 연결은 지연 생성·재사용하며 시간 초과·제한된 재연결·오류 이벤트 처리를 포함합니다. 환경별 접속 구현을 나누지 않았습니다.

## 9. 실행한 테스트

- `npm test`: **47개 모두 통과**. 관심종목·ETF 검색·혼합 순서·드래그·색상·차트·Dow·KIS 파싱·로그인·CSRF·동시 저장·멱등 재시도·장애 캐시 검증.
- `npm run test:runtime`: **통과**. 실제 standalone 프로세스에서 Vercel/Oracle 모드, 정적 자산, KIS 키 미설정 상태, 모의 SSE 전달·해제·장애 처리, Redis 미설정 503·로컬 모드 응답 검증.
- `npm run lint`: **실행했으나 기존 공통 UI·기존 테스트 등의 오류로 실패**. 이번 변경 애플리케이션 파일을 지정한 `oxlint`는 통과. 전체 lint가 깨끗하다고 주장하지 않음.
- `git diff --check`: 통과.
- 최종 `.next/static`에서 `REDIS_URL`, `STOCK11_SYNC_PASSWORD`, Redis 접속 URL 형식: **각각 0건**.

실제 Redis Cloud 접속과 Lua 실행은 로컬 자격 증명이 없어 미검증입니다. 단위 테스트의 저장소는 메모리 대역이며 실제 Cloud 내구성 테스트와 구분합니다. 실제 KIS 인증·체결 역시 테스트하지 않았습니다.

## 10. npm run build 결과

**최종 일반 `npm run build` 성공**, TypeScript 및 정적 페이지 생성 성공. 로컬 `REDIS_URL` 없이 검증했습니다. 최초 시도는 Mac 디스크 부족(ENOSPC)으로 실패했지만, 생성 캐시 정리 및 저용량 빌드 검증 후 일반 빌드도 다시 성공했습니다. 사용자 문서·다른 프로젝트 파일은 삭제하지 않았습니다.

## 11. Vercel에서 추가할 작업

기존 `REDIS_URL`을 유지하고 `STOCK11_SYNC_PASSWORD`를 12~256자의 강한 개인 비밀번호로 Production/Preview에 설정한 뒤 재배포하세요. `STOCK11_USER_ID=personal`, `STOCK11_REDIS_PREFIX=stock11`은 기본값입니다. Preview에 Production의 고정 `STOCK11_SYNC_ORIGIN`을 복사하지 마세요. Oracle에서는 동일 Redis 설정과 실제 외부 HTTPS origin을 지정합니다. 자세한 절차는 [저장·배포 안내](redis-storage.md)에 있습니다.

## 12. 실제 Redis 확인 방법

1. 배포 주소의 `/api/health/redis`에서 200 / `{"ok":true,"redis":"connected"}` 확인.
2. 로그인 전 `/api/profile` 401, 로그인 후 정상 응답 확인.
3. 한국·미국·ETF 추가 → 드래그 정렬 → 노랑/빨강 → 저장 완료 표시 확인.
4. 다른 PC/휴대폰 및 Oracle 주소에서 각각 로그인하여 동일 상태 확인.
5. 두 기기에서 서로 다른 종목을 동시에 수정하여 양쪽 변경 보존 확인.
6. Preview에서 장애·복구 시 시장조회 유지와 미저장 재시도 확인. Redis Cloud의 백업·내구성·eviction 정책도 확인.

## 13. Rollback

`STOCK11_SYNC_ENABLED=false` 설정 후 재배포하면 Redis를 지우지 않고 로컬 저장 모드로 돌아갑니다. 코드 문제는 해당 변경 커밋을 `git revert`하거나 이전 Vercel 배포로 복원합니다(작업 전 기준 `298e594`). Redis 전체 삭제 명령은 사용하지 마세요.

## Commit/push 판단

**YES — 코드·환경변수 예시를 commit/push할 수 있습니다.** 이는 실제 Redis Cloud 및 원격 배포의 검증 완료를 뜻하지 않습니다. 위 설정과 배포 후 확인은 필요하며 기존 전체 lint 오류는 남아 있습니다.

권장 메시지: `Add Redis-backed profile sync, unified highlights and Dow tabs`

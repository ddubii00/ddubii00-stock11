# stock11 ↔ stock5-8 관심/보유 양방향 동기화

이 디렉터리의 동기화 도구는 Oracle에서 실행되는 `stock11-7`과
`stock5-8`의 네 가지 그룹을 하나의 규칙으로 맞춥니다.

## 매핑

| stock11-7 | stock5-8 |
|---|---|
| `관심`(list 0) + 노란색 배경 | `1. 롱 보유` |
| `관심`(list 0) + 빨간색 배경 | `2. 숏 보유` |
| `롱관심`(list 3) | `3. 롱 관심` |
| `숏관심`(list 4) | `4. 숏 관심` |

최초 1회는 **stock11-7이 기준**입니다. 기존 stock5-8 상태는
`/var/backups/stock-interest-sync/<시각>/`에 백업한 뒤 stock11 기준으로
네 그룹을 투영합니다.

그 이후에는 종목 추가/삭제를 양방향으로 동기화합니다. 같은 종목을
동시에 양쪽에서 서로 다르게 수정한 경우에는 stock11 변경을 우선합니다.

## 중복 규칙

같은 종목이 stock11에서 `롱관심` 또는 `숏관심`에 들어 있으면서 동시에
`관심` 목록에서 노란색/빨간색이면 **보유가 표시 우선**입니다.

예를 들어 `롱관심 + 노란색`이면:

- stock11의 `롱관심` 항목 자체는 삭제하지 않습니다.
- stock5-8에서는 `1. 롱 보유`에만 표시합니다.
- 나중에 stock11에서 노란색을 해제하면 `3. 롱 관심`으로 다시 나타납니다.

stock5-8에서 보유 종목을 삭제하는 경우 stock11에서는 종목 자체를
`관심` 목록에서 삭제하지 않고 배경색만 해제합니다.

## 순서

`1. 롱 보유`와 `2. 숏 보유`의 순서는 stock11의 `관심` 목록 순서를
각 색깔별로 필터링한 순서입니다.

예를 들어 stock11 `관심` 순서가 아래와 같다면:

1. A - 노란색
2. B - 빨간색
3. C - 노란색
4. D - 빨간색

stock5-8은 다음과 같이 정렬됩니다.

- `1. 롱 보유`: A, C
- `2. 숏 보유`: B, D

stock5-8에서 순서를 직접 바꿔도 다음 동기화에서 stock11 순서로 복원됩니다.
`3. 롱 관심`과 `4. 숏 관심`도 각각 stock11 list 3/4 순서를 따릅니다.

## 설치

이 저장소를 Oracle의 `/var/www/stock11-7`에 받은 뒤:

```sh
cd /var/www/stock11-7
sudo ./deploy/install-stock-interest-sync.sh https://YOUR_HOST/stock5-8
```

최초 설치 시 `/etc/stock-interest-sync.env`가 생성됩니다. 실제 비밀번호나
KIS 키는 GitHub에 올리지 않습니다.

이미 `/etc/stock-interest-sync.env`가 있으면 설치 스크립트는 해당 파일을
덮어쓰지 않습니다.

## 확인

```sh
systemctl is-active stock-interest-sync.service
sudo journalctl -u stock-interest-sync.service -n 30 --no-pager

sudo sh -c '
set -a
. /etc/stock-interest-sync.env
set +a
python3 /usr/local/sbin/stock-interest-sync.py --check
'
```

정상이면 각 그룹에 대해 `SYNC=OK ORDER=OK`가 표시됩니다.

## 한 번만 동기화

상주 서비스 없이 한 사이클만 실행하려면:

```sh
sudo sh -c '
set -a
. /etc/stock-interest-sync.env
set +a
python3 /usr/local/sbin/stock-interest-sync.py --once
'
```

## 파일

- `scripts/stock-interest-sync.py`: 실제 동기화 프로그램
- `deploy/stock-interest-sync.service.example`: systemd 서비스
- `deploy/stock-interest-sync.env.example`: 환경변수 예시
- `deploy/install-stock-interest-sync.sh`: Oracle 설치/업데이트 도우미

## 운영 주의사항

- `stock11-7`의 `.env.oracle`은 Git에 커밋하지 않습니다.
- `/etc/stock-interest-sync.env`도 Git에 커밋하지 않습니다.
- stock5-8의 현재 저장 코드에는 전체 `items` 100개 제한이 있으므로
  동기화 프로그램도 기본적으로 100개를 넘기지 않습니다.
- stock11이 지원하지 않는 시장/지수 등 stock5 행은 자동 삭제하지 않습니다.
- Docker volume을 지우는 `docker compose down -v`는 사용하지 않습니다.

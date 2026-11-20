# 스케줄 핏

방을 만들고 링크만 보내면, 팀원이 이름만 적고 되는 시간을 칠해요. 겹치는 시간을 바로 찾아 회의 시간까지 확정할 수 있는 팀 일정 조율 도구예요. 무료로 쓰고, 회원가입 없이 링크 하나로 시작해요.

## 바로 사용하기

**https://schedule-fit.pages.dev**

| 주소 | 설명 |
| --- | --- |
| https://schedule-fit.pages.dev | 첫 화면. 방 만들기 |
| https://schedule-fit.pages.dev/r/방코드 | 방 화면. 이 링크를 팀원에게 보내요 |
| https://schedule-fit.pages.dev/ops | 운영자 페이지 (운영자 전용, 로그인 필요) |

배포 정보
- 호스팅: Cloudflare Pages (프로젝트 이름 `schedule-fit`)
- 데이터베이스: Cloudflare D1 (`team-schedule`, 바인딩 이름 `DB`)
- 소스: https://github.com/minu-96/ScheduleFit
- 예전 주소(`team-schedule-5in.pages.dev`)에서 이 주소로 옮겨 왔어요.

## 주요 기능

- **방 만들기**: 방 이름과 결과 공개 범위(참여자 모두 / 방장만)를 정하면 초대 링크가 만들어져요.
- **시간 칠하기**: 참여자는 이름과 비밀번호(4자 이상)를 적고 되는 시간을 칠해요. 자동 저장되고, 같은 이름과 비밀번호로 다른 기기에서도 들어올 수 있어요.
  - 빠른 입력: 이번 주 이동, 평일 9–18시, 지난 주 복사, 이 주 비우기, 되돌리기
- **겹치는 시간 찾기**: 팀원 모두가 되는 시간을 보여주고, 공지용으로 복사할 수 있어요.
- **일정 확정**: 방장이 정한 회의 시간을 확정하고 공지용 문구로 복사할 수 있어요.
- **방장 기능**: 방 이름 변경, 공개 범위 변경, 참여자 내보내기, 방 삭제. 방장 링크로 다른 기기에서도 방장이 될 수 있어요(이 링크는 보관만 하세요).
- **운영자 페이지**: 운영자 계정으로 전체 방을 관리해요.

## 알아 둘 점

- 방 링크를 아는 사람은 누구나 참여할 수 있어요(방당 최대 100명). 방 코드는 추측하기 어려운 10자리예요.
- 공개 범위를 "방장만"으로 두면 서버가 다른 사람의 시간을 아예 내려주지 않아요.
- 비밀번호는 서버에 암호화(해시)된 값만 저장돼요.
- 방 페이지는 검색 결과에 나오지 않게(noindex) 설정돼 있어요.
- 무료 플랜 한도는 수십 명 규모의 팀·동아리가 쓰기에 충분해요. 방을 마구 만드는 것을 막는 장치는 없으니 문제가 생기면 Cloudflare 대시보드에서 Rate limiting을 켜세요.

## 폴더 구성

```
public/                 화면 파일 (index.html, room.html, ops.html, room.js, style.css, robots.txt, sitemap.xml)
functions/api/[[path]].js   API (방, 참여자, 확정 일정, 운영자)
schema.sql              D1 테이블 정의
build.sh                dist/ 만들기 (직접 업로드 배포용)
dist/                   배포용 결과물 (build.sh가 만들어요)
wrangler.toml           Cloudflare 설정
```

## 배포 방법

실제 서비스는 Cloudflare 대시보드의 **직접 업로드**로 배포해요.

1. 빌드: `sh build.sh` → `dist/` 폴더가 만들어져요 (`dist/_worker.js` 포함).
2. `dist/` 안의 파일들을 zip으로 묶어요 (zip 안에 폴더 없이 파일이 바로 보이게).
3. Cloudflare 대시보드 → Workers & Pages → `schedule-fit` → Create deployment에서 zip을 올리고 **Save and deploy**.

처음 만들 때 한 번만 필요한 설정 (Settings)
- Bindings → D1 database: 변수 이름 `DB`, 데이터베이스 `team-schedule`
- Variables and secrets: `OPS_ID`, `OPS_PW` (운영자 아이디·비밀번호). **코드나 저장소에 넣지 말고 Cloudflare에만 저장하세요.** 값을 바꾸면 다시 배포해야 적용돼요.
- 테이블 만들기: `npx wrangler d1 execute team-schedule --remote --file=schema.sql`

수정 후 다시 배포할 때는 1~3만 반복하면 돼요. 데이터는 그대로 남아요.

### 명령줄로 배포하려면 (선택)

```
npx wrangler login
npx wrangler d1 create team-schedule        # 나온 database_id를 wrangler.toml에 넣기
npx wrangler d1 execute team-schedule --remote --file=schema.sql
npx wrangler pages deploy public --project-name schedule-fit
```

## 로컬에서 시험하기

```
npx wrangler d1 execute team-schedule --local --file=schema.sql
npx wrangler pages dev public --d1 DB=local-test-id
```

## 검색 등록

- 사이트맵: https://schedule-fit.pages.dev/sitemap.xml
- 구글 서치 콘솔·네이버 서치어드바이저 소유확인용 태그/파일이 `public/index.html`, `dist/_worker.js`에 들어 있어요. 지우면 소유확인이 풀리니 그대로 두세요.

# 스케줄 핏 (사이트 버전)

방을 만들고 링크를 보내면, 팀원이 이름만 적고 되는 시간을 칠해요. 로그인 없음.
Cloudflare Pages + D1(무료 플랜)에서 돌아가요.

## 배포 순서 (처음 한 번, 10분 안팎)

1. Cloudflare 계정 만들기: https://dash.cloudflare.com/sign-up
2. 컴퓨터에 Node.js(18 이상)가 없으면 설치: https://nodejs.org
3. 이 폴더에서 터미널을 열고 순서대로 실행

   ```
   npx wrangler login
   npx wrangler d1 create team-schedule
   ```
   두 번째 명령이 `database_id = "..."` 값을 출력해요.
   `wrangler.toml`의 `여기에-database_id-붙여넣기`를 그 값으로 바꾸세요.

   ```
   npx wrangler d1 execute team-schedule --remote --file=schema.sql
   npx wrangler pages deploy public --project-name team-schedule
   ```
   (처음 배포할 때 production 브랜치 이름을 물어보면 `main`을 입력하세요.)

4. 끝에 나오는 `https://team-schedule-xxxx.pages.dev` 가 사이트 주소예요.
   - 첫 화면에서 방을 만들면 `/r/방코드` 링크가 생겨요. 그 링크를 팀원에게 보내면 돼요.

## 수정 후 다시 배포
```
npx wrangler pages deploy public --project-name team-schedule
```
(데이터는 그대로 남아요.)

## 내 도메인 연결 (선택)
Cloudflare 대시보드 > Workers & Pages > team-schedule > Custom domains

## 사용 방법
- 방장: 방을 만든 브라우저가 방장이에요. 방 화면의 **방장 링크 복사**로 다른 기기에서도 방장이 될 수 있어요(이 링크는 보관만 하세요).
- 방장은 방 이름 변경, 결과 공개 범위(참여자 모두 / 방장만), 참여자 내보내기, 방 삭제를 할 수 있어요.
- 참여자: 초대 링크로 들어와 이름을 적고 칠하면 자동 저장. 비밀번호를 적어 두면 다른 기기에서도 같은 이름으로 들어올 수 있어요.
- 이전 Claude 페이지에서 쓰던 코드는 방 화면의 "이전 코드 불러오기"로 가져올 수 있어요.

## 알아 둘 점
- 방 링크를 아는 사람은 누구나 참여할 수 있어요(방당 최대 100명). 방 코드는 추측하기 어려운 10자리예요.
- 결과 공개 범위를 "방장만"으로 두면 서버가 다른 사람의 시간을 아예 내려주지 않아요.
- 비밀번호는 4자 이상이면 돼요. 서버에는 암호화(해시)된 값만 저장돼요.
- 무료 플랜 한도(요청 수, DB 용량)는 수십 명 규모의 팀·동아리가 쓰기에 충분해요.
- 다른 사람이 방을 마구 만드는 것을 막는 장치는 없어요. 문제가 생기면 Cloudflare 대시보드에서 Rate limiting을 켜세요.

## 로컬에서 시험하기
```
npx wrangler d1 execute team-schedule --local --file=schema.sql
npx wrangler pages dev public --d1 DB=local-test-id
```

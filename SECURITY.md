# 보안 정책 / Security policy

보안 취약점을 발견하셨다면 **공개 이슈 대신** 이 레포의 **Security → Report a vulnerability**(비공개 취약점 신고)로 알려 주세요. 확인 후 답변드리고, 고친 버전을 릴리스하면서 함께 안내합니다.

If you find a security issue, please **do not open a public issue**. Use **Security → Report a vulnerability** in this repository to report it privately. We will reply after checking and announce the fix with a release.

emucheck 는 서버나 열린 포트가 없는 CLI 입니다. `check` 경로는 네트워크를 쓰지 않고 프로젝트 코드도 실행하지 않으며, 공개 데이터를 내려받는 것은 `scripts/fetch-data.mjs`(GitHub, PyPI)뿐입니다. / emucheck is a CLI with no server or listening port. The `check` path makes no network calls and executes no project code; only `scripts/fetch-data.mjs` downloads public data (GitHub, PyPI).

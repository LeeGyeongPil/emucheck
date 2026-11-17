/** 한국어 메시지. 키는 `en.ts` 와 정확히 같아야 한다(test/i18n.test.ts 가 검사). */
export const ko: Record<string, string> = {
  "help.text": `emucheck {version} - 내 코드의 AWS 호출을 로컬 AWS 에뮬레이터가 처리할 수 있는지 미리 점검합니다

사용법:
  emucheck check [경로...]      AWS API 호출과 IaC 자원을 모두 등급으로 판정 (기본 경로: .)
  emucheck scan [경로...]       판정 없이 찾은 AWS 호출과 자원만 나열
  emucheck explain <svc:Op>     작업 하나의 근거를 모두 표시 (예: dynamodb:PutItem)
  emucheck data-info            동봉된 에뮬레이터 데이터 스냅샷 정보 표시

옵션:
  --format table|json|sarif     출력 형식 (check 용; scan 은 table|json), 기본 table
  --fail-on <등급>|none         check: 이 등급이 하나라도 있으면 종료 코드 1,
                                쉼표로 구분, 기본 absent,stub
                                등급: unknown-op absent stub failing partial untested passing
  --show-unresolved             작업을 알 수 없는 호출 목록 표시
  --ignore <디렉터리>           이 이름의 디렉터리를 건너뜀 (반복 가능)
  --data <파일>                 다른 스냅샷 파일 사용 (또는 EMUCHECK_DATA 설정)
  --lang en|ko                  출력 언어 (또는 EMUCHECK_LANG, LC_ALL, LANG 설정)
  -h, --help                    이 도움말 표시
  -v, --version                 버전 표시

종료 코드: 0 정상, 1 --fail-on 등급 발견, 2 사용법·입력 오류.
비공식 도구입니다. 결과는 동봉된 스냅샷 기준이며 최신 에뮬레이터 릴리스와 다를 수 있습니다.`,

  "table.snapshot": "스냅샷: aws-emulator {release} - 커밋 {commit} - 채점 {scoredAt} - botocore {botocore}",
  "table.col.grade": "등급",
  "table.col.conf": "신뢰",
  "table.col.operation": "작업",
  "table.col.where": "위치",
  "table.col.evidence": "근거",
  "table.col.note": "메모",
  "table.col.type": "유형",
  "table.col.service": "서비스",
  "table.conf.high": "높음",
  "table.conf.low": "낮음",
  "table.resources": "인프라 자원 (서비스 단위만)",
  "table.unresolved": "불명 호출 (작업을 알 수 없음)",
 
  "table.col.how": "패턴",
  "table.extraction.certain": "확정",
  "table.extraction.inferred": "추정",
  "scan.summary": "호출 {calls}개, 자원 {resources}개, 불명 {unresolved}개 - 파일 {files}개 검사",
  "table.none": "{files}개 파일에서 AWS SDK 호출이나 자원을 찾지 못했습니다.",

  "evidence.wire": "wire 통과 {pass} / 실패 {fail}",
  "evidence.behavioral": "관련 체크 통과 {pass} / 실패 {fail}",
  "evidence.stub": "스캐폴드 스텁",
  "evidence.none": "테스트 없음",

  "summary.line": "작업 {findings}{opWord}, 호출 위치 {sites}{siteWord} - 확정 {certain}, 추정 {inferred}, 불명 {unresolved} - 파일 {files}개 검사",
  "word.operation.one": "개",
  "word.operation.other": "개",
  "word.site.one": "곳",
  "word.site.other": "곳",
  "summary.grades": "등급: {list}",
  "summary.hint.unresolved": "--show-unresolved 로 불명 호출 목록을 볼 수 있습니다.",
  "summary.gate.fail": "게이트 실패: {grades} 발견 (--fail-on {failOn}). 종료 코드 1.",
  "summary.gate.pass": "게이트 통과 (--fail-on {failOn}).",
  "summary.gate.none": "게이트 없음 (--fail-on none).",
  "warn.stale": "경고: 데이터 스냅샷이 {days}일 지났습니다 (채점 {scoredAt}). 결과는 그 시점 기준이며 최신 에뮬레이터 릴리스와 다를 수 있습니다.",

  "grade.unknown-op": "unknown-op",
  "grade.absent": "absent",
  "grade.stub": "stub",
  "grade.failing": "failing",
  "grade.partial": "partial",
  "grade.untested": "untested",
  "grade.passing": "passing",
  "grade.desc.unknown-op": "해당 AWS 서비스에 없는 작업 (오타 또는 추출 오류)",
  "grade.desc.absent": "에뮬레이터에 처리기나 서비스가 없음",
  "grade.desc.stub": "HTTP 501 NotImplemented 로 답하는 스캐폴드 처리기",
  "grade.desc.failing": "기록된 wire 단계가 모두 실패",
  "grade.desc.partial": "결과가 섞였거나 문제를 시사하는 약한 근거만 있음",
  "grade.desc.untested": "어느 쪽으로도 테스트 근거 없음",
  "grade.desc.passing": "기록된 테스트가 통과",

  "note.unknown-service": "알 수 없는 서비스 \"{service}\"",
  "note.unknown-operation": "{service} 에 \"{op}\" 작업이 없음",
  "note.did-you-mean": "{op} 를 뜻하나요?",
  "note.service-absent": "에뮬레이터에 {service} 서비스가 없음",
  "note.op-absent": "{service}:{op} 는 에뮬레이터에 처리기가 없음",
  "note.stub-501": "호출하면 HTTP 501",
  "note.open-issues": "things-that-do-not-work 에 열린 기록 {count}건",
  "note.stale-possible": "열린 기록은 이미 고쳐졌을 수 있음",
  "note.behavioral-only": "관련 체크만 실패({total}건 중 {fail}건), 실패 단계가 다른 작업일 수 있음",
  "note.related-behavioral-failures": "관련 체크 실패({total}건 중 {fail}건), wire 단계는 통과",
  "note.service-level": "서비스는 있음, 충실도 {total}건 중 {pass}건 통과, 작업 단위 근거 없음",

  "unresolved.reason.dynamic-method": "메서드 이름이 실행 시점에 정해짐",
  "unresolved.reason.dynamic-getattr": "계산된 이름의 getattr",
  "unresolved.reason.parse-error": "파일을 해석하지 못함",

  "explain.title": "{key} - {grade} (신뢰도 {confidence})",
  "explain.grade": "뜻: {text}",
  "explain.wire": "wire 단계: 통과 {pass}, 미통과 {fail}",
  "explain.failed-units": "실패 단위: {units}",
  "explain.behavioral": "관련 behavioral 체크: 통과 {pass}, 실패 {fail}, 건너뜀 {skipped} (체크 {checks}건)",
  "explain.issues": "열린 기록: {count}건",
  "explain.issues-more": "  ... 외 {count}건",
  "skipped.title": "분석하지 못하고 건너뛴 파일 {count}개:",
  "skipped.more": "  ... 외 {count}개",
  "skipped.reason.too-large": "5 MB 초과",
  "skipped.reason.unreadable": "읽을 수 없음",
  "skipped.reason.template-parse": "템플릿을 끝까지 해석하지 못함",
  "explain.stub": "스텁 처리기: {path}",
  "explain.links": "링크:",
  "explain.notes": "메모:",

  "info.title": "동봉된 에뮬레이터 데이터 스냅샷",
  "info.release": "aws-emulator 릴리스: {value}",
  "info.commit": "점수 커밋: {value}",
  "info.scoredAt": "채점 시각: {value}",
  "info.manifest": "evaluation-suite 커밋: {value}",
  "info.botocore": "botocore: {value}",
  "info.builtAt": "생성 시각: {value}",
  "info.counts": "서비스 {services}개 (에뮬레이터에 {emulated}개), 근거 있는 작업 {ops}개, 스텁 {stubs}개",
  "info.units": "테스트 단위 {units}개, 해석하지 못한 이슈 파일 {unparsed}개",
  "info.age": "경과: {days}일",

  "error.unknown-command": "알 수 없는 명령 \"{name}\". emucheck --help 를 실행하세요.",
  "error.missing-key": "explain 에는 dynamodb:PutItem 같은 작업이 필요합니다.",
  "error.bad-key": "\"{key}\" 는 service:Operation 형식이 아닙니다. 예: dynamodb:PutItem",
  "error.bad-format": "알 수 없는 형식 \"{value}\". table, json, sarif 중 하나를 쓰세요.",
  "error.bad-grade": "--fail-on 의 알 수 없는 등급 \"{value}\". none 또는 쉼표로 구분한 목록을 쓰세요: {grades}.",
  "error.bad-lang": "지원하지 않는 언어 \"{value}\". en 또는 ko 를 쓰세요.",
  "error.bad-option": "잘못된 옵션: {detail}. emucheck --help 를 실행하세요.",
  "error.path-not-found": "경로를 찾을 수 없습니다: {path}. 존재하는 파일이나 디렉터리를 주세요. 예: emucheck check .",
  "error.snapshot": "스냅샷 문제: {detail}",
  "error.scan-format": "scan 은 --format table 또는 json 만 지원합니다.",
};

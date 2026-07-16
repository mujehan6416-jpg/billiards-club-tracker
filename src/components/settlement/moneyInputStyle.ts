import type { CSSProperties } from 'react'

// index.css의 `input[type='number'] { width: 64px }`는 핸디 등 1~2자리 숫자용으로 만들어진
// 전역 규칙이라, 정산 금액(최대 8~9자리, 예: 10,000,000)을 담기엔 너무 좁아 입력값이 잘려 보인다.
// index.css는 이번 작업 범위 밖(다른 미커밋 변경이 섞여 있음)이라 손대지 않고, 지출·회식비의
// 금액 입력칸에만 인라인으로 덮어쓴다.
//
// 1차 수정(minWidth:130 플로어 + 2칸 나란히 배치)은 실제 휴대전화에서 여전히 좁았다 — "모임
// 부담액"/"개인 찬조액"이 flex:1 반쪽 행 안에서 width:100%였기 때문에, 100%의 기준이 되는
// 부모 자체가 좁았다(반쪽 폭의 100% = 여전히 좁음). 그래서 이번엔 "폭을 더 넓힌다"가 아니라
// "한 줄에 하나씩, 항상 카드 전체 폭을 쓰게" 배치 자체를 바꾼다 — 이 스타일 객체는 그 전체 폭
// 입력칸에 필요한 최소 높이·정렬·오탈락 방지 속성까지 함께 갖는다.

/** 정산 금액 입력칸 공통 스타일(지출 "금액"/"모임 부담액"/"개인 찬조액", 회식비 "전체 회식비").
 *  항상 부모 폭 전체를 쓰는 "한 줄에 하나씩" 배치 전제 — 2칸을 나란히 두는 좁은 자리에는 쓰지 않는다. */
export const moneyInputStyle: CSSProperties = {
  width: '100%',
  minWidth: 0,       // 브라우저 기본 min-width:auto(내용 기준 최소폭)를 무력화 — width:100%가 항상 우선하게
  flexShrink: 0,      // 혹시 flex 컨테이너 안에 있어도 다시 좁아지지 않게
  boxSizing: 'border-box',
  textAlign: 'right',
  minHeight: 52,
  fontSize: 20,
  padding: '14px 16px',
}

/** 두 칸이 나란히 놓이는 보조 금액 입력칸(모임 부담액/개인 찬조액, 찬조자 금액). */
export const compactMoneyInputStyle: CSSProperties = {
  width: '100%',
  minWidth: 100,
  boxSizing: 'border-box',
  textAlign: 'right',
}

import type { CSSProperties } from 'react'

// index.css의 `input[type='number'] { width: 64px }`는 핸디 등 1~2자리 숫자용으로 만들어진
// 전역 규칙이라, 정산 금액(최대 7~8자리, 예: 1,000,000)을 담기엔 너무 좁아 입력값이 잘려 보인다.
// index.css는 이번 작업 범위 밖(다른 미커밋 변경이 섞여 있음)이라 손대지 않고, 지출·회식비의
// 금액 입력칸에만 인라인으로 덮어쓴다. box-sizing은 index.css의 전역 `*{box-sizing:border-box}`
// 로 이미 보장되지만, 이 값에 의존하는 필드임을 명시적으로 남긴다.

/** 한 줄을 단독으로 차지하는 주 금액 입력칸(지출 "금액", 회식비 "전체 회식비"). */
export const moneyInputStyle: CSSProperties = {
  width: '100%',
  minWidth: 130,
  boxSizing: 'border-box',
  textAlign: 'right',
}

/** 두 칸이 나란히 놓이는 보조 금액 입력칸(모임 부담액/개인 찬조액, 찬조자 금액). */
export const compactMoneyInputStyle: CSSProperties = {
  width: '100%',
  minWidth: 100,
  boxSizing: 'border-box',
  textAlign: 'right',
}

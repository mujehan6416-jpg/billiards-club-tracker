import type { DinnerContributorTitlePreset } from '../types/settlement'

/** 회식비는 이 값을 고르면 일반 지출 폼이 아니라 회식비 전용 폼으로 이동한다. */
export const DINNER_CATEGORY = '회식비' as const

export const EXPENSE_CATEGORIES = [
  '당구장비', '식사비', '음료수비', '종업원 팁', '상품비', '상금', '대관비', '화환', DINNER_CATEGORY, '기타',
] as const

export const DINNER_CONTRIBUTOR_TITLE_PRESETS: DinnerContributorTitlePreset[] = [
  '회원님', '회장님', '총무님', '고문님', '선배님',
]

export const QUICK_AMOUNTS = [20000, 30000, 50000] as const

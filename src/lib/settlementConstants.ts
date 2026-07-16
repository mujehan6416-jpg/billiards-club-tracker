import type { DinnerContributorTitlePreset } from '../types/settlement'

/** 회식비는 이 값을 고르면 일반 지출 폼이 아니라 회식비 전용 폼으로 이동한다. */
export const DINNER_CATEGORY = '회식비' as const

/** 지출 분류(2026-07: 10개 → 5개로 단순화). 화면에는 이 순서 그대로 보여준다. */
export const EXPENSE_CATEGORIES = [
  '당구비', '다과비', DINNER_CATEGORY, '상금', '기타',
] as const

/**
 * 예전 분류값(10개) → 새 분류값(5개) 매핑.
 * 기존 Firestore 문서의 category 값은 절대 일괄 수정(마이그레이션)하지 않는다 — 지출 목록에
 * 보여줄 때, 그리고 수정 폼을 열 때만 이 매핑을 거쳐 새 분류로 바꿔 보여준다. 사용자가 그
 * 지출을 "수정 저장"하면 그 시점에 폼에 표시된 새 분류값으로 자연스럽게 저장된다.
 */
export const LEGACY_EXPENSE_CATEGORY_MAP: Record<string, string> = {
  '당구장비': '당구비',
  '대관비': '당구비',
  '식사비': '다과비',
  '음료수비': '다과비',
  '종업원 팁': '다과비',
  '상품비': '기타',
  '화환': '기타',
}

/** 저장된 지출 category를 화면 표시·수정 폼용 새 분류값으로 바꾼다(저장된 데이터 자체는 그대로 둠). */
export function displayExpenseCategory(category: string): string {
  return LEGACY_EXPENSE_CATEGORY_MAP[category] ?? category
}

export const DINNER_CONTRIBUTOR_TITLE_PRESETS: DinnerContributorTitlePreset[] = [
  '회원님', '회장님', '총무님', '고문님', '선배님',
]

export const QUICK_AMOUNTS = [20000, 30000, 50000] as const

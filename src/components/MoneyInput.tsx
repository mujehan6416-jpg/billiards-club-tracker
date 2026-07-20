import type { CSSProperties } from 'react'

// 원화 금액 입력칸 공용 컴포넌트 — 입력 중에도 천단위 콤마(예: 1,234,567)를 보여준다.
// 부모가 들고 있는 값(value)과 onChange로 돌려주는 값은 항상 콤마 없는 순수 숫자 문자열이다
// (allowNegative면 맨 앞에 '-'가 붙을 수 있음) — 저장·계산에 쓰이는 데이터 형태는 바뀌지 않고,
// 화면에 보여줄 때만 이 컴포넌트가 콤마를 붙인다.
//
// type="number"가 아니라 type="text"를 쓴다 — <input type="number">는 값에 콤마가 섞이면
// 브라우저가 그 값 자체를 받아들이지 않는다(빈 값으로 취급). 대신 숫자 외 문자는 onChange에서
// 직접 걸러내(stripPattern) 기존 number 입력과 같은 "숫자만 입력 가능" 동작을 유지한다.
export function MoneyInput({
  value, onChange, allowNegative = false, disabled, placeholder = '0', ariaLabel, style,
}: {
  value: string
  onChange: (raw: string) => void
  /** ±가 허용되는 항목(예: 기타 통장 조정액)만 true로 지정한다. */
  allowNegative?: boolean
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
  style?: CSSProperties
}) {
  const stripPattern = allowNegative ? /[^0-9-]/g : /[^0-9]/g

  // "-"만 입력된 중간 상태는 콤마를 붙일 숫자가 아직 없으므로 그대로 보여준다(그래야 이어서
  // 숫자를 입력할 수 있다 — 여기서 formatted로 바꾸면 '-'가 사라져 음수를 아예 입력할 수 없다).
  const displayValue = (() => {
    if (value === '' || value === '-') return value
    const n = Number(value)
    return Number.isFinite(n) ? n.toLocaleString('ko-KR') : value
  })()

  return (
    <input
      aria-label={ariaLabel}
      type="text"
      inputMode={allowNegative ? 'text' : 'numeric'}
      disabled={disabled}
      placeholder={placeholder}
      value={displayValue}
      onChange={(e) => onChange(e.target.value.replace(stripPattern, ''))}
      style={style}
    />
  )
}

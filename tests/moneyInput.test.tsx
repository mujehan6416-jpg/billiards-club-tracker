import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MoneyInput } from '../src/components/MoneyInput'

// 원화 금액 입력칸 공용 컴포넌트 — 입력 중에도 천단위 콤마를 보여주되, 부모에게 돌려주는 값은
// 항상 콤마 없는 순수 숫자 문자열이어야 한다(저장/계산 로직은 그대로 raw 문자열을 받는다).

function Controlled({ initial = '', allowNegative = false, onChangeSpy }: {
  initial?: string; allowNegative?: boolean; onChangeSpy?: (v: string) => void
}) {
  const [v, setV] = useState(initial)
  return (
    <MoneyInput
      ariaLabel="금액"
      value={v}
      allowNegative={allowNegative}
      onChange={(raw: string) => { setV(raw); onChangeSpy?.(raw) }}
    />
  )
}

describe('MoneyInput — 천단위 콤마 표시', () => {
  it('5680314를 입력하면 화면에는 5,680,314로 보인다', () => {
    render(<Controlled />)
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '5680314' } })
    expect((screen.getByLabelText('금액') as HTMLInputElement).value).toBe('5,680,314')
  })

  it('50000을 입력하면 화면에는 50,000으로 보인다', () => {
    render(<Controlled />)
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '50000' } })
    expect((screen.getByLabelText('금액') as HTMLInputElement).value).toBe('50,000')
  })

  it('0을 입력하면 그대로 0으로 보인다', () => {
    render(<Controlled />)
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '0' } })
    expect((screen.getByLabelText('금액') as HTMLInputElement).value).toBe('0')
  })

  it('부모에게 전달되는 값은 콤마 없는 순수 숫자 문자열이다', () => {
    const spy = vi.fn()
    render(<Controlled onChangeSpy={spy} />)
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '1234567' } })
    expect(spy).toHaveBeenCalledWith('1234567')
  })

  it('콤마가 포함된 표시값 위에 이어서 입력해도(실제 타이핑 시나리오) 값이 정상적으로 누적된다', () => {
    render(<Controlled />)
    const input = screen.getByLabelText('금액') as HTMLInputElement
    fireEvent.change(input, { target: { value: '5000' } })
    expect(input.value).toBe('5,000')
    fireEvent.change(input, { target: { value: input.value + '6' } })
    expect(input.value).toBe('50,006')
  })

  it('allowNegative가 아니면 "-"를 입력해도 걸러진다', () => {
    const spy = vi.fn()
    render(<Controlled onChangeSpy={spy} />)
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '-50000' } })
    expect(spy).toHaveBeenCalledWith('50000')
  })

  it('allowNegative면 -50000 입력 시 -50,000으로 보이고, 부모에는 -50000이 전달된다', () => {
    const spy = vi.fn()
    render(<Controlled allowNegative onChangeSpy={spy} />)
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '-50000' } })
    expect(spy).toHaveBeenCalledWith('-50000')
    expect((screen.getByLabelText('금액') as HTMLInputElement).value).toBe('-50,000')
  })

  it('allowNegative면 "-"만 입력한 중간 상태에서도 값이 사라지지 않는다(이어서 숫자를 입력할 수 있어야 함)', () => {
    render(<Controlled allowNegative />)
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '-' } })
    expect((screen.getByLabelText('금액') as HTMLInputElement).value).toBe('-')
  })

  it('빈 값이면 화면에도 빈칸으로 보인다', () => {
    render(<Controlled initial="50000" />)
    fireEvent.change(screen.getByLabelText('금액'), { target: { value: '' } })
    expect((screen.getByLabelText('금액') as HTMLInputElement).value).toBe('')
  })
})

// SettlementSummary의 "기타 통장 조정액(±)"처럼, 부모가 raw 문자열이 아니라 숫자(number)
// 상태로 값을 들고 있는 실사용 패턴을 그대로 재현한다 — parseAmt('-')는 NaN이라 로컬 버퍼가
// 없으면 '-'만 입력한 순간 부모 상태가 NaN이 되고, 그 값이 되돌아오며 화면에서 '-'가 사라진다.
function NumberBackedControlled() {
  const parseAmt = (v: string) => parseInt(v.replace(/[^0-9-]/g, '') || '0', 10)
  const [n, setN] = useState<number>(0)
  return (
    <MoneyInput
      ariaLabel="조정액" allowNegative
      value={String(n || '')}
      onChange={(raw) => setN(parseAmt(raw))}
    />
  )
}

describe('MoneyInput — 숫자(number) 상태를 들고 있는 부모와의 왕복(기타 통장 조정액 재현)', () => {
  it('"-"만 입력해도 사라지지 않고, 이어서 숫자를 입력하면 음수로 정상 누적된다', () => {
    render(<NumberBackedControlled />)
    const input = screen.getByLabelText('조정액') as HTMLInputElement
    fireEvent.change(input, { target: { value: '-' } })
    expect(input.value).toBe('-')
    fireEvent.change(input, { target: { value: input.value + '5' } })
    expect(input.value).toBe('-5')
    fireEvent.change(input, { target: { value: input.value + '0000' } })
    expect(input.value).toBe('-50,000')
  })
})

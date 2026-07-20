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

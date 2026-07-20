import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LedgerTab } from '../src/tabs/LedgerTab'
import { useAdmin } from '../src/store/adminStore'

// 장부 탭의 금액 입력칸(회비/찬조금/카드찬조/연회비/현금·카드·계좌이체 지출)에도 참가자 표·지출
// 탭과 동일하게 천단위 콤마가 표시되는지만 확인한다(가상 데이터만 사용).

beforeEach(() => {
  useAdmin.setState({ isAdmin: true })
})

describe('LedgerTab — 금액 입력칸 천단위 콤마 표시', () => {
  it('현금 회비 입력칸에 1234567을 입력하면 1,234,567로 보인다', () => {
    render(<LedgerTab />)
    const input = screen.getAllByLabelText('회비')[0] as HTMLInputElement
    fireEvent.change(input, { target: { value: '1234567' } })
    expect(input.value).toBe('1,234,567')
  })

  it('현금 지출 입력칸에 50000을 입력하면 50,000으로 보인다', () => {
    render(<LedgerTab />)
    const input = screen.getByLabelText('현금') as HTMLInputElement
    fireEvent.change(input, { target: { value: '50000' } })
    expect(input.value).toBe('50,000')
  })
})

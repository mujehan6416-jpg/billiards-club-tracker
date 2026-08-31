import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { MembersTab } from '../src/tabs/MembersTab'
import { useApp } from '../src/store/appStore'
import { useAdmin } from '../src/store/adminStore'
import { useAuth } from '../src/store/authStore'
import type { Member } from '../src/types'

// 회원 상세의 "핸디 변경 이력"이 본인/타인 모두 동일하게 보이는지 확인한다.
// 아래 이름·ID는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

const membersWithHistory: Member[] = [
  {
    id: 'm1', name: '테스트회원A', handicap: 15, active: true,
    handicapHistory: [
      { value: 13, changedAt: '2025-12-31T00:00:00.000Z' },
      { value: 14, changedAt: '2026-01-21T00:00:00.000Z' },
      { value: 15, changedAt: '2026-06-17T00:00:00.000Z' },
    ],
  },
  {
    id: 'm2', name: '테스트회원B', handicap: 20, active: true,
    handicapHistory: [
      { value: 18, changedAt: '2026-02-01T00:00:00.000Z' },
      { value: 20, changedAt: '2026-05-01T00:00:00.000Z' },
    ],
  },
  { id: 'm3', name: '테스트회원C', handicap: 22, active: true, handicapHistory: [] },
]

beforeEach(() => {
  useApp.setState({ members: membersWithHistory, sessions: [], settings: { lastBackupAt: null }, ledger: [] })
  useAdmin.setState({ isAdmin: false })
})

describe('회원 상세 — 다른 회원의 핸디 변경 이력', () => {
  beforeEach(() => {
    useAuth.setState({ memberId: 'm3', memberName: '테스트회원C', isGuest: false })
  })

  it('다른 회원 이름을 누르면 핸디 변경 이력이 표시된다', () => {
    render(<MembersTab />)
    fireEvent.click(screen.getByText('테스트회원A'))
    expect(screen.getByText('핸디 변화 이력')).toBeInTheDocument()
    expect(screen.getByText(/2026-06-17/)).toBeInTheDocument()
    expect(screen.getByText(/2026-01-21/)).toBeInTheDocument()
    expect(screen.getByText(/2025-12-31/)).toBeInTheDocument()
    // 최신순 정렬 + 증감 표시
    expect(screen.getAllByText(/▲ \+1/).length).toBeGreaterThan(0)
    expect(screen.getByText('현재')).toBeInTheDocument()
  })
})

describe('회원 상세 — 본인의 핸디 변경 이력(이번 수정)', () => {
  beforeEach(() => {
    useAuth.setState({ memberId: 'm1', memberName: '테스트회원A', isGuest: false })
  })

  it('본인("내 실적" 카드)을 눌러도 다른 회원과 동일하게 핸디 변경 이력이 표시된다', () => {
    render(<MembersTab />)
    const heroCard = document.querySelector('.member-hero') as HTMLElement
    expect(heroCard).toBeTruthy()
    fireEvent.click(heroCard)

    expect(screen.getByText('핸디 변화 이력')).toBeInTheDocument()
    expect(screen.getByText('테스트회원A 상세')).toBeInTheDocument()
    // 현재 핸디 · 핸디 순위 · 승률 등 기존 표시 정보도 함께 나온다
    expect(screen.getByText('현재 핸디')).toBeInTheDocument()
    expect(screen.getByText('핸디 순위')).toBeInTheDocument()
  })

  it('본인의 핸디 변경 이력도 다른 회원과 같은 순서(최신순)로 표시된다', () => {
    render(<MembersTab />)
    const heroCard = document.querySelector('.member-hero') as HTMLElement
    fireEvent.click(heroCard)

    const rows = Array.from(document.querySelectorAll('ul li span')).map((el) => el.textContent)
    const idxJun = rows.findIndex((t) => t?.includes('2026-06-17'))
    const idxJan = rows.findIndex((t) => t?.includes('2026-01-21'))
    const idxDec = rows.findIndex((t) => t?.includes('2025-12-31'))
    expect(idxJun).toBeGreaterThanOrEqual(0)
    expect(idxJun).toBeLessThan(idxJan)
    expect(idxJan).toBeLessThan(idxDec)
  })

  it('본인 상세를 닫았다가 다시 열어도 핸디 변경 이력이 정상 표시된다', () => {
    render(<MembersTab />)
    const heroCard = document.querySelector('.member-hero') as HTMLElement
    fireEvent.click(heroCard)
    expect(screen.getByText('핸디 변화 이력')).toBeInTheDocument()

    fireEvent.click(screen.getByText('닫기'))
    expect(screen.queryByText('핸디 변화 이력')).not.toBeInTheDocument()

    fireEvent.click(heroCard)
    expect(screen.getByText('핸디 변화 이력')).toBeInTheDocument()
    expect(screen.getByText(/2026-06-17/)).toBeInTheDocument()
  })
})

describe('회원 상세 — 이력이 없는 회원(본인/타인 공통)', () => {
  it('타인이면서 이력이 없으면 기존 빈 상태 문구가 그대로 보인다', () => {
    useAuth.setState({ memberId: 'm1', memberName: '테스트회원A', isGuest: false })
    render(<MembersTab />)
    fireEvent.click(screen.getByText('테스트회원C'))
    expect(screen.getByText('기록 없음')).toBeInTheDocument()
  })

  it('본인이면서 이력이 없으면 기존 빈 상태 문구가 그대로 보인다', () => {
    useAuth.setState({ memberId: 'm3', memberName: '테스트회원C', isGuest: false })
    render(<MembersTab />)
    const heroCard = document.querySelector('.member-hero') as HTMLElement
    fireEvent.click(heroCard)
    expect(screen.getByText('기록 없음')).toBeInTheDocument()
  })
})

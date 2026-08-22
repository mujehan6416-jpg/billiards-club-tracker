import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

import { MembersTab } from '../src/tabs/MembersTab'
import { useApp } from '../src/store/appStore'
import { useAdmin } from '../src/store/adminStore'
import { useAuth } from '../src/store/authStore'
import type { Member } from '../src/types'

// 아래 이름·ID는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

const members: Member[] = [
  { id: 'm1', name: '테스트회원A', handicap: 20, handicapHistory: [], active: true },
  { id: 'm2', name: '테스트회원B', handicap: 25, handicapHistory: [], active: true },
]

beforeEach(() => {
  useApp.setState({ members, sessions: [], settings: { lastBackupAt: null }, ledger: [] })
  useAdmin.setState({ isAdmin: false })
  useAuth.setState({ memberId: 'm1', memberName: '테스트회원A', isGuest: false })
})

describe('MembersTab — 회원 추가 영역 위치', () => {
  it('관리자에게는 회원 목록보다 아래에 회원 추가 영역이 보인다', () => {
    useAdmin.setState({ isAdmin: true })
    const { container } = render(<MembersTab />)

    const list = container.querySelector('ul.member-list')!
    const addButton = screen.getByRole('button', { name: '추가' })
    expect(list).toBeInTheDocument()
    // 목록이 먼저 나오고, 회원 추가가 그 뒤에 나와야 한다
    expect(list.compareDocumentPosition(addButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('관리자가 아니면 회원 추가 영역이 보이지 않는다', () => {
    render(<MembersTab />)
    expect(screen.queryByRole('button', { name: '추가' })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('이름')).not.toBeInTheDocument()
  })

  it('회원 목록과 검색 기능은 그대로 동작한다', () => {
    useAdmin.setState({ isAdmin: true })
    render(<MembersTab />)
    // 로그인 회원(m1)은 "내 실적" 카드에 나오고, 목록에는 나머지 회원이 보인다
    expect(screen.getByPlaceholderText('회원 이름 검색')).toBeInTheDocument()
    expect(screen.getByText('테스트회원B')).toBeInTheDocument()
  })
})

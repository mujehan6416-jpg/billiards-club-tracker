import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MeetingTab } from '../src/tabs/MeetingTab'
import { useApp } from '../src/store/appStore'
import { useAdmin } from '../src/store/adminStore'
import { todayStr } from '../src/lib/date'
import type { Session } from '../src/types'

// source==='tournament'인 세션이 모임 탭 일반 목록에서 제외되는지만 확인한다.
// 가상 데이터만 사용한다 — 실제 회원 이름·경기 데이터가 아니다.

beforeEach(() => {
  useAdmin.setState({ isAdmin: true })
})

const today = todayStr()

describe('MeetingTab — 토너먼트용 세션(source:"tournament") 노출 제외', () => {
  it('일반 세션 + 토너먼트 세션이 같은 날짜에 있으면, 여러 세션 전환 탭이 뜨지 않는다(토너먼트 세션은 daySessions에서 빠지므로)', () => {
    const regular: Session = { id: 's-regular', date: today, attendeeIds: [], games: [] }
    const tournament: Session = { id: 's-tournament', date: today, source: 'tournament', attendeeIds: [], games: [] }
    useApp.setState({ sessions: [regular, tournament] })

    render(<MeetingTab />)
    // daySessions.length > 1일 때만 뜨는 세션 전환 버튼 — 토너먼트 세션이 제외돼 1개만
    // 남으면 안 뜬다(현재 세션 종류를 보여주는 배지 span은 별개이므로 버튼 role로만 확인).
    expect(screen.queryByRole('button', { name: '📋 정기모임' })).toBeNull()
    expect(screen.queryByRole('button', { name: '⚡ 번개모임' })).toBeNull()
  })

  it('일반 세션 + 번개모임이 같은 날짜에 있으면(둘 다 source 없음), 기존처럼 전환 탭이 뜬다 — 회귀 없음', () => {
    const regular: Session = { id: 's-regular-2', date: today, type: 'regular', attendeeIds: [], games: [] }
    const flash: Session = { id: 's-flash-2', date: today, type: 'flash', approved: true, attendeeIds: [], games: [] }
    useApp.setState({ sessions: [regular, flash] })

    render(<MeetingTab />)
    expect(screen.getByRole('button', { name: '📋 정기모임' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '⚡ 번개모임' })).toBeInTheDocument()
  })

  it('source가 없는 기존 세션은 정상 표시된다(달력에 표시 등 렌더 자체가 에러 없이 동작)', () => {
    const regular: Session = { id: 's-plain', date: today, attendeeIds: [], games: [] }
    useApp.setState({ sessions: [regular] })
    expect(() => render(<MeetingTab />)).not.toThrow()
  })
})

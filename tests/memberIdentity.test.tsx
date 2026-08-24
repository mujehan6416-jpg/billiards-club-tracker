import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { buildMemberLabels } from '../src/logic/memberLabel'
import { LoginScreen } from '../src/tabs/LoginScreen'
import type { Member } from '../src/types'

// 아래 이름·ID는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

const member = (over: Partial<Member> & { id: string; name: string }): Member => ({
  handicap: 20, handicapHistory: [], active: true, ...over,
})

beforeEach(() => {
  localStorage.clear()
})

describe('buildMemberLabels — 동명이인 표시', () => {
  it('같은 이름이 한 명뿐이면 이름만 보여준다(기존 동작 유지)', () => {
    const labels = buildMemberLabels([
      member({ id: 'a', name: '테스트회원A' }),
      member({ id: 'b', name: '테스트회원B' }),
    ])
    expect(labels.get('a')).toBe('테스트회원A')
    expect(labels.get('b')).toBe('테스트회원B')
  })

  it('동명이인은 displayTag를 붙여 구분한다', () => {
    const labels = buildMemberLabels([
      member({ id: 'a', name: '홍길동', displayTag: '90학번 · 경영' }),
      member({ id: 'b', name: '홍길동', displayTag: '02학번 · 전자' }),
    ])
    expect(labels.get('a')).toBe('홍길동 (90학번 · 경영)')
    expect(labels.get('b')).toBe('홍길동 (02학번 · 전자)')
  })

  it('displayTag가 없는 동명이인은 핸디로 구분한다', () => {
    const labels = buildMemberLabels([
      member({ id: 'a', name: '홍길동', handicap: 20 }),
      member({ id: 'b', name: '홍길동', handicap: 25 }),
    ])
    expect(labels.get('a')).toBe('홍길동 (핸디 20)')
    expect(labels.get('b')).toBe('홍길동 (핸디 25)')
  })

  it('이름·핸디까지 같고 구분정보도 없으면 순번을 붙여 반드시 서로 다르게 만든다', () => {
    const labels = buildMemberLabels([
      member({ id: 'a', name: '홍길동', handicap: 20 }),
      member({ id: 'b', name: '홍길동', handicap: 20 }),
    ])
    expect(labels.get('a')).not.toBe(labels.get('b'))
    expect(labels.get('a')).toBe('홍길동 (핸디 20 · 1)')
    expect(labels.get('b')).toBe('홍길동 (핸디 20 · 2)')
  })

  it('한쪽만 displayTag가 있어도 서로 다른 이름표가 된다', () => {
    const labels = buildMemberLabels([
      member({ id: 'a', name: '홍길동', displayTag: '90학번' }),
      member({ id: 'b', name: '홍길동', handicap: 22 }),
    ])
    expect(labels.get('a')).toBe('홍길동 (90학번)')
    expect(labels.get('b')).toBe('홍길동 (핸디 22)')
  })
})

describe('LoginScreen — 회원 ID 기준 로그인', () => {
  const dupes: Member[] = [
    member({ id: 'id-first', name: '홍길동', displayTag: '90학번', password: 'pw1111' }),
    member({ id: 'id-second', name: '홍길동', displayTag: '02학번', password: 'pw2222' }),
  ]

  it('동명이인 두 명이 각자 자기 ID로 로그인된다', () => {
    const onLogin = vi.fn()
    render(<LoginScreen members={dupes} onLogin={onLogin} />)

    // 두 번째 사람 선택 — 이름이 같아도 value가 회원 ID라 정확히 구분된다
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'id-second' } })
    fireEvent.change(screen.getByPlaceholderText('비밀번호'), { target: { value: 'pw2222' } })
    fireEvent.click(screen.getByText('로그인'))

    expect(onLogin).toHaveBeenCalledWith('id-second', '홍길동')
  })

  it('첫 번째 동명이인도 자기 비밀번호로 로그인된다', () => {
    const onLogin = vi.fn()
    render(<LoginScreen members={dupes} onLogin={onLogin} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'id-first' } })
    fireEvent.change(screen.getByPlaceholderText('비밀번호'), { target: { value: 'pw1111' } })
    fireEvent.click(screen.getByText('로그인'))

    expect(onLogin).toHaveBeenCalledWith('id-first', '홍길동')
  })

  it('다른 동명이인의 비밀번호로는 로그인되지 않는다', () => {
    const onLogin = vi.fn()
    render(<LoginScreen members={dupes} onLogin={onLogin} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'id-second' } })
    fireEvent.change(screen.getByPlaceholderText('비밀번호'), { target: { value: 'pw1111' } })
    fireEvent.click(screen.getByText('로그인'))

    expect(onLogin).not.toHaveBeenCalled()
    expect(screen.getByText('비밀번호가 틀렸습니다.')).toBeInTheDocument()
  })

  it('동명이인 선택 목록에 구분정보가 함께 보인다', () => {
    render(<LoginScreen members={dupes} onLogin={vi.fn()} />)
    expect(screen.getByRole('option', { name: '홍길동 (90학번)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '홍길동 (02학번)' })).toBeInTheDocument()
  })

  it('동명이인이 없는 기존 회원은 이름만 보이고 로그인도 그대로 동작한다', () => {
    const onLogin = vi.fn()
    const plain = [
      member({ id: 'm1', name: '테스트회원A' }), // password 미설정 → 기본 '0000'
      member({ id: 'm2', name: '테스트회원B' }),
    ]
    render(<LoginScreen members={plain} onLogin={onLogin} />)

    expect(screen.getByRole('option', { name: '테스트회원A' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm1' } })
    fireEvent.change(screen.getByPlaceholderText('비밀번호'), { target: { value: '0000' } })
    fireEvent.click(screen.getByText('로그인'))

    expect(onLogin).toHaveBeenCalledWith('m1', '테스트회원A')
  })

  it('displayTag가 없는 기존 데이터로도 화면이 정상 동작한다', () => {
    const plain = [member({ id: 'm1', name: '테스트회원A' })]
    render(<LoginScreen members={plain} onLogin={vi.fn()} />)
    expect(screen.getByRole('option', { name: '테스트회원A' })).toBeInTheDocument()
    expect(screen.getByText('로그인')).toBeInTheDocument()
  })

  it('GUEST 선택은 기존대로 동작한다', () => {
    const onLogin = vi.fn()
    render(<LoginScreen members={[member({ id: 'm1', name: '테스트회원A' })]} onLogin={onLogin} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__guest__' } })
    fireEvent.click(screen.getByText('로그인'))

    expect(onLogin).toHaveBeenCalledWith('__guest__', 'GUEST')
  })
})

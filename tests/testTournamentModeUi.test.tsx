import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TournamentCreateForm } from '../src/components/tournament/TournamentCreateForm'
import { TournamentList } from '../src/components/tournament/TournamentList'
import { TournamentResultCard } from '../src/components/tournament/TournamentResultShare'
import { buildResultShareData, buildResultShareText } from '../src/logic/tournamentResultShare'
import { buildRestartTournament } from '../src/logic/tournamentRestart'
import { nameOfMain, playMain8, playRestart } from './fixtures/resultShare'
import type { Tournament } from '../src/types/tournament'

// 테스트 대회 화면 표시·공유 표시 — 가상 데이터만 쓴다.

const base: Tournament = {
  id: 't1', name: '가상 대회', date: '2026-10-20', timeLimitMinutes: 50, status: 'draft', createdAt: '2026-10-20T00:00:00.000Z',
}

describe('대회 만들기 — 테스트 대회 체크', () => {
  const fill = () => {
    fireEvent.change(screen.getByPlaceholderText('예: 추석맞이 대회'), { target: { value: '가상 대회' } })
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: '2026-10-20' } })
  }

  it('기본값은 꺼져 있고, 안내 문구가 보인다', () => {
    render(<TournamentCreateForm onCreate={() => {}} onCancel={() => {}} />)
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText('경기는 정상 진행되지만 전적·통계·랭킹에는 반영되지 않습니다.')).toBeInTheDocument()
  })

  it('체크하지 않고 만들면 실제 대회(isTestTournament: false)로 넘어간다', () => {
    const onCreate = vi.fn()
    render(<TournamentCreateForm onCreate={onCreate} onCancel={() => {}} />)
    fill()
    fireEvent.click(screen.getByText('대회 만들기'))
    expect(onCreate).toHaveBeenCalledWith({ name: '가상 대회', date: '2026-10-20', timeLimitMinutes: 50, isTestTournament: false })
  })

  it('체크하고 만들면 테스트 대회(isTestTournament: true)로 넘어간다', () => {
    const onCreate = vi.fn()
    render(<TournamentCreateForm onCreate={onCreate} onCancel={() => {}} />)
    fill()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('대회 만들기'))
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ isTestTournament: true }))
  })

  it('체크 칸은 누르기 쉬운 크기다(24px 이상, 줄 높이 44px 이상)', () => {
    render(<TournamentCreateForm onCreate={() => {}} onCancel={() => {}} />)
    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.style.width).toBe('24px')
    expect((box.closest('label') as HTMLElement).style.minHeight).toBe('44px')
  })
})

describe('대회 목록 — 테스트 배지', () => {
  it('테스트 대회에만 "테스트" 배지가 붙고, 실제 대회에는 없다', () => {
    render(<TournamentList
      tournaments={[{ ...base, id: 'real', name: '실제 대회' }, { ...base, id: 'test', name: '시험 대회', isTestTournament: true }]}
      participantsByTournamentId={{}} onSelect={() => {}}
    />)
    const badges = screen.getAllByTestId('test-badge')
    expect(badges).toHaveLength(1)
    expect(badges[0].closest('button')!.textContent).toContain('시험 대회')
    expect(screen.getByText('실제 대회').closest('button')!.querySelector('[data-testid="test-badge"]')).toBeNull()
  })
})

describe('리스타트 대회 자동 생성 — 테스트 플래그 상속', () => {
  it('본선이 테스트 대회이면 리스타트도 테스트 대회로 만든다', () => {
    expect(buildRestartTournament({ ...base, isTestTournament: true }, '2026-10-20T01:00:00.000Z').isTestTournament).toBe(true)
  })
  it('실제 본선이면 리스타트 문서에 테스트 필드가 없다(기존과 같은 모양)', () => {
    expect(Object.keys(buildRestartTournament(base, '2026-10-20T01:00:00.000Z'))).not.toContain('isTestTournament')
  })
})

describe('결과 공유 — 테스트 대회 표시', () => {
  const input = (isTest?: boolean) => ({
    mastersMatches: playMain8(true), mastersNameOf: nameOfMain, restartMatches: playRestart(),
    restartNameOf: (id: string | null) => (id ? `가상선수${id.slice(1)}` : ''), highRun: '', isTest,
  })

  it('테스트 대회 카톡 문구는 맨 위에 테스트 표시가 있고, 본선·리스타트 상세는 그대로 들어 있다', () => {
    const text = buildResultShareText(buildResultShareData(input(true)))
    expect(text.startsWith('🧪 테스트 대회 결과 (실제 기록이 아닙니다)\n\n🏆 대회 최종결과\n\n마스터즈 1위')).toBe(true)
    expect(text).toContain('▶ 결승전')
    expect(text).toContain('[리스타트전 경기결과]')
  })

  it('실제 대회 카톡 문구는 기존 형식 그대로다(테스트 표시 없음)', () => {
    const real = buildResultShareText(buildResultShareData(input(undefined)))
    expect(real.startsWith('🏆 대회 최종결과\n\n마스터즈 1위')).toBe(true)
    expect(real).not.toContain('테스트')
    // 테스트 표시 한 줄만 다르다
    const test = buildResultShareText(buildResultShareData(input(true)))
    expect(test.replace('🧪 테스트 대회 결과 (실제 기록이 아닙니다)\n\n', '')).toBe(real)
  })

  it('이미지 카드: 테스트 대회에만 "테스트 대회 (실제 기록 아님)" 표시가 있고, 본선·리스타트 상세는 그대로 있다', () => {
    const { unmount } = render(<TournamentResultCard tournament={{ ...base, isTestTournament: true }} data={buildResultShareData(input(true))} />)
    expect(screen.getByTestId('result-test-mark').textContent).toBe('테스트 대회 (실제 기록 아님)')
    expect(screen.getByTestId('result-masters-details')).toBeInTheDocument()
    expect(screen.getByTestId('result-restart-details')).toBeInTheDocument()
    unmount()
    render(<TournamentResultCard tournament={base} data={buildResultShareData(input(undefined))} />)
    expect(screen.queryByTestId('result-test-mark')).toBeNull()
  })
})

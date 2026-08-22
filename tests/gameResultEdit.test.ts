import { describe, it, expect, beforeEach } from 'vitest'
import { useApp } from '../src/store/appStore'
import { validateGameResult, winnerId } from '../src/logic/game'
import { memberStats, headToHead } from '../src/logic/stats'
import type { Game, Member, Session } from '../src/types'

// 아래 이름·ID·점수는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

const members: Member[] = [
  { id: 'm1', name: '테스트회원A', handicap: 20, handicapHistory: [{ value: 20, changedAt: '2026-01-01T00:00:00.000Z' }], active: true },
  { id: 'm2', name: '테스트회원B', handicap: 25, handicapHistory: [{ value: 25, changedAt: '2026-01-01T00:00:00.000Z' }], active: true },
]

function game(over: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    playerAId: 'm1', playerBId: 'm2',
    handicapA: 20, handicapB: 25,
    scoreA: 10, scoreB: 20,
    endType: 'time',
    playedAt: '2026-07-10T00:00:00.000Z',
    round: 1,
    ...over,
  }
}

function session(games: Game[]): Session {
  return { id: 's1', date: '2026-07-10', type: 'regular', approved: true, attendeeIds: ['m1', 'm2'], games }
}

const storedGame = (gameId = 'g1') =>
  useApp.getState().sessions.find((s) => s.id === 's1')!.games.find((g) => g.id === gameId)!

beforeEach(() => {
  useApp.setState({ members, sessions: [session([game()])], settings: { lastBackupAt: null }, ledger: [] })
})

describe('validateGameResult — 경기 결과 입력 검증', () => {
  it('정상 값이면 숫자로 변환해서 통과시킨다', () => {
    const r = validateGameResult({ handicapA: '22', scoreA: '18', handicapB: '25', scoreB: '25' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.values).toEqual({ handicapA: 22, scoreA: 18, handicapB: 25, scoreB: 25 })
  })

  it('득점이 적용 핸디보다 크면 막는다', () => {
    const r = validateGameResult({ handicapA: 20, scoreA: 21, handicapB: 25, scoreB: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toBe('득점은 적용 핸디보다 클 수 없습니다.')
  })

  it('상대 선수 득점이 적용 핸디보다 커도 막는다', () => {
    const r = validateGameResult({ handicapA: 20, scoreA: 10, handicapB: 25, scoreB: 26 })
    expect(r.ok).toBe(false)
  })

  it('음수 득점은 막는다', () => {
    const r = validateGameResult({ handicapA: 20, scoreA: '-1', handicapB: 25, scoreB: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toBe('득점은 0보다 작을 수 없습니다.')
  })

  it('적용 핸디 0 이하는 막는다', () => {
    const r = validateGameResult({ handicapA: 0, scoreA: 0, handicapB: 25, scoreB: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toBe('적용 핸디는 1 이상이어야 합니다.')
  })

  it('빈 값이나 숫자가 아닌 값은 막는다', () => {
    expect(validateGameResult({ handicapA: '', scoreA: '10', handicapB: '25', scoreB: '10' }).ok).toBe(false)
    expect(validateGameResult({ handicapA: '20', scoreA: 'abc', handicapB: '25', scoreB: '10' }).ok).toBe(false)
  })

  it('득점이 적용 핸디와 같은 값은 허용한다(핸디를 다 친 경우)', () => {
    expect(validateGameResult({ handicapA: 20, scoreA: 20, handicapB: 25, scoreB: 12 }).ok).toBe(true)
  })
})

describe('updateGameResult — 저장된 경기의 적용 핸디·득점 수정', () => {
  it('적용 핸디와 득점이 경기에 반영된다', () => {
    useApp.getState().updateGameResult('s1', 'g1', { handicapA: 22, scoreA: 18, handicapB: 25, scoreB: 20 })
    const g = storedGame()
    expect(g.handicapA).toBe(22)
    expect(g.scoreA).toBe(18)
    expect(g.handicapB).toBe(25)
    expect(g.scoreB).toBe(20)
  })

  it('수정된 값 기준으로 승패가 다시 판정된다', () => {
    // 수정 전: A 10/20(50%) vs B 20/25(80%) → B 승
    expect(winnerId(storedGame())).toBe('m2')
    // 수정 후: A 19/20(95%) vs B 20/25(80%) → A 승
    useApp.getState().updateGameResult('s1', 'g1', { scoreA: 19 })
    expect(winnerId(storedGame())).toBe('m1')
  })

  it('과거 CSV 임포트 경기의 명시적 winnerId가 새 결과와 충돌하지 않는다', () => {
    // 과거 CSV 임포트 데이터: winnerId가 명시적으로 저장되어 있다
    useApp.setState({ sessions: [session([game({ winnerId: 'm2' })])] })
    expect(winnerId(storedGame())).toBe('m2')

    // A가 이기도록 점수를 고치면, 옛 승자가 남지 않고 새 점수 기준으로 판정된다
    useApp.getState().updateGameResult('s1', 'g1', { scoreA: 20, scoreB: 10 })
    expect(storedGame().winnerId).toBeUndefined()
    expect(winnerId(storedGame())).toBe('m1')
  })

  it('핸디를 다 친 경우 endType이 cleared로 다시 계산된다', () => {
    expect(storedGame().endType).toBe('time')
    useApp.getState().updateGameResult('s1', 'g1', { scoreA: 20 })
    expect(storedGame().endType).toBe('cleared')
  })

  it('회원의 현재 핸디는 바뀌지 않는다', () => {
    useApp.getState().updateGameResult('s1', 'g1', { handicapA: 22, handicapB: 30 })
    const [a, b] = useApp.getState().members
    expect(a.handicap).toBe(20)
    expect(b.handicap).toBe(25)
    expect(a.handicapHistory).toHaveLength(1)
    expect(b.handicapHistory).toHaveLength(1)
  })

  it('같은 세션의 다른 경기의 적용 핸디·득점은 그대로 남는다', () => {
    useApp.setState({
      sessions: [session([
        game(),
        game({ id: 'g2', handicapA: 15, handicapB: 18, scoreA: 15, scoreB: 12, endType: 'cleared' }),
      ])],
    })
    useApp.getState().updateGameResult('s1', 'g1', { handicapA: 22, scoreA: 18 })
    const other = storedGame('g2')
    expect(other.handicapA).toBe(15)
    expect(other.handicapB).toBe(18)
    expect(other.scoreA).toBe(15)
    expect(other.scoreB).toBe(12)
  })

  it('수정하면 승률·상대전적 통계가 새 값 기준으로 다시 계산된다', () => {
    const before = memberStats(useApp.getState().sessions).find((s) => s.memberId === 'm1')!
    expect(before.wins).toBe(0)
    expect(headToHead(useApp.getState().sessions, 'm1', 'm2').aWins).toBe(0)

    useApp.getState().updateGameResult('s1', 'g1', { scoreA: 19 })

    const after = memberStats(useApp.getState().sessions).find((s) => s.memberId === 'm1')!
    expect(after.wins).toBe(1)
    expect(after.losses).toBe(0)
    expect(after.winRate).toBe(1)
    expect(headToHead(useApp.getState().sessions, 'm1', 'm2').aWins).toBe(1)

    // 상대(m2)쪽 통계도 같이 뒤집혀야 한다
    const opponent = memberStats(useApp.getState().sessions).find((s) => s.memberId === 'm2')!
    expect(opponent.wins).toBe(0)
    expect(opponent.losses).toBe(1)
    expect(opponent.winRate).toBe(0)
    expect(headToHead(useApp.getState().sessions, 'm1', 'm2').bWins).toBe(0)
  })
})

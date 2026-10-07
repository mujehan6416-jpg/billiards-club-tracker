import { describe, it, expect, vi, beforeEach } from 'vitest'

// 대회 삭제가 "통계용 파생 기록"(sessions/tournament-session-{id} 와 그 아래 games)까지 지우는지, 그리고
// 다른 대회·일반 모임 기록·회원·정산 데이터는 건드리지 않는지 확인한다. 메모리 속 가짜 저장소만 사용한다(운영 데이터 무관).
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>()
  const { firestoreFake } = await import('./fixtures/fakeFirestore')
  return { ...actual, ...firestoreFake }
})

import { deleteTournament } from '../src/lib/tournamentSync'
import { rawGet, rawPathsWithPrefix, rawSet, resetFakeFirestore } from './fixtures/fakeFirestore'

const C = 'clubs/skkubc'
const T = (id: string, extra: Record<string, unknown> = {}) => rawSet(`${C}/tournaments/${id}`, { id, name: id, status: 'finished', ...extra })

/** 대회 하나와 그 하위·통계 데이터를 심는다. */
function seedTournament(id: string, opts: { matches?: number; games?: number; restartOf?: string } = {}) {
  T(id, opts.restartOf ? { restartSourceTournamentId: opts.restartOf } : {})
  rawSet(`${C}/tournaments/${id}/participants/p1`, { id: 'p1' })
  rawSet(`${C}/tournaments/${id}/participants/p2`, { id: 'p2' })
  for (let i = 1; i <= (opts.matches ?? 2); i++) rawSet(`${C}/tournaments/${id}/matches/r1m${i}`, { id: `r1m${i}` })
  rawSet(`${C}/tournaments/${id}/private/draw`, { x: 1 })
  const n = opts.games ?? 2
  if (n > 0) rawSet(`${C}/sessions/tournament-session-${id}`, { id: `tournament-session-${id}` })
  for (let i = 1; i <= n; i++) rawSet(`${C}/sessions/tournament-session-${id}/games/tournament-game-${id}-r1m${i}`, { id: `g${i}` })
}

beforeEach(() => resetFakeFirestore())

describe('deleteTournament — 통계용 파생 기록까지 정리', () => {
  it('1. 대회 본문·참가자·대진·추첨·통계 세션·통계 경기가 모두 지워진다', async () => {
    seedTournament('A')
    await deleteTournament('A', 'skkubc')
    expect(rawPathsWithPrefix(`${C}/tournaments/A`)).toEqual([])
    expect(rawPathsWithPrefix(`${C}/sessions/tournament-session-A`)).toEqual([])
  })

  it('2. 연결된 리스타트 대회(고정 번호)와 그 통계 기록도 함께 지워진다', async () => {
    seedTournament('A')
    seedTournament('restart-A', { restartOf: 'A' })
    await deleteTournament('A', 'skkubc')
    expect(rawPathsWithPrefix(`${C}/tournaments/restart-A`)).toEqual([])
    expect(rawPathsWithPrefix(`${C}/sessions/tournament-session-restart-A`)).toEqual([])
  })

  it('3. 연결 정보(restartSourceTournamentId)만 있는 리스타트도 함께 지워진다', async () => {
    seedTournament('A')
    seedTournament('custom-restart', { restartOf: 'A' })
    await deleteTournament('A', 'skkubc')
    expect(rawPathsWithPrefix(`${C}/tournaments/custom-restart`)).toEqual([])
    expect(rawPathsWithPrefix(`${C}/sessions/tournament-session-custom-restart`)).toEqual([])
  })

  it('4. 리스타트만 지우면 본선과 본선 통계는 그대로다', async () => {
    seedTournament('A')
    seedTournament('restart-A', { restartOf: 'A' })
    const before = rawPathsWithPrefix(`${C}/tournaments/A`).length + rawPathsWithPrefix(`${C}/sessions/tournament-session-A`).length
    await deleteTournament('restart-A', 'skkubc')
    expect(rawPathsWithPrefix(`${C}/tournaments/restart-A`)).toEqual([])
    expect(rawPathsWithPrefix(`${C}/tournaments/A`).length + rawPathsWithPrefix(`${C}/sessions/tournament-session-A`).length).toBe(before)
  })

  it('5. 다른 대회와 그 통계 기록(이름이 비슷해도)은 건드리지 않는다', async () => {
    seedTournament('A')
    seedTournament('A2')
    seedTournament('B')
    seedTournament('restart-B', { restartOf: 'B' })
    const keep = [...rawPathsWithPrefix(`${C}/tournaments/A2`), ...rawPathsWithPrefix(`${C}/sessions/tournament-session-A2`),
      ...rawPathsWithPrefix(`${C}/tournaments/B`), ...rawPathsWithPrefix(`${C}/sessions/tournament-session-B`),
      ...rawPathsWithPrefix(`${C}/tournaments/restart-B`), ...rawPathsWithPrefix(`${C}/sessions/tournament-session-restart-B`)]
    await deleteTournament('A', 'skkubc')
    for (const p of keep) expect(rawGet(p)).toBeDefined()
  })

  it('6. 일반 모임(세션)의 경기 기록은 그대로다', async () => {
    seedTournament('A')
    rawSet(`${C}/sessions/2026-10-01`, { id: '2026-10-01' })
    rawSet(`${C}/sessions/2026-10-01/games/g1`, { id: 'g1' })
    await deleteTournament('A', 'skkubc')
    expect(rawGet(`${C}/sessions/2026-10-01`)).toBeDefined()
    expect(rawGet(`${C}/sessions/2026-10-01/games/g1`)).toBeDefined()
  })

  it('7. 회원·핸디·정산 문서는 그대로다', async () => {
    seedTournament('A')
    rawSet(`${C}/members/m1`, { id: 'm1', handicap: 12 })
    rawSet(`${C}/settlements/s1`, { id: 's1' })
    rawSet(`${C}`, { name: 'club' })
    await deleteTournament('A', 'skkubc')
    expect(rawGet(`${C}/members/m1`)).toEqual({ id: 'm1', handicap: 12 })
    expect(rawGet(`${C}/settlements/s1`)).toEqual({ id: 's1' })
    expect(rawGet(C)).toEqual({ name: 'club' })
  })

  it('8. 통계 기록이 없는 대회(아직 경기 없음)도 오류 없이 지워지고, 450개를 넘는 문서도 나눠서 지운다', async () => {
    seedTournament('empty', { matches: 0, games: 0 })
    await expect(deleteTournament('empty', 'skkubc')).resolves.toBeUndefined()
    expect(rawPathsWithPrefix(`${C}/tournaments/empty`)).toEqual([])

    seedTournament('big', { matches: 300, games: 300 })
    seedTournament('other', { matches: 1, games: 1 })
    await deleteTournament('big', 'skkubc')
    expect(rawPathsWithPrefix(`${C}/tournaments/big`)).toEqual([])
    expect(rawPathsWithPrefix(`${C}/sessions/tournament-session-big`)).toEqual([])
    expect(rawPathsWithPrefix(`${C}/tournaments/other`).length).toBeGreaterThan(0)
  })

  it('9. 지운 뒤 같은 번호로 다시 만들어 경기를 확정해도 통계 기록이 중복되지 않는다', async () => {
    seedTournament('A', { games: 2 })
    await deleteTournament('A', 'skkubc')
    // 다시 만든 대회가 같은 번호의 통계 경기 문서를 쓰면 한 건으로 덮어써진다(옛 기록이 남아 있지 않다)
    rawSet(`${C}/sessions/tournament-session-A`, { id: 'tournament-session-A' })
    rawSet(`${C}/sessions/tournament-session-A/games/tournament-game-A-r1m1`, { id: 'g1' })
    const games = rawPathsWithPrefix(`${C}/sessions/tournament-session-A/games`)
    expect(games).toEqual([`${C}/sessions/tournament-session-A/games/tournament-game-A-r1m1`])
  })
})

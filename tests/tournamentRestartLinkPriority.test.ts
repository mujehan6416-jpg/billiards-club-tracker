import { describe, it, expect } from 'vitest'
import { buildRestartTournament, findRestartTarget, restartTournamentId } from '../src/logic/tournamentRestart'
import type { Tournament } from '../src/types/tournament'

// 리스타트 연결 우선순위 재현 시나리오 — 가상 데이터만 사용한다(실제 대회명·회원 정보 아님).

const main = (id: string, name = '가상 본선', date = '2026-10-05'): Tournament => ({
  id, name, date, timeLimitMinutes: 50, status: 'bracketFixed', createdAt: '2026-10-05T00:00:00.000Z',
})
const NOW = '2026-10-05T01:00:00.000Z'

describe('리스타트 연결 — 고정 id 우선, stale 대회 무시', () => {
  it('시나리오 1: 본선 A → restart-A 자동 생성 → 정상 연결', () => {
    const a = main('uuid-a')
    const ra = buildRestartTournament(a, NOW)
    expect(ra.id).toBe(restartTournamentId('uuid-a'))
    expect(findRestartTarget(a, [a, ra])).toEqual({ kind: 'found', tournament: ra })
  })

  it('시나리오 2: A·restart-A 삭제 후 본선 B(같은 이름) 생성 → restart-B로 연결, A 흔적과 섞이지 않음', () => {
    const b = main('uuid-b')
    const rb = buildRestartTournament(b, NOW)
    expect(findRestartTarget(b, [b, rb])).toEqual({ kind: 'found', tournament: rb })
    // 다른 기기 목록에 삭제 전 A·restart-A가 남아 있어도(같은 이름) B는 restart-B로 연결된다
    const staleA = main('uuid-a')
    const staleRa = buildRestartTournament(staleA, NOW)
    expect(findRestartTarget(b, [staleA, staleRa, b, rb])).toEqual({ kind: 'found', tournament: rb })
    // restart-B가 아직 없으면 남아 있는 restart-A(다른 본선의 자동 생성 대회)를 이름만 보고 잡지 않는다 → 새로 만들도록 missing
    expect(findRestartTarget(b, [staleA, staleRa, b]).kind).toBe('missing')
  })

  it('시나리오 3: 같은 목록에서 본선 A → B로 바꿔 보면 각각 자기 restart로 연결된다', () => {
    const a = main('uuid-a', '가상 본선 A')
    const b = main('uuid-b', '가상 본선 B')
    const list = [a, b, buildRestartTournament(a, NOW), buildRestartTournament(b, NOW)]
    expect(findRestartTarget(a, list)).toMatchObject({ kind: 'found', tournament: { id: 'restart-uuid-a' } })
    expect(findRestartTarget(b, list)).toMatchObject({ kind: 'found', tournament: { id: 'restart-uuid-b' } })
  })

  it('시나리오 4: 같은 이름·같은 날짜 대회가 따로 있어도 고정 id 대회가 우선(이전에는 "여러 개"로 중단됨)', () => {
    const a = main('uuid-a')
    const fixed = buildRestartTournament(a, NOW)
    const manual: Tournament = { ...fixed, id: 'manual-uuid', status: 'draft' }
    expect(findRestartTarget(a, [a, manual, fixed])).toEqual({ kind: 'found', tournament: fixed })
  })

  it('이 본선으로 이미 대진을 만든 대회가 있으면(실제 운영 중) 그것이 최우선이다', () => {
    const a = main('uuid-a')
    const fixed = buildRestartTournament(a, NOW)
    const running: Tournament = { ...fixed, id: 'manual-uuid', status: 'bracketFixed', restartSourceTournamentId: 'uuid-a' }
    expect(findRestartTarget(a, [a, fixed, running])).toEqual({ kind: 'found', tournament: running })
  })

  it('다른 본선에 이미 연결된 같은 이름 대회는 이름만 보고 잡지 않는다', () => {
    const a = main('uuid-a')
    const other: Tournament = { ...buildRestartTournament(a, NOW), id: 'manual-x', restartSourceTournamentId: 'uuid-old' }
    expect(findRestartTarget(a, [a, other]).kind).toBe('missing')
  })

  it('시나리오 5: 앱 재실행(목록을 처음부터 다시 읽음) → 기존 본선의 restart에 그대로 재연결', () => {
    const a = main('uuid-real')
    const ra: Tournament = { ...buildRestartTournament(a, NOW), status: 'bracketFixed', restartSourceTournamentId: 'uuid-real' }
    const reloaded = JSON.parse(JSON.stringify([ra, a])) as Tournament[]
    expect(findRestartTarget(reloaded[1], reloaded)).toMatchObject({ kind: 'found', tournament: { id: 'restart-uuid-real' } })
  })
})

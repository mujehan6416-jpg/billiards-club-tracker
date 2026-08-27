import { describe, it, expect } from 'vitest'
import {
  buildScenarioH, buildScenarioI, buildScenarioJ, buildScenarioK,
  buildScenarioL, buildScenarioM, buildScenarioN, buildScenarioO,
} from '../src/dev/tournamentDevSeed'
import { tournamentMatchId } from '../src/logic/tournamentBracket'

// 개발 미리보기용 4C 시나리오가 실제로 의도한 경기 상태를 만드는지 확인한다.
// (Firestore를 전혀 쓰지 않는 순수 시드 데이터라 컴포넌트 테스트 없이도 상태만 검증할 수 있다.)

function find(matches: ReturnType<typeof buildScenarioH>['matches'], id: string) {
  const m = matches.find((x) => x.id === id)
  if (!m) throw new Error(`${id} not found`)
  return m
}

describe('4C 개발 시나리오 시드', () => {
  it('H: 결과 입력됨, 상대 확인 대기', () => {
    const { matches } = buildScenarioH()
    const m = find(matches, tournamentMatchId(1, 1))
    expect(m.status).toBe('awaitingVerification')
    expect(m.resultLog?.submittedByMemberId).toBeTruthy()
  })

  it('I: 회원 확인까지 끝남, 관리자 승인 대기', () => {
    const { matches } = buildScenarioI()
    const m = find(matches, tournamentMatchId(1, 1))
    expect(m.status).toBe('awaitingApproval')
    expect(m.resultLog?.verificationType).toBe('player')
  })

  it('J: 관리자 직권 확인, 관리자 승인 대기', () => {
    const { matches } = buildScenarioJ()
    const m = find(matches, tournamentMatchId(1, 1))
    expect(m.status).toBe('awaitingApproval')
    expect(m.resultLog?.verificationType).toBe('adminOverride')
  })

  it('K: 수정 요청됨', () => {
    const { matches } = buildScenarioK()
    const m = find(matches, tournamentMatchId(1, 1))
    expect(m.resultLog?.correctionRequested).toBe(true)
  })

  it('L: 달성률 동률', () => {
    const { matches } = buildScenarioL()
    const m = find(matches, tournamentMatchId(1, 1))
    expect(m.status).toBe('awaitingApproval')
    expect(m.calculatedWinnerParticipantId).toBeNull()
  })

  it('M: 4강 한쪽만 확정 — 반대편 자리는 아직 비어 있다', () => {
    const { matches } = buildScenarioM()
    const r1m1 = find(matches, tournamentMatchId(1, 1))
    expect(r1m1.status).toBe('official')
    const r2m1 = find(matches, tournamentMatchId(2, 1))
    expect(r2m1.playerAParticipantId).toBe(r1m1.officialWinnerParticipantId)
    expect(r2m1.playerBParticipantId).toBeNull()
  })

  it('N: 4강 양쪽 확정 — 바로 경기를 치를 수 있다(한쪽은 기권승)', () => {
    const { matches } = buildScenarioN()
    const r2m1 = find(matches, tournamentMatchId(2, 1))
    expect(r2m1.playerAParticipantId).not.toBeNull()
    expect(r2m1.playerBParticipantId).not.toBeNull()
    expect(r2m1.status).toBe('awaitingResult')
    const r1m2 = find(matches, tournamentMatchId(1, 2))
    expect(r1m2.resultType).toBe('forfeit')
  })

  it('O: 대회 종료 — 결승까지 전부 공식 확정되고 우승자가 정해진다', () => {
    const { tournament, matches } = buildScenarioO()
    expect(tournament.status).toBe('finished')
    expect(tournament.championParticipantId).toBeTruthy()
    const final = find(matches, tournamentMatchId(3, 1))
    expect(final.status).toBe('official')
    expect(final.officialWinnerParticipantId).toBe(tournament.championParticipantId)
  })
})

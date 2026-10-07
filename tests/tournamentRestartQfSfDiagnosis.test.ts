import { describe, it, expect } from 'vitest'
import { buildEmptyBracket, buildTournamentMatches } from '../src/logic/tournamentBracket'
import { analyzeRestartSource, buildRestartBracket } from '../src/logic/tournamentRestartBracket'
import { applyPromotion, promotionFor } from '../src/logic/tournamentMatch'
import { seat, seededRng } from './fixtures/restartMain'
import type { TournamentMatch } from '../src/types/tournament'

// 진단 전용 테스트(운영 코드·데이터 변경 없음): 리스타트 8강 각 경기의 승자가 어느 4강 자리로 가는지 글자로 확인한다.
// 숫자 n = 가상 선수 번호 = 본선 추첨 자리 번호 = 회원 id `m{n}` / 참가자 id `p{n}` (fixtures/restartMain.ts의 seat(n)).

const n = (id: string | null | undefined) => (id ? Number(id.slice(1)) : 0)
const label = (m: TournamentMatch) => `${m.id}[${n(m.playerAMemberId) || '비어있음'} vs ${n(m.playerBMemberId) || '비어있음'}]`

/** 경기를 "승자 번호"로 공식 확정하고 다음 자리에 올린다. */
function win(matches: TournamentMatch[], winner: number, loser: number): TournamentMatch[] {
  const m = matches.find((x) => [n(x.playerAMemberId), n(x.playerBMemberId)].sort().join() === [winner, loser].sort().join())
  if (!m) throw new Error(`경기 없음 ${winner} v ${loser}`)
  const winnerIsA = n(m.playerAMemberId) === winner
  const done: TournamentMatch = {
    ...m, status: 'official', scoreA: winnerIsA ? 20 : 5, scoreB: winnerIsA ? 5 : 20,
    officialWinnerParticipantId: `p${winner}`, officialLoserParticipantId: `p${loser}`,
  }
  const promo = promotionFor(done)
  return matches.map((x) => (x.id === m.id ? done : promo && x.id === promo.nextMatchId ? applyPromotion(x, promo) : x))
}

function mainBracket(): TournamentMatch[] {
  const bracket = buildEmptyBracket(16, { includeThirdPlace: true })
  if (!bracket.ok) throw new Error(bracket.message)
  const seats = Array.from({ length: 15 }, (_, i) => seat(i + 1)) // 16번 자리 = 부전승
  const built = buildTournamentMatches(bracket.value, seats)
  if (!built.ok) throw new Error(built.message)
  let ms = built.value
  for (const [w, l] of [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14]]) ms = win(ms, w, l)
  for (const [w, l] of [[1, 3], [5, 7], [9, 11], [13, 15]]) ms = win(ms, w, l)
  return ms
}

describe('진단: 리스타트 8강 → 4강 연결 규칙', () => {
  const main = mainBracket()
  const analysis = analyzeRestartSource(main)
  if (!analysis.ok) throw new Error(analysis.message)
  const built = buildRestartBracket({
    sourceTournamentId: 'main', analysis: analysis.value, sourceMatches: main,
    entrants: [2, 4, 6, 8, 10, 12, 14].map((k) => ({ participantId: `m${k}`, memberId: `m${k}`, handicap: 20 })),
    rng: seededRng(762),
  })
  if (!built.ok) throw new Error(built.message)
  const restart = built.value.matches
  const qf = restart.filter((m) => m.roundNumber === 2).sort((a, b) => a.matchNumber - b.matchNumber)

  it('본선 8강(2차) 경기 순서와 리스타트 8강 합류 자리의 대응', () => {
    const lines = analysis.value.secondRound.map((s) => {
      const slot = qf.find((q) => q.playerBJoinFrom?.matchId === s.id)!
      return `본선 ${s.id}[${n(s.playerAMemberId)} vs ${n(s.playerBMemberId)}] 패자 → 리스타트 ${slot.id} B자리 (nextMatch=${slot.nextMatchId}/${slot.nextSlot})`
    })
    console.log(`\n[합류 규칙]\n${lines.join('\n')}`)
    expect(qf.map((q) => q.playerBJoinFrom!.matchId)).toEqual(['r2m1', 'r2m2', 'r2m3', 'r2m4']) // i번째 합류 자리 ← 본선 i번째 8강
  })

  it('8강 i경기 승자는 4강 ⌈i/2⌉경기의 (홀수=A, 짝수=B) 자리로 간다', () => {
    const table = qf.map((q) => `8강 ${q.matchNumber}경기 승자 → ${q.nextMatchId} ${q.nextSlot}`)
    console.log(`\n[코드 기준 연결표]\n${table.join('\n')}`)
    expect(qf.map((q) => [q.nextMatchId, q.nextSlot])).toEqual([['r3m1', 'playerA'], ['r3m1', 'playerB'], ['r3m2', 'playerA'], ['r3m2', 'playerB']])
  })

  it('앱이 만든 8강 대진 + 실제 8강 승자를 넣으면 4강은 이렇게 된다', () => {
    // 8강 A 자리(리스타트 1차전 승자)는 전체 시뮬레이션이 앱으로 실제 만든 순서 [14, 10, 2, 6]을 그대로 쓰고,
    // B 자리(합류자)는 본선 8강 패자 [3, 7, 11, 15]를 본선 r2m1..4 순서대로 앉힌다(placeRestartJoiner와 같은 결과).
    const aSide = [14, 10, 2, 6]
    const losers = [3, 7, 11, 15]
    let ms = restart.map((m) => {
      const k = qf.findIndex((q) => q.id === m.id)
      return k < 0 ? m : {
        ...m,
        playerAParticipantId: `p${aSide[k]}`, playerAMemberId: `m${aSide[k]}`, playerAHandicapSnapshot: 20,
        playerBParticipantId: `p${losers[k]}`, playerBMemberId: `m${losers[k]}`, playerBHandicapSnapshot: 20,
      }
    })
    console.log(`\n[앱이 만든 리스타트 8강 순서]\n${ms.filter((m) => m.roundNumber === 2).sort((a, b) => a.matchNumber - b.matchNumber).map(label).join('\n')}`)
    // 실제 8강 승자: 8강 대진 속 선수 번호로 지정
    for (const [w, l] of [[15, 6], [7, 10], [3, 14], [2, 11]]) ms = win(ms, w, l)
    const sf = ms.filter((m) => m.roundNumber === 3).sort((a, b) => a.matchNumber - b.matchNumber)
    console.log(`\n[앱 규칙대로 만들어진 4강]\n${sf.map(label).join('\n')}`)
    expect(sf.map((m) => [n(m.playerAMemberId), n(m.playerBMemberId)])).toEqual([[3, 7], [2, 15]])
  })

  it('가정 시험: 실제 대회가 8강 순서 [15v6, 7v10, 3v14, 2v11]였다면 같은 규칙으로 실제 4강이 나온다', () => {
    // 8강 4경기를 그 순서로 직접 놓고, 연결은 앱 코드(restart 생성 결과의 3라운드 이후 구조)를 그대로 쓴다.
    const order: [number, number][] = [[15, 6], [7, 10], [3, 14], [2, 11]]
    let ms = restart.map((m) => {
      const k = qf.findIndex((q) => q.id === m.id)
      if (k < 0 || m.roundNumber !== 2) return m
      return { ...m, playerAParticipantId: `p${order[k][1]}`, playerAMemberId: `m${order[k][1]}`, playerBParticipantId: `p${order[k][0]}`, playerBMemberId: `m${order[k][0]}`, playerBHandicapSnapshot: 20 }
    })
    for (const [w, l] of order) ms = win(ms, w, l)
    const sf = ms.filter((m) => m.roundNumber === 3).sort((a, b) => a.matchNumber - b.matchNumber)
    console.log(`\n[가정: 사용자가 말한 8강 순서 + 앱 연결 규칙]\n${sf.map(label).join('\n')}`)
    expect(sf.map((m) => [n(m.playerAMemberId), n(m.playerBMemberId)])).toEqual([[15, 7], [3, 2]])
  })
})

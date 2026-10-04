import { describe, it, expect } from 'vitest'
import {
  analyzeRestartSource, buildRestartBracket, pendingRestartJoins, restartFirstRoundStatus,
} from '../src/logic/tournamentRestartBracket'
import { calculateFinalPlacements } from '../src/logic/tournamentMatch'
import type { TournamentMatch } from '../src/types/tournament'
import { decideRound, fillJoiner, mainOf, seededRng } from './fixtures/restartMain'

// 인원별 일반화 테스트 — 특정 인원 특례 없이 "대진 규모·부전승·생존자·합류자" 관계로 동작하는지 확인한다.
// 가상 데이터만 사용한다.

const SRC = 'main'

interface Row {
  bracket: number; mainByes: number; mainReal: number; losers: number
  restartBracket?: number; restartByes?: number; restartReal?: number; survivors?: number
  joiners: number; total?: number; ok: boolean
}

/** 보고서 표와 같은 기대값(9~16명 + 8명). 구조 성립 조건: n > 3P/4. */
const TABLE: Record<number, Row> = {
  8: { bracket: 8, mainByes: 0, mainReal: 4, losers: 4, restartBracket: 4, restartByes: 0, restartReal: 2, survivors: 2, joiners: 2, total: 4, ok: true },
  9: { bracket: 16, mainByes: 7, mainReal: 1, losers: 1, joiners: 4, ok: false },
  10: { bracket: 16, mainByes: 6, mainReal: 2, losers: 2, joiners: 4, ok: false },
  11: { bracket: 16, mainByes: 5, mainReal: 3, losers: 3, joiners: 4, ok: false },
  12: { bracket: 16, mainByes: 4, mainReal: 4, losers: 4, joiners: 4, ok: false },
  13: { bracket: 16, mainByes: 3, mainReal: 5, losers: 5, restartBracket: 8, restartByes: 3, restartReal: 1, survivors: 4, joiners: 4, total: 8, ok: true },
  14: { bracket: 16, mainByes: 2, mainReal: 6, losers: 6, restartBracket: 8, restartByes: 2, restartReal: 2, survivors: 4, joiners: 4, total: 8, ok: true },
  15: { bracket: 16, mainByes: 1, mainReal: 7, losers: 7, restartBracket: 8, restartByes: 1, restartReal: 3, survivors: 4, joiners: 4, total: 8, ok: true },
  16: { bracket: 16, mainByes: 0, mainReal: 8, losers: 8, restartBracket: 8, restartByes: 0, restartReal: 4, survivors: 4, joiners: 4, total: 8, ok: true },
}

function analyze(n: number, seed = 1) {
  const main = mainOf(n)
  const decided = decideRound(main, 1)
  const first = main.filter((m) => m.roundNumber === 1)
  const second = main.filter((m) => m.roundNumber === 2)
  const status = (() => {
    const a = analyzeRestartSource(decided)
    return a.ok ? restartFirstRoundStatus(a.value) : null
  })()
  const analysis = analyzeRestartSource(decided)
  let built: TournamentMatch[] | null = null
  if (analysis.ok) {
    const r = buildRestartBracket({
      sourceTournamentId: SRC, analysis: analysis.value, sourceMatches: decided, rng: seededRng(seed),
      entrants: status!.losers.map((l) => ({ participantId: l.memberId, memberId: l.memberId, handicap: 20 })),
    })
    if (!r.ok) throw new Error(r.message)
    built = r.value.matches
  }
  return { main, decided, first, second, status, analysis, built }
}

/** 리스타트를 결승까지 진행해 우승자를 돌려준다. */
function playThrough(decidedMain: TournamentMatch[], restart: TournamentMatch[]) {
  let matches = decideRound(restart, 1)
  for (const j of pendingRestartJoins(matches, decideRound(decidedMain, 2))) {
    matches = fillJoiner(matches, j.restartMatchId, Number(j.memberId.slice(1)))
  }
  const last = Math.max(...matches.map((m) => m.roundNumber))
  for (let r = 2; r <= last; r++) matches = decideRound(matches, r)
  return { matches, champion: calculateFinalPlacements(matches).championParticipantId }
}

describe('9~16명(+8명) 계산표 — 본선·리스타트 구조', () => {
  for (const [nText, row] of Object.entries(TABLE)) {
    const n = Number(nText)
    it(`${n}명: 본선 ${row.bracket}칸·부전승 ${row.mainByes}, 1차 패자 ${row.losers} → ${row.ok ? '구조 성립' : '구조 불성립(만들지 않음)'}`, () => {
      const { first, second, decided, analysis, built } = analyze(n)
      expect(first.length * 2).toBe(row.bracket)
      expect(first.filter((m) => m.resultType === 'bye')).toHaveLength(row.mainByes)
      expect(first.filter((m) => m.resultType !== 'bye')).toHaveLength(row.mainReal)
      expect(decided.filter((m) => m.roundNumber === 1 && m.officialLoserParticipantId)).toHaveLength(row.losers)
      expect(second).toHaveLength(row.joiners)
      expect(analysis.ok).toBe(row.ok)
      if (!row.ok) return

      const r1 = built!.filter((m) => m.roundNumber === 1)
      expect(r1.length * 2).toBe(row.restartBracket)
      expect(r1.filter((m) => m.resultType === 'bye')).toHaveLength(row.restartByes!)
      expect(r1.filter((m) => m.resultType === 'normal')).toHaveLength(row.restartReal!)
      // 리스타트 1차가 끝나면 다음 단계 A 자리(생존자)가 모두 차고, B 자리(합류) 수와 같다
      const afterR1 = decideRound(built!, 1).filter((m) => m.roundNumber === 2)
      expect(afterR1.filter((m) => m.playerAParticipantId)).toHaveLength(row.survivors!)
      expect(afterR1.filter((m) => m.playerBJoinFrom)).toHaveLength(row.joiners)
      expect(row.survivors! + row.joiners).toBe(row.total)
      expect(playThrough(decided, built!).champion).not.toBeNull()
    })
  }
})

describe('같은 공식이 다른 규모에도 그대로 적용된다(인원 특례 없음)', () => {
  // 성립 조건: n > 3P/4 (P = 본선 대진 규모). 8칸: 7~8명, 16칸: 13~16명, 32칸: 25~32명.
  const supported = (n: number) => {
    let p = 2
    while (p < n) p *= 2
    return p >= 8 && n > (3 * p) / 4
  }

  for (let n = 5; n <= 32; n++) {
    it(`${n}명: ${supported(n) ? '자동 생성 → 결승까지 진행' : '이유를 알려 주고 만들지 않음'}`, () => {
      const { decided, analysis, built, status } = analyze(n, n)
      expect(analysis.ok).toBe(supported(n))
      if (!analysis.ok) {
        expect(analysis.message).toMatch(/맞지 않아/)
        return
      }
      const a = analysis.value
      // 리스타트 자리 = 대상 이상인 가장 작은 2의 거듭제곱, 부전승 = 자리 − 대상
      let size = 2
      while (size < a.entrantCount) size *= 2
      expect(a.w * 2).toBe(size)
      expect(a.restartByeCount).toBe(size - a.entrantCount)
      const r1 = built!.filter((m) => m.roundNumber === 1)
      // 한 경기에 부전승은 하나뿐 — 빈 경기가 없다
      expect(r1.every((m) => m.playerAParticipantId)).toBe(true)
      expect(r1.filter((m) => m.resultType === 'bye')).toHaveLength(a.restartByeCount)
      // 대상자는 한 번씩만 들어간다
      const ids = r1.flatMap((m) => [m.playerAMemberId, m.playerBMemberId]).filter(Boolean)
      expect(new Set(ids).size).toBe(status!.losers.length)
      expect(playThrough(decided, built!).champion).not.toBeNull()
    })
  }
})

describe('다중 부전승 · 본선 부전승 선수 제외', () => {
  it('13명: 리스타트 부전승 3명은 서로 다른 경기에 배정되고, 대진을 만들 때 이미 다음 단계 A 자리로 진출한다', () => {
    const { built } = analyze(13, 3)
    const byes = built!.filter((m) => m.roundNumber === 1 && m.resultType === 'bye')
    expect(byes).toHaveLength(3)
    expect(new Set(byes.map((m) => m.id)).size).toBe(3)
    for (const bye of byes) {
      expect(bye).toMatchObject({ status: 'official', officialLoserParticipantId: null, playerBParticipantId: null })
      const next = built!.find((m) => m.id === bye.nextMatchId)!
      expect(next.playerAParticipantId).toBe(bye.officialWinnerParticipantId)
    }
  })

  it('누가 부전승인지는 추첨으로 정해진다(난수가 다르면 다른 사람이 받는다)', () => {
    const recipients = new Set<string>()
    for (let seed = 1; seed <= 30; seed++) {
      for (const m of analyze(14, seed).built!.filter((x) => x.roundNumber === 1 && x.resultType === 'bye')) {
        recipients.add(m.playerAMemberId!)
      }
    }
    expect(recipients.size).toBeGreaterThan(2)
  })

  it('본선에서 부전승으로 올라간 선수는 어떤 인원에서도 리스타트 대상이 아니다', () => {
    for (const n of [13, 14, 15, 25, 31]) {
      const { main, status } = analyze(n)
      const mainByePlayers = main.filter((m) => m.roundNumber === 1 && m.resultType === 'bye')
        .map((m) => m.playerAMemberId ?? m.playerBMemberId)
      const losers = status!.losers.map((l) => l.memberId)
      for (const p of mainByePlayers) expect(losers).not.toContain(p)
    }
  })

  it('같은 입력·같은 난수면 부전승 배정까지 똑같다(새로고침·다른 기기에서도 저장된 대진을 그대로 봄)', () => {
    expect(analyze(13, 21).built).toEqual(analyze(13, 21).built)
  })
})

import { describe, it, expect } from 'vitest'
import { findRestartTarget, normalizeTournamentName, restartTournamentName } from '../src/logic/tournamentRestart'
import { restartJoinRows } from '../src/logic/tournamentRestartBracket'
import { analyzeRestartSource, buildRestartBracket } from '../src/logic/tournamentRestartBracket'
import type { Tournament } from '../src/types/tournament'
import { decide, decideRound, fillJoiner, fullMain, seededRng } from './fixtures/restartMain'

// 가상 데이터만 사용한다 — 실제 대회명·회원 정보가 아니다.

const named = (id: string, name: string, date = '2026-10-05'): Tournament => ({
  id, name, date, timeLimitMinutes: 50, status: 'draft', createdAt: '2026-10-01T00:00:00.000Z',
})

describe('findRestartTarget — 리스타트 대회 자동 결정', () => {
  const main = named('main', '제28차 부산동문회장배')

  it('이름 규칙: 본선 이름 + " 리스타트전" (앞뒤·중복 공백은 정리)', () => {
    expect(restartTournamentName('제28차 부산동문회장배')).toBe('제28차 부산동문회장배 리스타트전')
    expect(restartTournamentName('  제28차   부산동문회장배  ')).toBe('제28차 부산동문회장배 리스타트전')
    expect(normalizeTournamentName(' a   b ')).toBe('a b')
  })

  it('이름이 정확히 같은 다른 대회를 찾는다(이름 공백 차이는 정리해서 비교)', () => {
    const r = findRestartTarget(main, [main, named('x', '제28차 부산동문회장배 리스타트'), named('r', '제28차  부산동문회장배 리스타트전 ')])
    expect(r).toMatchObject({ kind: 'found', tournament: { id: 'r' } })
  })

  it('이름이 다른 대회는 "리스타트"가 들어 있어도 고르지 않고, 만들라고 안내한다', () => {
    const r = findRestartTarget(main, [main, named('x', '리스타트전'), named('y', '제28차 부산동문회장배 리스타트')])
    expect(r).toEqual({
      kind: 'missing', expectedName: '제28차 부산동문회장배 리스타트전',
      message: "'제28차 부산동문회장배 리스타트전' 대회를 먼저 만들어 주세요.",
    })
  })

  it('현재 대회 자신은 대상이 아니다', () => {
    const self = named('main', '제28차 부산동문회장배 리스타트전')
    expect(findRestartTarget(self, [self]).kind).toBe('missing')
  })

  it('같은 이름이 둘 이상이면 같은 날짜 대회를 우선하고, 그래도 둘 이상이면 고르지 않고 중단한다', () => {
    const a = named('a', '제28차 부산동문회장배 리스타트전', '2026-04-18')
    const b = named('b', '제28차 부산동문회장배 리스타트전', '2026-10-05')
    expect(findRestartTarget(main, [main, a, b])).toMatchObject({ kind: 'found', tournament: { id: 'b' } })
    const r = findRestartTarget(main, [main, a, b, named('c', '제28차 부산동문회장배 리스타트전', '2026-10-05')])
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.message).toContain('같은 이름의 리스타트 대회가 여러 개 있습니다')
  })

  it('지정한 실제 형태: 본선 "제28차 부산동문회장배"(2026-10-05) + 리스타트 대회(draft, 같은 날짜) → 정확히 1건', () => {
    const m = named('m', '제28차 부산동문회장배', '2026-10-05')
    const r = named('r', '제28차 부산동문회장배 리스타트전', '2026-10-05')
    expect(findRestartTarget(m, [m, r])).toEqual({ kind: 'found', tournament: r })
  })

  it('글자 구성 차이(앞뒤·연속·전각·줄바꿈 없는 공백, 자모 분리형, 보이지 않는 문자)는 같은 이름으로 본다', () => {
    const m = named('m', '제28차 부산동문회장배')
    const variants = [
      '제28차 부산동문회장배 ', '제28차  부산동문회장배', '제28차　부산동문회장배', '제28차 부산동문회장배',
      '제28차 부산동문회장배'.normalize('NFD'), '제28차 ​부산동문회장배', '﻿제28차 부산동문회장배',
    ]
    for (const v of variants) {
      expect(findRestartTarget(m, [m, named('r', `${v} 리스타트전`)]).kind, JSON.stringify(v)).toBe('found')
      expect(findRestartTarget({ ...m, name: v }, [m, named('r', '제28차 부산동문회장배 리스타트전')]).kind, JSON.stringify(v)).toBe('found')
    }
  })

  it('느슨하게 맞추지 않는다: 다른 단어·순서·띄어쓰기 위치·접미사가 다르면 다른 이름이다', () => {
    const m = named('m', '제28차 부산동문회장배')
    for (const other of ['제28차 부산동문회장배 리스타트', '제28차 부산동문회장배리스타트전', '제27차 부산동문회장배 리스타트전',
      '리스타트전 제28차 부산동문회장배', '제28차 부산동문회장배 리스타트전 2']) {
      expect(findRestartTarget(m, [m, named('r', other)]).kind, other).toBe('missing')
    }
  })

  it('날짜가 달라도 이름이 맞는 대회가 하나뿐이면 연결된다', () => {
    const m = named('m', '제28차 부산동문회장배', '2026-10-05')
    expect(findRestartTarget(m, [m, named('r', '제28차 부산동문회장배 리스타트전', '2026-10-06')]).kind).toBe('found')
  })

  it('찾는 이름은 실패 결과에도 들어 있어 화면에 보여 줄 수 있다', () => {
    const m = named('m', '제28차 부산동문회장배')
    const r = findRestartTarget(m, [m])
    expect(r.kind === 'missing' && r.expectedName).toBe('제28차 부산동문회장배 리스타트전')
  })

  it('없으면 대회를 먼저 만들라고만 안내하고, 새 대회를 만들지 않는다(순수 판정)', () => {
    expect(findRestartTarget(main, [main]).kind).toBe('missing')
  })
})

describe('restartJoinRows — 본선 8강 탈락자 합류 현황', () => {
  const mainR1 = decideRound(fullMain(16), 1)
  const analysis = (() => { const a = analyzeRestartSource(mainR1); if (!a.ok) throw new Error(a.message); return a.value })()
  const restart = (() => {
    const b = buildRestartBracket({
      sourceTournamentId: 'main', analysis, sourceMatches: mainR1, rng: seededRng(2),
      entrants: [2, 4, 6, 8, 10, 12, 14, 16].map((n) => ({ participantId: `m${n}`, memberId: `m${n}`, handicap: 20 })),
    })
    if (!b.ok) throw new Error(b.message)
    return b.value.matches
  })()
  const rows = (main: typeof mainR1, r?: typeof restart) => restartJoinRows(analyzeRestartSource(main).ok ? (analyzeRestartSource(main) as { ok: true; value: typeof analysis }).value.secondRound : [], r)

  it('승인 전: 4경기 모두 "승인 대기"(패자 없음)', () => {
    expect(rows(mainR1, restart).map((r) => r.status)).toEqual(['pending', 'pending', 'pending', 'pending'])
    expect(rows(mainR1, restart).every((r) => r.loserParticipantId === null)).toBe(true)
  })

  it('승인된 경기의 패자는 "합류 대기", 예약 자리에 배치되면 "합류 완료"', () => {
    const one = decide(mainR1, 'r2m1')
    expect(rows(one, restart).map((r) => r.status)).toEqual(['waiting', 'pending', 'pending', 'pending'])
    expect(rows(one, undefined)[0].status).toBe('waiting') // 리스타트 대진이 아직 없어도 패자는 합류 대기
    expect(rows(one, fillJoiner(restart, 'r2m1', 3))[0].status).toBe('joined')
  })

  it('다른 사람이 그 자리에 들어가 있으면 "합류 완료"로 치지 않는다', () => {
    const one = decide(mainR1, 'r2m1')
    expect(rows(one, fillJoiner(restart, 'r2m1', 9))[0].status).toBe('waiting')
  })

  it('모든 8강 패자가 확정·배치되면 4명 모두 "합류 완료"', () => {
    const all = decideRound(mainR1, 2)
    let r = restart
    for (const row of rows(all, restart)) r = fillJoiner(r, `r2m${row.matchNumber}`, Number(row.loserParticipantId!.slice(1)))
    expect(rows(all, r).map((x) => x.status)).toEqual(['joined', 'joined', 'joined', 'joined'])
  })
})

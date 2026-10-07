import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'

// ─────────────────────────────────────────────────────────────────────────────
// "제2회 부산동문회장배" 전체 경기 시뮬레이션 — 본선 15명 + 리스타트 7명(+합류 4명)의 실제 확정 결과를 처음부터 끝까지.
//
// 운영 Firestore는 읽지도 쓰지도 않는다. 대신 tests/fixtures/fakeFirestore.ts(메모리 속 가짜 저장소) 위에서
// 앱의 진짜 동기화 코드(lib/tournamentSync.ts)와 진짜 대회 화면(TournamentTab)을 그대로 통과시킨다:
//   점수 입력(선수) → 상대 확인(선수) → 관리자 최종 승인(화면의 "최종 승인" 버튼) → official → 다음 라운드/리스타트 전이.
// 회원 실명은 저장소에 두지 않는다 — 선수 n은 "가상선수NN"이고 핸디·점수·대진 구조만 실제 대회와 같다.
// ─────────────────────────────────────────────────────────────────────────────

// 화면(관리자 한 명이 한 번 연 대회 화면)을 시나리오 끝까지 유지한다 — 실제 사용처럼 같은 화면에서 계속 진행해야
// "화면에 들고 있는 목록이 오래된 경우" 같은 문제가 재현된다. 그래서 테스트마다 자동으로 화면을 치우는 기능을 끈다.
vi.hoisted(() => { process.env.RTL_SKIP_AUTO_CLEANUP = 'true' })

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>()
  const { firestoreFake } = await import('./fixtures/fakeFirestore')
  return { ...actual, ...firestoreFake }
})

import { TournamentTab } from '../src/tabs/TournamentTab'
import {
  confirmTournamentBracket, confirmTournamentEntries, createMissingParticipants, createTournament, fetchTournaments,
  fetchTournamentParticipants, finishTournament, prepareTournamentDraw, saveTournamentDrawMapping, saveTournamentDrawNumbers,
  setParticipantEntryStatus, submitTournamentMatchResult, verifyTournamentMatchResult,
} from '../src/lib/tournamentSync'
import { buildEmptyBracket, buildTournamentMatches } from '../src/logic/tournamentBracket'
import { buildSeatsFromDraw } from '../src/logic/tournamentDraw'
import { calculateFinalPlacements } from '../src/logic/tournamentMatch'
import { findRestartTarget, restartTournamentId } from '../src/logic/tournamentRestart'
import { roundLabel } from '../src/components/tournament/tournamentDisplay'
import { useApp } from '../src/store/appStore'
import { useAuth } from '../src/store/authStore'
import { useAdmin } from '../src/store/adminStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import { rawGet, rawList, resetFakeFirestore, writeLog } from './fixtures/fakeFirestore'
import { seededRng } from './fixtures/restartMain'
import type { Member } from '../src/types'
import type { Tournament, TournamentMatch, TournamentParticipant } from '../src/types/tournament'

const CLUB = 'skkubc'
const MAIN = 'sim-main'
const RESTART = restartTournamentId(MAIN) // restart-sim-main
const MAIN_NAME = '제2회 부산동문회장배 당구대회'
const RESTART_NAME = `${MAIN_NAME} 리스타트전`
/** 이 시드로 리스타트 대진을 만들면 실제 대회와 같은 1차전·합류 대진이 나온다(tests 위쪽 설명 참고). */
const RESTART_SEED = 762

// 선수 n → 이름·본선 핸디. (실제 대회 15명과 핸디가 같다. 4번·8번 선수는 리스타트 직전 핸디가 바뀐 상태 — 아래 참고)
const HANDICAP: Record<number, number> = { 1: 25, 2: 17, 3: 18, 4: 18, 5: 13, 6: 17, 7: 10, 8: 13, 9: 23, 10: 15, 11: 15, 12: 21, 13: 20, 14: 14, 15: 10, 16: 20, 17: 20, 18: 20 }
const mid = (n: number) => `m${String(n).padStart(2, '0')}`
const nm = (n: number) => `가상선수${String(n).padStart(2, '0')}`
const mkMembers = (override: Record<number, number> = {}): Member[] => Array.from({ length: 18 }, (_, i) => {
  const n = i + 1
  const handicap = override[n] ?? HANDICAP[n]
  return { id: mid(n), name: nm(n), handicap, handicapHistory: [{ value: handicap, changedAt: '2026-01-01T00:00:00.000Z' }], active: true }
})

const mPath = (tid: string) => `clubs/${CLUB}/tournaments/${tid}/matches`
const getMatches = (tid: string) => rawList(mPath(tid)).map(({ __id, ...rest }) => { void __id; return rest as unknown as TournamentMatch })
const getParticipants = (tid: string) => rawList(`clubs/${CLUB}/tournaments/${tid}/participants`).map(({ __id, ...rest }) => { void __id; return rest as unknown as TournamentParticipant })
const getTournaments = () => rawList(`clubs/${CLUB}/tournaments`).map(({ __id, ...rest }) => { void __id; return rest as unknown as Tournament })
const matchOf = (tid: string, id: string) => rawGet(`${mPath(tid)}/${id}`) as unknown as TournamentMatch

let clock = Date.parse('2026-10-06T01:00:00.000Z')
const at = () => new Date((clock += 60_000)).toISOString()

// 실제 확정 결과: [승자 n, 승자 점수, 패자 n, 패자 점수]
type R = [number, number, number, number]
const MAIN_R1: R[] = [[1, 25, 2, 13], [3, 18, 4, 13], [5, 9, 6, 7], [7, 7, 8, 6], [9, 22, 10, 8], [11, 15, 12, 18], [13, 17, 14, 5]]
const MAIN_QF: R[] = [[1, 25, 3, 6], [5, 13, 7, 6], [9, 23, 11, 1], [13, 17, 15, 8]]
const MAIN_SF: R[] = [[1, 24, 5, 7], [9, 17, 13, 12]]
const MAIN_3RD: R[] = [[13, 20, 5, 7]]
const MAIN_FINAL: R[] = [[1, 25, 9, 11]]
const RS_R1: R[] = [[6, 17, 8, 9], [10, 11, 4, 9], [14, 14, 12, 5]]
const RS_R2: R[] = [[15, 7, 6, 5], [7, 6, 10, 8], [3, 18, 14, 8], [2, 17, 11, 8]]
// 참고: 실제 대회의 리스타트는 앱에서 열리지 않아 앱 밖에서 진행했다 — 실제 8강 경기 번호·4강 슬롯은 자동 대진의 검증 기준이 아니다(승패·점수만 기록으로 유지).
// 여기서는 앱이 만든 4강 대진(3v7, 2v15)대로 진행하고 4강·결승 점수만 가상으로 둔다.
const RS_SF: R[] = [[7, 10, 3, 4], [2, 17, 15, 6]]
const RS_FINAL: R[] = [[2, 17, 7, 2]]

// ── 화면·진행 도우미 ────────────────────────────────────────────────

function asAdmin() {
  useAdmin.setState({ isAdmin: true })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'uid-admin', email: null, adminDisplayName: null, errorMessage: null })
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
}
async function settle(times = 4) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}
async function openTournamentInUi(name: string) {
  const back = screen.queryByText('← 대회 목록')
  if (back) fireEvent.click(back)
  fireEvent.click(await screen.findByText(name))
  await screen.findByText('← 대회 목록')
  await settle()
}
function clickRound(count: number) {
  const label = roundLabel(count)
  const btn = screen.getAllByRole('button').find((b) => (b.textContent ?? '').replace('✅ ', '') === label)
  if (!btn) throw new Error(`라운드 탭을 찾을 수 없습니다: ${label}`)
  fireEvent.click(btn)
}
function matchCard(nameA: string, nameB: string): HTMLElement {
  const card = screen.getAllByRole('button').find((b) => b.getAttribute('role') === 'button' && (b.textContent ?? '').includes('경기')
    && (b.textContent ?? '').includes(nameA) && (b.textContent ?? '').includes(nameB))
  if (!card) throw new Error(`경기 카드를 찾을 수 없습니다: ${nameA} vs ${nameB}`)
  return card
}

/** 두 선수가 맞붙는 경기를 서버에서 찾는다(선수 번호로). */
function findMatch(tid: string, a: number, b: number): TournamentMatch {
  const m = getMatches(tid).find((x) => [x.playerAMemberId, x.playerBMemberId].sort().join() === [mid(a), mid(b)].sort().join())
  if (!m) throw new Error(`${tid}에 ${nm(a)} vs ${nm(b)} 경기가 없습니다.`)
  return m
}

/**
 * 실제 앱 순서 그대로 한 경기를 진행한다:
 *  ① 선수 A가 점수 입력(submit) → ② 선수 B가 "결과가 맞습니다"(verify) → ③ 관리자 화면에서 "최종 승인" 클릭.
 * ①②는 선수 휴대폰에서 일어나는 일이라 동기화 함수를 직접 부르고, ③은 관리자 화면(TournamentTab)을 실제로 누른다.
 */
async function playMatch(tid: string, [w, ws, l, ls]: R, via: 'ui' | 'sync' = 'ui') {
  const m = findMatch(tid, w, l)
  const wIsA = m.playerAMemberId === mid(w)
  const scoreA = wIsA ? ws : ls
  const scoreB = wIsA ? ls : ws
  await submitTournamentMatchResult(tid, m.id, { byMemberId: m.playerAMemberId!, scoreA, scoreB, at: at() }, CLUB)
  await verifyTournamentMatchResult(tid, m.id, { byMemberId: m.playerBMemberId!, at: at() }, CLUB)
  expect(matchOf(tid, m.id).status).toBe('awaitingApproval') // 아직 공식 결과가 아니다
  if (via === 'ui') {
    clickRound(m.playerCountInRound)
    await settle()
    fireEvent.click(matchCard(nm(w), nm(l)))
    fireEvent.click(await screen.findByText('최종 승인'))
  }
  await waitFor(() => expect(matchOf(tid, m.id).status).toBe('official'), { timeout: 4000 })
  await settle()
  const done = matchOf(tid, m.id)
  expect(done.officialWinnerParticipantId).toBe(mid(w))
  expect(done.officialLoserParticipantId).toBe(mid(l))
  return done
}

/** 경기 목록을 비교하기 쉬운 문자열로: "r1m1 가상선수01 25/25 vs 가상선수02 13/17 → 가상선수01". */
function describeMatch(m: TournamentMatch): string {
  const side = (member: string | null, score: number | null, h: number | null) => (member ? `${nm(Number(member.slice(1)))} ${score ?? '-'}/${h ?? '-'}` : '(비어있음)')
  const win = m.officialWinnerParticipantId ? nm(Number(m.officialWinnerParticipantId.slice(1))) : '-'
  return `${m.id} ${side(m.playerAMemberId, m.scoreA, m.playerAHandicapSnapshot)} vs ${side(m.playerBMemberId, m.scoreB, m.playerBHandicapSnapshot)} → ${win}`
}

// ── 시나리오 ────────────────────────────────────────────────────────

beforeAll(() => {
  resetFakeFirestore()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterAll(() => { cleanup(); vi.restoreAllMocks() })

describe('제2회 부산동문회장배 — 본선 → 리스타트 전체 시뮬레이션', () => {
  let mainStaleSnapshot = ''
  let restartAfterCreate: TournamentMatch[] = []

  it('0. 준비: 대회 생성 → 참가자 15명 → 추첨 → 대진 확정(15명·부전승 1명·3·4위전 포함)', async () => {
    useApp.setState({ members: mkMembers() })
    const tournament: Tournament = { id: MAIN, name: MAIN_NAME, date: '2026-10-06', timeLimitMinutes: 50, status: 'draft', createdAt: at() }
    await createTournament(tournament, CLUB)
    await createMissingParticipants(MAIN, mkMembers().filter((m) => m.active), CLUB)
    expect(getParticipants(MAIN)).toHaveLength(18)
    for (let n = 1; n <= 15; n++) await setParticipantEntryStatus(MAIN, mid(n), 'entered', CLUB)
    expect(getParticipants(MAIN).filter((p) => p.entryStatus === 'entered')).toHaveLength(15)

    await confirmTournamentEntries(MAIN, 15, CLUB)
    await prepareTournamentDraw(MAIN, 15, CLUB) // 앱이 실제로 하는 추첨 준비(무작위)
    // 실제 대회와 같은 자리가 되도록 추첨 매핑·번호만 정해 둔 값으로 덮어쓴다(번호 n = 자리 n, 16번 자리 부전승).
    const mapping = { bracketSize: 16, byeSlots: [16], numberToSlot: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i + 1, i + 1])) }
    await saveTournamentDrawMapping(MAIN, mapping, CLUB)
    const entered = (await fetchTournamentParticipants(MAIN, CLUB)).filter((p) => p.entryStatus === 'entered')
    const entries = entered.map((p) => ({ participantId: p.id, drawNumber: Number(p.memberId.slice(1)) }))
    await saveTournamentDrawNumbers(MAIN, entered, entries, CLUB)

    const bracket = buildEmptyBracket(16, { includeThirdPlace: true })
    if (!bracket.ok) throw new Error(bracket.message)
    const seats = buildSeatsFromDraw(entered, entries, mapping)
    if (!seats.ok) throw new Error(seats.message)
    const built = buildTournamentMatches(bracket.value, seats.value)
    if (!built.ok) throw new Error(built.message)
    await confirmTournamentBracket(MAIN, built.value, { bracketSize: 16, at: at() }, CLUB)

    expect(getTournaments().map((t) => t.id)).toEqual([MAIN]) // 이 시점에는 대회가 하나뿐 — 리스타트는 아직 없다
    const ms = getMatches(MAIN)
    expect(ms.filter((m) => m.playerCountInRound === 16)).toHaveLength(8)
    expect(ms.filter((m) => m.playerCountInRound === 3)).toHaveLength(1) // 3·4위전
    const bye = ms.find((m) => m.resultType === 'bye')!
    expect(bye.officialWinnerParticipantId).toBe(mid(15)) // 15번 자리 선수가 본선 1차 부전승
    // 실제 대회의 예선 대진 그대로: (1-2)(3-4)(5-6)(7-8)(9-10)(11-12)(13-14)(15 부전승)
    expect(getMatches(MAIN).filter((m) => m.roundNumber === 1).sort((a, b) => a.matchNumber - b.matchNumber)
      .map((m) => [m.playerAMemberId, m.playerBMemberId].map((x) => (x ? Number(x.slice(1)) : 0)).join('-')))
      .toEqual(['1-2', '3-4', '5-6', '7-8', '9-10', '11-12', '13-14', '15-0'])
  })

  it('1. 화면(관리자): 본선 열기 → 예선 7경기를 입력·확인·최종 승인 — 리스타트는 아직 없다', async () => {
    asAdmin()
    render(<TournamentTab archivedTournaments={[]} />)
    await openTournamentInUi(MAIN_NAME)
    for (const r of MAIN_R1) await playMatch(MAIN, r)
    // 본선 1차 7경기 official → 승자는 8강 자리에 올라갔다
    expect(findMatch(MAIN, 1, 3).id).toBe('r2m1')
    expect(findMatch(MAIN, 13, 15).id).toBe('r2m4') // 부전승 15번이 8강 4경기 B 자리에서 13번을 기다리고 있었다
    // 리스타트 대회는 아직 만들어지지 않았다(패널을 열기 전에는 자동 생성하지 않는다)
    expect(getTournaments().map((t) => t.id)).toEqual([MAIN])
    expect(rawGet(`clubs/${CLUB}/tournaments/${RESTART}`)).toBeUndefined()
  })

  it('2. 리스타트 준비·대진 생성(화면): 대회 1개만 생성, 고정 ID, 본선과 연결, 1차 탈락자 7명 편입, 합류 자리는 대기(부전승 아님)', async () => {
    // 리스타트 직전에 두 선수의 핸디가 바뀌어 있었다(실제 결과: 4번 9/20, 8번 9/10) — 회원 핸디를 그 값으로.
    useApp.setState({ members: mkMembers({ 4: 20, 8: 10 }) })
    fireEvent.click(screen.getByText('리스타트 참가자 보내기')) // 패널을 열면 리스타트 대회를 준비한다(없으면 고정 ID로 1번만 생성)
    await screen.findByText('리스타트 대진 자동 생성')
    await waitFor(() => expect(rawGet(`clubs/${CLUB}/tournaments/${RESTART}`)).toBeTruthy())
    expect(getTournaments().filter((t) => t.id.startsWith('restart-'))).toHaveLength(1)
    expect(rawGet(`clubs/${CLUB}/tournaments/${RESTART}`)).toMatchObject({ id: RESTART, name: RESTART_NAME, status: 'draft' })

    const button = screen.getByText('리스타트 대진 자동 생성').closest('button')!
    await waitFor(() => expect(button).not.toBeDisabled())
    // 대진은 무작위로 정해진다 — 실제 대회와 같은 대진이 나오는 난수로 고정하고, 한 번만 누른다.
    const random = vi.spyOn(Math, 'random').mockImplementation(seededRng(RESTART_SEED))
    fireEvent.click(button)
    await waitFor(() => expect(getMatches(RESTART)).toHaveLength(11), { timeout: 4000 })
    await settle()
    random.mockRestore()

    // 대회·연결
    const ts = getTournaments()
    expect(ts.filter((t) => t.id.startsWith('restart-'))).toHaveLength(1) // 중복 restart 없음
    expect(ts).toHaveLength(2)
    expect(rawGet(`clubs/${CLUB}/tournaments/${RESTART}`)).toMatchObject({ status: 'bracketFixed', bracketSize: 16, participantCount: 7, restartSourceTournamentId: MAIN })
    expect(findRestartTarget(ts.find((t) => t.id === MAIN)!, ts)).toMatchObject({ kind: 'found', tournament: { id: RESTART } })
    // 1차 탈락자 7명만 리스타트 참가자로(핸디: 바뀐 값 그대로)
    const ps = getParticipants(RESTART)
    expect(ps.filter((p) => p.entryStatus === 'entered').map((p) => p.memberId).sort()).toEqual([2, 4, 6, 8, 10, 12, 14].map(mid))
    expect(ps.find((p) => p.memberId === mid(4))!.tournamentHandicap).toBe(20)
    expect(ps.find((p) => p.memberId === mid(8))!.tournamentHandicap).toBe(10)
    // 대진: 실제 대회와 같다 — 1차 (6-8)(10-4)(14-12) + 2번 부전승 / 2차는 합류 자리를 기다리는 4경기
    const ms = getMatches(RESTART)
    const r1 = ms.filter((m) => m.roundNumber === 1)
    const pairKey = (m: TournamentMatch) => [m.playerAMemberId, m.playerBMemberId].filter(Boolean).map((x) => Number(x!.slice(1))).sort((a, b) => a - b).join('-')
    expect(r1.map(pairKey).sort()).toEqual(['4-10', '12-14', '2', '6-8'].sort())
    const feeds = (members: number[]) => r1.find((m) => members.every((n) => [m.playerAMemberId, m.playerBMemberId].includes(mid(n))))!.nextMatchId
    expect(feeds([14, 12])).toBe('r2m1'); expect(feeds([10, 4])).toBe('r2m2'); expect(feeds([2])).toBe('r2m3'); expect(feeds([6, 8])).toBe('r2m4')
    // 합류 자리: 본선 8강 1~4경기 패자 자리로 예약, 비어 있음, 부전승이 아니다
    for (const n of [1, 2, 3, 4]) {
      const slot = matchOf(RESTART, `r2m${n}`)
      expect(slot.playerBJoinFrom).toEqual({ tournamentId: MAIN, matchId: `r2m${n}` })
      expect(slot.playerBParticipantId).toBeNull()
      expect(slot.resultType).toBe('normal')
      expect(slot.status).toBe('awaitingResult')
    }
    // 부전승은 리스타트 1차전의 2번 하나뿐
    expect(ms.filter((m) => m.resultType === 'bye').map((m) => m.officialWinnerParticipantId)).toEqual([mid(2)])
    restartAfterCreate = getMatches(RESTART)
    mainStaleSnapshot = JSON.stringify(restartAfterCreate.map((m) => describeMatch(m)))
  })

  it('3. 리스타트 예선 3경기(화면에서 리스타트 대회를 열어 진행) — 승자가 다음 단계에 유지된다', async () => {
    await openTournamentInUi(RESTART_NAME)
    for (const r of RS_R1) await playMatch(RESTART, r)
    // 1차 승자가 2차 A 자리로: r2m1←14, r2m2←10, r2m3←2(부전승), r2m4←6
    expect(matchOf(RESTART, 'r2m1').playerAMemberId).toBe(mid(14))
    expect(matchOf(RESTART, 'r2m2').playerAMemberId).toBe(mid(10))
    expect(matchOf(RESTART, 'r2m3').playerAMemberId).toBe(mid(2))
    expect(matchOf(RESTART, 'r2m4').playerAMemberId).toBe(mid(6))
    // 합류 자리는 아직 본선 8강 결과가 없으므로 비어 있고 부전승 처리도 되지 않았다
    for (const n of [1, 2, 3, 4]) expect(matchOf(RESTART, `r2m${n}`).playerBParticipantId).toBeNull()
    // 대진이 다시 섞이지 않았다: 1차 구성은 생성 직후와 같다(승인 결과만 늘었다)
    const nowR1 = getMatches(RESTART).filter((m) => m.roundNumber === 1).map((m) => m.playerAMemberId + '|' + m.playerBMemberId).sort()
    const thenR1 = restartAfterCreate.filter((m) => m.roundNumber === 1).map((m) => m.playerAMemberId + '|' + m.playerBMemberId).sort()
    expect(nowR1).toEqual(thenR1)
    expect(mainStaleSnapshot).toBeTruthy()
  })

  it('4. 본선 8강 4경기를 하나씩 최종 승인 — 패자가 리스타트 예약 자리에 정확히 합류하고, 기존 대진·결과는 그대로다', async () => {
    await openTournamentInUi(MAIN_NAME)
    const before = JSON.stringify(getMatches(RESTART).filter((m) => m.roundNumber === 1).map(describeMatch))
    const joined: Record<string, string | null> = {}
    for (const [i, r] of MAIN_QF.entries()) {
      await playMatch(MAIN, r)
      const loser = mid(r[2])
      // 본선 8강 (i+1)경기 패자 → 리스타트 r2m(i+1) B 자리
      await waitFor(() => expect(matchOf(RESTART, `r2m${i + 1}`).playerBMemberId).toBe(loser), { timeout: 4000 })
      joined[`r2m${i + 1}`] = matchOf(RESTART, `r2m${i + 1}`).playerBMemberId
      // 아직 결과가 없는 나머지 합류 자리는 비어 있고 부전승이 아니다
      for (let k = i + 2; k <= 4; k++) {
        const slot = matchOf(RESTART, `r2m${k}`)
        expect(slot.playerBParticipantId).toBeNull(); expect(slot.resultType).toBe('normal')
      }
      // 리스타트 1차 경기 결과는 사라지지 않았다
      expect(JSON.stringify(getMatches(RESTART).filter((m) => m.roundNumber === 1).map(describeMatch))).toBe(before)
    }
    expect(joined).toEqual({ r2m1: mid(3), r2m2: mid(7), r2m3: mid(11), r2m4: mid(15) })
    // 합류자 참가 문서: 참가(entered), 핸디=본선 기본 핸디
    const ps = getParticipants(RESTART)
    for (const n of [3, 7, 11, 15]) expect(ps.find((p) => p.memberId === mid(n))).toMatchObject({ entryStatus: 'entered', tournamentHandicap: HANDICAP[n] })
    expect(ps).toHaveLength(11)
    // 리스타트 2차(8강)는 실제 대회와 같은 대진이다
    expect(getMatches(RESTART).filter((m) => m.roundNumber === 2).sort((a, b) => a.matchNumber - b.matchNumber).map((m) => [m.playerAMemberId, m.playerBMemberId].map((x) => Number(x!.slice(1))).join('v')))
      .toEqual(['14v3', '10v7', '2v11', '6v15'])
    // 중복 restart 없음 + 한 번 만든 리스타트 대진 문서는 합류 때 통째로 다시 쓰이지 않았다(경기 생성(set)은 처음 11번뿐)
    expect(getTournaments().filter((t) => t.id.startsWith('restart-'))).toHaveLength(1)
    const matchSets = writeLog.filter((w) => w.kind === 'set' && w.path.startsWith(`${mPath(RESTART)}/`))
    expect(matchSets).toHaveLength(11)
  })

  it('5. 화면에서 리스타트 대회를 열면 합류한 선수 이름이 정상으로 보인다("알수없음"이 아님)', async () => {
    await openTournamentInUi(RESTART_NAME)
    clickRound(8)
    await settle()
    for (const n of [3, 7, 11, 15]) expect(screen.getAllByText(nm(n)).length).toBeGreaterThan(0)
    expect(screen.queryByText('알수없음')).toBeNull()
  })

  it('6. 리스타트 8강 4경기 → 리스타트 4강', async () => {
    for (const r of RS_R2) await playMatch(RESTART, r)
    const pair = (id: string) => [matchOf(RESTART, id).playerAMemberId, matchOf(RESTART, id).playerBMemberId].sort()
    expect(pair('r3m1')).toEqual([mid(3), mid(7)].sort())
    expect(pair('r3m2')).toEqual([mid(2), mid(15)].sort())
    for (const r of RS_SF) await playMatch(RESTART, r)
  })

  it('7. 본선 4강 2경기 → 3·4위전 → 결승 → 본선 최종 순위(1위 1번·2위 9번·3위 13번·4위 5번)', async () => {
    await openTournamentInUi(MAIN_NAME)
    for (const r of MAIN_SF) await playMatch(MAIN, r)
    // 4강 패자 둘이 3·4위전에 올라온다
    const third = getMatches(MAIN).find((m) => m.playerCountInRound === 3)!
    expect([third.playerAMemberId, third.playerBMemberId].sort()).toEqual([mid(5), mid(13)].sort())
    for (const r of MAIN_3RD) await playMatch(MAIN, r)
    for (const r of MAIN_FINAL) await playMatch(MAIN, r)
    const p = calculateFinalPlacements(getMatches(MAIN))
    expect(p.championParticipantId).toBe(mid(1)) // 1위
    expect(p.runnerUpParticipantId).toBe(mid(9)) // 2위
    await finishTournament(MAIN, { at: at() }, CLUB)
    expect(rawGet(`clubs/${CLUB}/tournaments/${MAIN}`)).toMatchObject({ status: 'finished', championParticipantId: mid(1), runnerUpParticipantId: mid(9) })
    // 3위 13번·4위 5번
    const t = getMatches(MAIN).find((m) => m.playerCountInRound === 3)!
    expect(t.officialWinnerParticipantId).toBe(mid(13))
    expect(t.officialLoserParticipantId).toBe(mid(5))
  })

  it('8. 리스타트 결승 → 우승 2번, 준우승 7번', async () => {
    await openTournamentInUi(RESTART_NAME)
    for (const r of RS_FINAL) await playMatch(RESTART, r)
    const p = calculateFinalPlacements(getMatches(RESTART))
    expect(p.championParticipantId).toBe(mid(2))
    expect(p.runnerUpParticipantId).toBe(mid(7))
    await finishTournament(RESTART, { at: at() }, CLUB)
    expect(rawGet(`clubs/${CLUB}/tournaments/${RESTART}`)).toMatchObject({ status: 'finished', championParticipantId: mid(2), runnerUpParticipantId: mid(7) })
  })

  it('9. 새로고침(화면을 새로 열기) 후에도 같은 리스타트를 찾고, 이름이 같은 가짜 대회가 있어도 잘못 잡지 않는다', async () => {
    cleanup()
    const list = await fetchTournaments(CLUB)
    const main = list.find((t) => t.id === MAIN)!
    expect(findRestartTarget(main, list)).toMatchObject({ kind: 'found', tournament: { id: RESTART } })
    // 같은 이름의 잘못된 대회를 하나 더 심어도(공백·글자 구성 차이 포함) 고정 ID/연결된 대회를 고른다
    const decoy: Tournament = { id: 'decoy-same-name', name: ` ${RESTART_NAME} `, date: main.date, timeLimitMinutes: 50, status: 'draft', createdAt: at() }
    const withDecoy = [...list, decoy]
    expect(findRestartTarget(main, withDecoy)).toMatchObject({ kind: 'found', tournament: { id: RESTART } })
    // 새로 열린 화면(다른 기기)에서 본선·리스타트를 열어 결과가 그대로 보인다
    asAdmin()
    render(<TournamentTab archivedTournaments={[]} />)
    await openTournamentInUi(RESTART_NAME)
    clickRound(2)
    await settle()
    expect(screen.getAllByText(nm(2)).length).toBeGreaterThan(0)
    expect(screen.queryByText('알수없음')).toBeNull()
    cleanup()
  })

  it('10. 전체 경기 결과가 확정 결과표와 일치하고, 통계용 경기 기록은 한 번씩만(중복 없이) 생긴다', async () => {
    const check = (tid: string, results: R[]) => {
      for (const [w, ws, l, ls] of results) {
        const m = findMatch(tid, w, l)
        expect(m.status).toBe('official')
        const wIsA = m.playerAMemberId === mid(w)
        expect([m.scoreA, m.scoreB]).toEqual(wIsA ? [ws, ls] : [ls, ws])
        expect([m.officialWinnerParticipantId, m.officialLoserParticipantId]).toEqual([mid(w), mid(l)])
        // 핸디 스냅샷: 본선은 대회 시작 시점 핸디, 리스타트는 바뀐 핸디(4번 20·8번 10)·합류자는 본선 기본 핸디
        const hw = wIsA ? m.playerAHandicapSnapshot : m.playerBHandicapSnapshot
        const hl = wIsA ? m.playerBHandicapSnapshot : m.playerAHandicapSnapshot
        const exp = (n: number) => (tid === RESTART && n === 4 ? 20 : tid === RESTART && n === 8 ? 10 : HANDICAP[n])
        expect([hw, hl]).toEqual([exp(w), exp(l)])
      }
    }
    check(MAIN, [...MAIN_R1, ...MAIN_QF, ...MAIN_SF, ...MAIN_3RD, ...MAIN_FINAL])
    check(RESTART, [...RS_R1, ...RS_R2, ...RS_SF, ...RS_FINAL])
    // 통계용 Game: 실제로 친 경기만(부전승 제외) — 본선 15경기, 리스타트 10경기
    const gamesOf = (tid: string) => rawList(`clubs/${CLUB}/sessions/tournament-session-${tid}/games`)
    expect(gamesOf(MAIN)).toHaveLength(15)
    expect(gamesOf(RESTART)).toHaveLength(10)
    const allIds = [...gamesOf(MAIN), ...gamesOf(RESTART)].map((g) => String(g.id))
    expect(new Set(allIds).size).toBe(allIds.length) // 같은 경기가 두 번 잡히지 않는다
    // 같은 선수가 같은 상대와 두 번 기록되는 일도 없다(본선·리스타트에서 맞붙은 쌍은 서로 달랐다)
    const pairs = [...gamesOf(MAIN), ...gamesOf(RESTART)].map((g) => [g.playerAId, g.playerBId].sort().join('~'))
    expect(new Set(pairs).size).toBe(pairs.length)
  })
})

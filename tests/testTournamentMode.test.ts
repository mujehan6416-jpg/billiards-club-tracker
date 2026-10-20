import { describe, it, expect, vi, beforeEach } from 'vitest'

// 테스트 대회 모드 — 경기 진행은 정상이고, 통계용 세션/Game만 만들지 않는지 확인한다.
// 운영 Firestore는 쓰지 않는다. tests/fixtures/fakeFirestore.ts(메모리 속 가짜 저장소) 위에서 앱의 진짜 동기화 코드
// (lib/tournamentSync.ts)를 그대로 통과시킨다. 선수 n = 참가자 id `p{n}` / 회원 id `m{n}`, 이름은 전부 가상이다.
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>()
  const { firestoreFake } = await import('./fixtures/fakeFirestore')
  return { ...actual, ...firestoreFake }
})

import {
  approveTournamentMatch, createRestartBracket, createTournament, deleteTournament, ensureTournamentDoc,
  fetchTournaments, syncRestartJoiners,
} from '../src/lib/tournamentSync'
import { analyzeRestartSource, buildRestartBracket } from '../src/logic/tournamentRestartBracket'
import { buildRestartTournament, restartTournamentId } from '../src/logic/tournamentRestart'
import { calculateFinalPlacements } from '../src/logic/tournamentMatch'
import { rawGet, rawList, rawPathsWithPrefix, rawSet, resetFakeFirestore } from './fixtures/fakeFirestore'
import { fullMain, seededRng } from './fixtures/restartMain'
import type { Tournament, TournamentMatch } from '../src/types/tournament'

const C = 'clubs/skkubc'
const CLUB = 'skkubc'
const MAIN = 'tm-main'
const RESTART = restartTournamentId(MAIN)
const SESSIONS = `${C}/sessions`

const clean = (v: unknown) => JSON.parse(JSON.stringify(v)) as Record<string, unknown>
const mainDoc = (test: boolean): Tournament => ({
  id: MAIN, name: '가상 대회', date: '2026-10-20', timeLimitMinutes: 50, status: 'draft', createdAt: '2026-10-20T00:00:00.000Z',
  ...(test ? { isTestTournament: true } : {}),
})
const mPath = (tid: string) => `${C}/tournaments/${tid}/matches`
const matchesOf = (tid: string) => rawList(mPath(tid)).map(({ __id, ...r }) => { void __id; return r as unknown as TournamentMatch })

let clock = Date.parse('2026-10-20T01:00:00.000Z')
const at = () => new Date((clock += 60_000)).toISOString()

/** 가상 16명 본선을 저장소에 만든다(참가자 16명 + 경기 15+α). */
async function seedMain(test: boolean) {
  await createTournament({ ...mainDoc(test), status: 'bracketFixed', bracketSize: 16 }, CLUB)
  for (let n = 1; n <= 16; n++) {
    rawSet(`${C}/tournaments/${MAIN}/participants/p${n}`, {
      id: `p${n}`, memberId: `m${n}`, displayNameSnapshot: `가상선수${n}`, baseHandicapSnapshot: 20, tournamentHandicap: 20, entryStatus: 'entered',
    })
  }
  for (const m of fullMain(16)) rawSet(`${mPath(MAIN)}/${m.id}`, clean(m))
}

/** 승인 대기 상태(A 승)로 만들고 관리자 최종 승인한다 — 앱의 입력→확인→승인과 같은 결과 문서. */
async function playOne(tid: string, m: TournamentMatch) {
  rawSet(`${mPath(tid)}/${m.id}`, clean({
    ...m, scoreA: 20, scoreB: 5, calculatedWinnerParticipantId: m.playerAParticipantId, status: 'awaitingApproval',
    resultLog: {
      submittedByMemberId: m.playerAMemberId, submittedAt: at(), correctionRequested: false,
      verificationType: 'player', verifiedByMemberId: m.playerBMemberId, verifiedAt: at(),
    },
  }))
  await approveTournamentMatch(tid, m.id, { adminUid: 'admin-uid', at: at() }, CLUB)
}

/** 경기할 수 있는 경기가 없을 때까지 계속 진행한다. 본선 승인 뒤에는 앱처럼 리스타트 합류 자리를 채운다. */
async function playAll(tids: string[], upToRound = Infinity) {
  for (let guard = 0; guard < 200; guard++) {
    let played = false
    for (const tid of tids) {
      const next = matchesOf(tid)
        .filter((m) => m.status === 'awaitingResult' && m.resultType !== 'bye' && m.playerAParticipantId && m.playerBParticipantId && m.roundNumber <= upToRound)
        .sort((a, b) => a.roundNumber - b.roundNumber || a.matchNumber - b.matchNumber)[0]
      if (!next) continue
      await playOne(tid, next)
      if (tid === MAIN && rawGet(`${C}/tournaments/${RESTART}`)) await syncRestartJoiners(RESTART, CLUB)
      played = true
    }
    if (!played) return
  }
  throw new Error('경기 진행이 끝나지 않습니다.')
}

/** 본선 1차(16강)를 끝내고 리스타트 대회를 만든다(앱의 "리스타트 대진 만들기"와 같은 순서). */
async function startRestart() {
  await playAll([MAIN], 1)
  const main = (await fetchTournaments(CLUB)).find((t) => t.id === MAIN)!
  const { created } = await ensureTournamentDoc(buildRestartTournament(main, at(), 'admin-uid'), CLUB)
  expect(created).toBe(true)
  const mainMatches = matchesOf(MAIN)
  const analysis = analyzeRestartSource(mainMatches)
  if (!analysis.ok) throw new Error(analysis.message)
  const losers = mainMatches.filter((m) => m.roundNumber === 1).map((m) => m.officialLoserParticipantId!)
  const entrants = losers.map((p) => ({ participantId: `m${p.slice(1)}`, memberId: `m${p.slice(1)}`, handicap: 20 }))
  const built = buildRestartBracket({ sourceTournamentId: MAIN, analysis: analysis.value, sourceMatches: mainMatches, entrants, rng: seededRng(5) })
  if (!built.ok) throw new Error(built.message)
  await createRestartBracket(RESTART, built.value.matches, {
    sourceTournamentId: MAIN, bracketSize: analysis.value.w * 4, participantCount: entrants.length, at: at(),
  }, CLUB)
}

const playedGames = (tid: string) => matchesOf(tid).filter((m) => m.status === 'official' && m.resultType !== 'bye').length
const gamePaths = (tid: string) => rawPathsWithPrefix(`${SESSIONS}/tournament-session-${tid}/games`).filter((p) => p.includes('/games/'))

beforeEach(() => resetFakeFirestore())

describe('A. 기본값 — 기존 대회는 실제 대회', () => {
  it('isTestTournament가 없는 대회 문서는 그대로 저장되고(새 필드 없음), 읽어도 테스트 대회가 아니다', async () => {
    await createTournament(mainDoc(false), CLUB)
    expect(Object.keys(rawGet(`${C}/tournaments/${MAIN}`)!)).not.toContain('isTestTournament')
    const t = (await fetchTournaments(CLUB))[0]
    expect(t.isTestTournament === true).toBe(false)
  })
})

describe('B. 테스트 대회 생성', () => {
  it('테스트 옵션이 대회 문서에 저장되고 다시 읽을 수 있다', async () => {
    await createTournament(mainDoc(true), CLUB)
    expect(rawGet(`${C}/tournaments/${MAIN}`)!.isTestTournament).toBe(true)
    expect((await fetchTournaments(CLUB))[0].isTestTournament).toBe(true)
  })

  it('false로 넘겨도 문서에는 쓰지 않는다(실제 대회 문서 모양 유지)', async () => {
    await createTournament({ ...mainDoc(false), isTestTournament: false }, CLUB)
    expect(Object.keys(rawGet(`${C}/tournaments/${MAIN}`)!)).not.toContain('isTestTournament')
  })
})

describe('C. 본선 — 테스트 대회는 진행은 정상, 통계 기록은 없다', () => {
  it('테스트 본선: 경기 확정·다음 라운드 진행은 정상이고 통계 세션/Game이 하나도 생기지 않는다', async () => {
    await seedMain(true)
    await playAll([MAIN], 2)
    const official = matchesOf(MAIN).filter((m) => m.status === 'official')
    expect(official).toHaveLength(8 + 4) // 1차 8경기 + 8강 4경기
    // 다음 라운드 배치도 정상 — 4강 첫 경기에 두 선수가 올라와 있다
    const semi = matchesOf(MAIN).find((m) => m.roundNumber === 3 && m.matchNumber === 1)!
    expect(semi.playerAParticipantId && semi.playerBParticipantId).toBeTruthy()
    expect(rawPathsWithPrefix(SESSIONS)).toEqual([])
  })

  it('실제 본선(회귀): 같은 진행에서 경기마다 통계 Game이 한 건씩 기존처럼 생긴다', async () => {
    await seedMain(false)
    await playAll([MAIN], 2)
    expect(rawGet(`${SESSIONS}/tournament-session-${MAIN}`)?.source).toBe('tournament')
    expect(gamePaths(MAIN)).toHaveLength(playedGames(MAIN))
    expect(playedGames(MAIN)).toBe(12)
  })

  it('테스트 본선을 끝까지 진행하면 최종 순위가 정상으로 계산된다', async () => {
    await seedMain(true)
    await playAll([MAIN])
    const placements = calculateFinalPlacements(matchesOf(MAIN))
    expect(placements.championParticipantId).toBeTruthy()
    expect(placements.runnerUpParticipantId).toBeTruthy()
    expect(rawPathsWithPrefix(SESSIONS)).toEqual([])
  })
})

describe('D. 리스타트 — 본선 테스트 플래그를 자동으로 물려받고 통계 기록이 없다', () => {
  it('리스타트 대회 문서가 테스트 대회로 만들어진다(사용자가 다시 고르지 않는다)', async () => {
    await seedMain(true)
    await startRestart()
    expect(rawGet(`${C}/tournaments/${RESTART}`)!.isTestTournament).toBe(true)
  })

  it('테스트 본선 + 리스타트를 결승까지 진행해도 통계 세션/Game이 없다(합류·리스타트 경기 진행은 정상)', async () => {
    await seedMain(true)
    await startRestart()
    await playAll([MAIN, RESTART])
    const mainPlacements = calculateFinalPlacements(matchesOf(MAIN))
    const restartPlacements = calculateFinalPlacements(matchesOf(RESTART))
    expect(mainPlacements.championParticipantId).toBeTruthy()
    expect(restartPlacements.championParticipantId).toBeTruthy()
    // 합류 자리가 모두 채워졌다(본선 8강 탈락자가 리스타트에 들어옴)
    expect(matchesOf(RESTART).filter((m) => m.playerBJoinFrom && !m.playerBParticipantId)).toEqual([])
    expect(playedGames(RESTART)).toBeGreaterThan(0)
    expect(rawPathsWithPrefix(SESSIONS)).toEqual([])
  })

  it('실제 본선 + 리스타트(회귀): 두 대회 모두 기존처럼 통계 세션/Game이 생기고, 리스타트도 테스트가 아니다', async () => {
    await seedMain(false)
    await startRestart()
    expect(Object.keys(rawGet(`${C}/tournaments/${RESTART}`)!)).not.toContain('isTestTournament')
    await playAll([MAIN, RESTART])
    expect(gamePaths(MAIN)).toHaveLength(playedGames(MAIN))
    expect(gamePaths(RESTART)).toHaveLength(playedGames(RESTART))
    expect(playedGames(RESTART)).toBeGreaterThan(0)
  })

  it('이름 규칙으로 따로 만든(플래그 없는) 리스타트도 테스트 본선에 연결돼 있으면 통계가 생기지 않는다', async () => {
    await seedMain(true)
    await startRestart()
    // 리스타트 문서에서 플래그를 지운 상태를 만든다 — 연결 정보(restartSourceTournamentId)만 남음
    const doc = rawGet(`${C}/tournaments/${RESTART}`)!
    delete doc.isTestTournament
    rawSet(`${C}/tournaments/${RESTART}`, doc)
    await playAll([MAIN, RESTART])
    expect(playedGames(RESTART)).toBeGreaterThan(0)
    expect(rawPathsWithPrefix(SESSIONS)).toEqual([])
  })
})

describe('F. 일반 정기경기 — 테스트 대회와 상관없이 그대로', () => {
  it('테스트 대회를 진행해도 같은 저장소의 일반 정기모임 세션·경기는 그대로다', async () => {
    rawSet(`${SESSIONS}/2026-10-01`, { id: '2026-10-01', source: 'meeting' })
    rawSet(`${SESSIONS}/2026-10-01/games/g1`, { id: 'g1' })
    await seedMain(true)
    await playAll([MAIN], 2)
    expect(rawPathsWithPrefix(SESSIONS).sort()).toEqual([`${SESSIONS}/2026-10-01`, `${SESSIONS}/2026-10-01/games/g1`])
  })
})

describe('H. 삭제 — 테스트 대회는 통계 기록이 없어도 오류 없이 지워진다', () => {
  it('테스트 본선을 지우면 연결 리스타트까지 지워지고, 통계 세션이 없어도 오류가 없다', async () => {
    await seedMain(true)
    await startRestart()
    await playAll([MAIN, RESTART])
    rawSet(`${SESSIONS}/2026-10-01`, { id: '2026-10-01' }) // 일반 모임은 보호
    await expect(deleteTournament(MAIN, CLUB)).resolves.toBeUndefined()
    expect(rawPathsWithPrefix(`${C}/tournaments`)).toEqual([])
    expect(rawPathsWithPrefix(SESSIONS)).toEqual([`${SESSIONS}/2026-10-01`])
  })
})

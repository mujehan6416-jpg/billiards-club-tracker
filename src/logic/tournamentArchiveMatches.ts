import type { ArchivedStage } from '../data/tournamentArchive'
import type { TournamentMatch } from '../types/tournament'

// 기록용 완료 대회(data/tournamentArchive.ts)의 확정 결과를, 기존 대회 결과 화면 컴포넌트
// (TournamentBracketView·TournamentFinalResults)가 그대로 그릴 수 있는 TournamentMatch[] 모양으로
// 바꾸는 **표시 전용** 순수 함수. 결과를 계산하거나 저장하지 않는다 — 점수·승패는 확정값을 옮겨 담기만 한다.
//
// 대진 엔진·추첨 슬롯을 쓰지 않는다. 다음 경기 연결(nextMatchId)은 "이 경기 승자가 바로 다음 라운드의
// 어느 경기에 나왔는가"라는 확정 결과에서만 찾는다(오프라인 추첨 슬롯을 추정하지 않는다).
// memberId는 비워 둔다 — 회원 원본·통계와 어떤 연결도 만들지 않기 위해서다.

/** 라운드 이름 → playerCountInRound. 3은 3·4위전 예약값(types/tournament.ts 참고). 예선은 화면 이름을 따로 넘긴다. */
const PLAYER_COUNT_BY_LABEL: Record<string, number> = { 결승: 2, '3·4위전': 3, '4강': 4, '8강': 8, 예선: 16 }

export interface ArchiveStageMatches {
  matches: TournamentMatch[]
  nameOf: (participantId: string | null) => string
  /** 화면 라운드 이름(예선·8강·4강·3·4위전·결승) — 확정 결과표의 이름을 그대로 쓴다. */
  roundLabelOf: (match: TournamentMatch) => string
  /**
   * 첫 라운드가 아닌데 이 단계의 이전 경기에서 올라오지 않은 선수(예: 리스타트 8강에 합류한 본선 탈락자).
   * 확정 결과에서 그대로 읽어 낸 것이며, 전체 대진표에서 "어디서 합류했는지" 안내하는 데만 쓴다.
   */
  joiners: { roundLabel: string; names: string[] }[]
}

export function archiveStageToMatches(stage: ArchivedStage, stageKey: string): ArchiveStageMatches {
  const pid = (name: string) => `${stageKey}:${name}`
  const names = new Map<string, string>()
  const labels = new Map<string, string>()

  const regular = stage.rounds.filter((r) => r.label !== '3·4위전')
  const third = stage.rounds.find((r) => r.label === '3·4위전')
  const ordered = third ? [...regular, third] : regular
  const idOf = (label: string, index: number) => `${stageKey}-${label}-${index + 1}`

  const matches: TournamentMatch[] = ordered.flatMap((round, roundIndex) => {
    const playerCountInRound = PLAYER_COUNT_BY_LABEL[round.label]
    if (playerCountInRound === undefined) throw new Error(`알 수 없는 라운드 이름: ${round.label}`)
    const regularIndex = regular.indexOf(round)
    const nextRound = regularIndex >= 0 ? regular[regularIndex + 1] : undefined

    return round.entries.map((entry, i): TournamentMatch => {
      const id = idOf(round.label, i)
      labels.set(id, round.label)
      const winnerName = entry.kind === 'bye' ? entry.name : entry.winner.name
      names.set(pid(winnerName), winnerName)

      let nextMatchId: string | null = null
      let nextSlot: TournamentMatch['nextSlot'] = null
      if (nextRound) {
        const nextIndex = nextRound.entries.findIndex((e) => e.kind === 'game' && (e.winner.name === winnerName || e.loser.name === winnerName))
        if (nextIndex < 0) throw new Error(`${stage.title} ${round.label} 승자 ${winnerName}이(가) ${nextRound.label}에 없습니다.`)
        const next = nextRound.entries[nextIndex]
        nextMatchId = idOf(nextRound.label, nextIndex)
        nextSlot = next.kind === 'game' && next.winner.name === winnerName ? 'playerA' : 'playerB'
      }

      const base = {
        id, roundNumber: roundIndex + 1, playerCountInRound, matchNumber: i + 1,
        playerAMemberId: null, playerBMemberId: null,
        status: 'official' as const, nextMatchId, nextSlot,
      }
      if (entry.kind === 'bye') {
        return {
          ...base,
          playerAParticipantId: pid(entry.name), playerBParticipantId: null,
          playerAHandicapSnapshot: null, playerBHandicapSnapshot: null,
          scoreA: null, scoreB: null, resultType: 'bye',
          officialWinnerParticipantId: pid(entry.name), officialLoserParticipantId: null,
        }
      }
      names.set(pid(entry.loser.name), entry.loser.name)
      return {
        ...base,
        playerAParticipantId: pid(entry.winner.name), playerBParticipantId: pid(entry.loser.name),
        playerAHandicapSnapshot: entry.winner.target, playerBHandicapSnapshot: entry.loser.target,
        scoreA: entry.winner.score, scoreB: entry.loser.score, resultType: 'normal',
        officialWinnerParticipantId: pid(entry.winner.name), officialLoserParticipantId: pid(entry.loser.name),
      }
    })
  })

  const joiners = regular.slice(1).map((round) => {
    const roundMatches = matches.filter((m) => labels.get(m.id) === round.label)
    const arrived = (m: TournamentMatch, participantId: string | null) =>
      matches.some((s) => s.nextMatchId === m.id && s.officialWinnerParticipantId === participantId)
    const joined = roundMatches.flatMap((m) => [m.playerAParticipantId, m.playerBParticipantId]
      .filter((id): id is string => !!id && !arrived(m, id)))
    return { roundLabel: round.label, names: joined.map((id) => names.get(id) ?? '알수없음') }
  }).filter((j) => j.names.length > 0)

  return {
    matches,
    nameOf: (participantId) => (participantId ? (names.get(participantId) ?? '알수없음') : ''),
    roundLabelOf: (match) => labels.get(match.id) ?? '',
    joiners,
  }
}

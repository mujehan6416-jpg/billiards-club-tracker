import { calculateFinalPlacements } from './tournamentMatch'
import { rate } from './game'
import { findRestartTarget, restartTournamentId } from './tournamentRestart'
import type { Tournament, TournamentMatch } from '../types/tournament'

// 대회 경기결과 공유(카카오톡 문구 · 이미지 카드)용 순수 로직.
//
// 순위는 새로 추정하지 않는다. 현재 앱의 최종 순위 계산(calculateFinalPlacements)을 그대로 쓰고,
// 결승(또는 3·4위전)이 최종 승인(official)되지 않았으면 틀린 순위를 만들지 않고 "아직 확정되지 않았습니다"만 돌려준다.
// 새로 저장하는 값은 없다 — 하이런상 이름은 이 화면에서 입력한 값을 문구를 만들 때만 쓴다.
//
// 리스타트는 어떤 경우에도 1위·2위만 만든다(3위·4위·공동 3위는 계산 결과에서 아예 쓰지 않는다).

/** 화면·문구에 쓰는 이름. (한 곳에서만 정해서 문구·이미지가 어긋나지 않게 한다) */
export const MASTERS_NAME = '마스터즈'
export const RESTART_NAME = '리스타트'

export interface ResultLine {
  /** 예: "마스터즈 1위" */
  label: string
  /** 선수 이름(공동 순위면 쉼표로 이어 붙임) */
  value: string
}

export interface ResultSection {
  /** 예: "마스터즈 챔피언십 경기결과" */
  title: string
  status: 'ready' | 'pending'
  lines: ResultLine[]
  /** 확정되지 않았을 때 보여줄 문구(pending) 또는 일부만 확정됐을 때의 안내 */
  notice?: string
}

/** 경기 상세 한 구역(결승전·3·4위전·준결승전·8강·예선). */
export interface MatchDetailSection {
  title: string
  lines: string[]
}

export interface TournamentResultShareData {
  masters: ResultSection
  restart: ResultSection
  /** 하이런상 이름(공백 정리됨). 비어 있으면 문구·이미지에서 빼고, 화면에서 입력을 안내한다. */
  highRun: string
  /** 본선(마스터즈) 경기 상세. 결승전 → 3·4위전 → 준결승전 → 8강 → 예선 순서. 리스타트 상세는 넣지 않는다. */
  details: MatchDetailSection[]
}

export type ParticipantNameOf = (participantId: string | null) => string

const MASTERS_TITLE = `${MASTERS_NAME} 챔피언십 경기결과`
const RESTART_TITLE = `${RESTART_NAME} 챔피언십 경기결과`

/** 마스터즈(본선): 1~4위. 3·4위전이 있으면 그 결과로 3위/4위를 정하고, 없으면 공동 3위로 표시한다(4위는 추정하지 않음). */
export function buildMastersSection(matches: TournamentMatch[] | null, nameOf: ParticipantNameOf): ResultSection {
  const pending: ResultSection = {
    title: MASTERS_TITLE, status: 'pending', lines: [], notice: `${MASTERS_NAME} 결과가 아직 확정되지 않았습니다.`,
  }
  if (!matches || matches.length === 0) return pending
  const placements = calculateFinalPlacements(matches)
  if (!placements.championParticipantId) return pending

  const lines: ResultLine[] = [
    { label: `${MASTERS_NAME} 1위`, value: nameOf(placements.championParticipantId) },
    { label: `${MASTERS_NAME} 2위`, value: nameOf(placements.runnerUpParticipantId) },
  ]
  const hasThirdPlaceMatch = matches.some((m) => m.playerCountInRound === 3)
  if (hasThirdPlaceMatch) {
    if (placements.fourthPlaceParticipantId !== undefined) {
      if (placements.thirdPlaceParticipantIds.length > 0) {
        lines.push({ label: `${MASTERS_NAME} 3위`, value: nameOf(placements.thirdPlaceParticipantIds[0]) })
      }
      lines.push({ label: `${MASTERS_NAME} 4위`, value: nameOf(placements.fourthPlaceParticipantId) })
      return { title: MASTERS_TITLE, status: 'ready', lines }
    }
    return { title: MASTERS_TITLE, status: 'ready', lines, notice: '3·4위전 결과가 아직 확정되지 않았습니다.' }
  }
  if (placements.thirdPlaceParticipantIds.length > 0) {
    lines.push({ label: `${MASTERS_NAME} 공동 3위`, value: placements.thirdPlaceParticipantIds.map((id) => nameOf(id)).join(', ') })
  }
  return { title: MASTERS_TITLE, status: 'ready', lines }
}

/**
 * 리스타트: 결승 기준 **1위·2위만**. 3위·4위·공동 3위는 어떤 경우에도 만들지 않는다(대회 안에 3·4위전이나 준결승 결과가
 * 있어도 무시). 리스타트 대회가 없거나 결승이 확정되지 않았으면 미확정.
 */
export function buildRestartSection(matches: TournamentMatch[] | null, nameOf: ParticipantNameOf): ResultSection {
  const pending: ResultSection = {
    title: RESTART_TITLE, status: 'pending', lines: [], notice: `${RESTART_NAME} 결과가 아직 확정되지 않았습니다.`,
  }
  if (!matches || matches.length === 0) return pending
  const placements = calculateFinalPlacements(matches)
  if (!placements.championParticipantId) return pending
  return {
    title: RESTART_TITLE, status: 'ready',
    lines: [
      { label: `${RESTART_NAME} 1위`, value: nameOf(placements.championParticipantId) },
      { label: `${RESTART_NAME} 2위`, value: nameOf(placements.runnerUpParticipantId) },
    ],
  }
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`

/** 패자 줄 들여쓰기 — 카톡은 글자 폭이 제각각이라 완전한 세로 맞춤은 안 되므로, "1. " 다음쯤에서 시작하도록 공백만 둔다. */
const LOSER_INDENT = '    '

/**
 * 경기 한 줄 — 승자를 먼저(위 줄), 패자를 뒤(아래 줄 "vs" 다음)에 둔다. 모임탭 카톡 결과와 같은 점수 표기:
 *   `1. 김명오 20/20(100%) (승)`
 *   `    vs 강호철 13/23(57%)`
 * 카톡은 폰 폭에 따라 긴 한 줄을 아무 데서나 꺾으므로, 승자·패자를 두 줄로 고정해 이름 길이와 상관없이 같은 모양이 되게 한다.
 * 점수 / 당시 핸디(경기 시점 스냅샷) / 달성률(%). 승자는 공식 승자(officialWinner)를 그대로 쓴다(승패 계산은 하지 않는다).
 * 기권은 점수 없이 `이름 (승)` / `vs 이름 (기권)`, 부전승은 `이름 (부전승)`. 아직 공식 확정되지 않은 경기는 null(출력하지 않음).
 * 공식 승자가 기록되지 않은 예외 경기는 A·B 순서 그대로 둔다.
 */
export function matchResultLine(index: number, m: TournamentMatch, nameOf: ParticipantNameOf): string | null {
  if (m.status !== 'official') return null
  if (m.resultType === 'bye') {
    const only = m.playerAParticipantId ?? m.playerBParticipantId
    return only ? `${index}. ${nameOf(only)} (부전승)` : null
  }
  const winner = m.officialWinnerParticipantId ?? null
  const side = (participantId: string | null, score: number | null, handicap: number | null) => {
    const name = nameOf(participantId)
    const isWinner = !!participantId && participantId === winner
    if (m.resultType === 'forfeit') return `${name} ${isWinner ? '(승)' : '(기권)'}`
    const detail = score !== null && handicap !== null ? ` ${score}/${handicap}(${pct(rate(score, handicap))})` : ''
    return `${name}${detail}${isWinner ? ' (승)' : ''}`
  }
  const a = side(m.playerAParticipantId, m.scoreA, m.playerAHandicapSnapshot)
  const b = side(m.playerBParticipantId, m.scoreB, m.playerBHandicapSnapshot)
  const [first, second] = winner !== null && winner === m.playerBParticipantId ? [b, a] : [a, b]
  return `${index}. ${first}\n${LOSER_INDENT}vs ${second}`
}

/**
 * 본선 경기 상세를 결승전 → (3·4위전) → 준결승전 → 8강 → 예선 순으로 묶는다.
 * 내부 라운드 번호(대진 크기마다 다름)에 기대지 않고 구조로 정한다:
 *   결승전 = 다음 경기가 없는 경기 / 준결승전 = 결승으로 가는 경기 / 8강 = 준결승으로 가는 경기 /
 *   예선 = 그보다 앞 라운드 전부(16강·32강 …을 하나로 묶음, 가까운 라운드부터).
 * 3·4위전은 결승전 바로 뒤에 둔다. 공식 확정된 경기만 출력하고, 경기가 하나도 없는 구역은 만들지 않는다.
 * 각 구역 안의 번호는 1부터 다시 매기고, 같은 구역 안에서는 경기 번호 순서다.
 */
export function buildMatchDetailSections(matches: TournamentMatch[] | null, nameOf: ParticipantNameOf): MatchDetailSection[] {
  if (!matches || matches.length === 0) return []
  const regular = matches.filter((m) => m.playerCountInRound !== 3)
  const third = matches.filter((m) => m.playerCountInRound === 3)
  const final = regular.find((m) => m.nextMatchId === null)
  if (!final) return []
  const semis = regular.filter((m) => m.nextMatchId === final.id)
  const semiIds = new Set(semis.map((m) => m.id))
  const quarters = regular.filter((m) => m.nextMatchId !== null && semiIds.has(m.nextMatchId))
  const quarterIds = new Set(quarters.map((m) => m.id))
  const early = regular
    .filter((m) => m.id !== final.id && !semiIds.has(m.id) && !quarterIds.has(m.id))
    .sort((a, b) => b.roundNumber - a.roundNumber || a.matchNumber - b.matchNumber)
  const byNumber = (a: TournamentMatch, b: TournamentMatch) => a.matchNumber - b.matchNumber

  const groups: { title: string; list: TournamentMatch[] }[] = [
    { title: '결승전', list: [final] },
    { title: '3·4위전', list: third },
    { title: '준결승전', list: [...semis].sort(byNumber) },
    { title: '8강', list: [...quarters].sort(byNumber) },
    { title: '예선', list: early },
  ]
  const sections: MatchDetailSection[] = []
  for (const g of groups) {
    const lines: string[] = []
    for (const m of g.list) {
      const line = matchResultLine(lines.length + 1, m, nameOf)
      if (line) lines.push(line)
    }
    if (lines.length > 0) sections.push({ title: g.title, lines })
  }
  return sections
}

export function buildResultShareData(input: {
  mastersMatches: TournamentMatch[] | null
  mastersNameOf: ParticipantNameOf
  restartMatches: TournamentMatch[] | null
  restartNameOf: ParticipantNameOf
  highRun: string
}): TournamentResultShareData {
  return {
    masters: buildMastersSection(input.mastersMatches, input.mastersNameOf),
    restart: buildRestartSection(input.restartMatches, input.restartNameOf),
    highRun: input.highRun.trim().replace(/\s+/g, ' '),
    details: buildMatchDetailSections(input.mastersMatches, input.mastersNameOf),
  }
}

/**
 * 카카오톡에 붙여넣을 문구. 대회 최종결과(마스터즈 · 리스타트 · 하이런상)가 먼저 나오고, 그 뒤에 본선 경기 상세가
 * 결승전 → 준결승전 → 8강 → 예선 순으로 이어진다. 카톡의 굵은 글씨(*) 해석에 기대지 않고 이모지·줄바꿈만 쓴다.
 * 리스타트는 1위·2위만 요약하고 리스타트 경기 상세는 넣지 않는다. 하이런상 이름이 비어 있으면 그 줄은 넣지 않는다.
 */
export function buildResultShareText(data: TournamentResultShareData): string {
  const blocks: string[] = ['🏆 대회 최종결과']
  const sectionRows = (section: ResultSection) => {
    const rows = section.lines.map((l) => `${l.label}: ${l.value}`)
    if (section.notice) rows.push(section.notice)
    return rows.join('\n')
  }
  blocks.push(sectionRows(data.masters))
  blocks.push(sectionRows(data.restart))
  if (data.highRun) blocks.push(`하이런상: ${data.highRun}`)
  for (const d of data.details) blocks.push([`▶ ${d.title}`, ...d.lines].join('\n'))
  return blocks.join('\n\n')
}

export type RestartResultLookup =
  | { kind: 'found'; tournament: Tournament }
  | { kind: 'none' }
  | { kind: 'ambiguous' }

/**
 * 이 본선의 리스타트 대회를 찾는다. 자동 생성할 때 쓰는 고정 id(restart-{본선 id})를 먼저 보고,
 * 없을 때만 기존 이름 규칙(본선 이름 + " 리스타트전")을 쓴다. 이름만 느슨하게 찾지 않는다.
 */
export function resolveRestartForResult(current: Tournament, tournaments: Tournament[]): RestartResultLookup {
  const fixed = tournaments.find((t) => t.id === restartTournamentId(current.id))
  if (fixed) return { kind: 'found', tournament: fixed }
  const lookup = findRestartTarget(current, tournaments)
  if (lookup.kind === 'found') return { kind: 'found', tournament: lookup.tournament }
  return lookup.kind === 'ambiguous' ? { kind: 'ambiguous' } : { kind: 'none' }
}

import { rate } from '../../logic/game'
import type { Tournament, TournamentEntryStatus, TournamentMatch, TournamentParticipant } from '../../types/tournament'

// 토너먼트 4A 화면 전용 표시 문구 변환. 내부 status/entryStatus 값을 그대로 화면에
// 노출하지 않기 위해 이 파일 한 곳에서만 한국어 라벨을 만든다.

/** 대회 진행 단계를 회원이 이해할 수 있는 한국어 한 줄로. */
export function tournamentStatusLabel(status: Tournament['status']): string {
  switch (status) {
    case 'draft': return '참가 신청 중'
    case 'entryClosed': return '참가자 확정'
    case 'drawReady':
    case 'bracketFixed': return '대회 준비 중'
    case 'finished': return '대회 종료'
    case 'cancelled': return '취소됨'
  }
}

export interface EntryCounts {
  entered: number
  declined: number
  noResponse: number
  excluded: number
}

export function countEntries(participants: TournamentParticipant[]): EntryCounts {
  const counts: EntryCounts = { entered: 0, declined: 0, noResponse: 0, excluded: 0 }
  for (const p of participants) counts[p.entryStatus]++
  return counts
}

export function entryStatusLabel(status: TournamentEntryStatus): string {
  switch (status) {
    case 'entered': return '참가'
    case 'declined': return '불참'
    case 'noResponse': return '미응답'
    case 'excluded': return '관리자 제외'
  }
}

/**
 * 그 라운드에 남은 선수 수를 대회 화면 문구로 바꾼다. TournamentMatch.playerCountInRound에는
 * 숫자만 들어 있다(도메인이 "16강" 같은 한국어 문구를 갖지 않는다) — 그 숫자를 화면에서만
 * 이렇게 해석한다. 정의되지 않은 규모(대진 생성 규칙상 항상 2의 거듭제곱이므로 실사용에서는
 * 나오지 않는다)는 그대로 "N강"으로 표시해 안전하게 대응한다.
 */
export function roundLabel(playerCountInRound: number): string {
  if (playerCountInRound === 2) return '결승'
  if (playerCountInRound === 4) return '4강'
  return `${playerCountInRound}강`
}

/**
 * "점수/핸디 (달성률%)" 형태로만 보여준다. 퍼센트만 보여주면 반올림 때문에 실제로는 다른
 * 달성률(예: 15/20=75% vs 17/25=68%)이 같아 보일 수 있어, 분수를 항상 함께 표시한다.
 */
export function rateDisplay(score: number, handicap: number): string {
  const r = rate(score, handicap)
  return `${score}/${handicap} (${Math.round(r * 100)}%)`
}

/**
 * 경기 진행 상태를 회원이 이해할 수 있는 한국어 행동 문구로 바꾼다. status·resultLog 같은
 * 내부 값을 화면에 그대로 노출하지 않기 위해 이 함수 한 곳에서만 문구를 만든다.
 *
 * viewerMemberId가 이 경기의 두 선수 중 한 명이면 "너는 지금 뭘 해야 하는가" 관점으로,
 * 아니면(구경하는 다른 회원) 일반적인 진행 상태 문구로 나눈다.
 */
export function matchMemberStatusMessage(match: TournamentMatch, viewerMemberId: string | undefined): string {
  if (match.resultType === 'bye') return '부전승으로 다음 라운드에 진출했습니다.'
  if (match.status === 'official') return '공식 결과가 확정되었습니다.'

  const isPlayer = !!viewerMemberId && (viewerMemberId === match.playerAMemberId || viewerMemberId === match.playerBMemberId)

  if (match.status === 'awaitingResult') {
    return isPlayer ? '경기 결과를 입력해 주세요.' : '아직 경기 결과가 입력되지 않았습니다.'
  }
  if (match.resultLog?.correctionRequested) {
    return '상대가 결과 수정을 요청했습니다. 관리자 확인을 기다리고 있습니다.'
  }
  if (match.status === 'awaitingVerification') {
    if (!isPlayer) return '상대 확인을 기다리고 있습니다.'
    return viewerMemberId === match.resultLog?.submittedByMemberId
      ? '상대가 입력한 결과를 확인하기를 기다리고 있습니다.'
      : '상대가 입력한 결과를 확인해 주세요.'
  }
  if (match.status === 'awaitingApproval') return '관리자 확인을 기다리고 있습니다.'
  return ''
}

/** 라운드 이름 + "확정" — 예: "8강 확정". */
export function roundConfirmedLabel(playerCountInRound: number): string {
  return `${roundLabel(playerCountInRound)} 확정`
}

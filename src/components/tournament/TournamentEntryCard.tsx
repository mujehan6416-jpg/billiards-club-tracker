import { useEffect, useRef, useState } from 'react'
import type { Tournament, TournamentParticipant } from '../../types/tournament'

/** 참가자 명단을 3열로 표시한다. 이름은 가운데 정렬, 긴 이름은 잘라내고(...) 줄바꿈은 만들지 않는다. */
function ParticipantGrid({ participants }: { participants: TournamentParticipant[] }) {
  const sorted = [...participants].sort((a, b) => a.displayNameSnapshot.localeCompare(b.displayNameSnapshot, 'ko'))
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px 6px' }}>
      {sorted.map((p) => (
        <span
          key={p.id}
          style={{
            fontSize: 15, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={p.displayNameSnapshot}
        >
          {p.displayNameSnapshot}
        </span>
      ))}
    </div>
  )
}

/** "현재 참가신청 N명" + 참가자 명단(3열). entered 상태 회원만 넘긴다. */
function EntrySummary({ enteredParticipants }: { enteredParticipants: TournamentParticipant[] }) {
  return (
    <>
      <span style={{ fontSize: 15, fontWeight: 600 }}>현재 참가신청 {enteredParticipants.length}명</span>
      <div>
        <span className="muted" style={{ fontSize: 13 }}>참가자 명단 {enteredParticipants.length}명</span>
        <div style={{ marginTop: 6 }}>
          <ParticipantGrid participants={enteredParticipants} />
        </div>
      </div>
    </>
  )
}

/**
 * 회원 본인의 참가/불참 카드. 대회 목록에서 대회를 선택하면 관리자 화면보다 먼저 보여준다.
 *
 * 서버 권한은 Firestore 규칙(participants 블록의 memberSetsOwnEntryStatus)이 강제한다 —
 * 여기서 버튼을 숨기거나 비활성화하는 것은 사용자 경험을 위한 것이지 보안 경계가 아니다.
 */
export function TournamentEntryCard({ tournament, participant, enteredParticipants, onSetEntryStatus, busy }: {
  tournament: Tournament
  participant: TournamentParticipant | undefined
  /** 현재 이 대회에서 entryStatus === 'entered'인 참가자 목록 — 참가인원 집계·명단 표시에 쓴다. */
  enteredParticipants: TournamentParticipant[]
  onSetEntryStatus: (status: 'entered' | 'declined') => void
  busy?: boolean
}) {
  const acceptingEntries = tournament.status === 'draft'

  // "참가신청 변경"을 눌렀을 때만 선택 버튼을 다시 보여준다. 실제로 상태가 바뀌면(저장 성공)
  // 자동으로 닫아 요약 화면으로 돌아간다 — 저장 실패 시에는 상태가 안 바뀌므로 열린 채 유지된다.
  const [editing, setEditing] = useState(false)
  const prevStatusRef = useRef(participant?.entryStatus)
  useEffect(() => {
    if (participant?.entryStatus !== prevStatusRef.current) {
      prevStatusRef.current = participant?.entryStatus
      setEditing(false)
    }
  }, [participant?.entryStatus])

  if (!participant) {
    return (
      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 15 }}>내 참가 여부</span>
        <span className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
          아직 참가자 명단에 등록되지 않았습니다. 참가를 원하시면 관리자에게 알려 주세요.
        </span>
      </div>
    )
  }

  const handicapLine = participant.tournamentHandicap !== participant.baseHandicapSnapshot
    ? `대회 핸디: ${participant.tournamentHandicap} (기본 핸디 ${participant.baseHandicapSnapshot})`
    : `대회 핸디: ${participant.tournamentHandicap}`

  if (participant.entryStatus === 'excluded') {
    return (
      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 15 }}>내 참가 여부</span>
        <span style={{ fontSize: 15, color: '#c0392b', fontWeight: 600 }}>
          관리자가 이번 대회 참가자에서 제외했습니다.
        </span>
      </div>
    )
  }

  const selectionButtons = (
    <div style={{ display: 'flex', gap: 10 }}>
      <button
        type="button"
        className={participant.entryStatus === 'entered' ? 'primary grow' : 'grow'}
        disabled={busy}
        onClick={() => onSetEntryStatus('entered')}
        style={{ fontSize: 16, padding: 14 }}
      >
        참가합니다
      </button>
      <button
        type="button"
        className={participant.entryStatus === 'declined' ? 'primary grow' : 'grow'}
        disabled={busy}
        onClick={() => onSetEntryStatus('declined')}
        style={{ fontSize: 16, padding: 14 }}
      >
        참가하지 않습니다
      </button>
    </div>
  )

  // 마감(entryClosed 이후): 변경 불가, 현재 상태 + 참가인원 + 명단만 계속 볼 수 있다.
  if (!acceptingEntries) {
    const statusText = participant.entryStatus === 'entered' ? '참가' : participant.entryStatus === 'declined' ? '불참' : '미응답'
    return (
      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 15 }}>내 참가 여부</span>
        <span style={{ fontSize: 15, color: '#072B61', fontWeight: 600 }}>현재 선택: {statusText}</span>
        <span className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
          참가신청이 마감되어 더 이상 변경할 수 없습니다.
        </span>
        {participant.entryStatus === 'entered' && (
          <span className="muted" style={{ fontSize: 13 }}>{handicapLine}</span>
        )}
        <EntrySummary enteredParticipants={enteredParticipants} />
      </div>
    )
  }

  // 아직 참가/불참을 한 번도 선택하지 않은 회원 — 최초 참가신청 화면.
  if (participant.entryStatus === 'noResponse') {
    return (
      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 15 }}>대회 참가 여부</span>
        {selectionButtons}
      </div>
    )
  }

  // "참가신청 변경"을 누른 상태 — 현재 상태를 보여주고 다시 선택하게 한다.
  if (editing) {
    const currentLabel = participant.entryStatus === 'entered' ? '참가' : '불참'
    return (
      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 15 }}>참가신청 변경</span>
        <span style={{ fontSize: 14 }}>현재 신청 상태: {currentLabel}</span>
        {selectionButtons}
        <button type="button" disabled={busy} onClick={() => setEditing(false)} style={{ fontSize: 14 }}>
          취소
        </button>
      </div>
    )
  }

  // 이미 참가/불참을 선택한 회원의 요약 화면 — 재접속해도 항상 이 화면부터 보인다.
  const doneLabel = participant.entryStatus === 'entered' ? '✅ 참가신청 완료' : '불참으로 신청되어 있습니다.'
  return (
    <div className="card col-card">
      <span style={{ fontWeight: 700, fontSize: 15 }}>내 참가 여부</span>
      <span style={{ fontSize: 16, fontWeight: 700, color: '#072B61' }}>{doneLabel}</span>
      {participant.entryStatus === 'entered' && (
        <span className="muted" style={{ fontSize: 13 }}>{handicapLine}</span>
      )}
      <EntrySummary enteredParticipants={enteredParticipants} />
      <button
        type="button"
        className="grow"
        disabled={busy}
        onClick={() => setEditing(true)}
        style={{ fontSize: 15, padding: 12 }}
      >
        참가신청 변경
      </button>
    </div>
  )
}

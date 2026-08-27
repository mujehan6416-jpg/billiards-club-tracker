import { useState } from 'react'
import type { Member } from '../../types'
import type { Tournament, TournamentParticipant } from '../../types/tournament'
import { countEntries } from './tournamentDisplay'

/** 참가자 한 명 행. 관리자가 제외·핸디 조정을 하는 곳. */
function ParticipantRow({ participant, editable, onExclude, onSetHandicap, busy }: {
  participant: TournamentParticipant
  editable: boolean
  onExclude: (participantId: string) => void
  onSetHandicap: (participantId: string, value: number) => void
  busy?: boolean
}) {
  const [handicapInput, setHandicapInput] = useState(String(participant.tournamentHandicap))
  const differsFromBase = participant.tournamentHandicap !== participant.baseHandicapSnapshot

  const applyHandicap = () => {
    const n = parseInt(handicapInput, 10)
    if (!Number.isInteger(n) || n < 1) { setHandicapInput(String(participant.tournamentHandicap)); return }
    if (n !== participant.tournamentHandicap) onSetHandicap(participant.id, n)
  }

  return (
    <li className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{participant.displayNameSnapshot}</span>
        {editable && (
          <button
            className="danger"
            style={{ fontSize: 13, padding: '6px 10px' }}
            disabled={busy}
            onClick={() => {
              if (window.confirm(`${participant.displayNameSnapshot} 님을 이번 대회 참가자에서 제외하시겠습니까?`)) {
                onExclude(participant.id)
              }
            }}
          >
            참가자에서 제외
          </button>
        )}
      </div>
      {editable ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>대회 핸디</span>
          <input
            type="number" min={1} inputMode="numeric" style={{ width: 72 }}
            value={handicapInput}
            onChange={(e) => setHandicapInput(e.target.value)}
            onBlur={applyHandicap}
            disabled={busy}
          />
          <span className="muted" style={{ fontSize: 12 }}>(기본 핸디 {participant.baseHandicapSnapshot})</span>
        </label>
      ) : (
        <span className="muted" style={{ fontSize: 13 }}>
          대회 핸디: {participant.tournamentHandicap}{differsFromBase ? ` (기본 핸디 ${participant.baseHandicapSnapshot})` : ''}
        </span>
      )}
    </li>
  )
}

/**
 * 관리자 참가자 관리 화면 — 참가 현황, 회원 추가, 참가자 제외, 대회 핸디 조정, 참가자 확정.
 *
 * 이 화면 자체는 useAdmin(PIN)만으로 렌더링되지 않는다 — 상위 컨테이너(TournamentTab)가
 * Firebase 관리자 인증(authorizedAdmin)까지 확인한 뒤에만 이 컴포넌트를 그린다. 여기서는
 * 화면 숨김만 신경 쓰고, 실제 쓰기 권한 강제는 Firestore 규칙이 한다.
 */
export function TournamentParticipantAdmin({
  tournament, participants, activeMembers, onExclude, onAddMember, onSetHandicap, onConfirmEntries, busy,
}: {
  tournament: Tournament
  participants: TournamentParticipant[]
  activeMembers: Member[]
  onExclude: (participantId: string) => void
  onAddMember: (memberId: string) => void
  onSetHandicap: (participantId: string, value: number) => void
  onConfirmEntries: () => void
  busy?: boolean
}) {
  const editable = tournament.status === 'draft'
  const counts = countEntries(participants)

  const entered = participants.filter((p) => p.entryStatus === 'entered')
  const declined = participants.filter((p) => p.entryStatus === 'declined')
  const noResponse = participants.filter((p) => p.entryStatus === 'noResponse')
  const excluded = participants.filter((p) => p.entryStatus === 'excluded')

  const addableMembers = activeMembers.filter((m) => {
    const p = participants.find((pp) => pp.memberId === m.id)
    return !p || p.entryStatus !== 'entered'
  })

  const confirmEntries = () => {
    if (entered.length < 2) {
      alert('참가자를 확정하려면 최소 2명이 참가 상태여야 합니다.')
      return
    }
    if (window.confirm(
      '참가자를 확정하면 다음 단계에서 추첨번호와 대진을 준비하게 됩니다.\n확정하시겠습니까?',
    )) {
      onConfirmEntries()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 15 }}>참가 현황</span>
        <span style={{ fontSize: 14, lineHeight: 1.6 }}>
          참가 {counts.entered}명 · 불참 {counts.declined}명 · 미응답 {counts.noResponse}명
          {counts.excluded > 0 && ` · 관리자 제외 ${counts.excluded}명`}
        </span>
      </div>

      {editable && addableMembers.length > 0 && (
        <div className="card col-card">
          <span style={{ fontWeight: 700, fontSize: 14 }}>회원 추가</span>
          <span className="muted" style={{ fontSize: 13 }}>
            앱으로 참가 신청하지 못한 회원을 눌러 참가자로 추가할 수 있습니다.
          </span>
          <div className="chip-grid">
            {addableMembers.map((m) => (
              <button
                key={m.id}
                type="button"
                className="chip"
                disabled={busy}
                onClick={() => onAddMember(m.id)}
              >
                + {m.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {entered.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#072B61', margin: '6px 0 4px' }}>참가 회원</div>
          <ul className="result-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entered.map((p) => (
              <ParticipantRow key={p.id} participant={p} editable={editable}
                onExclude={onExclude} onSetHandicap={onSetHandicap} busy={busy} />
            ))}
          </ul>
        </div>
      )}

      {noResponse.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#856404', margin: '6px 0 4px' }}>아직 응답하지 않은 회원</div>
          <div className="chip-grid">
            {noResponse.map((p) => <span key={p.id} className="chip static">{p.displayNameSnapshot}</span>)}
          </div>
        </div>
      )}

      {declined.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#888', margin: '6px 0 4px' }}>불참 회원</div>
          <div className="chip-grid">
            {declined.map((p) => <span key={p.id} className="chip static">{p.displayNameSnapshot}</span>)}
          </div>
        </div>
      )}

      {excluded.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#c0392b', margin: '6px 0 4px' }}>관리자가 제외한 회원</div>
          <div className="chip-grid">
            {excluded.map((p) => <span key={p.id} className="chip static">{p.displayNameSnapshot}</span>)}
          </div>
        </div>
      )}

      {editable && (
        <button className="primary block" style={{ fontSize: 16, padding: 14 }} disabled={busy} onClick={confirmEntries}>
          참가자 확정
        </button>
      )}

      {tournament.status === 'entryClosed' && (
        <div className="card col-card">
          <span style={{ fontWeight: 700, fontSize: 15, color: '#0f6e56' }}>✅ 참가자가 확정되었습니다.</span>
          <span style={{ fontSize: 14 }}>참가자 수: {tournament.participantCount ?? entered.length}명</span>
          <span className="muted" style={{ fontSize: 13 }}>다음 단계: 추첨 및 대진 준비</span>
        </div>
      )}
    </div>
  )
}

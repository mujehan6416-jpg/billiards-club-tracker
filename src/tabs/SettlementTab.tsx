import { useState } from 'react'
import { useApp } from '../store/appStore'
import { useAuth } from '../store/authStore'
import { useSettlementStore } from '../store/settlementStore'
import type { ImportAttendeesResult } from '../store/settlementStore'
import { DuesTable } from '../components/settlement/DuesTable'
import { SettlementExpenseForm } from '../components/settlement/SettlementExpenseForm'
import { DinnerContributionForm } from '../components/settlement/DinnerContributionForm'
import { CashDepositForm } from '../components/settlement/CashDepositForm'
import { SettlementSummary } from '../components/settlement/SettlementSummary'
import { SettlementSharePreview } from '../components/settlement/SettlementSharePreview'
import { todayStr } from '../lib/date'
import type { Member, Session } from '../types'
import type { MeetingType } from '../types/settlement'

// 정기모임 정산 화면. 두 곳에서 재사용된다:
//   1) src/tabs/SettlementAdminTab.tsx — 운영 진입점(관리자 PIN → Firebase 관리자 인증 통과 후 진입)
//   2) src/dev/DevSettlementPreview.tsx — 개발 전용 미리보기(가상 데이터, devMembers/devSessions로 override)
// 이 컴포넌트 자체는 dev 전용 문구를 포함하지 않는다 — dev 전용 안내는 DevSettlementPreview의 배너가 담당한다.

type Section = 'participants' | 'expenses' | 'dinner' | 'cash' | 'summary' | 'share'

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'participants', label: '참가자' },
  { key: 'expenses', label: '지출' },
  { key: 'dinner', label: '회식비' },
  { key: 'cash', label: '현금\n입금' },
  { key: 'summary', label: '집계\n/확정' },
  { key: 'share', label: '공유' },
]

/** initFromAttendees 결과를 사람이 읽을 안내 문구로 바꾼다. */
function describeImportResult(result: ImportAttendeesResult): string {
  if (!result.ok) return result.error
  if (result.totalAttendees === 0) return '선택한 모임은 참석 기록이 없습니다. 참가자를 직접 추가해주세요.'
  const parts = [`참가자 ${result.addedCount}명 자동 추가됨`]
  if (result.unresolvedCount > 0) parts.push(`이름 확인 필요 ${result.unresolvedCount}명(탈퇴·삭제된 회원)`)
  if (result.duplicateSkippedCount > 0) parts.push(`이미 포함되어 건너뜀 ${result.duplicateSkippedCount}명`)
  return parts.join(' · ')
}

function useRegularSessions(sessionsOverride?: Session[]) {
  const realSessions = useApp((s) => s.sessions)
  const sessions = sessionsOverride ?? realSessions
  return [...sessions].filter((s) => s.type !== 'flash').sort((a, b) => b.date.localeCompare(a.date))
}

function CreateSettlementForm({ onCreated, membersOverride, sessionsOverride }: {
  onCreated: (id: string) => void; membersOverride?: Member[]; sessionsOverride?: Session[]
}) {
  const createSettlement = useSettlementStore((s) => s.createSettlement)
  const initFromAttendees = useSettlementStore((s) => s.initFromAttendees)
  const realMembers = useApp((s) => s.members)
  const realSessions = useApp((s) => s.sessions)
  // override는 개발 미리보기에서 가상 모임/회원으로 흐름을 테스트할 때만 쓰인다(실제 useApp 데이터는 안 건드림).
  const members = membersOverride ?? realMembers
  const sessions = sessionsOverride ?? realSessions
  const regularSessions = useRegularSessions(sessionsOverride)
  const { memberName } = useAuth()
  const [meetingName, setMeetingName] = useState('')
  const [meetingDate, setMeetingDate] = useState(todayStr())
  const [meetingType, setMeetingType] = useState<MeetingType>('regular')
  const [meetingRound, setMeetingRound] = useState('')
  const [sourceSessionId, setSourceSessionId] = useState('')
  const [importMsg, setImportMsg] = useState('')

  const submit = () => {
    if (!meetingName.trim()) return
    const id = createSettlement({
      meetingName: meetingName.trim(), meetingDate, meetingType,
      meetingRound: meetingRound ? Number(meetingRound) : undefined,
      actorDisplayName: memberName ?? '관리자',
    })
    setImportMsg('')
    if (sourceSessionId) {
      const session = sessions.find((s) => s.id === sourceSessionId)
      if (session) {
        const result = initFromAttendees(id, session, members)
        setImportMsg(describeImportResult(result))
      }
    }
    onCreated(id)
  }

  return (
    <div className="card col-card">
      <span style={{ fontWeight: 700, fontSize: 14 }}>새 정산 만들기</span>
      <input placeholder="모임명 (예: 27차 정기모임)" value={meetingName} onChange={(e) => setMeetingName(e.target.value)} style={{ fontSize: 16 }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} style={{ flex: 1 }} />
        <input type="number" placeholder="회차 (선택)" value={meetingRound} onChange={(e) => setMeetingRound(e.target.value)} style={{ width: 100 }} />
      </div>
      <select value={meetingType} onChange={(e) => setMeetingType(e.target.value as MeetingType)}>
        <option value="regular">일반 정기모임</option>
        <option value="tournament">정기대회</option>
      </select>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="muted" style={{ fontSize: 12 }}>기존 정기모임 선택 (참석자 자동 불러오기, 선택사항)</span>
        <select value={sourceSessionId} onChange={(e) => setSourceSessionId(e.target.value)}>
          <option value="">선택 안 함</option>
          {regularSessions.map((s) => (
            <option key={s.id} value={s.id}>{s.date} (참석 {s.attendeeIds.length}명)</option>
          ))}
        </select>
      </div>
      <button type="button" className="primary block" onClick={submit}>정산 만들기</button>
      {importMsg && <p className="info-msg">{importMsg}</p>}
    </div>
  )
}

function AttendeeImport({ settlementId, membersOverride, sessionsOverride }: {
  settlementId: string; membersOverride?: Member[]; sessionsOverride?: Session[]
}) {
  const realSessions = useApp((s) => s.sessions)
  const realMembers = useApp((s) => s.members)
  // override는 개발 미리보기에서 가상 모임/회원으로 참석자 자동 불러오기 흐름을 테스트할 때만 쓰인다.
  const sessions = sessionsOverride ?? realSessions
  const members = membersOverride ?? realMembers
  const initFromAttendees = useSettlementStore((s) => s.initFromAttendees)
  const [sessionId, setSessionId] = useState('')
  const [msg, setMsg] = useState('')

  const regularSessions = useRegularSessions(sessionsOverride)

  return (
    <div className="card col-card">
      <span style={{ fontWeight: 700, fontSize: 14 }}>모임 참석자 불러오기</span>
      <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
        <option value="">정기모임 선택</option>
        {regularSessions.map((s) => (
          <option key={s.id} value={s.id}>{s.date} (참석 {s.attendeeIds.length}명)</option>
        ))}
      </select>
      <button
        type="button" className="primary block" disabled={!sessionId}
        onClick={() => {
          const session = sessions.find((s) => s.id === sessionId)
          if (session) setMsg(describeImportResult(initFromAttendees(settlementId, session, members)))
        }}
      >
        참석자 자동 불러오기
      </button>
      {msg && <p className="info-msg">{msg}</p>}
    </div>
  )
}

export function SettlementTab({ devMembers, devSessions, previewMode = false }: {
  devMembers?: Member[]; devSessions?: Session[]
  /** 개발 미리보기 전용. true면 DuesTable의 저장 버튼이 실제 Firestore 액션을 호출하지 않는다. */
  previewMode?: boolean
} = {}) {
  const settlements = useSettlementStore((s) => s.settlements)
  const currentId = useSettlementStore((s) => s.currentId)
  const setCurrentId = useSettlementStore((s) => s.setCurrentId)
  const [section, setSection] = useState<Section>('participants')

  const settlement = settlements.find((s) => s.id === currentId)

  return (
    <div className="tab">
      <h2 className="tab-title">🧾 정기모임 정산</h2>

      {settlements.length > 0 && (
        <div className="card">
          <select value={currentId ?? ''} onChange={(e) => setCurrentId(e.target.value || null)} className="block">
            <option value="">정산 선택...</option>
            {settlements.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id.startsWith('dev') ? '🧪[테스트] ' : ''}{s.meetingDate} {s.meetingName} ({s.status})
              </option>
            ))}
          </select>
        </div>
      )}

      <CreateSettlementForm onCreated={setCurrentId} membersOverride={devMembers} sessionsOverride={devSessions} />

      {!settlement && <p className="muted">정산을 만들거나 위 목록에서 선택해주세요.</p>}

      {settlement && (
        <>
          {settlement.participants.length === 0 && (
            <AttendeeImport settlementId={settlement.id} membersOverride={devMembers} sessionsOverride={devSessions} />
          )}

          <div className="seg">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                className={section === s.key ? 'on' : ''}
                onClick={() => setSection(s.key)}
                style={{ whiteSpace: 'pre-line', textAlign: 'center', lineHeight: 1.35 }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {section === 'participants' && (
            <DuesTable settlementId={settlement.id} previewMode={previewMode} membersOverride={devMembers} />
          )}
          {section === 'expenses' && (
            <SettlementExpenseForm settlementId={settlement.id} onRequestDinnerForm={() => setSection('dinner')} previewMode={previewMode} />
          )}
          {section === 'dinner' && <DinnerContributionForm settlementId={settlement.id} previewMode={previewMode} />}
          {section === 'cash' && <CashDepositForm settlementId={settlement.id} />}
          {section === 'summary' && <SettlementSummary settlementId={settlement.id} />}
          {section === 'share' && <SettlementSharePreview settlementId={settlement.id} />}
        </>
      )}
    </div>
  )
}

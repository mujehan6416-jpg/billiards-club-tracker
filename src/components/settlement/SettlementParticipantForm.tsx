import { useState } from 'react'
import { useApp } from '../../store/appStore'
import { useSettlementStore, isLocked } from '../../store/settlementStore'
import { QUICK_AMOUNTS } from '../../lib/settlementConstants'
import type { Member } from '../../types'
import type {
  DonationPaymentMethod, DonationStatus, DuesPaymentMethod, DuesStatus, SettlementParticipant,
} from '../../types/settlement'

const fmt = (n: number) => n.toLocaleString('ko-KR')
const parseAmt = (v: string) => Math.max(0, parseInt(v.replace(/[^0-9]/g, '') || '0', 10))

function MoneyField({ label, value, onChange, disabled }: { label: string; value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13, color: '#666' }}>{label}</span>
      <input
        type="number" inputMode="numeric" min={0} disabled={disabled}
        value={value || ''} placeholder="0"
        onChange={(e) => onChange(parseAmt(e.target.value))}
        style={{ width: '100%', fontSize: 18, padding: '12px 14px' }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        {QUICK_AMOUNTS.map((amt) => (
          <button key={amt} type="button" disabled={disabled} onClick={() => onChange(value + amt)} style={{ flex: 1, fontSize: 13, padding: '10px 4px' }}>
            +{fmt(amt)}
          </button>
        ))}
      </div>
    </div>
  )
}

function DuesEditor({ participant, disabled, onChange, onClear }: {
  participant: SettlementParticipant
  disabled: boolean
  onChange: (patch: { amount?: number; method?: DuesPaymentMethod; status?: DuesStatus; note?: string }) => void
  onClear: () => void
}) {
  const dues = participant.dues
  return (
    <div className="card col-card" style={{ background: '#f7faf8' }}>
      <span style={{ fontWeight: 700, fontSize: 14 }}>회비</span>
      <MoneyField label="금액" value={dues?.amount ?? 0} onChange={(amount) => onChange({ amount })} disabled={disabled} />
      <div style={{ display: 'flex', gap: 8 }}>
        <select value={dues?.method ?? '현금'} disabled={disabled} onChange={(e) => onChange({ method: e.target.value as DuesPaymentMethod })} style={{ flex: 1 }}>
          <option value="현금">현금</option>
          <option value="계좌이체">계좌이체</option>
          <option value="기타">기타</option>
        </select>
        <select value={dues?.status ?? '미납'} disabled={disabled} onChange={(e) => onChange({ status: e.target.value as DuesStatus })} style={{ flex: 1 }}>
          <option value="미납">미납</option>
          <option value="미확인">미확인</option>
          <option value="입금확인">입금확인</option>
          <option value="취소">취소</option>
        </select>
      </div>
      {dues?.method === '계좌이체' && dues.status === '미확인' && (
        <span style={{ fontSize: 12, color: '#c0392b', fontWeight: 600 }}>⚠ 계좌이체 미확인 — 통장 확인 후 '입금확인'으로 바꿔주세요.</span>
      )}
      {dues && (
        <button type="button" className="danger" disabled={disabled} onClick={onClear} style={{ alignSelf: 'flex-start', fontSize: 12 }}>회비 입력 지우기</button>
      )}
    </div>
  )
}

function DonationEditor({ participant, disabled, onChange, onClear }: {
  participant: SettlementParticipant
  disabled: boolean
  onChange: (patch: { amount?: number; method?: DonationPaymentMethod; status?: DonationStatus; note?: string }) => void
  onClear: () => void
}) {
  const donation = participant.donation
  return (
    <div className="card col-card" style={{ background: '#fdf8f0' }}>
      <span style={{ fontWeight: 700, fontSize: 14 }}>찬조</span>
      <MoneyField label="금액" value={donation?.amount ?? 0} onChange={(amount) => onChange({ amount })} disabled={disabled} />
      <div style={{ display: 'flex', gap: 8 }}>
        <select value={donation?.method ?? '현금'} disabled={disabled} onChange={(e) => onChange({ method: e.target.value as DonationPaymentMethod })} style={{ flex: 1 }}>
          <option value="현금">현금</option>
          <option value="계좌이체">계좌이체</option>
          <option value="기타">기타</option>
        </select>
        <select value={donation?.status ?? '미확인'} disabled={disabled} onChange={(e) => onChange({ status: e.target.value as DonationStatus })} style={{ flex: 1 }}>
          <option value="미확인">미확인</option>
          <option value="입금확인">입금확인</option>
          <option value="취소">취소</option>
        </select>
      </div>
      {donation?.method === '계좌이체' && donation.status === '미확인' && (
        <span style={{ fontSize: 12, color: '#c0392b', fontWeight: 600 }}>⚠ 계좌이체 미확인 — 통장 확인 후 '입금확인'으로 바꿔주세요.</span>
      )}
      {donation && (
        <button type="button" className="danger" disabled={disabled} onClick={onClear} style={{ alignSelf: 'flex-start', fontSize: 12 }}>찬조 입력 지우기</button>
      )}
    </div>
  )
}

export function SettlementParticipantForm({ settlementId, membersOverride }: { settlementId: string; membersOverride?: Member[] }) {
  const settlement = useSettlementStore((s) => s.getById(settlementId))
  const addMemberParticipant = useSettlementStore((s) => s.addMemberParticipant)
  const addGuestParticipant = useSettlementStore((s) => s.addGuestParticipant)
  const removeParticipant = useSettlementStore((s) => s.removeParticipant)
  const updateDues = useSettlementStore((s) => s.updateDues)
  const updateDonation = useSettlementStore((s) => s.updateDonation)
  const realMembers = useApp((s) => s.members)
  // membersOverride는 개발 미리보기에서 가상 회원으로 회원 검색 흐름을 테스트할 때만 쓰인다.
  // 지정하지 않으면(운영 사용) 항상 실제 appStore 회원 목록을 그대로 사용한다.
  const members = membersOverride ?? realMembers

  const [search, setSearch] = useState('')
  const [guestName, setGuestName] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState('')

  if (!settlement) return <p className="muted">정산을 먼저 선택하거나 생성해주세요.</p>
  const locked = isLocked(settlement.status)

  const searchTerm = search.trim()
  const candidateMembers = searchTerm
    ? members.filter((m) => m.active && m.name.includes(searchTerm))
    : []

  return (
    <div className="col-card">
      {!locked && (
        <div className="card col-card">
          <span style={{ fontWeight: 700, fontSize: 14 }}>회원 추가</span>
          <input
            className="block" placeholder="회원 이름 검색" value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ fontSize: 16 }}
          />
          {candidateMembers.length > 0 && (
            <div className="chip-grid">
              {candidateMembers.map((m) => (
                <button
                  key={m.id} type="button" className="chip"
                  onClick={() => {
                    const res = addMemberParticipant(settlementId, m)
                    setError(res.ok ? '' : res.error)
                    if (res.ok) setSearch('')
                  }}
                >
                  {m.name} 추가
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!locked && (
        <div className="card" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="grow" placeholder="비회원 이름 입력" value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            style={{ fontSize: 16 }}
          />
          <button
            type="button" className="primary"
            onClick={() => {
              const res = addGuestParticipant(settlementId, guestName)
              setError(res.ok ? '' : res.error)
              if (res.ok) setGuestName('')
            }}
          >
            비회원 추가
          </button>
        </div>
      )}

      {error && <p className="info-msg" style={{ background: '#fdeceb', color: '#c0392b' }}>{error}</p>}

      {settlement.participants.length === 0 && <p className="muted">아직 정산 대상자가 없습니다.</p>}

      {settlement.participants.map((p) => {
        const expanded = expandedId === p.id
        return (
          <div key={p.id} className="card col-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button" className="grow"
                style={{ textAlign: 'left', border: 'none', background: 'none', fontSize: 17, fontWeight: 600, padding: '6px 0' }}
                onClick={() => setExpandedId(expanded ? null : p.id)}
              >
                {p.displayName} {p.participantType === 'guest' && <span className="muted" style={{ fontSize: 12 }}>(비회원)</span>}
              </button>
              {!locked && (
                <button type="button" className="danger" onClick={() => removeParticipant(settlementId, p.id)}>삭제</button>
              )}
            </div>
            {expanded && (
              <>
                <DuesEditor
                  participant={p} disabled={locked}
                  onChange={(patch) => updateDues(settlementId, p.id, patch)}
                  onClear={() => updateDues(settlementId, p.id, null)}
                />
                <DonationEditor
                  participant={p} disabled={locked}
                  onChange={(patch) => updateDonation(settlementId, p.id, patch)}
                  onClear={() => updateDonation(settlementId, p.id, null)}
                />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

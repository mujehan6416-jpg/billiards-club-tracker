import { Fragment, useState, type CSSProperties } from 'react'
import { useApp } from '../../store/appStore'
import { useSettlementStore, isLocked } from '../../store/settlementStore'
import { useAuth } from '../../store/authStore'
import {
  buildIncomeTableRows, calcIncomeTableSummary, parseTableAmount, planAddTableRow, planDeleteTableRow, searchAddableMembers, planClearAmount,
} from '../../logic/settlement'
import type { IncomeRowCategory, IncomeRowMethod } from '../../logic/settlement'
import type { Member } from '../../types'
import type { DuesStatus, DonationStatus } from '../../types/settlement'
import { compactMoneyInputStyle } from './moneyInputStyle'

// 정산 "참가자" 탭의 회비·찬조 입력표. 기존 카드형 SettlementParticipantForm을 대체한다.
// 데이터는 여전히 SettlementParticipant.dues/donation(참가자 1명당 회비 1개·찬조 1개)에 그대로
// 저장한다 — 표는 그 값을 "이름·구분·금액·결제수단" 행으로 펼쳐 보여줄 뿐, 새 컬렉션/필드를
// 만들지 않는다. 입력은 다른 정산 화면과 동일하게 즉시 로컬 반영되고(자동 서버 저장 아님),
// 아래 "임시저장"/"최종 게시" 버튼을 눌러야 Firestore에 실제로 반영된다(기존 saveDraft/
// confirmSettlement 액션을 그대로 재사용 — 동작·상태값 변경 없음).
//
// previewMode(개발 미리보기 전용): true면 "임시저장"/"최종 게시" 버튼이 saveDraft/confirmSettlement를
// 절대 호출하지 않는다(비활성화 + 안내 문구만 표시). 참가자 목록에 dev-scenario-* 같은 문서 ID가
// 있다는 사실만으로는 안전하지 않다 — Firebase Auth 세션이 남아있으면 실제 Firestore에 그대로
// 쓰여지기 때문에(운영 화면과 완전히 같은 코드 경로), UI 레벨에서 명시적으로 차단한다.

const DEFAULT_DUES_STATUS: DuesStatus = '미납'
const DEFAULT_DONATION_STATUS: DonationStatus = '미확인'

const fmt = (n: number) => n.toLocaleString('ko-KR')

const cellStyle: CSSProperties = { padding: '7px 6px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' }
const thStyle: CSSProperties = { ...cellStyle, fontWeight: 700, fontSize: 12, textAlign: 'left', whiteSpace: 'nowrap', background: '#f4f5f3' }

function AmountInput({ value, disabled, onCommit, ariaLabel }: {
  value: number | undefined; disabled: boolean; onCommit: (v: number | null) => void; ariaLabel: string
}) {
  // 로컬 문자열 버퍼(text, 콤마 없는 순수 숫자)로 편집 중인 값을 들고 있다가, blur 시점에만
  // 실제 반영한다. value가 undefined(=아직 입력 안 함)면 완전히 빈칸으로 보여주고, 0이면 "0"으로
  // 보여줘서 "아직 입력 안 함"과 "명시적으로 0원"을 화면에서 구분한다.
  const [text, setText] = useState(value === undefined ? '' : String(value))
  // 입력칸에는 "입력 금액 합계" 카드(fmt 함수)와 같은 천단위 콤마를 붙여 보여준다 — 저장/커밋되는
  // 값은 여전히 콤마 없는 순수 숫자(text)다.
  const displayText = text === '' ? '' : Number(text).toLocaleString('ko-KR')
  return (
    <input
      aria-label={ariaLabel}
      inputMode="numeric"
      disabled={disabled}
      placeholder="0"
      value={displayText}
      onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={() => onCommit(parseTableAmount(text))}
      // 지출 탭 금액칸과 같은 공용 스타일(compactMoneyInputStyle) 기반이되, 이 표는 "금액" 열
      // 자체를 좁게(약 90px) 유지해야 결제수단·찬조까지 한 화면에 들어오므로, 공용 스타일의
      // width:100%/minWidth:100 대신 이 표 전용의 더 좁은 고정폭(78px)으로 덮어써 셀 중앙에
      // 여백을 두고 배치한다(730,700처럼 7자리 숫자도 잘리지 않는 최소폭으로 확인함).
      style={{ ...compactMoneyInputStyle, width: 78, minWidth: 70, fontSize: 16, padding: '9px 6px' }}
    />
  )
}

function MethodSelect({ value, disabled, onChange, ariaLabel }: {
  value: IncomeRowMethod | undefined; disabled: boolean; onChange: (v: IncomeRowMethod) => void; ariaLabel: string
}) {
  // 기존 데이터에 '기타'가 남아있을 수 있으므로(과거 값), 현재 값이 '기타'일 때만 선택지에 보여준다
  // — 새로 고를 수 있는 값은 요청된 대로 현금/계좌이체 두 가지뿐이다.
  return (
    <select
      aria-label={ariaLabel}
      disabled={disabled}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value as IncomeRowMethod)}
      style={{ minWidth: 80, fontSize: 14, padding: '6px 2px' }}
    >
      <option value="" disabled>선택</option>
      <option value="현금">현금</option>
      <option value="계좌이체">계좌이체</option>
      {value === '기타' && <option value="기타">기타(과거 값)</option>}
    </select>
  )
}

const DUES_STATUS_OPTIONS: DuesStatus[] = ['미납', '미확인', '입금확인', '취소']
const DONATION_STATUS_OPTIONS: DonationStatus[] = ['미확인', '입금확인', '취소']

/**
 * 입금 확인 상태 선택칸. calcIncomeSummary는 이 값(특히 '계좌이체'+'미확인'/'입금확인')으로
 * 수입·미확인 합계를 가른다 — 예전 SettlementParticipantForm.tsx에는 있었지만 이 표로 옮기며
 * 빠졌던 컨트롤이다(그 결과 회비가 기본값 '미납'에 고정돼 계좌이체 미확인 합계에서 누락되는
 * 문제가 있었다 — tests/duesTable.test.tsx의 재현 테스트 참고).
 */
function StatusSelect<T extends string>({ value, options, disabled, onChange, ariaLabel }: {
  value: T; options: readonly T[]; disabled: boolean; onChange: (v: T) => void; ariaLabel: string
}) {
  return (
    <select
      aria-label={ariaLabel}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={{ minWidth: 80, fontSize: 12, padding: '4px 2px' }}
    >
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

export function DuesTable({ settlementId, previewMode = false, membersOverride }: {
  settlementId: string
  /** 개발 미리보기 전용. true면 저장 버튼이 실제 Firestore 액션을 절대 호출하지 않는다. */
  previewMode?: boolean
  membersOverride?: Member[]
}) {
  const settlement = useSettlementStore((s) => s.getById(settlementId))
  const addMemberParticipant = useSettlementStore((s) => s.addMemberParticipant)
  const addGuestParticipant = useSettlementStore((s) => s.addGuestParticipant)
  const updateDues = useSettlementStore((s) => s.updateDues)
  const updateDonation = useSettlementStore((s) => s.updateDonation)
  const removeParticipant = useSettlementStore((s) => s.removeParticipant)
  const saveDraft = useSettlementStore((s) => s.saveDraft)
  const confirmSettlement = useSettlementStore((s) => s.confirmSettlement)
  const syncStatus = useSettlementStore((s) => s.syncStatus)
  const { memberName } = useAuth()
  const realMembers = useApp((s) => s.members)
  // override는 개발 미리보기에서 가상 회원으로 회원 검색 흐름을 테스트할 때만 쓰인다(실제 useApp 데이터는 안 건드림).
  const members = membersOverride ?? realMembers

  // 아직 저장된 donation이 없는 참가자라도 "+찬조 추가"를 누르면 빈 찬조 행을 화면에 보여주기
  // 위한 화면 전용 상태(저장되지 않음 — 실제 donation은 금액을 입력해야 생긴다).
  const [openDonationIds, setOpenDonationIds] = useState<Set<string>>(new Set())
  const [memberSearch, setMemberSearch] = useState('')
  const [addForm, setAddForm] = useState<{ name: string; category: IncomeRowCategory; amount: string; method: IncomeRowMethod | '' }>(
    { name: '', category: 'dues', amount: '', method: '' },
  )
  const [error, setError] = useState('')
  const [saveMsg, setSaveMsg] = useState('')

  if (!settlement) return <p className="muted">정산을 먼저 선택하거나 생성해주세요.</p>
  const locked = isLocked(settlement.status)
  const rows = buildIncomeTableRows(settlement.participants)
  const summary = calcIncomeTableSummary(settlement)
  const actorDisplayName = memberName ?? '관리자'

  const participantOf = (id: string) => settlement.participants.find((p) => p.id === id)!

  // 금액을 빈칸으로 지웠을 때: status/note/paidAt 같은 기존 메타데이터가 있으면 객체를 통째로
  // 지우지 않고 금액만 0으로 바꿔 나머지 값을 보존한다. 메타데이터가 전혀 없는(=방금 만들어졌거나
  // 기본값 그대로인) 신규 행만 완전히 지운다(null). 기존 amount:number 타입은 바꾸지 않는다.
  const commitDues = (participantId: string, v: number | null) => {
    if (v === null) {
      const plan = planClearAmount(participantOf(participantId).dues, DEFAULT_DUES_STATUS)
      updateDues(settlementId, participantId, plan.action === 'set-zero' ? { amount: 0 } : null)
    } else {
      updateDues(settlementId, participantId, { amount: v })
    }
  }
  const commitDonation = (participantId: string, v: number | null) => {
    if (v === null) {
      const plan = planClearAmount(participantOf(participantId).donation, DEFAULT_DONATION_STATUS)
      updateDonation(settlementId, participantId, plan.action === 'set-zero' ? { amount: 0 } : null)
    } else {
      updateDonation(settlementId, participantId, { amount: v })
    }
  }

  const deleteDonationRow = (participantId: string) => {
    const p = participantOf(participantId)
    const plan = planDeleteTableRow(p, 'donation')
    if (plan.action === 'remove-participant') removeParticipant(settlementId, participantId)
    else updateDonation(settlementId, participantId, null)
    setOpenDonationIds((s) => { const next = new Set(s); next.delete(participantId); return next })
  }

  // 회원 검색으로 추가 — 이미 정산 참가자에 있는 회원은 검색 결과에서 제외한다(중복 추가 자체가
  // 불가능하도록, searchAddableMembers). 회원명부(useApp)는 이 액션이 절대 수정하지 않는다 —
  // addMemberParticipant는 settlementStore(정산 전용 상태)에만 참가자를 추가한다.
  const candidateMembers = searchAddableMembers(members, settlement.participants, memberSearch)

  const submitAddRow = () => {
    setError('')
    const plan = planAddTableRow(settlement.participants, addForm.name, addForm.category)
    if (plan.action === 'blocked') { setError(plan.error); return }
    const amount = addForm.amount === '' ? undefined : parseTableAmount(addForm.amount) ?? undefined
    const patch = { ...(amount !== undefined ? { amount } : {}), ...(addForm.method ? { method: addForm.method } : {}) }

    if (plan.action === 'create-guest') {
      const res = addGuestParticipant(settlementId, addForm.name)
      if (!res.ok) { setError(res.error); return }
      // addGuestParticipant는 항상 배열 끝에 새로 추가하므로, 동명이인이 있어도 마지막(가장 최근) 매치를 쓴다.
      const matches = useSettlementStore.getState().getById(settlementId)!.participants.filter((p) => p.displayName === addForm.name.trim())
      const created = matches[matches.length - 1]!
      if (addForm.category === 'dues') updateDues(settlementId, created.id, patch)
      else updateDonation(settlementId, created.id, patch)
    } else {
      if (addForm.category === 'dues') updateDues(settlementId, plan.participantId, patch)
      else updateDonation(settlementId, plan.participantId, patch)
    }
    setAddForm({ name: '', category: 'dues', amount: '', method: '' })
  }

  const doSaveDraft = async () => {
    if (previewMode) return // 이중 방어 — 버튼은 비활성화돼 있지만, 혹시라도 호출되면 여기서도 막는다.
    setSaveMsg('저장 중...')
    const res = await saveDraft(settlementId)
    setSaveMsg(res.ok ? '임시저장 완료' : res.error)
  }
  const doConfirm = async () => {
    if (previewMode) return
    if (!window.confirm('정산을 최종 게시할까요? 게시 후에는 표를 수정할 수 없습니다.')) return
    setSaveMsg('저장 중...')
    const res = await confirmSettlement(settlementId, actorDisplayName)
    setSaveMsg(res.ok ? '최종 게시 완료' : res.error)
  }

  return (
    <div className="col-card">
      {locked && (
        <p className="info-msg">확정된 정산입니다. 표를 수정하려면 "집계/확정" 탭에서 먼저 "정산 수정"을 눌러주세요.</p>
      )}

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={{ width: '100%', minWidth: 394, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, minWidth: 92, textAlign: 'center', position: 'sticky', left: 0, background: '#f4f5f3', zIndex: 1 }}>이름</th>
              <th style={{ ...thStyle, minWidth: 58, textAlign: 'center' }}>구분</th>
              <th style={{ ...thStyle, minWidth: 90, textAlign: 'center' }}>금액</th>
              <th style={{ ...thStyle, minWidth: 98, textAlign: 'center' }}>결제수단</th>
              <th style={{ ...thStyle, minWidth: 56 }}></th>
            </tr>
          </thead>
          <tbody>
            {settlement.participants.length === 0 && (
              <tr><td colSpan={5} style={{ ...cellStyle, textAlign: 'center' }} className="muted">아직 정산 대상자가 없습니다.</td></tr>
            )}
            {settlement.participants.map((p) => {
              const duesRow = rows.find((r) => r.participantId === p.id && r.category === 'dues')!
              const donationRow = rows.find((r) => r.participantId === p.id && r.category === 'donation')
              const showDonation = !!donationRow || openDonationIds.has(p.id)
              return (
                <Fragment key={p.id}>
                  <tr>
                    <td style={{
                      ...cellStyle, fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'center', position: 'sticky', left: 0, background: '#fff',
                      maxWidth: 92, overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {p.displayName}{p.participantType === 'guest' && <span className="muted" style={{ fontSize: 11 }}> (비회원)</span>}
                    </td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap', textAlign: 'center' }}>회비</td>
                    <td style={{ ...cellStyle, textAlign: 'center' }}>
                      <AmountInput
                        value={duesRow.amount} disabled={locked}
                        onCommit={(v) => commitDues(p.id, v)}
                        ariaLabel={`${p.displayName} 회비 금액`}
                      />
                    </td>
                    <td style={{ ...cellStyle, textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <MethodSelect
                          value={duesRow.method as IncomeRowMethod | undefined} disabled={locked}
                          onChange={(v) => updateDues(settlementId, p.id, { method: v })}
                          ariaLabel={`${p.displayName} 회비 결제수단`}
                        />
                        {duesRow.method === '계좌이체' && (
                          <StatusSelect
                            value={(duesRow.status as DuesStatus | undefined) ?? '미확인'} options={DUES_STATUS_OPTIONS} disabled={locked}
                            onChange={(v) => updateDues(settlementId, p.id, { status: v })}
                            ariaLabel={`${p.displayName} 회비 확인상태`}
                          />
                        )}
                      </div>
                    </td>
                    <td style={cellStyle}>
                      {!showDonation && !locked && (
                        <button type="button" onClick={() => setOpenDonationIds((s) => new Set(s).add(p.id))}
                          style={{ fontSize: 12, padding: '9px 10px', minHeight: 36, whiteSpace: 'nowrap' }}>
                          + 찬조
                        </button>
                      )}
                    </td>
                  </tr>
                  {showDonation && (
                    <tr>
                      <td style={{ ...cellStyle, position: 'sticky', left: 0, background: '#fff' }}></td>
                      <td style={{ ...cellStyle, whiteSpace: 'nowrap', textAlign: 'center' }}>찬조</td>
                      <td style={{ ...cellStyle, textAlign: 'center' }}>
                        <AmountInput
                          value={donationRow?.amount} disabled={locked}
                          onCommit={(v) => commitDonation(p.id, v)}
                          ariaLabel={`${p.displayName} 찬조 금액`}
                        />
                      </td>
                      <td style={{ ...cellStyle, textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <MethodSelect
                            value={donationRow?.method as IncomeRowMethod | undefined} disabled={locked}
                            onChange={(v) => updateDonation(settlementId, p.id, { method: v })}
                            ariaLabel={`${p.displayName} 찬조 결제수단`}
                          />
                          {donationRow?.method === '계좌이체' && (
                            <StatusSelect
                              value={(donationRow?.status as DonationStatus | undefined) ?? '미확인'} options={DONATION_STATUS_OPTIONS} disabled={locked}
                              onChange={(v) => updateDonation(settlementId, p.id, { status: v })}
                              ariaLabel={`${p.displayName} 찬조 확인상태`}
                            />
                          )}
                        </div>
                      </td>
                      <td style={cellStyle}>
                        {!locked && (
                          <button type="button" className="danger" onClick={() => deleteDonationRow(p.id)}
                            aria-label={`${p.displayName} 찬조 삭제`}
                            style={{ fontSize: 12, padding: '9px 10px', minHeight: 36, whiteSpace: 'nowrap' }}>
                            삭제
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {!locked && (
        <div className="card col-card">
          <span style={{ fontWeight: 700, fontSize: 14 }}>회원 검색으로 추가</span>
          <input
            aria-label="회원 이름 검색" placeholder="회원 이름 검색" value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
            style={{ fontSize: 15 }}
          />
          {candidateMembers.length > 0 && (
            <div className="chip-grid">
              {candidateMembers.map((m) => (
                <button
                  key={m.id} type="button" className="chip"
                  onClick={() => {
                    const res = addMemberParticipant(settlementId, m)
                    setError(res.ok ? '' : res.error)
                    if (res.ok) setMemberSearch('')
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
        <div className="card col-card">
          <span style={{ fontWeight: 700, fontSize: 14 }}>행 추가</span>
          <span className="muted" style={{ fontSize: 12 }}>
            비회원 납부자·외부 찬조자, 또는 참석자 명단에 없지만 정산에 포함해야 하는 사람을 추가합니다.
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input
              aria-label="추가할 사람 이름" placeholder="이름" value={addForm.name}
              onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              style={{ flex: '1 1 120px', minWidth: 100, fontSize: 15 }}
            />
            <select
              aria-label="구분" value={addForm.category}
              onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value as IncomeRowCategory }))}
              style={{ minWidth: 72 }}
            >
              <option value="dues">회비</option>
              <option value="donation">찬조</option>
            </select>
            <input
              aria-label="금액" inputMode="numeric" placeholder="금액" value={addForm.amount}
              onChange={(e) => setAddForm((f) => ({ ...f, amount: e.target.value.replace(/[^0-9]/g, '') }))}
              style={{ width: 100, textAlign: 'right' }}
            />
            <select
              aria-label="결제수단" value={addForm.method}
              onChange={(e) => setAddForm((f) => ({ ...f, method: e.target.value as IncomeRowMethod }))}
              style={{ minWidth: 92 }}
            >
              <option value="">결제수단</option>
              <option value="현금">현금</option>
              <option value="계좌이체">계좌이체</option>
            </select>
          </div>
          <button type="button" className="primary block" onClick={submitAddRow} style={{ whiteSpace: 'nowrap' }}>행 추가</button>
          {error && <p className="info-msg" style={{ background: '#fdeceb', color: '#c0392b' }}>{error}</p>}
        </div>
      )}

      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 14 }}>입력 금액 합계</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 4, fontSize: 14 }}>
          <span>회비 합계</span><span style={{ textAlign: 'right' }}>{fmt(summary.duesTotal)}원</span>
          <span>찬조 합계</span><span style={{ textAlign: 'right' }}>{fmt(summary.donationTotal)}원</span>
          <span style={{ fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 4 }}>총수입(입력 기준)</span>
          <span style={{ fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 4, textAlign: 'right' }}>{fmt(summary.totalIncome)}원</span>
          <span style={{ borderTop: '1px solid var(--border)', paddingTop: 4 }}>현금 합계</span>
          <span style={{ borderTop: '1px solid var(--border)', paddingTop: 4, textAlign: 'right' }}>{fmt(summary.cashTotal)}원</span>
          <span>계좌이체 합계</span><span style={{ textAlign: 'right' }}>{fmt(summary.transferTotal)}원</span>
        </div>
        <span className="muted" style={{ fontSize: 11 }}>
          * 아래 합계는 입금 확인 상태와 관계없이 표에 입력된 금액을 그대로 합산한 값입니다.
          "집계/확정" 탭의 총수입은 계좌이체 미확인 건을 제외한 확정 금액이라 이 표의 합계와 다를 수 있습니다.
        </span>
      </div>

      {previewMode && (
        <p className="info-msg" style={{ background: '#fff8e1', color: '#7a5c00' }}>
          ⚠ 개발 미리보기에서는 저장되지 않습니다. 아래 버튼은 실제 Firestore에 반영되지 않습니다.
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled={previewMode || syncStatus === 'saving'} onClick={doSaveDraft} style={{ whiteSpace: 'nowrap' }}>
          임시저장
        </button>
        <button type="button" className="primary" disabled={previewMode || syncStatus === 'saving' || locked} onClick={doConfirm} style={{ whiteSpace: 'nowrap' }}>
          최종 게시
        </button>
      </div>
      {!previewMode && saveMsg && <p className="muted" style={{ fontSize: 12 }}>{saveMsg}</p>}
    </div>
  )
}

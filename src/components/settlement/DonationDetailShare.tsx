import { useState } from 'react'
import type { RegularSettlement } from '../../types/settlement'
import {
  DONATION_THANK_YOU_LINES, NO_CONFIRMED_DONATION_TEXT,
  buildDonationDetail, buildDonationDetailText, normalizeGiftDonationText,
} from '../../lib/settlementShareText'
import { shareText } from '../../lib/share'

// 공유 탭의 "찬조 상세내역" — 찬조금 미리보기 → 물품찬조 직접입력 → 감사문구 미리보기 → 공유 버튼 순서.
// 물품찬조 글은 이 화면(상위 컴포넌트의 메모리)에서만 쓰이고 Firestore 등 어디에도 저장하지 않는다.
// 공유는 기존 shareText(Web Share → 안 되면 클립보드 복사)를 그대로 쓴다 — 새 공유 라이브러리 없음.

const fmt = (n: number) => `${n.toLocaleString('ko-KR')}원`

export function DonationDetailShare({ settlement, giftText, onGiftTextChange }: {
  settlement: RegularSettlement
  giftText: string
  onGiftTextChange: (v: string) => void
}) {
  const [msg, setMsg] = useState('')
  const { donors, total } = buildDonationDetail(settlement)
  const hasGifts = normalizeGiftDonationText(giftText) !== ''
  const nothingToShare = donors.length === 0 && !hasGifts

  const doShare = async () => {
    const copied = await shareText(buildDonationDetailText(settlement, giftText))
    setMsg(copied ? '클립보드에 복사했습니다.' : '공유 창을 열었습니다.')
  }

  return (
    <div className="col-card" data-testid="donation-detail-share">
      <div className="card col-card" style={{ background: '#fff' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>🎁 찬조금 미리보기</span>
        {donors.length === 0 ? (
          <p className="muted" style={{ fontSize: 15 }}>{NO_CONFIRMED_DONATION_TEXT}</p>
        ) : (
          <>
            {donors.map((d, i) => (
              <div
                key={`${d.name}-${i}`}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 16, lineHeight: 1.6 }}
              >
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{d.name}</span>
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(d.amount)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 6, fontWeight: 700, fontSize: 16 }}>
              <span>찬조금 합계</span>
              <span style={{ whiteSpace: 'nowrap' }}>{fmt(total)}</span>
            </div>
          </>
        )}
        <p className="muted" style={{ fontSize: 12 }}>
          입금 확인된 찬조만 나옵니다(현금은 바로 확인된 것으로 봅니다). 한 사람이 여러 번 냈으면 합계로 한 줄에 나옵니다.
        </p>
      </div>

      <div className="card col-card" style={{ background: '#fff' }}>
        <label htmlFor="gift-donation-input" style={{ fontWeight: 700, fontSize: 16 }}>🎁 물품찬조 직접입력</label>
        <p className="muted" style={{ fontSize: 12 }}>
          한 줄에 한 명씩 입력하세요. 비워 두면 공유문에서 빠집니다. 이 화면에서만 쓰이고 서버에는 저장되지 않으니, 공유 전에 확인해 주세요.
        </p>
        <textarea
          id="gift-donation-input" value={giftText} onChange={(e) => onGiftTextChange(e.target.value)}
          placeholder={'예)\n김OO - 와인 2병\n이OO - 상품권 10만원\n박OO - 당구용품 3세트'}
          rows={6}
          style={{ width: '100%', boxSizing: 'border-box', minHeight: 140, fontSize: 16, lineHeight: 1.5, padding: 12, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      <div className="card col-card" style={{ background: '#fff' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>🙏 감사문구 미리보기</span>
        <div data-testid="donation-thank-you" style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.7, overflowWrap: 'anywhere' }}>
          {DONATION_THANK_YOU_LINES.join('\n')}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>공유문의 맨 아래에 항상 들어갑니다.</p>
      </div>

      <button
        type="button" className="primary block" onClick={doShare} disabled={nothingToShare}
        style={{ minHeight: 52, fontSize: 17, fontWeight: 700 }}
      >
        찬조 상세내역 공유
      </button>
      {nothingToShare && <p className="muted" style={{ fontSize: 13 }}>공유할 찬조 내역이 없습니다. 확인된 찬조금이나 물품찬조를 입력하면 공유할 수 있습니다.</p>}
      {msg && <p className="info-msg">{msg}</p>}
    </div>
  )
}

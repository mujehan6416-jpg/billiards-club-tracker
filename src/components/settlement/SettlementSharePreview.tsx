import { useRef, useState } from 'react'
import { useSettlementStore } from '../../store/settlementStore'
import { shareImage, shareText } from '../../lib/share'

type Audience = 'member' | 'president'

export function SettlementSharePreview({ settlementId }: { settlementId: string }) {
  const settlement = useSettlementStore((s) => s.getById(settlementId))
  const getMemberShareText = useSettlementStore((s) => s.getMemberShareText)
  const getPresidentShareText = useSettlementStore((s) => s.getPresidentShareText)
  const [audience, setAudience] = useState<Audience>('member')
  const [msg, setMsg] = useState('')
  const previewRef = useRef<HTMLDivElement>(null)

  if (!settlement) return null

  const text = audience === 'member' ? getMemberShareText(settlementId) : getPresidentShareText(settlementId)

  const doCopy = async () => {
    const copied = await shareText(text)
    setMsg(copied ? '클립보드에 복사했습니다.' : '공유 창을 열었습니다.')
  }

  const doImage = async () => {
    if (!previewRef.current) return
    await shareImage(previewRef.current, `정산_${settlement.meetingDate}_${audience === 'member' ? '회원용' : '회장용'}.png`)
    setMsg('이미지를 생성했습니다.')
  }

  return (
    <div className="col-card">
      {settlement.status !== 'confirmed' && (
        <p className="info-msg">아직 확정되지 않은 정산입니다. 미리보기 형식만 확인하고, 실제 공유는 확정 후 진행해주세요.</p>
      )}
      <div className="seg">
        <button type="button" className={audience === 'member' ? 'on' : ''} onClick={() => setAudience('member')}>회원용</button>
        <button type="button" className={audience === 'president' ? 'on' : ''} onClick={() => setAudience('president')}>회장 보고용</button>
      </div>

      <div ref={previewRef} className="card" style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.6, background: '#fff' }}>
        {text}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="primary grow" onClick={doCopy}>문구 복사 / 공유</button>
        <button type="button" className="grow" onClick={doImage}>이미지 저장 / 공유</button>
      </div>
      {msg && <p className="info-msg">{msg}</p>}

      {audience === 'president' && (
        <p className="muted" style={{ fontSize: 12 }}>회장 보고용은 통장 잔액 등 내부 정보를 포함하므로 회원에게 전달하지 마세요.</p>
      )}
    </div>
  )
}

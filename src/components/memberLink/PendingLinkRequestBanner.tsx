import { DEVICE_LINK_ADMIN_CARD_ID } from './DeviceLinkAdminCard'
import { usePendingLinkRequestCount } from './usePendingLinkRequestCount'

/**
 * 관리자 상단 알림 — "🔔 기기등록 요청 N건".
 *
 * 회원이 새 기기에서 연결을 요청하면 관리자가 그 사실을 놓치기 쉬워서, 관리자가 앱을 쓰는
 * 동안 화면 맨 위에 눈에 띄게 보여준다. 누르면 설정 탭의 기존 승인 카드로 바로 이동한다 —
 * 승인 화면을 새로 만들지 않는다.
 *
 * 개인정보: 여기에는 건수만 쓴다. 회원 이름·기기 코드·UID는 승인 카드 안에서만 보여준다.
 *
 * 대기 건수가 0이면 아무것도 그리지 않는다(관리자 화면을 복잡하게 만들지 않는다).
 */
export function PendingLinkRequestBanner({ onOpen }: { onOpen: () => void }) {
  const count = usePendingLinkRequestCount()

  if (count <= 0) return null

  return (
    <button
      type="button"
      onClick={onOpen}
      // 고령 회원도 쓰는 앱이라 작은 빨간 점 대신 문장으로 보여주고, 글씨와 터치 영역을 크게 잡는다.
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        background: '#b9531b',
        color: '#fff',
        border: 'none',
        borderRadius: 0,
        padding: '14px 16px',
        fontSize: 16,
        fontWeight: 600,
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span>🔔 기기등록 요청 {count}건</span>
      <span style={{ fontSize: 14, fontWeight: 500 }}>확인하기 ›</span>
    </button>
  )
}

/**
 * 설정 탭의 기기 연결 승인 카드가 화면에 보이도록 스크롤한다.
 *
 * 탭을 막 바꾼 직후에는 아직 그 카드가 그려지기 전일 수 있어서, 잠깐 기다렸다가 몇 번만
 * 다시 찾아본다(최대 약 0.5초). 찾지 못하면 조용히 포기한다 — 설정 탭으로는 이미 이동했으므로
 * 관리자가 화면을 내리면 카드를 볼 수 있다.
 */
export function scrollToDeviceLinkAdminCard(attempt = 0): void {
  const el = document.getElementById(DEVICE_LINK_ADMIN_CARD_ID)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  if (attempt < 10) {
    setTimeout(() => scrollToDeviceLinkAdminCard(attempt + 1), 50)
  }
}

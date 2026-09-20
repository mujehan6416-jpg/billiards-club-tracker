/**
 * 숫자 없는 당구공 아이콘.
 *
 * 이모지(🎱)는 운영체제·기기마다 모양이 달라지고 숫자 8이 그려져 있어서 쓰지 않는다.
 * 여기서는 작은 SVG로 직접 그려 어느 기기에서나 같은 모양이 보이게 한다.
 *
 * 모임 = 검은 공, 대회 = 노란 공으로 쓴다. 장식용이라 읽어주는 이름을 갖지 않는다
 * (aria-hidden) — 버튼의 이름은 옆에 있는 '모임'·'대회' 글자가 담당한다.
 */

export type BallColor = 'black' | 'yellow'

const PALETTE: Record<BallColor, { base: string; shade: string; edge: string }> = {
  // 검은 공 — 완전한 검정 대신 살짝 밝은 먹색을 써야 공처럼 둥글게 보인다.
  black: { base: '#2f3336', shade: '#15181a', edge: '#0b0d0e' },
  // 노란 공 — 흐린 노랑은 흰 배경에서 잘 안 보여 진한 노랑을 쓴다.
  yellow: { base: '#f7c93e', shade: '#d99b0b', edge: '#a9730a' },
}

interface Props {
  color: BallColor
  /** 지름(px). 하단 탭은 24, 홈 메뉴는 30 정도를 쓴다. */
  size?: number
}

export function BilliardBall({ color, size = 24 }: Props) {
  const { base, shade, edge } = PALETTE[color]
  // 색깔별로 그라데이션 id가 겹치면 한 화면에 두 공을 같이 놓았을 때 서로 색을 덮어쓴다.
  const gradientId = `ball-grad-${color}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <radialGradient id={gradientId} cx="36%" cy="30%" r="72%">
          <stop offset="0%" stopColor={base} />
          <stop offset="62%" stopColor={base} />
          <stop offset="100%" stopColor={shade} />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="14.5" fill={`url(#${gradientId})`} stroke={edge} strokeWidth="1" />
      {/* 빛 반사 — 이게 있어야 납작한 원이 아니라 공으로 보인다. */}
      <ellipse cx="11.5" cy="10.5" rx="4.6" ry="3.4" fill="#ffffff" opacity="0.55" transform="rotate(-25 11.5 10.5)" />
    </svg>
  )
}

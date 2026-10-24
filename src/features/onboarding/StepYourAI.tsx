import { useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Monitor, CreditCard, Key, Users, Coins, RefreshCw, Lock } from 'lucide-react'
import { Button } from '../../ui/ds/Button'

type AiMode = 'self-host' | 'cloud'
type SelfHostOption = 'desktop' | 'subscription' | 'api-key'
type CloudOption = 'free-credits' | 'credit-pack' | 'monthly'

interface GoodToKnowItem {
  icon: ReactNode
  title: string
  desc: string
}

const SELF_HOST_GOOD: GoodToKnowItem[] = [
  {
    icon: <Users size={15} />,
    title: 'It runs your whole team',
    desc: 'Every helper and every job uses the AI you connect here.',
  },
  {
    icon: <Coins size={15} />,
    title: 'Costs stay with you',
    desc: 'A sign-in or subscription costs nothing extra. With a key, you pay your provider directly.',
  },
  {
    icon: <RefreshCw size={15} />,
    title: 'Change it anytime',
    desc: 'Add more accounts later and Omilo spreads jobs across them.',
  },
  {
    icon: <Lock size={15} />,
    title: 'Your data stays yours',
    desc: 'Omilo runs on this computer. We never see your chats or files.',
  },
]

const CLOUD_GOOD: GoodToKnowItem[] = [
  {
    icon: <Monitor size={15} />,
    title: 'Always on',
    desc: 'Helpers run in the cloud, so jobs finish while you sleep or travel.',
  },
  {
    icon: <Coins size={15} />,
    title: 'Pay as you use',
    desc: 'Credits are only spent when a helper works. Set a monthly cap in Billing.',
  },
  {
    icon: <CreditCard size={15} />,
    title: 'Best models included',
    desc: 'We pick the right model for each job. No API keys to manage.',
  },
  {
    icon: <Lock size={15} />,
    title: 'Encrypted and yours',
    desc: 'Your notes and files are encrypted in Omilo Cloud. Export or delete anytime.',
  },
]

interface StepYourAIProps {
  onBack: () => void
  onNext: () => void
}

export function StepYourAI({ onBack, onNext }: StepYourAIProps) {
  const [mode, setMode] = useState<AiMode>('self-host')
  const [selfHostOption, setSelfHostOption] = useState<SelfHostOption>('desktop')
  const [cloudOption, setCloudOption] = useState<CloudOption>('free-credits')

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Main content */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Step label */}
        <div className="px-[40px] pt-[28px]">
          <span className="text-[12px] text-muted">Step 1 of 4</span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-[20px] overflow-y-auto px-[40px] pb-[24px] pt-[10px]">
          {/* Heading */}
          <div className="flex flex-col gap-[8px]">
            <h2
              className="m-0 font-display text-[28px] font-semibold leading-tight tracking-[-0.4px] text-ink"
              style={{ fontVariationSettings: '"opsz" 96' }}
            >
              Which AI should your team think with?
            </h2>
            <p className="m-0 text-[13.5px] leading-[1.5] text-muted">
              Your helpers, and our chat next, run on it. Pick what you already have; you can change
              it anytime in AI accounts.
            </p>
          </div>

          {/* Mode tabs */}
          <div
            className="flex rounded-md overflow-hidden"
            style={{ border: '1px solid var(--color-line-strong)', width: 'fit-content' }}
          >
            {(['self-host', 'cloud'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className="px-[16px] py-[7px] text-[12.5px] font-medium transition-colors"
                style={{
                  background: mode === m ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: mode === m ? 'var(--color-primary-ink)' : 'var(--color-ink)',
                  borderRight: m === 'self-host' ? '1px solid var(--color-line-strong)' : 'none',
                }}
              >
                {m === 'self-host' ? 'Self-host' : 'Cloud'}
              </button>
            ))}
          </div>

          {/* Tab description */}
          <p className="m-0 text-[12.5px] text-muted">
            {mode === 'self-host'
              ? 'Runs on this computer with the AI you already have.'
              : 'Runs on Omilo Cloud. Pay with credits, no AI account needed.'}
          </p>

          {/* Options */}
          {mode === 'self-host' ? (
            <div className="flex flex-col gap-[8px]">
              <SelfHostRadio
                id="desktop"
                selected={selfHostOption === 'desktop'}
                onSelect={() => setSelfHostOption('desktop')}
                icon={<Monitor size={15} />}
                title="Already signed in on this computer"
                badge="Recommended"
                description="No key, no extra cost. Your login never leaves this machine."
                extra={
                  <div className="flex items-center gap-[6px] text-[12px] text-muted">
                    <span>Claude Code 2.1.169</span>
                    <span>·</span>
                    <span>signed in on this computer</span>
                    <span className="ml-auto text-link font-medium cursor-pointer hover:underline">
                      Use another
                    </span>
                  </div>
                }
              />
              <SelfHostRadio
                id="subscription"
                selected={selfHostOption === 'subscription'}
                onSelect={() => setSelfHostOption('subscription')}
                icon={<CreditCard size={15} />}
                title="A subscription you already pay for"
                description="Like Claude Pro or Max. Sign in once in your browser."
              />
              <SelfHostRadio
                id="api-key"
                selected={selfHostOption === 'api-key'}
                onSelect={() => setSelfHostOption('api-key')}
                icon={<Key size={15} />}
                title="An API key"
                description="Pay as you go with your own key."
                extra={
                  <div className="flex items-center gap-[8px]">
                    {['Anthropic', 'OpenAI', 'Google', 'More…'].map((p) => (
                      <span
                        key={p}
                        className="rounded-pill px-[8px] py-[2px] text-[11.5px] text-muted"
                        style={{ background: 'var(--color-soft)', border: '1px solid var(--color-line-strong)' }}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                }
              />
            </div>
          ) : (
            <div className="flex flex-col gap-[8px]">
              <CloudRadio
                id="free-credits"
                selected={cloudOption === 'free-credits'}
                onSelect={() => setCloudOption('free-credits')}
                icon={<Monitor size={15} />}
                title="Start with 1,000 free credits"
                badge="Recommended"
                description="About 2 weeks for a small team. No card needed."
                extra={
                  <div className="flex items-center gap-[6px] text-[12px] text-muted">
                    <span>1 credit = 1 helper step</span>
                    <span>·</span>
                    <span>usage shown live in Billing</span>
                    <span className="ml-auto text-link font-medium cursor-pointer hover:underline">
                      See pricing
                    </span>
                  </div>
                }
              />
              <CloudRadio
                id="credit-pack"
                selected={cloudOption === 'credit-pack'}
                onSelect={() => setCloudOption('credit-pack')}
                icon={<CreditCard size={15} />}
                title="Buy a credit pack"
                description="Top up anytime. Credits never expire."
              />
              <CloudRadio
                id="monthly"
                selected={cloudOption === 'monthly'}
                onSelect={() => setCloudOption('monthly')}
                icon={<RefreshCw size={15} />}
                title="Monthly plan"
                description="Credits refill every month. Cancel anytime."
                extra={
                  <div className="flex items-center gap-[8px]">
                    {['Starter · 5k credits', 'Team · 20k credits', 'Scale · 60k credits'].map((p) => (
                      <span
                        key={p}
                        className="rounded-pill px-[8px] py-[2px] text-[11.5px] text-muted"
                        style={{ background: 'var(--color-soft)', border: '1px solid var(--color-line-strong)' }}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                }
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex h-[56px] shrink-0 items-center gap-[12px] px-[40px]"
          style={{ borderTop: '1px solid var(--color-line-strong)' }}
        >
          <Button variant="secondary" icon={ArrowLeft} onClick={onBack}>
            Back
          </Button>
          <span className="flex-1" />
          {mode === 'self-host' ? (
            <>
              <span className="text-[12px] text-muted">
                No AI yet?{' '}
                <span className="cursor-pointer text-link hover:underline">
                  Try with fixed questions
                </span>
              </span>
              <Button variant="primary" icon={ArrowRight} onClick={onNext}>
                Connect and continue
              </Button>
            </>
          ) : (
            <>
              <span className="text-[12px] text-muted">
                Have your own AI?{' '}
                <span className="cursor-pointer text-link hover:underline" onClick={() => setMode('self-host')}>
                  Switch to Self-host
                </span>
              </span>
              <Button variant="primary" icon={ArrowRight} onClick={onNext}>
                Start free and continue
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Right panel */}
      <GoodToKnow items={mode === 'self-host' ? SELF_HOST_GOOD : CLOUD_GOOD} />
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RadioOption({
  selected,
  onSelect,
  badge,
  icon,
  title,
  description,
  extra,
}: {
  selected: boolean
  onSelect: () => void
  badge?: string
  icon: ReactNode
  title: string
  description: string
  extra?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full flex-col gap-[10px] rounded-lg p-[14px] text-left transition-colors"
      style={{
        border: selected
          ? '1.5px solid var(--color-primary)'
          : '1px solid var(--color-line-strong)',
        background: 'var(--color-surface)',
      }}
    >
      <div className="flex w-full items-center gap-[8px]">
        {/* Radio dot */}
        <div
          className="flex size-[16px] shrink-0 items-center justify-center rounded-full"
          style={{
            border: selected
              ? '4.5px solid var(--color-primary)'
              : '1.5px solid var(--color-line-strong)',
          }}
        />
        <span className="shrink-0 text-muted">{icon}</span>
        <span className="text-[13.5px] font-medium text-ink">{title}</span>
        {badge && (
          <span
            className="ml-auto rounded-pill px-[8px] py-[2px] text-[11px] font-medium"
            style={{
              background: 'var(--color-field-indigo)',
              color: 'var(--color-helper-brand)',
            }}
          >
            {badge}
          </span>
        )}
      </div>
      <p className="m-0 pl-[24px] text-[12.5px] leading-[1.45] text-muted">{description}</p>
      {extra && <div className="pl-[24px]">{extra}</div>}
    </button>
  )
}

function SelfHostRadio(
  props: Parameters<typeof RadioOption>[0] & { id: SelfHostOption },
) {
  return <RadioOption {...props} />
}

function CloudRadio(
  props: Parameters<typeof RadioOption>[0] & { id: CloudOption },
) {
  return <RadioOption {...props} />
}

function GoodToKnow({ items }: { items: GoodToKnowItem[] }) {
  return (
    <div
      className="flex w-[280px] shrink-0 flex-col gap-[18px] overflow-y-auto px-[28px] py-[32px]"
      style={{ borderLeft: '1px solid var(--color-line-strong)' }}
    >
      <p className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
        Good to know
      </p>
      <div className="flex flex-col gap-[18px]">
        {items.map((item) => (
          <div key={item.title} className="flex flex-col gap-[4px]">
            <div className="flex items-center gap-[8px] text-ink-2">
              <span className="shrink-0 text-muted">{item.icon}</span>
              <span className="text-[13px] font-medium">{item.title}</span>
            </div>
            <p className="m-0 pl-[23px] text-[12px] leading-[1.5] text-muted">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

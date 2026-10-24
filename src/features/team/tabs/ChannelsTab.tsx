import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import type { HelperRecord, ConnectedChannel } from '../teamData'
import { ConnectTelegramDialog } from '../channel-dialogs/ConnectTelegramDialog'
import { ConnectWhatsAppDialog } from '../channel-dialogs/ConnectWhatsAppDialog'
import { ConnectEmailDialog } from '../channel-dialogs/ConnectEmailDialog'

// ── Channel row ────────────────────────────────────────────────────────────────

function ChannelIcon({ id }: { id: string }) {
  if (id === 'omilo') return <span className="text-[16px]">💬</span>
  if (id === 'whatsapp') return <span className="text-[16px]" style={{ color: '#25D366' }}>●</span>
  if (id === 'telegram') return <span className="text-[16px]" style={{ color: '#2AABEE' }}>✈</span>
  if (id === 'email') return <span className="text-[16px]">✉</span>
  if (id === 'slack') return <span className="text-[16px]">#</span>
  return <span className="text-[16px]">📡</span>
}

function BuiltInBadge() {
  return (
    <span className="rounded-pill bg-line-strong px-[8px] py-[2px] text-[11px] text-muted">
      Built in · always on
    </span>
  )
}

function ConnectedBadge() {
  return (
    <span className="flex items-center gap-[4px] rounded-pill bg-ok-tint px-[8px] py-[2px] text-[11px] font-medium text-ok">
      ✓ Connected
    </span>
  )
}

function ComingSoonBadge() {
  return (
    <span className="rounded-pill bg-line-strong px-[8px] py-[2px] text-[11px] text-muted">
      Coming soon
    </span>
  )
}

interface ConnectedWhatsAppExpandedProps {
  channel: ConnectedChannel
}

function ConnectedWhatsAppExpanded({ channel }: ConnectedWhatsAppExpandedProps) {
  return (
    <div className="mt-[10px] flex flex-col gap-[12px] pl-[36px]">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[12px] font-medium text-ink">Who can start a chat</div>
          <div className="text-[11.5px] text-muted">Unknown numbers get a short intro first.</div>
        </div>
        <div className="flex gap-[4px]">
          <button type="button" className="h-[24px] rounded-pill bg-primary px-[10px] text-[11.5px] font-medium text-primary-ink">
            Anyone
          </button>
          <button type="button" className="h-[24px] rounded-pill bg-soft px-[10px] text-[11.5px] text-muted outline-1 -outline-offset-1 outline-line-strong">
            Known residents
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[12px] font-medium text-ink">When {channel.name} replies</div>
        </div>
        <div className="flex gap-[4px]">
          <button type="button" className="h-[24px] rounded-pill bg-primary px-[10px] text-[11.5px] font-medium text-primary-ink">
            Always
          </button>
          <button type="button" className="h-[24px] rounded-pill bg-soft px-[10px] text-[11.5px] text-muted outline-1 -outline-offset-1 outline-line-strong">
            Work hours
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[12px] font-medium text-ink">Hand off to a person</div>
          <div className="text-[11.5px] text-muted">After 2 tries without an answer, Support pings you and tells the resident.</div>
        </div>
        {/* toggle on */}
        <div className="relative h-[18px] w-[30px] rounded-full bg-ok" aria-hidden>
          <span className="absolute top-[2px] left-[14px] size-[14px] rounded-full bg-surface shadow-sm" />
        </div>
      </div>
      <button
        type="button"
        className="self-start rounded-md bg-bad-tint px-[10px] py-[5px] text-[12px] font-medium text-bad outline-1 -outline-offset-1 outline-bad-line hover:bg-bad-tint/80 transition-colors"
      >
        Disconnect
      </button>
    </div>
  )
}

// ── ChannelsTab ────────────────────────────────────────────────────────────────

interface ChannelsTabProps {
  helper: HelperRecord
}

export function ChannelsTab({ helper }: ChannelsTabProps) {
  const [whatsappExpanded, setWhatsappExpanded] = useState(false)
  const [telegramOpen, setTelegramOpen] = useState(false)
  const [whatsappOpen, setWhatsappOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)

  const connected = helper.channels.filter((c) => c.builtIn || c.connected)
  const addable = helper.channels.filter((c) => !c.builtIn && !c.connected)

  return (
    <>
      <div className="flex flex-col gap-[24px]">
        {/* Intro */}
        <div>
          <h3 className="m-0 text-[13px] font-medium text-ink mb-[4px]">
            Where people can reach {helper.name}
          </h3>
          <p className="m-0 text-[12.5px] text-muted">
            Omilo chat is always on. Connect another app and {helper.name} answers there too — same memory, same rules, every conversation lands back in #{helper.name.toLowerCase()}.
          </p>
        </div>

        {/* Connected channels */}
        {connected.length > 0 && (
          <div>
            <div className="text-[10.5px] font-medium tracking-[0.55px] text-faint uppercase mb-[8px]">
              Connected {connected.length}
            </div>
            <div className="flex flex-col gap-[1px]">
              {connected.map((ch) => (
                <div key={ch.id}>
                  <div className="flex items-center gap-[10px] rounded-md px-[2px] py-[10px]">
                    <ChannelIcon id={ch.id} />
                    <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                      <span className="text-[13px] font-medium text-ink">{ch.name}</span>
                      <span className="text-[11.5px] text-muted">{ch.meta}</span>
                    </div>
                    {ch.builtIn && <BuiltInBadge />}
                    {ch.connected && !ch.builtIn && (
                      <button
                        type="button"
                        onClick={() => setWhatsappExpanded((v) => !v)}
                        className="flex items-center gap-[4px]"
                      >
                        <ConnectedBadge />
                        {whatsappExpanded ? (
                          <ChevronUp size={13} className="text-muted" />
                        ) : (
                          <ChevronDown size={13} className="text-muted" />
                        )}
                      </button>
                    )}
                  </div>
                  {ch.connected && whatsappExpanded && (
                    <ConnectedWhatsAppExpanded channel={ch} />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add a channel */}
        {addable.length > 0 && (
          <div>
            <div className="text-[10.5px] font-medium tracking-[0.55px] text-faint uppercase mb-[8px]">
              Add a channel
            </div>
            <div className="flex flex-col gap-[1px]">
              {addable.map((ch) => (
                <div key={ch.id} className="flex items-center gap-[10px] rounded-md px-[2px] py-[10px]">
                  <ChannelIcon id={ch.id} />
                  <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                    <span className="text-[13px] font-medium text-ink">{ch.name}</span>
                    <span className="text-[11.5px] text-muted">{ch.meta}</span>
                  </div>
                  {ch.comingSoon ? (
                    <ComingSoonBadge />
                  ) : (
                    <Button
                      variant="secondary"
                      height={28}
                      onClick={() => {
                        if (ch.id === 'telegram') setTelegramOpen(true)
                        if (ch.id === 'whatsapp') setWhatsappOpen(true)
                        if (ch.id === 'email') setEmailOpen(true)
                      }}
                    >
                      + Connect
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {telegramOpen && <ConnectTelegramDialog onClose={() => setTelegramOpen(false)} />}
      {whatsappOpen && <ConnectWhatsAppDialog onClose={() => setWhatsappOpen(false)} />}
      {emailOpen && <ConnectEmailDialog onClose={() => setEmailOpen(false)} />}
    </>
  )
}

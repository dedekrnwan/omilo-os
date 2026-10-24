import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Mascot } from '../../../ui/ds/Mascot'
import { Button } from '../../../ui/ds/Button'
import { helperColor } from '../../../ui/tokens'
import type { HelperArea } from '../../../core/domain/types'
import type { HelperRecord } from '../teamData'
import { LetGoDialog } from '../LetGoDialog'

// Color swatches matching design ref
const COLORS: string[] = [
  '#6366F1', '#3B82F6', '#0EA5E9', '#06B6D4',
  '#10B981', '#65A30D', '#F59E0B', '#F97316',
  '#EF4444', '#EC4899', '#8B5CF6', '#64748B',
  '#D97706', '#059669',
]

interface ProfileTabProps {
  helper: HelperRecord
}

export function ProfileTab({ helper }: ProfileTabProps) {
  const [letGoOpen, setLetGoOpen] = useState(false)
  const color = helperColor[helper.area]

  return (
    <>
      <div className="flex flex-col gap-[28px]">
        {/* Look section */}
        <section>
          <h3 className="m-0 text-[13px] font-medium text-ink mb-[2px]">Look</h3>
          <p className="m-0 mb-[14px] text-[12px] text-muted">
            How {helper.name} appears in chats, the team list and notifications.
          </p>

          <div className="flex gap-[24px]">
            {/* Preview */}
            <Mascot size={72} radius={18} area={helper.area as HelperArea} title={helper.name} />

            <div className="flex flex-col gap-[12px]">
              {/* Color swatches */}
              <div>
                <div className="text-[11.5px] font-medium text-muted mb-[6px]">Colour</div>
                <div className="flex flex-wrap gap-[4px]">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      className="size-[18px] rounded-full transition-transform hover:scale-110"
                      style={{
                        background: c,
                        outline: c === color ? `2px solid ${c}` : undefined,
                        outlineOffset: c === color ? '2px' : undefined,
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Shape */}
              <div>
                <div className="text-[11.5px] font-medium text-muted mb-[6px]">Shape</div>
                <div className="flex gap-[6px]">
                  {[18, 8, 2].map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-label={`Shape ${r}`}
                      className={`size-[32px] rounded-sm outline-1 -outline-offset-1 outline-line-strong flex items-center justify-center transition-colors hover:bg-soft ${
                        r === 18 ? 'bg-hover outline-2 outline-primary' : 'bg-surface'
                      }`}
                    >
                      <Mascot size={20} radius={r * 20 / 64} area={helper.area as HelperArea} tile={false} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Prop */}
              <div>
                <div className="text-[11.5px] font-medium text-muted mb-[6px]">Prop</div>
                <div className="flex gap-[4px] flex-wrap">
                  {['👑', '🔧', '🎙', '📊', '💰', '🌿', '🏆', '🔍', '⚡', '🌐'].map((emoji, i) => (
                    <button
                      key={emoji}
                      type="button"
                      className={`size-[30px] rounded-sm text-[16px] flex items-center justify-center transition-colors ${
                        i === 0 ? 'bg-hover outline-2 outline-primary -outline-offset-1' : 'hover:bg-soft'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-[10px] mt-[2px]">
                <button type="button" className="text-[12px] text-link hover:underline flex items-center gap-[4px]">
                  Use a picture
                </button>
                <button type="button" className="text-[12px] text-muted hover:text-ink transition-colors">
                  Back to the original
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Name & role */}
        <section>
          <h3 className="m-0 text-[13px] font-medium text-ink mb-[12px]">Name &amp; role</h3>
          <div className="flex flex-col divide-y divide-line">
            <div className="flex items-start justify-between py-[10px]">
              <div>
                <div className="text-[13px] text-ink">Name</div>
                <div className="text-[11.5px] text-muted">What residents and the team call it.</div>
              </div>
              <input
                type="text"
                defaultValue={helper.name}
                className="w-[200px] rounded-md bg-soft px-[10px] py-[6px] text-[12.5px] text-ink text-right outline-1 -outline-offset-1 outline-line-strong focus:outline-2 focus:-outline-offset-1 focus:outline-primary"
              />
            </div>
            <div className="flex items-start justify-between py-[10px]">
              <div>
                <div className="text-[13px] text-ink">Job title</div>
                <div className="text-[11.5px] text-muted">Shown under the name in chats.</div>
              </div>
              <input
                type="text"
                defaultValue={helper.roleArea}
                className="w-[200px] rounded-md bg-soft px-[10px] py-[6px] text-[12.5px] text-ink text-right outline-1 -outline-offset-1 outline-line-strong focus:outline-2 focus:-outline-offset-1 focus:outline-primary"
              />
            </div>
            <div className="flex items-start justify-between py-[10px]">
              <div>
                <div className="text-[13px] text-ink">Reports to</div>
                <div className="text-[11.5px] text-muted">Gets its updates and escalations.</div>
              </div>
              <button
                type="button"
                className="flex items-center gap-[6px] rounded-md bg-soft px-[10px] py-[6px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-hover transition-colors"
              >
                <Mascot size={14} radius={4} area="brand" tile={false} />
                {helper.reportsTo}
                <ChevronDown size={12} aria-hidden className="text-muted" />
              </button>
            </div>
          </div>
        </section>

        {/* Pause or let go */}
        <section>
          <h3 className="m-0 text-[13px] font-medium text-ink mb-[12px]">Pause or let go</h3>
          <div className="flex flex-col divide-y divide-line">
            <div className="flex items-start justify-between py-[10px]">
              <div>
                <div className="text-[13px] text-ink">Pause {helper.name}</div>
                <div className="text-[11.5px] text-muted">
                  Stops all replies and loops. Residents see "we'll be right back". Resume anytime.
                </div>
              </div>
              <Button variant="secondary" height={28}>
                Pause
              </Button>
            </div>
            <div className="flex items-start justify-between py-[10px]">
              <div>
                <div className="text-[13px] text-ink">Let {helper.name} go</div>
                <div className="text-[11.5px] text-muted">
                  Open chats go back to you. Files and memory are kept 30 days so you can rehire it.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLetGoOpen(true)}
                className="flex items-center gap-[5px] rounded-btn px-[10px] h-[28px] text-[12.5px] font-medium text-bad bg-bad-tint outline-1 -outline-offset-1 outline-bad-line hover:bg-bad-tint/80 transition-colors"
              >
                Let {helper.name} go
              </button>
            </div>
          </div>
        </section>
      </div>

      {letGoOpen && <LetGoDialog helper={helper} onClose={() => setLetGoOpen(false)} />}
    </>
  )
}

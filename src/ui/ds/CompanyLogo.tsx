import type { CompanyDefaults } from './looks'
import { useCompanyLook } from './looks'

/** A company's logo tile: the uploaded image, else its initials on its colour. */
export function CompanyLogo({
  company,
  size,
  radius,
  fontSize,
  className = '',
}: {
  company: CompanyDefaults
  size: number
  radius: number
  fontSize: number
  className?: string
}) {
  const look = useCompanyLook(company)
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden font-semibold text-white ${className}`}
      style={{ width: size, height: size, borderRadius: radius, fontSize, background: look.image ? '#FFFFFF' : look.color }}
    >
      {look.image ? <img src={look.image} alt="" className="size-full object-cover" /> : look.initial}
    </span>
  )
}

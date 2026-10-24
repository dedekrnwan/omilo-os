import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import type { AreaFilter } from './OfficeSidebar'

interface OfficeAreaContextValue {
  area: AreaFilter
  setArea: (area: AreaFilter) => void
}

const OfficeAreaContext = createContext<OfficeAreaContextValue>({
  area: null,
  setArea: () => undefined,
})

export function OfficeAreaProvider({ children }: { children: ReactNode }) {
  const [area, setArea] = useState<AreaFilter>(null)
  return (
    <OfficeAreaContext.Provider value={{ area, setArea }}>
      {children}
    </OfficeAreaContext.Provider>
  )
}

export function useOfficeArea(): OfficeAreaContextValue {
  return useContext(OfficeAreaContext)
}

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Bike, Construction, Monitor, Moon, Settings2, Sun } from 'lucide-react'
import { appLanguage } from '../i18n'
import { setThemePreference, useColorScheme, type ThemePreference } from '../theme/colorScheme'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

type OptionsMenuProps = {
  showCityBikes: boolean
  onShowCityBikes: (show: boolean) => void
  showRoadworks: boolean
  onShowRoadworks: (show: boolean) => void
  className?: string
}

/** Map layers, language and appearance, behind one round button on the map. */
export function OptionsMenu({
  showCityBikes,
  onShowCityBikes,
  showRoadworks,
  onShowRoadworks,
  className,
}: OptionsMenuProps) {
  const { t, i18n } = useTranslation()
  const { preference } = useColorScheme()
  const lang = appLanguage(i18n.language)

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t('options.open')}
        className={cn(
          'flex size-12 items-center justify-center rounded-full bg-surface text-ink shadow-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-ink data-[state=open]:text-surface',
          className,
        )}
      >
        <Settings2 className="size-5" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={16}
        className="flex w-[min(320px,calc(100vw-32px))] flex-col gap-5 rounded-[var(--radius-sheet)] border-0 bg-surface p-5 shadow-xl"
      >
        <section className="flex flex-col gap-1">
          <h2 className="text-sm text-ink-muted">{t('options.showOnMap')}</h2>
          <SwitchRow
            id="opt-bikes"
            icon={<Bike className="size-[18px]" />}
            label={t('options.cityBikes')}
            checked={showCityBikes}
            onChange={onShowCityBikes}
          />
          <SwitchRow
            id="opt-works"
            icon={<Construction className="size-[18px]" />}
            label={t('options.roadworks')}
            checked={showRoadworks}
            onChange={onShowRoadworks}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h2 id="opt-lang" className="text-sm text-ink-muted">
            {t('options.language')}
          </h2>
          <Segmented
            labelledBy="opt-lang"
            value={lang}
            onChange={(v) => void i18n.changeLanguage(v)}
            options={[
              { value: 'en', label: 'English' },
              { value: 'fi', label: 'Suomi' },
            ]}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h2 id="opt-theme" className="text-sm text-ink-muted">
            {t('options.appearance')}
          </h2>
          <Segmented<ThemePreference>
            labelledBy="opt-theme"
            value={preference}
            onChange={setThemePreference}
            options={[
              { value: 'system', label: t('options.system'), icon: <Monitor className="size-4" /> },
              { value: 'light', label: t('options.light'), icon: <Sun className="size-4" /> },
              { value: 'dark', label: t('options.dark'), icon: <Moon className="size-4" /> },
            ]}
          />
        </section>
      </PopoverContent>
    </Popover>
  )
}

type SwitchRowProps = {
  id: string
  icon: ReactNode
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function SwitchRow({ id, icon, label, checked, onChange }: SwitchRowProps) {
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3">
      <span className="text-ink-muted">{icon}</span>
      <span className="flex-1 text-base">{label}</span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

type SegmentedProps<T extends string> = {
  labelledBy: string
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; icon?: ReactNode }[]
}

/** A single-choice toggle group drawn as a segmented control. */
function Segmented<T extends string>({ labelledBy, value, onChange, options }: SegmentedProps<T>) {
  return (
    <ToggleGroup
      type="single"
      aria-labelledby={labelledBy}
      value={value}
      // Radix sends '' when the active item is pressed again; keep the choice
      onValueChange={(v) => v && onChange(v as T)}
      className="grid w-full auto-cols-fr grid-flow-col gap-1 rounded-xl bg-sunken p-1"
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className="h-10 gap-1.5 rounded-[10px] text-sm font-medium text-ink-muted first:rounded-[10px] last:rounded-[10px] hover:bg-transparent hover:text-ink data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=on]:shadow-sm"
        >
          {o.icon}
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

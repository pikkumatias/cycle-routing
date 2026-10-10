import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Bike, Construction, Monitor, Moon, Settings2, Sun } from 'lucide-react'
import { appLanguage } from '../i18n'
import { setThemePreference, useColorScheme, type ThemePreference } from '../theme/colorScheme'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
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
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label={t('options.open')}
          className={cn('size-11 shadow-md dark:bg-background dark:hover:bg-accent', className)}
        >
          <Settings2 className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={16}
        className="flex w-[min(320px,calc(100vw-32px))] flex-col gap-5"
      >
        <section className="flex flex-col gap-1.5">
          <h2 className="text-sm font-medium">{t('options.showOnMap')}</h2>
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
          <h2 id="opt-lang" className="text-sm font-medium">
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
          <h2 id="opt-theme" className="text-sm font-medium">
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
    <div className="flex min-h-10 items-center gap-3">
      <span className="text-muted-foreground">{icon}</span>
      <Label htmlFor={id} className="flex-1 cursor-pointer font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

type SegmentedProps<T extends string> = {
  labelledBy: string
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; icon?: ReactNode }[]
}

/** A single-choice toggle group. */
function Segmented<T extends string>({ labelledBy, value, onChange, options }: SegmentedProps<T>) {
  return (
    <ToggleGroup
      type="single"
      aria-labelledby={labelledBy}
      value={value}
      // Radix sends '' when the active item is pressed again; keep the choice
      onValueChange={(v) => v && onChange(v as T)}
      variant="outline"
      className="w-full"
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className="h-10 flex-1"
        >
          {o.icon}
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

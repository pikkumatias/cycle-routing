import { ButtonBase, Box, Typography, CircularProgress } from '@mui/material'
import TripOriginIcon from '@mui/icons-material/TripOrigin'
import LocationOnIcon from '@mui/icons-material/LocationOn'
import MyLocationIcon from '@mui/icons-material/MyLocation'

type AddressTriggerProps = {
  icon: 'origin' | 'destination'
  placeholder: string
  value: string
  onClick: () => void
  isCurrentLocation?: boolean
  locationLoading?: boolean
}

export function AddressTrigger({
  icon,
  placeholder,
  value,
  onClick,
  isCurrentLocation,
  locationLoading,
}: AddressTriggerProps) {
  const renderIcon = () => {
    if (icon === 'origin') {
      if (locationLoading) {
        return <CircularProgress size={18} sx={{ mr: 1.5, flexShrink: 0 }} />
      }
      if (isCurrentLocation) {
        return <MyLocationIcon sx={{ color: 'primary.main', fontSize: 20, mr: 1.5, flexShrink: 0 }} />
      }
      return <TripOriginIcon sx={{ color: 'success.main', fontSize: 20, mr: 1.5, flexShrink: 0 }} />
    }
    return <LocationOnIcon sx={{ color: 'error.main', fontSize: 20, mr: 1.5, flexShrink: 0 }} />
  }

  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        width: '100%',
        textAlign: 'left',
        borderRadius: '12px',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          bgcolor: '#F5F5F5',
          borderRadius: '12px',
          px: 1.5,
          py: 1.25,
        }}
      >
        {renderIcon()}
        <Typography
          sx={{
            color: value ? 'text.primary' : 'text.secondary',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '1rem',
            fontStyle: isCurrentLocation ? 'italic' : 'normal',
          }}
        >
          {value || placeholder}
        </Typography>
      </Box>
    </ButtonBase>
  )
}

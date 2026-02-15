import { ButtonBase, Box, Typography } from '@mui/material'
import TripOriginIcon from '@mui/icons-material/TripOrigin'
import LocationOnIcon from '@mui/icons-material/LocationOn'

type AddressTriggerProps = {
  icon: 'origin' | 'destination'
  placeholder: string
  value: string
  onClick: () => void
}

export function AddressTrigger({ icon, placeholder, value, onClick }: AddressTriggerProps) {
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
        {icon === 'origin' ? (
          <TripOriginIcon sx={{ color: 'success.main', fontSize: 20, mr: 1.5, flexShrink: 0 }} />
        ) : (
          <LocationOnIcon sx={{ color: 'error.main', fontSize: 20, mr: 1.5, flexShrink: 0 }} />
        )}
        <Typography
          sx={{
            color: value ? 'text.primary' : 'text.secondary',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '1rem',
          }}
        >
          {value || placeholder}
        </Typography>
      </Box>
    </ButtonBase>
  )
}

// Geolocation + AU state detection using OpenStreetMap Nominatim (free, no API key)

const STATE_MAP = {
  'New South Wales': 'NSW',
  'Victoria': 'VIC',
  'Queensland': 'QLD',
  'Western Australia': 'WA',
  'South Australia': 'SA',
  'Tasmania': 'TAS',
  'Australian Capital Territory': 'ACT',
  'Northern Territory': 'NT'
}

const BOARD_MAP = {
  NSW: 'NESA',
  VIC: 'VCAA',
  QLD: 'QCAA',
  WA: 'SCSA (WACE)',
  SA: 'SACE',
  TAS: 'TASC (TCE)',
  ACT: 'BSSS',
  NT: 'NTBOS'
}

// Get browser coordinates
function getCoords() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(err),
      { timeout: 8000, maximumAge: 3600000 }
    )
  })
}

// Reverse geocode via Nominatim
async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`
  const res = await fetch(url, {
    headers: { 'Accept-Language': 'en', 'User-Agent': 'StudentMastery/1.0' }
  })
  if (!res.ok) throw new Error('Geocode failed')
  return res.json()
}

// Main export — detect AU state + exam board
export async function detectStudentLocation() {
  const coords = await getCoords()
  const geo = await reverseGeocode(coords.lat, coords.lng)

  const stateRaw = geo.address?.state || ''
  const country = geo.address?.country_code || ''

  if (country !== 'au') {
    throw new Error('Location is outside Australia')
  }

  const state = STATE_MAP[stateRaw]
  if (!state) throw new Error(`Unknown state: ${stateRaw}`)

  return {
    state,
    examBoard: BOARD_MAP[state],
    city: geo.address?.city || geo.address?.town || geo.address?.suburb || '',
    raw: stateRaw
  }
}

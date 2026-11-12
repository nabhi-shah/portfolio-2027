import { HOST_LOCATION, type LocationConfig, type WeatherState } from '@/config/weather';

interface WMOInfo {
  label: string;
  summary: (temp: number, max: number, min: number, isDay: boolean) => string;
  clouds: number;
  rain: number;
  storm: number;
  snow: number;
}

export function decodeWMO(code: number, cloudCoverPct = 18): WMOInfo {
  const c = Math.max(0.08, Math.min(1, cloudCoverPct / 100));

  if (code === 0) {
    return {
      label: 'Clear',
      summary: (_t, max, min, isDay) =>
        isDay
          ? `Sunlit sky with crisp visibility. High ${max}° · Low ${min}°`
          : `Clear starry sky tonight. Low around ${min}°`,
      clouds: Math.max(0.16, c * 0.45),
      rain: 0,
      storm: 0,
      snow: 0
    };
  }
  if (code === 1 || code === 2) {
    return {
      label: code === 1 ? 'Mostly Clear' : 'Partly Cloudy',
      summary: (_t, max, min) =>
        `Scattered volumetric clouds passing through. High ${max}° · Low ${min}°`,
      clouds: Math.max(0.32, c * 0.7),
      rain: 0,
      storm: 0,
      snow: 0
    };
  }
  if (code === 3) {
    return {
      label: 'Overcast',
      summary: (_t, max, min) =>
        `Dense atmospheric cloud canopy overhead. High ${max}° · Low ${min}°`,
      clouds: Math.max(0.78, c),
      rain: 0,
      storm: 0.15,
      snow: 0
    };
  }
  if (code === 45 || code === 48) {
    return {
      label: 'Misty Fog',
      summary: (_t, max, min) =>
        `Low atmospheric mist softening the horizon. High ${max}° · Low ${min}°`,
      clouds: 0.72,
      rain: 0.05,
      storm: 0.1,
      snow: 0
    };
  }
  if (code >= 51 && code <= 67) {
    const heavy = code >= 63;
    return {
      label: heavy ? 'Heavy Rain' : 'Light Rain',
      summary: (_t, max, min) =>
        `Rain showers sweeping across the sky. High ${max}° · Low ${min}°`,
      clouds: heavy ? 0.9 : 0.74,
      rain: heavy ? 0.85 : 0.48,
      storm: heavy ? 0.45 : 0.2,
      snow: 0
    };
  }
  if (code >= 71 && code <= 86) {
    return {
      label: 'Snowfall',
      summary: (_t, max, min) =>
        `Soft winter snow drifting through cold air. High ${max}° · Low ${min}°`,
      clouds: 0.82,
      rain: 0.15,
      storm: 0.2,
      snow: 0.85
    };
  }
  if (code >= 80 && code <= 82) {
    return {
      label: 'Rain Showers',
      summary: (_t, max, min) =>
        `Passing rain showers with breaks of light. High ${max}° · Low ${min}°`,
      clouds: 0.78,
      rain: 0.65,
      storm: 0.35,
      snow: 0
    };
  }
  if (code >= 95) {
    return {
      label: 'Thunderstorm',
      summary: (_t, max, min) =>
        `Electrified storm clouds with sheet lightning. High ${max}° · Low ${min}°`,
      clouds: 0.95,
      rain: 0.92,
      storm: 0.95,
      snow: 0
    };
  }

  return {
    label: 'Clear',
    summary: (_t, max, min) => `pleasant atmospheric conditions. High ${max}° · Low ${min}°`,
    clouds: 0.25,
    rain: 0,
    storm: 0,
    snow: 0
  };
}

export function formatTimeInZone(timezone: string, date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  } catch {
    return date.toTimeString().slice(0, 5);
  }
}

export function getFractionalHourInZone(timezone: string, date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 12);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return (hour % 24) + minute / 60;
  } catch {
    return date.getHours() + date.getMinutes() / 60;
  }
}

export function computeSunPosition(fractionalHour: number, sunriseHour = 6.5, sunsetHour = 19.5) {
  // Returns sunElevation in [-1, 1] (>0 is daytime, 0 is horizon/golden hour, <0 is night)
  const dayLength = Math.max(1, sunsetHour - sunriseHour);
  if (fractionalHour >= sunriseHour && fractionalHour <= sunsetHour) {
    const progress = (fractionalHour - sunriseHour) / dayLength; // 0..1
    const elevation = Math.sin(progress * Math.PI); // 0 -> 1 -> 0
    return {
      sunElevation: elevation,
      sunAzimuth: progress
    };
  } else {
    // Nighttime
    let nightProgress = 0.5;
    const nightLength = Math.max(1, 24 - dayLength);
    if (fractionalHour > sunsetHour) {
      nightProgress = (fractionalHour - sunsetHour) / nightLength;
    } else {
      nightProgress = (fractionalHour + (24 - sunsetHour)) / nightLength;
    }
    const elevation = -Math.sin(nightProgress * Math.PI) * 0.85;
    return {
      sunElevation: elevation,
      sunAzimuth: nightProgress
    };
  }
}

export async function detectVisitorLocation(): Promise<LocationConfig> {
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  // Try fast IP geolocation endpoints (no permission prompt required)
  const endpoints = [
    async (): Promise<LocationConfig> => {
      const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(3500) });
      if (!res.ok) throw new Error('ipapi failed');
      const data = await res.json();
      if (!data.latitude || !data.longitude) throw new Error('invalid coords');
      return {
        id: 'visitor',
        label: 'Your Location',
        city: data.city || 'Local Sky',
        region: data.region_code || data.region,
        country: data.country_code || data.country_name,
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
        timezone: data.timezone || browserTz
      };
    },
    async (): Promise<LocationConfig> => {
      const res = await fetch('https://get.geojs.io/v1/ip/geo.json', {
        signal: AbortSignal.timeout(3500)
      });
      if (!res.ok) throw new Error('geojs failed');
      const data = await res.json();
      return {
        id: 'visitor',
        label: 'Your Location',
        city: data.city || browserTz.split('/').pop()?.replace(/_/g, ' ') || 'Local Sky',
        region: data.region,
        country: data.country_code,
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
        timezone: data.timezone || browserTz
      };
    }
  ];

  for (const fn of endpoints) {
    try {
      return await fn();
    } catch {
      // try next fallback
    }
  }

  // Fallback derived from browser timezone
  const fallbackCity = browserTz.split('/').pop()?.replace(/_/g, ' ') || 'San Francisco';
  return {
    id: 'visitor',
    label: 'Your Location',
    city: fallbackCity,
    latitude: 37.7749,
    longitude: -122.4194,
    timezone: browserTz
  };
}

export async function fetchWeatherForLocation(loc: LocationConfig): Promise<WeatherState> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(loc.latitude));
  url.searchParams.set('longitude', String(loc.longitude));
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,cloud_cover,wind_speed_10m'
  );
  url.searchParams.set(
    'hourly',
    'temperature_2m,relative_humidity_2m,weather_code'
  );
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,sunrise,sunset');
  url.searchParams.set('timezone', loc.timezone || 'auto');
  url.searchParams.set('forecast_days', '2');

  const fractionalHour = getFractionalHourInZone(loc.timezone);
  const localTimeStr = formatTimeInZone(loc.timezone);

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const data = await res.json();

    const current = data.current || {};
    const daily = data.daily || {};
    const hourly = data.hourly || {};

    const temp = Math.round(current.temperature_2m ?? 24);
    const feelsLike = Math.round(current.apparent_temperature ?? temp);
    const tempMax = Math.round(daily.temperature_2m_max?.[0] ?? temp + 4);
    const tempMin = Math.round(daily.temperature_2m_min?.[0] ?? temp - 4);
    const weatherCode = Number(current.weather_code ?? 0);
    const cloudCoverPct = Number(current.cloud_cover ?? 18);
    const windSpeed = Math.round(current.wind_speed_10m ?? 9);
    const humidity = Math.round(current.relative_humidity_2m ?? 58);

    // Parse sunrise & sunset hours
    const parseHour = (iso?: string, fallback = 6.5) => {
      if (!iso || !iso.includes('T')) return fallback;
      const [h, m] = iso.split('T')[1].split(':').map(Number);
      return h + (m || 0) / 60;
    };
    const sunriseHour = parseHour(daily.sunrise?.[0], 6.5);
    const sunsetHour = parseHour(daily.sunset?.[0], 19.5);

    const { sunElevation, sunAzimuth } = computeSunPosition(
      fractionalHour,
      sunriseHour,
      sunsetHour
    );
    const isDay = Boolean(current.is_day ?? (sunElevation >= -0.05 ? 1 : 0));

    const wmo = decodeWMO(weatherCode, cloudCoverPct);

    // Build next 6 hourly slots starting from current hour
    const nowHourIndex = Math.max(0, Math.floor(fractionalHour));
    const hourlySlots: WeatherState['hourly'] = [];
    for (let i = 0; i < 6; i++) {
      const idx = nowHourIndex + i;
      const rawTime = hourly.time?.[idx];
      const slotLabel = rawTime?.includes('T')
        ? rawTime.split('T')[1].slice(0, 5)
        : `${String((nowHourIndex + i) % 24).padStart(2, '0')}:00`;
      hourlySlots.push({
        time: i === 0 ? 'Now' : slotLabel,
        temp: Math.round(hourly.temperature_2m?.[idx] ?? temp),
        humidity: Math.round(hourly.relative_humidity_2m?.[idx] ?? humidity),
        code: Number(hourly.weather_code?.[idx] ?? weatherCode)
      });
    }

    return {
      location: loc,
      temperature: temp,
      feelsLike,
      tempMax,
      tempMin,
      weatherCode,
      conditionLabel: wmo.label,
      summaryLine: wmo.summary(temp, tempMax, tempMin, isDay),
      isDay,
      cloudCover: wmo.clouds,
      precipitation: wmo.rain,
      storminess: wmo.storm,
      snowAmount: wmo.snow,
      windSpeed,
      humidity,
      sunElevation,
      sunAzimuth,
      localTimeStr,
      hourly: hourlySlots
    };
  } catch {
    // Graceful offline / API fallback
    const { sunElevation, sunAzimuth } = computeSunPosition(fractionalHour, 6.5, 19.5);
    const isDay = sunElevation >= -0.05;
    const wmo = decodeWMO(1, 22);
    return {
      location: loc,
      temperature: 26,
      feelsLike: 28,
      tempMax: 29,
      tempMin: 21,
      weatherCode: 1,
      conditionLabel: wmo.label,
      summaryLine: wmo.summary(26, 29, 21, isDay),
      isDay,
      cloudCover: 0.28,
      precipitation: 0,
      storminess: 0,
      snowAmount: 0,
      windSpeed: 11,
      humidity: 62,
      sunElevation,
      sunAzimuth,
      localTimeStr,
      hourly: [
        { time: 'Now', temp: 26, humidity: 62, code: 1 },
        { time: '18:00', temp: 28, humidity: 58, code: 1 },
        { time: '19:00', temp: 27, humidity: 64, code: 2 },
        { time: '20:00', temp: 25, humidity: 68, code: 1 },
        { time: '21:00', temp: 23, humidity: 72, code: 0 },
        { time: '22:00', temp: 22, humidity: 75, code: 0 }
      ]
    };
  }
}

export { HOST_LOCATION };

export interface LocationConfig {
  id: 'host' | 'visitor';
  label: string;
  city: string;
  region?: string;
  country?: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

/**
 * Configure your personal home location here.
 * Coordinates & timezone drive both live Open-Meteo weather data and real solar elevation.
 */
export const HOST_LOCATION: LocationConfig = {
  id: 'host',
  label: 'Nabhi’s Location',
  city: 'New York',
  region: 'NY',
  country: 'US',
  latitude: 40.7128,
  longitude: -74.006,
  timezone: 'America/New_York'
};

export interface WeatherState {
  location: LocationConfig;
  temperature: number;
  feelsLike: number;
  tempMax: number;
  tempMin: number;
  weatherCode: number;
  conditionLabel: string;
  summaryLine: string;
  isDay: boolean;
  cloudCover: number; // 0..1
  precipitation: number; // 0..1
  storminess: number; // 0..1
  snowAmount: number; // 0..1
  windSpeed: number; // km/h
  humidity: number; // %
  sunElevation: number; // -1 (midnight) to +1 (solar noon)
  sunAzimuth: number; // 0..1 across sky
  localTimeStr: string;
  hourly: Array<{
    time: string;
    temp: number;
    humidity: number;
    code: number;
    isSunset?: boolean;
    isSunrise?: boolean;
  }>;
}

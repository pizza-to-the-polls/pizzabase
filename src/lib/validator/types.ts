export interface NormalAddress {
  latitude: number;
  longitude: number;

  fullAddress: string;

  address: string;
  city: string;
  state: string;
  zip: string;

  /** County (administrative_area_level_2 from Google Geocoding), e.g. "Allegheny County" */
  county?: string;
}

export interface OverrideAddress {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: string;
  longitude?: string;
}

export interface NormalAddress {
  latitude: number;
  longitude: number;

  fullAddress: string;

  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface OverrideAddress {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: string;
  longitude?: string;
}

export type FrenchGeoResult = {
  city: string;
  postalCode: string;
  region: string | null;
  latitude: number;
  longitude: number;
};

export async function geocodeFrenchLocation(city: string, postalCode: string): Promise<FrenchGeoResult | null> {
  const cleanCity = city.trim();
  const cleanPostal = postalCode.trim();
  if (!cleanCity || !cleanPostal) return null;
  try {
    const qs = new URLSearchParams({ q: `${cleanPostal} ${cleanCity}`, limit: "5", autocomplete: "0" });
    const response = await fetch(`https://data.geopf.fr/geocodage/search/?${qs.toString()}`, {
      headers: { accept: "application/json", "user-agent": "PetitAnnonces/1.0 geocoding" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> }> };
    const features = payload.features ?? [];
    const feature = features.find(item => String(item.properties?.postcode ?? "") === cleanPostal) ?? features[0];
    const coords = feature?.geometry?.coordinates;
    if (!coords || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) return null;
    const p = feature?.properties ?? {};
    const context = typeof p.context === "string" ? p.context : "";
    const region = context.split(",").map(x => x.trim()).filter(Boolean).at(-1) ?? null;
    return {
      city: typeof p.city === "string" && p.city.trim() ? p.city.trim() : cleanCity,
      postalCode: cleanPostal,
      region,
      latitude: coords[1],
      longitude: coords[0],
    };
  } catch {
    return null;
  }
}


export async function geocodeFrenchSearchLocation(query: string): Promise<FrenchGeoResult | null> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return null;
  try {
    const qs = new URLSearchParams({ q: cleanQuery, limit: "5", autocomplete: "0" });
    const response = await fetch(`https://data.geopf.fr/geocodage/search/?${qs.toString()}`, {
      headers: { accept: "application/json", "user-agent": "PetitAnnonces/1.0 search-geocoding" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> }> };
    const feature = payload.features?.find(item => {
      const type = String(item.properties?.type ?? "");
      return type === "municipality" || type === "locality" || type === "street" || type === "housenumber";
    }) ?? payload.features?.[0];
    const coords = feature?.geometry?.coordinates;
    if (!coords || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) return null;
    const props = feature?.properties ?? {};
    const city = typeof props.city === "string" && props.city.trim() ? props.city.trim() : typeof props.name === "string" ? props.name.trim() : cleanQuery;
    const postalCode = typeof props.postcode === "string" ? props.postcode.trim() : /^\d{5}$/.test(cleanQuery) ? cleanQuery : "";
    const context = typeof props.context === "string" ? props.context : "";
    const region = context.split(",").map(x => x.trim()).filter(Boolean).at(-1) ?? null;
    return { city, postalCode, region, latitude: coords[1], longitude: coords[0] };
  } catch {
    return null;
  }
}

export async function reverseFrenchLocation(latitude: number, longitude: number): Promise<FrenchGeoResult | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  try {
    const qs = new URLSearchParams({
      lat: latitude.toFixed(6),
      lon: longitude.toFixed(6),
      fields: "nom,codesPostaux,centre,region",
      format: "json",
      geometry: "centre",
    });
    const response = await fetch(`https://geo.api.gouv.fr/communes?${qs.toString()}`, {
      headers: { accept: "application/json", "user-agent": "PetitAnnonces/1.0 reverse-geocoding" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const rows = await response.json() as Array<{
      nom?: string;
      codesPostaux?: string[];
      centre?: { coordinates?: [number, number] };
      region?: { nom?: string };
    }>;
    const row = rows[0];
    if (!row?.nom?.trim()) return null;
    const coords = row.centre?.coordinates;
    return {
      city: row.nom.trim(),
      postalCode: row.codesPostaux?.find(value => /^\d{5}$/.test(value)) ?? "",
      region: typeof row.region?.nom === "string" ? row.region.nom : null,
      latitude: coords && Number.isFinite(coords[1]) ? coords[1] : latitude,
      longitude: coords && Number.isFinite(coords[0]) ? coords[0] : longitude,
    };
  } catch {
    return null;
  }
}

export type FrenchPostalCity = {
  name: string;
  postalCode: string;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
};

export async function lookupFrenchPostalCode(postalCode: string): Promise<FrenchPostalCity[]> {
  const cleanPostal = postalCode.trim();
  if (!/^\d{5}$/.test(cleanPostal)) return [];
  try {
    const qs = new URLSearchParams({
      codePostal: cleanPostal,
      fields: "nom,codesPostaux,centre,region",
      format: "json",
      geometry: "centre",
    });
    const response = await fetch(`https://geo.api.gouv.fr/communes?${qs.toString()}`, {
      headers: { accept: "application/json", "user-agent": "PetitAnnonces/1.0 postal-lookup" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const rows = await response.json() as Array<{
      nom?: string;
      codesPostaux?: string[];
      centre?: { coordinates?: [number, number] };
      region?: { nom?: string };
    }>;
    return rows
      .filter(row => typeof row.nom === "string" && row.nom.trim())
      .map(row => {
        const coords = row.centre?.coordinates;
        return {
          name: row.nom!.trim(),
          postalCode: cleanPostal,
          region: typeof row.region?.nom === "string" ? row.region.nom : null,
          latitude: coords && Number.isFinite(coords[1]) ? coords[1] : null,
          longitude: coords && Number.isFinite(coords[0]) ? coords[0] : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  } catch {
    return [];
  }
}

import { createHash } from "node:crypto";
import { z } from "zod";

const vehicleResponseSchema = z.object({
  source: z.string().min(1).max(80),
  make: z.string().max(100).nullish(),
  model: z.string().max(120).nullish(),
  version: z.string().max(160).nullish(),
  firstRegistrationDate: z.string().datetime().nullish(),
  modelYear: z.number().int().min(1900).max(2100).nullish(),
  fuel: z.string().max(80).nullish(),
  transmission: z.string().max(80).nullish(),
  bodyType: z.string().max(80).nullish(),
  powerKw: z.number().int().nonnegative().nullish(),
  fiscalPowerCv: z.number().int().nonnegative().nullish(),
  co2GKm: z.number().int().nonnegative().nullish(),
  euroStandard: z.string().max(40).nullish(),
  seats: z.number().int().positive().max(100).nullish(),
  doors: z.number().int().positive().max(20).nullish(),
  color: z.string().max(80).nullish(),
});

export type VehicleLookupResult = z.infer<typeof vehicleResponseSchema>;

export function normalizeFrenchPlate(input: string) {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]{2}[0-9]{3}[A-Z]{2}$/.test(compact)) {
    throw new Error("invalid_registration_plate");
  }
  return `${compact.slice(0, 2)}-${compact.slice(2, 5)}-${compact.slice(5)}`;
}

export function plateHash(plate: string) {
  return createHash("sha256").update(plate).digest("hex");
}

export async function lookupVehicleByPlate(rawPlate: string): Promise<VehicleLookupResult> {
  const registrationPlate = normalizeFrenchPlate(rawPlate);
  const apiUrl = process.env.VEHICLE_DATA_API_URL;
  const apiToken = process.env.VEHICLE_DATA_API_TOKEN;

  if (!apiUrl || !apiToken) {
    throw new Error("vehicle_data_provider_not_configured");
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ registrationPlate }),
    signal: AbortSignal.timeout(8000),
  });

  if (response.status === 404) throw new Error("vehicle_not_found");
  if (!response.ok) throw new Error("vehicle_provider_unavailable");

  return vehicleResponseSchema.parse(await response.json());
}

export function nativeExternalDigitalBillingEnabled(){
  return String(process.env.NATIVE_EXTERNAL_DIGITAL_BILLING_ENABLED ?? "").toLowerCase() === "true";
}

export function nativeExternalProBillingEnabled(){
  return String(process.env.NATIVE_EXTERNAL_PRO_BILLING_ENABLED ?? "").toLowerCase() === "true";
}

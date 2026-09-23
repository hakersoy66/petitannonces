import type { ConfigContext, ExpoConfig } from "expo/config";

type Variant = "development" | "preview" | "production";

export default ({ config }: ConfigContext): ExpoConfig => {
  const rawVariant = String(process.env.APP_VARIANT ?? "production").toLowerCase();
  const variant: Variant = rawVariant === "development" || rawVariant === "preview" ? rawVariant : "production";
  const defaultIos = config.ios?.bundleIdentifier ?? "fr.petitannonces.app";
  const defaultAndroid = config.android?.package ?? "fr.petitannonces.app";
  const iosBase = String(process.env.PA_IOS_BUNDLE_ID ?? defaultIos);
  const androidBase = String(process.env.PA_ANDROID_PACKAGE ?? defaultAndroid);
  const rawAndroidVersionCode = Number(process.env.PA_ANDROID_VERSION_CODE ?? "");
  const androidVersionCode = Number.isInteger(rawAndroidVersionCode) && rawAndroidVersionCode > 0
    ? rawAndroidVersionCode
    : config.android?.versionCode;
  const suffix = variant === "development" ? ".dev" : variant === "preview" ? ".preview" : "";
  const displaySuffix = variant === "development" ? " Dev" : variant === "preview" ? " Preview" : "";
  const baseScheme = typeof config.scheme === "string" ? config.scheme : "petitannonces";
  const sharedGoogleServices = "/var/www/petitannonces/shared/android-firebase/google-services.json";
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON?.trim() || config.android?.googleServicesFile || (variant === "production" ? sharedGoogleServices : undefined);
  const plugins = [
    ...(config.plugins ?? []).filter((plugin) => {
      const name = typeof plugin === "string" ? plugin : Array.isArray(plugin) ? plugin[0] : "";
      return name !== "expo-dev-client" && name !== "expo-location";
    }),
    ["expo-location", {
      locationWhenInUsePermission: "Petit Annonces utilise votre position uniquement lorsque vous choisissez « Autour de moi » afin d’afficher les annonces proches.",
    }] as [string, Record<string, unknown>],
    ["expo-dev-client", { addGeneratedScheme: variant === "development" }] as [string, Record<string, unknown>],
  ];

  return {
    ...config,
    plugins,
    name: `${config.name ?? "Petit Annonces"}${displaySuffix}`,
    slug: config.slug ?? "petit-annonces",
    scheme: variant === "production" ? baseScheme : `${baseScheme}-${variant}`,
    runtimeVersion: { policy: "appVersion" },
    ios: {
      ...config.ios,
      bundleIdentifier: `${iosBase}${suffix}`,
    },
    android: {
      ...config.android,
      package: `${androidBase}${suffix}`,
      ...(androidVersionCode ? { versionCode: androidVersionCode } : {}),
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    extra: {
      ...config.extra,
      appVariant: variant,
    },
  };
};

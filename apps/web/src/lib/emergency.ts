/**
 * Public emergency numbers by region; 112 works on most mobile networks and is
 * the fallback. Mirrors SafetyEngine.emergencyNumber (Swift).
 */
export function emergencyNumber(region: string | undefined): string {
  switch (region?.toUpperCase()) {
    case "US":
    case "CA":
    case "MX":
    case "PR":
      return "911";
    case "GB":
    case "IE":
    case "HK":
    case "MY":
      return "999";
    case "SG":
      return "995";
    case "AU":
      return "000";
    case "NZ":
      return "111";
    case "JP":
    case "KR":
      return "119";
    default:
      return "112";
  }
}

/** Region from a BCP 47 language tag such as "en-GB". */
export function regionOf(locale: string | undefined): string | undefined {
  if (!locale) return undefined;
  try {
    return new Intl.Locale(locale).maximize().region;
  } catch {
    return undefined;
  }
}

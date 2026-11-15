import cityData from "./data/india-cities.json";

// GeoNames India place names and administrative regions, CC BY 4.0.
// https://www.geonames.org/export/
// Municipal coverage supplemented with Local Government Directory urban body data.
// MIT-licensed transformation: https://github.com/kalyangupta12/indian-cities-data
// Catalog adapted to city/state labels, with duplicate places removed and local aliases added.
const entries = cityData as (string | [string, string[]])[];

function normalize(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const cities = entries.map((entry) => {
  const [label, aliases] = typeof entry === "string" ? [entry, []] : entry;
  const separator = label.lastIndexOf(", ");
  const city = label.slice(0, separator);
  const state = normalize(label.slice(separator + 2));
  return { label, state, names: [city, ...aliases].map(normalize) };
});
const labels = new Map(cities.map(({ label }) => [normalize(label), label]));

export function indianCityLabel(value: unknown) {
  return typeof value === "string" && value.length <= 120
    ? labels.get(normalize(value))
    : undefined;
}

export function suggestIndianCities(query: string): string[] {
  if (query.length > 120) return [];
  const [cityPart, regionPart = ""] = query.split(",", 2);
  const name = normalize(cityPart);
  const region = normalize(regionPart);
  if (name.length < 2) return [];

  const initials = [name, ...(region ? [] : name.split(" ").slice(0, -1))];
  const exact: string[] = [];
  const prefix: string[] = [];
  const partial: string[] = [];
  for (const city of cities) {
    if (region && !city.state.startsWith(region)) continue;
    if (city.names.includes(name)) {
      if (exact.length < 3) exact.push(city.label);
    } else if (city.names.some((alias) => alias.startsWith(name))) {
      if (prefix.length < 3) prefix.push(city.label);
    } else if (partial.length < 3 && (
      city.names.some((alias) => alias.includes(name)) ||
      initials.some((part) => part !== name && city.names.includes(part) && city.state.startsWith(name.slice(part.length + 1)))
    )) {
      partial.push(city.label);
    }
    if (exact.length === 3) break;
  }
  return [...exact, ...prefix, ...partial].slice(0, 3);
}

export function money(value: number | null, currency = 'EUR') {
  if (value == null) return 'Prix non défini';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value / 100);
}

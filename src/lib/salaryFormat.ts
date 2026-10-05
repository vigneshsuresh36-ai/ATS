const currency = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

function toAnnualRupees(value: number) {
  return value > 0 && value < 1000 ? value * 100_000 : value;
}

export function formatSalaryRange(min: number, max: number) {
  return `₹${currency.format(toAnnualRupees(min))}–₹${currency.format(toAnnualRupees(max))}`;
}
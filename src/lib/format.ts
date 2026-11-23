const integer = new Intl.NumberFormat('en-US')
export const count = (value: number) => integer.format(value)
export function size(value: number | null) {
  if (value === null) return '—'
  if (value < 1024) return integer.format(value) + ' B'
  if (value < 1024 ** 2) return (value / 1024).toFixed(value < 10 * 1024 ? 2 : 1) + ' KiB'
  if (value < 1024 ** 3) return (value / 1024 ** 2).toFixed(2) + ' MiB'
  return (value / 1024 ** 3).toFixed(2) + ' GiB'
}
export function time(value: number | null) {
  if (value === null) return '—'
  if (value >= 1000) return (value / 1000).toFixed(2) + ' s'
  if (value > 0 && value < 1) return (value < 0.01 ? '<0.01' : value.toFixed(2)) + ' ms'
  return Math.round(value) + ' ms'
}
export const percent = (part: number, total: number) => total ? Math.round(100 * part / total) + '%' : '0%'

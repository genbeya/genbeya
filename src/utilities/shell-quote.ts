/** Quotes a value for POSIX sh. */
export const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

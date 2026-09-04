declare module 'semver' {
  const semver: { valid(value: string): string | null }
  export default semver
}

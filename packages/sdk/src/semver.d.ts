declare module 'semver' {
  const semver: {
    valid(value: string): string | null
    gte(version: string, minimum: string): boolean
  }
  export default semver
}

declare module 'semver' {
  const semver: {
    valid(value: string): string | null
    gte(left: string, right: string): boolean
    compare(left: string, right: string): number
  }
  export default semver
}

declare module 'node:fs' {
  const fs: {
    readFileSync(path: string, encoding: string): string
  }

  export default fs
}

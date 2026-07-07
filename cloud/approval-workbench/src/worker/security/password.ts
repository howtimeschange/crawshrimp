import { sha256Hex } from './tokens'

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomUUID()
  const hash = await sha256Hex(`${salt}:${password}`)
  return `sha256:${salt}:${hash}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 3 || parts[0] !== 'sha256') return false
  const hash = await sha256Hex(`${parts[1]}:${password}`)
  return hash === parts[2]
}

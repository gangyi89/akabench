type UserRecord = {
  username: string
  password: string
  displayName: string
}

const USERS: UserRecord[] = [
  { username: 'akamai', password: 'akabench', displayName: 'Akamai' },
]

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

export function verifyCredentials(username: string, password: string): UserRecord | null {
  const user = USERS.find(u => u.username === username)
  if (!user) return null
  return timingSafeEqual(user.password, password) ? user : null
}

export function getUser(username: string): UserRecord | null {
  return USERS.find(u => u.username === username) ?? null
}

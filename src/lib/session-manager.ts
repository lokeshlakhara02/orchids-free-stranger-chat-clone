// Session Manager - Robust session handling with persistence and recovery

const SESSION_KEY = 'lakhari_session_id'
const USER_ID_KEY = 'lakhari_user_id'
const SESSION_TIMESTAMP_KEY = 'lakhari_session_timestamp'
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 hours

export interface SessionData {
  sessionId: string
  userId: string
  createdAt: number
}

export function generateUserId(): string {
  return `user_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`
}

export function getStoredSession(): SessionData | null {
  if (typeof window === 'undefined') return null
  
  try {
    const sessionId = sessionStorage.getItem(SESSION_KEY)
    const userId = sessionStorage.getItem(USER_ID_KEY)
    const timestamp = sessionStorage.getItem(SESSION_TIMESTAMP_KEY)
    
    if (!sessionId || !userId || !timestamp) return null
    
    const createdAt = parseInt(timestamp, 10)
    
    // Check if session is expired
    if (Date.now() - createdAt > SESSION_EXPIRY_MS) {
      clearSession()
      return null
    }
    
    return { sessionId, userId, createdAt }
  } catch {
    return null
  }
}

export function storeSession(data: Omit<SessionData, 'createdAt'>): SessionData {
  if (typeof window === 'undefined') {
    return { ...data, createdAt: Date.now() }
  }
  
  const createdAt = Date.now()
  
  try {
    sessionStorage.setItem(SESSION_KEY, data.sessionId)
    sessionStorage.setItem(USER_ID_KEY, data.userId)
    sessionStorage.setItem(SESSION_TIMESTAMP_KEY, createdAt.toString())
  } catch (error) {
    console.error('Failed to store session:', error)
  }
  
  return { ...data, createdAt }
}

export function clearSession(): void {
  if (typeof window === 'undefined') return
  
  try {
    sessionStorage.removeItem(SESSION_KEY)
    sessionStorage.removeItem(USER_ID_KEY)
    sessionStorage.removeItem(SESSION_TIMESTAMP_KEY)
  } catch (error) {
    console.error('Failed to clear session:', error)
  }
}

export function getOrCreateUserId(): string {
  if (typeof window === 'undefined') return generateUserId()
  
  let userId = sessionStorage.getItem(USER_ID_KEY)
  
  if (!userId) {
    userId = generateUserId()
    try {
      sessionStorage.setItem(USER_ID_KEY, userId)
    } catch (error) {
      console.error('Failed to store user ID:', error)
    }
  }
  
  return userId
}

export function refreshSessionTimestamp(): void {
  if (typeof window === 'undefined') return
  
  try {
    const sessionId = sessionStorage.getItem(SESSION_KEY)
    if (sessionId) {
      sessionStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString())
    }
  } catch (error) {
    console.error('Failed to refresh session timestamp:', error)
  }
}

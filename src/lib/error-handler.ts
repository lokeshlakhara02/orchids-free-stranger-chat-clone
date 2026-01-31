// Error Handler - Centralized error handling with user-friendly messages

export type ErrorCode = 
  | 'NETWORK_ERROR'
  | 'CONNECTION_TIMEOUT'
  | 'MATCHMAKING_FAILED'
  | 'PARTNER_DISCONNECTED'
  | 'MEDIA_ACCESS_DENIED'
  | 'MEDIA_NOT_SUPPORTED'
  | 'WEBRTC_FAILED'
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'UNKNOWN_ERROR'

export interface AppError {
  code: ErrorCode
  message: string
  userMessage: string
  recoverable: boolean
  action?: string
}

const ERROR_MAP: Record<ErrorCode, Omit<AppError, 'code'>> = {
  NETWORK_ERROR: {
    message: 'Network connection failed',
    userMessage: 'Unable to connect. Please check your internet connection.',
    recoverable: true,
    action: 'Retry'
  },
  CONNECTION_TIMEOUT: {
    message: 'Connection timed out',
    userMessage: 'Connection took too long. Trying again...',
    recoverable: true,
    action: 'Retry'
  },
  MATCHMAKING_FAILED: {
    message: 'Matchmaking service unavailable',
    userMessage: 'Unable to find a match right now. Please try again.',
    recoverable: true,
    action: 'Try Again'
  },
  PARTNER_DISCONNECTED: {
    message: 'Partner disconnected',
    userMessage: 'Your chat partner has disconnected.',
    recoverable: true,
    action: 'Find New'
  },
  MEDIA_ACCESS_DENIED: {
    message: 'Camera/microphone access denied',
    userMessage: 'Please allow camera and microphone access to use video chat.',
    recoverable: false,
    action: 'Enable Permissions'
  },
  MEDIA_NOT_SUPPORTED: {
    message: 'Media devices not supported',
    userMessage: 'Your browser doesn\'t support video chat. Try using Chrome or Firefox.',
    recoverable: false
  },
  WEBRTC_FAILED: {
    message: 'WebRTC connection failed',
    userMessage: 'Video connection failed. Attempting to reconnect...',
    recoverable: true,
    action: 'Reconnect'
  },
  SESSION_EXPIRED: {
    message: 'Session expired',
    userMessage: 'Your session has expired. Refreshing...',
    recoverable: true,
    action: 'Refresh'
  },
  RATE_LIMITED: {
    message: 'Too many requests',
    userMessage: 'Please slow down and try again in a moment.',
    recoverable: true,
    action: 'Wait'
  },
  SERVER_ERROR: {
    message: 'Server error',
    userMessage: 'Something went wrong on our end. Please try again.',
    recoverable: true,
    action: 'Retry'
  },
  UNKNOWN_ERROR: {
    message: 'Unknown error occurred',
    userMessage: 'An unexpected error occurred. Please try again.',
    recoverable: true,
    action: 'Retry'
  }
}

export function createError(code: ErrorCode, details?: string): AppError {
  const errorInfo = ERROR_MAP[code]
  return {
    code,
    ...errorInfo,
    message: details ? `${errorInfo.message}: ${details}` : errorInfo.message
  }
}

export function parseError(error: unknown): AppError {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    
    if (message.includes('network') || message.includes('fetch')) {
      return createError('NETWORK_ERROR', error.message)
    }
    if (message.includes('timeout')) {
      return createError('CONNECTION_TIMEOUT', error.message)
    }
    if (message.includes('permission') || message.includes('denied')) {
      return createError('MEDIA_ACCESS_DENIED', error.message)
    }
    if (message.includes('not supported') || message.includes('undefined')) {
      return createError('MEDIA_NOT_SUPPORTED', error.message)
    }
    
    return createError('UNKNOWN_ERROR', error.message)
  }
  
  return createError('UNKNOWN_ERROR', String(error))
}

export function logError(error: AppError, context?: string): void {
  const logMessage = context ? `[${context}] ${error.message}` : error.message
  console.error(`[ERROR ${error.code}]`, logMessage)
}

export function isRecoverable(error: AppError): boolean {
  return error.recoverable
}

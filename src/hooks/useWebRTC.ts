import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { RealtimeChannel } from '@supabase/supabase-js'
import { createError, parseError, logError, type AppError } from '@/lib/error-handler'

export type WebRTCConnectionStatus = 'idle' | 'initializing' | 'connecting' | 'connected' | 'reconnecting' | 'failed'

interface UseWebRTCReturn {
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  connectionStatus: WebRTCConnectionStatus
  error: AppError | null
  retryConnection: () => void
}

// STUN/TURN servers for better connectivity
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.relay.metered.ca:80' },
  {
    urls: 'turn:a.relay.metered.ca:80',
    username: 'e8dd65c92af044c7f5c68377',
    credential: 'XoNEALhS2bJyHN/9'
  },
  {
    urls: 'turn:a.relay.metered.ca:80?transport=tcp',
    username: 'e8dd65c92af044c7f5c68377',
    credential: 'XoNEALhS2bJyHN/9'
  },
  {
    urls: 'turn:a.relay.metered.ca:443',
    username: 'e8dd65c92af044c7f5c68377',
    credential: 'XoNEALhS2bJyHN/9'
  },
  {
    urls: 'turn:a.relay.metered.ca:443?transport=tcp',
    username: 'e8dd65c92af044c7f5c68377',
    credential: 'XoNEALhS2bJyHN/9'
  },
  {
    urls: 'turns:a.relay.metered.ca:443',
    username: 'e8dd65c92af044c7f5c68377',
    credential: 'XoNEALhS2bJyHN/9'
  }
]

const SIGNALING_TIMEOUT = 20000
const ICE_GATHERING_TIMEOUT = 10000
const RECONNECT_DELAY = 2000
const MAX_RECONNECT_ATTEMPTS = 3

export function useWebRTC(myId: string, partnerId: string | null, isVideo: boolean): UseWebRTCReturn {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<WebRTCConnectionStatus>('idle')
  const [error, setError] = useState<AppError | null>(null)
  
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const isInitiatorRef = useRef(false)
  const pendingCandidatesRef = useRef<RTCIceCandidate[]>([])
  const reconnectAttemptsRef = useRef(0)
  const mountedRef = useRef(true)
  const offerSentRef = useRef(false)
  const partnerReadyRef = useRef(false)
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Safe state updaters
  const safeSetConnectionStatus = useCallback((status: WebRTCConnectionStatus) => {
    if (mountedRef.current) setConnectionStatus(status)
  }, [])

  const safeSetError = useCallback((err: AppError | null) => {
    if (mountedRef.current) setError(err)
  }, [])

  const safeSetRemoteStream = useCallback((stream: MediaStream | null) => {
    if (mountedRef.current) setRemoteStream(stream)
  }, [])

  // Cleanup all resources
  const cleanup = useCallback(() => {
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current)
      connectionTimeoutRef.current = null
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    pendingCandidatesRef.current = []
    remoteStreamRef.current = null
    partnerReadyRef.current = false
    offerSentRef.current = false
    safeSetRemoteStream(null)
    safeSetConnectionStatus('idle')
  }, [safeSetConnectionStatus, safeSetRemoteStream])

  // Get user media with constraints
  const setupMedia = useCallback(async (): Promise<MediaStream | null> => {
    if (!isVideo) return null
    if (localStreamRef.current) return localStreamRef.current
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 640, max: 1280 }, 
          height: { ideal: 480, max: 720 }, 
          facingMode: 'user',
          frameRate: { ideal: 24, max: 30 }
        },
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true,
          autoGainControl: true
        }
      })
      localStreamRef.current = stream
      if (mountedRef.current) setLocalStream(stream)
      return stream
    } catch (err) {
      const appError = parseError(err)
      if (appError.message.includes('Permission denied') || appError.message.includes('NotAllowed')) {
        safeSetError(createError('MEDIA_ACCESS_DENIED'))
      } else {
        safeSetError(createError('MEDIA_NOT_SUPPORTED'))
      }
      logError(appError, 'setupMedia')
      return null
    }
  }, [isVideo, safeSetError])

  // Apply bandwidth constraints for better performance
  const applyBandwidthConstraints = useCallback((pc: RTCPeerConnection) => {
    const senders = pc.getSenders()
    senders.forEach(sender => {
      if (sender.track?.kind === 'video') {
        const params = sender.getParameters()
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}]
        }
        params.encodings[0].maxBitrate = 500000
        params.encodings[0].scaleResolutionDownBy = 1.5
        sender.setParameters(params).catch(() => {})
      }
    })
  }, [])

  // Create and configure peer connection
  const createPeerConnection = useCallback((stream: MediaStream | null, targetPartnerId: string) => {
    if (pcRef.current) {
      pcRef.current.close()
    }

    const pc = new RTCPeerConnection({ 
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    })
    pcRef.current = pc

    remoteStreamRef.current = new MediaStream()

    if (stream) {
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream)
      })
    }

    pc.ontrack = (event) => {
      console.log('Received remote track:', event.track.kind)
      if (remoteStreamRef.current) {
        const existingTrack = remoteStreamRef.current.getTracks().find(t => t.kind === event.track.kind)
        if (existingTrack) {
          remoteStreamRef.current.removeTrack(existingTrack)
        }
        remoteStreamRef.current.addTrack(event.track)
        safeSetRemoteStream(new MediaStream(remoteStreamRef.current.getTracks()))
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'ice-candidate',
          payload: { candidate: event.candidate.toJSON(), from: myId, to: targetPartnerId }
        }).catch(e => console.error('Failed to send ICE candidate:', e))
      }
    }

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState
      console.log('ICE connection state:', state)
      
      switch (state) {
        case 'connected':
        case 'completed':
          safeSetConnectionStatus('connected')
          reconnectAttemptsRef.current = 0
          applyBandwidthConstraints(pc)
          break
        case 'failed':
          if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            safeSetConnectionStatus('reconnecting')
            pc.restartIce()
            reconnectAttemptsRef.current++
          } else {
            safeSetConnectionStatus('failed')
            safeSetError(createError('WEBRTC_FAILED'))
          }
          break
        case 'disconnected':
          safeSetConnectionStatus('reconnecting')
          // Wait a bit before trying to restart ICE
          retryTimeoutRef.current = setTimeout(() => {
            if (pcRef.current?.iceConnectionState === 'disconnected') {
              pcRef.current.restartIce()
            }
          }, RECONNECT_DELAY)
          break
      }
    }

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState)
      if (pc.connectionState === 'connected') {
        safeSetConnectionStatus('connected')
      } else if (pc.connectionState === 'failed') {
        safeSetConnectionStatus('failed')
        safeSetError(createError('WEBRTC_FAILED'))
      }
    }

    return pc
  }, [myId, applyBandwidthConstraints, safeSetConnectionStatus, safeSetRemoteStream, safeSetError])

  // Process pending ICE candidates
  const addPendingCandidates = useCallback(async () => {
    if (!pcRef.current || !pcRef.current.remoteDescription) return
    
    const candidates = [...pendingCandidatesRef.current]
    pendingCandidatesRef.current = []
    
    for (const candidate of candidates) {
      try {
        await pcRef.current.addIceCandidate(candidate)
      } catch (e) {
        console.error('Error adding pending candidate:', e)
      }
    }
  }, [])

  // Send offer to partner
  const sendOffer = useCallback(async () => {
    if (!pcRef.current || !channelRef.current || !partnerId || offerSentRef.current) return
    
    try {
      const offer = await pcRef.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      })
      await pcRef.current.setLocalDescription(offer)
      
      console.log('Sending offer to', partnerId)
      await channelRef.current.send({
        type: 'broadcast',
        event: 'offer',
        payload: { offer, from: myId, to: partnerId }
      })
      offerSentRef.current = true
    } catch (e) {
      console.error('Error creating/sending offer:', e)
      const appError = parseError(e)
      logError(appError, 'sendOffer')
    }
  }, [myId, partnerId])

  // Retry connection manually
  const retryConnection = useCallback(() => {
    reconnectAttemptsRef.current = 0
    cleanup()
    safeSetConnectionStatus('initializing')
    // The main useEffect will re-initialize the connection
  }, [cleanup, safeSetConnectionStatus])

  // Main effect to establish WebRTC connection
  useEffect(() => {
    if (!partnerId || !myId || !isVideo) return

    mountedRef.current = true
    console.log('Setting up WebRTC connection:', myId, '->', partnerId)
    safeSetConnectionStatus('initializing')
    safeSetError(null)
    isInitiatorRef.current = myId < partnerId
    pendingCandidatesRef.current = []
    partnerReadyRef.current = false
    offerSentRef.current = false
    reconnectAttemptsRef.current = 0

    const roomId = [myId, partnerId].sort().join('-')
    const channel = supabase.channel(`webrtc:${roomId}`, {
      config: { broadcast: { self: false } }
    })
    channelRef.current = channel

    let pc: RTCPeerConnection | null = null

    const initConnection = async () => {
      const stream = await setupMedia()
      if (!mountedRef.current) return
      
      if (!stream) {
        safeSetConnectionStatus('failed')
        return
      }

      pc = createPeerConnection(stream, partnerId)
      safeSetConnectionStatus('connecting')

      // Set up connection timeout
      connectionTimeoutRef.current = setTimeout(() => {
        if (pcRef.current?.connectionState !== 'connected') {
          console.log('Connection timeout')
          safeSetConnectionStatus('failed')
          safeSetError(createError('CONNECTION_TIMEOUT'))
        }
      }, SIGNALING_TIMEOUT)

      channel
        .on('broadcast', { event: 'ready' }, async ({ payload }) => {
          if (payload.from === partnerId) {
            console.log('Partner is ready')
            partnerReadyRef.current = true
            if (isInitiatorRef.current && !offerSentRef.current) {
              await sendOffer()
            }
          }
        })
        .on('broadcast', { event: 'offer' }, async ({ payload }) => {
          if (payload.to !== myId || !pcRef.current) return
          console.log('Received offer from', payload.from)
          
          try {
            if (pcRef.current.signalingState !== 'stable') {
              console.log('Ignoring offer, not in stable state:', pcRef.current.signalingState)
              return
            }
            
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.offer))
            await addPendingCandidates()
            
            const answer = await pcRef.current.createAnswer()
            await pcRef.current.setLocalDescription(answer)
            
            console.log('Sending answer to', partnerId)
            await channel.send({
              type: 'broadcast',
              event: 'answer',
              payload: { answer, from: myId, to: partnerId }
            })
          } catch (e) {
            console.error('Error handling offer:', e)
          }
        })
        .on('broadcast', { event: 'answer' }, async ({ payload }) => {
          if (payload.to !== myId || !pcRef.current) return
          console.log('Received answer from', payload.from)
          
          try {
            if (pcRef.current.signalingState === 'have-local-offer') {
              await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.answer))
              await addPendingCandidates()
            }
          } catch (e) {
            console.error('Error handling answer:', e)
          }
        })
        .on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
          if (payload.to !== myId) return
          
          const candidate = new RTCIceCandidate(payload.candidate)
          
          if (pcRef.current?.remoteDescription) {
            try {
              await pcRef.current.addIceCandidate(candidate)
            } catch (e) {
              console.error('Error adding ice candidate:', e)
            }
          } else {
            pendingCandidatesRef.current.push(candidate)
          }
        })
        .subscribe(async (status) => {
          console.log('Channel status:', status)
          if (status === 'SUBSCRIBED') {
            // Announce we're ready
            await channel.send({
              type: 'broadcast',
              event: 'ready',
              payload: { from: myId }
            })
            
            // If we're the initiator, send offer after a short delay
            if (isInitiatorRef.current) {
              retryTimeoutRef.current = setTimeout(async () => {
                if (!offerSentRef.current && mountedRef.current) {
                  console.log('Sending offer (delayed)')
                  await sendOffer()
                }
              }, 1000)
              
              // Retry offer if not connected after 3 seconds
              setTimeout(async () => {
                if (pcRef.current?.connectionState !== 'connected' && !offerSentRef.current && mountedRef.current) {
                  console.log('Retrying offer...')
                  offerSentRef.current = false
                  await sendOffer()
                }
              }, 3000)
            }
          }
        })
    }

    initConnection()

    return () => {
      mountedRef.current = false
      cleanup()
    }
  }, [myId, partnerId, isVideo, setupMedia, createPeerConnection, cleanup, addPendingCandidates, sendOffer, safeSetConnectionStatus, safeSetError])

  // Cleanup local stream on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop())
        localStreamRef.current = null
      }
    }
  }, [])

  return { localStream, remoteStream, connectionStatus, error, retryConnection }
}

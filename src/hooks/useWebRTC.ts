import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { RealtimeChannel } from '@supabase/supabase-js'

const ICE_SERVERS = [
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

export function useWebRTC(myId: string, partnerId: string | null, isVideo: boolean) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'failed'>('idle')
  
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const isInitiatorRef = useRef(false)
  const pendingCandidatesRef = useRef<RTCIceCandidate[]>([])
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const partnerReadyRef = useRef(false)
  const offerSentRef = useRef(false)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const cleanup = useCallback(() => {
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
    setRemoteStream(null)
    setConnectionStatus('idle')
  }, [])

  const setupMedia = useCallback(async () => {
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
      setLocalStream(stream)
      return stream
    } catch (err) {
      console.error('Failed to get media:', err)
      return null
    }
  }, [isVideo])

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
        sender.setParameters(params).catch(e => console.log('Bitrate setting not supported:', e))
      }
    })
  }, [])

  const createPeerConnection = useCallback((stream: MediaStream | null, partnerId: string) => {
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
        setRemoteStream(new MediaStream(remoteStreamRef.current.getTracks()))
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'ice-candidate',
          payload: { candidate: event.candidate.toJSON(), from: myId, to: partnerId }
        }).catch(e => console.error('Failed to send ICE candidate:', e))
      }
    }

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState
      console.log('ICE state:', state)
      if (state === 'connected' || state === 'completed') {
        setConnectionStatus('connected')
        applyBandwidthConstraints(pc)
      } else if (state === 'failed') {
        console.log('ICE failed, restarting...')
        pc.restartIce()
      } else if (state === 'disconnected') {
        setTimeout(() => {
          if (pcRef.current?.iceConnectionState === 'disconnected') {
            console.log('Still disconnected, restarting ICE...')
            pcRef.current.restartIce()
          }
        }, 3000)
      }
    }

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState)
      if (pc.connectionState === 'connected') {
        setConnectionStatus('connected')
      } else if (pc.connectionState === 'failed') {
        setConnectionStatus('failed')
      }
    }

    return pc
  }, [myId, applyBandwidthConstraints])

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
    }
  }, [myId, partnerId])

  useEffect(() => {
    if (!partnerId || !myId || !isVideo) return

    console.log('Setting up WebRTC connection:', myId, '->', partnerId)
    setConnectionStatus('connecting')
    isInitiatorRef.current = myId < partnerId
    pendingCandidatesRef.current = []
    partnerReadyRef.current = false
    offerSentRef.current = false

    const roomId = [myId, partnerId].sort().join('-')
    const channel = supabase.channel(`webrtc:${roomId}`, {
      config: { broadcast: { self: false } }
    })
    channelRef.current = channel

    let pc: RTCPeerConnection | null = null

    const initConnection = async () => {
      const stream = await setupMedia()
      if (!stream) {
        console.error('No media stream available')
        return
      }

      pc = createPeerConnection(stream, partnerId)

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
            await channel.send({
              type: 'broadcast',
              event: 'ready',
              payload: { from: myId }
            })
            
            if (isInitiatorRef.current) {
              retryTimeoutRef.current = setTimeout(async () => {
                if (!offerSentRef.current) {
                  console.log('Sending offer (delayed)')
                  await sendOffer()
                }
              }, 1000)
              
              setTimeout(async () => {
                if (pcRef.current?.connectionState !== 'connected' && !offerSentRef.current) {
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
      cleanup()
    }
  }, [myId, partnerId, isVideo, setupMedia, createPeerConnection, cleanup, addPendingCandidates, sendOffer])

  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop())
        localStreamRef.current = null
      }
    }
  }, [])

  return { localStream, remoteStream, connectionStatus }
}

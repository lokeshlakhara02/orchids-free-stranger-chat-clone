import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import crypto from 'crypto'

function generateSessionId(): string {
  return crypto.randomBytes(16).toString('hex')
}

function hashIP(ip: string): string {
  return crypto.createHash('sha256').update(ip + process.env.SUPABASE_SERVICE_ROLE_KEY).digest('hex').substring(0, 32)
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || 'unknown'
    const ipHash = hashIP(ip)

    const { data: banned } = await supabaseAdmin
      .from('banned_ips')
      .select('id')
      .eq('ip_hash', ipHash)
      .or('banned_until.is.null,banned_until.gt.now()')
      .maybeSingle()

    if (banned) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const sessionId = generateSessionId()

    const { data: user, error } = await supabaseAdmin
      .from('online_users')
      .insert({
        session_id: sessionId,
        ip_hash: ipHash,
        status: 'idle',
        last_heartbeat: new Date().toISOString()
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ 
      sessionId,
      userId: user.id
    })
  } catch (error) {
    console.error('Session create error:', error)
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { sessionId } = await req.json()
    
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('online_users')
      .update({ last_heartbeat: new Date().toISOString() })
      .eq('session_id', sessionId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Heartbeat error:', error)
    return NextResponse.json({ error: 'Failed to update heartbeat' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const sessionId = searchParams.get('sessionId')
    
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 })
    }

    await supabaseAdmin
      .from('matchmaking_queue')
      .delete()
      .eq('session_id', sessionId)

    await supabaseAdmin
      .from('chat_rooms')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .or(`user1_session_id.eq.${sessionId},user2_session_id.eq.${sessionId}`)
      .eq('status', 'active')

    const { error } = await supabaseAdmin
      .from('online_users')
      .delete()
      .eq('session_id', sessionId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Session delete error:', error)
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 })
  }
}

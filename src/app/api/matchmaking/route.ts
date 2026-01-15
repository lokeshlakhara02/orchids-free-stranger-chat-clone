import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { ChatType } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { sessionId, chatType } = await req.json() as {
      sessionId: string
      chatType: ChatType
    }

    if (!sessionId || !chatType) {
      return NextResponse.json({ error: 'Session ID and chat type required' }, { status: 400 })
    }

    const { data: existingEntry } = await supabaseAdmin
      .from('matchmaking_queue')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle()

    if (existingEntry?.matched_with) {
      return NextResponse.json({
        matched: true,
        partnerId: existingEntry.matched_with
      })
    }

    const { data: potentialMatch } = await supabaseAdmin
      .from('matchmaking_queue')
      .select('*')
      .eq('chat_type', chatType)
      .is('matched_with', null)
      .neq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (potentialMatch) {
      const now = new Date().toISOString()
      
      const { error: updateError } = await supabaseAdmin
        .from('matchmaking_queue')
        .update({ 
          matched_with: sessionId, 
          matched_at: now 
        })
        .eq('id', potentialMatch.id)
        .is('matched_with', null)

      if (!updateError) {
        await supabaseAdmin
          .from('matchmaking_queue')
          .upsert({
            session_id: sessionId,
            chat_type: chatType,
            matched_with: potentialMatch.session_id,
            matched_at: now
          }, { onConflict: 'session_id' })

        return NextResponse.json({
          matched: true,
          partnerId: potentialMatch.session_id
        })
      }
    }

    await supabaseAdmin
      .from('matchmaking_queue')
      .upsert({
        session_id: sessionId,
        chat_type: chatType,
        matched_with: null,
        matched_at: null
      }, { onConflict: 'session_id' })

    return NextResponse.json({
      matched: false,
      status: 'searching'
    })
  } catch (error) {
    console.error('Matchmaking error:', error)
    return NextResponse.json({ error: 'Matchmaking failed' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const sessionId = searchParams.get('sessionId')

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 })
    }

    const { data: entry } = await supabaseAdmin
      .from('matchmaking_queue')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle()

    if (entry?.matched_with) {
      return NextResponse.json({
        matched: true,
        partnerId: entry.matched_with
      })
    }

    return NextResponse.json({
      matched: false,
      status: entry ? 'searching' : 'idle'
    })
  } catch (error) {
    console.error('Match status error:', error)
    return NextResponse.json({ error: 'Failed to check status' }, { status: 500 })
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

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Cancel matchmaking error:', error)
    return NextResponse.json({ error: 'Failed to cancel' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  try {
    const { sessionId, reportedSessionId, roomId, reason, description } = await req.json()

    if (!sessionId || !reportedSessionId || !reason) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const validReasons = ['inappropriate', 'spam', 'harassment', 'underage', 'other']
    if (!validReasons.includes(reason)) {
      return NextResponse.json({ error: 'Invalid reason' }, { status: 400 })
    }

    const { data: reporter } = await supabaseAdmin
      .from('online_users')
      .select('id')
      .eq('session_id', sessionId)
      .single()

    if (!reporter) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const { data: report, error } = await supabaseAdmin
      .from('user_reports')
      .insert({
        reporter_session_id: sessionId,
        reported_session_id: reportedSessionId,
        room_id: roomId || null,
        reason,
        description: description?.substring(0, 1000) || null,
        status: 'pending'
      })
      .select()
      .single()

    if (error) throw error

    const { count: reportCount } = await supabaseAdmin
      .from('user_reports')
      .select('*', { count: 'exact', head: true })
      .eq('reported_session_id', reportedSessionId)
      .eq('status', 'pending')

    if (reportCount && reportCount >= 3) {
      const { data: reported } = await supabaseAdmin
        .from('online_users')
        .select('ip_hash')
        .eq('session_id', reportedSessionId)
        .single()

      if (reported?.ip_hash) {
        await supabaseAdmin
          .from('banned_ips')
          .upsert({
            ip_hash: reported.ip_hash,
            reason: `Auto-ban: ${reportCount} reports`,
            banned_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          }, { onConflict: 'ip_hash' })

        await supabaseAdmin
          .from('user_reports')
          .update({ status: 'actioned' })
          .eq('reported_session_id', reportedSessionId)
          .eq('status', 'pending')
      }
    }

    return NextResponse.json({ 
      success: true,
      reportId: report.id
    })
  } catch (error) {
    console.error('Report error:', error)
    return NextResponse.json({ error: 'Failed to submit report' }, { status: 500 })
  }
}

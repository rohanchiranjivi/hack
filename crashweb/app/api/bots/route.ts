import { NextRequest, NextResponse } from 'next/server';
import { botManager } from '@/bots/runner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(botManager.getStats());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === 'start') {
      const stats = botManager.start({
        targetUrl: body.targetUrl || 'http://localhost:3000',
        botCount: typeof body.botCount === 'number' ? body.botCount : 3,
        intervalMs: typeof body.intervalMs === 'number' ? body.intervalMs : 1500,
        mode: body.mode || 'random',
        targetedScenario: body.targetedScenario || 'be-db-pool-exhausted',
      });
      return NextResponse.json({ ok: true, stats, message: 'Bots started.' });
    }

    if (action === 'stop') {
      const stats = botManager.stop();
      return NextResponse.json({ ok: true, stats, message: 'Bots stopped.' });
    }

    return NextResponse.json({ error: 'Invalid action. Use start or stop.' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}


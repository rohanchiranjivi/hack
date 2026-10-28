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
        targetUrl: body.targetUrl || process.env.TARGET_URL || 'https://crashweb-gules.vercel.app',
        botCount: typeof body.botCount === 'number' ? body.botCount : 4,
        intervalMs: typeof body.intervalMs === 'number' ? body.intervalMs : 600,
        mode: body.mode || 'stress',
        targetedScenario: body.targetedScenario || 'be-storage-503',
      });
      return NextResponse.json({ ok: true, stats, message: 'Attack fleet started.' });
    }

    if (action === 'stop') {
      const stats = botManager.stop();
      return NextResponse.json({ ok: true, stats, message: 'Attack fleet stopped.' });
    }

    if (action === 'flood500') {
      // Asynchronously trigger rapid flood to 500 crashes
      const targetCount = typeof body.count === 'number' ? body.count : 500;
      botManager.triggerFlood500(targetCount);
      return NextResponse.json({
        ok: true,
        message: `Rapid flood attack wave (${targetCount} crashes) launched against victim site.`,
        stats: botManager.getStats(),
      });
    }

    return NextResponse.json({ error: 'Invalid action. Use start, stop, or flood500.' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

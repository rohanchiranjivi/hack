import { NextRequest, NextResponse } from 'next/server';
import {
  addCartItem, adminAuthorized, AuthError, BackendUnavailable, controlAction,
  currentAccount, databaseConfigured, getSnapshot, loginAccount, logoutAccount,
  placeOrder, PoolLimitError, registerAccount, removeCartItem, subscribeNewsletter, toggleWishlist,
} from '@/lib/backend';
import { sendCrashReport } from '@/lib/reporter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const COOKIE = 'zon_session';
const sessionCookie = (response: NextResponse, token: string) => response.cookies.set(COOKIE, token, {
  httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 60 * 60 * 24 * 7,
});

function failure(error: unknown, req?: NextRequest) {
  const url = req ? req.nextUrl.pathname + req.nextUrl.search : '/api/engine';
  const botId = req?.headers.get('x-bot-id') || undefined;
  const sessionId = req?.cookies.get(COOKIE)?.value || req?.headers.get('x-session-id') || undefined;

  if (error instanceof AuthError) {
    const status = error.code === 'ACCOUNT_EXISTS' ? 409 : error.code === 'INVALID_CREDENTIALS' ? 401 : error.code === 'UNKNOWN_ACTION' ? 404 : error.code === 'SERVICE_UNAVAILABLE' ? 503 : 400;
    if (status >= 500) {
      sendCrashReport({
        errorType: 'AuthError_' + error.code,
        message: error.message,
        url,
        httpStatus: status,
        botId,
        sessionId,
        severityHint: 'high',
      }).catch(() => {});
    }
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  if (error instanceof PoolLimitError) {
    sendCrashReport({
      errorType: 'PoolLimitError',
      message: error.message || 'Database connection pool exhausted during high traffic.',
      url,
      httpStatus: 503,
      botId,
      sessionId,
      severityHint: 'critical',
    }).catch(() => {});
    return NextResponse.json({ error: error.message, code: 'STORE_BUSY' }, { status: 503 });
  }
  if (error instanceof BackendUnavailable) {
    sendCrashReport({
      errorType: 'BackendUnavailable',
      message: error.message,
      url,
      httpStatus: 503,
      botId,
      sessionId,
      severityHint: 'critical',
    }).catch(() => {});
    return NextResponse.json({ error: 'Persistent storage is not configured. Add the Upstash Redis environment variables in Vercel.', code: 'STORAGE_NOT_CONFIGURED' }, { status: 503 });
  }
  console.error('Zon API request failed:', error);
  sendCrashReport({
    errorType: 'InternalServerError',
    message: error instanceof Error ? error.message : 'Unhandled exception in Zon API engine',
    stackTrace: error instanceof Error ? error.stack : undefined,
    url,
    httpStatus: 500,
    botId,
    sessionId,
    severityHint: 'critical',
  }).catch(() => {});
  return NextResponse.json({ error: 'We couldn’t complete that request. Please try again.', code: 'INTERNAL_ERROR' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const result = await getSnapshot(req.cookies.get(COOKIE)?.value, adminAuthorized(req.headers.get('x-zon-admin-key')));
    return NextResponse.json({ ...result, storageReady: databaseConfigured() || process.env.NODE_ENV !== 'production' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error, req); }
}

export async function DELETE(req: NextRequest) {
  try {
    await logoutAccount(req.cookies.get(COOKIE)?.value);
    const response = NextResponse.json({ ok: true, message: 'You’re signed out.' });
    response.cookies.set(COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
    return response;
  } catch (error) { return failure(error, req); }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === 'string' ? body.action : '';
    if (action === 'register' || action === 'login') {
      const result = action === 'register'
        ? await registerAccount({ email: body.email, password: body.password, name: body.name })
        : await loginAccount(body.email, body.password);
      const response = NextResponse.json({ ok: true, user: { email: result.account.email, name: result.account.name }, message: action === 'register' ? 'Your Zon account is ready.' : 'Welcome back.' });
      sessionCookie(response, result.token);
      return response;
    }
    if (action === 'newsletter') { await subscribeNewsletter(body.email); return NextResponse.json({ ok: true, message: 'You’re on the list. Look out for a note from Zon.' }); }
    if (action === 'random-check' && process.env.ENABLE_CHAOS !== 'true') return NextResponse.json({ ok: true });
    if (['simulate-user', 'gateway', 'dependency', 'reboot', 'random-check'].includes(action)) {
      if (!adminAuthorized(req.headers.get('x-zon-admin-key'))) return NextResponse.json({ error: 'System monitor access is not enabled.', code: 'ADMIN_DISABLED' }, { status: 403 });
      await controlAction(action);
      return NextResponse.json({ ok: true, message: action === 'reboot' ? 'System reboot complete.' : 'Incident simulation started.' });
    }
    const account = await currentAccount(req.cookies.get(COOKIE)?.value);
    if (action === 'cart-add' || action === 'cart-remove' || action === 'checkout' || action === 'wishlist') {
      if (!account) return NextResponse.json({ error: 'Sign in to sync your bag and place an order.', code: 'AUTH_REQUIRED' }, { status: 401 });
      if (action === 'wishlist') { const wishlist = await toggleWishlist(account, body.productId); return NextResponse.json({ ok: true, wishlist, message: 'Saved items updated.' }); }
      if (action === 'checkout') {
        const snapshot = await getSnapshot(req.cookies.get(COOKIE)?.value);
        if (snapshot.crash === 'dependency') {
          sendCrashReport({
            errorType: 'PaymentGatewayDown',
            message: 'Payment Gateway service unavailable: Downstream processor failed.',
            url: '/api/engine?action=checkout',
            httpStatus: 503,
            botId: req.headers.get('x-bot-id') || undefined,
            sessionId: req.cookies.get(COOKIE)?.value,
            severityHint: 'critical',
          }).catch(() => {});
          return NextResponse.json({ error: 'The payment service is temporarily unavailable. Your bag is safe; please try again shortly.', code: 'PAYMENT_UNAVAILABLE' }, { status: 503 });
        }
        if (snapshot.crash) return NextResponse.json({ error: 'Checkout is temporarily unavailable while we restore the store.', code: 'CHECKOUT_UNAVAILABLE' }, { status: 503 });
      }
      if (action === 'cart-add') { const cart = await addCartItem(account, body.productId); return NextResponse.json({ ok: true, cart, message: 'Added to your bag.' }); }
      if (action === 'cart-remove') { const cart = await removeCartItem(account, body.index); return NextResponse.json({ ok: true, cart }); }
      const order = await placeOrder(account);
      return NextResponse.json({ ok: true, order, orderId: order.id, message: 'Order confirmed. Thanks for shopping with Zon.' });
    }
    throw new AuthError('UNKNOWN_ACTION', 'That action is not available.');
  } catch (error) { return failure(error, req); }
}

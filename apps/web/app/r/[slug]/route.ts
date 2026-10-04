import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const home = new URL('https://petitannonces.fr/');
  if (!/^[a-z0-9][a-z0-9-]{2,49}$/.test(slug)) return NextResponse.redirect(home, 302);
  try {
    const base = (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
    const result = await fetch(`${base}/partners/resolve/${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (!result.ok) return NextResponse.redirect(home, 302);
    const x = await result.json() as { source?: string; medium?: string; campaign?: string };
    if (!x.campaign || x.campaign !== `inf-${slug}` || !['instagram', 'tiktok', 'youtube', 'facebook'].includes(x.source ?? '')) {
      return NextResponse.redirect(home, 302);
    }
    home.searchParams.set('utm_source', x.source!);
    home.searchParams.set('utm_medium', 'influencer');
    home.searchParams.set('utm_campaign', `inf-${slug}`);
    const response = NextResponse.redirect(home, 302);
    response.headers.set('Cache-Control', 'no-store, max-age=0');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return response;
  } catch { return NextResponse.redirect(home, 302); }
}

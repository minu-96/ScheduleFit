#!/bin/sh
# dist/ 를 만든다 (Cloudflare Pages 직접 업로드용). 사용: sh build.sh
set -e
cd "$(dirname "$0")"
mkdir -p dist
cp public/index.html public/room.html public/ops.html public/room.js public/style.css public/sitemap.xml public/robots.txt dist/
{
  sed 's/^export async function onRequest(/async function handle(/' "functions/api/[[path]].js"
  cat <<'JS'

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const path = url.pathname.slice(5).split('/').filter(Boolean);
      return handle({ request, env, params: { path } });
    }
    // 구글 서치 콘솔 소유권 확인 파일 (Pages가 .html 주소를 다른 주소로 돌려보내지 않게 직접 응답)
    if (url.pathname === '/google471348976b5f6f1f.html') {
      return new Response('google-site-verification: google471348976b5f6f1f.html', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (/^\/r\/[^/]+\/?$/.test(url.pathname)) {
      return env.ASSETS.fetch(new Request(new URL('/room', url), request));
    }
    return env.ASSETS.fetch(request);
  },
};
JS
} > dist/_worker.js

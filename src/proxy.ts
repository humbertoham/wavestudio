import type { NextRequest } from "next/server";

import { middleware as handleAccessRequest } from "../middleware";

export function proxy(req: NextRequest) {
  return handleAccessRequest(req);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?|ttf|webmanifest)$).*)",
  ],
};

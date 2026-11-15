import { NextRequest, NextResponse } from "next/server";
import { suggestIndianCities } from "@/lib/indianCities";

export function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ suggestions: suggestIndianCities(query) }, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}

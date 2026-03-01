import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { bezier, smooth, projectId } = body;

    const publicDir = join(process.cwd(), "public");

    if (projectId) {
      const projectDir = join(publicDir, "projects", projectId);
      await mkdir(projectDir, { recursive: true });

      if (bezier) {
        await writeFile(
          join(projectDir, "bezier.json"),
          JSON.stringify(bezier, null, 2),
          "utf-8"
        );
      }
      if (smooth) {
        await writeFile(
          join(projectDir, "smooth.json"),
          JSON.stringify(smooth, null, 2),
          "utf-8"
        );
      }
    } else {
      if (bezier) {
        await writeFile(
          join(publicDir, "talkie-bezier.json"),
          JSON.stringify(bezier, null, 2),
          "utf-8"
        );
      }
      if (smooth) {
        await writeFile(
          join(publicDir, "talkie-smooth.json"),
          JSON.stringify(smooth, null, 2),
          "utf-8"
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Save failed:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

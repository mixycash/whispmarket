import { NextResponse } from "next/server";
import { setupDatabase } from "@/app/actions";

export async function GET() {
    try {
        await setupDatabase();
        return NextResponse.json({ success: true, message: "Database migrations applied" });
    } catch (e) {
        console.error("Migration error:", e);
        return NextResponse.json({ success: false, error: "Migration failed" }, { status: 500 });
    }
}

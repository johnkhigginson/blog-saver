// Offline check: mbox splitting + mailparser parse (no DB).
import { splitMbox } from "@/lib/email-import";
import { simpleParser } from "mailparser";

const mbox = `From 12345@mail.gmail.com Mon Aug 08 16:00:00 +0000 2016
From: Elder Kimball <elder@mission.org>
Subject: Week 1 - Arrived in the MTC
Date: Mon, 8 Aug 2016 09:00:00 -0700
Content-Type: text/plain; charset="UTF-8"

Dear family, I made it to the MTC! It is wonderful here.
Love, Elder Kimball

From 67890@mail.gmail.com Mon Aug 15 16:00:00 +0000 2016
From: Elder Kimball <elder@mission.org>
Subject: Week 2 - Learning Thai
Date: Mon, 15 Aug 2016 09:00:00 -0700
Content-Type: text/html; charset="UTF-8"

<p>This week we started <b>Thai</b> lessons. So hard but so good!</p>
`;

async function main() {
  const msgs = splitMbox(mbox);
  console.log(`split into ${msgs.length} messages`);
  let failures = 0;
  const seen: string[] = [];
  for (const raw of msgs) {
    const m = await simpleParser(raw);
    const body = typeof m.html === "string" && m.html ? m.html : m.text || "";
    seen.push(m.subject || "");
    console.log(
      `  - "${m.subject}" | ${m.date?.toISOString().slice(0, 10) ?? "?"} | from ${m.from?.value?.[0]?.name ?? "?"} | ${body.length} body chars`
    );
    if (!m.subject || !m.date || !body) failures++;
  }
  const ok = msgs.length === 2 && seen.includes("Week 1 - Arrived in the MTC") && seen.includes("Week 2 - Learning Thai") && failures === 0;
  console.log(ok ? "\nEMAIL PARSE OK" : `\nEMAIL PARSE FAILED (${failures} bad)`);
  process.exit(ok ? 0 : 1);
}
main();

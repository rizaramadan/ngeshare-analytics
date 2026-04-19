import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import pg from 'pg';

// Event date: override with `EVENT_DATE=YYYY-MM-DD npm run ...` or CLI arg.
const eventArg = process.argv[2] || process.env.EVENT_DATE;
const EVENT_DATE = eventArg ? new Date(eventArg) : new Date();

const MONTHS_ID = ['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember'];
const eventDay = EVENT_DATE.getDate();
const eventMonth = MONTHS_ID[EVENT_DATE.getMonth()];
const eventYear = EVENT_DATE.getFullYear();
const EVENT_LABEL = `${eventDay} ${eventMonth.charAt(0).toUpperCase() + eventMonth.slice(1)} ${eventYear}`;
const FILENAME_SLUG = `${eventDay}-${eventMonth}-${eventYear}`;

const OUTPUT_DIR = path.join(process.cwd(), 'meetings', 'onboarding');
const OUTPUT_PATH = path.join(OUTPUT_DIR, `onboarding-reminder-${FILENAME_SLUG}.pdf`);
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const pool = new pg.Pool({
  host: 'localhost',
  port: 5432,
  database: 'ngeshare_local',
  user: 'postgreuser',
  password: 'mainmain',
});

const rows = (await pool.query(`
  SELECT
    nom_profile."fullName" as nominee,
    nom_profile."phoneNumber" as nominee_phone,
    fac_profile."fullName" as facilitator,
    fac_profile."phoneNumber" as fac_phone
  FROM "UserBadgeNomination" ubn
  JOIN "Badge" b ON b.id = ubn."badgeId"
  LEFT JOIN "UserProfile" nom_profile ON nom_profile."userId" = ubn."nominatedUserId"
  LEFT JOIN LATERAL (
    SELECT DISTINCT ON (uhg_mem."userId") fac_uhg."userId" as fac_user_id
    FROM "UserHangoutGroup" uhg_mem
    JOIN "UserHangoutGroup" fac_uhg
      ON fac_uhg."hangoutGroupId" = uhg_mem."hangoutGroupId"
      AND fac_uhg."hangoutGroupRole" = 'FACILITATOR'
    WHERE uhg_mem."userId" = ubn."nominatedUserId"
      AND uhg_mem."hangoutGroupRole" = 'MEMBER'
    ORDER BY uhg_mem."userId", uhg_mem."joinedAt" DESC
  ) fac ON true
  LEFT JOIN "UserProfile" fac_profile ON fac_profile."userId" = fac.fac_user_id
  WHERE ubn.status = 'PENDING'
  ORDER BY fac_profile."fullName", nom_profile."fullName"
`)).rows;

await pool.end();

// Group by facilitator
const facMap = new Map();
for (const r of rows) {
  if (!facMap.has(r.facilitator)) facMap.set(r.facilitator, { phone: r.fac_phone, nominees: [] });
  facMap.get(r.facilitator).nominees.push({ name: r.nominee?.trim(), phone: r.nominee_phone });
}

function cleanPhone(p) {
  return (p || '').replace(/[^0-9]/g, '');
}

function firstName(fullName) {
  return (fullName || '').trim().split(/\s+/)[0];
}

function waLink(phone, text) {
  return `https://wa.me/${cleanPhone(phone)}?text=${encodeURIComponent(text)}`;
}

// Create PDF
const doc = new PDFDocument({ size: 'A4', margin: 50 });
const output = fs.createWriteStream(OUTPUT_PATH);
doc.pipe(output);

const green = '#2e7d32';
const darkGray = '#333333';
const lightGray = '#f5f5f5';
const blue = '#1565c0';

// Title
doc.fontSize(20).fillColor(green).text('Onboarding Fasilitator Ngeshare', { align: 'center' });
doc.fontSize(14).fillColor(darkGray).text(EVENT_LABEL, { align: 'center' });
doc.moveDown(0.5);
doc.fontSize(10).fillColor('#666').text(`${rows.length} nominee pending  •  ${facMap.size} fasilitator`, { align: 'center' });
doc.moveDown(1.5);

// Section 1: Per-nominee links
doc.fontSize(16).fillColor(green).text('WA Link ke Nominee');
doc.moveDown(0.3);
doc.fontSize(9).fillColor('#666').text(`Pesan: "Assalamu'alaikum Kak [Nama Pertama], mohon bisa ikuti onboarding Fasilitator Ngeshare pada tanggal ${EVENT_LABEL}. Terima kasih."`);
doc.moveDown(0.8);

// Table header
const col = { no: 50, nominee: 80, nPhone: 230, facilitator: 340, link: 460 };
const colW = { no: 25, nominee: 145, nPhone: 105, facilitator: 115, link: 85 };

function drawTableHeader() {
  const y = doc.y;
  doc.rect(col.no, y, 495, 18).fill(green);
  doc.fontSize(9).fillColor('white');
  doc.text('No', col.no + 4, y + 4, { width: colW.no });
  doc.text('Nominee', col.nominee + 4, y + 4, { width: colW.nominee });
  doc.text('No. HP', col.nPhone + 4, y + 4, { width: colW.nPhone });
  doc.text('Fasilitator', col.facilitator + 4, y + 4, { width: colW.facilitator });
  doc.text('WA Link', col.link + 4, y + 4, { width: colW.link });
  doc.y = y + 22;
}

drawTableHeader();

let rowNum = 0;
for (const [fac, info] of facMap) {
  for (const n of info.nominees) {
    rowNum++;
    const y = doc.y;

    if (y > 740) {
      doc.addPage();
      drawTableHeader();
    }

    const rowY = doc.y;
    const bgColor = rowNum % 2 === 0 ? lightGray : 'white';
    doc.rect(col.no, rowY, 495, 16).fill(bgColor);

    doc.fontSize(8).fillColor(darkGray);
    doc.text(String(rowNum), col.no + 4, rowY + 4, { width: colW.no });
    doc.text(n.name || '-', col.nominee + 4, rowY + 4, { width: colW.nominee });
    doc.text(n.phone || '-', col.nPhone + 4, rowY + 4, { width: colW.nPhone });
    doc.text(fac || '-', col.facilitator + 4, rowY + 4, { width: colW.facilitator });

    const nomineeMsg = `Assalamu'alaikum Kak ${firstName(n.name)}, mohon bisa ikuti onboarding Fasilitator Ngeshare pada tanggal ${EVENT_LABEL}. Terima kasih.`;
    const link = waLink(n.phone, nomineeMsg);
    doc.fontSize(8).fillColor(blue)
      .text('Kirim WA', col.link + 4, rowY + 4, { width: colW.link, link, underline: true });

    doc.x = 50;
    doc.y = rowY + 18;
  }
}

// Section 2: Per-facilitator links
doc.x = 50;
doc.addPage();

doc.fontSize(16).fillColor(green).text('WA Link ke Fasilitator', 50);
doc.moveDown(0.3);
doc.fontSize(9).fillColor('#666').text('Pesan berisi daftar nominee masing-masing fasilitator untuk diingatkan ikut onboarding.', 50);
doc.moveDown(0.8);

for (const [fac, info] of facMap) {
  if (doc.y > 700) doc.addPage();

  const y = doc.y;
  doc.rect(50, y, 495, 20).fill('#e8f5e9');
  doc.fontSize(11).fillColor(green).text(`${fac}`, 56, y + 4, { continued: true });
  doc.fontSize(9).fillColor('#666').text(`  (${info.phone})  —  ${info.nominees.length} nominee`);
  doc.y = y + 24;

  const nameList = info.nominees.map((n, i) => `${i + 1}. ${n.name}`).join('\n');
  const facMsg = `Assalamu'alaikum Kak ${firstName(fac)}, mohon bantu ingatkan nominee berikut untuk ikuti onboarding Fasilitator Ngeshare pada tanggal ${EVENT_LABEL}:\n\n${nameList}\n\nTerima kasih atas bantuannya.`;
  const facLink = waLink(info.phone, facMsg);

  for (const [i, n] of info.nominees.entries()) {
    doc.fontSize(9).fillColor(darkGray).text(`   ${i + 1}. ${n.name}  —  ${n.phone}`, 60);
  }

  doc.moveDown(0.3);
  doc.fontSize(9).fillColor(blue).text('>> Kirim WA Reminder ke Fasilitator', 60, doc.y, { link: facLink, underline: true });
  doc.moveDown(0.8);
}

// Footer
doc.moveDown(1);
doc.fontSize(8).fillColor('#999').text(`Generated: ${new Date().toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' })}`, { align: 'center' });

doc.end();
await new Promise(resolve => output.on('finish', resolve));
console.log(`PDF created: ${OUTPUT_PATH}`);

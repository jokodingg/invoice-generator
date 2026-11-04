export function invoicePdfTitle(client, invoiceDate) {
  const date = invoiceDate ? new Date(`${invoiceDate}T12:00:00`) : new Date();
  const monthYear = Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(new Date())
    : new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(date);
  const safeClient = String(client ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ") || "Tanpa Nama Klien";
  return `Invoice - ${safeClient} - ${monthYear}`;
}

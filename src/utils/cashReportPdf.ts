import { jsPDF } from 'jspdf';
import {
  ExpenseCategory,
  ExpenseRecord,
  PaymentMethod,
  PaymentRecord,
  PressingOrder,
  PressingSettings,
} from '../types/pressing';
import {
  EXPENSE_CATEGORIES,
  formatDateFR,
  formatDateTimeFR,
  formatFCFA,
  PAYMENT_METHOD_LABELS,
} from './formatters';

function pdfSafe(input: string | number | undefined | null): string {
  return String(input ?? '')
    .replace(/[\u202f\u00a0]/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2192/g, '->');
}

function drawReportHeader(
  doc: jsPDF,
  settings: PressingSettings,
  title: string,
  subtitle: string
): number {
  const marginX = 14;
  const pageWidth = 210;
  let y = 14;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(pdfSafe(settings.shopName), marginX, y + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(71, 85, 105);
  doc.text(
    pdfSafe(`${settings.address} · ${settings.commune} · Tél : ${settings.phone}`),
    marginX,
    y + 9
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 118, 110);
  doc.text(pdfSafe(title), pageWidth - marginX, y + 4, { align: 'right' });

  doc.setFont('courier', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(pdfSafe(subtitle), pageWidth - marginX, y + 9, { align: 'right' });

  y += 13;
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.5);
  doc.line(marginX, y, pageWidth - marginX, y);
  return y + 6;
}

export function exportDailyZReportPdf(params: {
  dateISO: string;
  orders: PressingOrder[];
  payments: PaymentRecord[];
  expenses: ExpenseRecord[];
  settings: PressingSettings;
}): string {
  const { dateISO, orders, payments, expenses, settings } = params;
  const dayOrders = orders.filter((o) => o.dropOffDate === dateISO || o.createdAt.slice(0, 10) === dateISO);
  const dayPayments = payments.filter((p) => p.paidAt.slice(0, 10) === dateISO);
  const dayExpenses = expenses.filter((e) => e.date === dateISO);

  const totalIn = dayPayments.reduce((s, p) => s + p.amountFCFA, 0);
  const totalOut = dayExpenses.reduce((s, e) => s + e.amountFCFA, 0);
  const netDay = totalIn - totalOut;
  const billedDay = dayOrders.reduce((s, o) => s + o.totalFCFA, 0);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const marginX = 14;
  const pageWidth = 210;
  const pageHeight = 297;
  const contentW = pageWidth - marginX * 2;

  let y = drawReportHeader(
    doc,
    settings,
    'CLÔTURE DE CAISSE (Z)',
    `Journée du ${formatDateFR(dateISO)} · Édité le ${formatDateTimeFR(new Date().toISOString())}`
  );

  // KPI strip (4 boxes)
  const boxW = (contentW - 9) / 4;
  const kpis = [
    { label: 'Tickets déposés', val: `${dayOrders.length} (${formatFCFA(billedDay)})`, color: [15, 23, 42] as [number, number, number] },
    { label: 'Recettes encaissées', val: formatFCFA(totalIn), color: [4, 120, 87] as [number, number, number] },
    { label: 'Dépenses du jour', val: formatFCFA(totalOut), color: [185, 28, 28] as [number, number, number] },
    { label: 'Solde net en caisse', val: formatFCFA(netDay), color: [15, 23, 42] as [number, number, number] },
  ];

  kpis.forEach((k, idx) => {
    const bx = marginX + idx * (boxW + 3);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(bx, y, boxW, 14, 1.2, 1.2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(pdfSafe(k.label), bx + 2.5, y + 4.8);
    doc.setFont('courier', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(k.color[0], k.color[1], k.color[2]);
    doc.text(pdfSafe(k.val), bx + 2.5, y + 10.8, { maxWidth: boxW - 5 });
  });

  y += 20;

  // Channel reconciliation table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Ventilation par canal de paiement (Comptage tiroir & Mobile Money)', marginX, y);
  y += 2.5;

  const drawChannelHeader = (hy: number) => {
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(148, 163, 184);
    doc.rect(marginX, hy, contentW, 6.8, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.4);
    doc.setTextColor(30, 41, 59);
    doc.text('Canal de paiement', marginX + 2.5, hy + 4.5);
    doc.text('Opérations', marginX + 86, hy + 4.5, { align: 'right' });
    doc.text('Entrées', marginX + 120, hy + 4.5, { align: 'right' });
    doc.text('Sorties', marginX + 152, hy + 4.5, { align: 'right' });
    doc.text('Solde net', pageWidth - marginX - 2.5, hy + 4.5, { align: 'right' });
    return hy + 6.8;
  };

  y = drawChannelHeader(y);

  (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).forEach((m, idx) => {
    const mPayments = dayPayments.filter((p) => p.method === m);
    const mExpenses = dayExpenses.filter((e) => e.method === m);
    const inflow = mPayments.reduce((s, p) => s + p.amountFCFA, 0);
    const outflow = mExpenses.reduce((s, e) => s + e.amountFCFA, 0);
    const net = inflow - outflow;

    doc.setFillColor(idx % 2 === 1 ? 248 : 255, idx % 2 === 1 ? 250 : 255, idx % 2 === 1 ? 252 : 255);
    doc.setDrawColor(203, 213, 225);
    doc.rect(marginX, y, contentW, 6.2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.6);
    doc.setTextColor(15, 23, 42);
    doc.text(pdfSafe(PAYMENT_METHOD_LABELS[m]), marginX + 2.5, y + 4.3);

    doc.setFont('courier', 'normal');
    doc.text(String(mPayments.length + mExpenses.length), marginX + 86, y + 4.3, { align: 'right' });
    doc.setTextColor(4, 120, 87);
    doc.text(pdfSafe(formatFCFA(inflow)), marginX + 120, y + 4.3, { align: 'right' });
    doc.setTextColor(185, 28, 28);
    doc.text(pdfSafe(formatFCFA(outflow)), marginX + 152, y + 4.3, { align: 'right' });
    doc.setFont('courier', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(pdfSafe(formatFCFA(net)), pageWidth - marginX - 2.5, y + 4.3, { align: 'right' });
    y += 6.2;
  });

  // Total row
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(148, 163, 184);
  doc.rect(marginX, y, contentW, 6.8, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.6);
  doc.setTextColor(15, 23, 42);
  doc.text('TOTAL JOURNÉE', marginX + 2.5, y + 4.6);
  doc.setFont('courier', 'bold');
  doc.text(String(dayPayments.length + dayExpenses.length), marginX + 86, y + 4.6, {
    align: 'right',
  });
  doc.text(pdfSafe(formatFCFA(totalIn)), marginX + 120, y + 4.6, { align: 'right' });
  doc.text(pdfSafe(formatFCFA(totalOut)), marginX + 152, y + 4.6, { align: 'right' });
  doc.text(pdfSafe(formatFCFA(netDay)), pageWidth - marginX - 2.5, y + 4.6, { align: 'right' });
  y += 12;

  // Payments list
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Détail des encaissements (${dayPayments.length})`, marginX, y);
  y += 2.5;

  if (dayPayments.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.6);
    doc.setTextColor(100, 116, 139);
    doc.text('Aucun encaissement enregistré à cette date.', marginX, y + 4);
    y += 9;
  } else {
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(148, 163, 184);
    doc.rect(marginX, y, contentW, 6.2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(30, 41, 59);
    doc.text('Heure', marginX + 2, y + 4.2);
    doc.text('Référence', marginX + 24, y + 4.2);
    doc.text('Client', marginX + 58, y + 4.2);
    doc.text('Canal', marginX + 114, y + 4.2);
    doc.text('Montant', pageWidth - marginX - 2, y + 4.2, { align: 'right' });
    y += 6.2;

    for (const p of dayPayments) {
      if (y > pageHeight - 28) {
        doc.addPage();
        y = 16;
      }
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(226, 232, 240);
      doc.rect(marginX, y, contentW, 5.6, 'FD');
      doc.setFont('courier', 'normal');
      doc.setFontSize(7.1);
      doc.setTextColor(71, 85, 105);
      doc.text(pdfSafe(p.paidAt.slice(11, 16) || '--:--'), marginX + 2, y + 3.9);
      doc.setTextColor(15, 23, 42);
      doc.text(pdfSafe(p.ticketNumber), marginX + 24, y + 3.9);
      doc.setFont('helvetica', 'normal');
      doc.text(pdfSafe(p.clientName), marginX + 58, y + 3.9, { maxWidth: 52 });
      doc.text(pdfSafe(PAYMENT_METHOD_LABELS[p.method]), marginX + 114, y + 3.9);
      doc.setFont('courier', 'bold');
      doc.setTextColor(4, 120, 87);
      doc.text(pdfSafe(`+${formatFCFA(p.amountFCFA)}`), pageWidth - marginX - 2, y + 3.9, {
        align: 'right',
      });
      y += 5.6;
    }
    y += 6;
  }

  // Expenses list
  if (y > pageHeight - 40) {
    doc.addPage();
    y = 16;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Détail des dépenses (${dayExpenses.length})`, marginX, y);
  y += 2.5;

  if (dayExpenses.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.6);
    doc.setTextColor(100, 116, 139);
    doc.text('Aucune dépense enregistrée à cette date.', marginX, y + 4);
    y += 10;
  } else {
    for (const ex of dayExpenses) {
      if (y > pageHeight - 25) {
        doc.addPage();
        y = 16;
      }
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(226, 232, 240);
      doc.rect(marginX, y, contentW, 5.8, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(15, 23, 42);
      doc.text(pdfSafe(ex.label), marginX + 2, y + 4.0, { maxWidth: 80 });
      doc.setTextColor(100, 116, 139);
      doc.text(pdfSafe(`${ex.category} · ${PAYMENT_METHOD_LABELS[ex.method]}`), marginX + 86, y + 4.0);
      doc.setFont('courier', 'bold');
      doc.setTextColor(185, 28, 28);
      doc.text(pdfSafe(`-${formatFCFA(ex.amountFCFA)}`), pageWidth - marginX - 2, y + 4.0, {
        align: 'right',
      });
      y += 5.8;
    }
    y += 8;
  }

  // Signature block
  if (y > pageHeight - 28) {
    doc.addPage();
    y = 20;
  }
  doc.setDrawColor(148, 163, 184);
  doc.line(marginX, y + 12, marginX + 55, y + 12);
  doc.line(pageWidth - marginX - 55, y + 12, pageWidth - marginX, y + 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  doc.setTextColor(71, 85, 105);
  doc.text('Visa Caissier / Contrôle fonds', marginX + 27.5, y + 16, { align: 'center' });
  doc.text('Visa Direction / Gérant', pageWidth - marginX - 27.5, y + 16, { align: 'center' });

  const fileName = `Cloture-Z-${dateISO}.pdf`;
  doc.save(fileName);
  return fileName;
}

export function exportMonthlyReportPdf(params: {
  monthISO: string; // YYYY-MM
  orders: PressingOrder[];
  payments: PaymentRecord[];
  expenses: ExpenseRecord[];
  settings: PressingSettings;
}): string {
  const { monthISO, orders, payments, expenses, settings } = params;
  const monthOrders = orders.filter(
    (o) => o.dropOffDate.slice(0, 7) === monthISO || o.createdAt.slice(0, 7) === monthISO
  );
  const monthPayments = payments.filter((p) => p.paidAt.slice(0, 7) === monthISO);
  const monthExpenses = expenses.filter((e) => e.date.slice(0, 7) === monthISO);

  const totalIn = monthPayments.reduce((s, p) => s + p.amountFCFA, 0);
  const totalOut = monthExpenses.reduce((s, e) => s + e.amountFCFA, 0);
  const netMonth = totalIn - totalOut;
  const billedMonth = monthOrders.reduce((s, o) => s + o.totalFCFA, 0);

  const [yNum, mNum] = monthISO.split('-').map(Number);
  const monthLabel = new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(yNum || 2026, (mNum || 1) - 1, 1));

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const marginX = 14;
  const pageWidth = 210;
  const pageHeight = 297;
  const contentW = pageWidth - marginX * 2;

  let y = drawReportHeader(
    doc,
    settings,
    'BILAN MENSUEL',
    `Période : ${monthLabel} · Édité le ${formatDateTimeFR(new Date().toISOString())}`
  );

  // KPI strip
  const boxW = (contentW - 9) / 4;
  const kpis = [
    { label: 'Chiffre facturé', val: `${formatFCFA(billedMonth)} (${monthOrders.length})`, color: [15, 23, 42] as [number, number, number] },
    { label: 'Encaissements', val: formatFCFA(totalIn), color: [4, 120, 87] as [number, number, number] },
    { label: 'Dépenses', val: formatFCFA(totalOut), color: [185, 28, 28] as [number, number, number] },
    { label: 'Résultat net', val: formatFCFA(netMonth), color: [15, 23, 42] as [number, number, number] },
  ];

  kpis.forEach((k, idx) => {
    const bx = marginX + idx * (boxW + 3);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(bx, y, boxW, 14, 1.2, 1.2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(pdfSafe(k.label), bx + 2.5, y + 4.8);
    doc.setFont('courier', 'bold');
    doc.setFontSize(8.1);
    doc.setTextColor(k.color[0], k.color[1], k.color[2]);
    doc.text(pdfSafe(k.val), bx + 2.5, y + 10.8, { maxWidth: boxW - 5 });
  });

  y += 20;

  // By Payment Channel
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Synthèse par canal de paiement', marginX, y);
  y += 2.5;

  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(148, 163, 184);
  doc.rect(marginX, y, contentW, 6.5, 'FD');
  doc.setFontSize(7.4);
  doc.text('Canal', marginX + 2.5, y + 4.4);
  doc.text('Entrées', marginX + 115, y + 4.4, { align: 'right' });
  doc.text('Sorties', marginX + 148, y + 4.4, { align: 'right' });
  doc.text('Solde net', pageWidth - marginX - 2.5, y + 4.4, { align: 'right' });
  y += 6.5;

  (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).forEach((m) => {
    const inflow = monthPayments.filter((p) => p.method === m).reduce((s, p) => s + p.amountFCFA, 0);
    const outflow = monthExpenses.filter((e) => e.method === m).reduce((s, e) => s + e.amountFCFA, 0);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.rect(marginX, y, contentW, 6, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(pdfSafe(PAYMENT_METHOD_LABELS[m]), marginX + 2.5, y + 4.1);
    doc.setFont('courier', 'normal');
    doc.setTextColor(4, 120, 87);
    doc.text(pdfSafe(formatFCFA(inflow)), marginX + 115, y + 4.1, { align: 'right' });
    doc.setTextColor(185, 28, 28);
    doc.text(pdfSafe(formatFCFA(outflow)), marginX + 148, y + 4.1, { align: 'right' });
    doc.setFont('courier', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(pdfSafe(formatFCFA(inflow - outflow)), pageWidth - marginX - 2.5, y + 4.1, {
      align: 'right',
    });
    y += 6;
  });

  y += 8;

  // Expenses by category
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Répartition des dépenses par poste', marginX, y);
  y += 2.5;

  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(148, 163, 184);
  doc.rect(marginX, y, contentW, 6.5, 'FD');
  doc.setFontSize(7.4);
  doc.text('Poste de dépense', marginX + 2.5, y + 4.4);
  doc.text('Opérations', marginX + 135, y + 4.4, { align: 'right' });
  doc.text('Montant', pageWidth - marginX - 2.5, y + 4.4, { align: 'right' });
  y += 6.5;

  EXPENSE_CATEGORIES.forEach((cat: ExpenseCategory) => {
    const catList = monthExpenses.filter((e) => e.category === cat);
    const catSum = catList.reduce((s, e) => s + e.amountFCFA, 0);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.rect(marginX, y, contentW, 6, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    doc.text(pdfSafe(cat), marginX + 2.5, y + 4.1);
    doc.setFont('courier', 'normal');
    doc.text(String(catList.length), marginX + 135, y + 4.1, { align: 'right' });
    doc.setFont('courier', 'bold');
    doc.setTextColor(185, 28, 28);
    doc.text(pdfSafe(formatFCFA(catSum)), pageWidth - marginX - 2.5, y + 4.1, {
      align: 'right',
    });
    y += 6;
  });

  y += 8;

  // Daily breakdown
  const daySet = new Set<string>([
    ...monthPayments.map((p) => p.paidAt.slice(0, 10)),
    ...monthExpenses.map((e) => e.date),
  ]);
  const sortedDays = Array.from(daySet).sort();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Récapitulatif jour par jour', marginX, y);
  y += 2.5;

  if (sortedDays.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.6);
    doc.setTextColor(100, 116, 139);
    doc.text('Aucun mouvement enregistré sur ce mois.', marginX, y + 4);
  } else {
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(148, 163, 184);
    doc.rect(marginX, y, contentW, 6.2, 'FD');
    doc.setFontSize(7.2);
    doc.setTextColor(30, 41, 59);
    doc.text('Date', marginX + 2.5, y + 4.2);
    doc.text('Recettes', marginX + 115, y + 4.2, { align: 'right' });
    doc.text('Dépenses', marginX + 148, y + 4.2, { align: 'right' });
    doc.text('Solde jour', pageWidth - marginX - 2.5, y + 4.2, { align: 'right' });
    y += 6.2;

    for (const d of sortedDays) {
      if (y > pageHeight - 16) {
        doc.addPage();
        y = 16;
      }
      const dIn = monthPayments
        .filter((p) => p.paidAt.slice(0, 10) === d)
        .reduce((s, p) => s + p.amountFCFA, 0);
      const dOut = monthExpenses
        .filter((e) => e.date === d)
        .reduce((s, e) => s + e.amountFCFA, 0);

      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(226, 232, 240);
      doc.rect(marginX, y, contentW, 5.6, 'FD');
      doc.setFont('courier', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(15, 23, 42);
      doc.text(pdfSafe(formatDateFR(d)), marginX + 2.5, y + 3.9);
      doc.setTextColor(4, 120, 87);
      doc.text(pdfSafe(formatFCFA(dIn)), marginX + 115, y + 3.9, { align: 'right' });
      doc.setTextColor(185, 28, 28);
      doc.text(pdfSafe(formatFCFA(dOut)), marginX + 148, y + 3.9, { align: 'right' });
      doc.setFont('courier', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(pdfSafe(formatFCFA(dIn - dOut)), pageWidth - marginX - 2.5, y + 3.9, {
        align: 'right',
      });
      y += 5.6;
    }
  }

  const fileName = `Bilan-Mensuel-${monthISO}.pdf`;
  doc.save(fileName);
  return fileName;
}

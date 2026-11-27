import { jsPDF } from 'jspdf';
import {
  OrderLineItem,
  PaymentRecord,
  PressingOrder,
  PressingSettings,
} from '../types/pressing';
import {
  formatDateFR,
  formatDateTimeFR,
  formatFCFA,
  formatWeightKg,
  PAYMENT_METHOD_LABELS,
  SERVICE_MODE_LABELS,
  STATUS_META,
} from './formatters';

export type ReceiptPdfFormat = 'a5' | 'thermal';

const PAYMENT_TYPE_LABELS: Record<PaymentRecord['type'], string> = {
  acompte: 'Acompte',
  solde: 'Solde',
  integral: 'Intégral',
};

/**
 * Normalize French typographic characters (such as U+202F narrow no-break space
 * emitted by Intl.NumberFormat('fr-FR')) so standard PDF fonts render cleanly.
 */
function pdfSafe(input: string | number | undefined | null): string {
  return String(input ?? '')
    .replace(/[\u202f\u00a0]/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2192/g, '->');
}

function drawBarcode(
  doc: jsPDF,
  code: string,
  centerX: number,
  topY: number,
  targetWidthMm: number,
  heightMm: number
) {
  const bars: { x: number; w: number }[] = [];
  let cursor = 2;
  bars.push({ x: cursor, w: 2 });
  cursor += 4;
  bars.push({ x: cursor, w: 1 });
  cursor += 3;

  for (let i = 0; i < code.length; i++) {
    const ch = code.charCodeAt(i);
    const pattern = [(ch % 3) + 1, ((ch >> 2) % 2) + 1, ((ch >> 4) % 3) + 1];
    for (let j = 0; j < pattern.length; j++) {
      const w = pattern[j];
      if (j % 2 === 0) {
        bars.push({ x: cursor, w });
      }
      cursor += w + 1.5;
    }
  }

  bars.push({ x: cursor, w: 1 });
  cursor += 3;
  bars.push({ x: cursor, w: 2 });
  cursor += 4;

  const scale = targetWidthMm / Math.max(1, cursor);
  const startX = centerX - targetWidthMm / 2;

  doc.setFillColor(15, 23, 42);
  for (const b of bars) {
    doc.rect(startX + b.x * scale, topY, b.w * scale, heightMm, 'F');
  }

  doc.setFont('courier', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text(pdfSafe(code), centerX, topY + heightMm + 3.2, { align: 'center' });
}

function computeOrderSummary(order: PressingOrder) {
  const articlesSubtotal = order.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPriceFCFA,
    0
  );
  const lineExpressSum = order.items.reduce(
    (sum, item) => sum + (item.isExpress ? item.expressFeeFCFA || 0 : 0),
    0
  );
  const totalPieces = order.items.reduce(
    (sum, item) => sum + (item.unit === 'kg' ? 0 : item.quantity * (item.piecesPerUnit || 1)),
    0
  );
  const totalKg = order.items.reduce(
    (sum, item) =>
      sum +
      (item.weightKg
        ? item.quantity * item.weightKg
        : item.unit === 'kg'
        ? item.quantity
        : 0),
    0
  );
  const expressLinesCount = order.items.filter((i) => i.isExpress).length;
  const remaining = Math.max(0, order.totalFCFA - order.paidFCFA);

  const volumeParts: string[] = [];
  if (totalPieces > 0) {
    volumeParts.push(`${totalPieces} ${totalPieces > 1 ? 'pièces' : 'pièce'}`);
  }
  if (totalKg > 0) {
    volumeParts.push(formatWeightKg(totalKg));
  }
  const volumeLabel = volumeParts.join(' + ') || '-';

  return {
    articlesSubtotal,
    lineExpressSum,
    totalPieces,
    totalKg,
    expressLinesCount,
    remaining,
    volumeLabel,
  };
}

function getLineWeight(item: OrderLineItem): number {
  if (item.weightKg) return item.quantity * item.weightKg;
  if (item.unit === 'kg') return item.quantity;
  return 0;
}

function formatLineQuantity(item: OrderLineItem): string {
  if (item.unit === 'kg' && item.weightKg) {
    return item.quantity > 1
      ? `${item.quantity} x ${formatWeightKg(item.weightKg)}`
      : formatWeightKg(item.weightKg);
  }
  const suffix = item.quantity > 1 && item.unit === 'lot' ? 's' : '';
  return `${item.quantity} ${item.unit}${suffix}`;
}

function generateA4ReceiptPdf(
  order: PressingOrder,
  orderPayments: PaymentRecord[],
  settings: PressingSettings
): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const marginX = 12;
  const contentWidth = pageWidth - marginX * 2; // 186mm
  const {
    articlesSubtotal,
    lineExpressSum,
    expressLinesCount,
    remaining,
    volumeLabel,
  } = computeOrderSummary(order);
  const statusInfo = STATUS_META[order.status];
  const isPaidFull = remaining === 0;
  const documentTitle = isPaidFull ? 'REÇU SOLDÉ' : 'REÇU DE DÉPÔT';

  let y = 14;

  // --- Header emblem ---
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(marginX, y, 11, 11, 2, 2, 'F');
  doc.setDrawColor(20, 184, 166);
  doc.setLineWidth(0.7);
  doc.triangle(marginX + 5.5, y + 3.2, marginX + 2.2, y + 8.3, marginX + 8.8, y + 8.3, 'S');
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.5);
  doc.line(marginX + 5.5, y + 2.0, marginX + 5.5, y + 3.2);

  // Shop Identity
  const infoX = marginX + 14;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(pdfSafe(settings.shopName), infoX, y + 4.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 118, 110);
  doc.text(pdfSafe(settings.tagline), infoX, y + 8.8);

  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(pdfSafe(`${settings.address} · ${settings.commune}`), infoX, y + 13.0);
  doc.text(
    pdfSafe(
      `Tél / WhatsApp : ${settings.phone}${settings.rccm ? ` · RCCM : ${settings.rccm}` : ''}`
    ),
    infoX,
    y + 17.0
  );

  // Right Document Badge + Barcode
  const expressSuffix =
    order.isExpress && expressLinesCount > 0 && expressLinesCount < order.items.length
      ? `EXPRESS (${expressLinesCount}/${order.items.length})`
      : 'EXPRESS';
  const badgeText = order.isExpress ? `${documentTitle}  |  ${expressSuffix}` : documentTitle;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  const badgeW = Math.max(38, doc.getTextWidth(pdfSafe(badgeText)) + 8);
  const badgeX = pageWidth - marginX - badgeW;
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.35);
  doc.roundedRect(badgeX, y, badgeW, 7, 1.2, 1.2, 'S');
  doc.setTextColor(15, 23, 42);
  doc.text(pdfSafe(badgeText), badgeX + badgeW / 2, y + 4.7, { align: 'center' });

  drawBarcode(doc, order.ticketNumber, pageWidth - marginX - 21, y + 9.2, 40, 7.5);

  y += 22;
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.55);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 4.5;

  // --- Client & Logistics Framed Summary Table ---
  const c1W = 66;
  const c2W = 72;
  const c3W = contentWidth - c1W - c2W; // 48
  const col2Start = marginX + c1W;
  const col3Start = col2Start + c2W;
  const infoHeaderH = 6.5;
  const infoBodyH = 19;

  // Header bar
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.rect(marginX, y, contentWidth, infoHeaderH, 'FD');

  // Body box
  doc.setFillColor(255, 255, 255);
  doc.rect(marginX, y + infoHeaderH, contentWidth, infoBodyH, 'FD');

  // Vertical column dividers
  doc.setDrawColor(203, 213, 225);
  doc.line(col2Start, y, col2Start, y + infoHeaderH + infoBodyH);
  doc.line(col3Start, y, col3Start, y + infoHeaderH + infoBodyH);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.setTextColor(51, 65, 85);
  doc.text('Client & Destination', marginX + 2.5, y + 4.4);
  doc.text('Calendrier & Volume', col2Start + 2.5, y + 4.4);
  doc.text('Repère Atelier & Statut', col3Start + 2.5, y + 4.4);

  const bodyY = y + infoHeaderH;
  // Col 1
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(pdfSafe(order.clientName), marginX + 2.5, bodyY + 5.2, { maxWidth: c1W - 5 });
  doc.setFont('courier', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(51, 65, 85);
  doc.text(pdfSafe(order.clientPhone), marginX + 2.5, bodyY + 10.2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.text(pdfSafe(order.commune), marginX + 2.5, bodyY + 15.0, { maxWidth: c1W - 5 });

  // Col 2
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(100, 116, 139);
  doc.text('Déposé le :', col2Start + 2.5, bodyY + 5.2);
  doc.text('Retrait standard :', col2Start + 2.5, bodyY + 10.2);
  doc.text('Volume total :', col2Start + 2.5, bodyY + 15.0);

  doc.setFont('courier', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(pdfSafe(formatDateTimeFR(order.createdAt)), col3Start - 2.5, bodyY + 5.2, {
    align: 'right',
  });
  doc.text(pdfSafe(formatDateFR(order.dueDate)), col3Start - 2.5, bodyY + 10.2, {
    align: 'right',
  });
  doc.text(pdfSafe(volumeLabel), col3Start - 2.5, bodyY + 15.0, { align: 'right' });

  // Col 3
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  doc.setTextColor(100, 116, 139);
  doc.text('Casier / Cintre', col3Start + 2.5, bodyY + 4.8);
  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(pdfSafe(order.rackSlot || 'Comptoir'), col3Start + 2.5, bodyY + 10.2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(15, 118, 110);
  doc.text(pdfSafe(`Statut : ${statusInfo.shortLabel}`), col3Start + 2.5, bodyY + 15.2);

  y += infoHeaderH + infoBodyH + 5.5;

  // --- Section Title for Items Table ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text('Détail des articles et prestations', marginX, y);
  doc.setFont('courier', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(
    pdfSafe(`${order.items.length} ${order.items.length > 1 ? 'lignes' : 'ligne'}`),
    pageWidth - marginX,
    y,
    { align: 'right' }
  );
  y += 2.2;

  // --- Itemized Table (7 bordered columns) ---
  const wNum = 9;
  const wDesc = 58;
  const wMode = 38;
  const wQty = 20;
  const wPu = 20;
  const wExp = 19;
  const wTot = contentWidth - (wNum + wDesc + wMode + wQty + wPu + wExp); // 22

  const xCol = [
    marginX,
    marginX + wNum,
    marginX + wNum + wDesc,
    marginX + wNum + wDesc + wMode,
    marginX + wNum + wDesc + wMode + wQty,
    marginX + wNum + wDesc + wMode + wQty + wPu,
    marginX + wNum + wDesc + wMode + wQty + wPu + wExp,
    pageWidth - marginX,
  ];

  const drawVerticalGrid = (topY: number, bottomY: number) => {
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.22);
    for (let i = 1; i < xCol.length - 1; i++) {
      doc.line(xCol[i], topY, xCol[i], bottomY);
    }
  };

  const drawTableHeader = (headerY: number) => {
    const h = 7.5;
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.3);
    doc.rect(marginX, headerY, contentWidth, h, 'FD');
    drawVerticalGrid(headerY, headerY + h);

    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.5);
    doc.line(marginX, headerY + h, pageWidth - marginX, headerY + h);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.4);
    doc.setTextColor(30, 41, 59);
    doc.text('N°', xCol[0] + wNum / 2, headerY + 4.9, { align: 'center' });
    doc.text('Désignation & Détails', xCol[1] + 2, headerY + 4.9);
    doc.text('Prestation & Délai', xCol[2] + 2, headerY + 4.9);
    doc.text('Qté / Vol.', xCol[4] - 2, headerY + 4.9, { align: 'right' });
    doc.text('P.U.', xCol[5] - 2, headerY + 4.9, { align: 'right' });
    doc.text('Express', xCol[6] - 2, headerY + 4.9, { align: 'right' });
    doc.text('Total ligne', xCol[7] - 2, headerY + 4.9, { align: 'right' });
    return headerY + h;
  };

  y = drawTableHeader(y);

  order.items.forEach((item, idx) => {
    const isBlanchisserie = item.activityType === 'blanchisserie';
    const lotPieces =
      item.unit !== 'kg' && item.piecesPerUnit && item.piecesPerUnit > 1
        ? item.quantity * item.piecesPerUnit
        : null;
    const lineWeight = getLineWeight(item);
    const lineBaseTotal = item.quantity * item.unitPriceFCFA;
    const lineExpressFee = item.isExpress ? item.expressFeeFCFA || 0 : 0;
    const lineTotal = lineBaseTotal + lineExpressFee;

    const titleText = pdfSafe(`${item.name}${item.isExpress ? ' [EXPRESS]' : ''}`);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const titleLines = doc.splitTextToSize(titleText, wDesc - 4) as string[];

    const detailMeta = [
      isBlanchisserie ? 'Blanchisserie' : 'Pressing',
      lotPieces ? `${lotPieces} vêtements (tous types)` : '',
      lineWeight > 0 ? `Pesée ${formatWeightKg(lineWeight)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    const subLines: { text: string; isAmber?: boolean }[] = [
      { text: pdfSafe(detailMeta) },
    ];
    if (item.note) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      const wrappedNote = doc.splitTextToSize(
        pdfSafe(`Réserve : ${item.note}`),
        wDesc - 4
      ) as string[];
      wrappedNote.forEach((ln) => subLines.push({ text: ln, isAmber: true }));
    }

    const rowHeight = Math.max(
      11,
      4.2 + titleLines.length * 3.6 + subLines.length * 3.4 + 2.2
    );

    if (y + rowHeight > pageHeight - 70) {
      doc.addPage();
      y = 14;
      y = drawTableHeader(y);
    }

    // Zebra background + outer row borders
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
    } else {
      doc.setFillColor(255, 255, 255);
    }
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.22);
    doc.rect(marginX, y, contentWidth, rowHeight, 'FD');
    drawVerticalGrid(y, y + rowHeight);

    // Col 0: N°
    doc.setFont('courier', 'normal');
    doc.setFontSize(7.6);
    doc.setTextColor(100, 116, 139);
    doc.text(String(idx + 1).padStart(2, '0'), xCol[0] + wNum / 2, y + 4.8, {
      align: 'center',
    });

    // Col 1: Désignation & Détails
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    let cy = y + 4.8;
    for (const tl of titleLines) {
      doc.text(tl, xCol[1] + 2, cy);
      cy += 3.6;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    for (const sl of subLines) {
      const slColor: [number, number, number] = sl.isAmber ? [146, 64, 14] : [100, 116, 139];
      doc.setTextColor(slColor[0], slColor[1], slColor[2]);
      doc.text(sl.text, xCol[1] + 2, cy);
      cy += 3.4;
    }

    // Col 2: Prestation & Délai
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    doc.setTextColor(30, 41, 59);
    doc.text(pdfSafe(SERVICE_MODE_LABELS[item.mode]), xCol[2] + 2, y + 4.8, {
      maxWidth: wMode - 3.5,
    });
    doc.setFont('courier', item.isExpress ? 'bold' : 'normal');
    doc.setFontSize(7);
    const delayColor: [number, number, number] = item.isExpress
      ? [146, 64, 14]
      : [100, 116, 139];
    doc.setTextColor(delayColor[0], delayColor[1], delayColor[2]);
    const delayTxt = item.isExpress
      ? `Express · ${formatDateFR(item.expressDueDate || order.dueDate)}`
      : `Standard · ${formatDateFR(order.dueDate)}`;
    doc.text(pdfSafe(delayTxt), xCol[2] + 2, y + 8.6, { maxWidth: wMode - 3.5 });

    // Col 3: Qté / Vol.
    doc.setFont('courier', 'normal');
    doc.setFontSize(7.6);
    doc.setTextColor(15, 23, 42);
    doc.text(pdfSafe(formatLineQuantity(item)), xCol[4] - 2, y + 4.8, {
      align: 'right',
    });
    if (lotPieces) {
      doc.setFontSize(6.8);
      doc.setTextColor(100, 116, 139);
      doc.text(pdfSafe(`${lotPieces} pcs`), xCol[4] - 2, y + 8.5, { align: 'right' });
    }

    // Col 4: P.U.
    doc.setFont('courier', 'normal');
    doc.setFontSize(7.6);
    doc.setTextColor(71, 85, 105);
    doc.text(pdfSafe(formatFCFA(item.unitPriceFCFA)), xCol[5] - 2, y + 4.8, {
      align: 'right',
    });

    // Col 5: Express
    if (item.isExpress) {
      doc.setFont('courier', 'bold');
      doc.setTextColor(146, 64, 14);
      doc.text(pdfSafe(`+${formatFCFA(lineExpressFee)}`), xCol[6] - 2, y + 4.8, {
        align: 'right',
      });
    } else {
      doc.setFont('courier', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text('-', xCol[6] - 2, y + 4.8, { align: 'right' });
    }

    // Col 6: Total ligne
    doc.setFont('courier', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(15, 23, 42);
    doc.text(pdfSafe(formatFCFA(lineTotal)), xCol[7] - 2, y + 4.8, { align: 'right' });

    y += rowHeight;
  });

  // Table Footer Summary Row
  const footerRowH = 7.8;
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.rect(marginX, y, contentWidth, footerRowH, 'FD');
  // Vertical lines from col 3..6
  doc.setDrawColor(203, 213, 225);
  for (let i = 3; i < xCol.length - 1; i++) {
    doc.line(xCol[i], y, xCol[i], y + footerRowH);
  }
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.45);
  doc.line(marginX, y, pageWidth - marginX, y);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.setTextColor(51, 65, 85);
  doc.text(
    pdfSafe(`Total articles & prestations (${volumeLabel})`),
    marginX + 2.5,
    y + 5.0
  );

  doc.setFont('courier', 'bold');
  doc.setFontSize(7.4);
  doc.setTextColor(51, 65, 85);
  doc.text(pdfSafe(volumeLabel), xCol[4] - 2, y + 5.0, { align: 'right' });
  doc.text(pdfSafe(formatFCFA(articlesSubtotal)), xCol[5] - 2, y + 5.0, { align: 'right' });
  const expSumColor: [number, number, number] =
    lineExpressSum > 0 ? [146, 64, 14] : [148, 163, 184];
  doc.setTextColor(expSumColor[0], expSumColor[1], expSumColor[2]);
  doc.text(
    pdfSafe(lineExpressSum > 0 ? `+${formatFCFA(lineExpressSum)}` : '-'),
    xCol[6] - 2,
    y + 5.0,
    { align: 'right' }
  );
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(8);
  doc.text(
    pdfSafe(formatFCFA(articlesSubtotal + lineExpressSum)),
    xCol[7] - 2,
    y + 5.0,
    { align: 'right' }
  );

  y += footerRowH + 6;

  // Check space for Payment Table + Financial Table + Footer + Stub
  const neededBottomH = Math.max(orderPayments.length * 5.2 + 30, 58) + 32;
  if (y + neededBottomH > pageHeight - 10) {
    doc.addPage();
    y = 15;
  }

  // --- Bottom Tables: Left = Payment History Table | Right = Financial Ledger Table ---
  const leftW = 92;
  const rightX = marginX + leftW + 6;
  const rightW = contentWidth - leftW - 6; // 88

  // Left: Payment History Table
  let leftY = y;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(51, 65, 85);
  doc.text('Historique des règlements', marginX, leftY);
  leftY += 2.2;

  if (orderPayments.length === 0) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(marginX, leftY, leftW, 9, 1.2, 1.2, 'FD');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.6);
    doc.setTextColor(100, 116, 139);
    doc.text(pdfSafe("Aucun versement enregistré pour l'instant."), marginX + 3, leftY + 5.6);
    leftY += 12;
  } else {
    const pColDate = 26;
    const pColMode = 30;
    const pColType = 14;
    const pHeaderH = 6;
    const pRowH = 5.4;

    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.25);
    doc.rect(marginX, leftY, leftW, pHeaderH, 'FD');

    const px1 = marginX + pColDate;
    const px2 = px1 + pColMode;
    const px3 = px2 + pColType;
    doc.setDrawColor(203, 213, 225);
    doc.line(px1, leftY, px1, leftY + pHeaderH);
    doc.line(px2, leftY, px2, leftY + pHeaderH);
    doc.line(px3, leftY, px3, leftY + pHeaderH);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.9);
    doc.setTextColor(51, 65, 85);
    doc.text('Date', marginX + 2, leftY + 4.1);
    doc.text('Mode', px1 + 2, leftY + 4.1);
    doc.text('Type', px2 + 1.5, leftY + 4.1);
    doc.text('Montant', marginX + leftW - 2, leftY + 4.1, { align: 'right' });
    leftY += pHeaderH;

    for (const p of orderPayments) {
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(203, 213, 225);
      doc.rect(marginX, leftY, leftW, pRowH, 'FD');
      doc.line(px1, leftY, px1, leftY + pRowH);
      doc.line(px2, leftY, px2, leftY + pRowH);
      doc.line(px3, leftY, px3, leftY + pRowH);

      doc.setFont('courier', 'normal');
      doc.setFontSize(6.6);
      doc.setTextColor(71, 85, 105);
      doc.text(pdfSafe(formatDateTimeFR(p.paidAt)), marginX + 1.8, leftY + 3.8, {
        maxWidth: pColDate - 2.5,
      });
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(pdfSafe(PAYMENT_METHOD_LABELS[p.method]), px1 + 1.8, leftY + 3.8, {
        maxWidth: pColMode - 2.5,
      });
      doc.setTextColor(71, 85, 105);
      doc.text(pdfSafe(PAYMENT_TYPE_LABELS[p.type]), px2 + 1.5, leftY + 3.8);
      doc.setFont('courier', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(pdfSafe(formatFCFA(p.amountFCFA)), marginX + leftW - 1.8, leftY + 3.8, {
        align: 'right',
      });
      leftY += pRowH;
    }

    // Payments table footer
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(148, 163, 184);
    doc.rect(marginX, leftY, leftW, pRowH + 0.6, 'FD');
    doc.line(px3, leftY, px3, leftY + pRowH + 0.6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(15, 23, 42);
    doc.text('Total encaissé', marginX + 2, leftY + 4.1);
    doc.setFont('courier', 'bold');
    doc.text(pdfSafe(formatFCFA(order.paidFCFA)), marginX + leftW - 1.8, leftY + 4.1, {
      align: 'right',
    });
    leftY += pRowH + 3.5;
  }

  if (order.notes) {
    const noteLines = doc.splitTextToSize(
      pdfSafe(`Note dépôt : ${order.notes}`),
      leftW - 5
    ) as string[];
    const noteBoxH = noteLines.length * 3.8 + 4;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(marginX, leftY, leftW, noteBoxH, 1.2, 1.2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.4);
    doc.setTextColor(51, 65, 85);
    let ny = leftY + 4;
    for (const nl of noteLines) {
      doc.text(nl, marginX + 2.5, ny);
      ny += 3.8;
    }
    leftY += noteBoxH + 3;
  }

  // Right: Financial Summary Ledger Table
  let rightY = y;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(51, 65, 85);
  doc.text('Récapitulatif financier', rightX, rightY);
  rightY += 2.2;

  const drawLedgerRow = (
    label: string,
    val: string,
    opts?: {
      fill?: [number, number, number];
      textColor?: [number, number, number];
      bold?: boolean;
      height?: number;
      size?: number;
      topThick?: boolean;
    }
  ) => {
    const h = opts?.height || 6.0;
    doc.setFillColor(...(opts?.fill || [255, 255, 255]));
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.25);
    doc.rect(rightX, rightY, rightW, h, 'FD');
    if (opts?.topThick) {
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.5);
      doc.line(rightX, rightY, rightX + rightW, rightY);
    }

    doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal');
    doc.setFontSize(opts?.size || 7.6);
    doc.setTextColor(...(opts?.textColor || [71, 85, 105]));
    doc.text(pdfSafe(label), rightX + 2.5, rightY + h / 2 + 1.1, {
      maxWidth: rightW - 32,
    });

    doc.setFont('courier', opts?.bold ? 'bold' : 'normal');
    doc.setTextColor(...(opts?.textColor || [15, 23, 42]));
    doc.text(pdfSafe(val), rightX + rightW - 2.5, rightY + h / 2 + 1.1, { align: 'right' });
    rightY += h;
  };

  drawLedgerRow('Sous-total articles', formatFCFA(articlesSubtotal));
  if (order.expressFeeFCFA > 0) {
    const expLbl =
      expressLinesCount > 0
        ? `Supplément Express (${expressLinesCount} ${expressLinesCount > 1 ? 'articles' : 'article'})`
        : 'Supplément Express';
    drawLedgerRow(expLbl, `+${formatFCFA(order.expressFeeFCFA)}`, {
      fill: [255, 251, 235],
      textColor: [146, 64, 14],
    });
  }
  if (order.deliveryFeeFCFA > 0) {
    drawLedgerRow(`Livraison (${order.commune})`, `+${formatFCFA(order.deliveryFeeFCFA)}`);
  }
  if (order.discountFCFA > 0) {
    drawLedgerRow('Remise accordée', `-${formatFCFA(order.discountFCFA)}`, {
      textColor: [4, 120, 87],
    });
  }

  drawLedgerRow('TOTAL NET À PAYER', formatFCFA(order.totalFCFA), {
    fill: [241, 245, 249],
    textColor: [15, 23, 42],
    bold: true,
    height: 7.4,
    size: 8.4,
    topThick: true,
  });
  drawLedgerRow('Total réglé', formatFCFA(order.paidFCFA), {
    textColor: [51, 65, 85],
  });
  if ((order.prepaidUsedFCFA || 0) > 0) {
    drawLedgerRow('Dont compte prépayé', formatFCFA(order.prepaidUsedFCFA || 0), {
      textColor: [15, 118, 110],
    });
  }
  if ((order.loyaltyPointsEarned || 0) > 0) {
    drawLedgerRow('Points fidélité gagnés', `+${order.loyaltyPointsEarned} pts`, {
      textColor: [4, 120, 87],
    });
  }
  drawLedgerRow(
    remaining > 0 ? 'RESTE À RÉGLER AU RETRAIT' : 'STATUT RÈGLEMENT',
    remaining > 0 ? formatFCFA(remaining) : 'SOLDÉ · 0 FCFA',
    {
      fill: remaining > 0 ? [255, 251, 235] : [236, 253, 245],
      textColor: remaining > 0 ? [120, 53, 15] : [6, 78, 59],
      bold: true,
      height: 7.6,
      size: 8.2,
    }
  );

  y = Math.max(leftY, rightY) + 5;

  if (order.claimPhotos && order.claimPhotos.length > 0) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(marginX, y, contentWidth, 7.2, 1, 1, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(51, 65, 85);
    doc.text(
      pdfSafe(
        `Réserves à la réception : ${order.claimPhotos.length} photo(s) archivée(s) (${order.claimPhotos
          .map((p) => p.caption)
          .join(', ')})`
      ),
      marginX + 2.5,
      y + 4.8,
      { maxWidth: contentWidth - 5 }
    );
    y += 10;
  } else {
    y += 1;
  }

  // --- Legal Notice & Signatures ---
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 4.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(100, 116, 139);
  const footerLines = doc.splitTextToSize(pdfSafe(settings.ticketFooterNote), 118) as string[];
  let fy = y;
  for (const fl of footerLines) {
    doc.text(fl, marginX, fy);
    fy += 3.4;
  }

  const sig1X = pageWidth - marginX - 58;
  const sig2X = pageWidth - marginX - 27;
  doc.setDrawColor(148, 163, 184);
  doc.line(sig1X, y + 7.5, sig1X + 24, y + 7.5);
  doc.line(sig2X, y + 7.5, sig2X + 27, y + 7.5);
  doc.setFontSize(6.9);
  doc.setTextColor(71, 85, 105);
  doc.text('Visa Comptoir', sig1X + 12, y + 11, { align: 'center' });
  doc.text('Signature Client', sig2X + 13.5, y + 11, { align: 'center' });

  y = Math.max(fy, y + 13.5) + 4.5;

  // --- Detachable Workshop Stub Table ---
  doc.setDrawColor(148, 163, 184);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(marginX, y, pageWidth - marginX, y);
  doc.setLineDashPattern([], 0);

  doc.setFillColor(255, 255, 255);
  doc.rect(pageWidth / 2 - 24, y - 2.2, 48, 4.4, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(148, 163, 184);
  doc.text('SOUCHE ATELIER / CINTRE', pageWidth / 2, y + 0.8, { align: 'center' });

  y += 4.5;
  const stubH = 10;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.28);
  doc.rect(marginX, y, contentWidth, stubH, 'FD');

  const sx1 = marginX + 28;
  const sx2 = sx1 + 60;
  const sx3 = sx2 + 30;
  const sx4 = sx3 + 28;
  const sx5 = sx4 + 22;
  doc.setDrawColor(203, 213, 225);
  [sx1, sx2, sx3, sx4, sx5].forEach((sx) => doc.line(sx, y, sx, y + stubH));

  doc.setFont('courier', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(15, 23, 42);
  doc.text(pdfSafe(order.ticketNumber), marginX + 2, y + 6.2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text(pdfSafe(`${order.clientName} · ${order.clientPhone}`), sx1 + 2, y + 6.2, {
    maxWidth: 56,
  });

  doc.setFont('courier', 'normal');
  doc.setFontSize(7.3);
  doc.setTextColor(51, 65, 85);
  doc.text(pdfSafe(`Casier: ${order.rackSlot || '-'}`), sx2 + 2, y + 6.2);
  doc.text(pdfSafe(volumeLabel), sx3 + 2, y + 6.2);
  doc.text(pdfSafe(formatDateFR(order.dueDate)), sx4 + 2, y + 6.2);

  doc.setFont('courier', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(
    pdfSafe(remaining > 0 ? `Dû: ${formatFCFA(remaining)}` : 'SOLDÉ'),
    pageWidth - marginX - 2,
    y + 6.2,
    { align: 'right' }
  );

  return doc;
}

function generateThermalReceiptPdf(
  order: PressingOrder,
  orderPayments: PaymentRecord[],
  settings: PressingSettings
): jsPDF {
  const widthMm = 80;
  const marginX = 4.5;
  const contentWidth = widthMm - marginX * 2;
  const { articlesSubtotal, remaining } = computeOrderSummary(order);
  const isPaidFull = remaining === 0;
  const documentTitle = isPaidFull ? 'REÇU SOLDÉ' : 'REÇU DE DÉPÔT';

  const measureDoc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [widthMm, 297] });

  const footerLines = measureDoc.splitTextToSize(
    pdfSafe(settings.ticketFooterNote),
    contentWidth
  ) as string[];

  const colArtW = 39;
  let estimatedHeight = 86;
  for (const item of order.items) {
    measureDoc.setFont('courier', 'bold');
    measureDoc.setFontSize(7.2);
    const titleLines = measureDoc.splitTextToSize(
      pdfSafe(`${item.name}${item.isExpress ? ' [EXPRESS]' : ''}`),
      colArtW
    ) as string[];
    const lotPieces =
      item.unit !== 'kg' && item.piecesPerUnit && item.piecesPerUnit > 1
        ? item.quantity * item.piecesPerUnit
        : null;
    const extraCount =
      1 + (lotPieces ? 1 : 0) + (item.isExpress ? 1 : 0) + (item.note ? 1 : 0);
    estimatedHeight += titleLines.length * 3.3 + extraCount * 3.0 + 2.4;
  }
  estimatedHeight += orderPayments.length * 3.5 + footerLines.length * 3.2 + 24;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [widthMm, Math.max(140, Math.ceil(estimatedHeight))],
  });

  const centerX = widthMm / 2;
  let y = 7;

  const drawDashedSep = () => {
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.25);
    doc.setLineDashPattern([1.2, 1.2], 0);
    doc.line(marginX, y, widthMm - marginX, y);
    doc.setLineDashPattern([], 0);
    y += 3.5;
  };

  // Shop header
  doc.setFont('courier', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(pdfSafe(settings.shopName.toUpperCase()), centerX, y, { align: 'center' });
  y += 3.8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(71, 85, 105);
  doc.text(pdfSafe(settings.tagline), centerX, y, { align: 'center' });
  y += 3.2;

  doc.setFont('courier', 'normal');
  doc.text(pdfSafe(settings.address), centerX, y, { align: 'center', maxWidth: contentWidth });
  y += 3.2;
  doc.text(pdfSafe(settings.commune), centerX, y, { align: 'center' });
  y += 3.2;
  doc.text(pdfSafe(`Tél : ${settings.phone}`), centerX, y, { align: 'center' });
  y += 3.0;
  if (settings.rccm) {
    doc.setFontSize(6.2);
    doc.text(pdfSafe(`RCCM : ${settings.rccm}`), centerX, y, { align: 'center' });
    y += 3.0;
  }
  y += 1;
  drawDashedSep();

  // Document title + barcode
  doc.setFont('courier', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    pdfSafe(`${documentTitle}${order.isExpress ? ' · EXPRESS' : ''}`),
    centerX,
    y,
    { align: 'center' }
  );
  y += 2.5;

  drawBarcode(doc, order.ticketNumber, centerX, y, 36, 7);
  y += 13;

  doc.setFont('courier', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(51, 65, 85);
  doc.text(pdfSafe(`Dépôt : ${formatDateTimeFR(order.createdAt)}`), marginX, y);
  doc.setFont('courier', 'bold');
  doc.text(pdfSafe(`Casier: ${order.rackSlot || '-'}`), widthMm - marginX, y, {
    align: 'right',
  });
  y += 3.8;

  doc.setFontSize(7.8);
  doc.setTextColor(15, 23, 42);
  doc.text(pdfSafe(`Retrait prévu : ${formatDateFR(order.dueDate)}`), centerX, y, {
    align: 'center',
  });
  y += 3.2;
  drawDashedSep();

  // Client
  doc.setFontSize(7);
  doc.setFont('courier', 'normal');
  doc.text(pdfSafe(`Client : ${order.clientName}`), marginX, y);
  y += 3.3;
  doc.text(pdfSafe(`Tél : ${order.clientPhone}`), marginX, y);
  y += 3.3;
  doc.text(pdfSafe(`Zone : ${order.commune}`), marginX, y);
  y += 3.0;
  drawDashedSep();

  // 3-Column Thermal Table Header: ARTICLE | QTÉ | MONTANT
  const txQtyRight = marginX + 51;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(148, 163, 184);
  doc.rect(marginX, y - 0.5, contentWidth, 4.8, 'FD');
  doc.setFont('courier', 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(15, 23, 42);
  doc.text('ARTICLE', marginX + 1, y + 2.8);
  doc.text('QTÉ', txQtyRight, y + 2.8, { align: 'right' });
  doc.text('MONTANT', widthMm - marginX - 1, y + 2.8, { align: 'right' });
  y += 6.2;

  for (const item of order.items) {
    const lineWeight = getLineWeight(item);
    const qtyText =
      item.unit === 'kg'
        ? formatWeightKg(lineWeight)
        : `${item.quantity}${item.unit === 'lot' ? ' lot' : ''}`;
    const lineTotal =
      item.quantity * item.unitPriceFCFA + (item.isExpress ? item.expressFeeFCFA || 0 : 0);

    doc.setFont('courier', 'bold');
    doc.setFontSize(7.1);
    doc.setTextColor(15, 23, 42);
    const titleLines = doc.splitTextToSize(
      pdfSafe(`${item.name}${item.isExpress ? ' [EXPRESS]' : ''}`),
      colArtW
    ) as string[];

    doc.text(pdfSafe(qtyText), txQtyRight, y, { align: 'right' });
    doc.text(pdfSafe(formatFCFA(lineTotal)), widthMm - marginX - 0.5, y, { align: 'right' });

    for (const tl of titleLines) {
      doc.text(tl, marginX, y);
      y += 3.2;
    }

    doc.setFont('courier', 'normal');
    doc.setFontSize(6.3);
    doc.setTextColor(71, 85, 105);
    doc.text(
      pdfSafe(`${SERVICE_MODE_LABELS[item.mode]} · ${formatFCFA(item.unitPriceFCFA)}/${item.unit}`),
      marginX + 1,
      y
    );
    y += 2.9;

    const lotPieces =
      item.unit !== 'kg' && item.piecesPerUnit && item.piecesPerUnit > 1
        ? item.quantity * item.piecesPerUnit
        : null;
    if (lotPieces) {
      doc.text(pdfSafe(`Lot : ${lotPieces} pcs`), marginX + 1, y);
      y += 2.9;
    }
    if (item.isExpress) {
      doc.setFont('courier', 'bold');
      doc.setTextColor(146, 64, 14);
      doc.text(
        pdfSafe(
          `Express : +${formatFCFA(item.expressFeeFCFA || 0)}${
            item.expressDueDate ? ` (${formatDateFR(item.expressDueDate)})` : ''
          }`
        ),
        marginX + 1,
        y
      );
      y += 2.9;
    }
    if (item.note) {
      doc.setFont('courier', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(pdfSafe(`Note : ${item.note}`), marginX + 1, y, {
        maxWidth: contentWidth - 2,
      });
      y += 2.9;
    }

    doc.setDrawColor(203, 213, 225);
    doc.setLineDashPattern([0.8, 0.8], 0);
    doc.line(marginX, y + 0.3, widthMm - marginX, y + 0.3);
    doc.setLineDashPattern([], 0);
    y += 2.2;
  }

  drawDashedSep();

  // Totals
  const drawThermalRow = (label: string, val: string, bold = false, size = 7.2) => {
    doc.setFont('courier', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(15, 23, 42);
    doc.text(pdfSafe(label), marginX, y);
    doc.text(pdfSafe(val), widthMm - marginX, y, { align: 'right' });
    y += 3.6;
  };

  drawThermalRow('Sous-total articles', formatFCFA(articlesSubtotal));
  if (order.expressFeeFCFA > 0) {
    drawThermalRow('Supplément Express', `+${formatFCFA(order.expressFeeFCFA)}`);
  }
  if (order.deliveryFeeFCFA > 0) {
    drawThermalRow('Livraison', `+${formatFCFA(order.deliveryFeeFCFA)}`);
  }
  if (order.discountFCFA > 0) {
    drawThermalRow('Remise', `-${formatFCFA(order.discountFCFA)}`);
  }

  doc.setDrawColor(148, 163, 184);
  doc.line(marginX, y - 1.2, widthMm - marginX, y - 1.2);
  y += 1.8;

  drawThermalRow('TOTAL NET', formatFCFA(order.totalFCFA), true, 8.2);
  drawThermalRow('Réglé', formatFCFA(order.paidFCFA));
  if ((order.prepaidUsedFCFA || 0) > 0) {
    drawThermalRow('Dont prépayé', formatFCFA(order.prepaidUsedFCFA || 0));
  }
  if ((order.loyaltyPointsEarned || 0) > 0) {
    drawThermalRow('Fidélité gagnée', `+${order.loyaltyPointsEarned} pts`);
  }
  if (order.claimPhotos && order.claimPhotos.length > 0) {
    drawThermalRow('Photos réserves', `${order.claimPhotos.length} archivée(s)`);
  }
  drawThermalRow(
    remaining > 0 ? 'RESTE À PAYER' : 'STATUT',
    remaining > 0 ? formatFCFA(remaining) : 'SOLDÉ',
    true,
    8.2
  );

  y += 1;
  drawDashedSep();

  if (orderPayments.length > 0) {
    doc.setFont('courier', 'bold');
    doc.setFontSize(6.6);
    doc.text('RÈGLEMENTS :', marginX, y);
    y += 3.2;
    doc.setFont('courier', 'normal');
    for (const p of orderPayments) {
      doc.text(
        pdfSafe(`${PAYMENT_METHOD_LABELS[p.method]} (${PAYMENT_TYPE_LABELS[p.type]})`),
        marginX,
        y
      );
      doc.text(pdfSafe(formatFCFA(p.amountFCFA)), widthMm - marginX, y, { align: 'right' });
      y += 3.2;
    }
    y += 1;
    drawDashedSep();
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(71, 85, 105);
  for (const fl of footerLines) {
    doc.text(fl, centerX, y, { align: 'center' });
    y += 3.0;
  }
  y += 2;

  drawDashedSep();
  doc.setFont('courier', 'normal');
  doc.setFontSize(6.4);
  doc.setTextColor(100, 116, 139);
  doc.text('--- SOUCHE ATELIER ---', centerX, y, { align: 'center' });
  y += 3.5;

  doc.setFont('courier', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(15, 23, 42);
  doc.text(pdfSafe(order.ticketNumber), marginX, y);
  doc.text(pdfSafe(`Casier ${order.rackSlot || '-'}`), widthMm - marginX, y, { align: 'right' });
  y += 3.4;

  doc.setFont('courier', 'normal');
  doc.text(pdfSafe(order.clientName), marginX, y, { maxWidth: 42 });
  doc.text(pdfSafe(remaining > 0 ? formatFCFA(remaining) : 'SOLDÉ'), widthMm - marginX, y, {
    align: 'right',
  });

  return doc;
}

export function exportReceiptPdf(
  order: PressingOrder,
  orderPayments: PaymentRecord[],
  settings: PressingSettings,
  format: ReceiptPdfFormat = 'a5'
): string {
  const doc =
    format === 'thermal'
      ? generateThermalReceiptPdf(order, orderPayments, settings)
      : generateA4ReceiptPdf(order, orderPayments, settings);

  const fileName = `Recu-${order.ticketNumber}-${format === 'thermal' ? '80mm' : 'A4'}.pdf`;
  doc.save(fileName);
  return fileName;
}

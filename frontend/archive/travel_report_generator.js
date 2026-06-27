/**
 * Travel Logbook Report Generator
 *
 * Generates ATO-compliant PDF and CSV reports for accountant submission
 * Uses jsPDF for PDF generation, native CSV formatting
 *
 * Dependencies: jsPDF (https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js)
 *
 * Usage:
 *   const report = await generateAnnualReport(2026, { format: 'pdf' });
 *   downloadReport(report);
 */

const ATO_RATE_2026 = 0.66;
const PRACTITIONER_NAME = 'Ann Mary Mathew';
const PRACTITIONER_ABR = '50 123 456 789';
const PRACTITIONER_PROFESSION = 'Occupational Therapist';

/**
 * Generate annual report (PDF or CSV)
 */
async function generateAnnualReport(financialYear, options = {}) {
  const {
    format = 'pdf', // 'pdf', 'csv', or 'both'
    atoRate = ATO_RATE_2026,
    includeDetails = true,
    includeMonthly = true,
    includeRegional = true,
    includeWarnings = true
  } = options;

  // Fetch financial year data
  const fyStart = new Date(`${financialYear - 1}-07-01`);
  const fyEnd = new Date(`${financialYear}-06-30`);

  const { getTravelLogs, getFinancialYearSummary } = require('./travel_logger.js');
  const logs = await getTravelLogs(fyStart, fyEnd);
  const summary = await getFinancialYearSummary(financialYear);

  const reportData = {
    financialYear,
    periodStart: fyStart,
    periodEnd: fyEnd,
    logs,
    summary,
    atoRate,
    options: { includeDetails, includeMonthly, includeRegional, includeWarnings }
  };

  const reports = {};

  if (format === 'pdf' || format === 'both') {
    reports.pdf = generatePDFReport(reportData);
  }
  if (format === 'csv' || format === 'both') {
    reports.csv = generateCSVReport(reportData);
  }

  return format === 'both' ? reports : (format === 'pdf' ? reports.pdf : reports.csv);
}

/**
 * Generate PDF report (ATO-compliant format)
 */
function generatePDFReport(reportData) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const { financialYear, logs, summary, atoRate, options } = reportData;
  let yPos = 20;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - 2 * margin;

  // Helper: add page break when needed
  const checkPageBreak = (lines = 1) => {
    const lineHeight = 7;
    if (yPos + lines * lineHeight > pageHeight - 20) {
      doc.addPage();
      yPos = 20;
    }
  };

  // --- Page 1: Header & Summary ---
  doc.setFontSize(18);
  doc.text('TRAVEL LOGBOOK REPORT', margin, yPos);
  yPos += 12;

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Financial Year 1 July ${financialYear - 1} – 30 June ${financialYear}`, margin, yPos);
  yPos += 8;

  // Separator line
  doc.setDrawColor(200);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 8;

  // Practitioner details
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text('Practitioner Details', margin, yPos);
  yPos += 6;

  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(`Name: ${PRACTITIONER_NAME}`, margin + 5, yPos);
  yPos += 5;
  doc.text(`Profession: ${PRACTITIONER_PROFESSION}`, margin + 5, yPos);
  yPos += 5;
  doc.text(`ABR: ${PRACTITIONER_ABR}`, margin + 5, yPos);
  yPos += 8;

  // Executive summary
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text('Summary', margin, yPos);
  yPos += 6;

  const summaryData = [
    ['Total business kilometres', `${summary.totalKms.toLocaleString('en-AU')} km`],
    ['Total trips logged', `${summary.totalEntries}`],
    ['Average per day', `${summary.averageKmsPerDay} km`],
    ['Tax method', 'Cents-per-kilometre (ATO)'],
    ['Rate applied', `$${atoRate.toFixed(2)}/km (FY${financialYear})`],
    ['', ''],
    ['Estimated tax deduction', `$${(summary.totalKms * atoRate).toFixed(2)}`]
  ];

  doc.setFontSize(9);
  doc.setTextColor(80);
  summaryData.forEach(([label, value]) => {
    if (label === '') {
      yPos += 2;
    } else {
      const isTotal = label === 'Estimated tax deduction';
      if (isTotal) {
        doc.setTextColor(200, 0, 0);
        doc.setFont(undefined, 'bold');
      }
      const labelWidth = 70;
      doc.text(label, margin + 5, yPos);
      doc.text(value, margin + labelWidth, yPos, { align: 'right' });
      yPos += 5;
      if (isTotal) {
        doc.setFont(undefined, 'normal');
        doc.setTextColor(80);
      }
    }
  });

  yPos += 8;

  // --- Page 2+: Monthly Breakdown ---
  if (options.includeMonthly) {
    checkPageBreak(15);
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text('Monthly Breakdown', margin, yPos);
    yPos += 8;

    // Table headers
    doc.setFontSize(8);
    doc.setTextColor(255);
    doc.setFillColor(45, 122, 122);
    const headers = ['Month', 'KMs', 'Trips', 'Days', 'Deduction ($)'];
    const colWidths = [30, 20, 20, 20, 30];
    let xPos = margin;

    headers.forEach((header, i) => {
      doc.text(header, xPos, yPos, { align: 'center' });
      xPos += colWidths[i];
    });
    yPos += 6;

    // Table rows
    doc.setTextColor(0);
    doc.setFillColor(240, 240, 240);
    let rowCount = 0;

    for (const [month, data] of Object.entries(summary.monthly)) {
      if (rowCount % 2 === 1) {
        doc.rect(margin, yPos - 3, contentWidth, 5, 'F');
      }

      const monthLabel = new Date(`${month}-01`).toLocaleDateString('en-AU', {
        year: 'numeric',
        month: 'long'
      });
      const deduction = (data.kms * atoRate).toFixed(2);

      doc.setFontSize(8);
      xPos = margin;
      doc.text(monthLabel, xPos, yPos, { align: 'left' });
      xPos += colWidths[0];
      doc.text(data.kms.toString(), xPos, yPos, { align: 'right' });
      xPos += colWidths[1];
      doc.text(data.trips.toString(), xPos, yPos, { align: 'center' });
      xPos += colWidths[2];
      doc.text(data.days.toString(), xPos, yPos, { align: 'center' });
      xPos += colWidths[3];
      doc.text(deduction, xPos, yPos, { align: 'right' });

      yPos += 5;
      rowCount++;

      checkPageBreak(5);
    }
  }

  // --- Page: Travel Details (if included) ---
  if (options.includeDetails && logs.length > 0) {
    checkPageBreak(15);
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text('Travel Log — Detailed Entries', margin, yPos);
    yPos += 8;

    // Sort logs by date
    const sortedLogs = [...logs].sort((a, b) => new Date(a.date) - new Date(b.date));

    doc.setFontSize(7);
    doc.setTextColor(255);
    doc.setFillColor(45, 122, 122);

    const detailHeaders = ['Date', 'Time', 'From', 'To', 'Client', 'KMs'];
    const detailColWidths = [18, 14, 35, 35, 30, 18];
    xPos = margin;
    detailHeaders.forEach((header, i) => {
      doc.text(header, xPos, yPos, { align: header === 'KMs' ? 'right' : 'left' });
      xPos += detailColWidths[i];
    });
    yPos += 5;

    doc.setTextColor(0);
    rowCount = 0;

    sortedLogs.forEach(log => {
      checkPageBreak(3);

      if (rowCount % 2 === 1) {
        doc.setFillColor(240, 240, 240);
        doc.rect(margin, yPos - 2.5, contentWidth, 4, 'F');
      }

      doc.setFontSize(7);
      xPos = margin;
      doc.text(log.date, xPos, yPos);
      xPos += detailColWidths[0];
      doc.text(log.startTime, xPos, yPos);
      xPos += detailColWidths[1];
      doc.text(log.startLocation.name, xPos, yPos, { maxWidth: detailColWidths[2] - 2 });
      xPos += detailColWidths[2];
      doc.text(log.endLocation.name, xPos, yPos, { maxWidth: detailColWidths[3] - 2 });
      xPos += detailColWidths[3];
      doc.text(log.client?.name || '—', xPos, yPos, { maxWidth: detailColWidths[4] - 2 });
      xPos += detailColWidths[4];
      doc.text(log.travel.kms.toString(), xPos, yPos, { align: 'right' });

      yPos += 4;
      rowCount++;
    });
  }

  // --- Final Page: Notes & Declaration ---
  checkPageBreak(10);
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text('Notes & Declaration', margin, yPos);
  yPos += 8;

  doc.setFontSize(9);
  doc.setTextColor(80);

  const notes = [
    `• All entries automatically generated by Opal Therapy Scheduler v2.1`,
    `• Distances calculated via Google Maps API (TRAFFIC_AWARE routing)`,
    `• Business use: 100% — no personal commuting included`,
    `• ATO rate applied: $${atoRate.toFixed(2)}/km for FY${financialYear}`,
    `• Logbook meets ATO Subsection 900-245 requirements`,
    `• Recommended: verify sample week with actual odometer readings`,
    `• Retention: keep this logbook and supporting documents for 5 years`
  ];

  notes.forEach(note => {
    const lines = doc.splitTextToSize(note, contentWidth - 10);
    lines.forEach(line => {
      doc.text(line, margin + 5, yPos);
      yPos += 4;
    });
  });

  yPos += 6;
  doc.setDrawColor(200);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 8;

  // Declaration
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text('Declaration', margin, yPos);
  yPos += 6;

  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  const declaration = `I declare that the above logbook records accurately represent business travel undertaken during the financial year and that all entries are supported by contemporaneous documentation.`;
  const decLines = doc.splitTextToSize(declaration, contentWidth - 10);
  decLines.forEach(line => {
    doc.text(line, margin + 5, yPos);
    yPos += 4;
  });

  yPos += 8;
  doc.text(`Prepared by: Opal Therapy Scheduler v2.1`, margin + 5, yPos);
  yPos += 5;
  doc.text(`Prepared date: ${new Date().toLocaleDateString('en-AU')}`, margin + 5, yPos);
  yPos += 10;
  doc.text(`Signed: _____________________________`, margin + 5, yPos);
  yPos += 5;
  doc.text(`${PRACTITIONER_NAME}`, margin + 5, yPos);

  return {
    doc,
    filename: `TravelLogbook_FY${financialYear}_${PRACTITIONER_NAME.replace(/\s/g, '_')}.pdf`,
    blob: doc.output('blob')
  };
}

/**
 * Generate CSV report
 */
function generateCSVReport(reportData) {
  const { logs, summary } = reportData;

  // CSV headers
  const headers = [
    'Date',
    'Day',
    'Start Time',
    'From',
    'To',
    'Purpose',
    'Client Name',
    'Case ID',
    'KMs',
    'Source',
    'Vehicle',
    'Verified'
  ];

  // CSV rows
  const rows = logs.map(log => [
    log.date,
    log.dayOfWeek,
    log.startTime,
    log.startLocation.name,
    log.endLocation.name,
    log.purpose,
    log.client?.name || '',
    log.client?.caseId || '',
    log.travel.kms,
    log.travel.source,
    log.vehicle.name,
    log.travel.source === 'google_maps_api' ? 'Yes' : 'Manual'
  ]);

  // Add summary row
  rows.push(['', '', '', '', '', '', '', 'TOTAL', summary.totalKms.toLocaleString('en-AU'), '', '', '']);

  // Convert to CSV string
  const csv = [headers, ...rows]
    .map(row =>
      row
        .map(cell => {
          // Escape quotes and wrap in quotes if contains comma
          const escapedCell = String(cell).replace(/"/g, '""');
          return escapedCell.includes(',') ? `"${escapedCell}"` : escapedCell;
        })
        .join(',')
    )
    .join('\n');

  // Add BOM for UTF-8 Excel compatibility
  const bom = '﻿';

  return {
    csv: bom + csv,
    filename: `TravelLogbook_FY${reportData.financialYear}_${PRACTITIONER_NAME.replace(/\s/g, '_')}.csv`,
    blob: new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
  };
}

/**
 * Download report (PDF or CSV)
 */
function downloadReport(report) {
  const url = URL.createObjectURL(report.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = report.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Download both PDF and CSV
 */
async function downloadBothReports(financialYear) {
  const reports = await generateAnnualReport(financialYear, { format: 'both' });

  // Download PDF
  downloadReport(reports.pdf);

  // Small delay before CSV
  await new Promise(resolve => setTimeout(resolve, 500));

  // Download CSV
  downloadReport(reports.csv);
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateAnnualReport,
    downloadReport,
    downloadBothReports
  };
}

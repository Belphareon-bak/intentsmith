export const INVOICE_TOTAL_RESULT = 'project-a-invoice-total';

export function calculateInvoiceTotal(lines) {
  return lines.reduce((total, line) => total + line.quantity * line.unitPrice, 0);
}

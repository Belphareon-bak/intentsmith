import {
  canonicalizeSignedAuthorityValue,
  validateSignedAuthorityReceiptShape,
} from '../../contracts/authority/signed-authority-receipt-v1.js';

export function signedAuthorityReceiptShapeValid(raw) {
  if (typeof raw !== 'string') return 0;
  try {
    const receipt = JSON.parse(raw);
    const shape = validateSignedAuthorityReceiptShape(receipt);
    return shape.valid && `${canonicalizeSignedAuthorityValue(receipt)}\n` === raw ? 1 : 0;
  } catch {
    return 0;
  }
}

export function registerSignedAuthorityStorageFunctions(database) {
  if (!database || typeof database.function !== 'function') {
    throw new TypeError('signed-authority-storage:database-required');
  }
  database.function('signed_authority_receipt_shape_valid_v1', {
    deterministic: true,
  }, signedAuthorityReceiptShapeValid);
}

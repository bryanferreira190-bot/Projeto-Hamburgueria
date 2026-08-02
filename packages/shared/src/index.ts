/**
 * @adventure/shared
 *
 * Fonte unica de verdade do dominio. A API e os frontends importam daqui —
 * uma regra de negocio existe em um lugar so.
 */

export * from './money.js';

export * from './domain/enums.js';
export * from './domain/order-status.js';

export * from './schemas/common.js';
export * from './schemas/customer.js';
export * from './schemas/order.js';

import { z, type ZodString, type ZodTypeAny } from 'zod';

// Shared helpers used across business services for validating inbound payloads

type MaybeDatetime = ZodString & {
  datetime?: () => ZodTypeAny;
};

const isoDatetime = () => {
  const base = z.string() as MaybeDatetime;
  if (typeof base.datetime === 'function') {
    return base.datetime();
  }
  return base.refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Invalid datetime string',
  });
};

export const Id = z.number().int().positive();

const numericString = z
  .string()
  .trim()
  .regex(/^(?:0*[1-9]\d*)$/, { message: 'Must be a numeric string' });

const NumericIdLike = z.union([Id, numericString]);

const nonNegativeNumberLike = z
  .union([z.number(), z.string()])
  .refine((value) => {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) && numeric >= 0;
  }, { message: 'Must be a non-negative number' });

const dateLike = z.union([isoDatetime(), z.date()]);

const limitedNote = z.string().max(2000);

export const QuoteCreateArgs = z
  .object({
    customer_id: NumericIdLike.optional(),
    customerId: NumericIdLike.optional(),
    quote_date: dateLike.optional(),
    valid_until: dateLike.optional(),
    product_name: z.string().min(1),
    product_description: z.string().optional(),
    estimated_cost: nonNegativeNumberLike,
    status: z.string().optional(),
    terms: z.string().optional(),
    customer_po_number: z.string().optional(),
    vin_number: z.string().optional(),
    vehicle_make: z.string().optional(),
    vehicle_model: z.string().optional(),
    notes: limitedNote.optional(),
  })
  .passthrough();

export const QuoteUpdateArgs = z
  .object({
    customer_id: NumericIdLike.optional(),
    customerId: NumericIdLike.optional(),
    quote_date: dateLike.optional(),
    valid_until: dateLike.optional(),
    product_name: z.string().optional(),
    product_description: z.string().optional(),
    estimated_cost: nonNegativeNumberLike.optional(),
    status: z.string().optional(),
    terms: z.string().optional(),
    customer_po_number: z.string().optional(),
    vin_number: z.string().optional(),
    vehicle_make: z.string().optional(),
    vehicle_model: z.string().optional(),
    source_quote_number: z.string().optional(),
    notes: limitedNote.optional(),
  })
  .passthrough();

export const QuoteCloseArgs = z
  .object({
    quote_id: Id,
    status: z.enum(['Closed', 'Won', 'Lost']).optional(),
  })
  .strict();

export const SalesOrderPatch = z
  .object({
    header: z
      .object({
        customer_id: NumericIdLike.optional(),
        sales_date: dateLike.optional(),
        product_name: z.string().optional(),
        product_description: z.string().optional(),
        terms: z.string().optional(),
        subtotal: nonNegativeNumberLike.optional(),
        total_gst_amount: nonNegativeNumberLike.optional(),
        total_amount: nonNegativeNumberLike.optional(),
        status: z.string().optional(),
        estimated_cost: nonNegativeNumberLike.optional(),
        sequence_number: nonNegativeNumberLike.optional(),
        customer_po_number: z.string().optional(),
        vin_number: z.string().optional(),
        vehicle_make: z.string().optional(),
        vehicle_model: z.string().optional(),
        invoice_status: z.union([z.string(), z.boolean(), z.number()]).optional(),
        invoice_required: z.union([z.string(), z.boolean(), z.number()]).optional(),
        quote_id: NumericIdLike.optional(),
        source_quote_number: z.string().optional(),
      })
      .passthrough()
      .optional(),
    lineItems: z
      .array(
        z
          .object({
            line_item_id: NumericIdLike.optional(),
            part_id: NumericIdLike.optional(),
            part_number: z.string().min(1),
            part_description: z.string().optional(),
            quantity: nonNegativeNumberLike.optional(),
            quantity_sold: nonNegativeNumberLike.optional(),
            unit: z.string().optional(),
            unit_price: nonNegativeNumberLike.optional(),
            line_amount: nonNegativeNumberLike.optional(),
          })
          .passthrough()
      )
      .optional(),
    partsToOrder: z
      .array(
        z
          .object({
            part_number: z.string().min(1),
            part_description: z.string().optional(),
            quantity_needed: nonNegativeNumberLike.optional(),
            unit: z.string().optional(),
            unit_price: nonNegativeNumberLike.optional(),
            line_amount: nonNegativeNumberLike.optional(),
          })
          .passthrough()
      )
      .optional(),
    notes: limitedNote.optional(),
  })
  .passthrough();

export const PurchaseOrderPatch = z
  .object({
    header: z
      .object({
        vendor_id: NumericIdLike.optional(),
        purchase_date: dateLike.optional(),
        subtotal: nonNegativeNumberLike.optional(),
        total_gst_amount: nonNegativeNumberLike.optional(),
        total_amount: nonNegativeNumberLike.optional(),
        status: z.string().optional(),
        sequence_number: nonNegativeNumberLike.optional(),
        pickup_notes: z.string().optional(),
        pickup_time: dateLike.optional(),
        pickup_location: z.string().optional(),
        pickup_contact_person: z.string().optional(),
        pickup_phone: z.string().optional(),
        pickup_instructions: z.string().optional(),
      })
      .passthrough()
      .optional(),
    lineItems: z
      .array(
        z
          .object({
            part_number: z.string().min(1),
            part_description: z.string().optional(),
            quantity: nonNegativeNumberLike.optional(),
            unit_cost: nonNegativeNumberLike.optional(),
            line_amount: nonNegativeNumberLike.optional(),
            unit: z.string().optional(),
            part_id: NumericIdLike.optional(),
          })
          .passthrough()
      )
      .optional(),
    notes: limitedNote.optional(),
  })
  .passthrough();

export const TaskUpdateArgs = z
  .object({
    id: z.union([Id, numericString]).optional(),
    taskId: z.union([Id, numericString]).optional(),
    status: z.string().optional(),
    dueDate: z.union([dateLike, z.null()]).optional(),
    due_date: z.union([dateLike, z.null()]).optional(),
    note: limitedNote.optional(),
  })
  .passthrough()
  .refine((value) => value.id !== undefined || value.taskId !== undefined, {
    message: 'taskId or id is required',
    path: ['taskId'],
  });

export type QuoteCreateArgs = z.infer<typeof QuoteCreateArgs>;
export type QuoteUpdateArgs = z.infer<typeof QuoteUpdateArgs>;
export type QuoteCloseArgs = z.infer<typeof QuoteCloseArgs>;
export type SalesOrderPatch = z.infer<typeof SalesOrderPatch>;
export type PurchaseOrderPatch = z.infer<typeof PurchaseOrderPatch>;
export type TaskUpdateArgs = z.infer<typeof TaskUpdateArgs>;
